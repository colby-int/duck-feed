import { logger } from '../lib/logger.js';
import type { LiquidsoapStreamState } from './liquidsoap.js';
import { pollLiquidsoapState } from './liquidsoap.js';

const POLL_INTERVAL_MS = 10_000;

let cachedSnapshot: LiquidsoapStreamState | null = null;
let inFlightPoll: Promise<LiquidsoapStreamState> | null = null;
let pollerTimer: NodeJS.Timeout | null = null;

export async function getStreamSnapshot(): Promise<LiquidsoapStreamState> {
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  return await refreshStreamSnapshot();
}

export async function refreshStreamSnapshot(now = new Date()): Promise<LiquidsoapStreamState> {
  if (inFlightPoll) {
    return await inFlightPoll;
  }

  inFlightPoll = (async () => {
    try {
      const snapshot = await pollLiquidsoapState(now);
      cachedSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      logger.warn({ err: error }, 'stream-poller: liquidsoap poll failed');
      const offlineSnapshot = buildOfflineSnapshot(now);
      cachedSnapshot = offlineSnapshot;
      return offlineSnapshot;
    } finally {
      inFlightPoll = null;
    }
  })();

  return await inFlightPoll;
}

export function startStreamPoller(): void {
  if (pollerTimer) {
    return;
  }

  void refreshStreamSnapshot().catch((error) => {
    logger.error({ err: error }, 'stream-poller: initial refresh failed');
  });

  pollerTimer = setInterval(() => {
    void refreshStreamSnapshot().catch((error) => {
      logger.error({ err: error }, 'stream-poller: refresh failed');
    });
  }, POLL_INTERVAL_MS);
  pollerTimer.unref();

  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'stream-poller: started');
}

export function stopStreamPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }

  cachedSnapshot = null;
  inFlightPoll = null;
}

function buildOfflineSnapshot(now: Date): LiquidsoapStreamState {
  return {
    checkedAt: now.toISOString(),
    currentRequest: null,
    online: false,
    queue: [],
    remainingSeconds: null,
  };
}
