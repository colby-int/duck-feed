import { useEffect, useRef, useState } from 'react';
import type { AudioMotionState } from '../hooks/use-audio-motion';
import { getHeroTitleFont, layoutHeroTitle } from '../lib/hero-title-layout';

const HERO_TITLE_MIN_FONT_SIZE = 13;
const HERO_TITLE_FONT_SIZES = [44, 40, 36, 32, 28, 26, 24, 22, 20, 18, 16, 14, 13];
const HERO_TITLE_LINE_HEIGHT_RATIO = 74 / 68;

function getHeroTitleLineHeight(fontSize: number): number {
  return Math.round(fontSize * HERO_TITLE_LINE_HEIGHT_RATIO);
}

function getFallbackLayout() {
  return {
    fontSize: HERO_TITLE_MIN_FONT_SIZE,
    lineHeight: getHeroTitleLineHeight(HERO_TITLE_MIN_FONT_SIZE),
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

  const responsiveLayout = width > 0 ? getResponsiveLayout(title, width) : getFallbackLayout();
  const hasMotion = motion.isAnalyserAvailable && !motion.isReducedMotion && motion.intensity > 0.03;
  const lineMotion = getLineMotion(0, 1, motion);

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
      <span
        className="block transition-[transform,text-shadow] duration-150 ease-out"
        data-testid="hero-title-line"
        style={{
          marginInline: align === 'center' ? 'auto' : undefined,
          maxWidth: '100%',
          textShadow: lineMotion.shadowX === 0 ? 'none' : `${lineMotion.shadowX}px 0 0 #2C398C`,
          transform: `translate3d(${lineMotion.x}px, ${lineMotion.y}px, 0)`,
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {title}
      </span>
    </div>
  );
}
