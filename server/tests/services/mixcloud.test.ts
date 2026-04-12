import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandMock = vi.hoisted(() => ({
  runCommand: vi.fn(),
}));

vi.mock('../../src/lib/run-command.js', () => runCommandMock);

describe('mixcloud service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
    runCommandMock.runCommand.mockReset();
  });

  it('discovers canonical episode metadata from the Mixcloud user feed', async () => {
    runCommandMock.runCommand
      .mockResolvedValueOnce({
        stdout: ['https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/'].join('\n'),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          description: 'A loud one',
          thumbnail: 'https://images.example/hardcore-nerds.jpg',
          title: "Hardcore Nerds | TK FM & Bad'm D | 08.02.2026",
          webpage_url: 'https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/',
        }),
        stderr: '',
      });

    const { discoverMixcloudEpisodes } = await import('../../src/services/mixcloud.js');
    const result = await discoverMixcloudEpisodes();

    expect(result).toEqual([
      {
        artworkUrl: 'https://images.example/hardcore-nerds.jpg',
        broadcastDate: '2026-02-08',
        description: 'A loud one',
        mixcloudUrl: 'https://www.mixcloud.com/duckradio/hardcore-nerds-08022026/',
        presenter: "TK FM & Bad'm D",
        sourceTitle: "Hardcore Nerds | TK FM & Bad'm D | 08.02.2026",
        title: 'Hardcore Nerds',
      },
    ]);
  });

  it('fetches Mixcloud episode metadata without fan-out concurrency', async () => {
    let activeFetches = 0;
    let maxConcurrentFetches = 0;
    const deferredResolves: Array<() => void> = [];

    runCommandMock.runCommand.mockImplementation(async (_command, args: string[]) => {
      if (args.includes('--flat-playlist')) {
        return {
          stdout: [
            'https://www.mixcloud.com/duckradio/episode-one/',
            'https://www.mixcloud.com/duckradio/episode-two/',
          ].join('\n'),
          stderr: '',
        };
      }

      const url = args.at(-1);
      if (!url) {
        throw new Error('expected Mixcloud episode URL');
      }

      activeFetches += 1;
      maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);

      await new Promise<void>((resolve) => {
        deferredResolves.push(() => {
          activeFetches -= 1;
          resolve();
        });
      });

      const title =
        url === 'https://www.mixcloud.com/duckradio/episode-one/'
          ? 'Episode One | Presenter One | 01.02.2026'
          : 'Episode Two | Presenter Two | 08.02.2026';

      return {
        stdout: JSON.stringify({
          title,
          webpage_url: url,
        }),
        stderr: '',
      };
    });

    const { discoverMixcloudEpisodes } = await import('../../src/services/mixcloud.js');
    const discoveryPromise = discoverMixcloudEpisodes();

    await Promise.resolve();
    await Promise.resolve();

    expect(maxConcurrentFetches).toBe(1);

    deferredResolves.shift()?.();
    await vi.waitFor(() => {
      expect(deferredResolves).toHaveLength(1);
    });
    deferredResolves.shift()?.();

    const result = await discoveryPromise;

    expect(result).toHaveLength(2);
    expect(maxConcurrentFetches).toBe(1);
  });
});
