import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { validateMixcloudMetadata } from '../../src/services/mixcloud-validator.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockApiResponse(names: string[], hasNext = false) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: names.map((name) => ({ name, url: '', key: '' })),
      paging: hasNext ? { next: 'https://api.mixcloud.com/duckradio/cloudcasts/?offset=20' } : {},
    }),
  });
}

describe('mixcloud-validator', () => {
  it('returns true when an exact match exists', async () => {
    mockApiResponse([
      'Home Sweet | Marley | 08.02.2026',
      'Heuristic | Strict Face | 08.02.2026',
    ]);
    const result = await validateMixcloudMetadata('Home Sweet | Marley | 08.02.2026');
    expect(result).toBe(true);
  });

  it('matches case-insensitively', async () => {
    mockApiResponse(['Home Sweet | Marley | 08.02.2026']);
    const result = await validateMixcloudMetadata('home sweet | marley | 08.02.2026');
    expect(result).toBe(true);
  });

  it('returns false when no match exists', async () => {
    mockApiResponse(['Home Sweet | Marley | 08.02.2026']);
    const result = await validateMixcloudMetadata('Nonexistent Show | Nobody | 01.01.2000');
    expect(result).toBe(false);
  });

  it('returns false when the API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await validateMixcloudMetadata('Any Title');
    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await validateMixcloudMetadata('Any Title');
    expect(result).toBe(false);
  });
});
