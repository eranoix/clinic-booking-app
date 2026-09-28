export interface WeeklyRule {
  weekday: number;
  start: string;
  end: string;
}

export interface DateException {
  date: string;
  kind: 'closed' | 'open';
  windows?: { start: string; end: string }[];
}

export interface Service {
  durationMin: number;
  stepMin: number;
  minNoticeMin?: number;
  maxAdvanceDays?: number;
  bufferAfterMin?: number;
}

export interface Calendar {
  timeZone: string;
  weekly: WeeklyRule[];
  exceptions?: DateException[];
}

export interface Interval {
  start: number;
  end: number;
}

export function zonedTimeToUtc(
  dateISO: string,
  hhmm: string,
  timeZone: string,
): number {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];

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

export function dateInZone(ts: number, timeZone: string): string {
  return formatter('date', 'en-CA', timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts));
}

export function weekdayInZone(ts: number, timeZone: string): number {
  const name = formatter('weekday', 'en-US', timeZone, { weekday: 'short' })
    .format(new Date(ts));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

function datesBetween(from: number, to: number, timeZone: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let ts = from - 86_400_000; ts <= to + 86_400_000; ts += 43_200_000) {
    const d = dateInZone(ts, timeZone);
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out.sort();
}

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

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface SlotQuery {
  calendar: Calendar;
  service: Service;
  from: number;
  to: number;
  busy?: Interval[];
  now?: number;
}

export class InvalidService extends Error {
  override readonly name = 'InvalidService';
}

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
        const reserved = { start: slot.start, end: slot.end + bufferMs };
        if (busy.some((b) => overlaps(reserved, b))) continue;
        out.push(slot);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
