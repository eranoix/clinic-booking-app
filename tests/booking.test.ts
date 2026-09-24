import { afterEach, describe, expect, it } from 'vitest';
import {
  BookingNotFound, SchedulingEngine, SlotUnavailable, expand, zonedTimeToUtc,
  type Calendar, type Service,
} from '../src/index.js';

const LISBON = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);

const cal: Calendar = {
  timeZone: LISBON,
  weekly: [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 3, start: '09:00', end: '12:00' },
  ],
};
const svc: Service = { durationMin: 50, stepMin: 60 };
const NOW = at('2026-03-01', '08:00');

let engine: SchedulingEngine | null = null;
afterEach(() => {
  engine?.close();
  engine = null;
});

function setup() {
  let n = 0;
  engine = new SchedulingEngine({ now: () => NOW, newToken: () => `tok-${++n}` });
  return engine;
}

const req = (startsAt: number, who = 'Ana') => ({
  resourceId: 'dr-lee', serviceId: 'consult', service: svc, calendar: cal,
  customerName: who, customerEmail: `${who.toLowerCase()}@example.com`,
  startsAt,
});

describe('booking', () => {
  it('takes a slot and hands back an unguessable link token', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    expect(b.status).toBe('confirmed');
    // Sequential ids in a URL let anyone enumerate other people's
    // appointments, and the link has to work without a login.
    expect(b.publicToken).not.toBe(String(b.id));
    expect(e.byToken(b.publicToken)?.id).toBe(b.id);
  });

  it('refuses a second booking of the same slot', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00'), 'Ana'));
    expect(() => e.book(req(at('2026-03-02', '09:00'), 'Bo')))
      .toThrow(SlotUnavailable);
  });

  it('refuses an overlapping slot even when the start differs', () => {
    // A 50-minute appointment at 09:00 and one at 09:30 do not share a start,
    // so a uniqueness constraint alone would let both through.
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    const overlapping = { ...req(at('2026-03-02', '09:30')),
      service: { durationMin: 50, stepMin: 30 } };
    expect(() => e.book(overlapping)).toThrow(SlotUnavailable);
  });

  it('refuses a time the rules never offered', () => {
    // Without this, a caller can post any instant and book outside opening
    // hours entirely, bypassing the calendar.
    const e = setup();
    expect(() => e.book(req(at('2026-03-02', '22:00')))).toThrow(SlotUnavailable);
    expect(() => e.book(req(at('2026-03-03', '09:00')))).toThrow(SlotUnavailable);
  });

  it('removes a taken slot from what is offered next', () => {
    const e = setup();
    const before = e.available('dr-lee', cal, svc, at('2026-03-02', '00:00'), at('2026-03-03', '00:00'));
    e.book(req(at('2026-03-02', '10:00')));
    const after = e.available('dr-lee', cal, svc, at('2026-03-02', '00:00'), at('2026-03-03', '00:00'));
    expect(after).toHaveLength(before.length - 1);
  });

  it('keeps resources independent', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    const other = { ...req(at('2026-03-02', '09:00'), 'Bo'), resourceId: 'dr-stone' };
    expect(() => e.book(other)).not.toThrow();
  });
});

describe('reschedule', () => {
  it('moves the appointment and keeps the link working', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    const moved = e.reschedule(b.publicToken, at('2026-03-02', '11:00'), { calendar: cal, service: svc });

    expect(moved.startsAt).toBe(at('2026-03-02', '11:00'));
    // The token is preserved: the link already in their email keeps working.
    expect(moved.publicToken).toBe(b.publicToken);
    expect(e.byToken(b.publicToken)?.startsAt).toBe(at('2026-03-02', '11:00'));
  });

  it('leaves the original booking intact when the new time is taken', () => {
    // A reschedule that cannot land must not destroy the appointment the
    // person already had -- that is worse than the failure they were fixing.
    const e = setup();
    const mine = e.book(req(at('2026-03-02', '09:00'), 'Ana'));
    e.book(req(at('2026-03-02', '11:00'), 'Bo'));

    expect(() => e.reschedule(mine.publicToken, at('2026-03-02', '11:00'), { calendar: cal, service: svc }))
      .toThrow(SlotUnavailable);
    const still = e.byToken(mine.publicToken)!;
    expect(still.status).toBe('confirmed');
    expect(still.startsAt).toBe(at('2026-03-02', '09:00'));
  });

  it('allows rescheduling onto its own current slot', () => {
    // The booking must not be treated as a conflict with itself.
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    expect(() => e.reschedule(b.publicToken, at('2026-03-02', '09:00'), { calendar: cal, service: svc }))
      .not.toThrow();
  });

  it('refuses an unknown link', () => {
    const e = setup();
    expect(() => e.reschedule('nope', at('2026-03-02', '09:00'), { calendar: cal, service: svc }))
      .toThrow(BookingNotFound);
  });
});

describe('cancel', () => {
  it('marks the booking and frees the slot', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.cancel(b.publicToken);

    expect(e.byToken(b.publicToken)?.status).toBe('cancelled');
    // The row is kept, not deleted: "was there ever an appointment?" is asked
    // precisely when something has gone wrong.
    expect(e.byToken(b.publicToken)).not.toBeNull();
    expect(() => e.book(req(at('2026-03-02', '09:00'), 'Bo'))).not.toThrow();
  });

  it('is safe to repeat', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.cancel(b.publicToken);
    expect(() => e.cancel(b.publicToken)).not.toThrow();
  });
});

describe('series', () => {
  it('books what it can and reports what it could not', () => {
    // Refusing the whole series because week three clashes helps nobody;
    // dropping week three silently is worse. The caller gets both lists.
    const e = setup();
    e.book(req(at('2026-03-16', '09:00'), 'Bo'));

    const occurrences = expand({
      rule: { frequency: 'weekly', byWeekday: [1], count: 4 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    });
    const result = e.bookSeries(occurrences, {
      resourceId: 'dr-lee', serviceId: 'consult', service: svc, calendar: cal,
      customerName: 'Ana', customerEmail: 'ana@example.com',
    });

    expect(result.booked).toHaveLength(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.startsAt).toBe(at('2026-03-16', '09:00'));
    expect(e.seriesOf(result.seriesId)).toHaveLength(3);
  });

  it('lets one occurrence be cancelled without touching the rest', () => {
    const e = setup();
    const occurrences = expand({
      rule: { frequency: 'weekly', byWeekday: [1], count: 3 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    });
    const { seriesId, booked } = e.bookSeries(occurrences, {
      resourceId: 'dr-lee', serviceId: 'consult', service: svc, calendar: cal,
      customerName: 'Ana', customerEmail: 'ana@example.com',
    });
    e.cancel(booked[1]!.publicToken);

    const live = e.seriesOf(seriesId).filter((b) => b.status === 'confirmed');
    expect(live).toHaveLength(2);
  });
});
