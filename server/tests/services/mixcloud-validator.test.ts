import { describe, it, expect, vi } from 'vitest';
import { validateMixcloudMetadata } from '../../src/services/mixcloud-validator';

describe('mixcloud-validator', () => {
  it('should return true if title is found in mixcloud', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'some content with Test Title',
    });
    const result = await validateMixcloudMetadata('Test Title');
    expect(result).toBe(true);
  });

  it('should return false if title is not found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'some content without the title',
    });
    const result = await validateMixcloudMetadata('Missing Title');
    expect(result).toBe(false);
  });
});
