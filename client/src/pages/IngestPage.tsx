import { FormEvent, useEffect, useState } from 'react';
import { requestData, type IngestJobRecord, uploadEpisode } from '../api/client';
import { Panel } from '../components/Panel';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

const POLL_INTERVAL_MS = 5_000;

export function IngestPage() {
  const [jobs, setJobs] = useState<IngestJobRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadJobs(): Promise<void> {
    try {
      setError(null);
      setJobs(await requestData<IngestJobRecord[]>('/api/admin/ingest/jobs?limit=20'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load ingest jobs');
    }
  }

  useEffect(() => {
    void loadJobs();
    const interval = window.setInterval(() => {
      void loadJobs();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedFile) return;

    try {
      const result = await uploadEpisode(selectedFile);
      setMessage(`Uploaded ${result.filename} to dropzone`);
      setSelectedFile(null);
      await loadJobs();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Upload" subtitle="dropzone">
        <form className="flex flex-col gap-4 md:flex-row" onSubmit={(event) => void handleUpload(event)}>
          <input
            accept="audio/*"
            className="flex-1 bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <button
            className="bg-panel px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white disabled:opacity-60"
            disabled={!selectedFile}
            type="submit"
          >
            upload
          </button>
        </form>
        {message ? <p className="mt-4 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </Panel>

      <Panel title="Jobs" subtitle="history">
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/50">{job.status}</div>
                  <div className="mt-1 text-lg font-medium">
                    {job.episodeTitle
                      ? formatEpisodeDisplayTitle({
                          title: job.episodeTitle,
                          presenter: job.episodePresenter,
                        })
                      : 'Pending episode record'}
                  </div>
                </div>
                <div className="text-xs text-ink/55">{job.sourcePath}</div>
              </div>
              {job.errorMessage ? <p className="mt-3 text-sm text-red-700">{job.errorMessage}</p> : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
