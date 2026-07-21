import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Priority+ overflow navigation. A hidden "measurer" row (rendered by the
// caller with full item widths) is measured against the visible container's
// width; the hook returns how many leading items fit, reserving room for the
// trailing controls (the always-present More + AI menus). Items beyond the
// count fold into the More menu. Re-measures on container resize — so the
// breakpoint is the actual available space, not a hard-coded media query.
export function useOverflowNav(count: number) {
  const containerRef = useRef<HTMLDivElement>(null); // visible region (space budget)
  const reserveRef = useRef<HTMLDivElement>(null);   // trailing controls to reserve for
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [visible, setVisible] = useState(count);

  const recompute = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const reserve = reserveRef.current?.offsetWidth ?? 0;
    const gap = 4;
    const avail = c.clientWidth - reserve - gap;
    let used = 0, n = 0;
    for (let i = 0; i < count; i++) {
      const w = itemRefs.current[i]?.offsetWidth ?? 0;
      used += w + gap;
      if (used <= avail) n++; else break;
    }
    setVisible(prev => (prev === n ? prev : Math.max(0, n)));
  }, [count]);

  useLayoutEffect(() => {
    recompute();
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    if (reserveRef.current) ro.observe(reserveRef.current);
    return () => ro.disconnect();
  }, [recompute, count]);

  const setItemRef = (i: number) => (el: HTMLElement | null) => { itemRefs.current[i] = el; };
  return { containerRef, reserveRef, setItemRef, visible };
}
