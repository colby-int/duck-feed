import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamStateMock = vi.hoisted(() => ({
  getStreamStatus: vi.fn(),
  getCurrentNowPlaying: vi.fn(),
  getIntegrationStreamMetadata: vi.fn(),
  getStreamQueue: vi.fn(),
  getUnifiedStreamSnapshot: vi.fn(),
}));

vi.mock('../../src/services/stream-state.js', () => streamStateMock);
vi.mock('../../src/middleware/stream-api-auth.js', () => ({
  requireStreamApiKey: vi.fn(async () => {}),
}));

describe('public stream routes', () => {
  beforeEach(() => {
    vi.resetModules();
    streamStateMock.getStreamStatus.mockReset();
    streamStateMock.getCurrentNowPlaying.mockReset();
    streamStateMock.getIntegrationStreamMetadata.mockReset();
    streamStateMock.getStreamQueue.mockReset();
    streamStateMock.getUnifiedStreamSnapshot.mockReset();
  });

  it('returns stream status in the standard API envelope', async () => {
    streamStateMock.getStreamStatus.mockResolvedValue({
      online: true,
      mode: 'archive',
      queueLength: 0,
      librarySize: 1,
      streamUrl: '/stream',
      checkedAt: '2026-04-07T01:00:00.000Z',
    });

    const { streamRoutes } = await import('../../src/routes/stream.js');
    const app = Fastify();
    await app.register(streamRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        online: true,
        mode: 'archive',
        queueLength: 0,
        librarySize: 1,
        streamUrl: '/stream',
        checkedAt: '2026-04-07T01:00:00.000Z',
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('returns current now-playing data or null in the standard API envelope', async () => {
    streamStateMock.getCurrentNowPlaying.mockResolvedValue({
      elapsedSeconds: 42,
      episode: {
        artworkUrl: 'https://cdn.example.com/test-pattern.jpg',
        broadcastDate: '2025-09-08',
        id: 'episode-1',
        mixcloudUrl: 'https://www.mixcloud.com/example-station/test-pattern/',
        presenter: 'Wellness Centre',
        slug: 'test-pattern',
        title: 'Test Pattern',
      },
      startedAt: '2026-04-07T01:00:00.000Z',
      track: null,
    });

    const { streamRoutes } = await import('../../src/routes/stream.js');
    const app = Fastify();
    await app.register(streamRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/now-playing',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        elapsedSeconds: 42,
        episode: {
          artworkUrl: 'https://cdn.example.com/test-pattern.jpg',
          broadcastDate: '2025-09-08',
          id: 'episode-1',
          mixcloudUrl: 'https://www.mixcloud.com/example-station/test-pattern/',
          presenter: 'Wellness Centre',
          slug: 'test-pattern',
          title: 'Test Pattern',
        },
        startedAt: '2026-04-07T01:00:00.000Z',
        track: null,
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('returns combined integration metadata in the standard API envelope', async () => {
    streamStateMock.getIntegrationStreamMetadata.mockResolvedValue({
      generatedAt: '2026-04-08T03:00:00.000Z',
      nowPlaying: {
        elapsedSeconds: 42,
        episode: {
          artworkUrl: 'https://cdn.example.com/test-pattern.jpg',
          broadcastDate: '2025-09-08',
          id: 'episode-1',
          mixcloudUrl: 'https://www.mixcloud.com/example-station/test-pattern/',
          presenter: 'Wellness Centre',
          slug: 'test-pattern',
          title: 'Test Pattern',
        },
        startedAt: '2026-04-08T02:59:18.000Z',
        track: null,
      },
      queue: [
        {
          episode: {
            artworkUrl: 'https://cdn.example.com/night-drive.jpg',
            broadcastDate: '2025-10-01',
            id: 'episode-2',
            mixcloudUrl: 'https://www.mixcloud.com/example-station/night-drive/',
            presenter: 'DJ Evening',
            slug: 'night-drive',
            title: 'Night Drive',
          },
          filePath: '/var/lib/duckfeed/library/night-drive.mp3',
          requestId: '12',
        },
      ],
      status: {
        online: true,
        queueLength: 1,
        librarySize: 2,
        streamUrl: '/stream',
        checkedAt: '2026-04-08T03:00:00.000Z',
      },
    });

    const { streamRoutes } = await import('../../src/routes/stream.js');
    const app = Fastify();
    await app.register(streamRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/integration/metadata',
      headers: {
        authorization: 'Bearer dfs_example',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        generatedAt: '2026-04-08T03:00:00.000Z',
        nowPlaying: {
          elapsedSeconds: 42,
          episode: {
            artworkUrl: 'https://cdn.example.com/test-pattern.jpg',
            broadcastDate: '2025-09-08',
            id: 'episode-1',
            mixcloudUrl: 'https://www.mixcloud.com/example-station/test-pattern/',
            presenter: 'Wellness Centre',
            slug: 'test-pattern',
            title: 'Test Pattern',
          },
          startedAt: '2026-04-08T02:59:18.000Z',
          track: null,
        },
        queue: [
          {
            episode: {
              artworkUrl: 'https://cdn.example.com/night-drive.jpg',
              broadcastDate: '2025-10-01',
              id: 'episode-2',
              mixcloudUrl: 'https://www.mixcloud.com/example-station/night-drive/',
              presenter: 'DJ Evening',
              slug: 'night-drive',
              title: 'Night Drive',
            },
            filePath: '/var/lib/duckfeed/library/night-drive.mp3',
            requestId: '12',
          },
        ],
        status: {
          online: true,
          queueLength: 1,
          librarySize: 2,
          streamUrl: '/stream',
          checkedAt: '2026-04-08T03:00:00.000Z',
        },
      },
      error: null,
      meta: null,
    });

    await app.close();
  });

  it('uses explicit public CORS headers for the SSE stream', async () => {
    const { getPublicStreamSseHeaders } = await import('../../src/routes/stream.js');

    expect(getPublicStreamSseHeaders()).toEqual({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
  });
});
