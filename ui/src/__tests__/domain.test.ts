import { actionsFor } from '../domain/actions';
import { alarmCopy, sortAlarms, stateTone } from '../domain/alarms';
import { classify, computeDose, scalePosition } from '../domain/dose';
import { formatClock, formatCountdown, formatDose, formatDuration, formatRate, formatVolume } from '../domain/format';
import { applyKey, parseEntry } from '../domain/keypad';
import { DRUGS, infusing, status } from '../test/fixtures';

const [saline, heparin, insulin, propofol] = DRUGS;
const rules = { maxDecimals: 1, maxIntegerDigits: 3 };

describe('format', () => {
  it('formats rates to 0.1 mL/h', () => {
    expect(formatRate(25)).toBe('25.0');
    expect(formatRate(999)).toBe('999.0');
    expect(formatRate(NaN)).toBe('0.0');
  });
  it('formats doses with sensible precision', () => {
    expect(formatDose(2500)).toBe('2,500');
    expect(formatDose(12.34)).toBe('12.3');
    expect(formatDose(2)).toBe('2.00');
    expect(formatDose(0.0456)).toBe('0.046');
    expect(formatDose(0.0006)).toBe('0.0006');
    expect(formatDose(0)).toBe('0');
  });
  it('formats volumes, durations and clocks', () => {
    expect(formatVolume(12.345)).toBe('12.3');
    expect(formatVolume(1500)).toBe('1,500');
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(30)).toBe('< 1 min');
    expect(formatDuration(14 * 60)).toBe('14 min');
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2 h 05 min');
    expect(formatDuration(500 * 3600)).toBe('500 h');
    expect(formatClock(3_725_000)).toBe('01:02:05');
    expect(formatCountdown(119_200)).toBe('2:00');
    expect(formatCountdown(59_000)).toBe('0:59');
  });
});

describe('dose limits (mirror of firmware DrugLibrary::validate, SRS-001..SRS-007)', () => {
  it('computes dose', () => {
    expect(computeDose(heparin, 10, null)).toBe(1000);
    expect(computeDose(propofol, 14, 70)).toBeCloseTo(2);
    expect(computeDose(propofol, 14, null)).toBe(0);
  });
  it.each([
    [heparin, 10, 'OK'],
    [heparin, 25, 'SOFT_HIGH'],
    [heparin, 1, 'SOFT_LOW'],
    [heparin, 31, 'HARD_HIGH'],
    [insulin, 40, 'HARD_HIGH'],
    [saline, 1000, 'INVALID'],
    [saline, 0.05, 'INVALID'],
  ])('%s at %d mL/h is %s', (drug, rate, expected) => {
    expect(classify(drug, { rate, vtbi: 100, weight: null }).check).toBe(expected);
  });
  it('requires a weight for weight-based drugs', () => {
    expect(classify(propofol, { rate: 14, vtbi: 100, weight: null }).check).toBe('INVALID');
    expect(classify(propofol, { rate: 14, vtbi: 100, weight: 70 }).check).toBe('OK');
  });
  it('rejects VTBI outside range', () => {
    expect(classify(saline, { rate: 10, vtbi: 0, weight: null }).check).toBe('INVALID');
  });
  it('hard low limit', () => {
    expect(classify({ ...heparin, hard_min: 150 }, { rate: 1, vtbi: 10, weight: null }).check).toBe('HARD_LOW');
  });
  it('places doses on the scale and clamps out-of-range values', () => {
    expect(scalePosition(heparin, 0)).toBe(0);
    expect(scalePosition(heparin, 99999)).toBe(1);
    expect(scalePosition(heparin, 3000)).toBeCloseTo(1 / 1.15);
  });
});

describe('keypad', () => {
  it('builds numbers and blocks invalid input', () => {
    let v = '';
    for (const k of ['0', '1', '2', '.', '5', '5'] as const) v = applyKey(v, k, rules);
    expect(v).toBe('12.5');
    expect(applyKey('', '.', rules)).toBe('0.');
    expect(applyKey('1.5', '.', rules)).toBe('1.5');
    expect(applyKey('999', '1', rules)).toBe('999');
    expect(applyKey('12', 'back', rules)).toBe('1');
    expect(applyKey('12', 'clear', rules)).toBe('');
    expect(applyKey('5', '.', { maxDecimals: 0, maxIntegerDigits: 3 })).toBe('5');
  });
  it('parses entries', () => {
    expect(parseEntry('')).toBeNull();
    expect(parseEntry('.')).toBeNull();
    expect(parseEntry('0.')).toBe(0);
    expect(parseEntry('12.5')).toBe(12.5);
  });
});

describe('alarms', () => {
  it('sorts by priority, then newest first (SRS-040)', () => {
    const sorted = sortAlarms([
      { id: 'RESERVOIR_LOW', priority: 'LOW', condition: true, raised_at: 9 },
      { id: 'AIR_IN_LINE', priority: 'HIGH', condition: true, raised_at: 1 },
      { id: 'DOWNSTREAM_OCCLUSION', priority: 'HIGH', condition: true, raised_at: 5 },
      { id: 'INFUSION_COMPLETE', priority: 'MEDIUM', condition: false, raised_at: 7 },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(['DOWNSTREAM_OCCLUSION', 'AIR_IN_LINE', 'INFUSION_COMPLETE', 'RESERVOIR_LOW']);
  });
  it('has operator text for every firmware alarm', () => {
    for (const id of ['DOWNSTREAM_OCCLUSION', 'UPSTREAM_OCCLUSION', 'AIR_IN_LINE', 'RESERVOIR_EMPTY', 'MOTOR_STALL',
      'OVER_DELIVERY', 'SENSOR_FAULT', 'COMMUNICATION_LOSS', 'INFUSION_COMPLETE', 'RESERVOIR_LOW', 'PAUSED_TOO_LONG']) {
      expect(alarmCopy(id).action).not.toBe('');
    }
    expect(alarmCopy('NEW_THING').title).toBe('new thing');
  });
  it('maps states to tones', () => {
    expect(stateTone('INFUSING')).toBe('run');
    expect(stateTone('PAUSED')).toBe('hold');
    expect(stateTone('FAULT')).toBe('alarm');
    expect(stateTone('IDLE')).toBe('neutral');
  });
});

describe('actions per state', () => {
  const ids = (s = status()) => actionsFor(s).map((a) => a.id);
  it('only offers actions the firmware accepts', () => {
    expect(ids(status())).toEqual(['prime', 'program']);
    expect(ids(infusing())).toEqual(['titrate', 'pause']);
    expect(ids(infusing({ state: 'PRIMING' }))).toEqual(['pause']);
    expect(ids(infusing({ state: 'KVO' }))).toEqual(['stop', 'pause']);
    expect(ids(infusing({ state: 'PAUSED' }))).toEqual(['stop', 'titrate', 'resume']);
    expect(ids(infusing({ state: 'FAULT' }))).toEqual(['restart']);
  });
  it('disables Start until the line is primed (SRS-010)', () => {
    const start = actionsFor(status({ state: 'READY', primed: false })).find((a) => a.id === 'start')!;
    expect(start.enabled).toBe(false);
    expect(start.hint).toMatch(/Prime/);
    expect(actionsFor(status({ state: 'READY', primed: true })).find((a) => a.id === 'start')!.enabled).toBe(true);
  });
  it('never offers resume while stopped by an alarm (SRS-013)', () => {
    const resume = actionsFor(infusing({ state: 'ALARM' })).find((a) => a.id === 'resume')!;
    expect(resume.enabled).toBe(false);
    const high = { id: 'AIR_IN_LINE', priority: 'HIGH' as const, condition: false, raised_at: 1 };
    expect(actionsFor(infusing({ state: 'PAUSED', alarms: [high] })).find((a) => a.id === 'resume')!.enabled).toBe(false);
  });
});
