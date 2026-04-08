import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { episodes } from '../src/db/schema.js';
import { formatEpisodeDisplayTitle } from '../src/lib/episode-display-title.js';
import { runCommand } from '../src/lib/run-command.js';

const CONTAINER_LIBRARY_DIR = '/var/lib/duckfeed/library';
const HOST_LIBRARY_DIR = process.env.LIBRARY_DIR
  ? path.resolve(process.env.LIBRARY_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../volumes/library');

async function rewriteAudioMetadata(filePath: string, metadata: { album: string; artist?: string; title: string }) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath, path.extname(filePath))}.metadata${path.extname(filePath)}`,
  );

  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    filePath,
    '-map_metadata',
    '-1',
    '-codec',
    'copy',
    '-metadata',
    `title=${metadata.title}`,
    ...(metadata.artist ? ['-metadata', `artist=${metadata.artist}`] : []),
    '-metadata',
    `album=${metadata.album}`,
    tempPath,
  ]);

  await fs.rename(tempPath, filePath);
}

async function resolveLibraryPath(storedPath: string): Promise<string | null> {
  try {
    await fs.access(storedPath);
    return storedPath;
  } catch {
    if (!storedPath.startsWith(CONTAINER_LIBRARY_DIR)) {
      return null;
    }
  }

  const relativePath = path.relative(CONTAINER_LIBRARY_DIR, storedPath);
  const hostPath = path.join(HOST_LIBRARY_DIR, relativePath);
  try {
    await fs.access(hostPath);
    return hostPath;
  } catch {
    return null;
  }
}

async function main() {
  const rows = await db
    .select({
      filePath: episodes.filePath,
      id: episodes.id,
      presenter: episodes.presenter,
      title: episodes.title,
    })
    .from(episodes)
    .where(and(eq(episodes.status, 'ready'), isNotNull(episodes.filePath)));

  let rewritten = 0;

  for (const row of rows) {
    if (!row.filePath) {
      continue;
    }

    const resolvedFilePath = await resolveLibraryPath(row.filePath);
    if (!resolvedFilePath) {
      console.warn(`[skip] missing file for ${row.id}: ${row.filePath}`);
      continue;
    }

    await rewriteAudioMetadata(resolvedFilePath, {
      album: 'duckfeed Radio',
      artist: row.presenter ?? undefined,
      title: formatEpisodeDisplayTitle(row.title, row.presenter),
    });
    rewritten += 1;
    console.log(`[ok] retagged ${resolvedFilePath}`);
  }

  console.log(`Retagged ${rewritten} library file(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
