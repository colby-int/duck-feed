import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandMock = vi.hoisted(() => ({
  runCommand: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
  insert: vi.fn(),
}));

vi.mock('../../src/lib/run-command.js', () => runCommandMock);

vi.mock('../../src/db/index.js', () => ({
  db: {
    insert: dbMock.insert,
  },
}));

const ORIGINAL_FETCH = global.fetch;

function fpcalcOutput(): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify({ duration: 240, fingerprint: 'AAAA-FAKE-FINGERPRINT' }),
    stderr: '',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fingerprint service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
    process.env.ACOUSTID_API_KEY = 'test-acoustid-key';

    runCommandMock.runCommand.mockReset();
    dbMock.insert.mockReset();
    global.fetch = ORIGINAL_FETCH;
  });

  it('throws FingerprintingDisabledError when ACOUSTID_API_KEY is not set', async () => {
    delete process.env.ACOUSTID_API_KEY;

    const { fingerprintFile, FingerprintingDisabledError } = await import(
      '../../src/services/fingerprint.js'
    );

    await expect(fingerprintFile('/library/some-episode.mp3')).rejects.toBeInstanceOf(
      FingerprintingDisabledError,
    );
    // fpcalc must NOT have been called when there is no API key.
    expect(runCommandMock.runCommand).not.toHaveBeenCalled();
  });

  it('runs fpcalc + AcoustID + MusicBrainz and returns enriched matches', async () => {
    runCommandMock.runCommand.mockResolvedValue(fpcalcOutput());

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('api.acoustid.org')) {
        // Regression: AcoustID lookups MUST be POST with form-encoded body —
        // fingerprints exceed URL length limits and the GET form returns 400.
        expect(init?.method).toBe('POST');
        expect(String(init?.body)).toContain('fingerprint=AAAA-FAKE-FINGERPRINT');
        expect(String(init?.body)).toContain('client=test-acoustid-key');
        return jsonResponse({
          status: 'ok',
          results: [
            {
              id: 'acoustid-1',
              score: 0.95,
              recordings: [
                {
                  id: 'mbid-recording-1',
                  title: 'AcoustID Title',
                  artists: [{ name: 'AcoustID Artist' }],
                },
              ],
            },
          ],
        });
      }
      if (urlStr.includes('musicbrainz.org')) {
        return jsonResponse({
          title: 'MusicBrainz Title',
          'artist-credit': [{ name: 'MusicBrainz Artist' }],
        });
      }
      throw new Error(`unexpected fetch url: ${urlStr}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fingerprintFile } = await import('../../src/services/fingerprint.js');
    const matches = await fingerprintFile('/library/some-episode.mp3');

    expect(runCommandMock.runCommand).toHaveBeenCalledWith(
      'fpcalc',
      ['-json', '/library/some-episode.mp3'],
      expect.any(Object),
    );
    expect(matches).toEqual([
      {
        title: 'MusicBrainz Title',
        artist: 'MusicBrainz Artist',
        acoustidScore: 0.95,
        musicbrainzId: 'mbid-recording-1',
      },
    ]);
  });

  it('filters out AcoustID candidates below the score threshold', async () => {
    runCommandMock.runCommand.mockResolvedValue(fpcalcOutput());

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('api.acoustid.org')) {
        return jsonResponse({
          status: 'ok',
          results: [
            {
              id: 'acoustid-low',
              score: 0.2, // sub-threshold
              recordings: [{ id: 'mbid-low', title: 'Should Be Skipped' }],
            },
          ],
        });
      }
      throw new Error(`MusicBrainz must not be called for sub-threshold matches: ${urlStr}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fingerprintFile } = await import('../../src/services/fingerprint.js');
    const matches = await fingerprintFile('/library/some-episode.mp3');

    expect(matches).toEqual([]);
    // Only AcoustID should have been called — MusicBrainz must be skipped.
    const mbCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('musicbrainz.org'));
    expect(mbCalls).toHaveLength(0);
  });

  it('surfaces AcoustID error message from JSON body on a 4xx response', async () => {
    runCommandMock.runCommand.mockResolvedValue(fpcalcOutput());

    const fetchMock = vi.fn(async () => {
      // AcoustID often returns 400 with a JSON error body — surface the
      // actual message instead of a generic HTTP status.
      return new Response(
        JSON.stringify({ error: { code: 4, message: 'invalid API key' }, status: 'error' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fingerprintFile } = await import('../../src/services/fingerprint.js');
    await expect(fingerprintFile('/library/some-episode.mp3')).rejects.toThrowError(
      /invalid API key/,
    );
  });

  it('falls back to AcoustID metadata when MusicBrainz lookup fails', async () => {
    runCommandMock.runCommand.mockResolvedValue(fpcalcOutput());

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('api.acoustid.org')) {
        return jsonResponse({
          status: 'ok',
          results: [
            {
              id: 'acoustid-1',
              score: 0.9,
              recordings: [
                {
                  id: 'mbid-recording-1',
                  title: 'AcoustID Title',
                  artists: [{ name: 'AcoustID Artist' }],
                },
              ],
            },
          ],
        });
      }
      if (urlStr.includes('musicbrainz.org')) {
        return new Response('upstream down', { status: 503 });
      }
      throw new Error(`unexpected fetch url: ${urlStr}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fingerprintFile } = await import('../../src/services/fingerprint.js');
    const matches = await fingerprintFile('/library/some-episode.mp3');

    expect(matches).toEqual([
      {
        title: 'AcoustID Title',
        artist: 'AcoustID Artist',
        acoustidScore: 0.9,
        musicbrainzId: 'mbid-recording-1',
      },
    ]);
  });

  it('persistFingerprintMatches inserts one track row per match with source=acoustid', async () => {
    const insertReturning = vi
      .fn()
      .mockResolvedValue([{ id: 'track-1' }, { id: 'track-2' }]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    dbMock.insert.mockReturnValue({ values: insertValues });

    const { persistFingerprintMatches } = await import('../../src/services/fingerprint.js');
    const ids = await persistFingerprintMatches('episode-1', [
      { title: 'A', artist: 'X', acoustidScore: 0.91, musicbrainzId: 'mb-a' },
      { title: 'B', artist: 'Y', acoustidScore: 0.87, musicbrainzId: 'mb-b' },
    ]);

    expect(ids).toEqual(['track-1', 'track-2']);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const rows = insertValues.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      episodeId: 'episode-1',
      title: 'A',
      artist: 'X',
      position: 1,
      source: 'acoustid',
      reviewed: false,
    });
    expect(rows[1]).toMatchObject({
      episodeId: 'episode-1',
      title: 'B',
      artist: 'Y',
      position: 2,
      source: 'acoustid',
    });
  });

  it('persistFingerprintMatches is a no-op when there are no matches', async () => {
    const { persistFingerprintMatches } = await import('../../src/services/fingerprint.js');
    const ids = await persistFingerprintMatches('episode-1', []);

    expect(ids).toEqual([]);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
