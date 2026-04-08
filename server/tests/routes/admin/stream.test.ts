import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { select, from, where, limit };
});

const liquidsoapMock = vi.hoisted(() => ({
  getQueue: vi.fn(),
  pushQueue: vi.fn(),
  skipCurrentTrack: vi.fn(),
  getCurrentRequest: vi.fn(),
}));

const streamApiKeysMock = vi.hoisted(() => ({
  listStreamApiKeys: vi.fn(),
  createStreamApiKey: vi.fn(),
  revokeStreamApiKey: vi.fn(),
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
  },
}));

vi.mock('../../../src/services/liquidsoap.js', () => liquidsoapMock);
vi.mock('../../../src/services/stream-api-keys.js', () => streamApiKeysMock);

describe('admin stream routes', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.select.mockClear();
    dbMock.from.mockClear();
    dbMock.where.mockClear();
    dbMock.limit.mockReset();
    liquidsoapMock.getQueue.mockReset();
    liquidsoapMock.pushQueue.mockReset();
    liquidsoapMock.skipCurrentTrack.mockReset();
    liquidsoapMock.getCurrentRequest.mockReset();
    streamApiKeysMock.listStreamApiKeys.mockReset();
    streamApiKeysMock.createStreamApiKey.mockReset();
    streamApiKeysMock.revokeStreamApiKey.mockReset();

    dbMock.limit.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Episode 1',
        slug: 'episode-1',
        filePath: '/var/lib/duckfeed/library/episode-1.mp3',
        status: 'ready',
      },
    ]);
    liquidsoapMock.pushQueue.mockResolvedValue({
      requestId: '1',
      raw: ['1'],
    });
    streamApiKeysMock.listStreamApiKeys.mockResolvedValue([
      {
        id: 'key-1',
        keyPrefix: 'dfs_abc123',
        label: 'Main site',
        createdAt: '2026-04-08T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    streamApiKeysMock.createStreamApiKey.mockResolvedValue({
      key: 'dfs_secret_value',
      record: {
        id: 'key-2',
        keyPrefix: 'dfs_def456',
        label: 'Companion app',
        createdAt: '2026-04-08T01:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    });
    streamApiKeysMock.revokeStreamApiKey.mockResolvedValue({
      id: 'key-1',
      keyPrefix: 'dfs_abc123',
      label: 'Main site',
      createdAt: '2026-04-08T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: '2026-04-08T02:00:00.000Z',
    });
  });

  it('restarts the currently playing episode by re-queuing and skipping', async () => {
    liquidsoapMock.getCurrentRequest.mockResolvedValue({
      requestId: '7',
      filePath: '/var/lib/duckfeed/library/episode-1.mp3',
    });
    liquidsoapMock.skipCurrentTrack.mockResolvedValue({ raw: ['Done'] });

    const { adminStreamRoutes } = await import('../../../src/routes/admin/stream.js');
    const app = Fastify();
    await app.register(adminStreamRoutes);

    const response = await app.inject({ method: 'POST', url: '/restart-current' });

    expect(response.statusCode).toBe(200);
    expect(liquidsoapMock.getCurrentRequest).toHaveBeenCalledTimes(1);
    expect(liquidsoapMock.pushQueue).toHaveBeenCalledWith('/var/lib/duckfeed/library/episode-1.mp3');
    expect(liquidsoapMock.skipCurrentTrack).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({
      data: {
        restartedFilePath: '/var/lib/duckfeed/library/episode-1.mp3',
        requestId: '1',
        push: ['1'],
        skip: ['Done'],
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('rejects restart when nothing is currently playing', async () => {
    liquidsoapMock.getCurrentRequest.mockResolvedValue(null);

    const { adminStreamRoutes } = await import('../../../src/routes/admin/stream.js');
    const app = Fastify();
    await app.register(adminStreamRoutes);

    const response = await app.inject({ method: 'POST', url: '/restart-current' });

    expect(response.statusCode).toBe(409);
    expect(liquidsoapMock.pushQueue).not.toHaveBeenCalled();
    expect(liquidsoapMock.skipCurrentTrack).not.toHaveBeenCalled();

    await app.close();
  });

  it('queues a ready episode file in Liquidsoap', async () => {
    const { adminStreamRoutes } = await import('../../../src/routes/admin/stream.js');
    const app = Fastify();
    await app.register(adminStreamRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/queue',
      payload: { episodeId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(response.statusCode).toBe(200);
    expect(liquidsoapMock.pushQueue).toHaveBeenCalledWith('/var/lib/duckfeed/library/episode-1.mp3');
    expect(response.json()).toEqual({
      data: {
        requestId: '1',
        raw: ['1'],
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('lists stream API keys', async () => {
    const { adminStreamRoutes } = await import('../../../src/routes/admin/stream.js');
    const app = Fastify();
    await app.register(adminStreamRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api-keys',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: 'key-1',
          keyPrefix: 'dfs_abc123',
          label: 'Main site',
          createdAt: '2026-04-08T00:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('creates a stream API key and returns the secret once', async () => {
    const { adminStreamRoutes } = await import('../../../src/routes/admin/stream.js');
    const app = Fastify();
    await app.register(adminStreamRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api-keys',
      payload: {
        label: 'Companion app',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(streamApiKeysMock.createStreamApiKey).toHaveBeenCalledWith('Companion app');
    expect(response.json()).toEqual({
      data: {
        key: 'dfs_secret_value',
        record: {
          id: 'key-2',
          keyPrefix: 'dfs_def456',
          label: 'Companion app',
          createdAt: '2026-04-08T01:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('revokes a stream API key', async () => {
    const { adminStreamRoutes } = await import('../../../src/routes/admin/stream.js');
    const app = Fastify();
    await app.register(adminStreamRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api-keys/key-1/revoke',
    });

    expect(response.statusCode).toBe(200);
    expect(streamApiKeysMock.revokeStreamApiKey).toHaveBeenCalledWith('key-1');
    expect(response.json()).toEqual({
      data: {
        id: 'key-1',
        keyPrefix: 'dfs_abc123',
        label: 'Main site',
        createdAt: '2026-04-08T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: '2026-04-08T02:00:00.000Z',
      },
      error: null,
      meta: null,
    });

    await app.close();
  });
});
