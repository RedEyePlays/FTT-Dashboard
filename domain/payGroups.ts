import { AppUser, PayGroup, PayGroupChange } from '../types';
import { PayCycle, PAY_CYCLE_DAYS, PayPeriod, payPeriodFor, recentPayPeriods, toISODate, periodEndInclusive } from './timeclock';

/**
 * NOT EVERYONE GETS PAID THE SAME WEEK.
 *
 * settings.payroll was ONE workspace-wide { cycle, anchorISO }, so every
 * employee shared the same periods and every payday was one big drain on a till
 * the owner pays cash out of. Splitting the staff across alternating weeks
 * halves that without changing anyone's pay.
 *
 * The model is deliberately the smallest thing that works: group B's periods
 * are group A's, shifted by exactly 7 days. Nothing else differs — same cycle,
 * same length, same maths. On a WEEKLY cycle a 7-day shift lands back on the
 * same boundaries, so groups mean nothing there and the setting is hidden
 * rather than left on screen doing nothing.
 *
 * `payGroup` unset means 'A', so an untouched workspace behaves exactly as it
 * did and every existing PayPeriodPaid / PayPeriodApproval record is a group A
 * record without being rewritten.
 *
 * THE DANGEROUS PART IS MOVING SOMEBODY. Their old group's periods and their
 * new group's periods do not meet: there is a 7-day gap between the last old
 * period's end and the first new period's start. Those hours are real and
 * somebody worked them. They become ONE short CATCH-UP period, shown as such —
 * see `payPeriodsForUser`. The invariant that matters, and that the tests pin,
 * is that every shift falls in exactly one period: never both, never neither.
 *
 * Pure: no DOM, no Firestore.
 */

export const PAY_GROUPS: PayGroup[] = ['A', 'B'];
export const PAY_GROUP_LABEL: Record<PayGroup, string> = { A: 'Group A', B: 'Group B' };

/** Group B is offset by exactly one week from the workspace anchor. */
export const GROUP_OFFSET_DAYS: Record<PayGroup, number> = { A: 0, B: 7 };

/** Do pay groups mean anything on this cycle? Only bi-weekly. */
export const payGroupsApply = (cycle: PayCycle): boolean => cycle === 'biweekly';

export const WEEKLY_GROUPS_NOTE =
  'Pay groups only do something on a bi-weekly cycle — on a weekly cycle both groups are paid the same week.';

const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d.getTime());
};

/** The anchor date group `g` computes its periods from. */
export const anchorForGroup = (anchorISO: string, g: PayGroup, cycle: PayCycle): string =>
  payGroupsApply(cycle) ? addDaysISO(anchorISO, GROUP_OFFSET_DAYS[g]) : anchorISO;

/* ---------------- Which group is somebody in, and when ---------------- */

/** The whole group timeline, oldest first — same shape as rateHistory. */
export const groupTimeline = (u: Pick<AppUser, 'payGroup' | 'payGroupHistory'>): PayGroupChange[] => {
  const history = (u.payGroupHistory || []).filter(Boolean);
  if (history.length === 0) {
    return [{ group: u.payGroup || 'A', effectiveFrom: '', setBy: '', setAt: 0 }];
  }
  return [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.setAt - b.setAt);
};

/** This person's group right now (unset = A). */
export const payGroupOf = (u: Pick<AppUser, 'payGroup'>): PayGroup => u.payGroup || 'A';

/** The group in force on a local calendar date. */
export const groupOnDate = (
  u: Pick<AppUser, 'payGroup' | 'payGroupHistory'>,
  dateISO: string,
): PayGroup => {
  let found: PayGroup = 'A';
  for (const g of groupTimeline(u)) {
    if (g.effectiveFrom <= dateISO) found = g.group;
    else break;
  }
  return found;
};

/* ---------------- The periods one person is actually paid on ---------------- */

export type UserPeriodKind = 'regular' | 'catchup';

export interface UserPayPeriod extends PayPeriod {
  group: PayGroup;
  kind: UserPeriodKind;
}

const regular = (p: PayPeriod, group: PayGroup): UserPayPeriod => ({ ...p, group, kind: 'regular' });

/**
 * The periods THIS person is paid on, newest first — their current group's
 * periods, plus the catch-up period a group move leaves behind.
 *
 * A move is recorded with an effectiveFrom on a boundary (see `moveAllowed`),
 * and the gap it opens is [last old period end, first new period start): on a
 * bi-weekly cycle always exactly 7 days. Shifts in that window belong to
 * neither group's regular periods, so without this they would be paid twice or
 * not at all depending on which group's list you happened to be looking at.
 */
export const payPeriodsForUser = (
  u: Pick<AppUser, 'payGroup' | 'payGroupHistory'>,
  now: number,
  cycle: PayCycle,
  anchorISO: string,
  count: number,
): UserPayPeriod[] => {
  const days = PAY_CYCLE_DAYS[cycle];
  if (!payGroupsApply(cycle)) {
    return recentPayPeriods(now, count, days, anchorISO).map(p => regular(p, 'A'));
  }

  const timeline = groupTimeline(u);
  const boundaryMs = (iso: string): number =>
    iso ? Date.parse(`${iso}T00:00:00`) : -Infinity;

  // One SEGMENT per timeline entry: the window during which this person was in
  // that group. Each segment contributes only the regular periods that fall
  // wholly inside it, so the old group's periods stop at the move and the new
  // group's start after the catch-up — which is what keeps every shift in
  // exactly one period.
  const segmentPeriods = (group: PayGroup, lo: number, hi: number): UserPayPeriod[] => {
    const anchor = anchorForGroup(anchorISO, group, cycle);
    const out: UserPayPeriod[] = [];
    const from = Math.min(hi - 1, now);
    if (from < lo) return out;
    let p = payPeriodFor(from, days, anchor);
    while (p.start >= lo && out.length < count) {
      if (p.start <= now) out.push(regular(p, group));
      p = payPeriodFor(p.start - 1, days, anchor);
    }
    return out;
  };

  const out: UserPayPeriod[] = [];
  for (let i = timeline.length - 1; i >= 0 && out.length < count; i--) {
    const group = timeline[i].group;
    const previous = i > 0 ? timeline[i - 1].group : group;
    const upper = i + 1 < timeline.length ? boundaryMs(timeline[i + 1].effectiveFrom) : Infinity;

    // A move opens this segment with the catch-up period that bridges the gap
    // between the two groups' schedules.
    const gap = previous !== group
      ? catchUpPeriod(timeline[i].effectiveFrom, previous, group, cycle, anchorISO)
      : null;
    const lower = gap ? gap.end : boundaryMs(timeline[i].effectiveFrom);

    out.push(...segmentPeriods(group, lower, upper));
    if (gap && gap.start <= now) out.push(gap);
  }

  // Periods that have not begun yet are not pay periods anybody can look at.
  return out
    .filter(p => p.start <= now)
    .sort((a, b) => b.start - a.start)
    .slice(0, count);
};

/**
 * The short period bridging a group move, or null when the two groups' periods
 * already meet (they never do on a bi-weekly cycle, but a weekly workspace or a
 * move dated exactly on both boundaries would).
 */
export const catchUpPeriod = (
  effectiveFrom: string,
  from: PayGroup,
  to: PayGroup,
  cycle: PayCycle,
  anchorISO: string,
): UserPayPeriod | null => {
  if (!payGroupsApply(cycle) || from === to) return null;
  const days = PAY_CYCLE_DAYS[cycle];
  const moveMs = Date.parse(`${effectiveFrom}T00:00:00`);
  if (!isFinite(moveMs)) return null;

  // The OLD group's period that the move date closes, and the NEW group's
  // period that opens after it. The move is required to sit on an old-group
  // boundary (moveAllowed), so `oldEnd` is exactly the move date.
  const oldPeriod = payPeriodFor(moveMs - 1, days, anchorForGroup(anchorISO, from, cycle));
  const start = oldPeriod.end;

  // The NEW group's period containing that instant. Its own start is strictly
  // before it (the two groups' boundaries are 7 days apart and so never
  // coincide), and its end is the first new-group start on or after the move —
  // which is where this person's new group's periods begin. Everything between
  // is the gap.
  const newPeriod = payPeriodFor(start, days, anchorForGroup(anchorISO, to, cycle));
  if (newPeriod.start >= start) return null; // boundaries coincide — no gap to bridge
  return { index: oldPeriod.index, start, end: newPeriod.end, group: to, kind: 'catchup' };
};

/* ---------------- Moving somebody between groups ---------------- */

export type MoveRefusal =
  | { ok: true; effectiveFrom: string }
  | { ok: false; reason: 'inside_paid_period'; periodStart: string }
  | { ok: false; reason: 'same_group' };

/**
 * The next boundary a move may take effect on — the end of the person's current
 * period. A move mid-period would cut a period in half on one side and leave a
 * stub on the other; taking effect at a boundary is what makes the catch-up
 * period a clean single window.
 */
export const nextMoveDate = (
  u: Pick<AppUser, 'payGroup' | 'payGroupHistory'>,
  now: number,
  cycle: PayCycle,
  anchorISO: string,
): string => {
  const days = PAY_CYCLE_DAYS[cycle];
  const current = payPeriodFor(now, days, anchorForGroup(anchorISO, payGroupOf(u), cycle));
  return toISODate(current.end);
};

/**
 * May this person move to this group on this date?
 *
 * Refused when the date reaches into a period already PAID — the same hard line
 * rate changes draw (domain/payRates.ts). Reshuffling which period a paid shift
 * belongs to would make the signed-off snapshot disagree with the screen, with
 * nothing to say which one was real.
 */
export const moveAllowed = (
  u: Pick<AppUser, 'payGroup' | 'payGroupHistory'>,
  to: PayGroup,
  effectiveFrom: string,
  paidPeriods: { userId: string; periodStart: string; periodEnd: string }[],
  userId: string,
): MoveRefusal => {
  if (payGroupOf(u) === to) return { ok: false, reason: 'same_group' };
  const hit = paidPeriods.find(p =>
    p.userId === userId && effectiveFrom >= p.periodStart && effectiveFrom <= p.periodEnd);
  if (hit) return { ok: false, reason: 'inside_paid_period', periodStart: hit.periodStart };
  return { ok: true, effectiveFrom };
};

export const MOVE_IN_PAID_PERIOD_MESSAGE =
  'That date reaches into a pay period that has already been paid out. Move them from a later boundary instead.';

/** Record the move on the user, keeping payGroup and payGroupHistory in step. */
export const applyGroupChange = (
  u: Pick<AppUser, 'payGroup' | 'payGroupHistory'>,
  change: PayGroupChange,
  todayISO: string,
): { payGroup: PayGroup; payGroupHistory: PayGroupChange[] } => {
  const seeded = groupTimeline(u);
  const payGroupHistory = [...seeded.filter(g => g.effectiveFrom !== change.effectiveFrom), change]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.setAt - b.setAt);
  return { payGroup: groupOnDate({ payGroupHistory }, todayISO), payGroupHistory };
};

/* ---------------- Keys ---------------- */

/**
 * The id of a per-user, per-period paid/approval record.
 *
 * Group A keeps the LEGACY `${userId}__${startISO}` form verbatim, so every
 * record already in Firestore resolves untouched. Anything else gets a suffix,
 * because a catch-up period starts on an old-group boundary — which is also the
 * start of a regular period of that group — and the two would otherwise collide
 * on the same id and overwrite each other.
 */
export const periodRecordKey = (
  userId: string,
  periodStartISO: string,
  group: PayGroup = 'A',
  kind: UserPeriodKind = 'regular',
): string => {
  if (group === 'A' && kind === 'regular') return `${userId}__${periodStartISO}`;
  return `${userId}__${periodStartISO}__${kind === 'catchup' ? 'catchup' : group}`;
};

/** The key for a period this person is actually paid on. */
export const userPeriodKey = (userId: string, p: UserPayPeriod): string =>
  periodRecordKey(userId, toISODate(p.start), p.group, p.kind);

/* ---------------- Labels ---------------- */

const short = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** "Group A · Sep 21 – Oct 4", or "Catch-up · Oct 5 – Oct 11" for a move. */
export const userPeriodLabel = (p: UserPayPeriod, withGroup = true): string => {
  const range = `${short(p.start)} – ${short(periodEndInclusive(p))}`;
  if (p.kind === 'catchup') return `Catch-up · ${range}`;
  return withGroup ? `${PAY_GROUP_LABEL[p.group]} · ${range}` : range;
};

export const CATCHUP_NOTE =
  'A short catch-up period, covering the hours between this person’s old pay group and their new one. It is paid once, like any other period.';

/** Everyone shown on a period: the people whose group that period belongs to. */
export const staffOnPeriod = <T extends Pick<AppUser, 'id' | 'payGroup' | 'payGroupHistory'>>(
  staff: T[],
  p: UserPayPeriod,
  cycle: PayCycle,
): T[] => {
  if (!payGroupsApply(cycle)) return staff;
  const onISO = toISODate(p.start);
  // A catch-up period belongs to exactly the person who moved, so it is matched
  // on the group they moved TO combined with actually having a move recorded.
  if (p.kind === 'catchup') {
    return staff.filter(u => (u.payGroupHistory || []).some(g => g.effectiveFrom === onISO && g.group === p.group));
  }
  return staff.filter(u => groupOnDate(u, onISO) === p.group);
};
