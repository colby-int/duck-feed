import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

const mixcloudMock = vi.hoisted(() => ({
  condenseMetadataSegment: vi.fn((value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')),
  discoverMixcloudEpisodes: vi.fn(),
  fetchMixcloudEpisode: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
  },
}));

vi.mock('../../src/services/mixcloud.js', () => mixcloudMock);

describe('metadata recovery service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    mixcloudMock.discoverMixcloudEpisodes.mockReset();
    mixcloudMock.fetchMixcloudEpisode.mockReset();
    mixcloudMock.condenseMetadataSegment.mockClear();
  });

  it('repairs malformed ready rows by matching structured filename metadata against Mixcloud discovery', async () => {
    const from = vi.fn().mockResolvedValue([
      {
        artworkUrl: null,
        broadcastDate: '2026-02-08',
        description: null,
        id: 'episode-1',
        mixcloudUrl: null,
        originalFilename: '080226_hardcorenerds_tkfmbadmd.mp3',
        presenter: 'Tkfmbadmd',
        status: 'ready',
        title: 'Hardcorenerds',
      },
    ]);
    dbMock.select.mockReturnValue({ from });

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    dbMock.update.mockReturnValue({ set });

    mixcloudMock.discoverMixcloudEpisodes.mockResolvedValue([
      {
        artworkUrl: 'https://images.example/hardcore-nerds.jpg',
        broadcastDate: '2026-02-08',
        description: 'Recovered from Mixcloud',
        mixcloudUrl: 'https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/',
        presenter: "TK FM & Bad'm D",
        sourceTitle: "Hardcore Nerds | TK FM & Bad'm D | 08.02.2026",
        title: 'Hardcore Nerds',
      },
    ]);
    mixcloudMock.fetchMixcloudEpisode.mockResolvedValue(null);

    const { recoverEpisodeMetadata } = await import('../../src/services/metadata-recovery.js');
    const result = await recoverEpisodeMetadata();

    expect(result).toEqual({
      matched: 1,
      scanned: 1,
      skipped: 0,
      updated: 1,
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        artworkUrl: 'https://images.example/hardcore-nerds.jpg',
        description: 'Recovered from Mixcloud',
        mixcloudUrl: 'https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/',
        presenter: "TK FM & Bad'm D",
        title: 'Hardcore Nerds',
      }),
    );
  });

  it('refreshes artwork directly from an existing Mixcloud URL when discovery misses the row', async () => {
    const from = vi.fn().mockResolvedValue([
      {
        artworkUrl: null,
        broadcastDate: '2026-02-08',
        description: null,
        id: 'episode-2',
        mixcloudUrl: 'https://www.mixcloud.com/duckradio/pranzo-aap-gnocchi-08022026/',
        originalFilename: '080226_pranzo_aapgnocchi.mp3',
        presenter: 'Aapgnocchi',
        status: 'ready',
        title: 'Pranzo',
      },
    ]);
    dbMock.select.mockReturnValue({ from });

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    dbMock.update.mockReturnValue({ set });

    mixcloudMock.discoverMixcloudEpisodes.mockResolvedValue([]);
    mixcloudMock.fetchMixcloudEpisode.mockResolvedValue({
      artworkUrl: 'https://images.example/pranzo.jpg',
      broadcastDate: '2026-02-08',
      description: 'Fresh artwork',
      mixcloudUrl: 'https://www.mixcloud.com/duckradio/pranzo-aap-gnocchi-08022026/',
      presenter: 'A$AP Gnocchi',
      sourceTitle: 'Pranzo | A$AP Gnocchi | 08.02.2026',
      title: 'Pranzo',
    });

    const { recoverEpisodeMetadata } = await import('../../src/services/metadata-recovery.js');
    const result = await recoverEpisodeMetadata();

    expect(result.updated).toBe(1);
    expect(mixcloudMock.fetchMixcloudEpisode).toHaveBeenCalledWith(
      'https://www.mixcloud.com/duckradio/pranzo-aap-gnocchi-08022026/',
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        artworkUrl: 'https://images.example/pranzo.jpg',
        presenter: 'A$AP Gnocchi',
      }),
    );
  });
});
