import { promises as fs } from 'node:fs';

import { eq, isNotNull } from 'drizzle-orm';

import { config } from '../config.js';
import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { ensureDuckhausEpisodeCached, syncDuckhausCatalog } from './duckhaus.js';
import { getCurrentRequest, getQueue, getRequestMetadata, pushQueue } from './liquidsoap.js';
import {
  appendEpisodeToRotationQueue,
  listRotationQueue,
  markRotationPlaybackOutcome,
  peekNextRotationQueueEntry,
  removeRotationQueueEntry,
  resolvePendingRotationPlayback,
  shuffleRotationQueue,
} from './rotation-queue.js';

const POLL_INTERVAL_MS = 15_000;
const AUTO_QUEUE_DEPTH = 12;

let pollerTimer: NodeJS.Timeout | null = null;

export async function tickRotationManager(): Promise<void> {
  await syncDuckhausCatalog();

  const pendingPlayback = await resolvePendingRotationPlayback();
  if (pendingPlayback) {
    if (pendingPlayback.requeue) {
      await appendEpisodeToRotationQueue(pendingPlayback.episodeId, 'requeued');
      await markRotationPlaybackOutcome(
        pendingPlayback.playbackId,
        'requeued_zero_listeners',
      );
    } else {
      await markRotationPlaybackOutcome(pendingPlayback.playbackId, 'played');
    }
  }

  const rotationEntries = await listRotationQueue();
  if (rotationEntries.length === 0) {
    await shuffleRotationQueue(AUTO_QUEUE_DEPTH);
  }

  const rawQueue = await getQueue();
  if (rawQueue.length > 0) {
    return;
  }

  // Try entries in queue order. If the front entry can't be cached (e.g.
  // legacy slug not in Duckhaus), skip it so the queue doesn't stall.
  const MAX_SKIP = 5;
  for (let attempt = 0; attempt < MAX_SKIP; attempt++) {
    const nextEntry = await peekNextRotationQueueEntry();
    if (!nextEntry) {
      return;
    }

    const filePath =
      nextEntry.filePath ?? (await ensureDuckhausEpisodeCached(nextEntry.episodeId));
    if (filePath) {
      await pushQueue(filePath);
      await removeRotationQueueEntry(nextEntry.queueEntryId);
      await pruneCachedEpisodes();
      return;
    }

    // Episode has no local file and can't be fetched — skip it.
    logger.warn(
      { episodeId: nextEntry.episodeId, queueEntryId: nextEntry.queueEntryId },
      'rotation-manager: skipping uncacheable episode',
    );
    await removeRotationQueueEntry(nextEntry.queueEntryId);
  }
}

export function startRotationManager(): void {
  if (pollerTimer) {
    return;
  }

  void tickRotationManager().catch((error) => {
    logger.error({ err: error }, 'rotation-manager: initial tick failed');
  });

  pollerTimer = setInterval(() => {
    void tickRotationManager().catch((error) => {
      logger.error({ err: error }, 'rotation-manager: tick failed');
    });
  }, POLL_INTERVAL_MS);
  pollerTimer.unref();
}

export function stopRotationManager(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}

async function pruneCachedEpisodes(): Promise<void> {
  const [currentRequest, rawQueueEntries, cachedEpisodes] = await Promise.all([
    getCurrentRequest(),
    getQueue(),
    db
      .select({
        id: episodes.id,
        filePath: episodes.filePath,
        updatedAt: episodes.updatedAt,
      })
      .from(episodes)
      .where(isNotNull(episodes.filePath)),
  ]);

  const protectedPaths = new Set<string>();
  if (currentRequest?.filePath) {
    protectedPaths.add(currentRequest.filePath);
  }
  for (const rawQueueEntry of rawQueueEntries) {
    if (rawQueueEntry.includes('/')) {
      protectedPaths.add(rawQueueEntry);
    }
  }

  const queuedRequests = await Promise.all(
    rawQueueEntries
      .filter((entry) => !entry.includes('/'))
      .map(async (requestId) => await getRequestMetadata(requestId)),
  );
  for (const queuedRequest of queuedRequests) {
    if (queuedRequest.filePath) {
      protectedPaths.add(queuedRequest.filePath);
    }
  }

  const sizedEpisodes = [];
  for (const episode of cachedEpisodes) {
    const filePath = episode.filePath;
    if (!filePath) continue;
    try {
      const stat = await fs.stat(filePath);
      sizedEpisodes.push({
        id: episode.id,
        filePath,
        sizeBytes: stat.size,
        updatedAt: episode.updatedAt,
      });
    } catch {
      await db
        .update(episodes)
        .set({ filePath: null, updatedAt: new Date() })
        .where(eq(episodes.id, episode.id));
    }
  }

  let totalBytes = sizedEpisodes.reduce((sum, episode) => sum + episode.sizeBytes, 0);
  if (totalBytes <= config.ROTATION_CACHE_MAX_BYTES) {
    return;
  }

  const evictionCandidates = sizedEpisodes
    .filter((episode) => !protectedPaths.has(episode.filePath))
    .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());

  for (const candidate of evictionCandidates) {
    if (totalBytes <= config.ROTATION_CACHE_MAX_BYTES) {
      break;
    }

    try {
      await fs.unlink(candidate.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await db
      .update(episodes)
      .set({ filePath: null, updatedAt: new Date() })
      .where(eq(episodes.id, candidate.id));

    totalBytes -= candidate.sizeBytes;
    logger.info(
      { episodeId: candidate.id, filePath: candidate.filePath, totalBytes },
      'rotation-manager: evicted cached episode to stay within budget',
    );
  }
}
