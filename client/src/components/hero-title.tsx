import { useEffect, useRef, useState } from 'react';
import type { AudioMotionState } from '../hooks/use-audio-motion';
import { getEpisodeDisplayTitleParts } from '../lib/episode-display-title';
import { getHeroTitleFont, layoutHeroTitle } from '../lib/hero-title-layout';

const HERO_TITLE_MIN_FONT_SIZE = 13;
const HERO_TITLE_FONT_SIZES = [44, 40, 36, 32, 28, 26, 24, 22, 20, 18, 16, 14, 13];
const HERO_TITLE_LINE_HEIGHT_RATIO = 74 / 68;
const HERO_TITLE_SECONDARY_MIN_FONT_SIZE = 11;
const HERO_TITLE_SECONDARY_SCALE = 0.72;

function getHeroTitleLineHeight(fontSize: number): number {
  return Math.round(fontSize * HERO_TITLE_LINE_HEIGHT_RATIO);
}

function getFallbackLayout() {
  return {
    fontSize: HERO_TITLE_MIN_FONT_SIZE,
    lineHeight: getHeroTitleLineHeight(HERO_TITLE_MIN_FONT_SIZE),
  };
}

function getSecondaryLayout(primaryFontSize: number) {
  const fontSize = Math.max(HERO_TITLE_SECONDARY_MIN_FONT_SIZE, Math.round(primaryFontSize * HERO_TITLE_SECONDARY_SCALE));

  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.08),
  };
}

/**
 * Walk the size scale from largest to smallest and pick the first font size
 * that lays the title out on a single line. We never wrap and never ellipsis —
 * if nothing fits we fall back to the smallest configured size, which the
 * caller will still render in a single nowrap line (clipped at the container
 * edge if absolutely necessary).
 */
function getResponsiveLayout(title: string, width: number) {
  for (const fontSize of HERO_TITLE_FONT_SIZES) {
    const lineHeight = getHeroTitleLineHeight(fontSize);
    const layout = layoutHeroTitle({
      font: getHeroTitleFont(fontSize),
      lineHeight,
      text: title,
      width,
    });

    if (layout.lines.length === 0) {
      continue;
    }

    if (layout.lineCount === 1) {
      return { fontSize, lineHeight };
    }
  }

  return getFallbackLayout();
}

function getLineMotion(
  index: number,
  lineCount: number,
  motion: AudioMotionState,
): {
  shadowX: number;
  x: number;
  y: number;
} {
  const hasMotion = motion.isAnalyserAvailable && !motion.isReducedMotion && motion.intensity > 0.03;
  if (!hasMotion) {
    return { shadowX: 0, x: 0, y: 0 };
  }

  const relativeIndex = lineCount === 1 ? 0 : index / (lineCount - 1) - 0.5;
  return {
    shadowX: Number((motion.shadowOffset * (relativeIndex === 0 ? 0.35 : relativeIndex * 1.5)).toFixed(3)),
    x: Number((motion.driftX * relativeIndex * 1.6).toFixed(3)),
    y: Number((Math.sin((index + 1) * 1.1) * motion.intensity * 1.35).toFixed(3)),
  };
}

export function HeroTitle({
  align = 'center',
  motion,
  title,
}: {
  align?: 'center' | 'left';
  motion: AudioMotionState;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => {
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? element.clientWidth;
      setWidth(nextWidth);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const titleParts = getEpisodeDisplayTitleParts({ title });
  const responsiveLayout = width > 0 ? getResponsiveLayout(titleParts.primaryTitle, width) : getFallbackLayout();
  const secondaryLayout = getSecondaryLayout(responsiveLayout.fontSize);
  const hasMotion = motion.isAnalyserAvailable && !motion.isReducedMotion && motion.intensity > 0.03;
  const primaryLineMotion = getLineMotion(0, titleParts.secondaryTitle ? 2 : 1, motion);
  const secondaryLineMotion = getLineMotion(1, 2, motion);

  return (
    <div
      className="mt-3 font-medium tracking-[-0.05em]"
      data-motion={hasMotion ? 'active' : 'static'}
      data-testid="hero-title"
      ref={containerRef}
      style={{
        fontSize: `${responsiveLayout.fontSize}px`,
        lineHeight: `${responsiveLayout.lineHeight}px`,
      }}
    >
      {titleParts.secondaryTitle ? (
        <>
          <span
            className="block transition-[transform,text-shadow] duration-150 ease-out"
            data-testid="hero-title-primary"
            style={{
              marginInline: align === 'center' ? 'auto' : undefined,
              maxWidth: '100%',
              textShadow:
                primaryLineMotion.shadowX === 0 ? 'none' : `${primaryLineMotion.shadowX}px 0 0 #2C398C`,
              transform: `translate3d(${primaryLineMotion.x}px, ${primaryLineMotion.y}px, 0)`,
              whiteSpace: 'nowrap',
            }}
            title={title}
          >
            {titleParts.primaryTitle}
          </span>
          <span
            className="mt-1 block text-white/72 transition-[transform,text-shadow] duration-150 ease-out"
            data-testid="hero-title-secondary"
            style={{
              fontSize: `${secondaryLayout.fontSize}px`,
              lineHeight: `${secondaryLayout.lineHeight}px`,
              marginInline: align === 'center' ? 'auto' : undefined,
              maxWidth: '100%',
              textShadow:
                secondaryLineMotion.shadowX === 0 ? 'none' : `${secondaryLineMotion.shadowX}px 0 0 #2C398C`,
              transform: `translate3d(${secondaryLineMotion.x}px, ${secondaryLineMotion.y}px, 0)`,
              whiteSpace: 'normal',
            }}
          >
            {titleParts.secondaryTitle}
          </span>
        </>
      ) : (
        <span
          className="block transition-[transform,text-shadow] duration-150 ease-out"
          data-testid="hero-title-line"
          style={{
            marginInline: align === 'center' ? 'auto' : undefined,
            maxWidth: '100%',
            textShadow: primaryLineMotion.shadowX === 0 ? 'none' : `${primaryLineMotion.shadowX}px 0 0 #2C398C`,
            transform: `translate3d(${primaryLineMotion.x}px, ${primaryLineMotion.y}px, 0)`,
            whiteSpace: 'nowrap',
          }}
          title={title}
        >
          {title}
        </span>
      )}
    </div>
  );
}
