import { describe, expect, it } from 'vitest';

import { resolveCurrentAudioAgainstCandidates } from '../../src/services/current-audio-resolution.js';

const homeSweet = {
  artworkUrl: 'https://cdn.example.com/home-sweet.jpg',
  broadcastDate: '2026-02-08',
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
  durationSeconds: 3600,
  filePath: '/var/lib/duckfeed/library/2026-02-08-homesweet-6c28ab.mp3',
  id: 'episode-home-sweet',
  mixcloudUrl: 'https://www.mixcloud.com/example/home-sweet/',
  originalFilename: '08022026_home-sweet_marley.mp3',
  presenter: 'Marley',
  slug: '2026-02-08-homesweet-6c28ab',
  title: 'Home Sweet',
};

const heuristic = {
  artworkUrl: 'https://cdn.example.com/heuristic.jpg',
  broadcastDate: '2026-02-08',
  createdAt: new Date('2026-04-11T00:00:00.000Z'),
  durationSeconds: 7219,
  filePath: '/var/lib/duckfeed/library/2026-02-08-heuristic-778879.mp3',
  id: 'episode-heuristic',
  mixcloudUrl: 'https://www.mixcloud.com/example/heuristic/',
  originalFilename: '08022026_heuristic_strict-face.mp3',
  presenter: 'Strict Face',
  slug: '2026-02-08-heuristic-778879',
  title: 'Heuristic',
};

describe('current audio resolution', () => {
  it('self-heals to a ready episode when only the basename matches', () => {
    const result = resolveCurrentAudioAgainstCandidates(
      {
        artist: null,
        filePath: '/mnt/cache/2026-02-08-homesweet-6c28ab.mp3',
        title: null,
      },
      null,
      [homeSweet],
    );

    expect(result.matchedEpisode?.id).toBe('episode-home-sweet');
    expect(result.displayEpisode?.title).toBe('Home Sweet');
    expect(result.resolutionSource).toBe('file_basename');
    expect(result.alert?.kind).toBe('fallback_resolved');
  });

  it('falls back to stream tags when the current filename is not resolvable', () => {
    const result = resolveCurrentAudioAgainstCandidates(
      {
        artist: 'Strict Face',
        filePath: '/tmp/live.mp3',
        title: 'Heuristic | Strict Face',
      },
      null,
      [heuristic],
    );

    expect(result.matchedEpisode?.id).toBe('episode-heuristic');
    expect(result.displayEpisode?.title).toBe('Heuristic');
    expect(result.displayEpisode?.presenter).toBe('Strict Face');
    expect(result.resolutionSource).toBe('stream_tags');
    expect(result.alert?.kind).toBe('fallback_resolved');
  });

  it('alerts when file-based recovery disagrees with the live metadata being broadcast', () => {
    const result = resolveCurrentAudioAgainstCandidates(
      {
        artist: 'Somebody Else',
        filePath: '/mnt/cache/2026-02-08-homesweet-6c28ab.mp3',
        title: 'Other Show | Somebody Else',
      },
      null,
      [homeSweet],
    );

    expect(result.matchedEpisode?.id).toBe('episode-home-sweet');
    expect(result.displayEpisode?.title).toBe('Home Sweet');
    expect(result.resolutionSource).toBe('file_basename');
    expect(result.alert?.kind).toBe('metadata_mismatch');
  });

  it('synthesizes live metadata when no ready episode matches the current audio', () => {
    const result = resolveCurrentAudioAgainstCandidates(
      {
        artist: 'DJ Cookie',
        filePath: '/tmp/live.mp3',
        title: 'Interruption Hour | DJ Cookie',
      },
      null,
      [],
    );

    expect(result.matchedEpisode).toBeNull();
    expect(result.displayEpisode).toEqual({
      artworkUrl: null,
      broadcastDate: null,
      id: 'synthetic:interruption-hour-dj-cookie',
      mixcloudUrl: null,
      presenter: 'DJ Cookie',
      slug: 'interruption-hour-dj-cookie',
      title: 'Interruption Hour',
    });
    expect(result.resolutionSource).toBe('synthetic_metadata');
    expect(result.alert?.kind).toBe('synthetic_only');
  });

  it('emits a mismatch alert when live stream tags disagree with the exact file match', () => {
    const result = resolveCurrentAudioAgainstCandidates(
      {
        artist: 'Somebody Else',
        filePath: '/var/lib/duckfeed/library/2026-02-08-homesweet-6c28ab.mp3',
        title: 'Other Show | Somebody Else',
      },
      homeSweet,
      [],
    );

    expect(result.matchedEpisode?.id).toBe('episode-home-sweet');
    expect(result.displayEpisode?.title).toBe('Home Sweet');
    expect(result.resolutionSource).toBe('exact_file_path');
    expect(result.alert?.kind).toBe('metadata_mismatch');
  });
});
