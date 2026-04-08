import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicPlayerControl } from './public-player-control';

function createMotion(overrides?: Partial<Parameters<typeof PublicPlayerControl>[0]['motion']>) {
  return {
    driftX: 0,
    intensity: 0,
    isAnalyserAvailable: true,
    isReducedMotion: false,
    shadowOffset: 0,
    waveformBands: new Array(16).fill(0),
    ...overrides,
  };
}

describe('PublicPlayerControl', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a play pause button wired to the provided handler', () => {
    const onTogglePlayback = vi.fn();

    render(
      <PublicPlayerControl
        isLoading={false}
        isPlaying={false}
        motion={createMotion()}
        onTogglePlayback={onTogglePlayback}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /play stream/i }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(1);
  });

  it('renders a stable idle waveform before playback begins', () => {
    render(
      <PublicPlayerControl
        isLoading={false}
        isPlaying={false}
        motion={createMotion({ isAnalyserAvailable: false })}
        onTogglePlayback={() => undefined}
      />,
    );

    expect(screen.getByTestId('public-waveform')).toBeInTheDocument();
    expect(screen.getByTestId('waveform-bar-0')).toHaveAttribute('data-level');
    expect(screen.getByTestId('waveform-bar-15')).toHaveAttribute('data-level');
  });

  it('updates waveform bars when analyser data changes', () => {
    const { rerender } = render(
      <PublicPlayerControl
        isLoading={false}
        isPlaying={true}
        motion={createMotion({ intensity: 0.1, waveformBands: new Array(16).fill(0.1) })}
        onTogglePlayback={() => undefined}
      />,
    );

    const firstBar = screen.getByTestId('waveform-bar-0');
    const initialLevel = firstBar.getAttribute('data-level');

    rerender(
      <PublicPlayerControl
        isLoading={false}
        isPlaying={true}
        motion={createMotion({ intensity: 0.9, waveformBands: new Array(16).fill(0.9) })}
        onTogglePlayback={() => undefined}
      />,
    );

    expect(screen.getByTestId('waveform-bar-0')).not.toHaveAttribute('data-level', initialLevel ?? undefined);
  });

  it('does not expose a seek or scrub control', () => {
    render(
      <PublicPlayerControl
        isLoading={false}
        isPlaying={false}
        motion={createMotion()}
        onTogglePlayback={() => undefined}
      />,
    );

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('keeps playback controls visible when analyser support is unavailable', () => {
    render(
      <PublicPlayerControl
        isLoading={false}
        isPlaying={true}
        motion={createMotion({ isAnalyserAvailable: false })}
        onTogglePlayback={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /pause stream/i })).toBeInTheDocument();
    expect(screen.getByTestId('public-waveform')).toBeInTheDocument();
  });
});
