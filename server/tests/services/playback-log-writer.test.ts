import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

const liquidsoapMock = vi.hoisted(() => ({
  getStreamSnapshot: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
    insert: dbMock.insert,
  },
}));

vi.mock('../../src/services/stream-poller.js', () => liquidsoapMock);

describe('playback-log writer', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';

    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.insert.mockReset();
    liquidsoapMock.getStreamSnapshot.mockReset();
  });

  function mockEpisodeLookup(episode: { id: string } | null) {
    const limit = vi.fn().mockResolvedValue(episode ? [episode] : []);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    return { from };
  }

  function mockOpenRowLookup(openRow: { id: string; episodeId: string } | null) {
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
    liquidsoapMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: {
        requestId: '1',
        filePath: '/library/episode-a.mp3',
      },
      online: true,
      queue: [],
      remainingSeconds: null,
    });

    dbMock.select
      .mockReturnValueOnce(mockEpisodeLookup({ id: 'episode-a' })) // file → episode
      .mockReturnValueOnce(mockOpenRowLookup({ id: 'log-1', episodeId: 'episode-a' })); // open row

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await tickPlaybackLog(new Date('2026-04-07T00:00:00Z'));

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('inserts a new row when there is no open row and a known file is playing', async () => {
    liquidsoapMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: {
        requestId: '1',
        filePath: '/library/episode-a.mp3',
      },
      online: true,
      queue: [],
      remainingSeconds: null,
    });

    dbMock.select
      .mockReturnValueOnce(mockEpisodeLookup({ id: 'episode-a' }))
      .mockReturnValueOnce(mockOpenRowLookup(null));

    const { valuesSpy } = mockInsert();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    const now = new Date('2026-04-07T00:00:00Z');
    await tickPlaybackLog(now);

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(valuesSpy).toHaveBeenCalledWith({ episodeId: 'episode-a', startedAt: now });
  });

  it('closes prior open row and inserts new row on transition between episodes', async () => {
    liquidsoapMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: {
        requestId: '2',
        filePath: '/library/episode-b.mp3',
      },
      online: true,
      queue: [],
      remainingSeconds: null,
    });

    dbMock.select
      .mockReturnValueOnce(mockEpisodeLookup({ id: 'episode-b' }))
      .mockReturnValueOnce(mockOpenRowLookup({ id: 'log-1', episodeId: 'episode-a' }));

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
    liquidsoapMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: {
        requestId: '3',
        filePath: '/library/test-tone.mp3',
      },
      online: true,
      queue: [],
      remainingSeconds: null,
    });

    dbMock.select
      .mockReturnValueOnce(mockEpisodeLookup(null)) // unknown file
      .mockReturnValueOnce(mockOpenRowLookup({ id: 'log-1', episodeId: 'episode-a' }));

    const { whereSpy } = mockUpdate();

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await tickPlaybackLog(new Date('2026-04-07T00:10:00Z'));

    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('does nothing when liquidsoap is silent and there is no open row', async () => {
    liquidsoapMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: null,
      online: true,
      queue: [],
      remainingSeconds: null,
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup(null));

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await tickPlaybackLog(new Date());

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('swallows liquidsoap errors so the poller never crashes the API server', async () => {
    liquidsoapMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: null,
      online: false,
      queue: [],
      remainingSeconds: null,
    });

    dbMock.select.mockReturnValueOnce(mockOpenRowLookup(null));

    const { tickPlaybackLog } = await import('../../src/services/playback-log-writer.js');
    await expect(tickPlaybackLog(new Date())).resolves.toBeUndefined();

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
