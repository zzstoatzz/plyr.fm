import { useEffect, useRef, type ReactNode } from 'react';

export function TagScroller({ children, hasMore, onNearEnd, lead }: { children: ReactNode; hasMore: boolean; onNearEnd: () => void; lead: number }) {
  const element = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const previous = useRef(lead);
  useEffect(() => {
    const node = element.current;
    const grew = lead > previous.current;
    previous.current = lead;
    if (!node || !grew || node.scrollLeft <= 0) return;
    target.current = 0;
    node.scrollTo({ left: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [lead]);
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
    let frame: number | undefined;
    let lastFrame = 0;
    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      lastFrame = 0;
    };
    const animate = (now: number) => {
      frame = undefined;
      const elapsed = lastFrame ? Math.min(64, now - lastFrame) : 16;
      lastFrame = now;
      const goal = Math.max(0, Math.min(target.current, node.scrollWidth - node.clientWidth));
      const remaining = goal - node.scrollLeft;
      const step = Math.sign(remaining) * Math.max(1, Math.abs(remaining) * (1 - Math.exp(-elapsed / 70)));
      node.scrollTo({ left: Math.abs(remaining) < 1 ? goal : node.scrollLeft + step, behavior: 'instant' });
      if (Math.abs(remaining) >= 1) frame = requestAnimationFrame(animate);
      else lastFrame = 0;
    };
    const travel = (precise = false) => {
      if (precise || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        stop();
        node.scrollTo({ left: target.current, behavior: 'instant' });
      } else if (frame === undefined) frame = requestAnimationFrame(animate);
    };
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
      const tail = sameDirection && elapsed < 100 && Math.abs(target.current - node.scrollLeft) > 1;
      const precise = strength === 0 && !tail;
      energy = precise ? 0 : (sameDirection ? energy * Math.exp(-elapsed / 140) : 0) + Math.min(1, strength / 80);
      const gain = strength === 0 ? 1 : Math.min(24, 1 + (strength / 50) ** 1.4 + energy * 2);
      const delta = pixels * gain;
      const max = node.scrollWidth - node.clientWidth;
      if (delta < 0 && node.scrollLeft <= 0 || delta > 0 && node.scrollLeft >= max - 1 && (!canExtend.current || target.current <= max)) return;
      event.preventDefault();
      const base = !precise && sameDirection && Math.sign(target.current - node.scrollLeft) === Math.sign(delta) ? target.current : node.scrollLeft;
      target.current = Math.max(0, Math.min(max + (canExtend.current ? node.clientWidth * 3 : 0), base + delta));
      direction = Math.sign(pixels);
      lastWheel = now;
      check();
      travel(precise);
    };
    const reset = () => { stop(); target.current = node.scrollLeft; lastWheel = 0; energy = 0; };
    const resized = () => {
      check();
      if (performance.now() - lastWheel < 600 && target.current > node.scrollLeft) travel();
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
      stop();
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
