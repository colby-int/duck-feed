import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    execute: dbMock.execute,
  },
}));

describe('health routes', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.execute.mockReset();
  });

  it('returns cheap liveness without touching the database', async () => {
    dbMock.execute.mockRejectedValue(new Error('database down'));

    const { healthRoutes } = await import('../../src/routes/health.js');
    const app = Fastify();
    await app.register(healthRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        status: 'ok',
      },
      error: null,
      meta: null,
    });
    expect(dbMock.execute).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns database status from the deep health endpoint', async () => {
    dbMock.execute.mockRejectedValue(new Error('database down'));

    const { healthRoutes } = await import('../../src/routes/health.js');
    const app = Fastify();
    await app.register(healthRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/health/deep',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        status: 'degraded',
        checks: {
          api: { ok: true },
          database: { ok: false, error: 'database down' },
        },
      },
      error: null,
      meta: null,
    });
    expect(dbMock.execute).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
