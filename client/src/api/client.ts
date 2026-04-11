export interface ApiErrorShape {
  code: string;
  message: string;
}

export interface ApiEnvelope<T> {
  data: T;
  error: ApiErrorShape | null;
  meta: unknown;
}

export interface EpisodeSummary {
  id: string;
  title: string;
  presenter?: string | null;
  slug: string;
  artworkUrl?: string | null;
  broadcastDate: string | null;
  description: string | null;
  durationSeconds: number | null;
  mixcloudUrl: string | null;
  autoQueuedAt?: string | null;
  autoQueueRequestId?: string | null;
  createdAt: string;
  status?: string;
  filePath?: string | null;
}

export interface TrackRecord {
  id: string;
  episodeId: string;
  title: string | null;
  artist: string | null;
  position: number | null;
  startTimeSeconds?: number | null;
  endTimeSeconds?: number | null;
  source?: string;
  acoustidScore?: number | null;
  musicbrainzId?: string | null;
  reviewed?: boolean;
}

export interface FingerprintMatchSummary {
  title: string | null;
  artist: string | null;
  acoustidScore: number;
  musicbrainzId: string | null;
}

export interface EpisodeDetail extends EpisodeSummary {
  tracks: TrackRecord[];
  originalFilename?: string | null;
  loudnessLufs?: number | null;
  fileHash?: string | null;
}

export interface IngestJobRecord {
  id: string;
  episodeId: string | null;
  status: string;
  sourcePath: string;
  sourceHash: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  episodeTitle?: string | null;
  episodePresenter?: string | null;
  episodeSlug?: string | null;
}

export interface StreamStatus {
  online: boolean;
  queueLength: number;
  librarySize: number;
  streamUrl: string;
  checkedAt: string;
}

export interface StreamQueueEntry {
  requestId: string | null;
  filePath: string | null;
  episode: {
    id: string;
    title: string;
    presenter: string | null;
    slug: string;
    artworkUrl: string | null;
    broadcastDate: string | null;
    mixcloudUrl: string | null;
  } | null;
}

export interface NowPlaying {
  startedAt: string;
  elapsedSeconds: number;
  episode: {
    id: string;
    title: string;
    presenter: string | null;
    slug: string;
    artworkUrl: string | null;
    broadcastDate: string | null;
    mixcloudUrl: string | null;
  };
  track: {
    id: string;
    title: string | null;
    artist: string | null;
    position: number | null;
  } | null;
}

export interface IntegrationStreamMetadata {
  status: StreamStatus;
  nowPlaying: NowPlaying | null;
  queue: StreamQueueEntry[];
  generatedAt: string;
}

export interface StreamApiKeyRecord {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedStreamApiKey {
  key: string;
  record: StreamApiKeyRecord;
}

export interface SiteAppearance {
  backgroundColor: string;
  containerColor: string;
  textColor: string;
  logoUrl: string;
  faviconUrl: string;
}

export interface AdminUser {
  username: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function buildUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function resolveApiAssetUrl(url: string): string {
  if (!url.startsWith('/')) {
    return url;
  }

  return buildUrl(url);
}

function inferImageUploadContentType(file: File): string {
  if (file.type) {
    return file.type;
  }

  const extensionMatch = /\.[^.]+$/.exec(file.name.toLowerCase());
  if (!extensionMatch) {
    return 'application/octet-stream';
  }

  return CONTENT_TYPE_BY_EXTENSION[extensionMatch[0]] ?? 'application/octet-stream';
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response.json()) as ApiEnvelope<T>;
}

function normalizeSiteAppearance(appearance: SiteAppearance): SiteAppearance {
  return {
    ...appearance,
    faviconUrl: resolveApiAssetUrl(appearance.faviconUrl),
    logoUrl: resolveApiAssetUrl(appearance.logoUrl),
  };
}

export async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(buildUrl(path), {
    cache: 'no-store',
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });

  const envelope = await parseEnvelope<T>(response);
  if (!response.ok || envelope.error) {
    throw new Error(envelope.error?.message ?? `Request failed with status ${response.status}`);
  }

  return envelope;
}

export async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const envelope = await requestEnvelope<T>(path, init);
  return envelope.data;
}

export async function login(username: string, password: string): Promise<AdminUser> {
  return await requestData<AdminUser>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<void> {
  await requestData('/api/auth/logout', { method: 'POST' });
}

export async function getCurrentUser(): Promise<AdminUser> {
  return await requestData<AdminUser>('/api/auth/me');
}

export async function getSiteAppearance(): Promise<SiteAppearance> {
  return normalizeSiteAppearance(await requestData<SiteAppearance>('/api/site-settings'));
}

export async function updateSiteAppearance(input: {
  backgroundColor: string;
  containerColor: string;
  textColor: string;
}): Promise<SiteAppearance> {
  return normalizeSiteAppearance(
    await requestData<SiteAppearance>('/api/admin/site-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function uploadSiteLogo(file: File): Promise<SiteAppearance> {
  return normalizeSiteAppearance(
    await requestData<SiteAppearance>('/api/admin/site-settings/logo', {
      method: 'POST',
      headers: {
        'Content-Type': inferImageUploadContentType(file),
        'x-filename': file.name,
      },
      body: file,
    }),
  );
}

export async function uploadSiteFavicon(file: File): Promise<SiteAppearance> {
  return normalizeSiteAppearance(
    await requestData<SiteAppearance>('/api/admin/site-settings/favicon', {
      method: 'POST',
      headers: {
        'Content-Type': inferImageUploadContentType(file),
        'x-filename': file.name,
      },
      body: file,
    }),
  );
}

export async function uploadEpisode(file: File): Promise<{ filename: string; path: string }> {
  return await requestData('/api/admin/ingest/upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-filename': file.name,
    },
    body: file,
  });
}

export async function triggerEpisodeFingerprint(
  episodeId: string,
): Promise<{ matches: FingerprintMatchSummary[]; insertedCount: number }> {
  return await requestData<{ matches: FingerprintMatchSummary[]; insertedCount: number }>(
    `/api/admin/episodes/${episodeId}/fingerprint`,
    { method: 'POST' },
  );
}

export async function approveTrack(episodeId: string, trackId: string): Promise<TrackRecord> {
  return await requestData<TrackRecord>(`/api/admin/episodes/${episodeId}/tracks/${trackId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewed: true }),
  });
}

export async function updateTrack(
  episodeId: string,
  trackId: string,
  patch: { title?: string; artist?: string | null; position?: number | null },
): Promise<TrackRecord> {
  return await requestData<TrackRecord>(`/api/admin/episodes/${episodeId}/tracks/${trackId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteTrack(episodeId: string, trackId: string): Promise<void> {
  await fetch(buildUrl(`/api/admin/episodes/${episodeId}/tracks/${trackId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
}

export async function deleteEpisode(episodeId: string): Promise<void> {
  const response = await fetch(buildUrl(`/api/admin/episodes/${episodeId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    let message = `Delete failed (status ${response.status})`;
    try {
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (envelope.error?.message) message = envelope.error.message;
    } catch {
      /* ignore body parse failure */
    }
    throw new Error(message);
  }
}

/**
 * Returns the live Icecast stream URL.
 *
 * When `cacheBust` is true, appends a `?t=<timestamp>` so the browser audio
 * element opens a fresh connection. This prevents listeners from getting
 * stuck on a stale connection after a server-side restart — Icecast ignores
 * unknown query params, so the cache-buster is safe.
 */
export function getStreamAudioUrl(cacheBust = false): string {
  const base = import.meta.env.VITE_STREAM_URL ?? '/stream';
  if (!cacheBust) return base;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}t=${Date.now()}`;
}
