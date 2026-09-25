/**
 * The clinic's catalogue: staff, their weekly hours and date exceptions, and
 * the services offered.
 *
 * Why this lives in the web app and not in the engine
 * ---------------------------------------------------
 * The engine's contract is that rules are VALUES passed into every call:
 * `available(resource, calendar, service, …)`, `book({ calendar, service, … })`.
 * That is what lets it be tested with no fixtures, and what lets a caller keep
 * its rules wherever suits it -- a config file, a CMS, another database. If
 * the engine owned a `services` table it would also have to own what a service
 * *is* to a business: a name, a description for patients, which practitioners
 * offer it. Those are this product's decisions, not scheduling ones, and a
 * second product would want different ones.
 *
 * What the engine does own is the one thing that must be written in the same
 * transaction as the conflict check: the booking. Everything here is read
 * before that transaction and handed in as a value, so keeping it in a
 * separate module costs no correctness.
 *
 * It does share the engine's SQLite file (a second connection; the engine
 * turns on WAL, so readers and the single writer do not block each other).
 * One file means one thing to back up and one thing to delete to reset the
 * demo. The table names are prefixed so they cannot collide with the engine's.
 *
 * Customers are deliberately absent. Booking needs no account, so the booking
 * row is the only place a customer is ever written; the engine derives the
 * customer list from it (`customers()`), and a second table here could only
 * drift out of step with that history.
 */
import 'server-only';
import type Database from 'better-sqlite3';
import type { Calendar, DateException, Service, WeeklyRule } from 'clinic-booking-app';
import { CLINIC } from '@/lib/clinic';
import type { ExceptionWithNote, ServiceDef, StaffMember } from '@/lib/types';

export const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS clinic_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinic_staff (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  role  TEXT NOT NULL,
  hue   TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0,
  -- Deactivated people keep their history and stop being offered.
  active INTEGER NOT NULL DEFAULT 1
);

-- One row per opening window. A day with a lunch break is two rows.
CREATE TABLE IF NOT EXISTS clinic_hours (
  staff_id TEXT    NOT NULL REFERENCES clinic_staff (id) ON DELETE CASCADE,
  weekday  INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens    TEXT    NOT NULL,
  closes   TEXT    NOT NULL,
  CHECK (opens < closes)
);
CREATE INDEX IF NOT EXISTS clinic_hours_staff ON clinic_hours (staff_id, weekday);

-- The engine's DateException: 'closed' removes a day, 'open' replaces that
-- day's weekly hours with the windows in clinic_exception_windows.
CREATE TABLE IF NOT EXISTS clinic_exceptions (
  staff_id TEXT NOT NULL REFERENCES clinic_staff (id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('closed', 'open')),
  note     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (staff_id, date)
);

CREATE TABLE IF NOT EXISTS clinic_exception_windows (
  staff_id TEXT NOT NULL,
  date     TEXT NOT NULL,
  opens    TEXT NOT NULL,
  closes   TEXT NOT NULL,
  CHECK (opens < closes),
  FOREIGN KEY (staff_id, date)
    REFERENCES clinic_exceptions (staff_id, date) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinic_services (
  id               TEXT PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  duration_min     INTEGER NOT NULL CHECK (duration_min > 0),
  step_min         INTEGER NOT NULL CHECK (step_min > 0),
  buffer_after_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  min_notice_min   INTEGER NOT NULL DEFAULT 0 CHECK (min_notice_min >= 0),
  max_advance_days INTEGER NOT NULL CHECK (max_advance_days > 0),
  sort             INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clinic_service_staff (
  service_id TEXT NOT NULL REFERENCES clinic_services (id) ON DELETE CASCADE,
  staff_id   TEXT NOT NULL REFERENCES clinic_staff (id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, staff_id)
);
`;

interface StaffRow { id: string; name: string; role: string; hue: StaffMember['hue']; active: number }
interface HoursRow { staff_id: string; weekday: number; opens: string; closes: string }
interface ExceptionRow { staff_id: string; date: string; kind: 'closed' | 'open'; note: string }
interface WindowRow { staff_id: string; date: string; opens: string; closes: string }
interface ServiceRow {
  id: string; name: string; description: string; duration_min: number; step_min: number;
  buffer_after_min: number; min_notice_min: number; max_advance_days: number; active: number;
}

export const HUES = ['blue', 'green', 'ochre', 'plum', 'slate'] as const;

/** "Marta Quental" -> "marta-quental", made unique against the ids already taken. */
function slugFor(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

export class Catalog {
  constructor(private readonly db: Database.Database) {
    db.pragma('foreign_keys = ON');
    db.exec(CATALOG_SCHEMA);
    // Databases from before deactivation existed get the column, all active.
    for (const table of ['clinic_staff', 'clinic_services']) {
      const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all();
      if (!cols.some((c) => c.name === 'active')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
      }
    }
  }

  /** Every catalogue row gone, ready for a fresh seed. Bookings are the engine's. */
  wipe(): void {
    this.db.transaction(() => {
      for (const t of ['clinic_service_staff', 'clinic_exception_windows', 'clinic_exceptions',
        'clinic_hours', 'clinic_services', 'clinic_staff', 'clinic_meta']) {
        this.db.exec(`DELETE FROM ${t}`);
      }
    })();
  }

  meta(key: string): string | null {
    return this.db.prepare<[string], { value: string }>('SELECT value FROM clinic_meta WHERE key = ?')
      .get(key)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO clinic_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  // -- staff and calendars ---------------------------------------------------

  staff(): StaffMember[] {
    const people = this.db.prepare<[], StaffRow>('SELECT id, name, role, hue, active FROM clinic_staff ORDER BY sort, name').all();
    const hours = this.db.prepare<[], HoursRow>('SELECT * FROM clinic_hours ORDER BY weekday, opens').all();
    const exceptions = this.db.prepare<[], ExceptionRow>('SELECT * FROM clinic_exceptions ORDER BY date').all();
    const windows = this.db.prepare<[], WindowRow>('SELECT * FROM clinic_exception_windows ORDER BY opens').all();

    return people.map((p) => ({
      ...p,
      active: p.active === 1,
      calendar: {
        timeZone: CLINIC.timeZone,
        weekly: hours.filter((h) => h.staff_id === p.id)
          .map((h) => ({ weekday: h.weekday, start: h.opens, end: h.closes })),
        exceptions: exceptions.filter((e) => e.staff_id === p.id).map((e) => toException(e, windows)),
      },
    }));
  }

  member(id: string): StaffMember | null {
    return this.staff().find((s) => s.id === id) ?? null;
  }

  calendarOf(staffId: string): Calendar | null {
    return this.member(staffId)?.calendar ?? null;
  }

  /** Exceptions with the free-text note the admin attached ("Training day"). */
  exceptionsOf(staffId: string): ExceptionWithNote[] {
    const windows = this.db.prepare<[string], WindowRow>(
      'SELECT * FROM clinic_exception_windows WHERE staff_id = ? ORDER BY opens',
    ).all(staffId);
    return this.db.prepare<[string], ExceptionRow>(
      'SELECT * FROM clinic_exceptions WHERE staff_id = ? ORDER BY date',
    ).all(staffId).map((e) => ({ ...toException(e, windows), note: e.note }));
  }

  addStaff(s: { id?: string; name: string; role: string; hue: StaffMember['hue']; sort?: number }): string {
    const taken = new Set(this.db.prepare<[], { id: string }>('SELECT id FROM clinic_staff').all().map((r) => r.id));
    const id = s.id ?? slugFor(s.name, taken);
    const sort = s.sort ?? (this.db.prepare<[], { n: number }>('SELECT coalesce(max(sort), -1) + 1 AS n FROM clinic_staff').get()?.n ?? 0);
    this.db.prepare('INSERT INTO clinic_staff (id, name, role, hue, sort) VALUES (?, ?, ?, ?, ?)')
      .run(id, s.name, s.role, s.hue, sort);
    return id;
  }

  updateStaff(id: string, s: { name: string; role: string; hue: StaffMember['hue'] }): void {
    this.db.prepare('UPDATE clinic_staff SET name = ?, role = ?, hue = ? WHERE id = ?').run(s.name, s.role, s.hue, id);
  }

  setStaffActive(id: string, active: boolean): void {
    this.db.prepare('UPDATE clinic_staff SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  /** Only for someone with no bookings at all; the caller checks. */
  deleteStaff(id: string): void {
    this.db.prepare('DELETE FROM clinic_staff WHERE id = ?').run(id);
  }

  /** Replace a person's whole weekly pattern in one transaction. */
  setWeeklyHours(staffId: string, rules: WeeklyRule[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM clinic_hours WHERE staff_id = ?').run(staffId);
      const insert = this.db.prepare('INSERT INTO clinic_hours (staff_id, weekday, opens, closes) VALUES (?, ?, ?, ?)');
      for (const r of rules) insert.run(staffId, r.weekday, r.start, r.end);
    })();
  }

  /** Add or replace the exception on one date. */
  putException(staffId: string, e: ExceptionWithNote): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM clinic_exceptions WHERE staff_id = ? AND date = ?').run(staffId, e.date);
      this.db.prepare('INSERT INTO clinic_exceptions (staff_id, date, kind, note) VALUES (?, ?, ?, ?)')
        .run(staffId, e.date, e.kind, e.note);
      if (e.kind === 'open') {
        const insert = this.db.prepare(
          'INSERT INTO clinic_exception_windows (staff_id, date, opens, closes) VALUES (?, ?, ?, ?)',
        );
        for (const w of e.windows ?? []) insert.run(staffId, e.date, w.start, w.end);
      }
    })();
  }

  removeException(staffId: string, date: string): void {
    this.db.prepare('DELETE FROM clinic_exceptions WHERE staff_id = ? AND date = ?').run(staffId, date);
  }

  // -- services -------------------------------------------------------------

  services(): ServiceDef[] {
    const rows = this.db.prepare<[], ServiceRow>('SELECT * FROM clinic_services ORDER BY sort, name').all();
    const links = this.db.prepare<[], { service_id: string; staff_id: string }>(
      `SELECT l.service_id, l.staff_id FROM clinic_service_staff l
         JOIN clinic_staff s ON s.id = l.staff_id ORDER BY s.sort`,
    ).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      durationMin: r.duration_min,
      stepMin: r.step_min,
      bufferAfterMin: r.buffer_after_min,
      minNoticeMin: r.min_notice_min,
      maxAdvanceDays: r.max_advance_days,
      active: r.active === 1,
      staffIds: links.filter((l) => l.service_id === r.id).map((l) => l.staff_id),
    }));
  }

  service(id: string): ServiceDef | null {
    return this.services().find((s) => s.id === id) ?? null;
  }

  /** A new service, with an id derived from its name. */
  addService(s: Omit<ServiceDef, 'id' | 'active'>): string {
    const taken = new Set(this.db.prepare<[], { id: string }>('SELECT id FROM clinic_services').all().map((r) => r.id));
    const id = slugFor(s.name, taken);
    const sort = this.db.prepare<[], { n: number }>('SELECT coalesce(max(sort), -1) + 1 AS n FROM clinic_services').get()?.n ?? 0;
    this.putService({ ...s, id, active: true }, sort);
    return id;
  }

  setServiceActive(id: string, active: boolean): void {
    this.db.prepare('UPDATE clinic_services SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  /** Only for a service never booked; the caller checks. */
  deleteService(id: string): void {
    this.db.prepare('DELETE FROM clinic_services WHERE id = ?').run(id);
  }

  putService(s: ServiceDef, sort?: number): void {
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO clinic_services
           (id, name, description, duration_min, step_min, buffer_after_min,
            min_notice_min, max_advance_days, sort)
         VALUES (@id, @name, @description, @durationMin, @stepMin, @bufferAfterMin,
                 @minNoticeMin, @maxAdvanceDays, @sort)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, description = excluded.description,
           duration_min = excluded.duration_min, step_min = excluded.step_min,
           buffer_after_min = excluded.buffer_after_min,
           min_notice_min = excluded.min_notice_min,
           max_advance_days = excluded.max_advance_days`,
      ).run({ ...s, sort: sort ?? 0 });
      this.db.prepare('DELETE FROM clinic_service_staff WHERE service_id = ?').run(s.id);
      const link = this.db.prepare('INSERT INTO clinic_service_staff (service_id, staff_id) VALUES (?, ?)');
      for (const staffId of s.staffIds) link.run(s.id, staffId);
    })();
  }
}

function toException(e: ExceptionRow, windows: WindowRow[]): DateException {
  if (e.kind === 'closed') return { date: e.date, kind: 'closed' };
  return {
    date: e.date,
    kind: 'open',
    windows: windows.filter((w) => w.staff_id === e.staff_id && w.date === e.date)
      .map((w) => ({ start: w.opens, end: w.closes })),
  };
}

/** The engine's view of a service: timing rules only. */
export function engineService(s: ServiceDef): Service {
  return {
    durationMin: s.durationMin,
    stepMin: s.stepMin,
    bufferAfterMin: s.bufferAfterMin,
    minNoticeMin: s.minNoticeMin,
    maxAdvanceDays: s.maxAdvanceDays,
  };
}
