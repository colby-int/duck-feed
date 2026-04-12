/**
 * Mixcloud Validator
 *
 * Validates episode metadata against the Duck Radio Mixcloud archive by
 * querying the public JSON API at api.mixcloud.com.
 *
 * The HTML page at mixcloud.com/duckradio/ is JS-rendered and contains no
 * episode data in the raw response — the API is the only reliable source.
 */

import { logger } from '../lib/logger.js';

const MIXCLOUD_API_BASE = 'https://api.mixcloud.com/duckradio/cloudcasts/';

interface MixcloudCloudcast {
  name: string;
  url: string;
  key: string;
}

interface MixcloudResponse {
  data: MixcloudCloudcast[];
  paging?: { next?: string };
}

/**
 * Fetch cloudcast names from the Mixcloud API, following pagination up to
 * a reasonable limit to avoid runaway requests.
 */
async function fetchCloudcastNames(maxPages = 5): Promise<string[]> {
  const names: string[] = [];
  let url: string | undefined = MIXCLOUD_API_BASE;
  let page = 0;

  while (url && page < maxPages) {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn(
        { status: response.status, url },
        'mixcloud-validator: API request failed',
      );
      break;
    }

    const body = (await response.json()) as MixcloudResponse;
    for (const item of body.data ?? []) {
      if (item.name) names.push(item.name);
    }

    url = body.paging?.next;
    page++;
  }

  return names;
}

/**
 * Normalise a title string for comparison: lowercase, collapse whitespace,
 * trim. This handles minor formatting differences (extra spaces, casing)
 * between the DB and Mixcloud without being so loose that false positives
 * slip through.
 */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract the "Show | Presenter" portion from a Mixcloud title, stripping
 * a trailing date segment if present. Mixcloud titles may have 2 or 3
 * pipe-separated parts, and dates may use 2- or 4-digit years, so matching
 * on the title+presenter portion is more reliable than full-string matching.
 */
function extractShowAndPresenter(value: string): string {
  const parts = value.split('|').map((p) => p.trim());

  // 3-part title: "Show | Presenter | Date" — check if last part looks like a date
  if (parts.length === 3 && /^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(parts[2]!)) {
    return normalise(`${parts[0]} | ${parts[1]}`);
  }

  // 2-part or anything else: use the full string
  return normalise(value);
}

/**
 * Validate that a Mixcloud-format title exists in the Duck Radio archive.
 *
 * Matching is done on the "Show | Presenter" portion only, ignoring dates.
 * Broadcast dates differ between our DB (derived from filenames) and Mixcloud
 * (set on upload), and Mixcloud inconsistently uses 2- vs 4-digit years.
 *
 * @param mixcloudTitle  Full pipe-separated title, e.g.
 *   "Under The Persimmon Tree | Erin & Romi | 15.02.2026"
 * @returns true if a match is found by show name + presenter.
 */
export async function validateMixcloudMetadata(
  mixcloudTitle: string,
): Promise<boolean> {
  try {
    const names = await fetchCloudcastNames();
    const target = extractShowAndPresenter(mixcloudTitle);
    return names.some((name) => extractShowAndPresenter(name) === target);
  } catch (err) {
    logger.warn({ err }, 'mixcloud-validator: validation failed');
    return false;
  }
}
