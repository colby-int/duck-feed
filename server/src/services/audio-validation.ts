import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { runCommand } from '../lib/run-command.js';

const FFPROBE_TIMEOUT_MS = 60 * 1000;

export class AudioValidationError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = 'AudioValidationError';
  }
}

export async function validateAudioFile(filePath: string): Promise<void> {
  try {
    await runCommand(
      'ffmpeg',
      ['-v', 'error', '-xerror', '-i', filePath, '-f', 'null', '-'],
      { timeoutMs: FFPROBE_TIMEOUT_MS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AudioValidationError(`audio validation failed for ${filePath}: ${message}`, filePath);
  }
}

interface QuarantineOptions {
  jobId: string;
  originalFilename: string;
  processingPath: string;
  libraryPath: string;
}

export async function quarantineInvalidAudioArtifacts({
  jobId,
  originalFilename,
  processingPath,
  libraryPath,
}: QuarantineOptions): Promise<string> {
  await removeIfPresent(libraryPath);

  await fs.mkdir(config.QUARANTINE_DIR, { recursive: true });
  const quarantinedPath = path.join(
    config.QUARANTINE_DIR,
    `${jobId}-${path.basename(originalFilename)}`,
  );

  try {
    await fs.rename(processingPath, quarantinedPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EXDEV') {
      await fs.copyFile(processingPath, quarantinedPath);
      await fs.unlink(processingPath);
    } else {
      throw error;
    }
  }

  return quarantinedPath;
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
