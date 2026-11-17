import { useState } from 'react';
import type { CommandResponse, Drug, Sensitivity, Status } from '../api/types';
import { classify, drugConcentrationLabel, isHard, isSoft } from '../domain/dose';
import { formatDose, formatDuration, formatRate, formatVolume } from '../domain/format';
import { applyKey, parseEntry, type Key } from '../domain/keypad';
import { Keypad } from './Keypad';
import { LimitScale } from './LimitScale';
import { Sheet } from './Sheet';

/** Second, explicit step before any delivery starts (IEC 62366 use-error control UE-03). */
export function StartConfirm({ status, drug, resume, onConfirm, onClose }: {
  status: Status; drug: Drug | undefined; resume: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet title={resume ? 'Resume infusion?' : 'Start infusion?'} label="Check before starting" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--go btn--lg" onClick={onConfirm} data-testid="confirm-start" autoFocus>
            {resume ? 'Resume' : 'Start'} {formatRate(status.rate)} mL/h
          </button>
        </>
      }>
      <dl className="summary summary--large">
        <div><dt>Drug</dt><dd>{drug?.name ?? status.drug}</dd></div>
        <div><dt>Concentration</dt><dd>{drug ? drugConcentrationLabel(drug) : '–'}</dd></div>
        <div><dt>Rate</dt><dd className="num">{formatRate(status.rate)} mL/h</dd></div>
        <div><dt>Dose</dt><dd className="num">{formatDose(status.dose)} {status.dose_unit}</dd></div>
        <div><dt>{resume ? 'Remaining' : 'VTBI'}</dt><dd className="num">{formatVolume(resume ? status.remaining : status.vtbi)} mL</dd></div>
        <div><dt>Duration</dt><dd className="num">{formatDuration(status.time_remaining_s)}</dd></div>
      </dl>
      <p className="hint">Check the line is connected to the patient and the clamps are open.</p>
    </Sheet>
  );
}

export function StopConfirm({ status, onConfirm, onClose }: { status: Status; onConfirm: () => void; onClose: () => void }) {
  const ending = status.state !== 'READY';
  return (
    <Sheet title={ending ? 'End this infusion?' : 'Clear program?'} onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>Keep</button>
          <button type="button" className="btn btn--danger btn--lg" onClick={onConfirm} data-testid="confirm-stop">
            {ending ? 'End infusion' : 'Clear program'}
          </button>
        </>
      }>
      <dl className="summary summary--large">
        <div><dt>Infused</dt><dd className="num">{formatVolume(status.infused)} mL</dd></div>
        <div><dt>Not infused</dt><dd className="num">{formatVolume(status.remaining)} mL</dd></div>
      </dl>
      <p className="hint">The program is cleared. The infused volume is recorded in the event log.</p>
    </Sheet>
  );
}

export function TitrateSheet({ status, drug, onSubmit, onClose }: {
  status: Status; drug: Drug;
  onSubmit: (rate: number, confirm: boolean) => Promise<CommandResponse>; onClose: () => void;
}) {
  const [entry, setEntry] = useState('');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = parseEntry(entry);
  const result = classify(drug, { rate, vtbi: status.vtbi, weight: status.weight || null });
  const soft = isSoft(result.check);
  const blocked = rate == null || result.check === 'INVALID' || isHard(result.check) || (soft && !override);

  const onKey = (k: Key) => {
    setEntry((e) => applyKey(e, k, { maxDecimals: 1, maxIntegerDigits: 3 }));
    setOverride(false);
    setError(null);
  };
  const submit = async () => {
    if (rate == null) return;
    const r = await onSubmit(rate, soft && override);
    if (r.ok) onClose();
    else setError(r.reason);
  };

  return (
    <Sheet title="Change rate" label={drug.name} onClose={onClose}
      footer={
        <>
          <div className={`verdict verdict--${isHard(result.check) ? 'hard' : soft ? 'soft' : rate == null ? 'none' : 'ok'}`}>
            {error ?? (rate == null ? 'Enter the new rate' : result.message)}
          </div>
          <button type="button" className="btn btn--primary btn--lg" disabled={blocked} onClick={submit} data-testid="confirm-titrate">
            Apply {rate != null ? `${formatRate(rate)} mL/h` : ''}
          </button>
        </>
      }>
      <div className="entry">
        <div className="entry__fields">
          <div className="field field--static">
            <span className="field__label">Current rate</span>
            <span className="field__value"><span className="num">{formatRate(status.rate)}</span><span className="field__unit">mL/h</span></span>
          </div>
          <div className="field is-active">
            <span className="field__label">New rate</span>
            <span className="field__value"><span className="num">{entry || '–'}</span><span className="field__unit">mL/h</span></span>
          </div>
          <div className="dose-readout">
            <span className="field__label">New dose</span>
            <span className="dose-readout__value">
              <span className="num">{result.dose != null ? formatDose(result.dose) : '–'}</span>
              <span className="field__unit">{drug.dose_unit}</span>
            </span>
            <LimitScale drug={drug} dose={result.dose} check={result.check} />
          </div>
          {soft && (
            <label className="override override--compact">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              <span className="override__box" aria-hidden />
              <span>Confirm dose outside the usual range</span>
            </label>
          )}
        </div>
        <Keypad onKey={onKey} />
      </div>
    </Sheet>
  );
}

const SENS: { id: Sensitivity; label: string; mmhg: number; note: string }[] = [
  { id: 'HIGH', label: 'High', mmhg: 300, note: 'Fastest alarm. Use for low rates and small patients.' },
  { id: 'MEDIUM', label: 'Medium', mmhg: 500, note: 'Default.' },
  { id: 'LOW', label: 'Low', mmhg: 800, note: 'Fewer nuisance alarms with viscous fluids.' },
];

export function SettingsSheet({ status, libraryVersion, onSensitivity, onClose }: {
  status: Status; libraryVersion: string; onSensitivity: (s: Sensitivity) => void; onClose: () => void;
}) {
  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="settings">
        <h3 className="settings__h">Occlusion alarm pressure</h3>
        <div className="segmented segmented--tall" role="radiogroup" aria-label="Occlusion sensitivity">
          {SENS.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={status.sensitivity === s.id}
                    className={status.sensitivity === s.id ? 'is-on' : ''} onClick={() => onSensitivity(s.id)}>
              <span className="segmented__main">{s.label}</span>
              <span className="segmented__sub num">{s.mmhg} mmHg</span>
            </button>
          ))}
        </div>
        <p className="hint">{SENS.find((s) => s.id === status.sensitivity)?.note}</p>
        <dl className="summary summary--compact">
          <div><dt>Drug library</dt><dd className="num">{libraryVersion}</dd></div>
          <div><dt>Line primed</dt><dd>{status.primed ? 'Yes' : 'No'}</dd></div>
        </dl>
      </div>
    </Sheet>
  );
}
