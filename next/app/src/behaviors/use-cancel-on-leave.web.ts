import { useEffect, useRef } from 'react';

export function useCancelOnLeave(active: boolean, cancel: () => void) {
  const latest = useRef(cancel);
  latest.current = cancel;
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') latest.current(); };
    const blur = () => latest.current();
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  }, [active]);
}
