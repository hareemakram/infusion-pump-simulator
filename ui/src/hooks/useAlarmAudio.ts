import { useEffect, useRef } from 'react';
import type { Priority } from '../api/types';

/**
 * Audible alarm signals loosely following the IEC 60601-1-8 burst structure:
 * high = 10 pulses repeating every 5 s, medium = 3 pulses every 8 s,
 * low = 2 pulses every 20 s. Disabled unless the operator turns sound on,
 * because browsers block audio without a user gesture.
 */
const PATTERNS: Record<Exclude<Priority, 'NONE'>, { pulses: number[]; repeatMs: number; freq: number }> = {
  HIGH: { pulses: [0, 120, 240, 480, 600, 1100, 1220, 1340, 1580, 1700], repeatMs: 5000, freq: 880 },
  MEDIUM: { pulses: [0, 200, 400], repeatMs: 8000, freq: 660 },
  LOW: { pulses: [0, 250], repeatMs: 20000, freq: 520 },
};

export function useAlarmAudio(priority: Priority, audible: boolean, enabled: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled || !audible || priority === 'NONE') return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = ctxRef.current ?? new Ctx();
    ctxRef.current = ctx;
    const pattern = PATTERNS[priority];

    const burst = () => {
      const t0 = ctx.currentTime + 0.02;
      for (const offset of pattern.pulses) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = pattern.freq;
        const start = t0 + offset / 1000;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
        gain.gain.setValueAtTime(0.18, start + 0.09);
        gain.gain.linearRampToValueAtTime(0, start + 0.11);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.12);
      }
    };
    void ctx.resume();
    burst();
    const id = window.setInterval(burst, pattern.repeatMs);
    return () => window.clearInterval(id);
  }, [priority, audible, enabled]);
}
