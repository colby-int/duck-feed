import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandMock = vi.hoisted(() => ({
  runCommand: vi.fn(),
}));

vi.mock('../../src/lib/run-command.js', () => runCommandMock);

describe('audio validation service', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    runCommandMock.runCommand.mockReset();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'duckfeed-audio-validation-'));
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
    process.env.QUARANTINE_DIR = path.join(tempDir, 'quarantine');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails validation when ffmpeg cannot fully decode the generated file', async () => {
    runCommandMock.runCommand.mockRejectedValue(new Error('decode error at frame 42'));

    const { AudioValidationError, validateAudioFile } = await import(
      '../../src/services/audio-validation.js'
    );

    await expect(validateAudioFile('/library/bad.mp3')).rejects.toBeInstanceOf(AudioValidationError);
    expect(runCommandMock.runCommand).toHaveBeenCalledWith(
      'ffmpeg',
      ['-v', 'error', '-xerror', '-i', '/library/bad.mp3', '-f', 'null', '-'],
      expect.any(Object),
    );
  });

  it('removes the invalid library output and quarantines the processing copy', async () => {
    const processingPath = path.join(tempDir, 'processing', 'job-1.wav');
    const libraryPath = path.join(tempDir, 'library', 'episode.mp3');

    await mkdir(path.dirname(processingPath), { recursive: true });
    await mkdir(path.dirname(libraryPath), { recursive: true });
    await writeFile(processingPath, 'bad-source');
    await writeFile(libraryPath, 'bad-output');

    const { quarantineInvalidAudioArtifacts } = await import(
      '../../src/services/audio-validation.js'
    );
    const quarantinedPath = await quarantineInvalidAudioArtifacts({
      jobId: 'job-1',
      originalFilename: '080226_homesweet_marley.wav',
      processingPath,
      libraryPath,
    });

    await expect(access(processingPath)).rejects.toThrow();
    await expect(access(libraryPath)).rejects.toThrow();
    await expect(readFile(quarantinedPath, 'utf8')).resolves.toBe('bad-source');
    expect(quarantinedPath).toContain(`${path.sep}quarantine${path.sep}`);
    expect(quarantinedPath).toContain('job-1-080226_homesweet_marley.wav');
  });
});
