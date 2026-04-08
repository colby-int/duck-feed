import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestData, type EpisodeSummary } from '../api/client';
import { Panel } from '../components/Panel';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

const POLL_INTERVAL_MS = 5_000;

export function EpisodesPage() {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        const nextEpisodes = await requestData<EpisodeSummary[]>('/api/admin/episodes?limit=50');
        setEpisodes(nextEpisodes);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load episodes');
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Panel title="Episodes" subtitle="library">
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {episodes.length === 0 && !error ? (
        <p className="text-sm text-ink/70">No episodes yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {episodes.map((episode) => (
            <Link
              key={episode.id}
              to={`/admin/episodes/${episode.id}`}
              className="block bg-white px-4 py-4 text-left transition shadow-[0_0_0_1px_rgba(20,20,19,0.08)] hover:bg-butter/40"
            >
              <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/65">
                {episode.status ?? 'pending'}
              </div>
              <div className="mt-1 text-lg font-medium leading-snug">
                {formatEpisodeDisplayTitle(episode)}
              </div>
              <div className="mt-1 truncate text-sm text-ink/70">{episode.slug}</div>
              {episode.broadcastDate ? (
                <div className="mt-2 text-[0.65rem] uppercase tracking-[0.18em] text-ink/55">
                  broadcast {episode.broadcastDate}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
