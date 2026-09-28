import { dateInZone, weekdayInZone, zonedTimeToUtc } from './availability.js';

export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  frequency: Frequency;
  interval?: number;
  byWeekday?: number[];
  byMonthDay?: number[];
  count?: number;
  until?: number;
  exceptDates?: string[];
}

export interface ExpandOptions {
  rule: RecurrenceRule;
  start: number;
  timeZone: string;
  from?: number;
  to?: number;
  limit?: number;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  if (day > daysInMonth) return null;
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export class InvalidRule extends Error {
  override readonly name = 'InvalidRule';
}

export function expand(opts: ExpandOptions): number[] {
  const { rule, start, timeZone } = opts;

  if (rule.count != null && rule.count <= 0) return [];

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

  const days = rule.byMonthDay?.length
    ? [...rule.byMonthDay].sort((a, b) => a - b)
    : [Number(startDate.split('-')[2])];

  for (let m = 0; m < limit; m += interval) {
    for (const day of days) {
      const dateISO = addMonthsISO(startDate, m, day);
      if (dateISO === null) continue;
      if (!push(dateISO)) return out;
    }
  }
  return out;
}

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
