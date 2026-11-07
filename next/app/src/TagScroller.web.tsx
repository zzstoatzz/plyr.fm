import { useEffect, useRef, type ReactNode } from 'react';

export function TagScroller({ children, onNearEnd }: { children: ReactNode; onNearEnd: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const nearEnd = useRef(onNearEnd);
  nearEnd.current = onNearEnd;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const check = () => {
      if (node.clientWidth > 0 && node.scrollWidth - node.clientWidth - node.scrollLeft < node.clientWidth) nearEnd.current();
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.deltaX || !event.deltaY) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1;
      const delta = event.deltaY * unit * 2;
      const max = node.scrollWidth - node.clientWidth;
      if (delta < 0 && node.scrollLeft <= 0 || delta > 0 && node.scrollLeft >= max - 1) return;
      event.preventDefault();
      const base = Math.sign(target.current - node.scrollLeft) === Math.sign(delta) ? target.current : node.scrollLeft;
      target.current = Math.max(0, Math.min(max, base + delta));
      node.scrollTo({ left: target.current, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    const reset = () => { target.current = node.scrollLeft; };
    const observer = new ResizeObserver(check);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('scroll', check, { passive: true });
    node.addEventListener('scrollend', reset);
    node.addEventListener('pointerdown', reset);
    check();
    return () => {
      observer.disconnect();
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('scroll', check);
      node.removeEventListener('scrollend', reset);
      node.removeEventListener('pointerdown', reset);
    };
  }, []);
  useEffect(() => {
    const node = element.current;
    if (node && node.clientWidth > 0 && node.scrollWidth - node.clientWidth - node.scrollLeft < node.clientWidth) nearEnd.current();
  }, [children]);
  return <div ref={element} data-testid="home-tags" style={{ overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
    <div style={{ display: 'flex', width: 'max-content', gap: 6, alignItems: 'center' }}>{children}</div>
  </div>;
}
