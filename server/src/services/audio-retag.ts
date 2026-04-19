// Idempotent ID3 tag reconciliation for library files.
//
// The metadata recovery pass repairs DB rows by matching condensed filename
// signatures against Mixcloud. That leaves the audio file's ID3 tags stale —
// Icecast keeps broadcasting whatever was stamped during the original
// ingest/normalize step (which, for dropzone-style slug filenames, is
// slug-condensed garbage like `Discountpanettone | Morganstujosh`).
//
// Uses spawn via runCommand — no shell, no injection.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title.js';
import { logger } from '../lib/logger.js';
import { CommandError, runCommand } from '../lib/run-command.js';

const FFPROBE_TIMEOUT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 60_000;
const EXPECTED_ALBUM = 'duckfeed Radio';

export interface ExpectedTags {
  album: string;
  artist: string;
  title: string;
}

export interface LibraryTagReconciliationSummary {
  checked: number;
  failed: number;
  retagged: number;
}

export function buildExpectedTags(episode: {
  presenter: string | null;
  title: string;
}): ExpectedTags {
  const artist = episode.presenter?.trim() ?? '';
  return {
    album: EXPECTED_ALBUM,
    artist,
    title: formatEpisodeDisplayTitle(episode.title, episode.presenter),
  };
}

export async function readAudioTags(filePath: string): Promise<Partial<ExpectedTags>> {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-show_entries',
      'format_tags=title,artist,album',
      '-of',
      'default=nw=1',
      filePath,
    ],
    { timeoutMs: FFPROBE_TIMEOUT_MS },
  );

  const tags: Partial<ExpectedTags> = {};
  for (const line of stdout.split('\n')) {
    const match = /^TAG:(title|artist|album)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    tags[key as keyof ExpectedTags] = value ?? '';
  }
  return tags;
}

/**
 * Rewrite tags via ffmpeg -c copy into a sibling temp file, then atomically
 * rename. Open fds in readers (Liquidsoap) stay pointed at the old inode, so
 * in-flight playback is not disrupted.
 */
export async function retagAudioFile(filePath: string, tags: ExpectedTags): Promise<void> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath) || '.mp3';
  const base = path.basename(filePath, ext);
  const tempPath = path.join(dir, `.${base}.retag-${process.pid}${ext}`);

  try {
    await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-y',
        '-i',
        filePath,
        '-map',
        '0',
        '-c',
        'copy',
        '-map_metadata',
        '-1',
        '-metadata',
        `title=${tags.title}`,
        '-metadata',
        `artist=${tags.artist}`,
        '-metadata',
        `album=${tags.album}`,
        '-id3v2_version',
        '3',
        '-write_xing',
        '0',
        tempPath,
      ],
      { timeoutMs: FFMPEG_TIMEOUT_MS },
    );
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function tagsMatch(current: Partial<ExpectedTags>, expected: ExpectedTags): boolean {
  return (
    (current.title ?? '') === expected.title &&
    (current.artist ?? '') === expected.artist &&
    (current.album ?? '') === expected.album
  );
}

interface LibraryEpisode {
  filePath: string | null;
  id: string;
  presenter: string | null;
  title: string;
}

/**
 * Ensure every ready library file's ID3 tags match the DB. Retags only files
 * whose current tags differ from expected — idempotent, safe to run every pass.
 */
export async function reconcileLibraryTags(): Promise<LibraryTagReconciliationSummary> {
  const rows = (await db
    .select({
      filePath: episodes.filePath,
      id: episodes.id,
      presenter: episodes.presenter,
      title: episodes.title,
    })
    .from(episodes)
    .where(eq(episodes.status, 'ready'))) as LibraryEpisode[];

  let checked = 0;
  let retagged = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.filePath) continue;
    checked += 1;

    const expected = buildExpectedTags(row);
    if (!expected.title) continue;

    try {
      const current = await readAudioTags(row.filePath);
      if (tagsMatch(current, expected)) continue;

      logger.info(
        {
          current,
          expected,
          episodeId: row.id,
          filePath: row.filePath,
        },
        'audio-retag: rewriting ID3 tags to match DB',
      );
      await retagAudioFile(row.filePath, expected);
      retagged += 1;
    } catch (error) {
      failed += 1;
      const details =
        error instanceof CommandError
          ? { exitCode: error.exitCode, stderr: error.stderr.slice(0, 500) }
          : {};
      logger.warn(
        { err: error, episodeId: row.id, filePath: row.filePath, ...details },
        'audio-retag: failed to reconcile tags',
      );
    }
  }

  return { checked, failed, retagged };
}
