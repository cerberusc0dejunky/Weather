import { useRef, useCallback, useEffect } from 'react';

export const useStormSiren = () => {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<any>(null);
  const activeLevelRef = useRef<number>(0);

  const init = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    activeLevelRef.current = 0;
  }, []);

  const play = useCallback((level: number, enabled: boolean) => {
    if (!enabled) {
      stop();
      return;
    }
    init();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (activeLevelRef.current === level) return;
    stop();
    activeLevelRef.current = level;

    // Pitch & waves matching warning categories
    const frequency = level === 3 ? 1200 : level === 2 ? 880 : 440;
    const duration = level === 3 ? 0.8 : level === 2 ? 0.4 : 0.2;
    const pause = level === 3 ? 200 : level === 2 ? 600 : 2000;
    const waveType = level === 3 ? 'sawtooth' : 'square';

    let beepCount = 0;

    const runBeep = () => {
      const currentCtx = audioCtxRef.current;
      if (!currentCtx || activeLevelRef.current !== level) return;

      const osc = currentCtx.createOscillator();
      const gain = currentCtx.createGain();

      osc.type = waveType;
      osc.frequency.setValueAtTime(frequency, currentCtx.currentTime);

      gain.gain.setValueAtTime(0.0001, currentCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, currentCtx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentCtx.currentTime + duration - 0.04);

      osc.connect(gain);
      gain.connect(currentCtx.destination);

      osc.start();
      osc.stop(currentCtx.currentTime + duration);

      beepCount++;
      if (level < 3 && beepCount >= 10) {
        stop();
      }
    };

    runBeep();
    intervalRef.current = setInterval(runBeep, duration * 1000 + pause);
  }, [init, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { playSiren: play, stopSiren: stop };
};
