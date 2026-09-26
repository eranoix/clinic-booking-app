/**
 * First-run data: a small physiotherapy clinic and a few weeks of bookings
 * either side of today. Every booking goes through the engine's public API
 * with its clock set to when the booking would have been made, so the history
 * obeys the same rules as a live booking. Deterministic for a given start date.
 * Every name is invented and every email is @example.com.
 */
import 'server-only';
import { SchedulingEngine, SlotUnavailable, expand, type Calendar } from 'clinic-booking-app';
import { windowsForDate, zonedTimeToUtc } from 'clinic-booking-app/availability';
import { CLINIC } from '@/lib/clinic';
import { addDays, dayBounds, mondayOf, today } from '@/lib/time';
import type { ServiceDef } from '@/lib/types';
import { engineService, type Catalog } from './catalog';
import { composer } from './mail';

const TZ = CLINIC.timeZone;
const MIN = 60_000;
const DAY = 86_400_000;

const STAFF = [
  { id: 'marta', name: 'Marta Quental', role: 'Physiotherapist, sports injuries', hue: 'blue' as const },
  { id: 'tomas', name: 'Tomás Aragão', role: 'Physiotherapist, back and neck', hue: 'green' as const },
  { id: 'helena', name: 'Helena Brandt', role: 'Rehabilitation after surgery', hue: 'ochre' as const },
  // Left the clinic a week ago: deactivated, not deleted, so their past
  // appointments still say who treated whom.
  { id: 'rui', name: 'Rui Calado', role: 'Physiotherapist, sports massage', hue: 'plum' as const },
];
const LEFT = new Set(['rui']);

const HOURS: Record<string, { weekday: number; start: string; end: string }[]> = {
  marta: [1, 2, 3, 4, 5].flatMap((weekday) => weekday === 3
    ? [{ weekday, start: '09:00', end: '13:00' }]
    : [{ weekday, start: '09:00', end: '13:00' }, { weekday, start: '14:00', end: '18:00' }]),
  tomas: [
    ...[1, 2, 4].flatMap((weekday) => [
      { weekday, start: '10:00', end: '13:00' }, { weekday, start: '14:00', end: '19:00' },
    ]),
    { weekday: 5, start: '08:00', end: '14:00' },
  ],
  helena: [
    ...[1, 3, 5].map((weekday) => ({ weekday, start: '08:30', end: '12:30' })),
    ...[2, 4].map((weekday) => ({ weekday, start: '13:00', end: '19:00' })),
  ],
  rui: [2, 3, 4].map((weekday) => ({ weekday, start: '14:00', end: '19:00' })),
};

const SERVICES: ServiceDef[] = [
  {
    id: 'assessment', name: 'Initial assessment',
    description: 'A first visit: we talk through what happened, examine the problem and agree a plan.',
    durationMin: 60, stepMin: 30, bufferAfterMin: 15, minNoticeMin: 24 * 60, maxAdvanceDays: 42,
    staffIds: ['marta', 'tomas', 'helena'], active: true,
  },
  {
    id: 'follow-up', name: 'Follow-up treatment',
    description: 'Hands-on treatment and exercises for a problem we have already assessed.',
    durationMin: 45, stepMin: 30, bufferAfterMin: 15, minNoticeMin: 3 * 60, maxAdvanceDays: 60,
    staffIds: ['marta', 'tomas', 'helena', 'rui'], active: true,
  },
  {
    id: 'massage', name: 'Sports massage',
    description: 'Deep tissue work for recovery and tight muscles. No assessment needed.',
    durationMin: 50, stepMin: 60, bufferAfterMin: 10, minNoticeMin: 4 * 60, maxAdvanceDays: 30,
    staffIds: ['marta', 'tomas', 'rui'], active: true,
  },
  {
    id: 'rehab', name: 'Post-surgery rehabilitation',
    description: 'A longer supervised session after an operation, built around your surgeon’s protocol.',
    durationMin: 60, stepMin: 60, bufferAfterMin: 0, minNoticeMin: 24 * 60, maxAdvanceDays: 60,
    staffIds: ['helena', 'tomas'], active: true,
  },
  {
    id: 'review', name: 'Short review',
    description: 'Twenty minutes to check progress and adjust your exercises.',
    durationMin: 20, stepMin: 20, bufferAfterMin: 0, minNoticeMin: 60, maxAdvanceDays: 14,
    staffIds: ['marta', 'helena'], active: true,
  },
];

const FIRST = [
  'Ana', 'Bruno', 'Carla', 'Diogo', 'Elsa', 'Filipe', 'Gisela', 'Hugo', 'Iris', 'João',
  'Leonor', 'Miguel', 'Nadia', 'Olavo', 'Patrícia', 'Rafael', 'Sofia', 'Tiago', 'Vera', 'Xavier',
  'Yara', 'Zé', 'Beatriz', 'Duarte', 'Emma', 'Frederik', 'Greta', 'Henrique', 'Inês', 'Jonas',
  'Kasia', 'Lorenzo', 'Mariana', 'Noah', 'Otília', 'Pedro', 'Rosa', 'Samuel', 'Teresa', 'Vasco',
];
const LAST = [
  'Albergaria', 'Bettencourt', 'Cordeiro', 'Damasceno', 'Esteves', 'Figueiral', 'Gaspar',
  'Hollander', 'Ivens', 'Jardim', 'Lobato', 'Madureira', 'Nogueira', 'Oliveira-Brandão', 'Pestana',
  'Quaresma', 'Rebelo', 'Salgueiro', 'Tavares', 'Ulrich', 'Valadares', 'Wendt', 'Xisto', 'Zagalo',
];

/** mulberry32: tiny, seeded, good enough to vary a demo. */
function rng(seedValue: number) {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed({ file, catalog, now }: { file: string; catalog: Catalog; now: number }): void {
  const startDate = today(now);
  const random = rng(Number(startDate.replaceAll('-', '')));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;

  const nextMonday = addDays(mondayOf(startDate), 7);
  const exceptions: Record<string, { date: string; kind: 'closed' | 'open'; note: string; windows?: { start: string; end: string }[] }[]> = {
    marta: [{ date: addDays(nextMonday, 3), kind: 'closed', note: 'Training course' }],
    tomas: [{
      date: addDays(nextMonday, 5), kind: 'open', note: 'Saturday clinic',
      windows: [{ start: '09:00', end: '13:00' }],
    }],
    helena: [
      { date: addDays(nextMonday, 14), kind: 'closed', note: 'Annual leave' },
      { date: addDays(nextMonday, 15), kind: 'closed', note: 'Annual leave' },
    ],
  };

  catalog.transaction(() => {
    STAFF.forEach((s, i) => catalog.addStaff({ ...s, sort: i }));
    for (const s of STAFF) {
      catalog.setWeeklyHours(s.id, HOURS[s.id] ?? []);
      for (const e of exceptions[s.id] ?? []) catalog.putException(s.id, e);
    }
    SERVICES.forEach((s, i) => catalog.putService(s, i));
  });

  const calendars = new Map<string, Calendar>(
    catalog.staff().map((s) => [s.id, s.calendar]),
  );

  const people = Array.from({ length: 46 }, (_, i) => {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7) % LAST.length]!;
    const slug = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[^a-z.]/g, '');
    return { name: `${first} ${last}`, email: `${slug}@example.com` };
  });
  const regulars = people.slice(0, 18);

  let clock = now;
  // Messages only for the last two days of activity, so the Outbox is not flooded.
  const compose = composer(catalog);
  const engine = new SchedulingEngine({
    path: file, now: () => clock, outbox: (e) => (clock >= now - 2 * DAY ? compose(e) : null),
  });
  const services = new Map(SERVICES.map((s) => [s.id, s]));

  try {
    // Three courses of treatment, booked as weekly series three weeks ago.
    const courses = [
      { who: regulars[0]!, staff: 'tomas', service: 'follow-up', weekday: 2, time: '10:30' },
      { who: regulars[1]!, staff: 'helena', service: 'rehab', weekday: 3, time: '09:30' },
      { who: regulars[2]!, staff: 'marta', service: 'follow-up', weekday: 1, time: '16:00' },
    ];
    const courseStart = addDays(mondayOf(startDate), -14);
    for (const c of courses) {
      const first = addDays(courseStart, (c.weekday + 6) % 7);
      clock = zonedTimeToUtc(addDays(first, -6), '11:00', TZ);
      const svc = services.get(c.service)!;
      engine.bookSeries(
        expand({
          rule: { frequency: 'weekly', byWeekday: [c.weekday], count: 6 },
          start: zonedTimeToUtc(first, c.time, TZ), timeZone: TZ,
        }),
        {
          resourceId: c.staff, serviceId: c.service, service: engineService(svc),
          calendar: calendars.get(c.staff)!, customerName: c.who.name, customerEmail: c.who.email,
        },
      );
    }

    const weights: [string, number][] = [
      ['follow-up', 50], ['assessment', 18], ['massage', 14], ['rehab', 10], ['review', 8],
    ];
    const weighted = (ids: string[]) => {
      const pool = weights.filter(([id]) => ids.includes(id));
      const total = pool.reduce((n, [, w]) => n + w, 0);
      let r = random() * total;
      for (const [id, w] of pool) if ((r -= w) <= 0) return id;
      return pool[0]![0];
    };

    for (let offset = -21; offset <= 28; offset += 1) {
      const date = addDays(startDate, offset);
      const { from, to } = dayBounds(date);
      // Busy in the past, filling up in the next few days, sparse further out.
      const target = offset <= 0 ? 0.72 : offset <= 3 ? 0.66 : offset <= 10 ? 0.45 : offset <= 20 ? 0.25 : 0.1;

      for (const staff of STAFF) {
        if (LEFT.has(staff.id) && offset > -7) continue;
        const cal = calendars.get(staff.id)!;
        const offered = SERVICES.filter((s) => s.staffIds.includes(staff.id));
        const openMin = openMinutes(cal, date);
        if (!openMin) continue;
        let bookedMin = engine.list({ from, to, resourceId: staff.id, status: 'confirmed' })
          .reduce((n, b) => n + (b.endsAt - b.startsAt) / MIN, 0);

        for (let attempt = 0; attempt < 30 && bookedMin < openMin * target; attempt += 1) {
          const svc = services.get(weighted(offered.map((s) => s.id)))!;
          const firstStart = from + 6 * 3_600_000;
          // When was this made? Somewhere inside the service's booking horizon
          // and outside its notice period, and never in the future.
          const lo = firstStart - (svc.maxAdvanceDays - 1) * DAY;
          const hi = Math.min(now - 10 * MIN, firstStart - svc.minNoticeMin * MIN - 60 * MIN);
          if (lo > hi) continue;
          clock = hi - Math.floor(random() ** 1.6 * Math.min(hi - lo, 18 * DAY));

          const free = engine.available(staff.id, cal, engineService(svc), from, to);
          if (!free.length) continue;
          const slot = pick(free);
          const who = random() < 0.4 ? pick(regulars) : pick(people);
          try {
            const b = engine.book({
              resourceId: staff.id, serviceId: svc.id, service: engineService(svc), calendar: cal,
              customerName: who.name, customerEmail: who.email, startsAt: slot.start,
            });
            bookedMin += svc.durationMin;

            const roll = random();
            const decidedAt = clock + Math.floor(random() * Math.max(0, b.startsAt - clock - 2 * 3_600_000));
            if (roll < 0.09 && decidedAt < now) {
              clock = decidedAt;
              engine.cancel(b.publicToken);
              bookedMin -= svc.durationMin;
            } else if (roll < 0.14 && decidedAt < now) {
              clock = decidedAt;
              const moveTo = pick(engine.available(staff.id, cal, engineService(svc),
                b.startsAt - 2 * DAY, b.startsAt + 3 * DAY));
              if (moveTo) engine.reschedule(b.publicToken, moveTo.start, { calendar: cal, service: engineService(svc) });
            }
          } catch (err) {
            if (!(err instanceof SlotUnavailable)) throw err;
          }
        }
      }
    }
  } finally {
    engine.close();
  }
  for (const id of LEFT) catalog.setStaffActive(id, false);
}

/** Minutes open on a date, by the same rule the engine uses to offer slots. */
function openMinutes(cal: Calendar, date: string): number {
  return windowsForDate(cal, date).reduce((n, w) => n + (w.end - w.start) / MIN, 0);
}
