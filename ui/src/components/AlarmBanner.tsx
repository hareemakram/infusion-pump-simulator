import type { Alarm } from '../api/types';
import { alarmCopy, PRIORITY_LABEL, sortAlarms } from '../domain/alarms';
import { formatCountdown } from '../domain/format';
import { IconBellOff, IconCheck } from './Icons';

interface Props {
  alarms: Alarm[];
  audible: boolean;
  silenceMs: number;
  onSilence: () => void;
  onAcknowledge: () => void;
}

/**
 * Shows the highest-priority alarm with its instruction (SRS-040). Colour, a
 * priority word and a symbol all carry the priority, so it never depends on
 * colour alone.
 */
export function AlarmBanner({ alarms, audible, silenceMs, onSilence, onAcknowledge }: Props) {
  if (alarms.length === 0) return null;
  const sorted = sortAlarms(alarms);
  const top = sorted[0];
  const copy = alarmCopy(top.id);
  const others = sorted.slice(1);
  const symbol = top.priority === 'HIGH' ? '!!!' : top.priority === 'MEDIUM' ? '!!' : '!';
  const canAck = sorted.some((a) => !a.condition && a.priority !== 'LOW');

  return (
    <section
      className={`alarm alarm--${top.priority.toLowerCase()}`}
      role={top.priority === 'HIGH' ? 'alert' : 'status'}
      aria-live={top.priority === 'HIGH' ? 'assertive' : 'polite'}
      data-testid="alarm-banner"
      data-priority={top.priority}
    >
      <div className="alarm__mark" aria-hidden>{symbol}</div>
      <div className="alarm__text">
        <div className="alarm__meta">
          <span className="alarm__priority">{PRIORITY_LABEL[top.priority]}</span>
          {others.length > 0 && (
            <span className="alarm__more" title={others.map((o) => alarmCopy(o.id).title).join(', ')}>
              +{others.length} more
            </span>
          )}
          {!top.condition && top.priority !== 'LOW' && <span className="alarm__resolved">Condition cleared</span>}
        </div>
        <div className="alarm__title" data-testid="alarm-title">{copy.title}</div>
        <div className="alarm__action">{copy.action}</div>
      </div>
      <div className="alarm__buttons">
        <button
          type="button"
          className="btn btn--alarm-ghost"
          onClick={onSilence}
          disabled={!audible}
          aria-label={audible ? 'Silence alarm for 2 minutes' : `Alarm silenced, ${formatCountdown(silenceMs)} remaining`}
        >
          <IconBellOff />
          <span>{audible ? 'Silence' : formatCountdown(silenceMs)}</span>
        </button>
        {top.priority !== 'LOW' && (
          <button
            type="button"
            className="btn btn--alarm"
            onClick={onAcknowledge}
            disabled={!canAck}
            title={canAck ? undefined : 'Fix the cause first'}
          >
            <IconCheck />
            <span>Acknowledge</span>
          </button>
        )}
      </div>
    </section>
  );
}
