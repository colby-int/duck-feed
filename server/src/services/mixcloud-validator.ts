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
 * Validate that a Mixcloud-format title exists in the Duck Radio archive.
 *
 * @param mixcloudTitle  Full pipe-separated title, e.g.
 *   "Under The Persimmon Tree | Erin & Romi | 15.02.2026"
 * @returns true if an exact (normalised) match is found.
 */
export async function validateMixcloudMetadata(
  mixcloudTitle: string,
): Promise<boolean> {
  try {
    const names = await fetchCloudcastNames();
    const target = normalise(mixcloudTitle);
    return names.some((name) => normalise(name) === target);
  } catch (err) {
    logger.warn({ err }, 'mixcloud-validator: validation failed');
    return false;
  }
}
