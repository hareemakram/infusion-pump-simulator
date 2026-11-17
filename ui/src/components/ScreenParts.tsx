import type { Drug, Status } from '../api/types';
import type { Action, ActionId } from '../domain/actions';
import { alarmCopy, sortAlarms, STATE_LABEL, stateTone } from '../domain/alarms';
import { drugConcentrationLabel } from '../domain/dose';
import { formatClock, formatDose, formatDuration, formatPressure, formatRate, formatVolume } from '../domain/format';
import type { LinkState } from '../hooks/usePump';
import { IconDrop, IconGear, IconPause, IconPlay, IconRate, IconRestart, IconStop } from './Icons';

export function StatusBar({ status, drug, link, onSettings }: {
  status: Status; drug: Drug | undefined; link: LinkState; onSettings: () => void;
}) {
  const tone = stateTone(status.state);
  return (
    <header className="statusbar">
      <div className="statusbar__drug">
        {drug ? (
          <>
            <span className="statusbar__name">{drug.name}</span>
            <span className="statusbar__conc">{drugConcentrationLabel(drug)}</span>
          </>
        ) : <span className="statusbar__conc">No infusion</span>}
      </div>
      <div className={`chip chip--${tone}`} data-testid="state-chip" data-state={status.state}>
        {tone === 'run' && <span className="chip__pulse" aria-hidden />}
        {STATE_LABEL[status.state]}
      </div>
      <div className="statusbar__right">
        <span className={`link link--${link}`} title={link === 'live' ? 'Sensor data live' : 'No data from pump'}>
          <span className="link__dot" aria-hidden />{link === 'live' ? 'Live' : link === 'stale' ? 'No data' : 'Connecting'}
        </span>
        <span className="statusbar__clock num" aria-label="Pump time">{formatClock(status.t)}</span>
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings"><IconGear /></button>
      </div>
    </header>
  );
}

function Meter({ label, value, unit, fraction, marker, tone }: {
  label: string; value: string; unit: string; fraction: number; marker?: number; tone?: 'warn' | 'alarm';
}) {
  return (
    <div className={`meter ${tone ? `meter--${tone}` : ''}`}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value num">{value}<span className="meter__unit">{unit}</span></span>
      </div>
      <div className="meter__track">
        <div className="meter__fill" style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} />
        {marker != null && <div className="meter__marker" style={{ left: `${marker * 100}%` }} />}
      </div>
    </div>
  );
}

export function InfusionView({ status, drug }: { status: Status; drug: Drug | undefined }) {
  const delivering = status.motor_enabled && (status.state === 'INFUSING' || status.state === 'KVO');
  const progress = status.vtbi > 0 ? Math.min(1, status.infused / status.vtbi) : 0;
  const scaleMax = Math.max(status.threshold * 1.25, 100);
  const kvo = status.state === 'KVO';
  return (
    <div className="infusion">
      <div className="infusion__main">
        <div className={`rate ${delivering ? 'is-delivering' : 'is-held'}`} data-testid="rate-display">
          <div className="rate__label">
            <IconRate />
            {kvo ? 'KVO rate' : 'Rate'}
            <span className={`rate__flag ${delivering ? 'rate__flag--on' : ''}`}>
              {delivering ? 'Delivering' : 'Not delivering'}
            </span>
          </div>
          <div className="rate__value num">
            {formatRate(kvo ? status.active_rate : status.rate)}<span className="rate__unit">mL/h</span>
          </div>
          {drug && drug.dose_unit !== 'mL/h' && (
            <div className="rate__dose num">{formatDose(status.dose)} <span>{status.dose_unit}</span></div>
          )}
        </div>
        <div className="progress" aria-label="Volume infused">
          <div className="progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={status.vtbi}
               aria-valuenow={Number(status.infused.toFixed(1))}>
            <div className="progress__fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="progress__legend">
            <div><span className="k">Infused</span><span className="v num" data-testid="infused">{formatVolume(status.infused)} mL</span></div>
            <div><span className="k">VTBI</span><span className="v num">{formatVolume(status.vtbi)} mL</span></div>
            <div><span className="k">Time left</span><span className="v num">{kvo ? 'Complete' : formatDuration(status.time_remaining_s)}</span></div>
          </div>
        </div>
      </div>
      <aside className="infusion__side" aria-label="Line status">
        <Meter label="Downstream" value={formatPressure(status.downstream)} unit="mmHg"
               fraction={status.downstream / scaleMax} marker={status.threshold / scaleMax}
               tone={status.downstream > status.threshold ? 'alarm' : status.downstream > status.threshold * 0.6 ? 'warn' : undefined} />
        <Meter label="Upstream" value={formatPressure(status.upstream)} unit="mmHg"
               fraction={(status.upstream + 300) / 400} marker={150 / 400}
               tone={status.upstream < -150 ? 'alarm' : undefined} />
        <Meter label="Container" value={formatVolume(status.reservoir)} unit="mL"
               fraction={status.reservoir / 250} tone={status.reservoir < 10 ? 'warn' : undefined} />
        <div className="side-note">
          Occlusion alarm at <span className="num">{formatPressure(status.threshold)}</span> mmHg
        </div>
      </aside>
    </div>
  );
}

export function IdleView({ status }: { status: Status }) {
  return (
    <div className="empty">
      <IconDrop width={40} height={40} />
      <h2 className="empty__title">No infusion programmed</h2>
      <p className="empty__body">
        {status.primed ? 'The line is primed.' : 'Prime the line before connecting it to the patient.'} Choose
        <strong> New infusion</strong> to select a drug from the library.
      </p>
    </div>
  );
}

export function PrimingView({ status }: { status: Status }) {
  const frac = Math.min(1, status.prime / 2);
  return (
    <div className="empty">
      <h2 className="empty__title">Priming the line</h2>
      <p className="empty__body">The line must not be connected to the patient.</p>
      <div className="progress progress--narrow">
        <div className="progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={2} aria-valuenow={status.prime}>
          <div className="progress__fill" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="progress__caption num">{formatVolume(status.prime)} of 2.0 mL</div>
      </div>
    </div>
  );
}

export function FaultView({ status }: { status: Status }) {
  const top = sortAlarms(status.alarms)[0];
  const copy = top ? alarmCopy(top.id) : { title: 'System fault', action: 'Restart the pump.' };
  return (
    <div className="empty empty--fault">
      <h2 className="empty__title">Pump stopped: {copy.title.toLowerCase()}</h2>
      <p className="empty__body">{copy.action} Delivery cannot resume until the pump has restarted and the line is primed again.</p>
      <p className="empty__meta num">Infused before the fault: {formatVolume(status.infused)} mL</p>
    </div>
  );
}

const ACTION_ICON: Partial<Record<ActionId, JSX.Element>> = {
  start: <IconPlay />, resume: <IconPlay />, pause: <IconPause />, stop: <IconStop />, prime: <IconDrop />,
  titrate: <IconRate />, restart: <IconRestart />,
};

export function ActionBar({ actions, onAction }: { actions: Action[]; onAction: (id: ActionId) => void }) {
  return (
    <nav className="actionbar" aria-label="Pump controls">
      {actions.map((a) => (
        <button key={a.id} type="button" className={`btn btn--xl btn--${a.emphasis ?? 'default'}`}
                disabled={!a.enabled} onClick={() => onAction(a.id)} data-action={a.id}
                aria-describedby={a.hint ? `hint-${a.id}` : undefined}>
          {ACTION_ICON[a.id]}
          <span className="btn__text">
            {a.label}
            {a.hint && !a.enabled && <span id={`hint-${a.id}`} className="btn__hint">{a.hint}</span>}
          </span>
        </button>
      ))}
    </nav>
  );
}
