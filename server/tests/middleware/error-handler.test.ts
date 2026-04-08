import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';

describe('error handler', () => {
  it('preserves Fastify body-limit errors as client errors instead of masking them as 500s', async () => {
    const app = Fastify({ bodyLimit: 8 });
    app.setErrorHandler(errorHandler);
    app.post('/limited', async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/limited',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ value: 'this payload is too large' }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      data: null,
      error: {
        code: 'request_error',
        message: 'Request body is too large',
      },
      meta: null,
    });

    await app.close();
  });
});
