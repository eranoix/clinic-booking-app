/**
 * Availability: turning rules into the slots a person can actually pick.
 *
 * The naive version of this is a loop over opening hours that subtracts
 * bookings. It falls apart on the cases that make up most of real scheduling:
 *
 *   - A service that runs 50 minutes but is offered on the hour, so the gap
 *     between appointments is part of the rule, not a rounding error.
 *   - Notice periods: "not in the next two hours" is different from "not
 *     today", and both are different from "not before Monday".
 *   - Exceptions that ADD availability, not only remove it. A Saturday morning
 *     opened for one week is the same shape of data as a Tuesday closed for a
 *     holiday, and modelling only the second one means the first gets hacked in
 *     later.
 *   - Days that are not 24 hours long, because the clocks moved.
 *
 * All times here are UTC instants (epoch milliseconds). Local wall-clock rules
 * are resolved against a named zone at the edge of this module and never
 * carried inward, because a "09:00" that has already been turned into an
 * instant is unambiguous, and one that has not is a bug waiting for October.
 */

export interface WeeklyRule {
  /** 0 = Sunday … 6 = Saturday, in the calendar's zone. */
  weekday: number;
  /** Local wall-clock, "HH:MM". */
  start: string;
  end: string;
}

export interface DateException {
  /** "YYYY-MM-DD" in the calendar's zone. */
  date: string;
  /**
   * `closed` removes the whole day. `open` REPLACES that day's weekly rules
   * with the windows given, which is what lets a one-off Saturday morning be
   * expressed without inventing a second mechanism for it.
   */
  kind: 'closed' | 'open';
  windows?: { start: string; end: string }[];
}

export interface Service {
  /** How long the appointment itself lasts. */
  durationMin: number;
  /**
   * The grid slots are offered on. A 50-minute service on a 60-minute step
   * leaves a 10-minute gap between appointments by construction, rather than
   * by asking staff to remember.
   */
  stepMin: number;
  /** Cannot be booked closer to now than this. */
  minNoticeMin?: number;
  /** Cannot be booked further out than this. */
  maxAdvanceDays?: number;
  /** Extra time reserved after the appointment, not offered to anyone else. */
  bufferAfterMin?: number;
}

export interface Calendar {
  /** IANA zone the rules are written in, e.g. "Europe/Lisbon". */
  timeZone: string;
  weekly: WeeklyRule[];
  exceptions?: DateException[];
}

export interface Interval {
  start: number;
  end: number;
}

/**
 * Wall-clock in a named zone → UTC instant.
 *
 * Implemented by asking Intl what a candidate instant looks like in that zone
 * and correcting the difference, rather than by carrying an offset around. An
 * offset is only true until the next transition, and the whole class of
 * daylight-saving bugs comes from storing one and reusing it.
 */
export function zonedTimeToUtc(
  dateISO: string,
  hhmm: string,
  timeZone: string,
): number {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];

  // First guess: treat the wall-clock as if it were UTC, then measure how far
  // off that is in the target zone and shift by the difference. One correction
  // is enough except exactly at a transition, where a second settles it.
  let ts = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const seen = wallClockInZone(ts, timeZone);
    const target = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    const diff = target - seen;
    if (diff === 0) break;
    ts += diff;
  }
  return ts;
}

/**
 * Formatters are cached per zone and shape. Constructing an
 * Intl.DateTimeFormat costs far more than using one -- it loads locale and
 * zone data -- and slot generation formats thousands of instants for a
 * handful of zones. A formatter holds no state between calls, so sharing one
 * cannot change a result.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(
  key: string, locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const id = `${key}|${timeZone}`;
  let fmt = formatters.get(id);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone, ...opts });
    formatters.set(id, fmt);
  }
  return fmt;
}

/** What an instant reads as on a clock in that zone, expressed as a UTC stamp. */
function wallClockInZone(ts: number, timeZone: string): number {
  const fmt = formatter('wall', 'en-US', timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return Date.UTC(
    parts.year!, (parts.month ?? 1) - 1, parts.day!,
    (parts.hour ?? 0) % 24, parts.minute!, parts.second!,
  );
}

/** Calendar date in a zone, as "YYYY-MM-DD". */
export function dateInZone(ts: number, timeZone: string): string {
  return formatter('date', 'en-CA', timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts));
}

/** Weekday in a zone, 0 = Sunday. */
export function weekdayInZone(ts: number, timeZone: string): number {
  const name = formatter('weekday', 'en-US', timeZone, { weekday: 'short' })
    .format(new Date(ts));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Every calendar date touched by [from, to), in the calendar's zone. */
function datesBetween(from: number, to: number, timeZone: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Step by 12 hours rather than 24: a day is not always 24 hours long, and
  // stepping by a fixed day can skip one across a transition.
  for (let ts = from - 86_400_000; ts <= to + 86_400_000; ts += 43_200_000) {
    const d = dateInZone(ts, timeZone);
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out.sort();
}

/**
 * The windows a calendar is open on a given date.
 *
 * An `open` exception replaces the weekly rules for that date rather than
 * adding to them, so "this Saturday we open 09:00–13:00" does not have to be
 * reconciled with a weekly rule that says Saturdays are closed.
 */
export function windowsForDate(cal: Calendar, dateISO: string): Interval[] {
  const exception = cal.exceptions?.find((e) => e.date === dateISO);
  if (exception?.kind === 'closed') return [];

  const source = exception?.kind === 'open' && exception.windows?.length
    ? exception.windows.map((w) => ({ weekday: -1, ...w }))
    : cal.weekly.filter(
        (r) => r.weekday === weekdayInZone(
          zonedTimeToUtc(dateISO, '12:00', cal.timeZone), cal.timeZone,
        ),
      );

  return source
    .map((w) => ({
      start: zonedTimeToUtc(dateISO, w.start, cal.timeZone),
      end: zonedTimeToUtc(dateISO, w.end, cal.timeZone),
    }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
}

/** True when two half-open intervals share any instant. */
export function overlaps(a: Interval, b: Interval): boolean {
  // Half-open on purpose: an appointment ending at 10:00 and one starting at
  // 10:00 do not collide. Treating them as a clash loses a slot per boundary,
  // every day, and the loss is invisible.
  return a.start < b.end && b.start < a.end;
}

export interface SlotQuery {
  calendar: Calendar;
  service: Service;
  from: number;
  to: number;
  /** Already-taken intervals, in UTC. */
  busy?: Interval[];
  now?: number;
}

/**
 * Thrown when a service is configured in a way that cannot produce slots.
 *
 * Validated rather than tolerated. A `stepMin` of zero used to make the
 * generation loop advance by nothing and run until the process ran out of
 * memory -- a configuration mistake presenting as a crash under no load at
 * all, with a stack trace pointing at the allocator rather than at the
 * service definition that caused it.
 */
export class InvalidService extends Error {
  override readonly name = 'InvalidService';
}

/**
 * The slots a person may actually pick.
 *
 * Order matters: windows first, then the grid, then notice and horizon, then
 * collisions. Filtering collisions before the horizon would waste work on
 * slots nobody can book anyway, and — worse — a bug in the horizon would be
 * invisible because the collision filter happened to hide it.
 */

export function slots(q: SlotQuery): Interval[] {
  const { calendar, service } = q;

  if (!Number.isFinite(service.stepMin) || service.stepMin <= 0) {
    throw new InvalidService(`stepMin must be a positive number, got ${service.stepMin}`);
  }
  if (!Number.isFinite(service.durationMin) || service.durationMin <= 0) {
    throw new InvalidService(`durationMin must be a positive number, got ${service.durationMin}`);
  }
  if ((service.bufferAfterMin ?? 0) < 0) {
    throw new InvalidService('bufferAfterMin cannot be negative');
  }
  const now = q.now ?? Date.now();
  const stepMs = service.stepMin * 60_000;
  const durationMs = service.durationMin * 60_000;
  const bufferMs = (service.bufferAfterMin ?? 0) * 60_000;
  const earliest = now + (service.minNoticeMin ?? 0) * 60_000;
  const latest = service.maxAdvanceDays != null
    ? now + service.maxAdvanceDays * 86_400_000
    : Number.POSITIVE_INFINITY;

  const busy = q.busy ?? [];
  const out: Interval[] = [];

  for (const date of datesBetween(q.from, q.to, calendar.timeZone)) {
    for (const window of windowsForDate(calendar, date)) {
      for (let start = window.start; start + durationMs <= window.end; start += stepMs) {
        const slot = { start, end: start + durationMs };
        if (slot.start < q.from || slot.end > q.to) continue;
        if (slot.start < earliest || slot.start > latest) continue;
        // The buffer is reserved but not shown: it protects the next slot from
        // being offered too close, without appearing as time the customer is
        // paying for.
        const reserved = { start: slot.start, end: slot.end + bufferMs };
        if (busy.some((b) => overlaps(reserved, b))) continue;
        out.push(slot);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
