import { describe, it, expect, vi } from 'vitest';
import { reconcileMetadata } from '../../src/services/metadata-reconciler';

describe('metadata-reconciler', () => {
  it('should parse artist and title correctly', async () => {
    const episode = { id: '1', title: 'Artist - Song Title' };
    const result = await reconcileMetadata(episode);
    expect(result.artist).toBe('Artist');
    expect(result.title).toBe('Song Title');
  });

  it('should handle missing artist', async () => {
    const episode = { id: '2', title: 'Just a Title' };
    const result = await reconcileMetadata(episode);
    expect(result.artist).toBe('Unknown');
    expect(result.title).toBe('Just a Title');
  });
});
