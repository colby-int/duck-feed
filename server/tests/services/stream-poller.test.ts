import { beforeEach, describe, expect, it, vi } from 'vitest';

const liquidsoapMock = vi.hoisted(() => ({
  pollLiquidsoapState: vi.fn(),
}));

vi.mock('../../src/services/liquidsoap.js', () => liquidsoapMock);

describe('stream poller', () => {
  beforeEach(() => {
    vi.resetModules();
    liquidsoapMock.pollLiquidsoapState.mockReset();
  });

  it('reuses a fresh cached snapshot across multiple readers', async () => {
    liquidsoapMock.pollLiquidsoapState.mockResolvedValue({
      checkedAt: '2026-04-12T01:00:00.000Z',
      currentRequest: {
        filePath: '/var/lib/duckfeed/library/episode-1.mp3',
        requestId: '12',
      },
      online: true,
      queue: ['12', '14'],
      remainingSeconds: 42,
    });

    const { getStreamSnapshot } = await import('../../src/services/stream-poller.js');
    const first = await getStreamSnapshot();
    const second = await getStreamSnapshot();

    expect(liquidsoapMock.pollLiquidsoapState).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('returns an offline snapshot when liquidsoap polling fails', async () => {
    liquidsoapMock.pollLiquidsoapState.mockRejectedValue(new Error('telnet down'));

    const { getStreamSnapshot } = await import('../../src/services/stream-poller.js');
    const snapshot = await getStreamSnapshot();

    expect(snapshot.online).toBe(false);
    expect(snapshot.queue).toEqual([]);
    expect(snapshot.currentRequest).toBeNull();
    expect(snapshot.remainingSeconds).toBeNull();
  });
});
