import type { Key } from '../domain/keypad';
import { IconBackspace } from './Icons';

const KEYS: Key[] = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back'];

export function Keypad({ onKey, allowDecimal = true }: { onKey: (k: Key) => void; allowDecimal?: boolean }) {
  return (
    <div className="keypad" role="group" aria-label="Number pad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`key ${k === 'back' ? 'key--fn' : ''}`}
          onClick={() => onKey(k)}
          disabled={k === '.' && !allowDecimal}
          aria-label={k === 'back' ? 'Delete' : k === '.' ? 'Decimal point' : k}
        >
          {k === 'back' ? <IconBackspace /> : k}
        </button>
      ))}
    </div>
  );
}
