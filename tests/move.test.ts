import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BookingNotFound, SchedulingEngine, SlotUnavailable, zonedTimeToUtc,
  type Calendar, type Service,
} from '../src/index.js';

const LISBON = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);
const mondays: Calendar = { timeZone: LISBON, weekly: [{ weekday: 1, start: '09:00', end: '12:00' }] };
const tuesdays: Calendar = { timeZone: LISBON, weekly: [{ weekday: 2, start: '09:00', end: '12:00' }] };
const svc: Service = { durationMin: 50, stepMin: 60, bufferAfterMin: 10 };
const NOW = at('2026-03-01', '08:00');

const open: SchedulingEngine[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function engine(file?: string) {
  const e = new SchedulingEngine({ now: () => NOW, ...(file ? { path: file } : {}) });
  open.push(e);
  return e;
}
function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-move-'));
  dirs.push(dir);
  return path.join(dir, 'clinic.db');
}
const req = (resourceId: string, calendar: Calendar, startsAt: number, who = 'Ana') => ({
  resourceId, serviceId: 'consult', service: svc, calendar,
  customerName: who, customerEmail: `${who.toLowerCase()}@example.com`, startsAt,
});

describe('moving to another resource', () => {
  it('changes the resource, the time, or both, keeping the id and the link', () => {
    const e = engine();
    const b = e.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    const moved = e.reschedule(b.publicToken, at('2026-03-03', '10:00'), {
      calendar: tuesdays, service: svc, resourceId: 'dr-stone',
    });
    expect(moved).toMatchObject({
      id: b.id, publicToken: b.publicToken, resourceId: 'dr-stone', startsAt: at('2026-03-03', '10:00'),
    });
    // Same time, other person: also a move.
    const same = e.reschedule(b.publicToken, at('2026-03-03', '10:00'), {
      calendar: tuesdays, service: svc, resourceId: 'dr-stone',
    });
    expect(same.resourceId).toBe('dr-stone');
  });

  it('frees the old resource and occupies the new one, with exactly one row throughout', () => {
    const e = engine();
    const b = e.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    e.reschedule(b.publicToken, at('2026-03-02', '09:00'), {
      calendar: mondays, service: svc, resourceId: 'dr-stone',
    });
    expect(e.list({ customerEmail: 'ana@example.com' })).toHaveLength(1);
    expect(e.list({ resourceId: 'dr-lee', status: 'confirmed' })).toHaveLength(0);
    expect(e.list({ resourceId: 'dr-stone', status: 'confirmed' })).toHaveLength(1);
    expect(() => e.book(req('dr-lee', mondays, at('2026-03-02', '09:00'), 'Bo'))).not.toThrow();
    expect(() => e.book(req('dr-stone', mondays, at('2026-03-02', '09:00'), 'Cy'))).toThrow(SlotUnavailable);
  });

  it('is checked against the new resource’s calendar, not the old one', () => {
    const e = engine();
    const b = e.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    // Monday is not in the Tuesday calendar.
    expect(() => e.reschedule(b.publicToken, at('2026-03-02', '10:00'), {
      calendar: tuesdays, service: svc, resourceId: 'dr-stone',
    })).toThrow(expect.objectContaining({ reason: 'not-offered' }));
    expect(e.byToken(b.publicToken)).toMatchObject({ resourceId: 'dr-lee', startsAt: at('2026-03-02', '09:00') });
  });

  it('refuses a time the new resource already holds, including its buffer, and leaves the booking alone', () => {
    const e = engine();
    const mine = e.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    e.book(req('dr-stone', mondays, at('2026-03-02', '10:00'), 'Bo'));
    for (const t of ['10:00']) {
      expect(() => e.reschedule(mine.publicToken, at('2026-03-02', t), {
        calendar: mondays, service: { ...svc, stepMin: 60 }, resourceId: 'dr-stone',
      })).toThrow(expect.objectContaining({ reason: 'taken' }));
    }
    expect(e.byToken(mine.publicToken)).toMatchObject({ resourceId: 'dr-lee', status: 'confirmed' });
  });

  it('loses cleanly to another connection that took the time first', () => {
    // Two connections on one file: the second books the target time before
    // the first moves a booking there.
    const file = tempFile();
    const desk = engine(file);
    const web = engine(file);
    const mine = desk.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    const seen = desk.available('dr-stone', mondays, svc, at('2026-03-02', '00:00'), at('2026-03-03', '00:00'));
    expect(seen.map((s) => s.start)).toContain(at('2026-03-02', '09:00'));

    web.book(req('dr-stone', mondays, at('2026-03-02', '09:00'), 'Bo'));

    expect(() => desk.reschedule(mine.publicToken, at('2026-03-02', '09:00'), {
      calendar: mondays, service: svc, resourceId: 'dr-stone',
    })).toThrow(SlotUnavailable);
    // Nothing moved, nothing doubled: one booking each, where they were.
    const raw = new Database(file, { readonly: true });
    try {
      const rows = raw.prepare("SELECT resource_id, customer_name FROM bookings WHERE status = 'confirmed' ORDER BY id").all();
      expect(rows).toEqual([
        { resource_id: 'dr-lee', customer_name: 'Ana' },
        { resource_id: 'dr-stone', customer_name: 'Bo' },
      ]);
    } finally {
      raw.close();
    }
  });

  it('does not resurrect a booking another connection cancelled first', () => {
    const file = tempFile();
    const desk = engine(file);
    const web = engine(file);
    const b = desk.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    web.cancel(b.publicToken);
    expect(() => desk.reschedule(b.publicToken, at('2026-03-02', '10:00'), {
      calendar: mondays, service: svc, resourceId: 'dr-stone',
    })).toThrow(BookingNotFound);
    expect(desk.byToken(b.publicToken)?.status).toBe('cancelled');
  });

  it('backs up the check with the unique index when a row arrives behind it', () => {
    // Simulate the one race a single connection cannot see by planting the
    // conflicting row directly, bypassing the engine's check: the database
    // itself must still refuse two confirmed bookings at one start.
    const file = tempFile();
    const e = engine(file);
    const mine = e.book(req('dr-lee', mondays, at('2026-03-02', '09:00')));
    const raw = new Database(file);
    raw.prepare(`INSERT INTO bookings (public_token, resource_id, service_id, customer_name, customer_email,
      starts_at, ends_at, held_until, status, created_at, updated_at)
      VALUES ('planted', 'dr-stone', 'consult', 'Bo', 'bo@example.com', ?, ?, ?, 'confirmed', 0, 0)`)
      // Zero length, so the overlap check cannot see it: only the index can.
      .run(at('2026-03-02', '10:00'), at('2026-03-02', '10:00'), at('2026-03-02', '10:00'));
    raw.close();
    expect(() => e.reschedule(mine.publicToken, at('2026-03-02', '10:00'), {
      calendar: mondays, service: { ...svc, bufferAfterMin: 0 }, resourceId: 'dr-stone',
    })).toThrow(SlotUnavailable);
    expect(e.byToken(mine.publicToken)?.resourceId).toBe('dr-lee');
  });
});
