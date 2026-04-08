import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const limit = vi.fn();
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy, limit }));
  const from = vi.fn(() => ({ where, orderBy, limit }));
  const select = vi.fn(() => ({ from }));

  return {
    select,
    from,
    where,
    orderBy,
    limit,
  };
});

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
  },
}));

describe('public episode routes', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.select.mockClear();
    dbMock.from.mockClear();
    dbMock.where.mockClear();
    dbMock.orderBy.mockReset();
    dbMock.limit.mockReset();
  });

  it('returns a paginated public episode archive', async () => {
    dbMock.limit.mockResolvedValue([
      {
        id: 'episode-1',
        title: 'duckfeed 1',
        presenter: 'Maddie',
        slug: 'duck-feed-1',
        artworkUrl: 'https://cdn.example.com/episode-1.jpg',
        broadcastDate: '2026-04-05',
        description: 'first',
        durationSeconds: 3600,
        mixcloudUrl: null,
        createdAt: new Date('2026-04-05T00:00:00Z'),
      },
    ]);

    const { publicEpisodeRoutes } = await import('../../src/routes/episodes.js');
    const app = Fastify();
    await app.register(publicEpisodeRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/?limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: 'episode-1',
          title: 'duckfeed 1',
          presenter: 'Maddie',
          slug: 'duck-feed-1',
          artworkUrl: 'https://cdn.example.com/episode-1.jpg',
          broadcastDate: '2026-04-05',
          description: 'first',
          durationSeconds: 3600,
          mixcloudUrl: null,
          createdAt: '2026-04-05T00:00:00.000Z',
        },
      ],
      error: null,
      meta: {
        limit: 10,
        nextCursor: null,
        hasMore: false,
      },
    });

    await app.close();
  });

  it('returns a single public episode with tracks by slug', async () => {
    dbMock.limit.mockResolvedValueOnce([
      {
        id: 'episode-1',
        title: 'duckfeed 1',
        presenter: 'Maddie',
        slug: 'duck-feed-1',
        artworkUrl: 'https://cdn.example.com/episode-1.jpg',
        broadcastDate: '2026-04-05',
        description: 'first',
        durationSeconds: 3600,
        mixcloudUrl: null,
        createdAt: new Date('2026-04-05T00:00:00Z'),
      },
    ]);
    dbMock.orderBy.mockResolvedValueOnce([
      {
        id: 'track-1',
        episodeId: 'episode-1',
        title: 'Track One',
        artist: 'Artist',
        position: 1,
      },
    ]);

    const { publicEpisodeRoutes } = await import('../../src/routes/episodes.js');
    const app = Fastify();
    await app.register(publicEpisodeRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/duck-feed-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        id: 'episode-1',
        title: 'duckfeed 1',
        presenter: 'Maddie',
        slug: 'duck-feed-1',
        artworkUrl: 'https://cdn.example.com/episode-1.jpg',
        broadcastDate: '2026-04-05',
        description: 'first',
        durationSeconds: 3600,
        mixcloudUrl: null,
        createdAt: '2026-04-05T00:00:00.000Z',
        tracks: [
          {
            id: 'track-1',
            episodeId: 'episode-1',
            title: 'Track One',
            artist: 'Artist',
            position: 1,
          },
        ],
      },
      error: null,
      meta: null,
    });

    await app.close();
  });
});
