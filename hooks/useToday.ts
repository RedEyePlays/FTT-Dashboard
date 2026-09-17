import { useEffect, useState } from 'react';
import { todayISO } from '../domain/dates';

/**
 * Today's LOCAL calendar date as 'YYYY-MM-DD', kept current in a session that
 * is left open.
 *
 * THE BUG THIS FIXES. The drawer's derived values were memoized on the DATA
 * alone — `useMemo(() => drawerCarryOver(cashReconciliations, todayISO()), [cashReconciliations])`.
 * `todayISO()` was read inside the memo but was not a dependency, so the memo
 * kept yesterday's answer for as long as the data didn't change, while other
 * reads of `todayISO()` elsewhere in the same render returned the NEW date the
 * moment the clock passed midnight. A terminal left running overnight — which
 * is the normal state of a shop's POS — then mixed yesterday's carry-over and
 * summary with today's record, and the drawer could read as never-opened or
 * as closed. Making the date a piece of STATE means it changes, which means
 * every memo that depends on it recomputes.
 *
 * It updates on three triggers, because no single one is reliable:
 *  - a timer armed for the next local midnight (re-armed each time), for a
 *    terminal sitting idle on the POS screen;
 *  - `visibilitychange`/`focus`, because a backgrounded or sleeping tab has
 *    its timers throttled or suspended and can wake up hours late;
 *  - a slow poll, as a backstop for a machine that was suspended and resumed
 *    without ever firing a focus event.
 *
 * `setDate` is called with the value, so React bails out of re-rendering when
 * the date hasn't actually changed — these fire often and must be free when
 * nothing moved.
 */
export function useToday(): string {
  const [date, setDate] = useState(() => todayISO());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => setDate(todayISO());

    // Arm for the next local midnight, plus a second of slack so the clock has
    // definitely rolled over by the time the callback reads it.
    const armMidnight = () => {
      if (timer) clearTimeout(timer);
      const next = new Date();
      next.setHours(24, 0, 0, 0);
      timer = setTimeout(() => { sync(); armMidnight(); }, Math.max(1000, next.getTime() - Date.now() + 1000));
    };
    armMidnight();

    const onWake = () => { sync(); armMidnight(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    const poll = setInterval(sync, 60_000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);

  return date;
}
