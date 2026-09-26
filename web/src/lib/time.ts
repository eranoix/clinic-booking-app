/**
 * Formatting and calendar-date arithmetic in the clinic's zone. Browser-safe:
 * imports only the engine's pure availability entry point. Instants are UTC
 * epoch ms; a "date" is "YYYY-MM-DD" in the clinic's zone.
 */
import { dateInZone, weekdayInZone, zonedTimeToUtc } from 'clinic-booking-app/availability';
import { CLINIC } from './clinic';

const TZ = CLINIC.timeZone;
const LOCALE = 'en-GB';

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, ...opts });

const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const dayLongFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const dayShortFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const dayFullFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const weekdayShortFmt = fmt({ weekday: 'short' });
const dayNumFmt = fmt({ day: 'numeric' });
const monthShortFmt = fmt({ month: 'short' });

export const time = (ts: number) => timeFmt.format(ts);
export const dayLong = (ts: number) => dayLongFmt.format(ts);
export const dayShort = (ts: number) => dayShortFmt.format(ts);
export const dayFull = (ts: number) => dayFullFmt.format(ts);
export const weekdayShort = (ts: number) => weekdayShortFmt.format(ts);
export const dayNum = (ts: number) => dayNumFmt.format(ts);
export const monthShort = (ts: number) => monthShortFmt.format(ts);

/** Noon is used to stand for a date: it exists on every day, DST or not. */
export const noonOf = (date: string) => zonedTimeToUtc(date, '12:00', TZ);

export const dateOf = (ts: number) => dateInZone(ts, TZ);
export const today = (now = Date.now()) => dateOf(now);
export const weekdayOf = (date: string) => weekdayInZone(noonOf(date), TZ);

/** [start of date, start of next date) as instants. 23 or 25 hours on a transition. */
export function dayBounds(date: string): { from: number; to: number } {
  return { from: zonedTimeToUtc(date, '00:00', TZ), to: zonedTimeToUtc(addDays(date, 1), '00:00', TZ) };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, -((wd + 6) % 7));
}

/** Minutes since local midnight, from "HH:MM". */
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** "Today", "Tomorrow", "Yesterday" or the short date. */
export function relativeDay(ts: number, now = Date.now()): string {
  const diff = daysBetween(today(now), dateOf(ts));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return dayShort(ts);
}

/** relativeDay for the middle of a sentence: "seen today", "next Mon 28 Sept". */
export function relativeDayInline(ts: number, now = Date.now()): string {
  const r = relativeDay(ts, now);
  return ['Today', 'Tomorrow', 'Yesterday'].includes(r) ? r.toLowerCase() : r;
}

export function isValidDate(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** Display order: the working week starts on Monday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
