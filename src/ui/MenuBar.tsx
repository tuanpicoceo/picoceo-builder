// Desktop-style menu bar: click a menu to open it, hover to move between open menus, Esc / outside click closes.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem =
  | { label: string; onClick?: () => void; hint?: string; disabled?: boolean; checked?: boolean }
  | { separator: true }
  | { heading: string };

export function MenuBar(props: { menus: { label: string; items: MenuItem[] }[]; right?: ReactNode; brand: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <header className="menubar" ref={ref}>
      <div className="brand">{props.brand}</div>
      <nav className="menus" role="menubar">
        {props.menus.map((m, i) => (
          <div key={m.label} className={`menu ${open === i ? 'open' : ''}`}>
            <button role="menuitem" aria-haspopup="true" aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
              {m.label}
            </button>
            {open === i && (
              <div className="menu-pop" role="menu">
                {m.items.map((it, k) =>
                  'separator' in it ? <hr key={k} /> :
                  'heading' in it ? <div key={k} className="menu-heading">{it.heading}</div> :
                  <button key={k} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(null); it.onClick?.(); }}>
                    <span className="tick">{it.checked ? '✓' : ''}</span>
                    <span className="label">{it.label}</span>
                    {it.hint && <span className="menu-hint">{it.hint}</span>}
                  </button>)}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="menubar-right">{props.right}</div>
    </header>
  );
}
