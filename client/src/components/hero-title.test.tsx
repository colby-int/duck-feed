import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroTitle } from './hero-title';

const { layoutHeroTitleMock } = vi.hoisted(() => ({
  layoutHeroTitleMock: vi.fn(() => ({
    height: 148,
    lineCount: 2,
    lines: [
      { end: { graphemeIndex: 4, segmentIndex: 0 }, start: { graphemeIndex: 0, segmentIndex: 0 }, text: 'duckfeed', width: 320 },
      { end: { graphemeIndex: 7, segmentIndex: 1 }, start: { graphemeIndex: 5, segmentIndex: 0 }, text: 'Forever', width: 248 },
    ],
  })),
}));

vi.mock('../lib/hero-title-layout', () => ({
  HERO_TITLE_FONT: '500 68px "Helvetica Neue", Helvetica, Arial, sans-serif',
  getHeroTitleFont: (fontSize: number) => `500 ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`,
  layoutHeroTitle: layoutHeroTitleMock,
}));

function createMotion(overrides?: Partial<Parameters<typeof HeroTitle>[0]['motion']>) {
  return {
    driftX: 2,
    intensity: 0.75,
    isAnalyserAvailable: true,
    isReducedMotion: false,
    shadowOffset: 1.5,
    waveformBands: new Array(16).fill(0.4),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  layoutHeroTitleMock.mockReset();
  layoutHeroTitleMock.mockImplementation(() => ({
    height: 148,
    lineCount: 2,
    lines: [
      { end: { graphemeIndex: 4, segmentIndex: 0 }, start: { graphemeIndex: 0, segmentIndex: 0 }, text: 'duckfeed', width: 320 },
      { end: { graphemeIndex: 7, segmentIndex: 1 }, start: { graphemeIndex: 5, segmentIndex: 0 }, text: 'Forever', width: 248 },
    ],
  }));
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class MockResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback(
          [
            {
              borderBoxSize: [],
              contentBoxSize: [],
              contentRect: {
                bottom: 0,
                height: 160,
                left: 0,
                right: 480,
                top: 0,
                width: 480,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              },
              devicePixelContentBoxSize: [],
              target: document.createElement('div'),
            },
          ] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }

      disconnect() {}
      unobserve() {}
    },
    writable: true,
  });
});

describe('HeroTitle', () => {
  it('shrinks to one line before wrapping when a smaller headline size fits', () => {
    layoutHeroTitleMock
      .mockReturnValueOnce({
        height: 148,
        lineCount: 2,
        lines: [
          { end: { graphemeIndex: 10, segmentIndex: 0 }, start: { graphemeIndex: 0, segmentIndex: 0 }, text: 'Home Sweet |', width: 320 },
          { end: { graphemeIndex: 17, segmentIndex: 1 }, start: { graphemeIndex: 11, segmentIndex: 0 }, text: 'Marley', width: 248 },
        ],
      })
      .mockReturnValueOnce({
        height: 66,
        lineCount: 1,
        lines: [
          { end: { graphemeIndex: 17, segmentIndex: 0 }, start: { graphemeIndex: 0, segmentIndex: 0 }, text: 'Home Sweet | Marley', width: 412 },
        ],
      });

    render(<HeroTitle motion={createMotion()} title="Home Sweet | Marley" />);

    expect(layoutHeroTitleMock).toHaveBeenCalledTimes(2);
    expect(layoutHeroTitleMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        font: '500 44px "Helvetica Neue", Helvetica, Arial, sans-serif',
      }),
    );
    expect(layoutHeroTitleMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        font: '500 40px "Helvetica Neue", Helvetica, Arial, sans-serif',
      }),
    );
    expect(screen.getAllByTestId('hero-title-line')).toHaveLength(1);
    expect(screen.getByText('Home Sweet | Marley')).toBeInTheDocument();
    expect(screen.getByTestId('hero-title')).toHaveStyle({
      fontSize: '40px',
      lineHeight: '44px',
    });
  });

  it('keeps the title on one line even when the layout engine reports wrapping', () => {
    render(<HeroTitle motion={createMotion()} title="duckfeed Forever" />);

    expect(screen.getAllByTestId('hero-title-line')).toHaveLength(1);
    expect(screen.getByTestId('hero-title-line')).toHaveTextContent('duckfeed Forever');
  });

  it('renders a static title when motion is unavailable', () => {
    render(
      <HeroTitle
        motion={createMotion({ driftX: 0, intensity: 0, isAnalyserAvailable: false, shadowOffset: 0 })}
        title="duckfeed Forever"
      />,
    );

    expect(screen.getByTestId('hero-title')).toHaveAttribute('data-motion', 'static');
  });

  it('removes animated transforms when reduced motion is preferred', () => {
    render(<HeroTitle motion={createMotion({ isReducedMotion: true })} title="duckfeed Forever" />);

    expect(screen.getByTestId('hero-title')).toHaveAttribute('data-motion', 'static');
    expect(screen.getByTestId('hero-title-line')).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0)',
    });
  });

  it('stays readable when the title fits on one line', () => {
    layoutHeroTitleMock.mockReturnValueOnce({
      height: 74,
      lineCount: 1,
      lines: [
        { end: { graphemeIndex: 4, segmentIndex: 0 }, start: { graphemeIndex: 0, segmentIndex: 0 }, text: 'duckfeed', width: 320 },
      ],
    });

    render(<HeroTitle motion={createMotion()} title="duckfeed" />);

    expect(screen.getAllByTestId('hero-title-line')).toHaveLength(1);
    expect(screen.getByText('duckfeed')).toBeInTheDocument();
  });

  it('falls back to the smallest configured size when nothing fits on one line', () => {
    layoutHeroTitleMock.mockReturnValue({
      height: 148,
      lineCount: 2,
      lines: [
        { end: { graphemeIndex: 10, segmentIndex: 0 }, start: { graphemeIndex: 0, segmentIndex: 0 }, text: 'duckfeed', width: 320 },
        { end: { graphemeIndex: 17, segmentIndex: 1 }, start: { graphemeIndex: 11, segmentIndex: 0 }, text: 'Forever', width: 248 },
      ],
    });

    render(<HeroTitle motion={createMotion()} title="A Very Long Duckfeed Broadcast Title" />);

    // Even when the layout engine reports multi-line at every size, we render
    // the title on a single nowrap line at the smallest configured font size —
    // no text-overflow ellipsis is applied.
    expect(screen.getAllByTestId('hero-title-line')).toHaveLength(1);
    expect(screen.getByTestId('hero-title-line')).toHaveStyle({
      whiteSpace: 'nowrap',
    });
    expect(screen.getByTestId('hero-title-line')).toHaveTextContent('A Very Long Duckfeed Broadcast Title');
    expect(screen.getByTestId('hero-title')).toHaveStyle({
      fontSize: '16px',
    });
  });
});
