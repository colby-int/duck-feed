import type { AudioMotionState } from '../hooks/use-audio-motion';

const IDLE_WAVEFORM_LEVELS = [
  0.18, 0.22, 0.3, 0.26, 0.34, 0.24, 0.28, 0.2,
  0.2, 0.28, 0.24, 0.34, 0.26, 0.3, 0.22, 0.18,
];

function getDisplayLevels(motion: AudioMotionState, isPlaying: boolean): number[] {
  const shouldUseLiveBands =
    isPlaying &&
    motion.isAnalyserAvailable &&
    !motion.isReducedMotion &&
    motion.waveformBands.some((band) => band > 0);

  if (!shouldUseLiveBands) {
    return IDLE_WAVEFORM_LEVELS;
  }

  return motion.waveformBands.map((band) => Math.max(0.14, band));
}

export function PublicPlayerControl({
  isLoading,
  isPlaying,
  motion,
  onTogglePlayback,
}: {
  isLoading: boolean;
  isPlaying: boolean;
  motion: AudioMotionState;
  onTogglePlayback: () => void;
}) {
  const displayLevels = getDisplayLevels(motion, isPlaying);
  const centerY = 32;
  const maxBarHeight = 30;
  const barWidth = 9;
  const gap = 10;

  return (
    <div className="flex w-full items-stretch gap-3 sm:gap-4">
      <button
        aria-label={isPlaying ? 'Pause stream' : 'Play stream'}
        aria-pressed={isPlaying}
        className="flex h-16 w-16 shrink-0 items-center justify-center bg-white text-ink transition hover:bg-butter focus:outline-none focus:ring-2 focus:ring-[#3898ec] disabled:cursor-wait disabled:opacity-50"
        disabled={isLoading}
        onClick={onTogglePlayback}
        type="button"
      >
        {isLoading ? (
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
        ) : isPlaying ? (
          <svg aria-hidden="true" fill="currentColor" height="22" viewBox="0 0 24 24" width="22">
            <rect height="18" rx="1" width="5" x="6" y="3" />
            <rect height="18" rx="1" width="5" x="13" y="3" />
          </svg>
        ) : (
          <svg aria-hidden="true" fill="currentColor" height="22" viewBox="0 0 24 24" width="22">
            <path d="M7 4l13 8-13 8V4z" />
          </svg>
        )}
      </button>

      <div
        className="flex min-w-0 flex-1 items-center overflow-hidden bg-white/[0.12] px-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
        data-testid="public-waveform"
      >
        <svg
          aria-hidden="true"
          className="block h-9 w-full text-white sm:h-10"
          preserveAspectRatio="none"
          viewBox="0 0 320 64"
        >
          <line stroke="rgba(255,255,255,0.16)" strokeWidth="1" x1="0" x2="320" y1={centerY} y2={centerY} />
          {displayLevels.map((level, index) => {
            const height = Math.max(10, level * maxBarHeight);
            const x = index * (barWidth + gap) + 4;
            const y = centerY - height / 2;
            const opacity = 0.45 + Math.min(0.45, level * 0.5);

            return (
              <rect
                key={index}
                data-level={level.toFixed(3)}
                data-testid={`waveform-bar-${index}`}
                fill={`rgba(245, 193, 107, ${opacity})`}
                height={height}
                rx="3"
                width={barWidth}
                x={x}
                y={y}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
