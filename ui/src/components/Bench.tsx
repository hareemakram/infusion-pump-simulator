import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { FaultSpec, PumpEvent, Sample, Snapshot } from '../api/types';
import { formatClock, formatPressure, formatRate, formatVolume } from '../domain/format';
import { TrendChart } from './TrendChart';

const SPEEDS = [1, 2, 5, 10, 20];

function Panel({ title, aside, children, className = '' }: {
  title: string; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function FaultPanel({ catalog, active }: { catalog: FaultSpec[]; active: string[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, FaultSpec[]>();
    catalog.forEach((f) => m.set(f.group, [...(m.get(f.group) ?? []), f]));
    return [...m.entries()];
  }, [catalog]);

  const toggle = async (f: FaultSpec) => {
    setPending(f.id);
    try {
      await api.fault(f.id, f.pulse || !active.includes(f.id) ? 'inject' : 'clear');
    } finally {
      setPending(null);
    }
  };

  return (
    <Panel title="Fault injection" aside={<span className="panel__meta">{active.length} active</span>}>
      <div className="faults">
        {groups.map(([group, faults]) => (
          <div key={group} className="faults__group">
            <h3 className="faults__group-title">{group}</h3>
            <ul>
              {faults.map((f) => {
                const on = active.includes(f.id);
                return (
                  <li key={f.id} className={`fault ${on ? 'is-on' : ''}`}>
                    <div className="fault__text">
                      <span className="fault__label">{f.label}</span>
                      <span className="fault__desc">{f.description}</span>
                      <code className="fault__alarm">{f.expected_alarm}</code>
                    </div>
                    {f.pulse ? (
                      <button type="button" className="btn btn--sm" onClick={() => void toggle(f)}
                              disabled={pending === f.id} data-fault={f.id}>
                        Trigger
                      </button>
                    ) : (
                      <button type="button" role="switch" aria-checked={on} aria-label={f.label}
                              className="switch" onClick={() => void toggle(f)} disabled={pending === f.id}
                              data-fault={f.id}>
                        <span className="switch__knob" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function TrendPanel({ history, threshold }: { history: Sample[]; threshold: number }) {
  return (
    <Panel title="Line pressure" aside={
      <span className="legend">
        <span className="legend__item legend__item--down">Downstream</span>
        <span className="legend__item legend__item--up">Upstream</span>
        <span className="legend__item legend__item--limit">Alarm {formatPressure(threshold)}</span>
      </span>
    }>
      <TrendChart samples={history} threshold={threshold} />
    </Panel>
  );
}

export function TruthPanel({ snapshot }: { snapshot: Snapshot }) {
  const { status, plant } = snapshot;
  const rows: [string, string, string][] = [
    ['Flow', `${formatRate(status.motor_enabled ? status.active_rate : 0)} mL/h`, `${formatRate(plant.flow_ml_h)} mL/h`],
    ['Downstream', `${formatPressure(status.downstream)} mmHg`, `${formatPressure(plant.downstream_true)} mmHg`],
    ['Container', `${formatVolume(status.reservoir)} mL`, `${formatVolume(plant.reservoir_ml)} mL`],
    ['Air in line', `${formatVolume(status.air_cumulative / 1000)} mL / 15 min`, `${formatVolume(plant.air_to_patient_ul / 1000)} mL total`],
  ];
  return (
    <Panel title="Pump view vs. simulated reality">
      <table className="truth">
        <thead><tr><th /><th>Pump reports</th><th>Plant model</th></tr></thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}><th scope="row">{k}</th><td className="num">{a}</td><td className="num">{b}</td></tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function EventLog({ events }: { events: PumpEvent[] }) {
  const recent = events.slice(-80).reverse();
  return (
    <Panel title="Event log" aside={<span className="panel__meta">Audit trail</span>} className="panel--log">
      <ol className="log" aria-live="off">
        {recent.map((e) => (
          <li key={e.id} className={`log__row log__row--${e.kind.toLowerCase()}`}>
            <span className="log__t num">{formatClock(e.t)}</span>
            <span className="log__kind">{e.kind}</span>
            <span className="log__msg">{e.message}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function SimControls({ speed, sound, onSound }: { speed: number; sound: boolean; onSound: (v: boolean) => void }) {
  return (
    <div className="simbar">
      <div className="segmented" role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? 'is-on' : ''}
                  onClick={() => void api.sim({ speed: s })}>
            {s}×
          </button>
        ))}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={sound} onChange={(e) => onSound(e.target.checked)} />
        <span>Alarm sound</span>
      </label>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => void api.sim({ action: 'restart' })}>
        Reset simulation
      </button>
    </div>
  );
}
