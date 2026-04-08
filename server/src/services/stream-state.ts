import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { episodes, playbackLog, tracks } from '../db/schema.js';
import {
  getCurrentRequest,
  getRequestMetadata,
  getQueue,
  getRemainingSeconds,
  pingLiquidsoap,
} from './liquidsoap.js';

export interface StreamStatus {
  online: boolean;
  queueLength: number;
  librarySize: number;
  streamUrl: string;
  checkedAt: string;
}

export interface NowPlaying {
  startedAt: string;
  elapsedSeconds: number;
  episode: {
    id: string;
    title: string;
    presenter: string | null;
    slug: string;
    broadcastDate: string | null;
    mixcloudUrl: string | null;
    artworkUrl: string | null;
  };
  track: {
    id: string;
    title: string | null;
    artist: string | null;
    position: number | null;
  } | null;
}

export interface StreamQueueEntry {
  requestId: string | null;
  filePath: string | null;
  episode: {
    id: string;
    title: string;
    presenter: string | null;
    slug: string;
    broadcastDate: string | null;
    mixcloudUrl: string | null;
    artworkUrl: string | null;
  } | null;
}

export interface IntegrationStreamMetadata {
  status: StreamStatus;
  nowPlaying: NowPlaying | null;
  queue: StreamQueueEntry[];
  generatedAt: string;
}

async function getEpisodeTracks(episodeId: string) {
  return await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      position: tracks.position,
      startTimeSeconds: tracks.startTimeSeconds,
      endTimeSeconds: tracks.endTimeSeconds,
    })
    .from(tracks)
    .where(eq(tracks.episodeId, episodeId))
    .orderBy(asc(tracks.position));
}

function getCurrentTrack(
  episodeTracks: Awaited<ReturnType<typeof getEpisodeTracks>>,
  elapsedSeconds: number,
) {
  return (
    episodeTracks.find((track) => {
      if (track.startTimeSeconds == null) {
        return false;
      }
      if (track.endTimeSeconds == null) {
        return elapsedSeconds >= track.startTimeSeconds;
      }
      return elapsedSeconds >= track.startTimeSeconds && elapsedSeconds < track.endTimeSeconds;
    }) ?? null
  );
}

function buildNowPlaying(
  episode: {
    id: string;
    title: string;
    presenter: string | null;
    slug: string;
    broadcastDate: string | null;
    mixcloudUrl: string | null;
    artworkUrl: string | null;
  },
  currentTrack: ReturnType<typeof getCurrentTrack>,
  elapsedSeconds: number,
  startedAt: string,
): NowPlaying {
  return {
    startedAt,
    elapsedSeconds,
    episode: {
      id: episode.id,
      title: episode.title,
      presenter: episode.presenter,
      slug: episode.slug,
      broadcastDate: episode.broadcastDate,
      mixcloudUrl: episode.mixcloudUrl,
      artworkUrl: episode.artworkUrl,
    },
    track: currentTrack
      ? {
          id: currentTrack.id,
          title: currentTrack.title,
          artist: currentTrack.artist,
          position: currentTrack.position,
        }
      : null,
  };
}

async function getEpisodeByFilePath(filePath: string) {
  const [episode] = await db
    .select({
      id: episodes.id,
      title: episodes.title,
      presenter: episodes.presenter,
      slug: episodes.slug,
      broadcastDate: episodes.broadcastDate,
      mixcloudUrl: episodes.mixcloudUrl,
      artworkUrl: episodes.artworkUrl,
    })
    .from(episodes)
    .where(and(eq(episodes.filePath, filePath), eq(episodes.status, 'ready')))
    .limit(1);

  return episode ?? null;
}

async function resolveQueueEntry(rawEntry: string): Promise<StreamQueueEntry> {
  const request =
    rawEntry.includes('/')
      ? {
          requestId: rawEntry,
          filePath: rawEntry,
        }
      : await getRequestMetadata(rawEntry);

  if (!request.filePath) {
    return {
      requestId: request.requestId,
      filePath: null,
      episode: null,
    };
  }

  return {
    requestId: request.requestId,
    filePath: request.filePath,
    episode: await getEpisodeByFilePath(request.filePath),
  };
}

async function getLiquidsoapNowPlaying(now: Date): Promise<NowPlaying | null> {
  let currentRequest;
  let remainingSeconds;
  try {
    [currentRequest, remainingSeconds] = await Promise.all([
      getCurrentRequest(),
      getRemainingSeconds(),
    ]);
  } catch {
    return null;
  }

  if (!currentRequest?.filePath) {
    return null;
  }

  const [currentEpisode] = await db
    .select({
      id: episodes.id,
      title: episodes.title,
      presenter: episodes.presenter,
      slug: episodes.slug,
      broadcastDate: episodes.broadcastDate,
      mixcloudUrl: episodes.mixcloudUrl,
      artworkUrl: episodes.artworkUrl,
      durationSeconds: episodes.durationSeconds,
    })
    .from(episodes)
    .where(and(eq(episodes.filePath, currentRequest.filePath), eq(episodes.status, 'ready')))
    .limit(1);

  if (!currentEpisode) {
    return null;
  }

  const elapsedSeconds =
    currentEpisode.durationSeconds != null && remainingSeconds != null
      ? Math.max(0, Math.floor(currentEpisode.durationSeconds - remainingSeconds))
      : 0;
  const episodeTracks = await getEpisodeTracks(currentEpisode.id);
  const currentTrack = getCurrentTrack(episodeTracks, elapsedSeconds);

  return buildNowPlaying(
    currentEpisode,
    currentTrack,
    elapsedSeconds,
    new Date(now.getTime() - elapsedSeconds * 1000).toISOString(),
  );
}

export async function getStreamStatus(): Promise<StreamStatus> {
  const [online, readyEpisodes] = await Promise.all([
    pingLiquidsoap(),
    db.select({ id: episodes.id }).from(episodes).where(eq(episodes.status, 'ready')),
  ]);

  let queueLength = 0;
  if (online) {
    try {
      queueLength = (await getQueue()).length;
    } catch {
      queueLength = 0;
    }
  }

  return {
    online,
    queueLength,
    librarySize: readyEpisodes.length,
    streamUrl: '/stream',
    checkedAt: new Date().toISOString(),
  };
}

export async function getStreamQueue(): Promise<StreamQueueEntry[]> {
  let queue: string[];
  try {
    queue = await getQueue();
  } catch {
    return [];
  }

  return await Promise.all(
    queue.map(async (entry) => {
      try {
        return await resolveQueueEntry(entry);
      } catch {
        return {
          requestId: entry,
          filePath: null,
          episode: null,
        } satisfies StreamQueueEntry;
      }
    }),
  );
}

export async function getIntegrationStreamMetadata(): Promise<IntegrationStreamMetadata> {
  const [status, nowPlaying, queue] = await Promise.all([
    getStreamStatus(),
    getCurrentNowPlaying(),
    getStreamQueue(),
  ]);

  return {
    status,
    nowPlaying,
    queue,
    generatedAt: new Date().toISOString(),
  };
}

export async function getCurrentNowPlaying(now = new Date()): Promise<NowPlaying | null> {
  const [currentPlayback] = await db
    .select({
      startedAt: playbackLog.startedAt,
      episodeId: episodes.id,
      title: episodes.title,
      presenter: episodes.presenter,
      slug: episodes.slug,
      broadcastDate: episodes.broadcastDate,
      mixcloudUrl: episodes.mixcloudUrl,
      artworkUrl: episodes.artworkUrl,
    })
    .from(playbackLog)
    .innerJoin(episodes, eq(episodes.id, playbackLog.episodeId))
    .where(and(isNull(playbackLog.endedAt), eq(episodes.status, 'ready')))
    .orderBy(desc(playbackLog.startedAt))
    .limit(1);

  if (!currentPlayback) {
    return await getLiquidsoapNowPlaying(now);
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - currentPlayback.startedAt.getTime()) / 1000),
  );

  const episodeTracks = await getEpisodeTracks(currentPlayback.episodeId);
  const currentTrack = getCurrentTrack(episodeTracks, elapsedSeconds);

  return buildNowPlaying(
    {
      id: currentPlayback.episodeId,
      title: currentPlayback.title,
      presenter: currentPlayback.presenter,
      slug: currentPlayback.slug,
      broadcastDate: currentPlayback.broadcastDate,
      mixcloudUrl: currentPlayback.mixcloudUrl,
      artworkUrl: currentPlayback.artworkUrl,
    },
    currentTrack,
    elapsedSeconds,
    currentPlayback.startedAt.toISOString(),
  );
}
