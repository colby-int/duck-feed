import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

const liveCurrentAudioMock = vi.hoisted(() => ({
  resolveLiveCurrentAudio: vi.fn(),
}));

const icecastMock = vi.hoisted(() => ({
  fetchCurrentListenerCount: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
    insert: dbMock.insert,
  },
}));

vi.mock('../../src/services/live-current-audio.js', () => liveCurrentAudioMock);
vi.mock('../../src/services/icecast.js', () => icecastMock);
vi.mock('../../src/lib/logger.js', () => ({
  logger: loggerMock,
}));

describe('playback-log writer', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';

    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.insert.mockReset();
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockReset();
    icecastMock.fetchCurrentListenerCount.mockReset();
    icecastMock.fetchCurrentListenerCount.mockResolvedValue(0);
    loggerMock.error.mockReset();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
  });

  function mockOpenRowLookup(
    openRow:
      | {
          id: string;
          episodeId: string;
          listenerPeak?: number | null;
          listenerSamples?: number | null;
          listenerTotal?: number | null;
        }
      | null,
  ) {
    const limit = vi.fn().mockResolvedValue(openRow ? [openRow] : []);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    return { from };
  }

  function mockUpdate(): { whereSpy: ReturnType<typeof vi.fn> } {
    const whereSpy = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: whereSpy }));
    dbMock.update.mockReturnValue({ set });
    return { whereSpy };
  }

  function mockInsert(): { valuesSpy: ReturnType<typeof vi.fn> } {
    const valuesSpy = vi.fn().mockResolvedValue(undefined);
    dbMock.insert.mockReturnValue({ values: valuesSpy });
    return { valuesSpy };
  }

  it('does nothing when the open row already represents the current episode', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: {
          artworkUrl: null,
          broadcastDate: null,
          id: 'episode-a',
          mixcloudUrl: null,
          presenter: null,
          slug: 'episode-a',
          title: 'Episode A',
        },
        matchedEpisode: { id: 'episode-a' },
        resolutionSource: 'exact_file_path',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: {
          requestId: '1',
          filePath: '/library/episode-a.mp3',
        },
        online: true,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(
      mockOpenRowLookup({
        id: 'log-1',
        episodeId: 'episode-a',
        listenerPeak: 2,
        listenerSamples: 1,
        listenerTotal: 2,
      }),
    );

    icecastMock.fetchCurrentListenerCount.mockResolvedValue(3);

    const { whereSpy } = mockUpdate();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await tickPlaybackLog(new Date('2026-04-07T00:00:00Z'));

    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('inserts a new row when there is no open row and a known file is playing', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: {
          artworkUrl: null,
          broadcastDate: null,
          id: 'episode-a',
          mixcloudUrl: null,
          presenter: null,
          slug: 'episode-a',
          title: 'Episode A',
        },
        matchedEpisode: { id: 'episode-a' },
        resolutionSource: 'exact_file_path',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: {
          requestId: '1',
          filePath: '/library/episode-a.mp3',
        },
        online: true,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup(null));

    const { valuesSpy } = mockInsert();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    const now = new Date('2026-04-07T00:00:00Z');
    await tickPlaybackLog(now);

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(valuesSpy).toHaveBeenCalledWith({ episodeId: 'episode-a', startedAt: now });
  });

  it('closes prior open row and inserts new row on transition between episodes', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: {
          artworkUrl: null,
          broadcastDate: null,
          id: 'episode-b',
          mixcloudUrl: null,
          presenter: null,
          slug: 'episode-b',
          title: 'Episode B',
        },
        matchedEpisode: { id: 'episode-b' },
        resolutionSource: 'exact_file_path',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: {
          requestId: '2',
          filePath: '/library/episode-b.mp3',
        },
        online: true,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup({ id: 'log-1', episodeId: 'episode-a' }));

    const { whereSpy } = mockUpdate();
    const { valuesSpy } = mockInsert();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    const now = new Date('2026-04-07T00:05:00Z');
    await tickPlaybackLog(now);

    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(valuesSpy).toHaveBeenCalledWith({ episodeId: 'episode-b', startedAt: now });
  });

  it('closes prior open row without inserting when current file is unknown', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: null,
        matchedEpisode: null,
        resolutionSource: 'none',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: {
          requestId: '3',
          filePath: '/library/test-tone.mp3',
        },
        online: true,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup({ id: 'log-1', episodeId: 'episode-a' }));

    const { whereSpy } = mockUpdate();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await tickPlaybackLog(new Date('2026-04-07T00:10:00Z'));

    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('logs a warning when fallback recovery is used for the live audio', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: {
          details: {
            matchedEpisodeId: 'episode-heuristic',
            resolutionSource: 'stream_tags',
          },
          key: 'fallback|stream_tags|episode-heuristic',
          kind: 'fallback_resolved',
        },
        displayEpisode: {
          artworkUrl: null,
          broadcastDate: '2026-02-08',
          id: 'episode-heuristic',
          mixcloudUrl: null,
          presenter: 'Strict Face',
          slug: '2026-02-08-heuristic-778879',
          title: 'Heuristic',
        },
        matchedEpisode: { id: 'episode-heuristic' },
        resolutionSource: 'stream_tags',
      },
      selfHealed: true,
      snapshot: {
        checkedAt: '2026-04-12T01:00:01.000Z',
        currentRequest: {
          artist: 'Strict Face',
          requestId: null,
          filePath: '/library/live.mp3',
          title: 'Heuristic | Strict Face',
        },
        online: true,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup(null));

    const { valuesSpy } = mockInsert();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    const now = new Date('2026-04-07T00:00:00Z');
    await tickPlaybackLog(now);

    expect(valuesSpy).toHaveBeenCalledWith({ episodeId: 'episode-heuristic', startedAt: now });
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when liquidsoap is silent and there is no open row', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: null,
        matchedEpisode: null,
        resolutionSource: 'none',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: null,
        online: true,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup(null));

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await tickPlaybackLog(new Date());

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('swallows liquidsoap errors so the poller never crashes the API server', async () => {
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: null,
        matchedEpisode: null,
        resolutionSource: 'none',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: null,
        online: false,
        queue: [],
        remainingSeconds: null,
      },
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup(null));

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await expect(tickPlaybackLog(new Date())).resolves.toBeUndefined();

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
