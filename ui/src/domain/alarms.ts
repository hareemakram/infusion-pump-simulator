import type { Alarm, Priority, PumpState } from '../api/types';

interface AlarmCopy {
  title: string;
  action: string;
}

/** Operator-facing alarm text: what happened, then what to do (IEC 62366 use-error mitigation). */
export const ALARM_COPY: Record<string, AlarmCopy> = {
  DOWNSTREAM_OCCLUSION: { title: 'Occlusion: patient side', action: 'Check the line to the patient for kinks or a closed clamp.' },
  UPSTREAM_OCCLUSION: { title: 'Occlusion: container side', action: 'Open the roller clamp and check the spike.' },
  AIR_IN_LINE: { title: 'Air in line', action: 'Remove the air from the line before resuming.' },
  RESERVOIR_EMPTY: { title: 'Container empty', action: 'Hang a new container, then acknowledge.' },
  MOTOR_STALL: { title: 'Pump mechanism blocked', action: 'Close the clamp. Remove the pump from service.' },
  OVER_DELIVERY: { title: 'Delivering too fast', action: 'Close the clamp now. Remove the pump from service.' },
  SENSOR_FAULT: { title: 'Sensor failure', action: 'Close the clamp. Restart the pump.' },
  COMMUNICATION_LOSS: { title: 'Sensors not responding', action: 'Close the clamp. Restart the pump.' },
  INFUSION_COMPLETE: { title: 'Infusion complete', action: 'Running at KVO 1 mL/h. Stop or program the next infusion.' },
  RESERVOIR_LOW: { title: 'Container nearly empty', action: 'Prepare a new container.' },
  PAUSED_TOO_LONG: { title: 'Pump paused', action: 'Resume or stop the infusion.' },
};

export function alarmCopy(id: string): AlarmCopy {
  return ALARM_COPY[id] ?? { title: id.replace(/_/g, ' ').toLowerCase(), action: '' };
}

const RANK: Record<Priority, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export function priorityRank(p: Priority): number {
  return RANK[p];
}

/** Highest priority first, newest first within a priority (SRS-040). */
export function sortAlarms(alarms: Alarm[]): Alarm[] {
  return [...alarms].sort((a, b) => RANK[b.priority] - RANK[a.priority] || b.raised_at - a.raised_at);
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  NONE: '',
  LOW: 'Low priority',
  MEDIUM: 'Medium priority',
  HIGH: 'High priority',
};

export const STATE_LABEL: Record<PumpState, string> = {
  IDLE: 'No program',
  READY: 'Ready',
  PRIMING: 'Priming',
  INFUSING: 'Infusing',
  PAUSED: 'Paused',
  KVO: 'KVO',
  ALARM: 'Stopped',
  FAULT: 'Fault',
};

export type Tone = 'neutral' | 'run' | 'hold' | 'alarm';

export function stateTone(state: PumpState): Tone {
  switch (state) {
    case 'INFUSING':
    case 'KVO':
    case 'PRIMING':
      return 'run';
    case 'PAUSED':
    case 'READY':
      return 'hold';
    case 'ALARM':
    case 'FAULT':
      return 'alarm';
    default:
      return 'neutral';
  }
}
