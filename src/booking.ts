/**
 * Booking: the part that has to be right under concurrency.
 *
 * Offering a slot and taking it are separated in time by however long a person
 * spends deciding. Two people can be looking at the same free slot, and both
 * will be told it is available, because it was when they asked.
 *
 * So availability is advice and the write is the authority. The conflict check
 * happens INSIDE the same transaction as the insert, re-reading what is booked
 * rather than trusting what was offered. Checking first and inserting second is
 * the classic double-booking bug, and it only shows up under exactly the load
 * that makes it expensive.
 *
 * Two collisions, two mechanisms. An identical start instant is refused by the
 * partial unique index below, which the database enforces. A partial overlap is
 * not something a single-column constraint can express, so it is the explicit
 * overlap check over the rows re-read inside the transaction.
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { overlaps, slots, type Calendar, type Interval, type Service } from './availability.js';
import { randomUUID } from 'node:crypto';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  public_token   TEXT    NOT NULL UNIQUE,
  resource_id    TEXT    NOT NULL,
  service_id     TEXT    NOT NULL,
  customer_name  TEXT    NOT NULL,
  customer_email TEXT    NOT NULL,
  starts_at      INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'confirmed',
  series_id      TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Two bookings cannot start at the same instant on the same resource. This is
-- the backstop under a race; the overlap check inside the transaction covers
-- the rest, which a single-column constraint cannot express.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot
  ON bookings (resource_id, starts_at) WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS bookings_window
  ON bookings (resource_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS bookings_series ON bookings (series_id);
`;

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  id: number;
  /**
   * Unguessable id used in reschedule and cancel links.
   *
   * Separate from the numeric id on purpose: a sequential id in a URL lets
   * anyone enumerate other people's appointments, and the link has to work
   * without a login because the person booking may not have an account.
   */
  publicToken: string;
  resourceId: string;
  serviceId: string;
  customerName: string;
  customerEmail: string;
  startsAt: number;
  endsAt: number;
  status: BookingStatus;
  seriesId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: number;
  public_token: string;
  resource_id: string;
  service_id: string;
  customer_name: string;
  customer_email: string;
  starts_at: number;
  ends_at: number;
  status: BookingStatus;
  series_id: string | null;
  created_at: number;
  updated_at: number;
}

export class SlotUnavailable extends Error {
  override readonly name = 'SlotUnavailable';
}
export class BookingNotFound extends Error {
  override readonly name = 'BookingNotFound';
}

export interface BookRequest {
  resourceId: string;
  serviceId: string;
  service: Service;
  calendar: Calendar;
  customerName: string;
  customerEmail: string;
  startsAt: number;
  seriesId?: string;
}

export interface EngineOptions {
  path?: string;
  now?: () => number;
  newToken?: () => string;
}

export class SchedulingEngine {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly newToken: () => string;

  constructor(opts: EngineOptions = {}) {
    this.db = new Database(opts.path ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.now = opts.now ?? (() => Date.now());
    this.newToken = opts.newToken ?? (() => randomUUID());
  }

  close(): void {
    this.db.close();
  }

  /** Confirmed bookings overlapping a window, as busy intervals. */
  busy(resourceId: string, from: number, to: number): Interval[] {
    return this.db
      .prepare<[string, number, number], { starts_at: number; ends_at: number }>(
        `SELECT starts_at, ends_at FROM bookings
          WHERE resource_id = ? AND status = 'confirmed'
            AND ends_at > ? AND starts_at < ?`,
      )
      .all(resourceId, from, to)
      .map((r) => ({ start: r.starts_at, end: r.ends_at }));
  }

  /** What a customer may choose from. Advice, not a reservation. */
  available(
    resourceId: string,
    calendar: Calendar,
    service: Service,
    from: number,
    to: number,
  ): Interval[] {
    return slots({
      calendar, service, from, to,
      busy: this.busy(resourceId, from, to),
      now: this.now(),
    });
  }

  /**
   * Take a slot.
   *
   * Everything that decides whether this is allowed happens inside one
   * transaction: re-derive the slot from the rules, re-read what is booked,
   * check for an overlap, insert. A slot that was free when it was offered and
   * taken in between is refused here, which is the only place it can be
   * refused correctly.
   */
  book(req: BookRequest): Booking {
    const now = this.now();
    const durationMs = req.service.durationMin * 60_000;
    const endsAt = req.startsAt + durationMs;

    const run = this.db.transaction((): Row => {
      // Is this a slot the rules actually offer? Without this, a caller can
      // post any instant and book outside opening hours entirely.
      const offered = slots({
        calendar: req.calendar,
        service: req.service,
        from: req.startsAt,
        to: endsAt,
        busy: [],
        now,
      });
      if (!offered.some((s) => s.start === req.startsAt)) {
        throw new SlotUnavailable('that time is not offered for this service');
      }

      // Re-read inside the transaction. The availability the customer saw is
      // already stale by the time they click.
      const clash = this.busy(req.resourceId, req.startsAt, endsAt)
        .some((b) => overlaps({ start: req.startsAt, end: endsAt }, b));
      if (clash) throw new SlotUnavailable('that time was just taken');

      const token = this.newToken();
      const info = this.db
        .prepare(
          `INSERT INTO bookings
             (public_token, resource_id, service_id, customer_name, customer_email,
              starts_at, ends_at, status, series_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
        )
        .run(
          token, req.resourceId, req.serviceId, req.customerName, req.customerEmail,
          req.startsAt, endsAt, req.seriesId ?? null, now, now,
        );
      const row = this.db
        .prepare<[number], Row>('SELECT * FROM bookings WHERE id = ?')
        .get(Number(info.lastInsertRowid));
      if (!row) throw new Error('book: failed to read back inserted row');
      return row;
    });

    try {
      return toBooking(run());
    } catch (err) {
      // The unique index is the backstop for the race the transaction cannot
      // see: another connection committing between our read and our insert.
      if (err instanceof Error && /UNIQUE constraint/i.test(err.message)) {
        throw new SlotUnavailable('that time was just taken');
      }
      throw err;
    }
  }

  byToken(token: string): Booking | null {
    const row = this.db
      .prepare<[string], Row>('SELECT * FROM bookings WHERE public_token = ?')
      .get(token);
    return row ? toBooking(row) : null;
  }

  /**
   * Move a booking.
   *
   * One transaction and one row: the slot is re-derived, the clash re-checked,
   * and the start and end updated in place. Nothing is cancelled and
   * re-inserted, so there is no moment when the old appointment is gone and the
   * new one has not landed — a reschedule that cannot land leaves the booking
   * exactly as it was. Doing it as two calls means a failure between them
   * leaves someone with nothing, which is worse than the failure they were
   * trying to recover from.
   *
   * The row keeps its id and its token: the link in their email keeps working.
   */
  reschedule(
    token: string,
    newStart: number,
    ctx: { calendar: Calendar; service: Service },
  ): Booking {
    const existing = this.byToken(token);
    if (!existing || existing.status !== 'confirmed') {
      throw new BookingNotFound('no confirmed booking for that link');
    }
    const now = this.now();
    const endsAt = newStart + ctx.service.durationMin * 60_000;

    const run = this.db.transaction((): Row => {
      const offered = slots({
        calendar: ctx.calendar, service: ctx.service,
        from: newStart, to: endsAt, busy: [], now,
      });
      if (!offered.some((s) => s.start === newStart)) {
        throw new SlotUnavailable('that time is not offered for this service');
      }

      const clash = this.busy(existing.resourceId, newStart, endsAt)
        .filter((b) => !(b.start === existing.startsAt && b.end === existing.endsAt))
        .some((b) => overlaps({ start: newStart, end: endsAt }, b));
      if (clash) throw new SlotUnavailable('that time was just taken');

      this.db
        .prepare(
          `UPDATE bookings SET starts_at = ?, ends_at = ?, updated_at = ?
            WHERE id = ? AND status = 'confirmed'`,
        )
        .run(newStart, endsAt, now, existing.id);

      const row = this.db
        .prepare<[number], Row>('SELECT * FROM bookings WHERE id = ?')
        .get(existing.id);
      if (!row) throw new Error('reschedule: row vanished');
      return row;
    });

    try {
      return toBooking(run());
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint/i.test(err.message)) {
        throw new SlotUnavailable('that time was just taken');
      }
      throw err;
    }
  }

  /**
   * Cancel.
   *
   * The row is kept and marked, not deleted. A deleted booking loses the fact
   * that it existed, and "was there ever an appointment?" is a question people
   * ask precisely when something went wrong.
   */
  cancel(token: string): Booking {
    const existing = this.byToken(token);
    if (!existing) throw new BookingNotFound('no booking for that link');
    if (existing.status === 'cancelled') return existing;

    const now = this.now();
    this.db
      .prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(now, existing.id);
    return { ...existing, status: 'cancelled', updatedAt: now };
  }

  /**
   * Book a recurring series, reporting per-occurrence outcomes.
   *
   * Partial success is the honest result and the useful one. Refusing the
   * whole series because week six clashes with a public holiday helps nobody;
   * silently dropping week six without saying so is worse. The caller gets
   * both lists and decides.
   */
  bookSeries(
    occurrences: number[],
    req: Omit<BookRequest, 'startsAt' | 'seriesId'>,
  ): { seriesId: string; booked: Booking[]; skipped: { startsAt: number; reason: string }[] } {
    const seriesId = this.newToken();
    const booked: Booking[] = [];
    const skipped: { startsAt: number; reason: string }[] = [];

    for (const startsAt of occurrences) {
      try {
        booked.push(this.book({ ...req, startsAt, seriesId }));
      } catch (err) {
        if (err instanceof SlotUnavailable) {
          skipped.push({ startsAt, reason: err.message });
        } else {
          throw err;
        }
      }
    }
    return { seriesId, booked, skipped };
  }

  seriesOf(seriesId: string): Booking[] {
    return this.db
      .prepare<[string], Row>(
        'SELECT * FROM bookings WHERE series_id = ? ORDER BY starts_at',
      )
      .all(seriesId)
      .map(toBooking);
  }
}

function toBooking(row: Row): Booking {
  return {
    id: row.id,
    publicToken: row.public_token,
    resourceId: row.resource_id,
    serviceId: row.service_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    seriesId: row.series_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
