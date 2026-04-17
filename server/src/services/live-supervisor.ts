import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { liveScheduleEntry, liveSource } from '../db/schema.js';
import type { LiveScheduleEntry, LiveSource } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import {
  setInteractiveBool,
  setInteractiveString,
} from './liquidsoap.js';
import {
  resolveLiveSchedule,
  type LiveScheduleResolution,
} from './live-schedule.js';

const TICK_INTERVAL_MS = 10_000;

interface LiveModeSnapshot {
  resolution: LiveScheduleResolution;
  source: LiveSource | null;
  schedule: LiveScheduleEntry[];
  appliedLiveOnLiquidsoap: boolean;
}

let cached: LiveModeSnapshot | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let inFlight: Promise<LiveModeSnapshot> | null = null;
let appliedLiveState: { enabled: boolean; url: string } | null = null;

async function loadSource(): Promise<LiveSource | null> {
  const rows = await db.select().from(liveSource).limit(1);
  return rows[0] ?? null;
}

async function loadSchedule(): Promise<LiveScheduleEntry[]> {
  return await db
    .select()
    .from(liveScheduleEntry)
    .where(eq(liveScheduleEntry.enabled, true));
}

async function applyLiquidsoapState(
  isLive: boolean,
  url: string | null,
): Promise<boolean> {
  const targetEnabled = isLive && typeof url === 'string' && url.length > 0;
  const targetUrl = targetEnabled ? (url as string) : '';

  if (
    appliedLiveState &&
    appliedLiveState.enabled === targetEnabled &&
    appliedLiveState.url === targetUrl
  ) {
    return targetEnabled;
  }

  try {
    // URL is always set before enabled so Liquidsoap never briefly reaches
    // for an old URL. When disabling we still rewrite both to keep state
    // in the telnet cache consistent.
    await setInteractiveString('live.url', targetUrl);
    await setInteractiveBool('live.enabled', targetEnabled);
    appliedLiveState = { enabled: targetEnabled, url: targetUrl };
    logger.info(
      { enabled: targetEnabled, hasUrl: targetUrl.length > 0 },
      'live-supervisor: applied liquidsoap state',
    );
    return targetEnabled;
  } catch (error) {
    logger.warn({ err: error }, 'live-supervisor: failed to apply liquidsoap state');
    // Reset so we retry on the next tick.
    appliedLiveState = null;
    return false;
  }
}

export async function refreshLiveSnapshot(
  now = new Date(),
): Promise<LiveModeSnapshot> {
  if (inFlight) {
    return await inFlight;
  }

  inFlight = (async () => {
    try {
      const [source, schedule] = await Promise.all([loadSource(), loadSchedule()]);
      const resolution = resolveLiveSchedule(now, schedule);
      const applied = await applyLiquidsoapState(
        resolution.isLive,
        source?.url ?? null,
      );
      const snapshot: LiveModeSnapshot = {
        resolution,
        source,
        schedule,
        appliedLiveOnLiquidsoap: applied,
      };
      cached = snapshot;
      return snapshot;
    } finally {
      inFlight = null;
    }
  })();

  return await inFlight;
}

export async function getLiveSnapshot(): Promise<LiveModeSnapshot> {
  if (cached) {
    return cached;
  }
  return await refreshLiveSnapshot();
}

export function startLiveSupervisor(): void {
  if (tickTimer) return;

  void refreshLiveSnapshot().catch((error) => {
    logger.error({ err: error }, 'live-supervisor: initial refresh failed');
  });

  tickTimer = setInterval(() => {
    void refreshLiveSnapshot().catch((error) => {
      logger.error({ err: error }, 'live-supervisor: refresh failed');
    });
  }, TICK_INTERVAL_MS);
  tickTimer.unref();

  logger.info({ intervalMs: TICK_INTERVAL_MS }, 'live-supervisor: started');
}

export function stopLiveSupervisor(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  cached = null;
  inFlight = null;
  appliedLiveState = null;
}

export type { LiveModeSnapshot };
