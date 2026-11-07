import { useEffect, useRef, type ReactNode } from 'react';

export function TagScroller({ children, hasMore, onNearEnd }: { children: ReactNode; hasMore: boolean; onNearEnd: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const nearEnd = useRef(onNearEnd);
  nearEnd.current = onNearEnd;
  const canExtend = useRef(hasMore);
  canExtend.current = hasMore;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let lastWheel = 0;
    let direction = 0;
    let energy = 0;
    const motion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    const check = () => {
      const ahead = Math.max(node.clientWidth * 3, target.current - node.scrollLeft + node.clientWidth);
      if (canExtend.current && node.clientWidth > 0 && node.scrollWidth - node.clientWidth - node.scrollLeft < ahead) nearEnd.current();
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const input = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!input || !event.cancelable) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1;
      const pixels = input * unit;
      const now = performance.now();
      const elapsed = now - lastWheel;
      const sameDirection = direction === Math.sign(pixels) && elapsed < 250;
      const strength = Math.max(0, Math.abs(pixels) - 12);
      energy = strength === 0 ? 0 : (sameDirection ? energy * Math.exp(-elapsed / 140) : 0) + Math.min(1, strength / 80);
      const gain = strength === 0 ? 1 : Math.min(24, 1 + (strength / 50) ** 1.4 + energy * 2);
      const delta = pixels * gain;
      const max = node.scrollWidth - node.clientWidth;
      if (delta < 0 && node.scrollLeft <= 0 || delta > 0 && node.scrollLeft >= max - 1 && (!canExtend.current || target.current <= max)) return;
      event.preventDefault();
      const base = strength > 0 && sameDirection && Math.sign(target.current - node.scrollLeft) === Math.sign(delta) ? target.current : node.scrollLeft;
      target.current = Math.max(0, Math.min(max + (canExtend.current ? node.clientWidth * 3 : 0), base + delta));
      direction = Math.sign(pixels);
      lastWheel = now;
      check();
      node.scrollTo({ left: target.current, behavior: strength === 0 ? 'instant' : motion() });
    };
    const reset = () => { target.current = node.scrollLeft; lastWheel = 0; energy = 0; node.scrollTo({ left: target.current, behavior: 'instant' }); };
    const resized = () => {
      check();
      if (performance.now() - lastWheel < 600 && target.current > node.scrollLeft) node.scrollTo({ left: target.current, behavior: motion() });
    };
    const observer = new ResizeObserver(resized);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('scroll', check, { passive: true });
    node.addEventListener('pointerdown', reset);
    node.addEventListener('keydown', reset);
    check();
    return () => {
      observer.disconnect();
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('scroll', check);
      node.removeEventListener('pointerdown', reset);
      node.removeEventListener('keydown', reset);
    };
  }, []);
  useEffect(() => {
    const node = element.current;
    if (hasMore && node && node.clientWidth > 0 && node.scrollWidth - node.clientWidth - node.scrollLeft < node.clientWidth * 3) nearEnd.current();
  }, [children, hasMore]);
  return <div ref={element} data-testid="home-tags" style={{ overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
    <div style={{ display: 'flex', width: 'max-content', gap: 6, alignItems: 'center' }}>{children}</div>
  </div>;
}
