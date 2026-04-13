import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { episodes, playbackLog, tracks } from '../db/schema.js';
import { getRequestMetadata } from './liquidsoap.js';
import { resolveLiveCurrentAudio } from './live-current-audio.js';
import { getStreamSnapshot } from './stream-poller.js';

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

async function getLiquidsoapNowPlaying(
  now: Date,
  currentPlayback:
    | {
        startedAt: Date;
        episodeId: string;
      }
    | null,
): Promise<{ nowPlaying: NowPlaying | null; online: boolean }> {
  const liveCurrentAudio = await resolveLiveCurrentAudio(now);
  const snapshot = liveCurrentAudio.snapshot;
  if (!snapshot.online) {
    return { nowPlaying: null, online: false };
  }

  const resolution = liveCurrentAudio.resolution;

  if (!resolution.displayEpisode) {
    return { nowPlaying: null, online: true };
  }

  let elapsedSeconds = 0;
  let startedAt = now.toISOString();
  let currentTrack: ReturnType<typeof getCurrentTrack> = null;

  if (resolution.matchedEpisode) {
    if (currentPlayback && currentPlayback.episodeId === resolution.matchedEpisode.id) {
      elapsedSeconds = Math.max(
        0,
        Math.floor((now.getTime() - currentPlayback.startedAt.getTime()) / 1000),
      );
      startedAt = currentPlayback.startedAt.toISOString();
    } else if (
      resolution.matchedEpisode.durationSeconds != null &&
      snapshot.remainingSeconds != null
    ) {
      elapsedSeconds = Math.max(
        0,
        Math.floor(resolution.matchedEpisode.durationSeconds - snapshot.remainingSeconds),
      );
      startedAt = new Date(now.getTime() - elapsedSeconds * 1000).toISOString();
    }

    const episodeTracks = await getEpisodeTracks(resolution.matchedEpisode.id);
    currentTrack = getCurrentTrack(episodeTracks, elapsedSeconds);
  }

  return {
    nowPlaying: buildNowPlaying(
      resolution.displayEpisode,
      currentTrack,
      elapsedSeconds,
      startedAt,
    ),
    online: true,
  };
}

export async function getStreamStatus(): Promise<StreamStatus> {
  const [snapshot, readyEpisodes] = await Promise.all([
    getStreamSnapshot(),
    db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.status, 'ready'), isNotNull(episodes.filePath))),
  ]);

  return {
    online: snapshot.online,
    queueLength: snapshot.online ? snapshot.queue.length : 0,
    librarySize: readyEpisodes.length,
    streamUrl: '/stream',
    checkedAt: snapshot.checkedAt,
  };
}

export async function getStreamQueue(): Promise<StreamQueueEntry[]> {
  const snapshot = await getStreamSnapshot();
  const queue = snapshot.online ? snapshot.queue : [];

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

  const liveNowPlaying = await getLiquidsoapNowPlaying(
    now,
    currentPlayback
      ? {
          episodeId: currentPlayback.episodeId,
          startedAt: currentPlayback.startedAt,
        }
      : null,
  );

  if (liveNowPlaying.nowPlaying) {
    return liveNowPlaying.nowPlaying;
  }

  if (!currentPlayback) {
    return null;
  }

  if (liveNowPlaying.online) {
    return null;
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
