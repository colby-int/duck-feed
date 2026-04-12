import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('icecast service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
    process.env.ICECAST_ADMIN_PASSWORD = 'secret';
  });

  it('extracts listener count for the stream mount from Icecast stats XML', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <icestats>
          <source mount="/stream">
            <listeners>7</listeners>
          </source>
        </icestats>
      `,
    });

    const { fetchCurrentListenerCount } = await import('../../src/services/icecast.js');
    await expect(fetchCurrentListenerCount()).resolves.toBe(7);
  });

  it('returns zero when the stream mount is present but idle', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <icestats>
          <source mount="/stream">
            <listeners>0</listeners>
          </source>
        </icestats>
      `,
    });

    const { fetchCurrentListenerCount } = await import('../../src/services/icecast.js');
    await expect(fetchCurrentListenerCount()).resolves.toBe(0);
  });
});
