import 'server-only';
import { windowsForDate } from 'clinic-booking-app/availability';
import { addDays, dayBounds, today } from '@/lib/time';
import type { BookingDTO, SlotDTO } from '@/lib/types';
import { ANY, bookableServices, bookings, catalog, slotsBetween } from './scheduling';

const MIN = 60_000;
const DAY = 86_400_000;

export interface DaySummary {
  date: string;
  booked: number;
  cancelled: number;
  /** Minutes of confirmed appointments. */
  bookedMin: number;
  /** Minutes anyone is working, from the calendars. */
  openMin: number;
  /** People working that day. */
  working: number;
}

export function weekAhead(now = Date.now(), days = 7): DaySummary[] {
  const staff = catalog().staff().filter((s) => s.active);
  const start = today(now);
  const { from } = dayBounds(start);
  const { to } = dayBounds(addDays(start, days - 1));
  const all = bookings({ from, to });

  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const { from: f, to: t } = dayBounds(date);
    const onDay = all.filter((b) => b.startsAt >= f && b.startsAt < t);
    const confirmed = onDay.filter((b) => b.status === 'confirmed');
    let openMin = 0;
    let working = 0;
    for (const s of staff) {
      const mins = windowsForDate(s.calendar, date).reduce((n, w) => n + (w.end - w.start) / MIN, 0);
      openMin += mins;
      if (mins) working += 1;
    }
    return {
      date,
      booked: confirmed.length,
      cancelled: onDay.length - confirmed.length,
      bookedMin: confirmed.reduce((n, b) => n + (b.endsAt - b.startsAt) / MIN, 0),
      openMin,
      working,
    };
  });
}

/** The first bookable time for each service, with anyone who offers it. */
export function nextFree(now = Date.now()): { serviceId: string; serviceName: string; durationMin: number; slot: SlotDTO | null }[] {
  return bookableServices().map((svc) => {
    let slot: SlotDTO | null = null;
    // Look a week at a time so a busy clinic does not compute two months of
    // slots to find one tomorrow morning.
    for (let from = now; !slot && from < now + svc.maxAdvanceDays * DAY; from += 7 * DAY) {
      slot = slotsBetween(svc.id, ANY, from, from + 7 * DAY)[0] ?? null;
    }
    return { serviceId: svc.id, serviceName: svc.name, durationMin: svc.durationMin, slot };
  });
}

export function agenda(date: string): BookingDTO[] {
  const { from, to } = dayBounds(date);
  return bookings({ from, to });
}
