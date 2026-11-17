import type { Drug } from '../api/types';
import type { LimitCheck } from '../domain/dose';
import { scalePosition } from '../domain/dose';
import { formatDose } from '../domain/format';

/** Horizontal scale of hard and soft limits with the entered dose marked on it. */
export function LimitScale({ drug, dose, check }: { drug: Drug; dose: number | null; check: LimitCheck }) {
  const pos = (v: number) => `${(scalePosition(drug, v) * 100).toFixed(2)}%`;
  const softLo = scalePosition(drug, drug.soft_min);
  const softHi = scalePosition(drug, drug.soft_max);
  const hardHi = scalePosition(drug, drug.hard_max);
  return (
    <div className="scale" data-check={check} aria-hidden>
      <div className="scale__track">
        <div className="scale__zone scale__zone--soft" style={{ left: 0, width: `${softLo * 100}%` }} />
        <div className="scale__zone scale__zone--ok" style={{ left: `${softLo * 100}%`, width: `${(softHi - softLo) * 100}%` }} />
        <div className="scale__zone scale__zone--soft" style={{ left: `${softHi * 100}%`, width: `${(hardHi - softHi) * 100}%` }} />
        <div className="scale__zone scale__zone--hard" style={{ left: `${hardHi * 100}%`, right: 0 }} />
        {dose != null && <div className="scale__marker" style={{ left: pos(dose) }} />}
      </div>
      <div className="scale__labels">
        <span style={{ left: pos(drug.soft_min) }}>{formatDose(drug.soft_min)}</span>
        <span style={{ left: pos(drug.soft_max) }}>{formatDose(drug.soft_max)}</span>
        <span className="scale__hard" style={{ left: pos(drug.hard_max) }}>{formatDose(drug.hard_max)} max</span>
      </div>
    </div>
  );
}
