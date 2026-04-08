import { FormEvent, useEffect, useState } from 'react';
import {
  requestData,
  type CreatedStreamApiKey,
  type EpisodeSummary,
  type StreamApiKeyRecord,
} from '../api/client';
import { Panel } from '../components/Panel';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

const POLL_INTERVAL_MS = 10_000;

function formatUsageTimestamp(value: string | null): string {
  if (!value) {
    return 'never used';
  }

  return new Date(value).toLocaleString();
}

export function StreamPage() {
  const [queue, setQueue] = useState<string[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [apiKeys, setApiKeys] = useState<StreamApiKeyRecord[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [keyLabel, setKeyLabel] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedStreamApiKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setError(null);
      const [queueItems, nextEpisodes, nextApiKeys] = await Promise.all([
        requestData<string[]>('/api/admin/stream/queue'),
        requestData<EpisodeSummary[]>('/api/admin/episodes?limit=50'),
        requestData<StreamApiKeyRecord[]>('/api/admin/stream/api-keys'),
      ]);
      setQueue(queueItems);
      const readyEpisodes = nextEpisodes.filter((episode) => episode.status === 'ready');
      setEpisodes(readyEpisodes);
      setApiKeys(nextApiKeys);
      setSelectedEpisodeId((current) => current || readyEpisodes[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load stream controls');
    }
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function enqueueEpisode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedEpisodeId) return;

    try {
      const result = await requestData<{ requestId: string | null; raw: string[] }>('/api/admin/stream/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: selectedEpisodeId }),
      });
      setMessage(`Queued request ${result.requestId ?? 'unknown'}`);
      await refresh();
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Failed to queue episode');
    }
  }

  async function skipTrack(): Promise<void> {
    try {
      await requestData('/api/admin/stream/skip', { method: 'POST' });
      setMessage('Sent skip command to Liquidsoap');
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : 'Failed to skip track');
    }
  }

  async function restartCurrent(): Promise<void> {
    setError(null);
    try {
      const result = await requestData<{ restartedFilePath: string; requestId: string | null }>(
        '/api/admin/stream/restart-current',
        { method: 'POST' },
      );
      setMessage(`Restarted current episode (request ${result.requestId ?? 'unknown'})`);
      await refresh();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : 'Failed to restart current episode');
    }
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const label = keyLabel.trim();
    if (!label) return;

    try {
      setError(null);
      const result = await requestData<CreatedStreamApiKey>('/api/admin/stream/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      setCreatedKey(result);
      setKeyLabel('');
      setMessage(`Created integration key for ${result.record.label}`);
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create API key');
    }
  }

  async function revokeApiKey(apiKey: StreamApiKeyRecord): Promise<void> {
    try {
      setError(null);
      await requestData<StreamApiKeyRecord>(`/api/admin/stream/api-keys/${apiKey.id}/revoke`, {
        method: 'POST',
      });
      setMessage(`Revoked API key for ${apiKey.label}`);
      await refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke API key');
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Queue" subtitle="control">
        <form className="flex flex-col gap-4 md:flex-row" onSubmit={(event) => void enqueueEpisode(event)}>
          <select
            className="flex-1 bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
            onChange={(event) => setSelectedEpisodeId(event.target.value)}
            value={selectedEpisodeId}
          >
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>
                {formatEpisodeDisplayTitle(episode)}
              </option>
            ))}
          </select>
          <button className="bg-butter px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink" type="submit">
            queue
          </button>
          <button
            className="bg-ink px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white"
            onClick={() => void skipTrack()}
            type="button"
          >
            skip
          </button>
          <button
            className="bg-cobalt px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white"
            onClick={() => void restartCurrent()}
            type="button"
          >
            restart current
          </button>
        </form>
        {message ? <p className="mt-4 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </Panel>

      <Panel title="Requests" subtitle="raw">
        <div className="space-y-3">
          {queue.length === 0 ? (
            <div className="bg-white px-4 py-4 text-sm text-ink/65 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">Queue is empty.</div>
          ) : (
            queue.map((entry) => (
              <div key={entry} className="bg-white px-4 py-4 font-mono text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
                {entry}
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel title="Integration Keys" subtitle="read only">
        <form className="flex flex-col gap-4 md:flex-row" onSubmit={(event) => void createApiKey(event)}>
          <div className="flex-1">
            <label className="mb-2 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60" htmlFor="stream-api-key-label">
              Key label
            </label>
            <input
              className="w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              id="stream-api-key-label"
              onChange={(event) => setKeyLabel(event.target.value)}
              placeholder="External site"
              value={keyLabel}
            />
          </div>
          <button
            className="self-end bg-butter px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink"
            type="submit"
          >
            create key
          </button>
        </form>

        {createdKey ? (
          <div className="mt-4 bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
            <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/55">save this key now</div>
            <p className="mt-2 text-sm text-ink/75">This secret is only shown once.</p>
            <code className="mt-3 block overflow-x-auto bg-ink px-4 py-3 text-sm text-white">{createdKey.key}</code>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {apiKeys.length === 0 ? (
            <div className="bg-white px-4 py-4 text-sm text-ink/65 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
              No integration keys created yet.
            </div>
          ) : (
            apiKeys.map((apiKey) => (
              <div
                key={apiKey.id}
                className="flex flex-col gap-3 bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(20,20,19,0.08)] md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-ink">{apiKey.label}</div>
                  <div className="font-mono text-sm text-ink/70">{apiKey.keyPrefix}</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-ink/55">
                    {apiKey.revokedAt ? 'revoked' : 'active'}
                  </div>
                  <div className="text-xs text-ink/60">last used {formatUsageTimestamp(apiKey.lastUsedAt)}</div>
                </div>
                {!apiKey.revokedAt ? (
                  <button
                    aria-label={`Revoke ${apiKey.label}`}
                    className="bg-ink px-4 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white"
                    onClick={() => void revokeApiKey(apiKey)}
                    type="button"
                  >
                    revoke
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
