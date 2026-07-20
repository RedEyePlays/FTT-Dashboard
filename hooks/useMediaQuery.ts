import { useEffect, useState } from 'react';

// A single matchMedia listener per query (no resize spam / debouncing needed).
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);

  return matches;
}

// Tailwind's md breakpoint is 768px; "mobile" = below it.
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

// Lock body scroll while a modal/drawer is open (prevents background scroll).
export function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, [active]);
}
