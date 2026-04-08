import { useEffect, useState } from 'react';
import {
  getStreamAudioUrl,
  requestData,
  type EpisodeSummary,
  type NowPlaying,
  type StreamStatus,
} from '../api/client';
import { HeroTitle } from '../components/hero-title';
import { PublicPlayerControl } from '../components/public-player-control';
import { useAudioMotion } from '../hooks/use-audio-motion';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
});

function formatBroadcastDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return DISPLAY_DATE_FORMATTER.format(parsed);
}

export function PlayerPage() {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const { activate: activateAudioMotion, motion } = useAudioMotion(audioElement, isLoading || isPlaying);

  useEffect(() => {
    const load = async () => {
      try {
        const [archive, status, current] = await Promise.all([
          requestData<EpisodeSummary[]>('/api/episodes?limit=12'),
          requestData<StreamStatus>('/api/stream/status'),
          requestData<NowPlaying | null>('/api/stream/now-playing'),
        ]);
        setEpisodes(archive);
        setStreamStatus(status);
        setNowPlaying(current);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Failed to load the player');
      }
    };

    void load();

    if (typeof EventSource === 'undefined') {
      return;
    }

    const source = new EventSource(`${import.meta.env.VITE_API_URL ?? ''}/api/stream/events`);
    source.addEventListener('stream-status', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as StreamStatus;
      setStreamStatus(next);
    });
    source.addEventListener('now-playing', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as NowPlaying | null;
      setNowPlaying(next);
    });

    return () => {
      source.close();
    };
  }, []);

  // Wire native audio element events to React state. We use a custom UI
  // (no `controls` attribute) but still need to know when playback actually starts/stops.
  useEffect(() => {
    const el = audioElement;
    if (!el) return;
    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };
    const handlePause = () => {
      setIsPlaying(false);
      setIsLoading(false);
    };
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setError('Stream connection failed. Press play to reconnect.');
    };
    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);
    el.addEventListener('waiting', handleWaiting);
    el.addEventListener('playing', handlePlaying);
    el.addEventListener('error', handleError);
    return () => {
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      el.removeEventListener('waiting', handleWaiting);
      el.removeEventListener('playing', handlePlaying);
      el.removeEventListener('error', handleError);
    };
  }, [audioElement]);

  /**
   * Tear down + reconnect to the live stream with a fresh cache-busted URL.
   * This is the canonical way to escape a stale Icecast connection in the
   * browser audio element — see feedback memory `feedback_stream_cache_busting`.
   */
  function reconnectAudio(autoplay: boolean): void {
    const el = audioElement;
    if (!el) return;
    setError(null);
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.src = getStreamAudioUrl(true);
    if (autoplay) {
      setIsLoading(true);
      void el.play().catch(() => {
        setIsLoading(false);
        setIsPlaying(false);
      });
    }
  }

  function handlePlayPause(): void {
    const el = audioElement;
    if (!el) return;
    if (el.paused) {
      activateAudioMotion();
      // Always reconnect with a fresh URL on every play. Cheap insurance against
      // stale connections from prior sessions or background tabs.
      reconnectAudio(true);
    } else {
      el.pause();
    }
  }

  function handleAudioRef(nextAudioElement: HTMLAudioElement | null): void {
    setAudioElement(nextAudioElement);
  }

  const fallbackEpisode = episodes[0] ?? null;
  const currentEpisode = nowPlaying?.episode ?? null;
  const heroTitle = currentEpisode?.title ?? fallbackEpisode?.title ?? 'duckfeed';
  const heroPresenter = currentEpisode?.presenter ?? fallbackEpisode?.presenter ?? null;
  const heroArtworkUrl =
    currentEpisode != null ? currentEpisode.artworkUrl ?? null : fallbackEpisode?.artworkUrl ?? null;
  const heroMixcloudUrl = currentEpisode?.mixcloudUrl ?? fallbackEpisode?.mixcloudUrl ?? null;
  const heroDate = formatBroadcastDate(currentEpisode?.broadcastDate ?? fallbackEpisode?.broadcastDate) ?? 'Live archive stream';
  const upcomingEpisodes = episodes.filter((episode) => episode.id !== currentEpisode?.id).slice(0, 6);
  const isStreamLive = streamStatus?.online === true;
  const liveBadgeLabel = streamStatus == null ? 'checking' : isStreamLive ? 'live' : 'offline';
  const displayStreamUrl =
    typeof window === 'undefined'
      ? getStreamAudioUrl()
      : new URL(getStreamAudioUrl(), window.location.origin).toString();

  async function copyStreamUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(displayStreamUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand text-ink">
      <main className="mx-auto flex min-h-screen max-w-[980px] flex-col px-4 py-8 sm:px-6 sm:py-14">
        <section className="flex min-h-[82vh] flex-col items-center justify-center">
          <h1 className="sr-only">duckfeed Radio</h1>
          <img alt="duckfeed" className="w-[200px] sm:w-[280px]" src="/logo.png" />

          <div className="mt-6 w-full max-w-[760px] sm:mt-10">
            <div className="bg-cobalt p-2.5 sm:p-3.5">
              <div className="relative bg-ink px-4 py-5 text-white sm:px-7 sm:py-7">
                <div className="absolute right-4 top-4 flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.26em] sm:right-6 sm:top-5 sm:text-[0.76rem] sm:tracking-[0.28em]">
                  <span
                    className={[
                      'h-2.5 w-2.5 rounded-full',
                      isStreamLive ? 'live-badge-dot--online bg-[#00ff3a]' : 'bg-white/35',
                    ].join(' ')}
                  />
                  <span className={isStreamLive ? 'live-badge-text--online text-[#00ff3a]' : 'text-white/60'}>
                    {liveBadgeLabel}
                  </span>
                </div>

                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 pr-16 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6 sm:pr-24">
                  <div className="aspect-square overflow-hidden bg-white shadow-[0_0_0_1px_rgba(44,57,140,0.65)]">
                    {heroArtworkUrl ? (
                      <img
                        alt={`Artwork for ${heroTitle}`}
                        className="h-full w-full object-cover"
                        src={heroArtworkUrl}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-card p-5">
                        <img alt="" className="w-full max-w-[88px] sm:max-w-[132px]" src="/logo.png" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 self-center text-left">
                    <div
                      className="text-[0.66rem] font-medium uppercase tracking-[0.18em] text-white/62 sm:text-[0.8rem] sm:tracking-[0.22em]"
                      data-testid="hero-date"
                    >
                      {heroDate}
                    </div>
                    <HeroTitle align="left" motion={motion} title={heroTitle} />
                    {heroPresenter ? (
                      <div
                        className="mt-1.5 text-[1rem] leading-[1.12] text-white/68 sm:mt-2 sm:text-[1.65rem]"
                        data-testid="hero-presenter-line"
                      >
                        <span className="text-white/52">with </span>
                        <span className="font-medium text-white">{heroPresenter}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <audio className="hidden" crossOrigin="anonymous" preload="none" ref={handleAudioRef} />

                <div className="mt-5 sm:mt-6">
                  <PublicPlayerControl
                    isLoading={isLoading}
                    isPlaying={isPlaying}
                    motion={motion}
                    onTogglePlayback={handlePlayPause}
                  />
                </div>

                {heroMixcloudUrl ? (
                  <div className="mt-5 flex justify-center sm:mt-6">
                    <a
                      className="inline-flex items-center justify-center border border-white/12 bg-black/20 px-5 py-2.5 text-sm font-medium uppercase tracking-[0.18em] text-white transition hover:bg-white/8"
                      href={heroMixcloudUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      listen on Mixcloud
                    </a>
                  </div>
                ) : null}

                {error ? <p className="mt-4 text-sm text-[#ff9d9d]">{error}</p> : null}
              </div>
            </div>
          </div>

          <div className="mt-3 grid w-full max-w-[680px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-cobalt px-3 py-2.5 text-white sm:mt-4 sm:gap-3 sm:px-4 sm:py-3">
            <div className="text-[0.62rem] uppercase tracking-[0.22em] text-white/70 sm:text-[0.7rem] sm:tracking-[0.26em]">
              stream url
            </div>
            <div className="overflow-hidden bg-black px-3 py-1.5 font-mono text-[0.78rem] text-[#00ff3a] sm:px-4 sm:py-2 sm:text-[0.95rem]">
              <div className="truncate">{displayStreamUrl}</div>
            </div>
            <button
              aria-label="Copy stream URL"
              className="flex h-9 w-9 items-center justify-center bg-cobalt text-white transition hover:bg-white/10"
              onClick={() => void copyStreamUrl()}
              type="button"
            >
              {copied ? (
                <span className="text-[0.62rem] uppercase tracking-[0.18em] text-[#00ff3a]">ok</span>
              ) : (
                <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
                  <rect height="10" width="10" x="9" y="9" />
                  <path d="M5 15V5h10" />
                </svg>
              )}
            </button>
          </div>
        </section>

        {episodes.length > 0 ? (
          <section className="mx-auto w-full max-w-[760px] pb-10">
            <details className="bg-cobalt p-2.5" data-testid="up-next-accordion" open>
              <summary className="list-none cursor-pointer bg-card px-4 py-3 text-ink sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.68rem] uppercase tracking-[0.26em] text-ink/65 sm:text-[0.72rem] sm:tracking-[0.28em]">
                      next up
                    </div>
                    <div className="mt-1 text-sm text-ink/55">
                      {upcomingEpisodes.length} episode{upcomingEpisodes.length === 1 ? '' : 's'} in rotation
                    </div>
                  </div>
                  <div className="text-[0.68rem] uppercase tracking-[0.22em] text-ink/45">open</div>
                </div>
              </summary>

              <div className="bg-card px-2 pb-2 sm:px-3 sm:pb-3">
                {upcomingEpisodes.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-ink/60">No additional episodes are queued in rotation right now.</div>
                ) : (
                  <div className="space-y-1">
                    {upcomingEpisodes.map((episode) => (
                      <article
                        key={episode.id}
                        className="grid items-center gap-3 bg-white px-3 py-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)] sm:grid-cols-[minmax(0,1fr)_auto] sm:px-4"
                      >
                        <div className="min-w-0">
                          <div className="text-[0.82rem] text-ink/58 sm:text-sm">
                            {formatBroadcastDate(episode.broadcastDate) ?? episode.slug}
                          </div>
                          <div className="mt-1 text-sm font-medium leading-tight sm:text-base">
                            {formatEpisodeDisplayTitle(episode)}
                          </div>
                        </div>
                        {episode.mixcloudUrl ? (
                          <a
                            className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-ink transition hover:text-cobalt"
                            href={episode.mixcloudUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            mixcloud
                          </a>
                        ) : (
                          <div className="text-[0.68rem] uppercase tracking-[0.18em] text-ink/35">local only</div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </section>
        ) : null}
      </main>
    </div>
  );
}
