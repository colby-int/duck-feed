import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamApiKeysMock = vi.hoisted(() => ({
  authenticateStreamApiKey: vi.fn(),
}));

vi.mock('../../src/services/stream-api-keys.js', () => streamApiKeysMock);

describe('stream API auth middleware', () => {
  beforeEach(() => {
    vi.resetModules();
    streamApiKeysMock.authenticateStreamApiKey.mockReset();
  });

  it('rejects requests without a bearer token', async () => {
    const { requireStreamApiKey } = await import('../../src/middleware/stream-api-auth.js');
    const { errorHandler } = await import('../../src/middleware/error-handler.js');

    const app = Fastify();
    app.setErrorHandler(errorHandler);
    app.addHook('preHandler', requireStreamApiKey);
    app.get('/integration-only', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/integration-only',
    });

    expect(response.statusCode).toBe(401);
    expect(streamApiKeysMock.authenticateStreamApiKey).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      data: null,
      error: {
        code: 'unauthorized',
        message: 'Bearer token required',
      },
      meta: null,
    });

    await app.close();
  });

  it('rejects invalid tokens', async () => {
    streamApiKeysMock.authenticateStreamApiKey.mockResolvedValue(null);

    const { requireStreamApiKey } = await import('../../src/middleware/stream-api-auth.js');
    const { errorHandler } = await import('../../src/middleware/error-handler.js');

    const app = Fastify();
    app.setErrorHandler(errorHandler);
    app.addHook('preHandler', requireStreamApiKey);
    app.get('/integration-only', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/integration-only',
      headers: {
        authorization: 'Bearer dfs_invalid',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(streamApiKeysMock.authenticateStreamApiKey).toHaveBeenCalledWith('dfs_invalid');
    expect(response.json()).toEqual({
      data: null,
      error: {
        code: 'unauthorized',
        message: 'Invalid stream API key',
      },
      meta: null,
    });

    await app.close();
  });
});
