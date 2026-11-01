import { useEffect, useState } from 'react';

/**
 * True when nobody has touched the page for `minutes`. Used to pause live auto-refresh, so a dashboard
 * left open all day does not use up the free database's daily allowance.
 */
export function useIdle(minutes = 10): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), minutes * 60 * 1000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes]);
  return idle;
}
