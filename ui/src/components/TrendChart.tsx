import { useEffect, useRef } from 'react';
import type { Sample } from '../api/types';

interface Props {
  samples: Sample[];
  threshold: number;
  windowS?: number;
}

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Downstream and upstream pressure over the last two minutes, with the occlusion threshold. */
export function TrendChart({ samples, threshold, windowS = 120 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const grid = cssVar(el, '--chart-grid', '#e3e6ea');
    const ink = cssVar(el, '--chart-ink', '#6b7480');
    const down = cssVar(el, '--chart-down', '#1f6feb');
    const up = cssVar(el, '--chart-up', '#8a94a3');
    const limit = cssVar(el, '--alarm-high', '#d92d2d');

    const pad = { l: 36, r: 8, t: 8, b: 18 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const yMax = Math.max(100, Math.ceil((threshold * 1.2) / 100) * 100);
    const yMin = -200;
    const tEnd = samples.length ? samples[samples.length - 1][0] : 0;
    const tStart = tEnd - windowS * 1000;
    const x = (t: number) => pad.l + ((t - tStart) / (windowS * 1000)) * pw;
    const y = (v: number) => pad.t + (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * ph;

    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const step = yMax > 600 ? 200 : 100;
    for (let v = yMin; v <= yMax; v += step) {
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(y(v)) + 0.5);
      ctx.lineTo(w - pad.r, Math.round(y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), pad.l - 6, y(v));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let s = 0; s <= windowS; s += 30) {
      ctx.fillText(s === 0 ? 'now' : `-${s}s`, x(tEnd - s * 1000), h - 4);
    }

    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = limit;
    ctx.beginPath();
    ctx.moveTo(pad.l, y(threshold));
    ctx.lineTo(w - pad.r, y(threshold));
    ctx.stroke();
    ctx.setLineDash([]);

    const visible = samples.filter((s) => s[0] >= tStart);
    const line = (idx: 1 | 2, color: string, width: number) => {
      if (visible.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      visible.forEach((s, i) => (i ? ctx.lineTo(x(s[0]), y(s[idx])) : ctx.moveTo(x(s[0]), y(s[idx]))));
      ctx.stroke();
    };
    line(2, up, 1.25);
    line(1, down, 2);
  }, [samples, threshold, windowS]);

  return <canvas ref={canvas} className="trend" role="img" aria-label="Line pressure trend, last two minutes" />;
}
