import {
  layoutWithLines,
  prepareWithSegments,
  type LayoutLinesResult,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';

export function getHeroTitleFont(fontSize: number): string {
  return `500 ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
}

export const HERO_TITLE_FONT = getHeroTitleFont(68);

const preparedTextCache = new Map<string, PreparedTextWithSegments>();

function getPreparedText(text: string, font: string): PreparedTextWithSegments {
  const cacheKey = `${font}\n${text}`;
  const cached = preparedTextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const prepared = prepareWithSegments(text, font);
  preparedTextCache.set(cacheKey, prepared);
  return prepared;
}

export function clearHeroTitleLayoutCache(): void {
  preparedTextCache.clear();
}

export function layoutHeroTitle({
  font = HERO_TITLE_FONT,
  lineHeight,
  text,
  width,
}: {
  font?: string;
  lineHeight: number;
  text: string;
  width: number;
}): LayoutLinesResult {
  if (width <= 0 || text.length === 0) {
    return {
      height: 0,
      lineCount: 0,
      lines: [],
    };
  }

  const prepared = getPreparedText(text, font);
  return layoutWithLines(prepared, width, lineHeight);
}
