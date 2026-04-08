// duckfeed ingest worker.
// Watches DROPZONE_DIR for new audio files and runs them through the ingest pipeline.
// Source files in /dropzone are NEVER modified or deleted — dedup is tracked in ingest_jobs.

import chokidar from 'chokidar';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { createTaskQueue } from './lib/task-queue.js';
import { ingestFile, isSupportedAudioFile, shouldSkipSource } from './services/ingest.js';
import { pool } from './db/index.js';

// Wait for a file to be fully written before processing. chokidar's awaitWriteFinish
// polls mtime/size until they stabilise, which replaces the manual stability loop.
const STABILITY_THRESHOLD_MS = 5_000;
const POLL_INTERVAL_MS = 1_000;

// Per-source in-memory lock so the same file isn't processed twice if chokidar
// fires overlapping events (e.g. initial scan + subsequent edit).
const inFlight = new Set<string>();

async function handleFile(filePath: string): Promise<void> {
  if (!isSupportedAudioFile(filePath)) {
    logger.debug({ filePath }, 'worker: ignoring non-audio file');
    return;
  }
  if (inFlight.has(filePath)) {
    logger.debug({ filePath }, 'worker: already in flight, skipping');
    return;
  }
  if (await shouldSkipSource(filePath)) {
    logger.info({ filePath }, 'worker: source already ingested or in progress, skipping');
    return;
  }

  inFlight.add(filePath);
  try {
    logger.info({ filePath }, 'worker: starting ingest');
    await ingestFile(filePath);
    logger.info({ filePath }, 'worker: ingest complete');
  } catch (err) {
    // ingestFile already marked the job/episode as failed and logged the error.
    // Swallow here so the watcher keeps running.
    logger.error({ err, filePath }, 'worker: ingest failed (job marked failed)');
  } finally {
    inFlight.delete(filePath);
  }
}

async function start(): Promise<void> {
  const ingestQueue = createTaskQueue(config.INGEST_MAX_CONCURRENCY);

  logger.info(
    {
      dropzone: config.DROPZONE_DIR,
      library: config.LIBRARY_DIR,
      processing: config.PROCESSING_DIR,
      maxConcurrency: config.INGEST_MAX_CONCURRENCY,
    },
    'ingest worker starting',
  );

  const watcher = chokidar.watch(config.DROPZONE_DIR, {
    ignored: (p) => p.startsWith('.') || p.endsWith('.part') || p.endsWith('.tmp'),
    ignoreInitial: false, // pick up files added while worker was down
    depth: 0, // only top-level files in dropzone
    awaitWriteFinish: {
      stabilityThreshold: STABILITY_THRESHOLD_MS,
      pollInterval: POLL_INTERVAL_MS,
    },
  });

  watcher.on('add', (filePath) => {
    const queuedTask = ingestQueue.enqueue(() => handleFile(filePath));
    logger.info(
      {
        filePath,
        activeIngests: ingestQueue.activeCount,
        queuedIngests: ingestQueue.pendingCount,
      },
      'worker: ingest queued',
    );
    void queuedTask.catch((err) => {
      logger.error({ err, filePath }, 'worker: queued ingest task crashed');
    });
  });

  watcher.on('error', (err) => {
    logger.error({ err }, 'worker: chokidar error');
  });

  watcher.on('ready', () => {
    logger.info('worker: initial scan complete, watching for new files');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker: shutting down');
    await watcher.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((err) => {
  logger.error({ err }, 'worker: fatal startup error');
  process.exit(1);
});
