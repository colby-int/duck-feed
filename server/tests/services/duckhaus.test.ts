import { describe, expect, it } from 'vitest';

import { getDuckhausEpisodeStatus } from '../../src/services/duckhaus.js';

describe('duckhaus service', () => {
  it('marks prepared downloadable entries as ready', () => {
    expect(
      getDuckhausEpisodeStatus({
        downloadUrl: 'http://duckhaus.local/api/catalog/test/file',
        status: 'prepared',
      }),
    ).toBe('ready');
  });

  it('keeps discovered but unprepared entries pending', () => {
    expect(
      getDuckhausEpisodeStatus({
        downloadUrl: null,
        status: 'discovered',
      }),
    ).toBe('pending');
  });
});
