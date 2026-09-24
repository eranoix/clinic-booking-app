/**
 * Recurrence, deliberately small.
 *
 * This covers daily, weekly-by-weekday and monthly-by-day-of-month, with a
 * count or an until, plus exception dates. That is a subset of RFC 5545, and
 * the subset is the point: the full specification includes rules almost nobody
 * schedules against, and every one of them is a branch that can be wrong.
 *
 * Two decisions worth stating, because both are where naive implementations
 * quietly produce the wrong answer:
 *
 *   Expansion walks the LOCAL calendar, not a fixed millisecond step. A weekly
 *   series across a daylight-saving boundary must keep landing at 09:00 local;
 *   adding 7 × 86_400_000 lands it at 08:00 or 10:00 and nobody notices until
 *   someone misses an appointment.
 *
 *   The 31st of a month that has 30 days is SKIPPED, not clamped to the 30th.
 *   Clamping silently invents an occurrence the person never asked for, and
 *   the difference shows up as a stranger in someone's calendar.
 */

import { dateInZone, weekdayInZone, zonedTimeToUtc } from './availability.js';

export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  frequency: Frequency;
  /** Every N periods. 1 = every one. */
  interval?: number;
  /** weekly only: 0 = Sunday … 6 = Saturday. Defaults to the start's weekday. */
  byWeekday?: number[];
  /** monthly only: 1–31. Defaults to the start's day of month. */
  byMonthDay?: number[];
  /** Stop after this many occurrences. */
  count?: number;
  /** Stop at or before this instant. */
  until?: number;
  /** Dates in "YYYY-MM-DD" to skip — a holiday, a cancelled single session. */
  exceptDates?: string[];
}

export interface ExpandOptions {
  rule: RecurrenceRule;
  /** First occurrence, as a UTC instant. */
  start: number;
  timeZone: string;
  /** Only return occurrences within this window. */
  from?: number;
  to?: number;
  /** Safety valve against an unbounded rule. */
  limit?: number;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The local wall-clock time of an instant, as "HH:MM". */
function timeInZone(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function addMonthsISO(dateISO: string, months: number, day: number): string | null {
  const [y, m] = dateISO.split('-').map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const daysInMonth = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  // The skip, not a clamp. A series on the 31st simply has no February
  // occurrence; moving it to the 28th would invent one.
  if (day > daysInMonth) return null;
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Thrown when a rule field is outside the range it is defined over. */
export class InvalidRule extends Error {
  override readonly name = 'InvalidRule';
}

/**
 * Expand a rule into concrete instants.
 *
 * Bounded by `count`, `until` and `limit` — whichever comes first. A rule with
 * none of them is not an error but is capped by `limit`, because the failure
 * mode of an unbounded expansion is a process that stops responding rather
 * than one that reports a problem.
 */

export function expand(opts: ExpandOptions): number[] {
  const { rule, start, timeZone } = opts;

  // A count of zero means zero occurrences. The first version pushed before
  // checking the budget and returned one, which is the kind of off-by-one that
  // shows up as a single unexplained appointment rather than as an error.
  if (rule.count != null && rule.count <= 0) return [];

  // Out-of-range fields used to be accepted and produce dates by arithmetic --
  // weekday 9 quietly became "two days into next week". A wrong answer
  // delivered confidently is worse than a refusal.
  for (const wd of rule.byWeekday ?? []) {
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
      throw new InvalidRule(`byWeekday must be 0-6, got ${wd}`);
    }
  }
  for (const md of rule.byMonthDay ?? []) {
    if (!Number.isInteger(md) || md < 1 || md > 31) {
      throw new InvalidRule(`byMonthDay must be 1-31, got ${md}`);
    }
  }

  const interval = Math.max(1, rule.interval ?? 1);
  const limit = opts.limit ?? 500;
  const except = new Set(rule.exceptDates ?? []);
  const hhmm = timeInZone(start, timeZone);
  const startDate = dateInZone(start, timeZone);

  const out: number[] = [];
  const push = (dateISO: string): boolean => {
    if (except.has(dateISO)) return true;
    const ts = zonedTimeToUtc(dateISO, hhmm, timeZone);
    if (ts < start) return true;
    if (rule.until != null && ts > rule.until) return false;
    if (opts.from != null && ts < opts.from) return true;
    if (opts.to != null && ts > opts.to) return false;
    out.push(ts);
    return !(rule.count != null && out.length >= rule.count) && out.length < limit;
  };

  if (rule.frequency === 'daily') {
    for (let i = 0; i < limit * interval; i += interval) {
      if (!push(addDaysISO(startDate, i))) break;
    }
    return out;
  }

  if (rule.frequency === 'weekly') {
    const weekdays = (rule.byWeekday?.length
      ? [...rule.byWeekday]
      : [weekdayInZone(start, timeZone)]).sort((a, b) => a - b);

    // Walk from the Sunday of the start's week so every requested weekday in
    // the first week is considered, including ones before the start date --
    // they are filtered by the `ts < start` guard rather than by arithmetic
    // that is easy to get off by one.
    const startWeekday = weekdayInZone(start, timeZone);
    let weekAnchor = addDaysISO(startDate, -startWeekday);

    for (let w = 0; w < limit; w += 1) {
      for (const wd of weekdays) {
        if (!push(addDaysISO(weekAnchor, wd))) return out;
      }
      weekAnchor = addDaysISO(weekAnchor, 7 * interval);
    }
    return out;
  }

  // monthly
  const days = rule.byMonthDay?.length
    ? [...rule.byMonthDay].sort((a, b) => a - b)
    : [Number(startDate.split('-')[2])];

  for (let m = 0; m < limit; m += interval) {
    for (const day of days) {
      const dateISO = addMonthsISO(startDate, m, day);
      if (dateISO === null) continue; // month too short: skipped, not clamped
      if (!push(dateISO)) return out;
    }
  }
  return out;
}

/** Human-readable description, for confirmation screens and emails. */
export function describe(rule: RecurrenceRule): string {
  const n = Math.max(1, rule.interval ?? 1);
  const every = n === 1 ? 'Every' : `Every ${n}`;
  let base: string;

  if (rule.frequency === 'daily') {
    base = n === 1 ? 'Every day' : `${every} days`;
  } else if (rule.frequency === 'weekly') {
    const names = (rule.byWeekday ?? []).map((d) => DAY_NAMES[d]).filter(Boolean);
    base = names.length
      ? `${every} week on ${names.join(', ')}`
      : `${every} week`;
  } else {
    const days = rule.byMonthDay ?? [];
    base = days.length
      ? `${every} month on day ${days.join(', ')}`
      : `${every} month`;
  }

  if (rule.count != null) base += `, ${rule.count} times`;
  else if (rule.until != null) {
    base += `, until ${new Date(rule.until).toISOString().slice(0, 10)}`;
  }
  return base;
}
