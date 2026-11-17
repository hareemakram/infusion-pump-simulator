import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Priority } from '../api/types';

export const SCREEN_W = 800;
export const SCREEN_H = 500;

/**
 * Pump housing. The display is laid out at a fixed 800 x 500 logical size, like
 * a real embedded panel, and scaled to fit the available width.
 */
export function Device({ priority, audible, children }: { priority: Priority; audible: boolean; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1.25, entry.contentRect.width / SCREEN_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="device">
      <div className="device__top">
        <span className="device__model">IPS-1</span>
        <div className={`lightbar lightbar--${priority.toLowerCase()} ${audible ? 'is-audible' : ''}`}
             aria-hidden data-testid="lightbar" />
        <span className="device__model device__model--right">Volumetric</span>
      </div>
      <div className="device__bezel" ref={outer}>
        <div className="device__viewport" style={{ height: SCREEN_H * scale }}>
          <div className="device__screen" style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` }}>
            {children}
          </div>
        </div>
      </div>
      <div className="device__foot">
        <span>Simulated device. Not for clinical use.</span>
      </div>
    </div>
  );
}
