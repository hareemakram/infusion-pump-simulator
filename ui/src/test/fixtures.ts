import type { Drug, Status } from '../api/types';

export const DRUGS: Drug[] = [
  { id: 'saline', name: 'Sodium chloride 0.9%', concentration: 1, amount_unit: 'mL', dose_unit: 'mL/h', weight_based: false, soft_min: 1, soft_max: 500, hard_min: 0.1, hard_max: 999, max_rate: 999 },
  { id: 'heparin', name: 'Heparin', concentration: 100, amount_unit: 'units', dose_unit: 'units/h', weight_based: false, soft_min: 200, soft_max: 2000, hard_min: 0, hard_max: 3000, max_rate: 50 },
  { id: 'insulin', name: 'Insulin (regular)', concentration: 1, amount_unit: 'units', dose_unit: 'units/h', weight_based: false, soft_min: 0.5, soft_max: 15, hard_min: 0, hard_max: 25, max_rate: 30 },
  { id: 'propofol', name: 'Propofol', concentration: 10, amount_unit: 'mg', dose_unit: 'mg/kg/h', weight_based: true, soft_min: 0.3, soft_max: 4, hard_min: 0, hard_max: 6, max_rate: 100 },
];

export function status(over: Partial<Status> = {}): Status {
  return {
    t: 60_000, state: 'IDLE', primed: false, motor_enabled: false, steps_per_s: 0, active_rate: 0, rate: 0, vtbi: 0,
    weight: 0, infused: 0, prime: 0, remaining: 0, time_remaining_s: null, drug: null, dose: 0, dose_unit: null,
    downstream: 20, upstream: 30, reservoir: 250, air_cumulative: 0, threshold: 500, sensitivity: 'MEDIUM',
    highest: 'NONE', audible: false, silence_ms: 0, alarms: [], ...over,
  };
}

export const infusing = (over: Partial<Status> = {}) => status({
  state: 'INFUSING', primed: true, motor_enabled: true, active_rate: 10, rate: 10, vtbi: 250, infused: 12.5,
  remaining: 237.5, time_remaining_s: 85500, drug: 'heparin', dose: 1000, dose_unit: 'units/h', ...over,
});
