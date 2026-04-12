// Playback log writer.
//
// Polls Liquidsoap on a timer and records episode transitions in the
// `playback_log` table. The "current" episode is whichever has an open
// row (ended_at IS NULL). On each tick:
//
//   1. Ask Liquidsoap which file is currently playing.
//   2. Resolve that file path to an episode (or null if it's e.g. a test tone).
//   3. Compare against the most recent open playback_log row.
//   4. If unchanged → do nothing.
//      If changed → close any open rows, then insert a new row for the new
//      episode (if any).
//
// State lives entirely in the DB so the writer is restart-safe: after an API
// crash the next tick will reconcile any stale open rows automatically.
//
// All errors are caught and logged. The writer must NEVER crash the API
// server — playback history is enrichment, not critical infrastructure.

import { desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { episodes, playbackLog } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { getStreamSnapshot } from './stream-poller.js';

const POLL_INTERVAL_MS = 10_000;

let pollerTimer: NodeJS.Timeout | null = null;

export async function tickPlaybackLog(now: Date = new Date()): Promise<void> {
  const snapshot = await getStreamSnapshot();
  const filePath = snapshot.currentRequest?.filePath ?? null;

  // Resolve the current file to an episode, if any.
  let currentEpisodeId: string | null = null;
  if (filePath) {
    const [ep] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.filePath, filePath))
      .limit(1);
    currentEpisodeId = ep?.id ?? null;
  }

  // Find the latest open playback_log row.
  const [openRow] = await db
    .select({ id: playbackLog.id, episodeId: playbackLog.episodeId })
    .from(playbackLog)
    .where(isNull(playbackLog.endedAt))
    .orderBy(desc(playbackLog.startedAt))
    .limit(1);

  // No transition if the open row already matches the current episode.
  if (openRow && openRow.episodeId === currentEpisodeId) {
    return;
  }

  // Close any open rows. There should normally be at most one, but defensively
  // close all of them so we can recover from past crashes.
  if (openRow) {
    await db
      .update(playbackLog)
      .set({ endedAt: now })
      .where(isNull(playbackLog.endedAt));
  }

  // Insert a new row for the new episode (if any). If the current file isn't
  // a known episode (e.g. test tone) we just leave the log empty until the
  // next real episode starts.
  if (currentEpisodeId) {
    await db.insert(playbackLog).values({ episodeId: currentEpisodeId, startedAt: now });
  }

  logger.info(
    {
      previousEpisodeId: openRow?.episodeId ?? null,
      currentEpisodeId,
      currentFilePath: filePath,
    },
    'playback-log: transition recorded',
  );
}

export function startPlaybackLogWriter(): void {
  if (pollerTimer) return;

  // Run an initial tick after a short delay so the server has a chance to
  // finish startup before we hit Liquidsoap.
  setTimeout(() => {
    void tickPlaybackLog().catch((err) => {
      logger.error({ err }, 'playback-log: initial tick failed');
    });
  }, 2_000);

  pollerTimer = setInterval(() => {
    void tickPlaybackLog().catch((err) => {
      logger.error({ err }, 'playback-log: tick failed');
    });
  }, POLL_INTERVAL_MS);

  // Don't keep the process alive just for the poller — let the HTTP server
  // own the lifecycle.
  pollerTimer.unref();

  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'playback-log: writer started');
}

export function stopPlaybackLogWriter(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}
