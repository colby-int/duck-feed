import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { requestData, type IngestJobRecord, uploadEpisodeWithProgress } from '../api/client';
import { Panel } from '../components/Panel';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

const POLL_INTERVAL_MS = 5_000;
const AUDIO_FILE_PATTERN = /\.(aac|aif|aiff|alac|flac|m4a|mp3|ogg|opus|wav)$/i;

type QueueEntryStatus = 'pending' | 'uploading' | 'done' | 'error';

interface QueueEntry {
  id: string;
  file: File;
  status: QueueEntryStatus;
  progress: number;
  error: string | null;
  abortController: AbortController | null;
}

function createQueueEntryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_FILE_PATTERN.test(file.name);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatQueueStatus(entry: QueueEntry): string {
  switch (entry.status) {
    case 'uploading':
      return 'Uploading';
    case 'done':
      return 'Uploaded';
    case 'error':
      return 'Failed';
    default:
      return 'Waiting';
  }
}

export function IngestPage() {
  const [jobs, setJobs] = useState<IngestJobRecord[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef<QueueEntry[]>([]);
  const isProcessingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadJobs(): Promise<void> {
    try {
      setJobsError(null);
      setJobs(await requestData<IngestJobRecord[]>('/api/admin/ingest/jobs?limit=20'));
    } catch (loadError) {
      setJobsError(loadError instanceof Error ? loadError.message : 'Failed to load ingest jobs');
    }
  }

  function setQueueState(nextQueue: QueueEntry[] | ((currentQueue: QueueEntry[]) => QueueEntry[])): void {
    const resolvedQueue = typeof nextQueue === 'function' ? nextQueue(queueRef.current) : nextQueue;
    queueRef.current = resolvedQueue;
    setQueue(resolvedQueue);
  }

  function updateEntry(id: string, update: (entry: QueueEntry) => QueueEntry): void {
    setQueueState((currentQueue) =>
      currentQueue.map((entry) => (entry.id === id ? update(entry) : entry)),
    );
  }

  function removeEntry(id: string): void {
    setQueueState((currentQueue) => currentQueue.filter((entry) => entry.id !== id));
  }

  async function processQueue(): Promise<void> {
    if (isProcessingRef.current) {
      return;
    }

    isProcessingRef.current = true;

    try {
      while (true) {
        const nextEntry = queueRef.current.find((entry) => entry.status === 'pending');
        if (!nextEntry) {
          break;
        }

        const abortController = new AbortController();
        updateEntry(nextEntry.id, (entry) => ({
          ...entry,
          status: 'uploading',
          progress: 0,
          error: null,
          abortController,
        }));

        try {
          await uploadEpisodeWithProgress(
            nextEntry.file,
            (fraction) => {
              updateEntry(nextEntry.id, (entry) => ({
                ...entry,
                progress: Math.min(1, Math.max(0, fraction)),
              }));
            },
            abortController.signal,
          );

          updateEntry(nextEntry.id, (entry) => ({
            ...entry,
            status: 'done',
            progress: 1,
            error: null,
            abortController: null,
          }));
        } catch (uploadError) {
          if (isAbortError(uploadError)) {
            removeEntry(nextEntry.id);
          } else {
            updateEntry(nextEntry.id, (entry) => ({
              ...entry,
              status: 'error',
              error: uploadError instanceof Error ? uploadError.message : 'Upload failed',
              abortController: null,
            }));
          }
        }

        await loadJobs();
      }
    } finally {
      isProcessingRef.current = false;

      if (queueRef.current.some((entry) => entry.status === 'pending')) {
        void processQueue();
      }
    }
  }

  function enqueueFiles(files: FileList | File[]): void {
    const nextEntries = Array.from(files)
      .filter(isAudioFile)
      .map((file) => ({
        id: createQueueEntryId(),
        file,
        status: 'pending' as const,
        progress: 0,
        error: null,
        abortController: null,
      }));

    if (nextEntries.length === 0) {
      return;
    }

    setQueueState((currentQueue) => [...currentQueue, ...nextEntries]);
    void processQueue();
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) {
      enqueueFiles(event.target.files);
      event.target.value = '';
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragActive(false);

    if (event.dataTransfer.files) {
      enqueueFiles(event.dataTransfer.files);
    }
  }

  const queueSummary = {
    total: queue.length,
    pending: queue.filter((entry) => entry.status === 'pending').length,
    uploading: queue.filter((entry) => entry.status === 'uploading').length,
    done: queue.filter((entry) => entry.status === 'done').length,
    failed: queue.filter((entry) => entry.status === 'error').length,
  };

  useEffect(() => {
    void loadJobs();
    const interval = window.setInterval(() => {
      void loadJobs();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="space-y-6">
      <Panel title="Upload" subtitle="dropzone">
        <input
          ref={fileInputRef}
          multiple
          accept="audio/*"
          aria-label="Choose audio files"
          className="sr-only"
          onChange={handleFileSelection}
          type="file"
        />

        <div
          aria-label="Drop audio files here"
          className={`rounded-[1rem] border-2 border-dashed px-5 py-8 transition-colors ${
            isDragActive ? 'border-cobalt bg-cobalt/8' : 'border-ink/20 bg-parchment/35'
          }`}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/50">bulk upload</div>
              <p className="mt-2 text-lg leading-tight text-ink">
                drop audio files here or choose files to queue them for sequential ingest
              </p>
            </div>

            <button
              className="bg-panel px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              choose files
            </button>
          </div>
        </div>

        {queue.length > 0 ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-ink/60">
                {queueSummary.total} files · {queueSummary.pending} waiting · {queueSummary.uploading} uploading ·{' '}
                {queueSummary.done} done · {queueSummary.failed} failed
              </p>

              <button
                className="bg-panel px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-white"
                onClick={() =>
                  setQueueState((currentQueue) =>
                    currentQueue.filter((entry) => entry.status !== 'done' && entry.status !== 'error'),
                  )
                }
                type="button"
              >
                clear finished
              </button>
            </div>

            <div className="space-y-3">
              {queue.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-medium text-ink">{entry.file.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-ink/45">
                        {formatFileSize(entry.file.size)}
                      </div>

                      {entry.status === 'uploading' ? (
                        <div className="mt-3 flex items-center gap-3">
                          <div className="h-1.5 w-32 overflow-hidden bg-ink/10">
                            <div
                              className="h-full bg-cobalt transition-[width]"
                              style={{ width: `${Math.round(entry.progress * 100)}%` }}
                            />
                          </div>
                          <div className="text-xs tabular-nums text-ink/55">
                            {Math.round(entry.progress * 100)}%
                          </div>
                        </div>
                      ) : null}

                      {entry.error ? <p className="mt-3 text-sm text-red-700">{entry.error}</p> : null}
                    </div>

                    <div className="flex items-start gap-3 md:justify-end">
                      <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/50">
                        {formatQueueStatus(entry)}
                      </div>

                      {entry.status === 'pending' ? (
                        <button
                          aria-label={`Remove ${entry.file.name}`}
                          className="text-sm font-medium uppercase tracking-[0.18em] text-ink/60"
                          onClick={() => removeEntry(entry.id)}
                          type="button"
                        >
                          x
                        </button>
                      ) : null}

                      {entry.status === 'uploading' ? (
                        <button
                          aria-label={`Cancel ${entry.file.name}`}
                          className="text-sm font-medium uppercase tracking-[0.18em] text-ink/60"
                          onClick={() => entry.abortController?.abort()}
                          type="button"
                        >
                          x
                        </button>
                      ) : null}

                      {entry.status === 'error' ? (
                        <button
                          aria-label={`Dismiss ${entry.file.name}`}
                          className="text-sm font-medium uppercase tracking-[0.18em] text-ink/60"
                          onClick={() => removeEntry(entry.id)}
                          type="button"
                        >
                          x
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel title="Jobs" subtitle="history">
        {jobsError ? <p className="mb-4 text-sm text-red-700">{jobsError}</p> : null}

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
