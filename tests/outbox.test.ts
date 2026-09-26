import { afterEach, describe, expect, it } from 'vitest';
import {
  SchedulingEngine, SlotUnavailable, expand, zonedTimeToUtc,
  type BookingEvent, type Calendar, type EngineOptions, type Service,
} from '../src/index.js';

const LISBON = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);
const cal: Calendar = {
  timeZone: LISBON,
  weekly: [{ weekday: 1, start: '09:00', end: '12:00' }],
  exceptions: [{ date: '2026-03-16', kind: 'closed' }],
};
const svc: Service = { durationMin: 50, stepMin: 60 };
const NOW = at('2026-03-01', '08:00');

let engine: SchedulingEngine | null = null;
afterEach(() => {
  engine?.close();
  engine = null;
});

const describeEvent = (e: BookingEvent) => ({
  to: 'booking' in e ? e.booking.customerEmail : 'ana@example.com',
  subject: e.kind,
  body: 'booking' in e ? `link /b/${e.booking.publicToken}` : `${e.kind} ${e.seriesId}`,
});

function setup(outbox: EngineOptions['outbox'] = describeEvent) {
  engine = new SchedulingEngine({ now: () => NOW, outbox });
  return engine;
}
const req = (startsAt: number, who = 'Ana') => ({
  resourceId: 'dr-lee', serviceId: 'consult', service: svc, calendar: cal,
  customerName: who, customerEmail: `${who.toLowerCase()}@example.com`, startsAt,
});

describe('outbox', () => {
  it('writes one message per change: booked, rescheduled, cancelled', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.reschedule(b.publicToken, at('2026-03-02', '10:00'), { calendar: cal, service: svc });
    e.cancel(b.publicToken);
    const kinds = e.outbox().map((m) => m.kind);
    expect(kinds).toEqual(['cancelled', 'rescheduled', 'booked']);
    const [latest] = e.outbox({ to: 'ANA@example.com', limit: 1 });
    expect(latest).toMatchObject({ bookingId: b.id, to: 'ana@example.com', body: `link /b/${b.publicToken}` });
    expect(e.outboxMessage(latest!.id)?.subject).toBe('cancelled');
  });

  it('finds the messages about one booking, and about its course', () => {
    const e = setup();
    const other = e.book(req(at('2026-03-09', '09:00'), 'Bo'));
    const { seriesId, booked } = e.bookSeries([at('2026-03-02', '10:00'), at('2026-03-23', '10:00')], {
      resourceId: 'dr-lee', serviceId: 'consult', service: svc, calendar: cal,
      customerName: 'Ana', customerEmail: 'ana@example.com',
    });
    e.cancel(booked[1]!.publicToken);
    const mine = e.outbox({ bookingId: booked[1]!.id, seriesId });
    expect(mine.map((m) => m.kind)).toEqual(['cancelled', 'series-booked']);
    expect(e.outbox({ bookingId: other.id }).map((m) => m.kind)).toEqual(['booked']);
  });

  it('tells the composer where a moved booking came from', () => {
    const seen: BookingEvent[] = [];
    const e = setup((ev) => { seen.push(ev); return null; });
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.reschedule(b.publicToken, at('2026-03-02', '11:00'), { calendar: cal, service: svc, resourceId: 'dr-stone' });
    const moved = seen.find((x) => x.kind === 'rescheduled');
    expect(moved).toMatchObject({
      previous: { startsAt: at('2026-03-02', '09:00'), resourceId: 'dr-lee' },
      booking: { startsAt: at('2026-03-02', '11:00'), resourceId: 'dr-stone' },
    });
    // Returning null writes nothing.
    expect(e.outbox()).toHaveLength(0);
  });

  it('writes nothing for a change that did not happen', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    expect(() => e.book(req(at('2026-03-02', '09:00'), 'Bo'))).toThrow(SlotUnavailable);
    expect(() => e.book(req(at('2026-03-02', '22:00'), 'Bo'))).toThrow(SlotUnavailable);
    expect(e.outbox().map((m) => m.to)).toEqual(['ana@example.com']);
  });

  it('does not repeat a cancellation notice when a cancellation is repeated', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.cancel(b.publicToken);
    e.cancel(b.publicToken);
    expect(e.outbox().filter((m) => m.kind === 'cancelled')).toHaveLength(1);
  });

  it('rolls the change back when its message cannot be written', () => {
    const e = setup(() => { throw new Error('template broke'); });
    expect(() => e.book(req(at('2026-03-02', '09:00')))).toThrow('template broke');
    expect(e.list()).toHaveLength(0);
    expect(e.outbox()).toHaveLength(0);
  });

  it('can write several messages for one change', () => {
    const e = setup((ev) => ev.kind === 'booked'
      ? [{ to: ev.booking.customerEmail, subject: 'Booked', body: '' }, { to: 'desk@example.com', subject: 'New booking', body: '' }]
      : null);
    e.book(req(at('2026-03-02', '09:00')));
    expect(e.outbox().map((m) => m.to).sort()).toEqual(['ana@example.com', 'desk@example.com']);
  });
});

describe('series', () => {
  const weekly = (count: number) => expand({
    rule: { frequency: 'weekly', byWeekday: [1], count },
    start: at('2026-03-02', '09:00'), timeZone: LISBON,
  });
  const course = { resourceId: 'dr-lee', serviceId: 'consult', service: svc, calendar: cal, customerName: 'Ana', customerEmail: 'ana@example.com' };

  it('says why each skipped occurrence was skipped', () => {
    const e = setup();
    e.book(req(at('2026-03-09', '09:00'), 'Bo'));
    const { booked, skipped } = e.bookSeries(weekly(4), course);
    expect(booked).toHaveLength(2);
    expect(skipped.map((s) => s.code)).toEqual(['taken', 'not-offered']); // 9 Mar taken, 16 Mar closed
  });

  it('announces a series once, with both lists, not once per occurrence', () => {
    const seen: BookingEvent[] = [];
    const e = setup((ev) => { seen.push(ev); return describeEvent(ev); });
    e.bookSeries(weekly(4), course);
    expect(seen.map((x) => x.kind)).toEqual(['series-booked']);
    const [ev] = seen;
    expect(ev).toMatchObject({ kind: 'series-booked' });
    if (ev?.kind === 'series-booked') {
      expect(ev.booked).toHaveLength(3);
      expect(ev.skipped).toHaveLength(1);
    }
    expect(e.outbox()).toHaveLength(1);
  });

  it('commits the whole series or none of it when the message fails', () => {
    const e = setup((ev) => { if (ev.kind === 'series-booked') throw new Error('no'); return null; });
    expect(() => e.bookSeries(weekly(4), course)).toThrow('no');
    expect(e.list()).toHaveLength(0);
  });

  it('cancels a course from one occurrence onward and leaves the earlier ones', () => {
    const e = setup();
    const { seriesId, booked } = e.bookSeries(weekly(5), course); // 2, 9, 23, 30 Mar (16th closed)
    const cancelled = e.cancelSeriesFrom(seriesId, booked[2]!.startsAt);
    expect(cancelled.map((b) => b.startsAt)).toEqual([at('2026-03-23', '09:00'), at('2026-03-30', '09:00')]);
    expect(e.seriesOf(seriesId).map((b) => b.status)).toEqual(['confirmed', 'confirmed', 'cancelled', 'cancelled']);
    expect(e.outbox({ limit: 1 })[0]?.kind).toBe('series-cancelled');
    // Nothing left to cancel: no second notice.
    expect(e.cancelSeriesFrom(seriesId, booked[2]!.startsAt)).toEqual([]);
    expect(e.outbox().filter((m) => m.kind === 'series-cancelled')).toHaveLength(1);
  });

  it('frees the cancelled occurrences for other people', () => {
    const e = setup();
    const { seriesId } = e.bookSeries(weekly(2), course);
    e.cancelSeriesFrom(seriesId, at('2026-03-09', '00:00'));
    expect(() => e.book(req(at('2026-03-09', '09:00'), 'Bo'))).not.toThrow();
  });
});
