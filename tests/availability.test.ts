import { describe, expect, it } from 'vitest';
import {
  overlaps, slots, windowsForDate, zonedTimeToUtc,
  type Calendar, type Service,
} from '../src/index.js';

const LISBON = 'Europe/Lisbon';

const cal: Calendar = {
  timeZone: LISBON,
  weekly: [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 1, start: '14:00', end: '17:00' },
    { weekday: 3, start: '09:00', end: '13:00' },
  ],
};

const svc: Service = { durationMin: 50, stepMin: 60 };

const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);

describe('windows', () => {
  it('returns the weekly rules for that weekday', () => {
    // 2026-03-02 is a Monday.
    const w = windowsForDate(cal, '2026-03-02');
    expect(w).toHaveLength(2);
    expect(w[0]!.start).toBe(at('2026-03-02', '09:00'));
  });

  it('returns nothing on a weekday with no rule', () => {
    expect(windowsForDate(cal, '2026-03-03')).toHaveLength(0); // Tuesday
  });

  it('a closed exception removes the day', () => {
    const c = { ...cal, exceptions: [{ date: '2026-03-02', kind: 'closed' as const }] };
    expect(windowsForDate(c, '2026-03-02')).toHaveLength(0);
  });

  it('an open exception REPLACES the weekly rules for that date', () => {
    const c: Calendar = {
      ...cal,
      exceptions: [{
        date: '2026-03-07', kind: 'open',
        windows: [{ start: '09:00', end: '13:00' }],
      }],
    };
    const w = windowsForDate(c, '2026-03-07'); // a Saturday, normally closed
    expect(w).toHaveLength(1);
    expect(w[0]!.start).toBe(at('2026-03-07', '09:00'));
  });
});

describe('slot generation', () => {
  it('lays slots on the step, not on the duration', () => {
    const s = slots({
      calendar: cal, service: svc,
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      now: at('2026-01-01', '00:00'),
    });
    expect(s).toHaveLength(6); // 09,10,11 + 14,15,16
    expect(s[1]!.start - s[0]!.start).toBe(60 * 60_000);
    expect(s[0]!.end - s[0]!.start).toBe(50 * 60_000);
  });

  it('never offers a slot that would run past closing', () => {
    const long: Service = { durationMin: 90, stepMin: 60 };
    const s = slots({
      calendar: cal, service: long,
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      now: at('2026-01-01', '00:00'),
    });
    // 09:00 and 10:00 fit before 12:00; 11:00 would end at 12:30.
    const morning = s.filter((x) => x.start < at('2026-03-02', '13:00'));
    expect(morning).toHaveLength(2);
  });

  it('respects minimum notice', () => {
    const s = slots({
      calendar: cal, service: { ...svc, minNoticeMin: 120 },
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      now: at('2026-03-02', '09:30'),
    });
    expect(s[0]!.start).toBe(at('2026-03-02', '14:00'));
  });

  it('respects the booking horizon', () => {
    const s = slots({
      calendar: cal, service: { ...svc, maxAdvanceDays: 1 },
      from: at('2026-03-02', '00:00'), to: at('2026-03-05', '00:00'),
      now: at('2026-03-02', '08:00'),
    });
    expect(s.every((x) => x.start <= at('2026-03-03', '08:00'))).toBe(true);
  });

  it('removes slots that collide with existing bookings', () => {
    const s = slots({
      calendar: cal, service: svc,
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      busy: [{ start: at('2026-03-02', '10:00'), end: at('2026-03-02', '10:50') }],
      now: at('2026-01-01', '00:00'),
    });
    expect(s.some((x) => x.start === at('2026-03-02', '10:00'))).toBe(false);
    expect(s).toHaveLength(5);
  });

  it('reserves the buffer without showing it as bookable time', () => {
    const s = slots({
      calendar: cal, service: { durationMin: 50, stepMin: 60, bufferAfterMin: 20 },
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      busy: [{ start: at('2026-03-02', '10:05'), end: at('2026-03-02', '10:15') }],
      now: at('2026-01-01', '00:00'),
    });
    // 09:00 + 50min ends 09:50, buffer to 10:10, which now overlaps the block.
    expect(s.some((x) => x.start === at('2026-03-02', '09:00'))).toBe(false);
  });
});

describe('boundaries', () => {
  it('treats touching intervals as not overlapping', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe('daylight saving', () => {
  it('keeps local opening hours across a spring-forward transition', () => {
    // Lisbon moves its clocks on 2026-03-29; 09:00 must stay 09:00 local.
    const before = windowsForDate(cal, '2026-03-25')[0]!; // Wednesday
    const after = windowsForDate(cal, '2026-04-01')[0]!;  // Wednesday
    const hourInLisbon = (ts: number) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: LISBON, hour: '2-digit', hour12: false,
      }).format(new Date(ts));

    expect(hourInLisbon(before.start)).toBe('09');
    expect(hourInLisbon(after.start)).toBe('09');
    // ...and they are NOT a whole number of 24-hour days apart.
    expect((after.start - before.start) % 86_400_000).not.toBe(0);
  });
});

describe('regressions', () => {
  it('refuses a zero step instead of looping until memory runs out', () => {
    // A zero step would never advance the generation loop.
    expect(() => slots({
      calendar: cal, service: { durationMin: 50, stepMin: 0 },
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      now: at('2026-01-01', '00:00'),
    })).toThrow(/stepMin/);
  });

  it('refuses a zero or negative duration', () => {
    expect(() => slots({
      calendar: cal, service: { durationMin: 0, stepMin: 60 },
      from: at('2026-03-02', '00:00'), to: at('2026-03-03', '00:00'),
      now: at('2026-01-01', '00:00'),
    })).toThrow(/durationMin/);
  });
});
