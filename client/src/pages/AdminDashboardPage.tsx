import { useEffect, useState } from 'react';
import { requestData, type IngestJobRecord, type NowPlaying, type StreamStatus } from '../api/client';
import { Panel } from '../components/Panel';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

const POLL_INTERVAL_MS = 10_000;

export function AdminDashboardPage() {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [jobs, setJobs] = useState<IngestJobRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        const [nextStatus, current, recentJobs] = await Promise.all([
          requestData<StreamStatus>('/api/stream/status'),
          requestData<NowPlaying | null>('/api/stream/now-playing'),
          requestData<IngestJobRecord[]>('/api/admin/ingest/jobs?limit=5'),
        ]);
        setStatus(nextStatus);
        setNowPlaying(current);
        setJobs(recentJobs);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard');
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
    <div className="space-y-6">
      <Panel title="Overview" subtitle="live">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-butter p-5">
            <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">stream</div>
            <div className="mt-2 text-3xl font-medium">{status?.online ? 'online' : 'offline'}</div>
            <p className="mt-2 text-sm text-ink/70">queue {status?.queueLength ?? 0}</p>
          </div>
          <div className="bg-white p-5 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
            <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">library</div>
            <div className="mt-2 text-3xl font-medium">{status?.librarySize ?? 0}</div>
            <p className="mt-2 text-sm text-ink/70">ready items</p>
          </div>
          <div className="bg-panel p-5 text-white">
            <div className="text-[0.68rem] uppercase tracking-[0.24em] text-white/55">now playing</div>
            <div className="mt-2 break-words text-2xl font-medium [overflow-wrap:anywhere]">
              {nowPlaying?.episode ? formatEpisodeDisplayTitle(nowPlaying.episode) : 'no match'}
            </div>
            <p className="mt-2 text-sm text-white/75">
              {nowPlaying?.track
                ? `${nowPlaying.track.artist ?? 'Unknown Artist'} — ${nowPlaying.track.title ?? 'Untitled'}`
                : 'no track metadata'}
            </p>
          </div>
        </div>
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </Panel>

      <Panel title="Jobs" subtitle="recent">
        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left text-[0.68rem] uppercase tracking-[0.24em] text-ink/50">
                <th className="pb-2">episode</th>
                <th className="pb-2">status</th>
                <th className="pb-2">source</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="bg-white shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
                  <td className="px-4 py-3 text-sm font-medium break-words [overflow-wrap:anywhere]">
                    {job.episodeTitle
                      ? formatEpisodeDisplayTitle({
                          title: job.episodeTitle,
                          presenter: job.episodePresenter,
                        })
                      : 'Pending episode'}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink/70">{job.status}</td>
                  <td className="px-4 py-3 text-xs text-ink/60 break-all">{job.sourcePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
