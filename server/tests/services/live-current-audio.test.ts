import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamPollerMock = vi.hoisted(() => ({
  getStreamSnapshot: vi.fn(),
  refreshStreamSnapshot: vi.fn(),
}));

const resolutionMock = vi.hoisted(() => ({
  resolveCurrentAudioEpisode: vi.fn(),
}));

vi.mock('../../src/services/stream-poller.js', () => streamPollerMock);
vi.mock('../../src/services/current-audio-resolution.js', () => resolutionMock);

describe('live current audio service', () => {
  beforeEach(() => {
    vi.resetModules();
    streamPollerMock.getStreamSnapshot.mockReset();
    streamPollerMock.refreshStreamSnapshot.mockReset();
    resolutionMock.resolveCurrentAudioEpisode.mockReset();
  });

  it('re-polls once when the first live snapshot only resolves from stream tags', async () => {
    const initialSnapshot = {
      checkedAt: '2026-04-13T10:00:00.000Z',
      currentRequest: {
        artist: 'Strict Face',
        filePath: null,
        requestId: null,
        title: 'Heuristic | Strict Face',
      },
      online: true,
      queue: [],
      remainingSeconds: 120,
    };
    const refreshedSnapshot = {
      checkedAt: '2026-04-13T10:00:01.000Z',
      currentRequest: {
        artist: 'Strict Face',
        filePath: '/var/lib/duckfeed/library/2026-02-08-heuristic-778879.mp3',
        requestId: null,
        title: 'Heuristic | Strict Face',
      },
      online: true,
      queue: [],
      remainingSeconds: 119,
    };

    streamPollerMock.getStreamSnapshot.mockResolvedValue(initialSnapshot);
    streamPollerMock.refreshStreamSnapshot.mockResolvedValue(refreshedSnapshot);
    resolutionMock.resolveCurrentAudioEpisode
      .mockResolvedValueOnce({
        alert: {
          details: {},
          key: 'stream-tags',
          kind: 'fallback_resolved',
        },
        displayEpisode: {
          artworkUrl: null,
          broadcastDate: '2026-02-08',
          id: 'episode-heuristic',
          mixcloudUrl: null,
          presenter: 'Strict Face',
          slug: 'heuristic',
          title: 'Heuristic',
        },
        matchedEpisode: {
          artworkUrl: null,
          broadcastDate: '2026-02-08',
          createdAt: new Date('2026-04-11T00:00:00.000Z'),
          durationSeconds: 7219,
          filePath: null,
          id: 'episode-heuristic',
          mixcloudUrl: null,
          originalFilename: null,
          presenter: 'Strict Face',
          slug: 'heuristic',
          title: 'Heuristic',
        },
        resolutionSource: 'stream_tags',
      })
      .mockResolvedValueOnce({
        alert: null,
        displayEpisode: {
          artworkUrl: null,
          broadcastDate: '2026-02-08',
          id: 'episode-heuristic',
          mixcloudUrl: null,
          presenter: 'Strict Face',
          slug: 'heuristic',
          title: 'Heuristic',
        },
        matchedEpisode: {
          artworkUrl: null,
          broadcastDate: '2026-02-08',
          createdAt: new Date('2026-04-11T00:00:00.000Z'),
          durationSeconds: 7219,
          filePath: '/var/lib/duckfeed/library/2026-02-08-heuristic-778879.mp3',
          id: 'episode-heuristic',
          mixcloudUrl: null,
          originalFilename: null,
          presenter: 'Strict Face',
          slug: 'heuristic',
          title: 'Heuristic',
        },
        resolutionSource: 'exact_file_path',
      });

    const { resolveLiveCurrentAudio } = await import('../../src/services/live-current-audio.js');
    const result = await resolveLiveCurrentAudio(new Date('2026-04-13T10:00:01.000Z'));

    expect(streamPollerMock.getStreamSnapshot).toHaveBeenCalledTimes(1);
    expect(streamPollerMock.refreshStreamSnapshot).toHaveBeenCalledTimes(1);
    expect(result.snapshot).toEqual(refreshedSnapshot);
    expect(result.resolution.resolutionSource).toBe('exact_file_path');
    expect(result.selfHealed).toBe(true);
  });

  it('does not re-poll when the first snapshot is already file-anchored', async () => {
    const initialSnapshot = {
      checkedAt: '2026-04-13T10:00:00.000Z',
      currentRequest: {
        artist: 'Marley',
        filePath: '/var/lib/duckfeed/library/2026-02-08-homesweet-6c28ab.mp3',
        requestId: null,
        title: 'Home Sweet | Marley',
      },
      online: true,
      queue: [],
      remainingSeconds: 300,
    };

    streamPollerMock.getStreamSnapshot.mockResolvedValue(initialSnapshot);
    resolutionMock.resolveCurrentAudioEpisode.mockResolvedValue({
      alert: null,
      displayEpisode: {
        artworkUrl: null,
        broadcastDate: '2026-02-08',
        id: 'episode-home-sweet',
        mixcloudUrl: null,
        presenter: 'Marley',
        slug: 'home-sweet',
        title: 'Home Sweet',
      },
      matchedEpisode: {
        artworkUrl: null,
        broadcastDate: '2026-02-08',
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
        durationSeconds: 3600,
        filePath: '/var/lib/duckfeed/library/2026-02-08-homesweet-6c28ab.mp3',
        id: 'episode-home-sweet',
        mixcloudUrl: null,
        originalFilename: null,
        presenter: 'Marley',
        slug: 'home-sweet',
        title: 'Home Sweet',
      },
      resolutionSource: 'exact_file_path',
    });

    const { resolveLiveCurrentAudio } = await import('../../src/services/live-current-audio.js');
    const result = await resolveLiveCurrentAudio(new Date('2026-04-13T10:00:01.000Z'));

    expect(streamPollerMock.refreshStreamSnapshot).not.toHaveBeenCalled();
    expect(result.snapshot).toEqual(initialSnapshot);
    expect(result.selfHealed).toBe(false);
  });
});
