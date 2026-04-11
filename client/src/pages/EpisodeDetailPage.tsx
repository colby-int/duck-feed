import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  approveTrack,
  deleteEpisode,
  deleteTrack,
  requestData,
  triggerEpisodeFingerprint,
  updateTrack,
  type EpisodeDetail,
  type TrackRecord,
} from '../api/client';
import { Panel } from '../components/Panel';
import { formatEpisodeDisplayTitle } from '../lib/episode-display-title';

type TrackFilter = 'all' | 'manual' | 'acoustid' | 'unreviewed';

const POLL_INTERVAL_MS = 5_000;

interface TrackEditDraft {
  title: string;
  artist: string;
  position: string;
}

export function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<EpisodeDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>('all');
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [trackDraft, setTrackDraft] = useState<TrackEditDraft>({ title: '', artist: '', position: '' });
  const metadataFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }

    const loadDetail = async () => {
      try {
        setError(null);
        const nextDetail = await requestData<EpisodeDetail>(`/api/admin/episodes/${id}`);
        // Background poll must not overwrite metadata the user is currently
        // editing — re-renders would reset the input value to the last saved
        // state while they're typing. Skip the overwrite if focus is inside
        // the metadata form. Autosave on blur re-syncs once they finish.
        if (metadataFormRef.current?.contains(document.activeElement)) {
          return;
        }
        setDetail(nextDetail);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load episode detail');
      }
    };

    void loadDetail();
    const interval = window.setInterval(() => {
      void loadDetail();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [id]);

  async function refreshDetail(): Promise<void> {
    if (!id) return;
    setDetail(await requestData<EpisodeDetail>(`/api/admin/episodes/${id}`));
  }

  async function persistEpisode(): Promise<void> {
    if (!detail) return;

    try {
      setError(null);
      const savedDetail = await requestData<EpisodeDetail>(`/api/admin/episodes/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: detail.title,
          presenter: detail.presenter?.trim() ? detail.presenter.trim() : null,
          slug: detail.slug,
          broadcastDate: detail.broadcastDate?.trim() ? detail.broadcastDate : null,
          description: detail.description?.trim() ? detail.description : null,
          mixcloudUrl: detail.mixcloudUrl?.trim() ? detail.mixcloudUrl.trim() : null,
        }),
      });
      setDetail(savedDetail);
      setMessage('Episode saved');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save episode');
    }
  }

  async function saveEpisode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await persistEpisode();
  }

  async function addTrack(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;

    const form = new FormData(event.currentTarget);
    try {
      await requestData<TrackRecord>(`/api/admin/episodes/${detail.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: String(form.get('title') ?? ''),
          artist: String(form.get('artist') ?? ''),
          position: detail.tracks.length + 1,
        }),
      });
      await refreshDetail();
      event.currentTarget.reset();
      setMessage('Track added');
    } catch (trackError) {
      setError(trackError instanceof Error ? trackError.message : 'Failed to add track');
    }
  }

  async function runFingerprint(): Promise<void> {
    if (!detail) return;
    // Re-runs are destructive: they delete existing acoustid-source tracks for
    // this episode before re-querying. Manual tracks are preserved. Confirm.
    const confirmed = window.confirm(
      'Run fingerprint? This deletes existing AcoustID-sourced tracks for this episode and re-queries AcoustID. Manual tracks are preserved.',
    );
    if (!confirmed) return;

    setFingerprintBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await triggerEpisodeFingerprint(detail.id);
      await refreshDetail();
      setMessage(
        result.matches.length > 0
          ? `Fingerprint complete: ${result.insertedCount} match${result.insertedCount === 1 ? '' : 'es'} inserted`
          : 'Fingerprint complete: no matches found',
      );
    } catch (fpError) {
      setError(fpError instanceof Error ? fpError.message : 'Fingerprint failed');
    } finally {
      setFingerprintBusy(false);
    }
  }

  async function handleApprove(track: TrackRecord): Promise<void> {
    if (!detail) return;
    try {
      await approveTrack(detail.id, track.id);
      await refreshDetail();
      setMessage('Track approved');
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Failed to approve track');
    }
  }

  async function handleDeleteTrack(track: TrackRecord): Promise<void> {
    if (!detail) return;
    const label = track.title ?? 'this track';
    if (!window.confirm(`Delete "${label}"?`)) return;
    try {
      await deleteTrack(detail.id, track.id);
      await refreshDetail();
      setMessage('Track deleted');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete track');
    }
  }

  function startEditTrack(track: TrackRecord): void {
    setEditingTrackId(track.id);
    setTrackDraft({
      title: track.title ?? '',
      artist: track.artist ?? '',
      position: track.position?.toString() ?? '',
    });
  }

  function cancelEditTrack(): void {
    setEditingTrackId(null);
    setTrackDraft({ title: '', artist: '', position: '' });
  }

  async function saveEditTrack(track: TrackRecord): Promise<void> {
    if (!detail) return;
    const trimmedTitle = trackDraft.title.trim();
    const trimmedArtist = trackDraft.artist.trim();
    const positionRaw = trackDraft.position.trim();
    const parsedPosition = positionRaw === '' ? null : Number.parseInt(positionRaw, 10);
    if (parsedPosition !== null && (!Number.isFinite(parsedPosition) || parsedPosition < 0)) {
      setError('Position must be a non-negative integer');
      return;
    }
    try {
      await updateTrack(detail.id, track.id, {
        title: trimmedTitle.length > 0 ? trimmedTitle : (track.title ?? ''),
        artist: trimmedArtist.length > 0 ? trimmedArtist : null,
        position: parsedPosition,
      });
      cancelEditTrack();
      await refreshDetail();
      setMessage('Track updated');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update track');
    }
  }

  async function handleDeleteEpisode(): Promise<void> {
    if (!detail) return;
    const confirmed = window.confirm(
      `Delete episode "${formatEpisodeDisplayTitle(detail)}"? This removes the database record and its tracks. The library audio file is left in place.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteEpisode(detail.id);
      navigate('/admin/episodes');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete episode');
      setDeleting(false);
    }
  }

  function filterTracks(allTracks: TrackRecord[]): TrackRecord[] {
    switch (trackFilter) {
      case 'manual':
        return allTracks.filter((t) => (t.source ?? 'manual') === 'manual');
      case 'acoustid':
        return allTracks.filter((t) => t.source === 'acoustid');
      case 'unreviewed':
        return allTracks.filter((t) => t.source === 'acoustid' && !t.reviewed);
      case 'all':
      default:
        return allTracks;
    }
  }

  function handleMetadataBlur(): void {
    void persistEpisode();
  }

  if (!id) {
    return (
      <Panel title="Episode" subtitle="not found">
        <p className="text-sm text-ink/70">No episode id supplied.</p>
      </Panel>
    );
  }

  if (!detail) {
    return (
      <Panel title="Loading…" subtitle="episode">
        {error ? <p className="text-sm text-red-700">{error}</p> : <p className="text-sm text-ink/70">Loading episode…</p>}
        <div className="mt-4">
          <Link className="text-sm uppercase tracking-[0.18em] text-cobalt" to="/admin/episodes">
            ← back to episodes
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link className="text-sm uppercase tracking-[0.18em] text-cobalt hover:underline" to="/admin/episodes">
          ← back to episodes
        </Link>
        <button
          type="button"
          onClick={() => void handleDeleteEpisode()}
          disabled={deleting}
          className="bg-white px-4 py-2 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-red-700 shadow-[0_0_0_1px_rgba(185,28,28,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? 'deleting…' : 'delete episode'}
        </button>
      </div>

      <Panel title={formatEpisodeDisplayTitle(detail)} subtitle="edit">
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => void saveEpisode(event)}
          ref={metadataFormRef}
        >
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Title</span>
            <input
              className="w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onBlur={handleMetadataBlur}
              onChange={(event) => setDetail({ ...detail, title: event.target.value })}
              value={detail.title}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Presenter</span>
            <input
              className="w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onBlur={handleMetadataBlur}
              onChange={(event) => setDetail({ ...detail, presenter: event.target.value })}
              value={detail.presenter ?? ''}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Slug</span>
            <input
              className="w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onBlur={handleMetadataBlur}
              onChange={(event) => setDetail({ ...detail, slug: event.target.value })}
              value={detail.slug}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Broadcast Date</span>
            <input
              className="w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onBlur={handleMetadataBlur}
              onChange={(event) => setDetail({ ...detail, broadcastDate: event.target.value })}
              type="date"
              value={detail.broadcastDate ?? ''}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Status</span>
            <div className="bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
              <div className="text-sm font-medium">{detail.status ?? 'pending'}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-ink/55">
                {detail.autoQueuedAt ? 'auto queued' : 'system managed'}
              </div>
            </div>
          </label>
          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium">Description</span>
            <textarea
              className="min-h-32 w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onBlur={handleMetadataBlur}
              onChange={(event) => setDetail({ ...detail, description: event.target.value })}
              value={detail.description ?? ''}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium">Mixcloud URL</span>
            <input
              className="w-full bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onBlur={handleMetadataBlur}
              onChange={(event) => setDetail({ ...detail, mixcloudUrl: event.target.value })}
              value={detail.mixcloudUrl ?? ''}
            />
          </label>
          <div className="md:col-span-2">
            <button className="bg-panel px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white" type="submit">
              save
            </button>
          </div>
        </form>
        {message ? <p className="mt-4 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </Panel>

      <Panel title="Tracks" subtitle="review">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'manual', 'acoustid', 'unreviewed'] as TrackFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTrackFilter(value)}
                className={[
                  'px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] shadow-[0_0_0_1px_rgba(20,20,19,0.08)]',
                  trackFilter === value ? 'bg-panel text-white' : 'bg-white text-ink/80 hover:bg-butter/40',
                ].join(' ')}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void runFingerprint()}
            disabled={fingerprintBusy || detail.status !== 'ready' || !detail.filePath}
            className="ml-auto bg-butter px-4 py-2 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-ink shadow-[0_0_0_1px_rgba(20,20,19,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
            title={
              detail.status !== 'ready'
                ? 'Episode must be ready'
                : !detail.filePath
                ? 'Episode has no library file'
                : 'Re-run AcoustID fingerprinting'
            }
          >
            {fingerprintBusy ? 'fingerprinting…' : 'run fingerprint'}
          </button>
        </div>

        <div className="space-y-3">
          {filterTracks(detail.tracks).length === 0 ? (
            <p className="text-sm text-ink/60">No tracks match this filter.</p>
          ) : (
            filterTracks(detail.tracks).map((track) => {
              const source = track.source ?? 'manual';
              const isAcoustid = source === 'acoustid';
              const reviewed = track.reviewed === true;
              const isEditing = editingTrackId === track.id;

              if (isEditing) {
                return (
                  <div
                    key={track.id}
                    className="flex flex-col gap-3 bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                  >
                    <div className="grid gap-3 md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)]">
                      <input
                        aria-label="Position"
                        className="bg-parchment px-3 py-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                        inputMode="numeric"
                        onChange={(event) => setTrackDraft({ ...trackDraft, position: event.target.value })}
                        placeholder="#"
                        value={trackDraft.position}
                      />
                      <input
                        aria-label="Title"
                        className="bg-parchment px-3 py-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                        onChange={(event) => setTrackDraft({ ...trackDraft, title: event.target.value })}
                        placeholder="Title"
                        value={trackDraft.title}
                      />
                      <input
                        aria-label="Artist"
                        className="bg-parchment px-3 py-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                        onChange={(event) => setTrackDraft({ ...trackDraft, artist: event.target.value })}
                        placeholder="Artist"
                        value={trackDraft.artist}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEditTrack(track)}
                        className="bg-panel px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-white"
                      >
                        save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditTrack}
                        className="bg-white px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-ink shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={track.id}
                  className="flex flex-col gap-3 bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {track.position ?? '—'}. {track.title ?? 'Untitled'}
                      </span>
                      <span
                        className={[
                          'px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em]',
                          isAcoustid ? 'bg-panel text-white' : 'bg-butter text-ink',
                        ].join(' ')}
                      >
                        {source}
                      </span>
                      {isAcoustid && !reviewed ? (
                        <span className="bg-amber-200 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-amber-900">
                          unreviewed
                        </span>
                      ) : null}
                      {isAcoustid && reviewed ? (
                        <span className="bg-emerald-200 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-emerald-900">
                          approved
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-ink/65">{track.artist ?? 'Unknown Artist'}</div>
                    {isAcoustid && typeof track.acoustidScore === 'number' ? (
                      <div className="mt-1 text-[0.65rem] uppercase tracking-[0.16em] text-ink/55">
                        score {(track.acoustidScore * 100).toFixed(0)}%
                        {track.musicbrainzId ? ` · mbid ${track.musicbrainzId.slice(0, 8)}` : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {isAcoustid && !reviewed ? (
                      <button
                        type="button"
                        onClick={() => void handleApprove(track)}
                        className="bg-emerald-600 px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-white"
                      >
                        approve
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startEditTrack(track)}
                      className="bg-white px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-ink shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTrack(track)}
                      className="bg-white px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-red-700 shadow-[0_0_0_1px_rgba(185,28,28,0.4)]"
                    >
                      {isAcoustid && !reviewed ? 'reject' : 'delete'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <form className="mt-5 grid gap-4 md:grid-cols-3" onSubmit={(event) => void addTrack(event)}>
          <input
            className="bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
            name="title"
            placeholder="Track title"
            required
          />
          <input className="bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]" name="artist" placeholder="Artist" />
          <button className="bg-butter px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink" type="submit">
            add
          </button>
        </form>
      </Panel>
    </div>
  );
}
