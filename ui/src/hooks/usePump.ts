import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { PumpEvent, Sample, Snapshot, Status } from '../api/types';

export type LinkState = 'connecting' | 'live' | 'stale';

export interface PumpView {
  snapshot: Snapshot | null;
  history: Sample[];
  events: PumpEvent[];
  link: LinkState;
  /** Apply a status returned by a command, so the screen reacts before the next stream frame. */
  applyStatus: (s: Status) => void;
  reload: () => void;
}

const MAX_HISTORY = 1800; // 3 min at 10 Hz
const MAX_EVENTS = 300;
/** If no frame arrives for this long the screen greys out the live values. */
export const STALE_AFTER_MS = 1500;

export function usePump(): PumpView {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [events, setEvents] = useState<PumpEvent[]>([]);
  const [link, setLink] = useState<LinkState>('connecting');
  const lastFrame = useRef(0);
  const lastT = useRef(-1);

  const load = useCallback(async () => {
    try {
      const s = await api.state();
      lastT.current = s.t;
      lastFrame.current = Date.now();
      setSnapshot(s);
      setHistory(s.history ?? []);
      setEvents(s.events.slice(-MAX_EVENTS));
      setLink('live');
    } catch {
      setLink('stale');
    }
  }, []);

  useEffect(() => {
    void load();
    const es = new EventSource('/api/stream');
    es.onmessage = (msg) => {
      const s = JSON.parse(msg.data) as Snapshot;
      if (s.error) {
        setLink('stale');
        return;
      }
      lastFrame.current = Date.now();
      setLink('live');
      if (s.t < lastT.current) {
        // Simulation restarted: start over from a full snapshot.
        lastT.current = s.t;
        void load();
        return;
      }
      lastT.current = s.t;
      setSnapshot(s);
      if (s.sample) {
        const sample = s.sample;
        setHistory((h) => {
          const next = h.length >= MAX_HISTORY ? h.slice(h.length - MAX_HISTORY + 1) : h.slice();
          next.push(sample);
          return next;
        });
      }
      if (s.events.length) {
        setEvents((ev) => {
          const known = ev.length ? ev[ev.length - 1].id : 0;
          const fresh = s.events.filter((e) => e.id > known);
          return fresh.length ? [...ev, ...fresh].slice(-MAX_EVENTS) : ev;
        });
      }
    };
    es.onerror = () => setLink('stale');
    const watchdog = window.setInterval(() => {
      if (lastFrame.current && Date.now() - lastFrame.current > STALE_AFTER_MS) setLink('stale');
    }, 500);
    return () => {
      es.close();
      window.clearInterval(watchdog);
    };
  }, [load]);

  const applyStatus = useCallback((status: Status) => {
    setSnapshot((s) => (s ? { ...s, status } : s));
  }, []);

  return { snapshot, history, events, link, applyStatus, reload: () => void load() };
}
