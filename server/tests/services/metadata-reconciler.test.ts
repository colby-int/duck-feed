import { describe, it, expect } from 'vitest';
import {
  parseMixcloudTitle,
  buildMixcloudTitle,
  reconcileMetadata,
} from '../../src/services/metadata-reconciler.js';

describe('parseMixcloudTitle', () => {
  it('parses a 3-part pipe-separated title', () => {
    const result = parseMixcloudTitle(
      'Under The Persimmon Tree - Valentine\'s Day Special | Erin & Romi | 15.02.2026',
    );
    expect(result).toEqual({
      title: "Under The Persimmon Tree - Valentine's Day Special",
      presenter: 'Erin & Romi',
      broadcastDate: '2026-02-15',
      mixcloudTitle:
        "Under The Persimmon Tree - Valentine's Day Special | Erin & Romi | 15.02.2026",
    });
  });

  it('parses a 2-part pipe-separated title (no date)', () => {
    const result = parseMixcloudTitle('OCC Global Takeover | DJ Soupnoodle x Capital Waste');
    expect(result).toEqual({
      title: 'OCC Global Takeover',
      presenter: 'DJ Soupnoodle x Capital Waste',
      broadcastDate: null,
      mixcloudTitle: 'OCC Global Takeover | DJ Soupnoodle x Capital Waste',
    });
  });

  it('handles two-digit years', () => {
    const result = parseMixcloudTitle('Cult Aesthetics | Velodrone | 01.02.26');
    expect(result).toEqual({
      title: 'Cult Aesthetics',
      presenter: 'Velodrone',
      broadcastDate: '2026-02-01',
      mixcloudTitle: 'Cult Aesthetics | Velodrone | 01.02.26',
    });
  });

  it('returns null for a plain string with no pipes', () => {
    expect(parseMixcloudTitle('Just A Title')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseMixcloudTitle('')).toBeNull();
  });

  it('returns null when a pipe-part is empty', () => {
    expect(parseMixcloudTitle('Title | | 01.01.2026')).toBeNull();
  });

  it('returns null for an invalid date', () => {
    expect(parseMixcloudTitle('Show | Host | 32.13.2026')).toBeNull();
  });
});

describe('buildMixcloudTitle', () => {
  it('builds full title with all fields', () => {
    expect(buildMixcloudTitle('Home Sweet', 'Marley', '2026-02-08')).toBe(
      'Home Sweet | Marley | 08.02.2026',
    );
  });

  it('builds title + presenter when no date', () => {
    expect(buildMixcloudTitle('OCC Global Takeover', 'DJ Soupnoodle')).toBe(
      'OCC Global Takeover | DJ Soupnoodle',
    );
  });

  it('returns just the title when no presenter or date', () => {
    expect(buildMixcloudTitle('Solo Show')).toBe('Solo Show');
  });

  it('returns title + date when presenter is null', () => {
    expect(buildMixcloudTitle('Mystery Show', null, '2026-01-01')).toBe(
      'Mystery Show | 01.01.2026',
    );
  });
});

describe('reconcileMetadata', () => {
  it('parses a Mixcloud-format title string into separate fields', () => {
    const result = reconcileMetadata({
      title: 'Heuristic | Strict Face | 08.02.2026',
    });
    expect(result).toEqual({
      title: 'Heuristic',
      presenter: 'Strict Face',
      broadcastDate: '2026-02-08',
      mixcloudTitle: 'Heuristic | Strict Face | 08.02.2026',
    });
  });

  it('builds Mixcloud title from separate episode fields', () => {
    const result = reconcileMetadata({
      title: 'Pranzo',
      presenter: 'A$AP Gnocchi',
      broadcastDate: '2026-02-08',
    });
    expect(result).toEqual({
      title: 'Pranzo',
      presenter: 'A$AP Gnocchi',
      broadcastDate: '2026-02-08',
      mixcloudTitle: 'Pranzo | A$AP Gnocchi | 08.02.2026',
    });
  });

  it('handles an episode with only a title', () => {
    const result = reconcileMetadata({ title: 'Unknown Episode' });
    expect(result).toEqual({
      title: 'Unknown Episode',
      presenter: null,
      broadcastDate: null,
      mixcloudTitle: 'Unknown Episode',
    });
  });
});
