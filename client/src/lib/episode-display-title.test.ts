import { describe, expect, it } from 'vitest';
import { formatEpisodeDisplayTitle, getEpisodeDisplayTitleParts } from './episode-display-title';

describe('getEpisodeDisplayTitleParts', () => {
  it('splits long titles on a spaced hyphen-like separator', () => {
    expect(
      getEpisodeDisplayTitleParts({
        title: 'Duck Feed Late Night Archive Transmission - Valentines Day Special',
      }),
    ).toMatchObject({
      primaryTitle: 'Duck Feed Late Night Archive Transmission',
      secondaryTitle: 'Valentines Day Special',
    });

    expect(
      getEpisodeDisplayTitleParts({
        title: 'Duck Feed Late Night Archive Transmission – Valentines Day Special',
      }),
    ).toMatchObject({
      primaryTitle: 'Duck Feed Late Night Archive Transmission',
      secondaryTitle: 'Valentines Day Special',
    });

    expect(
      getEpisodeDisplayTitleParts({
        title: 'Duck Feed Late Night Archive Transmission — Valentines Day Special',
      }),
    ).toMatchObject({
      primaryTitle: 'Duck Feed Late Night Archive Transmission',
      secondaryTitle: 'Valentines Day Special',
    });
  });

  it('does not split short titles even when they contain a separator', () => {
    expect(
      getEpisodeDisplayTitleParts({
        title: 'Duck Feed - Live',
      }),
    ).toMatchObject({
      primaryTitle: 'Duck Feed - Live',
      secondaryTitle: null,
    });
  });

  it('does not split hyphenated words without spaced separators', () => {
    expect(
      getEpisodeDisplayTitleParts({
        title: 'Electro-pop Adventures Through Duck Feed History',
      }),
    ).toMatchObject({
      primaryTitle: 'Electro-pop Adventures Through Duck Feed History',
      secondaryTitle: null,
    });
  });

  it('splits on the last eligible separator when a long title has multiple segments', () => {
    expect(
      getEpisodeDisplayTitleParts({
        title: 'Duck Feed Late Night Archive Transmission - Live In Studio - Valentines Day Special',
      }),
    ).toMatchObject({
      primaryTitle: 'Duck Feed Late Night Archive Transmission - Live In Studio',
      secondaryTitle: 'Valentines Day Special',
    });
  });

  it('keeps presenter metadata alongside the formatted display title', () => {
    expect(
      getEpisodeDisplayTitleParts({
        presenter: 'DJ Reservoir',
        title: 'Duck Feed Late Night Archive Transmission - Valentines Day Special',
      }),
    ).toMatchObject({
      displayTitle: 'Duck Feed Late Night Archive Transmission - Valentines Day Special | DJ Reservoir',
      presenter: 'DJ Reservoir',
      primaryTitle: 'Duck Feed Late Night Archive Transmission',
      secondaryTitle: 'Valentines Day Special',
    });
  });
});

describe('formatEpisodeDisplayTitle', () => {
  it('returns the legacy plain string display title', () => {
    expect(
      formatEpisodeDisplayTitle({
        presenter: 'DJ Reservoir',
        title: 'Duck Feed Late Night Archive Transmission - Valentines Day Special',
      }),
    ).toBe('Duck Feed Late Night Archive Transmission - Valentines Day Special | DJ Reservoir');
  });
});
