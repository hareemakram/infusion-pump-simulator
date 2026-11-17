const nf = (min: number, max: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

const nf0 = nf(0, 0);
const nf1 = nf(1, 1);
const nf2 = nf(2, 2);

/** Rates are shown to 0.1 mL/h, the resolution the pump accepts. */
export function formatRate(v: number): string {
  return nf1.format(Number.isFinite(v) ? v : 0);
}

export function formatVolume(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  return v >= 1000 ? nf0.format(v) : nf1.format(v);
}

/** Dose shown with 3-4 significant figures, never in scientific notation. */
export function formatDose(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 100) return nf0.format(v);
  if (a >= 10) return nf1.format(v);
  if (a >= 1) return nf2.format(v);
  if (a >= 0.01) return nf(3, 3).format(v);
  return nf(4, 4).format(v);
}

/** Human duration for time remaining: "2 h 05 min", "14 min", "< 1 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return '< 1 min';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (h >= 100) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Simulation clock: "00:12:05". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Countdown for silence: "1:59". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatPressure(v: number): string {
  return nf0.format(Number.isFinite(v) ? v : 0);
}
