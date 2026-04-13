import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}));

const liquidsoapMock = vi.hoisted(() => ({
  getRequestMetadata: vi.fn(),
}));

const liveCurrentAudioMock = vi.hoisted(() => ({
  resolveLiveCurrentAudio: vi.fn(),
}));

const streamPollerMock = vi.hoisted(() => ({
  getStreamSnapshot: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
  },
}));

vi.mock('../../src/services/liquidsoap.js', () => liquidsoapMock);
vi.mock('../../src/services/live-current-audio.js', () => liveCurrentAudioMock);
vi.mock('../../src/services/stream-poller.js', () => streamPollerMock);

describe('stream state service', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.select.mockReset();
    liquidsoapMock.getRequestMetadata.mockReset();
    liveCurrentAudioMock.resolveLiveCurrentAudio.mockReset();
    streamPollerMock.getStreamSnapshot.mockReset();
  });

  it('falls back to the current Liquidsoap request when playback_log is empty', async () => {
    const now = new Date('2026-04-07T02:00:00.000Z');

    const playbackLimit = vi.fn().mockResolvedValue([]);
    const playbackOrderBy = vi.fn(() => ({ limit: playbackLimit }));
    const playbackWhere = vi.fn(() => ({ orderBy: playbackOrderBy }));
    const playbackInnerJoin = vi.fn(() => ({ where: playbackWhere }));
    const playbackFrom = vi.fn(() => ({ innerJoin: playbackInnerJoin }));

    const tracksOrderBy = vi.fn().mockResolvedValue([
      {
        id: 'track-1',
        title: 'Intro',
        artist: 'duckfeed',
        position: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 60,
      },
      {
        id: 'track-2',
        title: 'Main Segment',
        artist: 'duckfeed',
        position: 2,
        startTimeSeconds: 60,
        endTimeSeconds: 120,
      },
    ]);
    const tracksWhere = vi.fn(() => ({ orderBy: tracksOrderBy }));
    const tracksFrom = vi.fn(() => ({ where: tracksWhere }));

    dbMock.select
      .mockImplementationOnce(() => ({ from: playbackFrom }))
      .mockImplementationOnce(() => ({ from: tracksFrom }));

    liveCurrentAudioMock.resolveLiveCurrentAudio.mockResolvedValue({
      resolution: {
        alert: null,
        displayEpisode: {
          artworkUrl: undefined,
          broadcastDate: undefined,
          id: '11111111-1111-4111-8111-111111111111',
          mixcloudUrl: undefined,
          presenter: 'Gary Butterfield',
          slug: 'episode-1',
          title: 'Episode 1',
        },
        matchedEpisode: {
          artworkUrl: undefined,
          broadcastDate: undefined,
          createdAt: new Date('2026-04-10T00:00:00.000Z'),
          durationSeconds: 120,
          filePath: '/var/lib/duckfeed/library/episode-1.mp3',
          id: '11111111-1111-4111-8111-111111111111',
          mixcloudUrl: undefined,
          originalFilename: undefined,
          presenter: 'Gary Butterfield',
          slug: 'episode-1',
          title: 'Episode 1',
        },
        resolutionSource: 'exact_file_path',
      },
      selfHealed: false,
      snapshot: {
        checkedAt: '2026-04-12T01:00:00.000Z',
        currentRequest: {
          requestId: '12',
          filePath: '/var/lib/duckfeed/library/episode-1.mp3',
        },
        online: true,
        queue: [],
        remainingSeconds: 30,
      },
    });

    const { getCurrentNowPlaying } = await import('../../src/services/stream-state.js');
    const result = await getCurrentNowPlaying(now);

    expect(liveCurrentAudioMock.resolveLiveCurrentAudio).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      startedAt: '2026-04-07T01:58:30.000Z',
      elapsedSeconds: 90,
      episode: {
        artworkUrl: undefined,
        broadcastDate: undefined,
        id: '11111111-1111-4111-8111-111111111111',
        mixcloudUrl: undefined,
        title: 'Episode 1',
        presenter: 'Gary Butterfield',
        slug: 'episode-1',
      },
      track: {
        id: 'track-2',
        title: 'Main Segment',
        artist: 'duckfeed',
        position: 2,
      },
    });
  });

  it('resolves queued Liquidsoap requests into integration-friendly metadata', async () => {
    const firstQueueEpisodeLimit = vi.fn().mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Night Drive',
        presenter: 'DJ Evening',
        slug: 'night-drive',
        broadcastDate: '2025-10-01',
        mixcloudUrl: 'https://www.mixcloud.com/example-station/night-drive/',
        artworkUrl: 'https://cdn.example.com/night-drive.jpg',
      },
    ]);
    const firstQueueEpisodeWhere = vi.fn(() => ({ limit: firstQueueEpisodeLimit }));
    const firstQueueEpisodeFrom = vi.fn(() => ({ where: firstQueueEpisodeWhere }));

    const secondQueueEpisodeLimit = vi.fn().mockResolvedValue([]);
    const secondQueueEpisodeWhere = vi.fn(() => ({ limit: secondQueueEpisodeLimit }));
    const secondQueueEpisodeFrom = vi.fn(() => ({ where: secondQueueEpisodeWhere }));

    dbMock.select
      .mockImplementationOnce(() => ({ from: firstQueueEpisodeFrom }))
      .mockImplementationOnce(() => ({ from: secondQueueEpisodeFrom }));

    streamPollerMock.getStreamSnapshot.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: null,
      online: true,
      queue: ['12', '14'],
      remainingSeconds: null,
    });
    liquidsoapMock.getRequestMetadata
      .mockResolvedValueOnce({
        filePath: '/var/lib/duckfeed/library/night-drive.mp3',
        requestId: '12',
      })
      .mockResolvedValueOnce({
        filePath: '/var/lib/duckfeed/library/unknown.mp3',
        requestId: '14',
      });

    const { getStreamQueue } = await import('../../src/services/stream-state.js');
    const result = await getStreamQueue();

    expect(streamPollerMock.getStreamSnapshot).toHaveBeenCalledTimes(1);
    expect(liquidsoapMock.getRequestMetadata).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        episode: {
          artworkUrl: 'https://cdn.example.com/night-drive.jpg',
          broadcastDate: '2025-10-01',
          id: '22222222-2222-4222-8222-222222222222',
          mixcloudUrl: 'https://www.mixcloud.com/example-station/night-drive/',
          presenter: 'DJ Evening',
          slug: 'night-drive',
          title: 'Night Drive',
        },
        filePath: '/var/lib/duckfeed/library/night-drive.mp3',
        requestId: '12',
      },
      {
        episode: null,
        filePath: '/var/lib/duckfeed/library/unknown.mp3',
        requestId: '14',
      },
    ]);
  });
});
