import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '../db/index.js';
import { episodes, playbackLog, rotationQueueEntries } from '../db/schema.js';

export interface RotationQueueViewEntry {
  id: string;
  position: number;
  episode: {
    id: string;
    title: string;
    presenter: string | null;
    slug: string;
    broadcastDate: string | null;
  };
}

export async function listRotationQueue(): Promise<RotationQueueViewEntry[]> {
  const rows = await db
    .select({
      id: rotationQueueEntries.id,
      position: rotationQueueEntries.position,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      episodePresenter: episodes.presenter,
      episodeSlug: episodes.slug,
      episodeBroadcastDate: episodes.broadcastDate,
    })
    .from(rotationQueueEntries)
    .innerJoin(episodes, eq(episodes.id, rotationQueueEntries.episodeId))
    .orderBy(asc(rotationQueueEntries.position));

  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    episode: {
      id: row.episodeId,
      title: row.episodeTitle,
      presenter: row.episodePresenter,
      slug: row.episodeSlug,
      broadcastDate: row.episodeBroadcastDate,
    },
  }));
}

export async function shuffleRotationQueue(count: number): Promise<RotationQueueViewEntry[]> {
  const readyEpisodes = await db
    .select({
      id: episodes.id,
      title: episodes.title,
      presenter: episodes.presenter,
      slug: episodes.slug,
      broadcastDate: episodes.broadcastDate,
    })
    .from(episodes)
    .where(eq(episodes.status, 'ready'));

  const shuffled = [...readyEpisodes]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.max(0, count));

  await db.delete(rotationQueueEntries);

  if (shuffled.length > 0) {
    await db.insert(rotationQueueEntries).values(
      shuffled.map((episode, index) => ({
        episodeId: episode.id,
        position: index + 1,
        source: 'auto',
      })),
    );
  }

  return await listRotationQueue();
}

export async function removeRotationQueueEntry(id: string): Promise<void> {
  await db.delete(rotationQueueEntries).where(eq(rotationQueueEntries.id, id));
  await normalizeRotationQueuePositions();
}

export async function moveRotationQueueEntryToFront(id: string): Promise<void> {
  const rows = await db
    .select({
      id: rotationQueueEntries.id,
      episodeId: rotationQueueEntries.episodeId,
      source: rotationQueueEntries.source,
    })
    .from(rotationQueueEntries)
    .orderBy(asc(rotationQueueEntries.position));

  const target = rows.find((row) => row.id === id);
  if (!target) {
    return;
  }

  const reordered = [target, ...rows.filter((row) => row.id !== id)];
  await db.delete(rotationQueueEntries);
  await db.insert(rotationQueueEntries).values(
    reordered.map((row, index) => ({
      episodeId: row.episodeId,
      position: index + 1,
      source: row.source,
    })),
  );
}

export async function appendEpisodeToRotationQueue(
  episodeId: string,
  source: 'auto' | 'requeued' | 'manual' = 'auto',
): Promise<void> {
  const [lastRow] = await db
    .select({ position: rotationQueueEntries.position })
    .from(rotationQueueEntries)
    .orderBy(desc(rotationQueueEntries.position))
    .limit(1);

  await db.insert(rotationQueueEntries).values({
    episodeId,
    position: (lastRow?.position ?? 0) + 1,
    source,
  });
}

export async function peekNextRotationQueueEntry(): Promise<{
  episodeId: string;
  filePath: string | null;
  queueEntryId: string;
} | null> {
  const [row] = await db
    .select({
      queueEntryId: rotationQueueEntries.id,
      episodeId: episodes.id,
      filePath: episodes.filePath,
    })
    .from(rotationQueueEntries)
    .innerJoin(episodes, eq(episodes.id, rotationQueueEntries.episodeId))
    .orderBy(asc(rotationQueueEntries.position))
    .limit(1);

  return row ?? null;
}

export async function resolvePendingRotationPlayback(): Promise<{
  episodeId: string;
  playbackId: string;
  requeue: boolean;
} | null> {
  const [row] = await db
    .select({
      playbackId: playbackLog.id,
      episodeId: playbackLog.episodeId,
      listenerPeak: playbackLog.listenerPeak,
    })
    .from(playbackLog)
    .where(and(isNotNull(playbackLog.endedAt), isNull(playbackLog.rotationOutcome)))
    .orderBy(desc(playbackLog.endedAt))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    episodeId: row.episodeId,
    playbackId: row.playbackId,
    requeue: (row.listenerPeak ?? 0) === 0,
  };
}

export async function markRotationPlaybackOutcome(
  playbackId: string,
  outcome: 'played' | 'requeued_zero_listeners',
): Promise<void> {
  await db
    .update(playbackLog)
    .set({ rotationOutcome: outcome })
    .where(eq(playbackLog.id, playbackId));
}

async function normalizeRotationQueuePositions(): Promise<void> {
  const rows = await db
    .select({ id: rotationQueueEntries.id })
    .from(rotationQueueEntries)
    .orderBy(asc(rotationQueueEntries.position));

  for (const [index, row] of rows.entries()) {
    await db
      .update(rotationQueueEntries)
      .set({ position: index + 1, updatedAt: new Date() })
      .where(eq(rotationQueueEntries.id, row.id));
  }
}
