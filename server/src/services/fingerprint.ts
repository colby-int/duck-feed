// AcoustID + MusicBrainz fingerprinting service.
//
// Pipeline for a single audio file:
//   1. fpcalc -json file.mp3        → fingerprint + duration
//   2. AcoustID /v2/lookup           → list of (score, recordings[]) candidates
//   3. For each candidate above the score threshold, optionally enrich the
//      first MusicBrainz recording with title/artist (rate limited 1 req/sec).
//
// Failure model:
//   - If ACOUSTID_API_KEY is not set, throws FingerprintingDisabledError. Callers
//     should treat that as a soft skip and not fail the surrounding operation.
//   - Network errors / non-2xx responses throw a regular Error. Callers in the
//     ingest pipeline catch these so fingerprinting never fails an ingest.
//
// Limitations: AcoustID matches whole-file fingerprints. For long DJ mixes the
// best you can hope for is that the mix itself happens to be a known recording,
// which is rare. Chunked fingerprinting (slice the file into 30s windows and
// look each up) is the path forward for mix detection — not implemented yet.

import { runCommand } from '../lib/run-command.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { tracks } from '../db/schema.js';

const ACOUSTID_BASE = 'https://api.acoustid.org/v2/lookup';
const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2/recording';
const MUSICBRAINZ_USER_AGENT = `DuckFeed/0.1 (${config.MUSICBRAINZ_CONTACT_URL})`;

const MIN_ACOUSTID_SCORE = 0.5;
const HTTP_TIMEOUT_MS = 10_000;
const FPCALC_TIMEOUT_MS = 5 * 60_000; // long files take a while
// MusicBrainz mandates 1 req/sec per User-Agent. Add a small buffer.
const MUSICBRAINZ_DELAY_MS = 1_100;

export class FingerprintingDisabledError extends Error {
  constructor() {
    super('AcoustID API key not configured');
    this.name = 'FingerprintingDisabledError';
  }
}

export interface FingerprintMatch {
  title: string | null;
  artist: string | null;
  acoustidScore: number;
  musicbrainzId: string | null;
}

interface FpcalcOutput {
  duration: number;
  fingerprint: string;
}

interface AcoustIdRecording {
  id: string;
  title?: string;
  artists?: { name: string }[];
}

interface AcoustIdResult {
  id: string;
  score: number;
  recordings?: AcoustIdRecording[];
}

interface AcoustIdResponse {
  status: string;
  results?: AcoustIdResult[];
  error?: { message: string };
}

interface MusicBrainzRecording {
  title?: string;
  'artist-credit'?: { name: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFpcalc(filePath: string): Promise<FpcalcOutput> {
  const { stdout } = await runCommand('fpcalc', ['-json', filePath], {
    timeoutMs: FPCALC_TIMEOUT_MS,
  });
  let parsed: FpcalcOutput;
  try {
    parsed = JSON.parse(stdout) as FpcalcOutput;
  } catch (err) {
    throw new Error(`fpcalc returned non-JSON output: ${(err as Error).message}`);
  }
  if (typeof parsed.duration !== 'number' || typeof parsed.fingerprint !== 'string') {
    throw new Error('fpcalc returned unexpected JSON shape (missing duration or fingerprint)');
  }
  return parsed;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupAcoustId(
  fingerprint: string,
  duration: number,
): Promise<AcoustIdResult[]> {
  const apiKey = config.ACOUSTID_API_KEY;
  if (!apiKey) throw new FingerprintingDisabledError();

  // POST with form-encoded body — fingerprints are too long for a GET URL
  // (typical fingerprint is 2–8 KB; some servers/CDNs reject URLs over ~2 KB).
  // AcoustID's official guidance is to POST when the fingerprint is large.
  const body = new URLSearchParams({
    format: 'json',
    client: apiKey,
    meta: 'recordings',
    fingerprint,
    duration: Math.round(duration).toString(),
  });

  // AcoustID returns useful JSON error bodies even on 4xx (e.g. "invalid API
  // key"). Read the body first and surface AcoustID's own message before
  // falling back to a generic HTTP error.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let json: AcoustIdResponse;
  try {
    const response = await fetch(ACOUSTID_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    const text = await response.text();
    try {
      json = JSON.parse(text) as AcoustIdResponse;
    } catch {
      throw new Error(`AcoustID returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }

  if (json.status !== 'ok') {
    throw new Error(
      `AcoustID lookup failed: ${json.error?.message ?? 'unknown error'} (status: ${json.status})`,
    );
  }
  return json.results ?? [];
}

async function lookupMusicBrainzRecording(
  mbid: string,
): Promise<{ title?: string; artist?: string } | null> {
  try {
    const json = await fetchJson<MusicBrainzRecording>(
      `${MUSICBRAINZ_BASE}/${mbid}?fmt=json&inc=artists`,
      { headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT } },
    );
    return {
      title: json.title,
      artist: json['artist-credit']?.[0]?.name,
    };
  } catch (err) {
    // MusicBrainz enrichment is best-effort; never let it bring down a fingerprint scan.
    logger.warn({ err, mbid }, 'fingerprint: MusicBrainz lookup failed');
    return null;
  }
}

/**
 * Run the full fingerprint → AcoustID → MusicBrainz pipeline for a single file.
 *
 * Throws FingerprintingDisabledError if no API key is configured.
 * Throws on fpcalc failure or AcoustID network/protocol errors.
 */
export async function fingerprintFile(filePath: string): Promise<FingerprintMatch[]> {
  if (!config.ACOUSTID_API_KEY) {
    throw new FingerprintingDisabledError();
  }

  logger.info({ filePath }, 'fingerprint: running fpcalc');
  const { fingerprint, duration } = await runFpcalc(filePath);
  logger.info({ filePath, duration }, 'fingerprint: fpcalc complete');

  logger.info({ filePath }, 'fingerprint: querying AcoustID');
  const results = await lookupAcoustId(fingerprint, duration);
  logger.info({ filePath, candidateCount: results.length }, 'fingerprint: AcoustID returned');

  const matches: FingerprintMatch[] = [];
  let needsMbDelay = false;

  for (const result of results) {
    if (result.score < MIN_ACOUSTID_SCORE) continue;
    const recording = result.recordings?.[0];
    if (!recording?.id) continue;

    if (needsMbDelay) await sleep(MUSICBRAINZ_DELAY_MS);
    needsMbDelay = true;

    const mb = await lookupMusicBrainzRecording(recording.id);
    matches.push({
      title: mb?.title ?? recording.title ?? null,
      artist: mb?.artist ?? recording.artists?.[0]?.name ?? null,
      acoustidScore: result.score,
      musicbrainzId: recording.id,
    });
  }

  logger.info({ filePath, matchCount: matches.length }, 'fingerprint: pipeline complete');
  return matches;
}

/**
 * Persist fingerprint matches as track rows for an episode.
 *
 * Sets `source='acoustid'`, `reviewed=false`. Position is assigned in the
 * order matches are returned (AcoustID's confidence-sorted order).
 */
export async function persistFingerprintMatches(
  episodeId: string,
  matches: FingerprintMatch[],
): Promise<string[]> {
  if (matches.length === 0) return [];

  const rows = matches.map((m, idx) => ({
    episodeId,
    title: m.title,
    artist: m.artist,
    position: idx + 1,
    source: 'acoustid' as const,
    acoustidScore: m.acoustidScore,
    musicbrainzId: m.musicbrainzId,
    reviewed: false,
  }));

  const inserted = await db.insert(tracks).values(rows).returning({ id: tracks.id });
  return inserted.map((r) => r.id);
}

export function isFingerprintingEnabled(): boolean {
  return Boolean(config.ACOUSTID_API_KEY);
}
