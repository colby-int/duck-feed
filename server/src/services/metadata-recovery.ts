import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { parseEpisodeFilename } from '../lib/episode-filename.js';
import { logger } from '../lib/logger.js';
import {
  condenseMetadataSegment,
  discoverMixcloudEpisodes,
  fetchMixcloudEpisode,
  type MixcloudEpisodeMetadata,
} from './mixcloud.js';

interface RecoveryCandidate {
  artworkUrl: string | null;
  broadcastDate: string | null;
  description: string | null;
  id: string;
  mixcloudUrl: string | null;
  originalFilename: string | null;
  presenter: string | null;
  status: string;
  title: string;
}

export interface MetadataRecoverySummary {
  matched: number;
  scanned: number;
  skipped: number;
  updated: number;
}

export async function recoverEpisodeMetadata(): Promise<MetadataRecoverySummary> {
  const rows = await db
    .select({
      artworkUrl: episodes.artworkUrl,
      broadcastDate: episodes.broadcastDate,
      description: episodes.description,
      id: episodes.id,
      mixcloudUrl: episodes.mixcloudUrl,
      originalFilename: episodes.originalFilename,
      presenter: episodes.presenter,
      status: episodes.status,
      title: episodes.title,
    })
    .from(episodes);

  const discoveredEpisodes = await discoverMixcloudEpisodes();
  const discoveredByUrl = new Map<string, MixcloudEpisodeMetadata>();
  for (const episode of discoveredEpisodes) {
    const normalizedUrl = normalizeUrl(episode.mixcloudUrl);
    if (normalizedUrl) {
      discoveredByUrl.set(normalizedUrl, episode);
    }
  }
  const discoveredBySignature = new Map<string, MixcloudEpisodeMetadata>();
  for (const episode of discoveredEpisodes) {
    discoveredBySignature.set(buildSignature(episode), episode);
  }

  let matched = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const canonical = await resolveCanonicalMetadata(row, discoveredByUrl, discoveredBySignature);
    if (!canonical) {
      skipped += 1;
      continue;
    }

    matched += 1;
    const patch = buildMetadataPatch(row, canonical);
    if (!patch) {
      skipped += 1;
      continue;
    }

    await db
      .update(episodes)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, row.id));
    updated += 1;
  }

  const summary = {
    matched,
    scanned: rows.length,
    skipped,
    updated,
  };
  logger.info(summary, 'metadata-recovery: pass complete');
  return summary;
}

function buildMetadataPatch(
  row: RecoveryCandidate,
  canonical: MixcloudEpisodeMetadata,
): Partial<typeof episodes.$inferInsert> | null {
  const patch: Partial<typeof episodes.$inferInsert> = {};

  if (row.title !== canonical.title) {
    patch.title = canonical.title;
  }
  if ((row.presenter ?? null) !== canonical.presenter) {
    patch.presenter = canonical.presenter;
  }
  if ((row.broadcastDate ?? null) !== canonical.broadcastDate) {
    patch.broadcastDate = canonical.broadcastDate;
  }
  if ((row.mixcloudUrl ?? null) !== canonical.mixcloudUrl) {
    patch.mixcloudUrl = canonical.mixcloudUrl;
  }
  if ((row.artworkUrl ?? null) !== (canonical.artworkUrl ?? null)) {
    patch.artworkUrl = canonical.artworkUrl;
  }
  if ((row.description ?? null) !== (canonical.description ?? null)) {
    patch.description = canonical.description;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

async function resolveCanonicalMetadata(
  row: RecoveryCandidate,
  discoveredByUrl: Map<string, MixcloudEpisodeMetadata>,
  discoveredBySignature: Map<string, MixcloudEpisodeMetadata>,
): Promise<MixcloudEpisodeMetadata | null> {
  const normalizedUrl = normalizeUrl(row.mixcloudUrl);
  if (normalizedUrl) {
    const directMatch = discoveredByUrl.get(normalizedUrl);
    if (directMatch) {
      return directMatch;
    }

    return await fetchMixcloudEpisode(normalizedUrl);
  }

  for (const signature of buildCandidateSignatures(row)) {
    const match = discoveredBySignature.get(signature);
    if (match) {
      return match;
    }
  }

  return null;
}

function buildCandidateSignatures(row: RecoveryCandidate): string[] {
  const signatures = new Set<string>();

  if (row.broadcastDate && row.presenter) {
    signatures.add(signatureForValues(row.broadcastDate, row.title, row.presenter));
  }

  if (row.originalFilename) {
    const parsedFilename = parseEpisodeFilename(row.originalFilename);
    if (parsedFilename) {
      signatures.add(
        signatureForValues(
          parsedFilename.broadcastDate,
          parsedFilename.title,
          parsedFilename.presenter,
        ),
      );
    }
  }

  return [...signatures];
}

function buildSignature(episode: MixcloudEpisodeMetadata): string {
  return signatureForValues(episode.broadcastDate, episode.title, episode.presenter);
}

function signatureForValues(broadcastDate: string, title: string, presenter: string): string {
  return [
    broadcastDate,
    condenseMetadataSegment(title),
    condenseMetadataSegment(presenter),
  ].join('|');
}

function normalizeUrl(value: string | null): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}
