/**
 * Mixcloud integration — discovery and metadata fetching via the public
 * JSON API (api.mixcloud.com).
 *
 * Replaces the previous yt-dlp-based approach which spawned one subprocess
 * per episode (987+ on the Duck Radio archive), overwhelming a t3.small.
 * The JSON API returns paginated results with a single HTTP request per page.
 */

import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MixcloudEpisodeMetadata {
  artworkUrl: string | null;
  broadcastDate: string;
  description: string | null;
  mixcloudUrl: string;
  presenter: string;
  sourceTitle: string;
  title: string;
}

interface MixcloudApiCloudcast {
  key?: string;
  name?: string;
  url?: string;
  pictures?: Record<string, string>;
  audio_length?: number;
  description?: string;
}

interface MixcloudApiResponse {
  data?: MixcloudApiCloudcast[];
  paging?: { next?: string };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Max pages to fetch during discovery (100 per page = up to 10,000 episodes). */
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

/** Small delay between paginated requests to avoid hammering the API. */
const PAGE_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all episodes from the Duck Radio Mixcloud archive via the JSON API.
 * Paginates automatically and returns parsed metadata for every cloudcast
 * whose title matches the "Show | Presenter | Date" format.
 */
export async function discoverMixcloudEpisodes(
  userUrl = config.MIXCLOUD_USER_URL,
): Promise<MixcloudEpisodeMetadata[]> {
  const username = extractUsername(userUrl);
  if (!username) {
    logger.warn({ userUrl }, 'mixcloud: could not extract username from URL');
    return [];
  }

  const episodes: MixcloudEpisodeMetadata[] = [];
  let nextUrl: string | undefined =
    `https://api.mixcloud.com/${username}/cloudcasts/?limit=${PAGE_SIZE}`;
  let page = 0;

  while (nextUrl && page < MAX_PAGES) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      logger.warn(
        { status: response.status, url: nextUrl },
        'mixcloud: API page request failed',
      );
      break;
    }

    const body = (await response.json()) as MixcloudApiResponse;
    for (const item of body.data ?? []) {
      const parsed = cloudcastToMetadata(item);
      if (parsed) episodes.push(parsed);
    }

    // Stop early if this page had no data (end of archive).
    if (!body.data?.length) break;

    nextUrl = body.paging?.next;
    page++;

    // Throttle between pages — be a good API citizen on a t3.small.
    if (nextUrl) await delay(PAGE_DELAY_MS);
  }

  logger.info(
    { total: episodes.length, pages: page },
    'mixcloud: discovery complete',
  );
  return episodes;
}

/**
 * Fetch metadata for a single Mixcloud episode by its URL.
 * Uses the JSON API (replaces yt-dlp --dump-single-json).
 */
export async function fetchMixcloudEpisode(
  episodeUrl: string,
): Promise<MixcloudEpisodeMetadata | null> {
  const apiUrl = mixcloudUrlToApiUrl(episodeUrl);
  if (!apiUrl) {
    logger.warn({ episodeUrl }, 'mixcloud: could not derive API URL');
    return null;
  }

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      logger.warn(
        { status: response.status, apiUrl },
        'mixcloud: single-episode API request failed',
      );
      return null;
    }

    const item = (await response.json()) as MixcloudApiCloudcast;
    return cloudcastToMetadata(item);
  } catch (err) {
    logger.warn({ err, episodeUrl }, 'mixcloud: failed to fetch episode');
    return null;
  }
}

export function parseMixcloudEpisodeTitle(
  value: string,
): {
  broadcastDate: string;
  presenter: string;
  sourceTitle: string;
  title: string;
} | null {
  const sourceTitle = value.trim();
  if (!sourceTitle) return null;

  const parts = sourceTitle.split('|').map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) return null;

  const [title, presenter, rawDate] = parts;
  const broadcastDate = parseLooseBroadcastDate(rawDate!);
  if (!broadcastDate) return null;

  return { broadcastDate, presenter: presenter!, sourceTitle, title: title! };
}

export function condenseMetadataSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloudcastToMetadata(
  item: MixcloudApiCloudcast,
): MixcloudEpisodeMetadata | null {
  const rawTitle = (item.name ?? '').trim();
  const titleMetadata = parseMixcloudEpisodeTitle(rawTitle);
  if (!titleMetadata) return null;

  // Pick the largest available artwork.
  const artworkUrl =
    item.pictures?.['1024wx1024h'] ??
    item.pictures?.extra_large ??
    item.pictures?.large ??
    null;

  return {
    artworkUrl,
    broadcastDate: titleMetadata.broadcastDate,
    description: (item.description ?? '').trim() || null,
    mixcloudUrl: item.url ?? '',
    presenter: titleMetadata.presenter,
    sourceTitle: titleMetadata.sourceTitle,
    title: titleMetadata.title,
  };
}

/** Extract username from "https://www.mixcloud.com/duckradio/" */
function extractUsername(userUrl: string): string | null {
  const match = userUrl.match(/mixcloud\.com\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/** Convert "https://www.mixcloud.com/duckradio/episode/" → "https://api.mixcloud.com/duckradio/episode/" */
function mixcloudUrlToApiUrl(url: string): string | null {
  const path = url.match(/mixcloud\.com(\/[^?#]+)/)?.[1];
  return path ? `https://api.mixcloud.com${path}` : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLooseBroadcastDate(value: string): string | null {
  const parts = value
    .trim()
    .split(/[^0-9]+/g)
    .filter(Boolean);

  if (parts.length !== 3) return null;

  const [rawDay, rawMonth, rawYear] = parts;
  const day = rawDay!.padStart(2, '0');
  const month = rawMonth!.padStart(2, '0');
  const year = normalizeYear(rawYear!);

  return toIsoDate(day, month, year);
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const isoDate = `${year}-${month}-${day}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return isoDate;
}

function normalizeYear(value: string): string {
  if (value.length === 4) return value;
  const n = Number.parseInt(value, 10);
  return String(n >= 70 ? 1900 + n : 2000 + n);
}
