import { describe, expect, it } from 'vitest';
import { parseEpisodeFilename } from '../../src/lib/episode-filename.js';

describe('parseEpisodeFilename', () => {
  it('extracts broadcast date, title, and presenter from a structured filename', () => {
    expect(parseEpisodeFilename('08042026_duck-feed-live_gary-butterfield.mp3')).toEqual({
      broadcastDate: '2026-04-08',
      presenter: 'Gary Butterfield',
      slugSeed: '2026-04-08 Duck Feed Live',
      title: 'Duck Feed Live',
    });
  });

  it('accepts two-digit years in structured filenames', () => {
    expect(parseEpisodeFilename('080226_homesweet_marley.mp3')).toEqual({
      broadcastDate: '2026-02-08',
      presenter: 'Marley',
      slugSeed: '2026-02-08 Homesweet',
      title: 'Homesweet',
    });
  });

  it('returns null for filenames that do not follow the expected pattern', () => {
    expect(parseEpisodeFilename('duck-feed-live.mp3')).toBeNull();
    expect(parseEpisodeFilename('08042026_duck_feed_live.mp3')).toBeNull();
  });

  it('returns null for impossible calendar dates', () => {
    expect(parseEpisodeFilename('31022026_duck-feed-live_gary-butterfield.mp3')).toBeNull();
  });
});
