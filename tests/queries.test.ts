import { afterEach, describe, expect, it } from 'vitest';
import {
  SchedulingEngine, SlotUnavailable, zonedTimeToUtc,
  type Calendar, type Service,
} from '../src/index.js';
import { slots } from '../src/availability.js';

const LISBON = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);

const cal: Calendar = {
  timeZone: LISBON,
  weekly: [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 2, start: '09:00', end: '12:00' },
  ],
};
const svc: Service = { durationMin: 50, stepMin: 60 };

let clock = at('2026-03-01', '08:00');
let engine: SchedulingEngine | null = null;
afterEach(() => {
  engine?.close();
  engine = null;
  clock = at('2026-03-01', '08:00');
});

function setup() {
  let n = 0;
  engine = new SchedulingEngine({ now: () => clock, newToken: () => `tok-${++n}` });
  return engine;
}

const req = (startsAt: number, who = 'Ana', resourceId = 'dr-lee', serviceId = 'consult') => ({
  resourceId, serviceId, service: svc, calendar: cal,
  customerName: who, customerEmail: `${who.toLowerCase()}@example.com`,
  startsAt,
});

describe('list', () => {
  it('returns bookings in start order regardless of insertion order', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '11:00'), 'Cy'));
    e.book(req(at('2026-03-02', '09:00'), 'Ana'));
    e.book(req(at('2026-03-02', '10:00'), 'Bo'));
    expect(e.list().map((b) => b.customerName)).toEqual(['Ana', 'Bo', 'Cy']);
    expect(e.list({ order: 'desc' }).map((b) => b.customerName)).toEqual(['Cy', 'Bo', 'Ana']);
  });

  it('selects by start time, half-open, so a day boundary never counts a booking twice', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    e.book(req(at('2026-03-03', '09:00'), 'Bo'));
    const monday = e.list({ from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00') });
    const tuesday = e.list({ from: at('2026-03-03', '00:00'), to: at('2026-03-04', '00:00') });
    expect(monday.map((b) => b.customerName)).toEqual(['Ana']);
    expect(tuesday.map((b) => b.customerName)).toEqual(['Bo']);
    // A booking starting exactly at `to` belongs to the next window.
    expect(e.list({ from: at('2026-03-02', '00:00'), to: at('2026-03-03', '09:00') })).toHaveLength(1);
  });

  it('includes cancellations unless asked not to', () => {
    const e = setup();
    const a = e.book(req(at('2026-03-02', '09:00')));
    e.book(req(at('2026-03-02', '10:00'), 'Bo'));
    e.cancel(a.publicToken);
    expect(e.list()).toHaveLength(2);
    expect(e.list({ status: 'confirmed' }).map((b) => b.customerName)).toEqual(['Bo']);
    expect(e.list({ status: 'cancelled' }).map((b) => b.customerName)).toEqual(['Ana']);
  });

  it('filters by resource, service and customer', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00'), 'Ana', 'dr-lee', 'consult'));
    e.book(req(at('2026-03-02', '09:00'), 'Bo', 'dr-stone', 'consult'));
    e.book(req(at('2026-03-02', '10:00'), 'Ana', 'dr-stone', 'massage'));
    expect(e.list({ resourceId: 'dr-stone' })).toHaveLength(2);
    expect(e.list({ serviceId: 'massage' }).map((b) => b.customerName)).toEqual(['Ana']);
    expect(e.list({ customerEmail: 'ana@example.com' })).toHaveLength(2);
  });

  it('matches customer email case-insensitively', () => {
    const e = setup();
    e.book({ ...req(at('2026-03-02', '09:00')), customerEmail: 'Ana@Example.com' });
    expect(e.list({ customerEmail: 'ana@example.COM' })).toHaveLength(1);
  });

  it('honours a limit and refuses a nonsensical one', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    e.book(req(at('2026-03-02', '10:00'), 'Bo'));
    expect(e.list({ limit: 1 })).toHaveLength(1);
    expect(() => e.list({ limit: -1 })).toThrow(RangeError);
    expect(() => e.list({ limit: 1.5 })).toThrow(RangeError);
  });

  it('treats filter values as data, not SQL', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    expect(e.list({ resourceId: "dr-lee' OR '1'='1" })).toHaveLength(0);
    expect(e.list()).toHaveLength(1);
  });
});

describe('byId', () => {
  it('finds a booking by row id and returns null for an unknown one', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    expect(e.byId(b.id)?.publicToken).toBe(b.publicToken);
    expect(e.byId(9999)).toBeNull();
  });
});

describe('customers', () => {
  it('derives one entry per person from their bookings', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00'), 'Ana'));
    const second = e.book(req(at('2026-03-03', '09:00'), 'Ana'));
    e.book(req(at('2026-03-02', '10:00'), 'Bo'));
    e.cancel(second.publicToken);

    const list = e.customers();
    expect(list).toHaveLength(2);
    const ana = list.find((c) => c.email === 'ana@example.com')!;
    expect(ana).toMatchObject({ total: 2, confirmed: 1, cancelled: 1, upcoming: 1 });
    expect(ana.firstStartsAt).toBe(at('2026-03-02', '09:00'));
    expect(ana.nextStartsAt).toBe(at('2026-03-02', '09:00'));
  });

  it('groups by email regardless of case and keeps the latest name', () => {
    const e = setup();
    e.book({ ...req(at('2026-03-02', '09:00')), customerName: 'Ana F', customerEmail: 'ANA@example.com' });
    clock += 60_000;
    e.book({ ...req(at('2026-03-02', '10:00')), customerName: 'Ana Ferreira', customerEmail: 'ana@example.com' });
    const [only, ...rest] = e.customers();
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ email: 'ana@example.com', name: 'Ana Ferreira', total: 2 });
  });

  it('counts only future confirmed bookings as upcoming', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    e.book(req(at('2026-03-03', '09:00')));
    clock = at('2026-03-02', '12:00');
    const [ana] = e.customers();
    expect(ana).toMatchObject({
      upcoming: 1, nextStartsAt: at('2026-03-03', '09:00'), lastSeenAt: at('2026-03-02', '09:00'),
    });
  });

  it('lists people already seen before people not yet seen, most recent first', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00'), 'Ana'));
    e.book(req(at('2026-03-02', '10:00'), 'Bo'));
    e.book(req(at('2026-03-03', '09:00'), 'Cy'));
    const cancelled = e.book(req(at('2026-03-02', '11:00'), 'Di'));
    e.cancel(cancelled.publicToken);
    clock = at('2026-03-02', '12:00');
    // A cancelled visit is not a visit: Di has not been seen.
    expect(e.customers().map((c) => c.name)).toEqual(['Bo', 'Ana', 'Cy', 'Di']);
    expect(e.customers().find((c) => c.name === 'Di')?.lastSeenAt).toBeNull();
  });
});

describe('why a slot is unavailable', () => {
  it('says "taken" when the rules offer the time but someone holds it', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00'), 'Ana'));
    try {
      e.book(req(at('2026-03-02', '09:00'), 'Bo'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SlotUnavailable);
      expect((err as SlotUnavailable).reason).toBe('taken');
    }
  });

  it('says "not-offered" when the rules never offered the time', () => {
    const e = setup();
    try {
      e.book(req(at('2026-03-02', '22:00')));
      expect.unreachable();
    } catch (err) {
      expect((err as SlotUnavailable).reason).toBe('not-offered');
    }
    const b = e.book(req(at('2026-03-02', '09:00')));
    expect(() => e.reschedule(b.publicToken, at('2026-03-02', '09:30'), { calendar: cal, service: svc }))
      .toThrow(expect.objectContaining({ reason: 'not-offered' }));
  });

  it('defaults to "taken" for code that constructs the error with a message only', () => {
    expect(new SlotUnavailable('x').reason).toBe('taken');
  });
});

describe('availability entry point', () => {
  it('exposes the pure slot maths without the database', async () => {
    // The browser imports this entry point, so it must not pull in the SQLite driver.
    const mod = await import('../src/availability.js');
    expect(mod.slots).toBe(slots);
    const src = (await import('node:fs')).readFileSync(
      new URL('../src/availability.ts', import.meta.url), 'utf8',
    );
    expect(src).not.toMatch(/^import .*better-sqlite3/m);
  });
});
