import { describe, expect, it } from 'vitest';

import { interleaveEpisodesByBroadcastDate } from '../../src/services/rotation-queue.js';

describe('interleaveEpisodesByBroadcastDate', () => {
  it('spreads dominant broadcast dates across the queue when alternatives exist', () => {
    const episodes = [
      { id: 'a1', broadcastDate: '2026-02-08' },
      { id: 'a2', broadcastDate: '2026-02-08' },
      { id: 'a3', broadcastDate: '2026-02-08' },
      { id: 'b1', broadcastDate: '2026-01-18' },
      { id: 'c1', broadcastDate: '2025-12-14' },
    ];

    expect(interleaveEpisodesByBroadcastDate(episodes)).toEqual([
      { id: 'a1', broadcastDate: '2026-02-08' },
      { id: 'b1', broadcastDate: '2026-01-18' },
      { id: 'a2', broadcastDate: '2026-02-08' },
      { id: 'c1', broadcastDate: '2025-12-14' },
      { id: 'a3', broadcastDate: '2026-02-08' },
    ]);
  });

  it('allows repeated dates only after all other date buckets are exhausted', () => {
    const episodes = [
      { id: 'a1', broadcastDate: '2026-02-08' },
      { id: 'a2', broadcastDate: '2026-02-08' },
      { id: 'b1', broadcastDate: '2026-01-18' },
    ];

    expect(interleaveEpisodesByBroadcastDate(episodes)).toEqual([
      { id: 'a1', broadcastDate: '2026-02-08' },
      { id: 'b1', broadcastDate: '2026-01-18' },
      { id: 'a2', broadcastDate: '2026-02-08' },
    ]);
  });
});
