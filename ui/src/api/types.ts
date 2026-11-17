export type PumpState = 'IDLE' | 'READY' | 'PRIMING' | 'INFUSING' | 'PAUSED' | 'KVO' | 'ALARM' | 'FAULT';
export type Priority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type Sensitivity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Alarm {
  id: string;
  priority: Exclude<Priority, 'NONE'>;
  condition: boolean;
  raised_at: number;
}

export interface Status {
  t: number;
  state: PumpState;
  primed: boolean;
  motor_enabled: boolean;
  steps_per_s: number;
  active_rate: number;
  rate: number;
  vtbi: number;
  weight: number;
  infused: number;
  prime: number;
  remaining: number;
  time_remaining_s: number | null;
  drug: string | null;
  dose: number;
  dose_unit: string | null;
  downstream: number;
  upstream: number;
  reservoir: number;
  air_cumulative: number;
  threshold: number;
  sensitivity: Sensitivity;
  highest: Priority;
  audible: boolean;
  silence_ms: number;
  alarms: Alarm[];
}

export interface Drug {
  id: string;
  name: string;
  concentration: number;
  amount_unit: string;
  dose_unit: string;
  weight_based: boolean;
  soft_min: number;
  soft_max: number;
  hard_min: number;
  hard_max: number;
  max_rate: number;
}

export interface PumpEvent {
  id: number;
  seq: number;
  t: number;
  kind: string;
  message: string;
}

export interface PlantTruth {
  line_outflow_ml: number;
  air_to_patient_ul: number;
  downstream_true: number;
  upstream_true: number;
  reservoir_ml: number;
  flow_ml_h: number;
}

/** [t_ms, downstream, upstream, flow_ml_h] */
export type Sample = [number, number, number, number];

export interface Snapshot {
  t: number;
  status: Status;
  plant: PlantTruth;
  faults: string[];
  sample: Sample | null;
  events: PumpEvent[];
  last_event_id: number;
  speed: number;
  history?: Sample[];
  error?: string;
}

export interface FaultSpec {
  id: string;
  label: string;
  group: string;
  description: string;
  expected_alarm: string;
  pulse: boolean;
  params: Record<string, unknown>;
}

export interface CommandResponse {
  command: string;
  ok: boolean;
  reason: string;
  needs_confirmation: boolean;
}

export type CommandName =
  | 'PROGRAM' | 'PRIME' | 'START' | 'PAUSE' | 'STOP' | 'TITRATE' | 'ACK' | 'SILENCE' | 'SENS' | 'RESET';
