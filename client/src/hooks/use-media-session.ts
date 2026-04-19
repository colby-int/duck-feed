import { useEffect } from 'react';

export interface MediaSessionEpisode {
  artworkUrl: string | null;
  broadcastDate: string | null;
  presenter: string | null;
  title: string;
}

export interface UseMediaSessionOptions {
  album?: string;
  episode: MediaSessionEpisode | null;
  isPlaying: boolean;
  onPause: () => void;
  onPlay: () => void;
}

/**
 * Sync the OS-level media session (lock screen, Chrome media hub, etc.) with
 * the current episode. Icecast ICY metadata is driven by the audio file's ID3
 * tags — which can be stale or slug-condensed — so we overwrite the media
 * session from the now-playing API, which comes straight from the DB.
 *
 * No-op when the browser doesn't implement MediaSession.
 */
export function useMediaSession({
  album = 'duckfeed Radio',
  episode,
  isPlaying,
  onPause,
  onPlay,
}: UseMediaSessionOptions): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const mediaSession = navigator.mediaSession;

    if (!episode) {
      mediaSession.metadata = null;
      return;
    }

    const artwork = episode.artworkUrl
      ? [{ sizes: '1024x1024', src: episode.artworkUrl, type: inferImageMime(episode.artworkUrl) }]
      : [];

    mediaSession.metadata = new MediaMetadata({
      album,
      artist: episode.presenter ?? '',
      artwork,
      title: episode.title,
    });
  }, [album, episode?.artworkUrl, episode?.presenter, episode?.title, episode]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const mediaSession = navigator.mediaSession;

    mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    try {
      mediaSession.setActionHandler('play', () => onPlay());
      mediaSession.setActionHandler('pause', () => onPause());
    } catch {
      // Some browsers throw for unsupported actions — ignore.
    }

    return () => {
      try {
        mediaSession.setActionHandler('play', null);
        mediaSession.setActionHandler('pause', null);
      } catch {
        // Ignore — same reason as above.
      }
    };
  }, [isPlaying, onPause, onPlay]);
}

function inferImageMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
