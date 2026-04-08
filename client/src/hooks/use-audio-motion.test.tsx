import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioMotion } from './use-audio-motion';

type MatchMediaResult = {
  addEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  matches: boolean;
  media: string;
  onchange: null;
  removeEventListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

let prefersReducedMotion = false;
let paused = true;
let nextAnimationFrameId = 1;
const animationFrameCallbacks = new Map<number, FrameRequestCallback>();

const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
  const id = nextAnimationFrameId++;
  animationFrameCallbacks.set(id, callback);
  return id;
});

const cancelAnimationFrameMock = vi.fn((id: number) => {
  animationFrameCallbacks.delete(id);
});

const analyserNodeMock = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  fftSize: 0,
  frequencyBinCount: 32,
  getByteFrequencyData: vi.fn((target: Uint8Array) => {
    target.set(new Uint8Array(32));
  }),
  smoothingTimeConstant: 0,
};

const mediaElementSourceNodeMock = {
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const audioContextInstanceMock = {
  close: vi.fn(async () => undefined),
  createAnalyser: vi.fn(() => analyserNodeMock),
  createMediaElementSource: vi.fn(() => mediaElementSourceNodeMock),
  destination: {},
  resume: vi.fn(async () => undefined),
  state: 'running',
};

const audioContextConstructorMock = vi.fn(() => audioContextInstanceMock);

function setAnalyserSnapshot(level: number): void {
  analyserNodeMock.getByteFrequencyData.mockImplementation((target: Uint8Array) => {
    target.fill(level);
  });
}

function setReducedMotion(next: boolean): void {
  prefersReducedMotion = next;
}

async function flushAnimationFrame(time = 16): Promise<void> {
  const frames = [...animationFrameCallbacks.entries()];
  animationFrameCallbacks.clear();

  for (const [, callback] of frames) {
    await act(async () => {
      callback(time);
    });
  }
}

function createAudioElement(): HTMLAudioElement {
  paused = true;
  const element = document.createElement('audio');
  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => paused,
  });
  return element;
}

beforeEach(() => {
  prefersReducedMotion = false;
  paused = true;
  nextAnimationFrameId = 1;
  animationFrameCallbacks.clear();
  requestAnimationFrameMock.mockClear();
  cancelAnimationFrameMock.mockClear();
  analyserNodeMock.connect.mockClear();
  analyserNodeMock.disconnect.mockClear();
  analyserNodeMock.getByteFrequencyData.mockClear();
  mediaElementSourceNodeMock.connect.mockClear();
  mediaElementSourceNodeMock.disconnect.mockClear();
  audioContextConstructorMock.mockClear();
  audioContextInstanceMock.close.mockClear();
  audioContextInstanceMock.createAnalyser.mockClear();
  audioContextInstanceMock.createMediaElementSource.mockClear();
  audioContextInstanceMock.resume.mockClear();
  audioContextInstanceMock.state = 'running';
  setAnalyserSnapshot(0);

  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: audioContextConstructorMock,
    writable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MatchMediaResult => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: prefersReducedMotion,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }),
    writable: true,
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: requestAnimationFrameMock,
    writable: true,
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: cancelAnimationFrameMock,
    writable: true,
  });
});

describe('useAudioMotion', () => {
  it('returns zeroed motion when no audio element is provided', () => {
    const { result } = renderHook(() => useAudioMotion(null));

    expect(result.current.motion).toEqual({
      driftX: 0,
      intensity: 0,
      isAnalyserAvailable: false,
      isReducedMotion: false,
      shadowOffset: 0,
      waveformBands: new Array(16).fill(0),
    });
    expect(typeof result.current.activate).toBe('function');
    expect(audioContextConstructorMock).not.toHaveBeenCalled();
  });

  it('returns zeroed motion when reduced motion is preferred', () => {
    setReducedMotion(true);
    const audioElement = createAudioElement();

    const { result } = renderHook(() => useAudioMotion(audioElement));

    expect(result.current.motion.isReducedMotion).toBe(true);
    expect(result.current.motion.waveformBands).toEqual(new Array(16).fill(0));
    expect(audioContextConstructorMock).not.toHaveBeenCalled();
  });

  it('activates the analyser graph from an explicit user gesture', async () => {
    const audioElement = createAudioElement();
    paused = false;
    setAnalyserSnapshot(255);

    const { result } = renderHook(() => useAudioMotion(audioElement));
    expect(audioContextConstructorMock).not.toHaveBeenCalled();

    act(() => {
      result.current.activate();
    });
    await flushAnimationFrame();

    await waitFor(() => {
      expect(result.current.motion.intensity).toBeGreaterThan(0);
    });

    expect(result.current.motion.intensity).toBeLessThanOrEqual(1);
    expect(result.current.motion.driftX).toBeLessThanOrEqual(4);
    expect(result.current.motion.shadowOffset).toBeLessThanOrEqual(3);
    expect(result.current.motion.waveformBands).toHaveLength(16);
    expect(result.current.motion.waveformBands.every((value) => value <= 1 && value >= 0)).toBe(true);
    expect(result.current.motion.isAnalyserAvailable).toBe(true);
  });

  it('reuses the same media element graph across playback toggles', async () => {
    const audioElement = createAudioElement();
    paused = false;
    setAnalyserSnapshot(255);

    const { result, rerender } = renderHook(({ enabled }) => useAudioMotion(audioElement, enabled), {
      initialProps: { enabled: true },
    });

    act(() => {
      result.current.activate();
    });
    await flushAnimationFrame();
    rerender({ enabled: false });
    rerender({ enabled: true });

    act(() => {
      result.current.activate();
    });
    await flushAnimationFrame();

    expect(audioContextInstanceMock.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it('tears down animation and audio nodes on unmount', async () => {
    const audioElement = createAudioElement();
    paused = false;
    setAnalyserSnapshot(255);

    const { result, unmount } = renderHook(() => useAudioMotion(audioElement));
    act(() => {
      result.current.activate();
    });
    act(() => {
      unmount();
    });
    await flushAnimationFrame();

    expect(cancelAnimationFrameMock).toHaveBeenCalled();
    expect(mediaElementSourceNodeMock.disconnect).toHaveBeenCalled();
    expect(analyserNodeMock.disconnect).toHaveBeenCalled();
    expect(audioContextInstanceMock.close).toHaveBeenCalled();
  });
});
