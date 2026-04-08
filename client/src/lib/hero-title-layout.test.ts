import { beforeEach, describe, expect, it, vi } from 'vitest';

const prepareWithSegmentsMock = vi.fn((text: string, font: string) => ({
  font,
  prepared: `prepared:${text}`,
}));

const layoutWithLinesMock = vi.fn((_prepared: unknown, width: number, lineHeight: number) => ({
  height: lineHeight * 2,
  lines: [
    { end: 4, start: 0, text: 'Duck', width: width * 0.52 },
    { end: 9, start: 5, text: 'Feed', width: width * 0.48 },
  ],
}));

vi.mock('@chenglou/pretext', () => ({
  layoutWithLines: layoutWithLinesMock,
  prepareWithSegments: prepareWithSegmentsMock,
}));

describe('layoutHeroTitle', () => {
  beforeEach(() => {
    prepareWithSegmentsMock.mockClear();
    layoutWithLinesMock.mockClear();
  });

  it('reuses prepared text when only width changes', async () => {
    const { HERO_TITLE_FONT, clearHeroTitleLayoutCache, layoutHeroTitle } = await import('./hero-title-layout');
    clearHeroTitleLayoutCache();

    const first = layoutHeroTitle({
      lineHeight: 74,
      text: 'duckfeed Forever',
      width: 420,
    });
    const second = layoutHeroTitle({
      lineHeight: 74,
      text: 'duckfeed Forever',
      width: 360,
    });

    expect(HERO_TITLE_FONT).toContain('Helvetica Neue');
    expect(prepareWithSegmentsMock).toHaveBeenCalledTimes(1);
    expect(prepareWithSegmentsMock).toHaveBeenCalledWith('duckfeed Forever', HERO_TITLE_FONT);
    expect(layoutWithLinesMock).toHaveBeenCalledTimes(2);
    expect(first.lines).toHaveLength(2);
    expect(second.lines).toHaveLength(2);
  });

  it('prepares again when the font changes', async () => {
    const { clearHeroTitleLayoutCache, layoutHeroTitle } = await import('./hero-title-layout');
    clearHeroTitleLayoutCache();

    layoutHeroTitle({
      font: '400 68px "Helvetica Neue"',
      lineHeight: 72,
      text: 'duckfeed',
      width: 400,
    });
    layoutHeroTitle({
      font: '500 68px "Helvetica Neue"',
      lineHeight: 72,
      text: 'duckfeed',
      width: 400,
    });

    expect(prepareWithSegmentsMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty layout for zero or negative widths', async () => {
    const { clearHeroTitleLayoutCache, layoutHeroTitle } = await import('./hero-title-layout');
    clearHeroTitleLayoutCache();

    const layout = layoutHeroTitle({
      lineHeight: 72,
      text: 'duckfeed',
      width: 0,
    });

    expect(layout).toEqual({
      height: 0,
      lineCount: 0,
      lines: [],
    });
    expect(prepareWithSegmentsMock).not.toHaveBeenCalled();
    expect(layoutWithLinesMock).not.toHaveBeenCalled();
  });
});
