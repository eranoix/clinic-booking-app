/**
 * A week at a clinic, end to end.
 *
 *   npm run demo
 *
 * Opening hours with a lunch break, a holiday closure, a one-off Saturday,
 * a recurring course of treatment, a double-booking attempt, a reschedule and
 * a cancellation.
 */

import {
  SchedulingEngine, SlotUnavailable, expand, describe, zonedTimeToUtc,
  type Calendar, type Service,
} from '../src/index.js';

const TZ = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, TZ);
const show = (ts: number) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));

const calendar: Calendar = {
  timeZone: TZ,
  weekly: [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 1, start: '14:00', end: '17:00' },
    { weekday: 3, start: '09:00', end: '12:00' },
    { weekday: 5, start: '09:00', end: '12:00' },
  ],
  exceptions: [
    { date: '2026-03-04', kind: 'closed' },
    { date: '2026-03-07', kind: 'open', windows: [{ start: '10:00', end: '13:00' }] },
  ],
};

const service: Service = {
  durationMin: 50, stepMin: 60, minNoticeMin: 60, maxAdvanceDays: 60, bufferAfterMin: 10,
};

const engine = new SchedulingEngine({ now: () => at('2026-03-01', '08:00') });
const resource = 'dr-lee';

const week = engine.available(
  resource, calendar, service, at('2026-03-02', '00:00'), at('2026-03-09', '00:00'),
);
console.log(`Open slots, week of 2 March: ${week.length}`);
console.log(`  first: ${show(week[0]!.start)}`);
console.log(`  last:  ${show(week.at(-1)!.start)}`);
console.log('  Wed 4 Mar is closed:',
  !week.some((s) => show(s.start).includes('04 Mar')));
console.log('  Sat 7 Mar opened for one week:',
  week.some((s) => show(s.start).includes('07 Mar')), '\n');

const booking = engine.book({
  resourceId: resource, serviceId: 'consult', service, calendar,
  customerName: 'Ana Ferreira', customerEmail: 'ana@example.com',
  startsAt: at('2026-03-02', '09:00'),
});
console.log(`Booked ${show(booking.startsAt)} — link token ${booking.publicToken.slice(0, 8)}…`);

try {
  engine.book({
    resourceId: resource, serviceId: 'consult', service, calendar,
    customerName: 'Bo Martins', customerEmail: 'bo@example.com',
    startsAt: at('2026-03-02', '09:00'),
  });
} catch (err) {
  if (err instanceof SlotUnavailable) console.log(`Second attempt refused: ${err.message}`);
}

const rule = { frequency: 'weekly' as const, byWeekday: [1], count: 4 };
console.log(`\nCourse of treatment — ${describe(rule)}`);
const occurrences = expand({ rule, start: at('2026-03-09', '14:00'), timeZone: TZ });
const series = engine.bookSeries(occurrences, {
  resourceId: resource, serviceId: 'therapy', service, calendar,
  customerName: 'Rui Alves', customerEmail: 'rui@example.com',
});
for (const b of series.booked) console.log(`  booked   ${show(b.startsAt)}`);
for (const s of series.skipped) console.log(`  skipped  ${show(s.startsAt)} — ${s.reason}`);

const moved = engine.reschedule(
  booking.publicToken, at('2026-03-02', '11:00'), { calendar, service },
);
console.log(`\nRescheduled to ${show(moved.startsAt)}; link token unchanged: ${moved.publicToken === booking.publicToken}`);

engine.cancel(booking.publicToken);
console.log(`Cancelled. Slot free again: ${
  engine.available(resource, calendar, service, at('2026-03-02', '11:00'), at('2026-03-02', '12:00')).length > 0
}`);
console.log(`Record kept rather than deleted: ${engine.byToken(booking.publicToken)?.status}`);
engine.close();
