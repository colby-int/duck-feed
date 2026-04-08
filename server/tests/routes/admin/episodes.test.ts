import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectOrderBy = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit, orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteWhere = vi.fn();
  const deleteTable = vi.fn(() => ({ where: deleteWhere }));

  return {
    select,
    selectFrom,
    selectWhere,
    selectLimit,
    selectOrderBy,
    update,
    updateSet,
    updateWhere,
    updateReturning,
    deleteTable,
    deleteWhere,
  };
});

class FakeFingerprintingDisabledError extends Error {
  constructor() {
    super('AcoustID API key not configured');
    this.name = 'FingerprintingDisabledError';
  }
}

const fingerprintMock = vi.hoisted(() => ({
  fingerprintFile: vi.fn(),
  persistFingerprintMatches: vi.fn(),
  isFingerprintingEnabled: vi.fn(),
}));

vi.mock('../../../src/services/fingerprint.js', () => ({
  fingerprintFile: fingerprintMock.fingerprintFile,
  persistFingerprintMatches: fingerprintMock.persistFingerprintMatches,
  isFingerprintingEnabled: fingerprintMock.isFingerprintingEnabled,
  FingerprintingDisabledError: FakeFingerprintingDisabledError,
}));

vi.mock('../../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
    delete: dbMock.deleteTable,
  },
}));

describe('adminEpisodeRoutes', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';

    const episode = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'duckfeed 001',
      slug: 'duck-feed-001',
      broadcastDate: null,
      description: null,
      durationSeconds: 3600,
      filePath: null,
      originalFilename: 'duck-feed-001.mp3',
      mixcloudUrl: null,
      status: 'ready',
      loudnessLufs: -16,
      fileHash: 'hash',
      createdAt: new Date('2026-04-07T00:00:00Z'),
      updatedAt: new Date('2026-04-07T00:00:00Z'),
    };

    dbMock.select.mockClear();
    dbMock.selectFrom.mockClear();
    dbMock.selectWhere.mockClear();
    dbMock.selectLimit.mockReset();
    dbMock.selectLimit.mockResolvedValue([episode]);

    dbMock.selectOrderBy.mockReset();
    dbMock.selectOrderBy.mockResolvedValue([]);

    dbMock.update.mockClear();
    dbMock.updateSet.mockClear();
    dbMock.updateWhere.mockClear();
    dbMock.updateReturning.mockReset();
    dbMock.updateReturning.mockResolvedValue([episode]);

    dbMock.deleteTable.mockClear();
    dbMock.deleteWhere.mockReset();
    dbMock.deleteWhere.mockResolvedValue(undefined);

    fingerprintMock.fingerprintFile.mockReset();
    fingerprintMock.persistFingerprintMatches.mockReset();
    fingerprintMock.isFingerprintingEnabled.mockReset();
  });

  it('returns the full episode detail (with tracks) when updating metadata', async () => {
    const trackRows = [
      {
        id: 'track-1',
        episodeId: '11111111-1111-4111-8111-111111111111',
        title: 'Opening',
        artist: 'DJ Example',
        position: 1,
        source: 'manual',
        reviewed: true,
      },
    ];
    dbMock.selectOrderBy.mockResolvedValue(trackRows);

    const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
    const app = Fastify();
    await app.register(adminEpisodeRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/11111111-1111-4111-8111-111111111111',
      payload: { title: 'updated title' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { tracks: unknown } };
    expect(Array.isArray(body.data.tracks)).toBe(true);
    expect(body.data.tracks).toEqual(trackRows);

    await app.close();
  });

  it('nulls ingest-job episode references before deleting the episode row', async () => {
    const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
    const app = Fastify();
    await app.register(adminEpisodeRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/11111111-1111-4111-8111-111111111111',
    });

    expect(response.statusCode).toBe(204);
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(dbMock.updateSet).toHaveBeenCalledWith({ episodeId: null });
    expect(dbMock.deleteTable).toHaveBeenCalledTimes(1);

    await app.close();
  });

  describe('POST /:id/fingerprint', () => {
    const readyEpisode = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Ready Episode',
      slug: 'ready-episode',
      broadcastDate: null,
      description: null,
      durationSeconds: 3600,
      filePath: '/var/lib/duckfeed/library/ready-episode.mp3',
      originalFilename: 'ready-episode.mp3',
      mixcloudUrl: null,
      status: 'ready',
      loudnessLufs: -16,
      fileHash: 'hash',
      createdAt: new Date('2026-04-07T00:00:00Z'),
      updatedAt: new Date('2026-04-07T00:00:00Z'),
    };

    it('runs fingerprint pipeline and returns matches + insertedCount', async () => {
      dbMock.selectLimit.mockResolvedValue([readyEpisode]);

      const matches = [
        {
          title: 'Some Track',
          artist: 'Some Artist',
          acoustidScore: 0.92,
          musicbrainzId: 'mbid-1',
        },
      ];
      fingerprintMock.fingerprintFile.mockResolvedValue(matches);
      fingerprintMock.persistFingerprintMatches.mockResolvedValue(['track-id-1']);

      const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
      const app = Fastify();
      await app.register(adminEpisodeRoutes);

      const response = await app.inject({
        method: 'POST',
        url: '/22222222-2222-4222-8222-222222222222/fingerprint',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { matches, insertedCount: 1 },
        error: null,
        meta: null,
      });
      // Existing acoustid tracks must be deleted before re-running.
      expect(dbMock.deleteTable).toHaveBeenCalledTimes(1);
      expect(fingerprintMock.fingerprintFile).toHaveBeenCalledWith(readyEpisode.filePath);
      expect(fingerprintMock.persistFingerprintMatches).toHaveBeenCalledWith(
        readyEpisode.id,
        matches,
      );

      await app.close();
    });

    it('rejects fingerprint when episode is not ready', async () => {
      dbMock.selectLimit.mockResolvedValue([{ ...readyEpisode, status: 'pending' }]);

      const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
      const app = Fastify();
      await app.register(adminEpisodeRoutes);

      const response = await app.inject({
        method: 'POST',
        url: '/22222222-2222-4222-8222-222222222222/fingerprint',
      });

      expect(response.statusCode).toBe(409);
      expect(fingerprintMock.fingerprintFile).not.toHaveBeenCalled();
      expect(dbMock.deleteTable).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects fingerprint when episode has no filePath', async () => {
      dbMock.selectLimit.mockResolvedValue([{ ...readyEpisode, filePath: null }]);

      const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
      const app = Fastify();
      await app.register(adminEpisodeRoutes);

      const response = await app.inject({
        method: 'POST',
        url: '/22222222-2222-4222-8222-222222222222/fingerprint',
      });

      expect(response.statusCode).toBe(409);
      expect(fingerprintMock.fingerprintFile).not.toHaveBeenCalled();

      await app.close();
    });

    it('returns 409 when fingerprinting is not configured', async () => {
      dbMock.selectLimit.mockResolvedValue([readyEpisode]);
      fingerprintMock.fingerprintFile.mockRejectedValue(new FakeFingerprintingDisabledError());

      const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
      const app = Fastify();
      await app.register(adminEpisodeRoutes);

      const response = await app.inject({
        method: 'POST',
        url: '/22222222-2222-4222-8222-222222222222/fingerprint',
      });

      expect(response.statusCode).toBe(409);
      expect(fingerprintMock.persistFingerprintMatches).not.toHaveBeenCalled();

      await app.close();
    });

    it('returns 404 when episode does not exist', async () => {
      dbMock.selectLimit.mockResolvedValue([]);

      const { adminEpisodeRoutes } = await import('../../../src/routes/admin/episodes.js');
      const app = Fastify();
      await app.register(adminEpisodeRoutes);

      const response = await app.inject({
        method: 'POST',
        url: '/22222222-2222-4222-8222-222222222222/fingerprint',
      });

      expect(response.statusCode).toBe(404);
      expect(fingerprintMock.fingerprintFile).not.toHaveBeenCalled();

      await app.close();
    });
  });
});
