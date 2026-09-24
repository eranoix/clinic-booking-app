import { describe, expect, it } from 'vitest';
import { describe as describeRule, expand, zonedTimeToUtc } from '../src/index.js';

const LISBON = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);
const hour = (ts: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: LISBON, hour: '2-digit', hour12: false })
    .format(new Date(ts));
const day = (ts: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: LISBON, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ts));

describe('daily', () => {
  it('counts occurrences, not days', () => {
    const out = expand({
      rule: { frequency: 'daily', count: 3 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    });
    expect(out.map(day)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
  });

  it('honours an interval', () => {
    const out = expand({
      rule: { frequency: 'daily', interval: 3, count: 3 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    });
    expect(out.map(day)).toEqual(['2026-03-02', '2026-03-05', '2026-03-08']);
  });
});

describe('weekly', () => {
  it('expands every requested weekday', () => {
    const out = expand({
      rule: { frequency: 'weekly', byWeekday: [1, 3], count: 4 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON, // a Monday
    });
    expect(out.map(day)).toEqual(
      ['2026-03-02', '2026-03-04', '2026-03-09', '2026-03-11'],
    );
  });

  it('skips exception dates without consuming the count', () => {
    // A holiday should not shorten the series; the person asked for four.
    const out = expand({
      rule: {
        frequency: 'weekly', byWeekday: [1], count: 4,
        exceptDates: ['2026-03-09'],
      },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    });
    expect(out.map(day)).toEqual(
      ['2026-03-02', '2026-03-16', '2026-03-23', '2026-03-30'],
    );
  });

  it('keeps the local hour across a daylight-saving boundary', () => {
    // The failure this guards: adding 7 x 86_400_000 lands the series an hour
    // early or late after the clocks move, and nobody notices until someone
    // misses an appointment.
    const out = expand({
      rule: { frequency: 'weekly', byWeekday: [1], count: 6 },
      start: at('2026-03-09', '09:00'), timeZone: LISBON,
    });
    expect(out.map(hour)).toEqual(['09', '09', '09', '09', '09', '09']);
    expect(out.map(day)).toContain('2026-03-30'); // after the transition
  });
});

describe('monthly', () => {
  it('skips months that are too short rather than clamping', () => {
    // Clamping the 31st to the 28th invents an occurrence nobody asked for,
    // and it shows up as a stranger in someone's calendar.
    const out = expand({
      rule: { frequency: 'monthly', byMonthDay: [31], count: 4 },
      start: at('2026-01-31', '09:00'), timeZone: LISBON,
    });
    expect(out.map(day)).toEqual(
      ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'],
    );
    expect(out.map(day).some((d) => d.startsWith('2026-02'))).toBe(false);
  });

  it('defaults to the start day of month', () => {
    const out = expand({
      rule: { frequency: 'monthly', count: 3 },
      start: at('2026-03-15', '09:00'), timeZone: LISBON,
    });
    expect(out.map(day)).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
  });
});

describe('bounds', () => {
  it('stops at until', () => {
    const out = expand({
      rule: { frequency: 'daily', until: at('2026-03-04', '23:59') },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    });
    expect(out).toHaveLength(3);
  });

  it('caps an unbounded rule instead of running forever', () => {
    // An unbounded expansion fails as a process that stops responding, which
    // is harder to diagnose than one that reports a limit.
    const out = expand({
      rule: { frequency: 'daily' },
      start: at('2026-03-02', '09:00'), timeZone: LISBON, limit: 10,
    });
    expect(out).toHaveLength(10);
  });

  it('filters to a requested window', () => {
    const out = expand({
      rule: { frequency: 'daily', count: 30 },
      start: at('2026-03-01', '09:00'), timeZone: LISBON,
      from: at('2026-03-10', '00:00'), to: at('2026-03-12', '23:59'),
    });
    expect(out.map(day)).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
  });
});

describe('describe', () => {
  it('reads as a sentence for a confirmation screen', () => {
    expect(describeRule({ frequency: 'weekly', byWeekday: [1, 3], count: 8 }))
      .toBe('Every week on Mon, Wed, 8 times');
    expect(describeRule({ frequency: 'daily', interval: 2 }))
      .toBe('Every 2 days');
  });
});

describe('regressions', () => {
  it('count of zero yields nothing', () => {
    // Found by an adversarial probe: push happened before the budget check,
    // so a count of 0 returned one occurrence. That surfaces as a single
    // unexplained appointment rather than as an error.
    expect(expand({
      rule: { frequency: 'daily', count: 0 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    })).toEqual([]);
  });

  it('refuses a weekday outside 0-6 instead of inventing dates', () => {
    // Weekday 9 used to become "two days into next week" by arithmetic. A
    // wrong answer delivered confidently is worse than a refusal.
    expect(() => expand({
      rule: { frequency: 'weekly', byWeekday: [9], count: 2 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    })).toThrow(/byWeekday/);
  });

  it('refuses a month day outside 1-31', () => {
    expect(() => expand({
      rule: { frequency: 'monthly', byMonthDay: [32], count: 1 },
      start: at('2026-03-02', '09:00'), timeZone: LISBON,
    })).toThrow(/byMonthDay/);
  });
});
