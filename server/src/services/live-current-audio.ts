import type { CurrentAudioResolution, CurrentAudioResolutionSource } from './current-audio-resolution.js';
import { resolveCurrentAudioEpisode } from './current-audio-resolution.js';
import type { LiquidsoapStreamState } from './liquidsoap.js';
import { getStreamSnapshot, refreshStreamSnapshot } from './stream-poller.js';

export interface LiveCurrentAudioState {
  resolution: CurrentAudioResolution;
  selfHealed: boolean;
  snapshot: LiquidsoapStreamState;
}

const RESOLUTION_PRIORITY: Record<CurrentAudioResolutionSource, number> = {
  exact_file_path: 7,
  file_basename: 6,
  original_filename: 5,
  slug_stem: 4,
  filename_metadata: 3,
  stream_tags: 2,
  synthetic_metadata: 1,
  none: 0,
};

export async function resolveLiveCurrentAudio(now = new Date()): Promise<LiveCurrentAudioState> {
  const initialSnapshot = await getStreamSnapshot();
  const initialResolution = await resolveSnapshot(initialSnapshot);

  if (!shouldRefresh(initialSnapshot, initialResolution)) {
    return {
      resolution: initialResolution,
      selfHealed: false,
      snapshot: initialSnapshot,
    };
  }

  const refreshedSnapshot = await refreshStreamSnapshot(now);
  const refreshedResolution = await resolveSnapshot(refreshedSnapshot);

  if (isBetterResolution(refreshedResolution, initialResolution)) {
    return {
      resolution: refreshedResolution,
      selfHealed: true,
      snapshot: refreshedSnapshot,
    };
  }

  return {
    resolution: initialResolution,
    selfHealed: false,
    snapshot: initialSnapshot,
  };
}

async function resolveSnapshot(snapshot: LiquidsoapStreamState): Promise<CurrentAudioResolution> {
  return await resolveCurrentAudioEpisode(
    snapshot.currentRequest
      ? {
          artist: snapshot.currentRequest.artist ?? null,
          filePath: snapshot.currentRequest.filePath ?? null,
          title: snapshot.currentRequest.title ?? null,
        }
      : null,
  );
}

function shouldRefresh(
  snapshot: LiquidsoapStreamState,
  resolution: CurrentAudioResolution,
): boolean {
  if (!snapshot.online) {
    return false;
  }

  if (!snapshot.currentRequest) {
    return true;
  }

  return (
    resolution.resolutionSource === 'none' ||
    resolution.resolutionSource === 'stream_tags' ||
    resolution.resolutionSource === 'synthetic_metadata'
  );
}

function isBetterResolution(
  candidate: CurrentAudioResolution,
  current: CurrentAudioResolution,
): boolean {
  const candidatePriority = RESOLUTION_PRIORITY[candidate.resolutionSource];
  const currentPriority = RESOLUTION_PRIORITY[current.resolutionSource];

  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  if (candidate.matchedEpisode && !current.matchedEpisode) {
    return true;
  }

  if (candidate.displayEpisode && !current.displayEpisode) {
    return true;
  }

  if (!candidate.alert && current.alert) {
    return true;
  }

  return false;
}
