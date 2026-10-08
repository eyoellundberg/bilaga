'use client';
import { useEffect, useRef, type ReactNode } from 'react';

// CSS-only burger below 720 px. In-page links (#how, #pricing) don't reload the page, so close it on link taps.
export function MobileNav({ children }: { children: ReactNode }) {
  const toggle = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (toggle.current && (e.target as Element).closest?.('.nav-collapsible a')) toggle.current.checked = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <>
      <input ref={toggle} type="checkbox" id="nav-toggle" className="nav-toggle" />
      <label htmlFor="nav-toggle" className="nav-burger" aria-label="Menu">
        <span />
        <span />
        <span />
      </label>
      <nav className="nav-collapsible">{children}</nav>
    </>
  );
}
