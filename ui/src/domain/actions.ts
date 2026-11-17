import type { Status } from '../api/types';

export type ActionId =
  | 'program' | 'edit' | 'prime' | 'start' | 'resume' | 'pause' | 'stop' | 'titrate' | 'ack' | 'silence' | 'restart';

export interface Action {
  id: ActionId;
  label: string;
  enabled: boolean;
  hint?: string;
  emphasis?: 'primary' | 'danger' | 'default';
}

const a = (id: ActionId, label: string, extra: Partial<Action> = {}): Action => ({
  id, label, enabled: true, emphasis: 'default', ...extra,
});

/**
 * The actions offered on the main screen for each pump state. Only actions the
 * firmware will accept in that state are shown, so the operator is never offered
 * a button that will be refused.
 */
export function actionsFor(s: Status): Action[] {
  const hasHigh = s.alarms.some((x) => x.priority === 'HIGH');
  switch (s.state) {
    case 'IDLE':
      return [a('prime', s.primed ? 'Prime again' : 'Prime line'), a('program', 'New infusion', { emphasis: 'primary' })];
    case 'READY':
      return [
        a('stop', 'Clear'),
        a('edit', 'Edit'),
        a('prime', s.primed ? 'Prime again' : 'Prime line', { emphasis: s.primed ? 'default' : 'primary' }),
        a('start', 'Start', {
          emphasis: s.primed ? 'primary' : 'default',
          enabled: s.primed && !hasHigh,
          hint: s.primed ? undefined : 'Prime the line first',
        }),
      ];
    case 'PRIMING':
      return [a('pause', 'Stop priming')];
    case 'INFUSING':
      return [a('titrate', 'Change rate'), a('pause', 'Pause', { emphasis: 'primary' })];
    case 'KVO':
      return [a('stop', 'End infusion'), a('pause', 'Pause', { emphasis: 'primary' })];
    case 'PAUSED':
      return [
        a('stop', 'End infusion'),
        a('titrate', 'Change rate'),
        a('resume', 'Resume', { emphasis: 'primary', enabled: !hasHigh }),
      ];
    case 'ALARM':
      // Silence and Acknowledge live on the alarm banner, next to the alarm they act on.
      return [a('stop', 'End infusion'), a('resume', 'Resume', { enabled: false, hint: 'Acknowledge the alarm first' })];
    case 'FAULT':
      return [a('restart', 'Restart pump', { emphasis: 'danger' })];
    default:
      return [];
  }
}
