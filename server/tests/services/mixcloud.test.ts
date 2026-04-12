import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe('mixcloud service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
  });

  it('discovers canonical episode metadata from the Mixcloud API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            name: "Hardcore Nerds | TK FM & Bad'm D | 08.02.2026",
            url: 'https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/',
            description: 'A loud one',
            pictures: {
              large: 'https://images.example/hardcore-nerds-300.jpg',
              extra_large: 'https://images.example/hardcore-nerds-600.jpg',
              '1024wx1024h': 'https://images.example/hardcore-nerds-1024.jpg',
            },
          },
        ],
        paging: {},
      }),
    });

    const { discoverMixcloudEpisodes } = await import('../../src/services/mixcloud.js');
    const result = await discoverMixcloudEpisodes('https://www.mixcloud.com/duckradio/');

    expect(result).toEqual([
      {
        artworkUrl: 'https://images.example/hardcore-nerds-1024.jpg',
        broadcastDate: '2026-02-08',
        description: 'A loud one',
        mixcloudUrl: 'https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/',
        presenter: "TK FM & Bad'm D",
        sourceTitle: "Hardcore Nerds | TK FM & Bad'm D | 08.02.2026",
        title: 'Hardcore Nerds',
      },
    ]);
  });

  it('paginates through multiple API pages', async () => {
    const page1 = {
      ok: true,
      json: async () => ({
        data: [
          {
            name: 'Episode One | Presenter One | 01.02.2026',
            url: 'https://www.mixcloud.com/duckradio/episode-one/',
            pictures: {},
          },
        ],
        paging: { next: 'https://api.mixcloud.com/duckradio/cloudcasts/?offset=1' },
      }),
    };
    const page2 = {
      ok: true,
      json: async () => ({
        data: [
          {
            name: 'Episode Two | Presenter Two | 08.02.2026',
            url: 'https://www.mixcloud.com/duckradio/episode-two/',
            pictures: {},
          },
        ],
        paging: {},
      }),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const { discoverMixcloudEpisodes } = await import('../../src/services/mixcloud.js');
    const result = await discoverMixcloudEpisodes('https://www.mixcloud.com/duckradio/');

    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe('Episode One');
    expect(result[1]!.title).toBe('Episode Two');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches a single episode by URL via the API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Pranzo | A$AP Gnocchi | 08.02.2026',
        url: 'https://www.mixcloud.com/duckradio/pranzo-08022026/',
        description: 'Italian vibes',
        pictures: {
          extra_large: 'https://images.example/pranzo.jpg',
        },
      }),
    });

    const { fetchMixcloudEpisode } = await import('../../src/services/mixcloud.js');
    const result = await fetchMixcloudEpisode(
      'https://www.mixcloud.com/duckradio/pranzo-08022026/',
    );

    expect(result).toEqual({
      artworkUrl: 'https://images.example/pranzo.jpg',
      broadcastDate: '2026-02-08',
      description: 'Italian vibes',
      mixcloudUrl: 'https://www.mixcloud.com/duckradio/pranzo-08022026/',
      presenter: 'A$AP Gnocchi',
      sourceTitle: 'Pranzo | A$AP Gnocchi | 08.02.2026',
      title: 'Pranzo',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.mixcloud.com/duckradio/pranzo-08022026/',
    );
  });

  it('returns null for a single episode when API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const { fetchMixcloudEpisode } = await import('../../src/services/mixcloud.js');
    const result = await fetchMixcloudEpisode(
      'https://www.mixcloud.com/duckradio/nonexistent/',
    );

    expect(result).toBeNull();
  });
});
