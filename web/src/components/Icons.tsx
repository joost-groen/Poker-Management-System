import type { SVGProps } from 'react';

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export const Plus = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>
);
export const Minus = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="M5 12h14" /></svg>
);
export const Back = ({ size = 22 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M15 5l-7 7 7 7" /></svg>
);
export const Undo = ({ size = 20 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
);
export const Check = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2.4}><path d="M5 12l5 5L19 7" /></svg>
);
export const Alert = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></svg>
);
export const Arrow = ({ size = 16 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const Pencil = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
);
export const Cards = ({ size = 22 }) => (
  <svg {...base(size)} strokeWidth={1.8}><rect x="4" y="3" width="11" height="15" rx="2" /><path d="M9 21h9a2 2 0 0 0 2-2V8" /></svg>
);
export const Bars = ({ size = 22 }) => (
  <svg {...base(size)} strokeWidth={1.8}><path d="M6 20V11M12 20V5M18 20v-6" /></svg>
);
export const Trash = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
);
export const Restore = ({ size = 18 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6" /></svg>
);
export const Gear = ({ size = 22 }) => (
  <svg {...base(size)} strokeWidth={1.8}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const Screen = ({ size = 22 }) => (
  <svg {...base(size)} strokeWidth={1.8}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
);
export const Expand = ({ size = 20 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);
export const Close = ({ size = 20 }) => (
  <svg {...base(size)} strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
