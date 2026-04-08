import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const limit = vi.fn();
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy, limit }));
  const from = vi.fn(() => ({ where, orderBy, limit }));
  const select = vi.fn(() => ({ from }));

  return { select, from, where, orderBy, limit };
});

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
  },
}));

describe('admin ingest routes', () => {
  let dropzoneDir: string;

  beforeEach(async () => {
    vi.resetModules();
    dropzoneDir = await mkdtemp(path.join(os.tmpdir(), 'duckfeed-dropzone-'));
    process.env.DROPZONE_DIR = dropzoneDir;
    dbMock.select.mockClear();
    dbMock.from.mockClear();
    dbMock.where.mockClear();
    dbMock.orderBy.mockClear();
    dbMock.limit.mockReset();
    dbMock.limit.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(dropzoneDir, { recursive: true, force: true });
  });

  it('stores an uploaded audio payload in the dropzone using the provided filename', async () => {
    const { adminIngestRoutes } = await import('../../../src/routes/admin/ingest.js');
    const app = Fastify({ bodyLimit: 8 });
    await app.register(adminIngestRoutes);

    const payload = Buffer.from('test-audio-payload');

    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'content-type': 'audio/mpeg',
        'x-filename': 'episode-1.mp3',
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      data: {
        filename: 'episode-1.mp3',
        path: path.join(dropzoneDir, 'episode-1.mp3'),
      },
      error: null,
      meta: null,
    });
    expect(await readFile(path.join(dropzoneDir, 'episode-1.mp3'))).toEqual(payload);

    await app.close();
  });
});
