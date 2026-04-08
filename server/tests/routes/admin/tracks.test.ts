import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    select,
    from,
    where,
    limit,
    insert,
    insertValues,
    insertReturning,
  };
});

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
    insert: dbMock.insert,
  },
}));

describe('admin track routes', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.select.mockClear();
    dbMock.from.mockClear();
    dbMock.where.mockClear();
    dbMock.limit.mockReset();
    dbMock.insert.mockClear();
    dbMock.insertValues.mockClear();
    dbMock.insertReturning.mockReset();

    dbMock.limit.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Episode 1',
        slug: 'episode-1',
      },
    ]);
    dbMock.insertReturning.mockResolvedValue([
      {
        id: 'track-1',
        episodeId: '11111111-1111-4111-8111-111111111111',
        title: 'Track One',
        artist: 'Artist',
        position: 1,
        reviewed: false,
      },
    ]);
  });

  it('creates a track scoped to the episode in the route params', async () => {
    const { adminTrackRoutes } = await import('../../../src/routes/admin/tracks.js');
    const app = Fastify();
    await app.register(adminTrackRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/11111111-1111-4111-8111-111111111111/tracks',
      payload: {
        title: 'Track One',
        artist: 'Artist',
        position: 1,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(dbMock.insertValues).toHaveBeenCalledWith({
      episodeId: '11111111-1111-4111-8111-111111111111',
      title: 'Track One',
      artist: 'Artist',
      position: 1,
      source: 'manual',
      reviewed: false,
    });
    expect(response.json()).toEqual({
      data: {
        id: 'track-1',
        episodeId: '11111111-1111-4111-8111-111111111111',
        title: 'Track One',
        artist: 'Artist',
        position: 1,
        reviewed: false,
      },
      error: null,
      meta: null,
    });

    await app.close();
  });
});
