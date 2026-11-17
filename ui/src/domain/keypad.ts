export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'clear';

export interface KeypadRules {
  maxDecimals: number;
  maxIntegerDigits: number;
}

/**
 * Pure keypad reducer. Rejects keystrokes that would create an invalid
 * number instead of accepting them and complaining later.
 */
export function applyKey(current: string, key: Key, rules: KeypadRules): string {
  if (key === 'clear') return '';
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') {
    if (rules.maxDecimals === 0 || current.includes('.')) return current;
    return current === '' ? '0.' : current + '.';
  }
  const [int, dec] = current.split('.');
  if (dec !== undefined) {
    return dec.length >= rules.maxDecimals ? current : current + key;
  }
  if (int === '0') return key; // no leading zeros
  if (int.length >= rules.maxIntegerDigits) return current;
  return current + key;
}

export function parseEntry(v: string): number | null {
  if (v === '' || v === '.' || v.endsWith('.') && v.length === 1) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
