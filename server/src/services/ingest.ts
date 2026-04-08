// Ingest pipeline orchestrator.
//
// For a file in /dropzone:
//   1. Dedup check by source_path against ingest_jobs
//   2. Create episode (status=pending) + ingest_job (status=queued)
//   3. Copy source → /processing/{jobId}.{ext}   (source in /dropzone is NEVER touched)
//   4. Compute SHA-256 of source → source_hash
//   5. Two-pass ffmpeg loudnorm → /library/{slug}.mp3
//   6. Probe duration, compute file_hash of normalised output
//   7. Update episode (status=ready) + job (status=complete)
//   8. Clean up /processing copy
//
// On any error: job status=failed with error_message, episode status=error.
// Source file in /dropzone is untouched regardless of outcome.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inArray, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { episodes, ingestJobs } from '../db/schema.js';
import type { Episode, IngestJob } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { sha256File } from '../lib/hash.js';
import { tentativeSlug } from '../lib/slug.js';
import { parseEpisodeFilename } from '../lib/episode-filename.js';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title.js';
import { normalizeAudio } from './normalize.js';
import {
  fingerprintFile,
  persistFingerprintMatches,
  isFingerprintingEnabled,
  FingerprintingDisabledError,
} from './fingerprint.js';
import { config } from '../config.js';
import { pushQueue } from './liquidsoap.js';

// Extensions accepted as audio input. Others are ignored by the watcher.
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus']);

// Job states that mean "this source path is already being handled or is done".
// A file in these states is skipped by the watcher. Only 'failed' allows retry.
const ACTIVE_JOB_STATES = ['queued', 'copying', 'normalising', 'fingerprinting', 'complete'];

export function isSupportedAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Returns true if the watcher should skip this source path: an ingest job
 * already exists in an active-or-complete state (anything except 'failed').
 * Failed jobs allow a retry.
 */
export async function shouldSkipSource(sourcePath: string): Promise<boolean> {
  const rows = await db
    .select({ id: ingestJobs.id })
    .from(ingestJobs)
    .where(
      and(eq(ingestJobs.sourcePath, sourcePath), inArray(ingestJobs.status, ACTIVE_JOB_STATES)),
    )
    .limit(1);
  return rows.length > 0;
}

interface IngestOutcome {
  episode: Episode;
  job: IngestJob;
}

interface EpisodeSeed {
  title: string;
  slug: string;
  originalFilename: string;
  presenter?: string;
  broadcastDate?: string;
  description?: string;
}

export function buildEpisodeSeed(sourcePath: string): EpisodeSeed {
  const originalFilename = path.basename(sourcePath);
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  const parsedMetadata = parseEpisodeFilename(originalFilename);

  return {
    title: parsedMetadata?.title ?? stem,
    slug: tentativeSlug(parsedMetadata?.slugSeed ?? stem),
    originalFilename,
    presenter: parsedMetadata?.presenter,
    broadcastDate: parsedMetadata?.broadcastDate,
    description: undefined,
  };
}

/**
 * Run the full ingest pipeline for a single source file.
 * Returns updated episode + job rows on success. Throws on failure (after marking job/episode failed).
 */
export async function ingestFile(sourcePath: string): Promise<IngestOutcome> {
  if (!isSupportedAudioFile(sourcePath)) {
    throw new Error(`Unsupported audio format: ${sourcePath}`);
  }

  // Verify the source is actually readable before we create DB rows.
  await fs.stat(sourcePath);

  const episodeSeed = buildEpisodeSeed(sourcePath);

  // Create episode + job up front so the admin UI can show the in-progress state.
  const [episode] = await db
    .insert(episodes)
    .values({
      title: episodeSeed.title,
      presenter: episodeSeed.presenter,
      slug: episodeSeed.slug,
      broadcastDate: episodeSeed.broadcastDate,
      description: episodeSeed.description,
      originalFilename: episodeSeed.originalFilename,
      status: 'processing',
    })
    .returning();

  if (!episode) {
    throw new Error('Failed to create episode row');
  }

  const [job] = await db
    .insert(ingestJobs)
    .values({
      episodeId: episode.id,
      status: 'queued',
      sourcePath,
      startedAt: new Date(),
    })
    .returning();

  if (!job) {
    throw new Error('Failed to create ingest_job row');
  }

  logger.info(
    { jobId: job.id, episodeId: episode.id, sourcePath, slug: episodeSeed.slug },
    'ingest: job created',
  );

  try {
    return await runPipeline(episode, job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId: job.id, episodeId: episode.id }, 'ingest: pipeline failed');
    await db
      .update(ingestJobs)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
      .where(eq(ingestJobs.id, job.id));
    await db
      .update(episodes)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(episodes.id, episode.id));
    throw err;
  }
}

async function runPipeline(episode: Episode, job: IngestJob): Promise<IngestOutcome> {
  const sourceExt = path.extname(job.sourcePath);
  const processingPath = path.join(config.PROCESSING_DIR, `${job.id}${sourceExt}`);
  const libraryPath = path.join(config.LIBRARY_DIR, `${episode.slug}.mp3`);

  // Step 1: copy to /processing. Source in /dropzone is NEVER mutated.
  await db
    .update(ingestJobs)
    .set({ status: 'copying' })
    .where(eq(ingestJobs.id, job.id));
  await fs.mkdir(config.PROCESSING_DIR, { recursive: true });
  await fs.copyFile(job.sourcePath, processingPath);
  logger.info({ jobId: job.id, processingPath }, 'ingest: copied to processing');

  // Step 2: hash source (read from the /processing copy — identical content, avoids re-reading dropzone).
  const sourceHash = await sha256File(processingPath);
  await db
    .update(ingestJobs)
    .set({ sourceHash })
    .where(eq(ingestJobs.id, job.id));

  // Step 3: normalise.
  await db
    .update(ingestJobs)
    .set({ status: 'normalising' })
    .where(eq(ingestJobs.id, job.id));
  await fs.mkdir(config.LIBRARY_DIR, { recursive: true });
  const { durationSeconds, measuredLufs } = await normalizeAudio(processingPath, libraryPath, {
    album: 'duckfeed Radio',
    artist: episode.presenter ?? undefined,
    title: formatEpisodeDisplayTitle(episode.title, episode.presenter),
  });

  // Step 4: hash the normalised output for integrity/dedup reference.
  const fileHash = await sha256File(libraryPath);

  // Step 5: finalise episode + job.
  const [updatedEpisode] = await db
    .update(episodes)
    .set({
      filePath: libraryPath,
      durationSeconds,
      loudnessLufs: measuredLufs,
      fileHash,
      status: 'ready',
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episode.id))
    .returning();

  const [updatedJob] = await db
    .update(ingestJobs)
    .set({ status: 'complete', completedAt: new Date() })
    .where(eq(ingestJobs.id, job.id))
    .returning();

  if (!updatedEpisode || !updatedJob) {
    throw new Error('ingest: failed to finalise episode/job rows');
  }

  await queueEpisode(updatedEpisode);

  // Step 6: clean up /processing copy. Best-effort — the job is already complete.
  try {
    await fs.unlink(processingPath);
  } catch (err) {
    logger.warn({ err, processingPath }, 'ingest: failed to clean up processing file');
  }

  logger.info(
    {
      jobId: updatedJob.id,
      episodeId: updatedEpisode.id,
      durationSeconds,
      measuredLufs,
      libraryPath,
    },
    'ingest: complete',
  );

  // Step 7: optional fingerprinting (non-fatal). The episode is already
  // 'ready' and visible in the admin UI, so any failure here is logged
  // and swallowed — fingerprinting is enrichment, never a blocker.
  await runFingerprintStep(updatedEpisode.id, libraryPath);

  return { episode: updatedEpisode, job: updatedJob };
}

async function queueEpisode(episode: Episode): Promise<void> {
  if (!episode.filePath) {
    return;
  }

  try {
    const result = await pushQueue(episode.filePath);
    await db
      .update(episodes)
      .set({
        autoQueuedAt: new Date(),
        autoQueueRequestId: result.requestId,
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episode.id));
    logger.info(
      { episodeId: episode.id, filePath: episode.filePath, requestId: result.requestId },
      'ingest: episode auto-queued',
    );
  } catch (err) {
    logger.warn({ err, episodeId: episode.id }, 'ingest: auto-queue failed (episode remains ready)');
  }
}

/**
 * Optional fingerprinting step. Logs and swallows all errors so it can never
 * fail an ingest. Skipped silently when ACOUSTID_API_KEY is not configured.
 */
async function runFingerprintStep(episodeId: string, libraryPath: string): Promise<void> {
  if (!isFingerprintingEnabled()) {
    logger.info({ episodeId }, 'fingerprint: skipped (ACOUSTID_API_KEY not set)');
    return;
  }

  try {
    const matches = await fingerprintFile(libraryPath);
    const inserted = await persistFingerprintMatches(episodeId, matches);
    logger.info(
      { episodeId, matchCount: matches.length, insertedCount: inserted.length },
      'fingerprint: matches persisted',
    );
  } catch (err) {
    if (err instanceof FingerprintingDisabledError) {
      logger.info({ episodeId }, 'fingerprint: skipped (disabled)');
      return;
    }
    logger.warn({ err, episodeId }, 'fingerprint: failed (continuing — ingest already complete)');
  }
}
