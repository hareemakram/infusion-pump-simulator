import type { Drug } from '../api/types';
import { formatDose } from './format';

/** Pump-wide programming ranges. The firmware enforces the same values (SRS-001, SRS-007). */
export const LIMITS = {
  rate: { min: 0.1, max: 999 },
  vtbi: { min: 0.1, max: 9999 },
  weight: { min: 0.5, max: 350 },
} as const;

export type LimitCheck = 'OK' | 'SOFT_LOW' | 'SOFT_HIGH' | 'HARD_LOW' | 'HARD_HIGH' | 'INVALID';

export interface DraftProgram {
  drugId: string;
  rate: number | null;
  vtbi: number | null;
  weight: number | null;
}

export interface Classification {
  check: LimitCheck;
  dose: number | null;
  message: string;
}

export function computeDose(drug: Drug, rate: number, weight: number | null): number {
  const perHour = rate * drug.concentration;
  if (drug.weight_based) return weight && weight > 0 ? perHour / weight : 0;
  return perHour;
}

const inRange = (v: number | null, r: { min: number; max: number }): v is number =>
  v != null && Number.isFinite(v) && v >= r.min && v <= r.max;

/**
 * Mirrors the firmware's DrugLibrary::validate so the operator gets feedback while typing.
 * The firmware remains the authority: its verdict is what counts when the program is sent.
 */
export function classify(drug: Drug, draft: Omit<DraftProgram, 'drugId'>): Classification {
  const { rate, vtbi, weight } = draft;
  if (!inRange(rate, LIMITS.rate)) {
    return { check: 'INVALID', dose: null, message: `Rate must be ${LIMITS.rate.min} to ${LIMITS.rate.max} mL/h` };
  }
  if (!inRange(vtbi, LIMITS.vtbi)) {
    return { check: 'INVALID', dose: null, message: `VTBI must be ${LIMITS.vtbi.min} to ${LIMITS.vtbi.max} mL` };
  }
  if (drug.weight_based && !inRange(weight, LIMITS.weight)) {
    return { check: 'INVALID', dose: null, message: `Weight must be ${LIMITS.weight.min} to ${LIMITS.weight.max} kg` };
  }
  const dose = computeDose(drug, rate, weight);
  const d = `${formatDose(dose)} ${drug.dose_unit}`;
  if (rate > drug.max_rate) {
    return { check: 'HARD_HIGH', dose, message: `Rate above ${drug.name} maximum of ${drug.max_rate} mL/h` };
  }
  if (dose > drug.hard_max) return { check: 'HARD_HIGH', dose, message: `${d} is above the hard limit of ${formatDose(drug.hard_max)}` };
  if (dose < drug.hard_min) return { check: 'HARD_LOW', dose, message: `${d} is below the hard limit of ${formatDose(drug.hard_min)}` };
  if (dose > drug.soft_max) return { check: 'SOFT_HIGH', dose, message: `${d} is above the usual maximum of ${formatDose(drug.soft_max)}` };
  if (dose < drug.soft_min) return { check: 'SOFT_LOW', dose, message: `${d} is below the usual minimum of ${formatDose(drug.soft_min)}` };
  return { check: 'OK', dose, message: `${d} is within limits` };
}

export const isHard = (c: LimitCheck) => c === 'HARD_HIGH' || c === 'HARD_LOW';
export const isSoft = (c: LimitCheck) => c === 'SOFT_HIGH' || c === 'SOFT_LOW';

/**
 * Position of a dose on the limit scale as a fraction 0..1. The scale spans
 * hard_min..hard_max with 15 % headroom, so out-of-range doses stay visible at the edges.
 */
export function scalePosition(drug: Drug, dose: number): number {
  const span = drug.hard_max - drug.hard_min;
  const lo = drug.hard_min;
  const hi = drug.hard_max + span * 0.15;
  return Math.min(1, Math.max(0, (dose - lo) / (hi - lo)));
}

export function drugConcentrationLabel(drug: Drug): string {
  if (drug.amount_unit === 'mL') return 'Undiluted';
  return `${formatDose(drug.concentration)} ${drug.amount_unit}/mL`;
}
