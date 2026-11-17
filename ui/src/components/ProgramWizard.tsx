import { useMemo, useState } from 'react';
import type { CommandResponse, Drug } from '../api/types';
import { classify, drugConcentrationLabel, isHard, isSoft, LIMITS } from '../domain/dose';
import { formatDose, formatDuration, formatRate, formatVolume } from '../domain/format';
import { applyKey, parseEntry, type Key } from '../domain/keypad';
import { Keypad } from './Keypad';
import { LimitScale } from './LimitScale';
import { Sheet } from './Sheet';

type Field = 'rate' | 'vtbi' | 'weight';

interface Props {
  drugs: Drug[];
  initial?: { drugId: string; rate: number; vtbi: number; weight: number };
  onSubmit: (args: { drug: string; rate: number; vtbi: number; weight?: number; confirm: boolean }) => Promise<CommandResponse>;
  onClose: () => void;
}

const FIELD_META: Record<Field, { label: string; unit: string; decimals: number; int: number }> = {
  rate: { label: 'Rate', unit: 'mL/h', decimals: 1, int: 3 },
  vtbi: { label: 'Volume to be infused', unit: 'mL', decimals: 1, int: 4 },
  weight: { label: 'Patient weight', unit: 'kg', decimals: 1, int: 3 },
};

const str = (n: number | undefined) => (n ? String(n) : '');

export function ProgramWizard({ drugs, initial, onSubmit, onClose }: Props) {
  const [step, setStep] = useState(initial ? 1 : 0);
  const [drugId, setDrugId] = useState(initial?.drugId ?? '');
  const [entry, setEntry] = useState<Record<Field, string>>({
    rate: str(initial?.rate), vtbi: str(initial?.vtbi), weight: str(initial?.weight),
  });
  const [field, setField] = useState<Field>('rate');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const drug = drugs.find((d) => d.id === drugId);
  const fields: Field[] = drug?.weight_based ? ['weight', 'rate', 'vtbi'] : ['rate', 'vtbi'];
  const values = { rate: parseEntry(entry.rate), vtbi: parseEntry(entry.vtbi), weight: parseEntry(entry.weight) };
  const result = useMemo(() => (drug ? classify(drug, values) : null),
    [drug, entry.rate, entry.vtbi, entry.weight]);

  const pick = (d: Drug) => {
    setDrugId(d.id);
    setField(d.weight_based ? 'weight' : 'rate');
    setOverride(false);
    setStep(1);
  };

  const onKey = (k: Key) => {
    const meta = FIELD_META[field];
    setEntry((e) => ({ ...e, [field]: applyKey(e[field], k, { maxDecimals: meta.decimals, maxIntegerDigits: meta.int }) }));
    setOverride(false);
    setError(null);
  };

  const submit = async () => {
    if (!drug || !result || values.rate == null || values.vtbi == null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onSubmit({
        drug: drug.id, rate: values.rate, vtbi: values.vtbi,
        weight: drug.weight_based ? values.weight ?? undefined : undefined,
        confirm: isSoft(result.check) && override,
      });
      if (r.ok) onClose();
      else setError(r.reason.replace(/^CONFIRM_REQUIRED: /, 'Confirmation required: '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = { labels: ['Drug', 'Settings', 'Review'], current: step };
  const back = step > 0 ? () => setStep(step - 1) : undefined;

  if (step === 0) {
    return (
      <Sheet title="Select drug" label="New infusion" onClose={onClose} steps={steps}>
        <ul className="drug-grid" aria-label="Drug library">
          {drugs.map((d) => (
            <li key={d.id}>
              <button type="button" className={`drug-tile ${d.id === drugId ? 'is-selected' : ''}`} onClick={() => pick(d)}>
                <span className="drug-tile__name">{d.name}</span>
                <span className="drug-tile__conc">{drugConcentrationLabel(d)}</span>
                <span className="drug-tile__unit">
                  Dosed in {d.dose_unit}
                  {d.weight_based && <span className="tag">Weight-based</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  if (!drug || !result) return null;
  const hard = isHard(result.check);
  const soft = isSoft(result.check);
  const invalid = result.check === 'INVALID';

  if (step === 1) {
    return (
      <Sheet title={drug.name} label={drugConcentrationLabel(drug)} onClose={onClose} onBack={back} steps={steps}
        footer={
          <>
            <div className={`verdict verdict--${hard ? 'hard' : soft ? 'soft' : invalid ? 'none' : 'ok'}`} data-testid="dose-verdict">
              {result.message}
            </div>
            <button type="button" className="btn btn--primary btn--lg" disabled={invalid || hard} onClick={() => setStep(2)}>
              Review
            </button>
          </>
        }>
        <div className="entry">
          <div className="entry__fields">
            {fields.map((f) => {
              const meta = FIELD_META[f];
              return (
                <button key={f} type="button" className={`field ${field === f ? 'is-active' : ''}`}
                        onClick={() => setField(f)} aria-pressed={field === f} data-testid={`field-${f}`}>
                  <span className="field__label">{meta.label}</span>
                  <span className="field__value">
                    <span className="num">{entry[f] || '–'}</span>
                    <span className="field__unit">{meta.unit}</span>
                  </span>
                  <span className="field__range">{LIMITS[f].min}–{f === 'rate' ? Math.min(LIMITS.rate.max, drug.max_rate) : LIMITS[f].max}</span>
                </button>
              );
            })}
            <div className="dose-readout">
              <span className="field__label">Dose</span>
              <span className="dose-readout__value">
                <span className="num">{result.dose != null ? formatDose(result.dose) : '–'}</span>
                <span className="field__unit">{drug.dose_unit}</span>
              </span>
              <LimitScale drug={drug} dose={result.dose} check={result.check} />
            </div>
          </div>
          <Keypad onKey={onKey} />
        </div>
      </Sheet>
    );
  }

  const duration = values.rate && values.vtbi ? (values.vtbi / values.rate) * 3600 : null;
  return (
    <Sheet title="Review program" label={drug.name} onClose={onClose} onBack={back} steps={steps}
      footer={
        <>
          {error ? <div className="verdict verdict--hard" role="alert">{error}</div> : <span />}
          <button type="button" className="btn btn--primary btn--lg" onClick={submit}
                  disabled={busy || hard || invalid || (soft && !override)} data-testid="confirm-program">
            Confirm program
          </button>
        </>
      }>
      <div className="review">
        <dl className="summary">
          <div><dt>Drug</dt><dd>{drug.name}</dd></div>
          <div><dt>Concentration</dt><dd>{drugConcentrationLabel(drug)}</dd></div>
          {drug.weight_based && <div><dt>Weight</dt><dd className="num">{formatVolume(values.weight ?? 0)} kg</dd></div>}
          <div><dt>Rate</dt><dd className="num">{formatRate(values.rate ?? 0)} mL/h</dd></div>
          <div className={soft ? 'is-flagged' : ''}><dt>Dose</dt><dd className="num">{formatDose(result.dose ?? 0)} {drug.dose_unit}</dd></div>
          <div><dt>VTBI</dt><dd className="num">{formatVolume(values.vtbi ?? 0)} mL</dd></div>
          <div><dt>Duration</dt><dd className="num">{formatDuration(duration)}</dd></div>
        </dl>
        {soft ? (
          <label className="override">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} data-testid="override" />
            <span className="override__box" aria-hidden />
            <span>
              <strong>Dose outside the usual range.</strong> {result.message}. I have checked the order and want to continue.
            </span>
          </label>
        ) : (
          <div className="review__ok">Dose within drug library limits ({drugConcentrationLabel(drug)}).</div>
        )}
      </div>
    </Sheet>
  );
}
