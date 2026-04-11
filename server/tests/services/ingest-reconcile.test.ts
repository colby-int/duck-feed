import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
  },
}));

interface StaleRow {
  id: string;
  episodeId: string | null;
  sourcePath: string;
  status: string;
}

describe('reconcileStaleJobs', () => {
  let processingDir: string;

  beforeEach(async () => {
    vi.resetModules();
    processingDir = await mkdtemp(path.join(os.tmpdir(), 'duckfeed-processing-'));
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
    process.env.PROCESSING_DIR = processingDir;

    dbMock.select.mockReset();
    dbMock.update.mockReset();
  });

  afterEach(async () => {
    await rm(processingDir, { recursive: true, force: true });
  });

  function mockStaleSelect(rows: StaleRow[]): void {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn(() => ({ where }));
    dbMock.select.mockReturnValue({ from });
  }

  function mockUpdateChain(): {
    setSpy: ReturnType<typeof vi.fn>;
    whereSpy: ReturnType<typeof vi.fn>;
  } {
    const whereSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn(() => ({ where: whereSpy }));
    dbMock.update.mockReturnValue({ set: setSpy });
    return { setSpy, whereSpy };
  }

  it('marks stale in-flight jobs as failed, cascades episodes to error, and removes orphan processing files', async () => {
    const stale: StaleRow[] = [
      {
        id: 'job-1',
        episodeId: 'ep-1',
        sourcePath: '/var/lib/duckfeed/dropzone/show-a.mp3',
        status: 'normalising',
      },
      {
        id: 'job-2',
        episodeId: 'ep-2',
        sourcePath: '/var/lib/duckfeed/dropzone/show-b.wav',
        status: 'copying',
      },
    ];
    mockStaleSelect(stale);
    const { setSpy } = mockUpdateChain();

    await writeFile(path.join(processingDir, 'job-1.mp3'), 'stub-a');
    await writeFile(path.join(processingDir, 'job-2.wav'), 'stub-b');
    await writeFile(path.join(processingDir, 'unrelated.mp3'), 'other');

    const { reconcileStaleJobs } = await import('../../src/services/ingest.js');
    const result = await reconcileStaleJobs();

    expect(result.reclaimed).toBe(2);

    expect(dbMock.update).toHaveBeenCalledTimes(2);
    const setCalls = setSpy.mock.calls.map((call) => call[0]);
    expect(setCalls[0]).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringMatching(/interrupted/i),
    });
    expect(setCalls[0].completedAt).toBeInstanceOf(Date);
    expect(setCalls[1]).toMatchObject({ status: 'error' });
    expect(setCalls[1].updatedAt).toBeInstanceOf(Date);

    const remaining = (await readdir(processingDir)).sort();
    expect(remaining).toEqual(['unrelated.mp3']);
  });

  it('is a no-op when no stale jobs are present', async () => {
    mockStaleSelect([]);

    const { reconcileStaleJobs } = await import('../../src/services/ingest.js');
    const result = await reconcileStaleJobs();

    expect(result.reclaimed).toBe(0);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('still marks the job failed when the orphan processing file is already gone', async () => {
    mockStaleSelect([
      {
        id: 'job-missing',
        episodeId: 'ep-missing',
        sourcePath: '/var/lib/duckfeed/dropzone/gone.mp3',
        status: 'normalising',
      },
    ]);
    const { setSpy } = mockUpdateChain();

    const { reconcileStaleJobs } = await import('../../src/services/ingest.js');
    const result = await reconcileStaleJobs();

    expect(result.reclaimed).toBe(1);
    expect(setSpy.mock.calls[0][0]).toMatchObject({ status: 'failed' });
  });

  it('skips the episode update when a stale job has no episode_id', async () => {
    mockStaleSelect([
      {
        id: 'job-orphan',
        episodeId: null,
        sourcePath: '/var/lib/duckfeed/dropzone/orphan.mp3',
        status: 'queued',
      },
    ]);
    const { setSpy } = mockUpdateChain();

    const { reconcileStaleJobs } = await import('../../src/services/ingest.js');
    const result = await reconcileStaleJobs();

    expect(result.reclaimed).toBe(1);
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toMatchObject({ status: 'failed' });
  });
});
