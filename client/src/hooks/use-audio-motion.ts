import { useEffect, useRef, useState } from 'react';

const WAVEFORM_BAND_COUNT = 16;

export type AudioMotionState = {
  driftX: number;
  intensity: number;
  isAnalyserAvailable: boolean;
  isReducedMotion: boolean;
  shadowOffset: number;
  waveformBands: number[];
};

function createDefaultMotionState(isReducedMotion: boolean): AudioMotionState {
  return {
    driftX: 0,
    intensity: 0,
    isAnalyserAvailable: false,
    isReducedMotion,
    shadowOffset: 0,
    waveformBands: new Array(WAVEFORM_BAND_COUNT).fill(0),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function averageRange(data: Uint8Array, start: number, end: number): number {
  const safeStart = Math.max(0, Math.min(start, data.length));
  const safeEnd = Math.max(safeStart + 1, Math.min(end, data.length));
  let total = 0;

  for (let index = safeStart; index < safeEnd; index += 1) {
    total += data[index] ?? 0;
  }

  return total / (safeEnd - safeStart);
}

function createWaveformBands(data: Uint8Array): number[] {
  const bands: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / WAVEFORM_BAND_COUNT));

  for (let bandIndex = 0; bandIndex < WAVEFORM_BAND_COUNT; bandIndex += 1) {
    const start = bandIndex * stride;
    const end = bandIndex === WAVEFORM_BAND_COUNT - 1 ? data.length : start + stride;
    bands.push(clamp(averageRange(data, start, end) / 255, 0, 1));
  }

  return bands;
}

function getInitialReducedMotionPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type AudioGraph = {
  analyser: AnalyserNode;
  audioContext: AudioContext;
  sourceNode: MediaElementAudioSourceNode;
};

function getAudioContextConstructor() {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

function destroyAudioGraph(audioGraph: AudioGraph | null): void {
  if (!audioGraph) {
    return;
  }

  audioGraph.sourceNode.disconnect();
  audioGraph.analyser.disconnect();
  void audioGraph.audioContext.close().catch(() => undefined);
}

function createAudioGraph(audioElement: HTMLAudioElement): AudioGraph | null {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    return null;
  }

  try {
    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    const sourceNode = audioContext.createMediaElementSource(audioElement);

    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.82;
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);

    return {
      analyser,
      audioContext,
      sourceNode,
    };
  } catch {
    return null;
  }
}

export function useAudioMotion(
  audioElement: HTMLAudioElement | null,
  enabled = true,
): {
  activate: () => void;
  motion: AudioMotionState;
} {
  const [isReducedMotion, setIsReducedMotion] = useState(getInitialReducedMotionPreference);
  const [motion, setMotion] = useState<AudioMotionState>(() =>
    createDefaultMotionState(getInitialReducedMotionPreference()),
  );
  const [isActivated, setIsActivated] = useState(false);
  const audioGraphRef = useRef<AudioGraph | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsReducedMotion(event.matches);
    };

    setIsReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);
    mediaQuery.addListener?.(handleChange);

    return () => {
      mediaQuery.removeEventListener?.('change', handleChange);
      mediaQuery.removeListener?.(handleChange);
    };
  }, []);

  useEffect(() => {
    if (!audioElement || isReducedMotion) {
      destroyAudioGraph(audioGraphRef.current);
      audioGraphRef.current = null;
      setIsActivated(false);
      setMotion(createDefaultMotionState(isReducedMotion));
      return;
    }

    return () => {
      destroyAudioGraph(audioGraphRef.current);
      audioGraphRef.current = null;
      setIsActivated(false);
    };
  }, [audioElement, isReducedMotion]);

  useEffect(() => {
    if (!audioElement || !enabled || isReducedMotion || !isActivated) {
      setMotion(createDefaultMotionState(isReducedMotion));
      return;
    }

    const audioGraph = audioGraphRef.current;
    if (!audioGraph) {
      setMotion(createDefaultMotionState(isReducedMotion));
      return;
    }

    let animationFrameId = 0;
    let isCancelled = false;
    const idleState = createDefaultMotionState(isReducedMotion);
    const frequencyData = new Uint8Array(audioGraph.analyser.frequencyBinCount);

    const tick = () => {
      if (isCancelled) {
        return;
      }

      try {
        audioGraph.analyser.getByteFrequencyData(frequencyData);
        if (!audioElement.paused && audioGraph.audioContext.state === 'suspended') {
          void audioGraph.audioContext.resume().catch(() => undefined);
        }

        const lowEnergy = averageRange(frequencyData, 0, Math.max(1, Math.floor(frequencyData.length * 0.25))) / 255;
        const midEnergy =
          averageRange(
            frequencyData,
            Math.floor(frequencyData.length * 0.25),
            Math.max(1, Math.floor(frequencyData.length * 0.55)),
          ) / 255;
        const intensity = clamp(lowEnergy * 0.65 + midEnergy * 0.35, 0, 1);

        setMotion({
          driftX: clamp(Number((intensity * 4).toFixed(3)), 0, 4),
          intensity,
          isAnalyserAvailable: true,
          isReducedMotion: false,
          shadowOffset: clamp(Number((intensity * 3).toFixed(3)), 0, 3),
          waveformBands: createWaveformBands(frequencyData),
        });
      } catch {
        setMotion(idleState);
        return;
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      isCancelled = true;
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [audioElement, enabled, isActivated, isReducedMotion]);

  function activate(): void {
    if (!audioElement || isReducedMotion) {
      return;
    }

    if (!audioGraphRef.current) {
      audioGraphRef.current = createAudioGraph(audioElement);
    }

    const audioGraph = audioGraphRef.current;
    if (!audioGraph) {
      setMotion(createDefaultMotionState(isReducedMotion));
      return;
    }

    setIsActivated(true);
    if (audioGraph.audioContext.state === 'suspended') {
      void audioGraph.audioContext.resume().catch(() => undefined);
    }
  }

  return { activate, motion };
}
