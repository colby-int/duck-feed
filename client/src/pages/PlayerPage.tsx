import { useEffect, useState } from 'react';
import {
  getStreamAudioUrl,
  getStreamSnapshot,
  requestData,
  type EpisodeSummary,
  type LiveModeInfo,
  type NowPlaying,
  type StreamSnapshot,
  type StreamStatus,
} from '../api/client';
import { HeroTitle } from '../components/hero-title';
import { EpisodeDisplayTitleText } from '../components/episode-display-title-text';
import { PublicPlayerControl } from '../components/public-player-control';
import { useSiteAppearance } from '../hooks/use-site-appearance';
import { useAudioMotion } from '../hooks/use-audio-motion';
import { useMediaSession } from '../hooks/use-media-session';

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
  const { appearance } = useSiteAppearance();
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveModeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const { activate: activateAudioMotion, motion } = useAudioMotion(audioElement, isLoading || isPlaying);

  useEffect(() => {
    const load = async () => {
      try {
        const [archive, snapshot] = await Promise.all([
          requestData<EpisodeSummary[]>('/api/episodes?limit=12'),
          getStreamSnapshot(),
        ]);
        setEpisodes(archive);
        setStreamStatus(snapshot.status);
        setNowPlaying(snapshot.nowPlaying);
        setLiveInfo(snapshot.live);
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
    source.addEventListener('stream-mode', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as {
        mode: StreamSnapshot['mode'];
        live: LiveModeInfo;
      };
      setLiveInfo(next.live);
      setStreamStatus((prev) => (prev ? { ...prev, mode: next.mode } : prev));
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

  function handlePlay(): void {
    const el = audioElement;
    if (!el) return;
    activateAudioMotion();
    // Always reconnect with a fresh URL on every play. Cheap insurance against
    // stale connections from prior sessions or background tabs.
    reconnectAudio(true);
  }

  function handlePause(): void {
    const el = audioElement;
    if (!el) return;
    el.pause();
  }

  function handlePlayPause(): void {
    const el = audioElement;
    if (!el) return;
    if (el.paused) {
      handlePlay();
    } else {
      handlePause();
    }
  }

  function handleAudioRef(nextAudioElement: HTMLAudioElement | null): void {
    setAudioElement(nextAudioElement);
  }

  const fallbackEpisode = episodes[0] ?? null;
  const streamMode = streamStatus?.mode ?? null;
  const isStreamOnline = streamMode === 'live' || streamMode === 'archive';
  const isLiveMode = streamMode === 'live';
  const currentEpisode = nowPlaying?.episode ?? null;
  const displayEpisode = isLiveMode
    ? null
    : currentEpisode ?? fallbackEpisode;
  const displayedEpisodeId = displayEpisode?.id ?? null;
  const heroTitle = isLiveMode
    ? liveInfo?.sourceName ?? 'On Air Now'
    : displayEpisode?.title ?? 'duckfeed';
  const heroPresenter = isLiveMode ? null : displayEpisode?.presenter ?? null;
  const heroArtworkUrl = isLiveMode ? null : displayEpisode?.artworkUrl ?? null;
  const heroMixcloudUrl = isLiveMode ? null : displayEpisode?.mixcloudUrl ?? null;
  const heroDate = isLiveMode
    ? 'Live broadcast'
    : formatBroadcastDate(displayEpisode?.broadcastDate) ?? 'Live archive stream';
  const upcomingEpisodes = episodes.filter((episode) => episode.id !== displayedEpisodeId).slice(0, 6);
  const nextUpcomingEpisode = upcomingEpisodes[0] ?? null;
  const queuedEpisodes = upcomingEpisodes.slice(1);
  const nextUpcomingDate = formatBroadcastDate(nextUpcomingEpisode?.broadcastDate);
  const liveBadgeLabel =
    streamStatus == null
      ? 'checking'
      : streamMode === 'live'
      ? 'live'
      : streamMode === 'archive'
      ? 'archive'
      : 'offline';
  useMediaSession({
    episode: heroTitle
      ? {
          artworkUrl: heroArtworkUrl,
          broadcastDate: displayEpisode?.broadcastDate ?? null,
          presenter: heroPresenter,
          title: heroTitle,
        }
      : null,
    isPlaying,
    onPause: handlePause,
    onPlay: handlePlay,
  });

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
    <div className="min-h-screen bg-brand text-brandtext">
      <main className="mx-auto flex min-h-screen max-w-[980px] flex-col px-4 py-8 sm:px-6 sm:py-14">
        <section className="flex min-h-[82vh] flex-col items-center justify-center">
          <h1 className="sr-only">duckfeed Radio</h1>
          <img alt="duckfeed" className="w-[200px] sm:w-[280px]" src={appearance.logoUrl} />

          <div className="mt-6 w-full max-w-[760px] sm:mt-10">
            <div className="bg-cobalt p-2.5 shadow-[0_18px_36px_-22px_rgba(20,20,19,0.55)] sm:p-3.5">
              <div className="relative bg-panel px-4 py-5 text-white sm:px-7 sm:py-7">
                <div className="absolute right-4 top-4 flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.26em] sm:right-6 sm:top-5 sm:text-[0.76rem] sm:tracking-[0.28em]">
                  <span
                    className={[
                      'h-2.5 w-2.5 rounded-full',
                      isStreamOnline ? 'live-badge-dot--online bg-[#00ff3a]' : 'bg-white/35',
                    ].join(' ')}
                  />
                  <span className={isStreamOnline ? 'live-badge-text--online text-[#00ff3a]' : 'text-white/60'}>
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
                        <img alt="" className="w-full max-w-[88px] sm:max-w-[132px]" src={appearance.logoUrl} />
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

          {episodes.length > 0 ? (
            <div className="mt-3 w-full max-w-[760px] sm:mt-4">
              <details
                className="bg-cobalt p-2.5 shadow-[0_18px_36px_-22px_rgba(20,20,19,0.5)]"
                data-testid="up-next-accordion"
                open={isQueueOpen}
                onToggle={(event) => setIsQueueOpen((event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="list-none cursor-pointer bg-panel px-4 py-3 text-white sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.68rem] uppercase tracking-[0.26em] text-white/70 sm:text-[0.72rem] sm:tracking-[0.28em]">
                        next up
                      </div>
                      {nextUpcomingEpisode ? (
                        <>
                          <EpisodeDisplayTitleText
                            className="mt-1.5 block min-w-0 [overflow-wrap:anywhere]"
                            episode={nextUpcomingEpisode}
                            primaryClassName="block text-sm font-medium leading-tight text-white sm:text-base"
                            secondaryClassName="mt-0.5 block text-[0.72rem] leading-snug text-white/70 sm:text-[0.82rem]"
                            singleLineClassName="block text-sm font-medium leading-tight text-white sm:text-base"
                          />
                          {nextUpcomingDate ? (
                            <div className="mt-0.5 text-[0.7rem] text-white/55 sm:text-xs">
                              {nextUpcomingDate}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="mt-1 text-sm text-white/55">Nothing queued in rotation</div>
                      )}
                    </div>
                    <span
                      aria-hidden="true"
                      className={[
                        'flex h-7 w-7 shrink-0 items-center justify-center text-white/70 transition-transform duration-200',
                        isQueueOpen ? 'rotate-180' : '',
                      ].join(' ')}
                    >
                      <svg
                        fill="none"
                        height="18"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="18"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </div>
                </summary>

                <div className="bg-panel px-2 pb-2 sm:px-3 sm:pb-3">
                  {queuedEpisodes.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-white/60">No additional episodes are queued in rotation right now.</div>
                  ) : (
                    <div className="space-y-1">
                      {queuedEpisodes.map((episode) => (
                        <article
                          key={episode.id}
                          className="grid items-center gap-3 bg-white/[0.04] px-3 py-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] sm:grid-cols-[minmax(0,1fr)_auto] sm:px-4"
                        >
                          <div className="min-w-0">
                            <div className="text-[0.82rem] text-white/55 sm:text-sm">
                              {formatBroadcastDate(episode.broadcastDate) ?? episode.slug}
                            </div>
                            <EpisodeDisplayTitleText
                              className="mt-1 block [overflow-wrap:anywhere]"
                              episode={episode}
                              primaryClassName="block text-sm font-medium leading-tight text-white sm:text-base"
                              secondaryClassName="mt-0.5 block text-[0.76rem] leading-snug text-white/70 sm:text-[0.84rem]"
                              singleLineClassName="block text-sm font-medium leading-tight text-white sm:text-base"
                            />
                          </div>
                          {episode.mixcloudUrl ? (
                            <a
                              className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-white/80 transition hover:text-[#00ff3a]"
                              href={episode.mixcloudUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              mixcloud
                            </a>
                          ) : (
                            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-white/30">local only</div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </div>
          ) : null}

          <div className="mt-3 grid w-full max-w-[680px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-cobalt px-3 py-2.5 text-white shadow-[0_14px_28px_-18px_rgba(20,20,19,0.5)] sm:mt-4 sm:gap-3 sm:px-4 sm:py-3">
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

          <a
            className="group mt-3 inline-flex items-center gap-[1.05rem] bg-butter py-[0.6rem] pl-[0.6rem] pr-[1.2rem] text-ink shadow-[0_0_0_1px_rgba(20,20,19,0.12),0_10px_22px_-14px_rgba(20,20,19,0.45)] transition hover:brightness-[0.96] sm:mt-4"
            href="https://www.duckradio.live/"
            rel="noreferrer"
            target="_blank"
          >
            <img alt="" className="h-[1.8rem] w-[1.8rem] transition-transform duration-200 group-hover:-translate-y-px" src="/duckradio.png" />
            <span className="text-[0.94rem] font-semibold tracking-[-0.02em] sm:text-[1.02rem]">
              go to duck radio
            </span>
          </a>
        </section>
      </main>
    </div>
  );
}
