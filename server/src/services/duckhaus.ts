import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { eq, max } from 'drizzle-orm';

import { config } from '../config.js';
import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { logger } from '../lib/logger.js';

interface DuckhausCatalogEntry {
  artworkUrl: string | null;
  broadcastDate: string;
  description: string | null;
  downloadUrl: string | null;
  durationSeconds: number | null;
  fileHash: string | null;
  loudnessLufs: number | null;
  mixcloudUrl: string;
  presenter: string;
  slug: string;
  status: string;
  sourceTitle: string;
  title: string;
}

export function getDuckhausEpisodeStatus(entry: {
  downloadUrl: string | null;
  status: string;
}): 'pending' | 'ready' {
  return entry.status === 'prepared' && entry.downloadUrl ? 'ready' : 'pending';
}

export async function syncDuckhausCatalog(): Promise<number> {
  const entries = await fetchDuckhausCatalog();
  if (entries.length === 0) return 0;

  // New episodes join the current rotation cycle so they don't cause
  // catch-up loops by sitting at cycle 0 while everything else is higher.
  const [cycleRow] = await db
    .select({ maxCycle: max(episodes.rotationCycle) })
    .from(episodes)
    .where(eq(episodes.status, 'ready'));
  const currentCycle = cycleRow?.maxCycle ?? 0;

  let synced = 0;

  for (const entry of entries) {
    await db
      .insert(episodes)
      .values({
        title: entry.title,
        presenter: entry.presenter,
        slug: entry.slug,
        broadcastDate: entry.broadcastDate,
        description: entry.description,
        mixcloudUrl: entry.mixcloudUrl,
        artworkUrl: entry.artworkUrl,
        durationSeconds: entry.durationSeconds,
        loudnessLufs: entry.loudnessLufs,
        fileHash: entry.fileHash,
        originalFilename: `${entry.slug}.mp3`,
        status: getDuckhausEpisodeStatus(entry),
        rotationCycle: currentCycle,
      })
      .onConflictDoUpdate({
        target: episodes.slug,
        set: {
          title: entry.title,
          presenter: entry.presenter,
          broadcastDate: entry.broadcastDate,
          description: entry.description,
          mixcloudUrl: entry.mixcloudUrl,
          artworkUrl: entry.artworkUrl,
          durationSeconds: entry.durationSeconds,
          loudnessLufs: entry.loudnessLufs,
          fileHash: entry.fileHash,
          status: getDuckhausEpisodeStatus(entry),
          updatedAt: new Date(),
        },
      });

    synced += 1;
  }

  return synced;
}

export async function ensureDuckhausEpisodeCached(episodeId: string): Promise<string | null> {
  if (!config.DUCKHAUS_BASE_URL || !config.DUCKHAUS_API_TOKEN) {
    return null;
  }

  const [episode] = await db
    .select({
      id: episodes.id,
      slug: episodes.slug,
      filePath: episodes.filePath,
    })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  if (!episode) {
    return null;
  }
  if (episode.filePath) {
    return episode.filePath;
  }

  const entry = await fetchDuckhausCatalogEntry(episode.slug);
  if (!entry?.downloadUrl) {
    return null;
  }

  const destinationPath = path.join(config.LIBRARY_DIR, `${episode.slug}.mp3`);
  const tempPath = `${destinationPath}.part`;

  await fs.mkdir(config.LIBRARY_DIR, { recursive: true });
  await downloadToFile(entry.downloadUrl, tempPath);
  await fs.rename(tempPath, destinationPath);

  await db
    .update(episodes)
    .set({
      artworkUrl: entry.artworkUrl,
      broadcastDate: entry.broadcastDate,
      description: entry.description,
      durationSeconds: entry.durationSeconds,
      fileHash: entry.fileHash,
      filePath: destinationPath,
      loudnessLufs: entry.loudnessLufs,
      mixcloudUrl: entry.mixcloudUrl,
      originalFilename: `${entry.slug}.mp3`,
      presenter: entry.presenter,
      status: 'ready',
      title: entry.title,
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));

  logger.info({ episodeId, destinationPath }, 'duckhaus: cached prepared episode locally');
  return destinationPath;
}

async function fetchDuckhausCatalog(): Promise<DuckhausCatalogEntry[]> {
  if (!config.DUCKHAUS_BASE_URL || !config.DUCKHAUS_API_TOKEN) {
    return [];
  }

  const response = await fetch(`${config.DUCKHAUS_BASE_URL}/api/catalog`, {
    headers: {
      Authorization: `Bearer ${config.DUCKHAUS_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'duckhaus: catalog fetch failed');
    return [];
  }

  const payload = (await response.json()) as {
    data: DuckhausCatalogEntry[];
  };
  return payload.data ?? [];
}

async function fetchDuckhausCatalogEntry(slug: string): Promise<DuckhausCatalogEntry | null> {
  const response = await fetch(`${config.DUCKHAUS_BASE_URL}/api/catalog/${slug}`, {
    headers: {
      Authorization: `Bearer ${config.DUCKHAUS_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    logger.warn({ slug, status: response.status }, 'duckhaus: catalog entry fetch failed');
    return null;
  }

  const payload = (await response.json()) as { data: DuckhausCatalogEntry | null };
  return payload.data ?? null;
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.DUCKHAUS_API_TOKEN}`,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`duckhaus: failed to download prepared audio from ${url}`);
  }

  const stream = Readable.fromWeb(
    response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  );
  await pipeline(stream, createWriteStream(filePath));
}
