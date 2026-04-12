import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recoverEpisodeMetadataMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    matched: 0,
    scanned: 0,
    skipped: 0,
    updated: 0,
  }),
);

const poolEndMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}));
const processOnMock = vi.hoisted(() => vi.fn());
const intervalUnrefMock = vi.hoisted(() => vi.fn());
const intervalHandle = vi.hoisted(
  () => ({ unref: intervalUnrefMock }) as unknown as NodeJS.Timeout,
);
const setIntervalMock = vi.hoisted(() => vi.fn(() => intervalHandle));

vi.mock('../src/config.js', () => ({
  config: {
    METADATA_RECOVERY_INTERVAL_MS: 3_600_000,
    MIXCLOUD_USER_URL: 'https://www.mixcloud.com/duckradio/',
  },
}));

vi.mock('../src/db/index.js', () => ({
  pool: {
    end: poolEndMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: loggerMock,
}));

vi.mock('../src/services/metadata-recovery.js', () => ({
  recoverEpisodeMetadata: recoverEpisodeMetadataMock,
}));

describe('metadata worker', () => {
  beforeEach(() => {
    vi.resetModules();
    recoverEpisodeMetadataMock.mockClear();
    poolEndMock.mockClear();
    loggerMock.info.mockClear();
    loggerMock.error.mockClear();
    processOnMock.mockClear();
    intervalUnrefMock.mockClear();
    setIntervalMock.mockClear();

    vi.spyOn(global, 'setInterval').mockImplementation(
      setIntervalMock as unknown as typeof setInterval,
    );
    vi.spyOn(process, 'on').mockImplementation(processOnMock as typeof process.on);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the recovery interval referenced so the worker stays alive between passes', async () => {
    await import('../src/metadata-worker.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(recoverEpisodeMetadataMock).toHaveBeenCalledTimes(1);
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 3_600_000);
    expect(intervalUnrefMock).not.toHaveBeenCalled();
  });
});
