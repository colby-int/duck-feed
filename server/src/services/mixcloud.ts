import { runCommand } from '../lib/run-command.js';
import { config } from '../config.js';

const YTDLP_TIMEOUT_MS = 60 * 1000;

export interface MixcloudEpisodeMetadata {
  artworkUrl: string | null;
  broadcastDate: string;
  description: string | null;
  mixcloudUrl: string;
  presenter: string;
  sourceTitle: string;
  title: string;
}

interface YtDlpEpisodeJson {
  description?: unknown;
  original_url?: unknown;
  thumbnail?: unknown;
  title?: unknown;
  webpage_url?: unknown;
}

export async function discoverMixcloudEpisodes(
  userUrl = config.MIXCLOUD_USER_URL,
): Promise<MixcloudEpisodeMetadata[]> {
  const { stdout } = await runCommand(
    'yt-dlp',
    [
      '--flat-playlist',
      '--print',
      '%(webpage_url)s',
      '--retries',
      '10',
      '--retry-sleep',
      'exp=1:60',
      userUrl,
    ],
    { timeoutMs: YTDLP_TIMEOUT_MS },
  );

  const urls = stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const episodes: Array<MixcloudEpisodeMetadata | null> = [];
  for (const url of urls) {
    episodes.push(await fetchMixcloudEpisode(url));
  }
  return episodes.filter((episode): episode is MixcloudEpisodeMetadata => episode !== null);
}

export async function fetchMixcloudEpisode(
  url: string,
): Promise<MixcloudEpisodeMetadata | null> {
  const { stdout } = await runCommand(
    'yt-dlp',
    [
      '--dump-single-json',
      '--skip-download',
      '--retries',
      '10',
      '--retry-sleep',
      'exp=1:60',
      url,
    ],
    { timeoutMs: YTDLP_TIMEOUT_MS },
  );

  const parsed = JSON.parse(stdout) as YtDlpEpisodeJson;
  const rawTitle = normalizeString(parsed.title);
  const titleMetadata = parseMixcloudEpisodeTitle(rawTitle);
  if (!titleMetadata) {
    return null;
  }

  return {
    artworkUrl: normalizeString(parsed.thumbnail) || null,
    broadcastDate: titleMetadata.broadcastDate,
    description: normalizeString(parsed.description) || null,
    mixcloudUrl: normalizeString(parsed.webpage_url) || normalizeString(parsed.original_url) || url,
    presenter: titleMetadata.presenter,
    sourceTitle: titleMetadata.sourceTitle,
    title: titleMetadata.title,
  };
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
  if (!sourceTitle) {
    return null;
  }

  const parts = sourceTitle.split('|').map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return null;
  }

  const [title, presenter, rawDate] = parts;
  const broadcastDate = parseLooseBroadcastDate(rawDate);
  if (!broadcastDate) {
    return null;
  }

  return {
    broadcastDate,
    presenter,
    sourceTitle,
    title,
  };
}

export function condenseMetadataSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeString(value: unknown): string {
  return String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLooseBroadcastDate(value: string): string | null {
  const parts = value
    .trim()
    .split(/[^0-9]+/g)
    .filter(Boolean);

  if (parts.length !== 3) {
    return null;
  }

  const [rawDay, rawMonth, rawYear] = parts;
  const day = rawDay.padStart(2, '0');
  const month = rawMonth.padStart(2, '0');
  const year = normalizeYear(rawYear);

  return toIsoDate(day, month, year);
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const isoDate = `${year}-${month}-${day}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

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
  if (value.length === 4) {
    return value;
  }

  const numericYear = Number.parseInt(value, 10);
  return String(numericYear >= 70 ? 1900 + numericYear : 2000 + numericYear);
}
