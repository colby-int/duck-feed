import { describe, expect, it } from 'vitest';
import { buildEpisodeSeed } from '../../src/services/ingest.js';

describe('buildEpisodeSeed', () => {
  it('uses structured filename metadata when available', () => {
    const seed = buildEpisodeSeed('/dropzone/08042026_duck-feed-live_gary-butterfield.mp3');

    expect(seed).toMatchObject({
      originalFilename: '08042026_duck-feed-live_gary-butterfield.mp3',
      title: 'Duck Feed Live',
      presenter: 'Gary Butterfield',
      broadcastDate: '2026-04-08',
      description: undefined,
    });
    expect(seed.slug).toMatch(/^2026-04-08-duck-feed-live-[0-9a-f]{6}$/);
  });

  it('falls back to the raw stem when the filename is not structured', () => {
    const seed = buildEpisodeSeed('/dropzone/bsword.mp3');

    expect(seed).toMatchObject({
      originalFilename: 'bsword.mp3',
      title: 'bsword',
      presenter: undefined,
      broadcastDate: undefined,
      description: undefined,
    });
    expect(seed.slug).toMatch(/^bsword-[0-9a-f]{6}$/);
  });

  it('normalizes two-digit years into four-digit broadcast dates', () => {
    const seed = buildEpisodeSeed('/dropzone/080226_homesweet_marley.mp3');

    expect(seed).toMatchObject({
      originalFilename: '080226_homesweet_marley.mp3',
      title: 'Homesweet',
      presenter: 'Marley',
      broadcastDate: '2026-02-08',
      description: undefined,
    });
    expect(seed.slug).toMatch(/^2026-02-08-homesweet-[0-9a-f]{6}$/);
  });
});
