import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SchedulingEngine, SlotUnavailable, zonedTimeToUtc,
  type Calendar, type Service,
} from '../src/index.js';

const LISBON = 'Europe/Lisbon';
const at = (d: string, t: string) => zonedTimeToUtc(d, t, LISBON);

const cal: Calendar = { timeZone: LISBON, weekly: [{ weekday: 1, start: '09:00', end: '12:00' }] };
// 45 minutes with 15 kept clear afterwards, offered every quarter hour: the
// grid alone would allow back-to-back appointments, so only the buffer can
// keep them apart.
const svc: Service = { durationMin: 45, stepMin: 15, bufferAfterMin: 15 };
const NOW = at('2026-03-01', '08:00');

let engine: SchedulingEngine | null = null;
afterEach(() => {
  engine?.close();
  engine = null;
});

const setup = () => (engine = new SchedulingEngine({ now: () => NOW }));
const req = (startsAt: number, service: Service = svc) => ({
  resourceId: 'dr-lee', serviceId: 'consult', service, calendar: cal,
  customerName: 'Ana', customerEmail: 'ana@example.com', startsAt,
});

describe('buffer after', () => {
  it('is held by the booking: the time after it is not offered to the next person', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    const free = e.available('dr-lee', cal, svc, at('2026-03-02', '00:00'), at('2026-03-03', '00:00'))
      .map((s) => s.start);
    expect(free).not.toContain(at('2026-03-02', '09:45'));
    expect(free).toContain(at('2026-03-02', '10:00'));
  });

  it('is enforced by book(), not only hidden by available()', () => {
    // A caller posting 09:45 directly must be refused just as if it had
    // picked it from the list.
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    expect(() => e.book(req(at('2026-03-02', '09:45')))).toThrow(SlotUnavailable);
    expect(() => e.book(req(at('2026-03-02', '10:00')))).not.toThrow();
  });

  it('gives the same answer whichever booking was made first', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:45')));
    // 09:00 would end at 09:45 and need until 10:00 clear.
    expect(() => e.book(req(at('2026-03-02', '09:00')))).toThrow(SlotUnavailable);
    expect(() => e.book(req(at('2026-03-02', '10:45')))).not.toThrow();
  });

  it('holds the buffer of the service that needs it, whatever the next booking is', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '09:00')));
    const noBuffer: Service = { durationMin: 15, stepMin: 15 };
    expect(() => e.book(req(at('2026-03-02', '09:45'), noBuffer))).toThrow(SlotUnavailable);
    expect(() => e.book(req(at('2026-03-02', '10:00'), noBuffer))).not.toThrow();
  });

  it('sees a booking just past the window when the last slot’s buffer would reach it', () => {
    const e = setup();
    e.book(req(at('2026-03-02', '10:00')));
    // 09:00-09:45 plus its buffer runs to 10:00: touching, allowed.
    // 09:15-10:00 plus its buffer runs to 10:15: clashes with 10:00.
    const free = e.available('dr-lee', cal, svc, at('2026-03-02', '09:00'), at('2026-03-02', '10:00'))
      .map((s) => s.start);
    expect(free).toEqual([at('2026-03-02', '09:00')]);
  });

  it('moves with a reschedule', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.reschedule(b.publicToken, at('2026-03-02', '10:00'), { calendar: cal, service: svc });
    expect(() => e.book(req(at('2026-03-02', '09:00')))).not.toThrow();
    expect(() => e.book(req(at('2026-03-02', '10:45')))).toThrow(SlotUnavailable);
  });

  it('is released by a cancellation', () => {
    const e = setup();
    const b = e.book(req(at('2026-03-02', '09:00')));
    e.cancel(b.publicToken);
    expect(() => e.book(req(at('2026-03-02', '09:45')))).not.toThrow();
  });
});

describe('an existing database', () => {
  it('is upgraded in place, and old rows hold exactly their appointment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-'));
    const file = path.join(dir, 'old.db');
    try {
      // A table without held_until, as older databases have.
      const old = new Database(file);
      old.exec(`CREATE TABLE bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_token TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL, service_id TEXT NOT NULL, customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed', series_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      old.prepare(`INSERT INTO bookings (public_token, resource_id, service_id, customer_name,
        customer_email, starts_at, ends_at, created_at, updated_at)
        VALUES ('t1', 'dr-lee', 'consult', 'Ana', 'ana@example.com', ?, ?, 0, 0)`)
        .run(at('2026-03-02', '09:00'), at('2026-03-02', '09:45'));
      old.close();

      engine = new SchedulingEngine({ path: file, now: () => NOW });
      expect(engine.busy('dr-lee', at('2026-03-02', '00:00'), at('2026-03-03', '00:00')))
        .toEqual([{ start: at('2026-03-02', '09:00'), end: at('2026-03-02', '09:45') }]);
      expect(engine.byToken('t1')?.status).toBe('confirmed');
      // New bookings hold their buffer as usual.
      engine.book(req(at('2026-03-02', '10:00')));
      expect(() => engine!.book(req(at('2026-03-02', '10:45')))).toThrow(SlotUnavailable);
    } finally {
      engine?.close();
      engine = null;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
