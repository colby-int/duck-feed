import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const limit = vi.fn();
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  return { select, from, innerJoin, where, orderBy, limit };
});

vi.mock('../../../src/db/index.js', () => ({
  db: { select: dbMock.select },
}));

describe('admin playback routes', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';

    dbMock.select.mockClear();
    dbMock.from.mockClear();
    dbMock.innerJoin.mockClear();
    dbMock.where.mockClear();
    dbMock.orderBy.mockClear();
    dbMock.limit.mockReset();
  });

  it('returns paginated playback log entries with episode metadata', async () => {
    dbMock.limit.mockResolvedValue([
      {
        id: 'log-1',
        startedAt: new Date('2026-04-07T01:00:00Z'),
        endedAt: new Date('2026-04-07T02:00:00Z'),
        episodeId: 'episode-a',
        episodeTitle: 'Episode A',
        episodeSlug: 'episode-a',
      },
    ]);

    const { adminPlaybackRoutes } = await import('../../../src/routes/admin/playback.js');
    const app = Fastify();
    await app.register(adminPlaybackRoutes);

    const response = await app.inject({ method: 'GET', url: '/log?limit=20' });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      id: 'log-1',
      episodeId: 'episode-a',
      episodeTitle: 'Episode A',
    });
    expect(json.meta).toMatchObject({ limit: 20, hasMore: false });

    await app.close();
  });

  it('reports hasMore and emits a nextCursor when limit + 1 rows are returned', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `log-${i}`,
      startedAt: new Date(`2026-04-07T0${i + 1}:00:00Z`),
      endedAt: null,
      episodeId: `episode-${i}`,
      episodeTitle: `Episode ${i}`,
      episodeSlug: `episode-${i}`,
    }));
    dbMock.limit.mockResolvedValue(rows);

    const { adminPlaybackRoutes } = await import('../../../src/routes/admin/playback.js');
    const app = Fastify();
    await app.register(adminPlaybackRoutes);

    const response = await app.inject({ method: 'GET', url: '/log?limit=2' });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data).toHaveLength(2);
    expect(json.meta.hasMore).toBe(true);
    expect(typeof json.meta.nextCursor).toBe('string');

    await app.close();
  });
});
