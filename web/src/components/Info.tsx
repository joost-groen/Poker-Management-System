import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

const WIDTH = 264;
const GAP = 12;

/** Small "i" that explains a function: tap to toggle, or hover with a mouse. */
export function Info({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - GAP * 2);
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, GAP), window.innerWidth - width - GAP);
    setPos({ top: r.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && wrap.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const hover = (state: boolean) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setOpen(state);
  };

  return (
    <span className="info" ref={wrap} onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
      <button
        ref={btn}
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span role="tooltip" className="info-pop" style={{ top: pos.top, left: pos.left, width: Math.min(WIDTH, window.innerWidth - GAP * 2) }}>
          {children}
        </span>
      )}
    </span>
  );
}
