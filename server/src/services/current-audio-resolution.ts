import path from 'node:path';

import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { episodes } from '../db/schema.js';
import { parseEpisodeFilename } from '../lib/episode-filename.js';
import { slugify } from '../lib/slug.js';
import { parseMixcloudTitle } from './metadata-reconciler.js';

export interface CurrentAudioInput {
  artist: string | null;
  filePath: string | null;
  title: string | null;
}

export interface EpisodeResolutionRow {
  artworkUrl: string | null;
  broadcastDate: string | null;
  createdAt: Date;
  durationSeconds: number | null;
  filePath: string | null;
  id: string;
  mixcloudUrl: string | null;
  originalFilename: string | null;
  presenter: string | null;
  slug: string;
  title: string;
}

export interface ResolvedDisplayEpisode {
  artworkUrl: string | null;
  broadcastDate: string | null;
  id: string;
  mixcloudUrl: string | null;
  presenter: string | null;
  slug: string;
  title: string;
}

export type CurrentAudioResolutionSource =
  | 'exact_file_path'
  | 'file_basename'
  | 'original_filename'
  | 'slug_stem'
  | 'filename_metadata'
  | 'stream_tags'
  | 'synthetic_metadata'
  | 'none';

export interface CurrentAudioResolutionAlert {
  details: Record<string, unknown>;
  key: string;
  kind: 'fallback_resolved' | 'metadata_mismatch' | 'synthetic_only';
}

export interface CurrentAudioResolution {
  alert: CurrentAudioResolutionAlert | null;
  displayEpisode: ResolvedDisplayEpisode | null;
  matchedEpisode: EpisodeResolutionRow | null;
  resolutionSource: CurrentAudioResolutionSource;
}

interface DerivedMetadata {
  broadcastDate: string | null;
  presenter: string | null;
  title: string | null;
}

export async function resolveCurrentAudioEpisode(
  currentAudio: CurrentAudioInput | null,
): Promise<CurrentAudioResolution> {
  if (!currentAudio) {
    return {
      alert: null,
      displayEpisode: null,
      matchedEpisode: null,
      resolutionSource: 'none',
    };
  }

  const exactEpisode = currentAudio.filePath
    ? await getEpisodeByExactFilePath(currentAudio.filePath)
    : null;

  if (exactEpisode) {
    return resolveCurrentAudioAgainstCandidates(currentAudio, exactEpisode, []);
  }

  const readyEpisodes = await listReadyEpisodesForResolution();
  return resolveCurrentAudioAgainstCandidates(currentAudio, null, readyEpisodes);
}

export function resolveCurrentAudioAgainstCandidates(
  currentAudio: CurrentAudioInput,
  exactEpisode: EpisodeResolutionRow | null,
  fallbackEpisodes: EpisodeResolutionRow[],
): CurrentAudioResolution {
  const fileMetadata = deriveMetadataFromFilePath(currentAudio.filePath);
  const streamMetadata = deriveMetadataFromStreamTags(currentAudio.title, currentAudio.artist);

  if (exactEpisode) {
    return buildResolvedEpisode(
      currentAudio,
      exactEpisode,
      'exact_file_path',
      fileMetadata,
      streamMetadata,
    );
  }

  const fallbackMatch =
    matchByFileBasename(currentAudio.filePath, fallbackEpisodes) ??
    matchByOriginalFilename(currentAudio.filePath, fallbackEpisodes) ??
    matchBySlugStem(currentAudio.filePath, fallbackEpisodes) ??
    matchByDerivedMetadata(fileMetadata, fallbackEpisodes, 'filename_metadata') ??
    matchByDerivedMetadata(streamMetadata, fallbackEpisodes, 'stream_tags');

  if (fallbackMatch) {
    return buildResolvedEpisode(
      currentAudio,
      fallbackMatch.episode,
      fallbackMatch.source,
      fileMetadata,
      streamMetadata,
    );
  }

  const synthetic = synthesizeDisplayEpisode(currentAudio.filePath, streamMetadata, fileMetadata);
  if (synthetic) {
    return {
      alert: {
        details: {
          currentArtist: currentAudio.artist,
          currentFilePath: currentAudio.filePath,
          currentTitle: currentAudio.title,
          displayEpisode: synthetic,
        },
        key: [
          'synthetic',
          currentAudio.filePath ?? '',
          currentAudio.title ?? '',
          currentAudio.artist ?? '',
        ].join('|'),
        kind: 'synthetic_only',
      },
      displayEpisode: synthetic,
      matchedEpisode: null,
      resolutionSource: 'synthetic_metadata',
    };
  }

  return {
    alert: null,
    displayEpisode: null,
    matchedEpisode: null,
    resolutionSource: 'none',
  };
}

function buildResolvedEpisode(
  currentAudio: CurrentAudioInput,
  episode: EpisodeResolutionRow,
  resolutionSource: Exclude<CurrentAudioResolutionSource, 'synthetic_metadata' | 'none'>,
  fileMetadata: DerivedMetadata | null,
  streamMetadata: DerivedMetadata | null,
): CurrentAudioResolution {
  const mismatch = buildMismatchAlert(
    currentAudio,
    episode,
    resolutionSource,
    fileMetadata,
    streamMetadata,
  );

  return {
    alert:
      mismatch ??
      (resolutionSource === 'exact_file_path'
        ? null
        : buildFallbackAlert(currentAudio, episode, resolutionSource)),
    displayEpisode: toDisplayEpisode(episode),
    matchedEpisode: episode,
    resolutionSource,
  };
}

async function getEpisodeByExactFilePath(filePath: string): Promise<EpisodeResolutionRow | null> {
  const [episode] = await db
    .select({
      artworkUrl: episodes.artworkUrl,
      broadcastDate: episodes.broadcastDate,
      createdAt: episodes.createdAt,
      durationSeconds: episodes.durationSeconds,
      filePath: episodes.filePath,
      id: episodes.id,
      mixcloudUrl: episodes.mixcloudUrl,
      originalFilename: episodes.originalFilename,
      presenter: episodes.presenter,
      slug: episodes.slug,
      title: episodes.title,
    })
    .from(episodes)
    .where(and(eq(episodes.filePath, filePath), eq(episodes.status, 'ready')))
    .limit(1);

  return episode ?? null;
}

async function listReadyEpisodesForResolution(): Promise<EpisodeResolutionRow[]> {
  return await db
    .select({
      artworkUrl: episodes.artworkUrl,
      broadcastDate: episodes.broadcastDate,
      createdAt: episodes.createdAt,
      durationSeconds: episodes.durationSeconds,
      filePath: episodes.filePath,
      id: episodes.id,
      mixcloudUrl: episodes.mixcloudUrl,
      originalFilename: episodes.originalFilename,
      presenter: episodes.presenter,
      slug: episodes.slug,
      title: episodes.title,
    })
    .from(episodes)
    .where(eq(episodes.status, 'ready'));
}

function toDisplayEpisode(episode: EpisodeResolutionRow): ResolvedDisplayEpisode {
  return {
    artworkUrl: episode.artworkUrl,
    broadcastDate: episode.broadcastDate,
    id: episode.id,
    mixcloudUrl: episode.mixcloudUrl,
    presenter: episode.presenter,
    slug: episode.slug,
    title: episode.title,
  };
}

function deriveMetadataFromFilePath(filePath: string | null): DerivedMetadata | null {
  if (!filePath) {
    return null;
  }

  const basename = path.basename(filePath);
  const parsedOriginalStyle = parseEpisodeFilename(basename);
  if (parsedOriginalStyle) {
    return {
      broadcastDate: parsedOriginalStyle.broadcastDate,
      presenter: parsedOriginalStyle.presenter,
      title: parsedOriginalStyle.title,
    };
  }

  const stem = stripRandomSuffix(path.basename(basename, path.extname(basename)));
  if (isGenericLiveStem(stem)) {
    return null;
  }

  const datedStem = /^(?<broadcastDate>\d{4}-\d{2}-\d{2})-(?<title>.+)$/.exec(stem);
  if (datedStem?.groups) {
    return {
      broadcastDate: datedStem.groups.broadcastDate ?? null,
      presenter: null,
      title: humanizeSlug(datedStem.groups.title ?? ''),
    };
  }

  const title = humanizeSlug(stem);
  if (!title) {
    return null;
  }

  return {
    broadcastDate: null,
    presenter: null,
    title,
  };
}

function deriveMetadataFromStreamTags(
  title: string | null,
  artist: string | null,
): DerivedMetadata | null {
  const trimmedTitle = title?.trim() || '';
  const trimmedArtist = artist?.trim() || null;

  if (!trimmedTitle && !trimmedArtist) {
    return null;
  }

  if (trimmedTitle) {
    const parsed = parseMixcloudTitle(trimmedTitle);
    if (parsed) {
      return {
        broadcastDate: parsed.broadcastDate,
        presenter: parsed.presenter ?? trimmedArtist,
        title: parsed.title,
      };
    }

    const parts = trimmedTitle
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      return {
        broadcastDate: null,
        presenter: parts[1] ?? trimmedArtist,
        title: parts[0] ?? null,
      };
    }
  }

  return {
    broadcastDate: null,
    presenter: trimmedArtist,
    title: trimmedTitle || null,
  };
}

function matchByFileBasename(
  filePath: string | null,
  candidates: EpisodeResolutionRow[],
): { episode: EpisodeResolutionRow; source: 'file_basename' } | null {
  if (!filePath) {
    return null;
  }

  const basename = path.basename(filePath).toLowerCase();
  const episode = uniqueEpisodeMatch(candidates, (candidate) => {
    if (!candidate.filePath) {
      return false;
    }

    return path.basename(candidate.filePath).toLowerCase() === basename;
  });

  return episode ? { episode, source: 'file_basename' } : null;
}

function matchByOriginalFilename(
  filePath: string | null,
  candidates: EpisodeResolutionRow[],
): { episode: EpisodeResolutionRow; source: 'original_filename' } | null {
  if (!filePath) {
    return null;
  }

  const basename = path.basename(filePath).toLowerCase();
  const episode = uniqueEpisodeMatch(candidates, (candidate) => {
    return (candidate.originalFilename ?? '').toLowerCase() === basename;
  });

  return episode ? { episode, source: 'original_filename' } : null;
}

function matchBySlugStem(
  filePath: string | null,
  candidates: EpisodeResolutionRow[],
): { episode: EpisodeResolutionRow; source: 'slug_stem' } | null {
  if (!filePath) {
    return null;
  }

  const liveStem = normalizeSlugStem(path.basename(filePath, path.extname(filePath)));
  if (!liveStem) {
    return null;
  }

  const episode = uniqueEpisodeMatch(candidates, (candidate) => {
    return normalizeSlugStem(candidate.slug) === liveStem;
  });

  return episode ? { episode, source: 'slug_stem' } : null;
}

function matchByDerivedMetadata(
  metadata: DerivedMetadata | null,
  candidates: EpisodeResolutionRow[],
  source: 'filename_metadata' | 'stream_tags',
): { episode: EpisodeResolutionRow; source: 'filename_metadata' | 'stream_tags' } | null {
  if (!metadata?.title) {
    return null;
  }

  const titleMatches = candidates.filter((candidate) => {
    return condense(candidate.title) === condense(metadata.title);
  });

  if (titleMatches.length === 0) {
    return null;
  }

  const presenterMatches =
    metadata.presenter != null
      ? titleMatches.filter((candidate) => condense(candidate.presenter) === condense(metadata.presenter))
      : titleMatches;

  const dateMatches =
    metadata.broadcastDate != null
      ? presenterMatches.filter((candidate) => candidate.broadcastDate === metadata.broadcastDate)
      : presenterMatches;

  const episode = uniqueEpisodeMatch(dateMatches, () => true);
  if (!episode) {
    return null;
  }

  return { episode, source };
}

function synthesizeDisplayEpisode(
  filePath: string | null,
  streamMetadata: DerivedMetadata | null,
  fileMetadata: DerivedMetadata | null,
): ResolvedDisplayEpisode | null {
  const metadata = streamMetadata ?? fileMetadata;
  if (!metadata?.title) {
    return null;
  }

  const slugSeed = [metadata.title, metadata.presenter ?? '', metadata.broadcastDate ?? '']
    .filter(Boolean)
    .join(' ');
  const slug = slugify(slugSeed) || slugify(filePath ?? '') || 'live';

  return {
    artworkUrl: null,
    broadcastDate: metadata.broadcastDate,
    id: `synthetic:${slug}`,
    mixcloudUrl: null,
    presenter: metadata.presenter,
    slug,
    title: metadata.title,
  };
}

function buildMismatchAlert(
  currentAudio: CurrentAudioInput,
  resolvedEpisode: EpisodeResolutionRow,
  resolutionSource: Exclude<CurrentAudioResolutionSource, 'synthetic_metadata' | 'none'>,
  fileMetadata: DerivedMetadata | null,
  streamMetadata: DerivedMetadata | null,
): CurrentAudioResolutionAlert | null {
  const mismatches: string[] = [];

  if (metadataConflictsWithEpisode(fileMetadata, resolvedEpisode)) {
    mismatches.push('filename');
  }

  if (metadataConflictsWithEpisode(streamMetadata, resolvedEpisode)) {
    mismatches.push('stream_tags');
  }

  if (mismatches.length === 0) {
    return null;
  }

  return {
    details: {
      currentArtist: currentAudio.artist,
      currentFilePath: currentAudio.filePath,
      currentTitle: currentAudio.title,
      mismatchSources: mismatches,
      fileMetadata,
      resolutionSource,
      resolvedEpisodeId: resolvedEpisode.id,
      streamMetadata,
    },
    key: [
      'mismatch',
      resolvedEpisode.id,
      resolutionSource,
      currentAudio.filePath ?? '',
      currentAudio.title ?? '',
      currentAudio.artist ?? '',
      mismatches.join(','),
    ].join('|'),
    kind: 'metadata_mismatch',
  };
}

function buildFallbackAlert(
  currentAudio: CurrentAudioInput,
  episode: EpisodeResolutionRow,
  resolutionSource: Exclude<CurrentAudioResolutionSource, 'exact_file_path' | 'synthetic_metadata' | 'none'>,
): CurrentAudioResolutionAlert {
  return {
    details: {
      currentArtist: currentAudio.artist,
      currentFilePath: currentAudio.filePath,
      currentTitle: currentAudio.title,
      matchedEpisodeId: episode.id,
      resolutionSource,
    },
    key: [
      'fallback',
      resolutionSource,
      episode.id,
      currentAudio.filePath ?? '',
      currentAudio.title ?? '',
      currentAudio.artist ?? '',
    ].join('|'),
    kind: 'fallback_resolved',
  };
}

function metadataConflictsWithEpisode(
  metadata: DerivedMetadata | null,
  episode: EpisodeResolutionRow,
): boolean {
  if (!metadata?.title) {
    return false;
  }

  if (condense(episode.title) !== condense(metadata.title)) {
    return true;
  }

  if (metadata.presenter != null && condense(episode.presenter) !== condense(metadata.presenter)) {
    return true;
  }

  if (metadata.broadcastDate != null && episode.broadcastDate !== metadata.broadcastDate) {
    return true;
  }

  return false;
}

function uniqueEpisodeMatch(
  candidates: EpisodeResolutionRow[],
  predicate: (episode: EpisodeResolutionRow) => boolean,
): EpisodeResolutionRow | null {
  const matches = candidates.filter(predicate);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function normalizeSlugStem(value: string | null | undefined): string {
  const trimmed = stripRandomSuffix(String(value ?? '').trim());
  return condense(trimmed);
}

function isGenericLiveStem(value: string): boolean {
  return ['current', 'live', 'now-playing', 'now_playing', 'output', 'radio', 'stream'].includes(
    condense(value),
  );
}

function stripRandomSuffix(value: string): string {
  return value.replace(/-[a-f0-9]{6}$/i, '');
}

function humanizeSlug(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const words = trimmed
    .split(/[-_]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return null;
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function condense(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
