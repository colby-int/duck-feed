// Audio normalisation via ffmpeg loudnorm (two-pass).
// Decisions (from PLAN.md §6.3): target I=-16 LUFS, TP=-1.5, LRA=11; output MP3 192kbps 44.1kHz stereo.

import { runCommand } from '../lib/run-command.js';
import { logger } from '../lib/logger.js';

const TARGET_I = -16;
const TARGET_TP = -1.5;
const TARGET_LRA = 11;

const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000; // 30 min ceiling for an ~12h source would be tight — adjust if needed
const FFPROBE_TIMEOUT_MS = 60 * 1000;

interface LoudnormMeasurement {
  inputI: string;
  inputTp: string;
  inputLra: string;
  inputThresh: string;
  targetOffset: string;
}

export interface NormalizeResult {
  outputPath: string;
  durationSeconds: number;
  measuredLufs: number;
}

export interface AudioMetadata {
  album?: string;
  artist?: string;
  title?: string;
}

function buildMetadataArgs(metadata?: AudioMetadata): string[] {
  if (!metadata) {
    return [];
  }

  const args: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const trimmedValue = value?.trim();
    if (!trimmedValue) {
      continue;
    }

    args.push('-metadata', `${key}=${trimmedValue}`);
  }

  return args;
}

/**
 * Pass 1: run loudnorm analysis and parse the JSON report printed to stderr.
 * ffmpeg prints the JSON on stderr between lines like "[Parsed_loudnorm_0 @ ...] {"
 * so we extract the last JSON object from stderr.
 */
async function measureLoudness(inputPath: string): Promise<LoudnormMeasurement> {
  const { stderr } = await runCommand(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      inputPath,
      '-af',
      `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );

  const match = stderr.match(/\{[\s\S]*"target_offset"[\s\S]*?\}/);
  if (!match) {
    throw new Error(`loudnorm pass 1: could not parse measurement JSON from ffmpeg output`);
  }
  const parsed = JSON.parse(match[0]) as Record<string, string>;
  const required = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const;
  for (const key of required) {
    if (parsed[key] == null) {
      throw new Error(`loudnorm pass 1: missing field ${key} in measurement JSON`);
    }
  }
  return {
    inputI: parsed.input_i,
    inputTp: parsed.input_tp,
    inputLra: parsed.input_lra,
    inputThresh: parsed.input_thresh,
    targetOffset: parsed.target_offset,
  };
}

/**
 * Pass 2: apply loudnorm with measured values, transcode to MP3 192kbps 44.1kHz stereo.
 */
async function applyLoudness(
  inputPath: string,
  outputPath: string,
  m: LoudnormMeasurement,
  metadata?: AudioMetadata,
): Promise<void> {
  const filter =
    `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}` +
    `:measured_I=${m.inputI}:measured_TP=${m.inputTp}` +
    `:measured_LRA=${m.inputLra}:measured_thresh=${m.inputThresh}` +
    `:offset=${m.targetOffset}:linear=true:print_format=summary`;

  await runCommand(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-y',
      '-i',
      inputPath,
      '-af',
      filter,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-b:a',
      '192k',
      '-codec:a',
      'libmp3lame',
      ...buildMetadataArgs(metadata),
      outputPath,
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
}

export async function probeDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      filePath,
    ],
    { timeoutMs: FFPROBE_TIMEOUT_MS },
  );
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned invalid duration for ${filePath}: "${stdout.trim()}"`);
  }
  return Math.round(seconds);
}

/**
 * Normalise `inputPath` into `outputPath` via two-pass loudnorm and probe duration.
 * Returns the normalised file path, duration in seconds, and the pre-normalisation measured LUFS.
 */
export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  metadata?: AudioMetadata,
): Promise<NormalizeResult> {
  logger.info({ inputPath }, 'loudnorm pass 1: measuring');
  const measurement = await measureLoudness(inputPath);
  logger.info({ inputPath, measurement }, 'loudnorm pass 1: complete');

  logger.info({ inputPath, outputPath }, 'loudnorm pass 2: applying');
  await applyLoudness(inputPath, outputPath, measurement, metadata);
  logger.info({ outputPath }, 'loudnorm pass 2: complete');

  const durationSeconds = await probeDurationSeconds(outputPath);
  return {
    outputPath,
    durationSeconds,
    measuredLufs: parseFloat(measurement.inputI),
  };
}
