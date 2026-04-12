import { config } from './config.js';
import { pool } from './db/index.js';
import { logger } from './lib/logger.js';
import { recoverEpisodeMetadata } from './services/metadata-recovery.js';

let intervalHandle: NodeJS.Timeout | null = null;

async function runRecoveryPass(reason: 'startup' | 'interval'): Promise<void> {
  try {
    const summary = await recoverEpisodeMetadata();
    logger.info({ reason, ...summary }, 'metadata-worker: recovery pass complete');
  } catch (error) {
    logger.error({ err: error, reason }, 'metadata-worker: recovery pass failed');
  }
}

async function start(): Promise<void> {
  logger.info(
    {
      intervalMs: config.METADATA_RECOVERY_INTERVAL_MS,
      mixcloudUserUrl: config.MIXCLOUD_USER_URL,
    },
    'metadata-worker: starting',
  );

  await runRecoveryPass('startup');

  intervalHandle = setInterval(() => {
    void runRecoveryPass('interval');
  }, config.METADATA_RECOVERY_INTERVAL_MS);
  intervalHandle.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'metadata-worker: shutting down');
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((error) => {
  logger.error({ err: error }, 'metadata-worker: fatal startup error');
  process.exit(1);
});
