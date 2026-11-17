import { useEffect, useRef, type ReactNode } from 'react';
import { IconBack, IconClose } from './Icons';

interface Props {
  title: string;
  label?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  steps?: { labels: string[]; current: number };
}

/** Full-screen panel inside the device display, used for every multi-step task. */
export function Sheet({ title, label, onClose, onBack, children, footer, steps }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
      <header className="sheet__head">
        {onBack ? (
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back"><IconBack /></button>
        ) : <span className="icon-btn icon-btn--spacer" />}
        <div className="sheet__titles">
          {label && <div className="sheet__label">{label}</div>}
          <h2 className="sheet__title">{title}</h2>
        </div>
        {steps ? (
          <ol className="steps" aria-label="Progress">
            {steps.labels.map((s, i) => (
              <li key={s} className={i === steps.current ? 'is-current' : i < steps.current ? 'is-done' : ''}
                  aria-current={i === steps.current ? 'step' : undefined}>
                <span className="steps__n">{i + 1}</span>{s}
              </li>
            ))}
          </ol>
        ) : <span />}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>
      <div className="sheet__body">{children}</div>
      {footer && <footer className="sheet__foot">{footer}</footer>}
    </div>
  );
}
