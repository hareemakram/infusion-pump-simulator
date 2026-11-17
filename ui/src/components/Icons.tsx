import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const IconPlay = (p: P) => <svg {...base} {...p}><path d="M7 5.5v13l11-6.5z" /></svg>;
export const IconPause = (p: P) => <svg {...base} {...p}><path d="M8 5v14M16 5v14" /></svg>;
export const IconStop = (p: P) => <svg {...base} {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>;
export const IconDrop = (p: P) => <svg {...base} {...p}><path d="M12 3.5s-5.5 6.2-5.5 10a5.5 5.5 0 0 0 11 0c0-3.8-5.5-10-5.5-10z" /></svg>;
export const IconBellOff = (p: P) => (
  <svg {...base} {...p}><path d="M9.5 19a2.5 2.5 0 0 0 5 0M6 16h10.5M18 13.5V10a6 6 0 0 0-9.4-4.9M6.2 8.2A6 6 0 0 0 6 10v6M3 3l18 18" /></svg>
);
export const IconCheck = (p: P) => <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const IconGear = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconBack = (p: P) => <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>;
export const IconClose = (p: P) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconBackspace = (p: P) => (
  <svg {...base} {...p}><path d="M21 6H9l-6 6 6 6h12zM17 10l-4 4M13 10l4 4" /></svg>
);
export const IconRate = (p: P) => <svg {...base} {...p}><path d="M4 18a8 8 0 1 1 16 0M12 18l4-6" /></svg>;
export const IconRestart = (p: P) => <svg {...base} {...p}><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" /></svg>;
export const IconAlert = (p: P) => (
  <svg {...base} {...p}><path d="M12 4l9 16H3zM12 10v4M12 17.2v.1" /></svg>
);
export const IconLink = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="3.5" /></svg>;
