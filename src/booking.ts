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
  -- End of the time this booking keeps from everyone else: ends_at plus the
  -- service's buffer. Stored rather than recomputed, because the buffer is a
  -- property of the service at booking time and the row does not carry it.
  held_until     INTEGER NOT NULL,
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

-- Messages about bookings, written in the same transaction as the change they
-- describe (see EngineOptions.outbox). Delivering them is someone else's job.
CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  kind        TEXT    NOT NULL,
  booking_id  INTEGER,
  series_id   TEXT,
  recipient   TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_recipient ON outbox (recipient, created_at);
`;

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  id: number;
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

export type SlotUnavailableReason = 'taken' | 'not-offered';

export class SlotUnavailable extends Error {
  override readonly name = 'SlotUnavailable';
  readonly reason: SlotUnavailableReason;

  constructor(message: string, reason: SlotUnavailableReason = 'taken') {
    super(message);
    this.reason = reason;
  }
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

export interface ListQuery {
  from?: number;
  to?: number;
  resourceId?: string;
  serviceId?: string;
  status?: BookingStatus;
  customerEmail?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}

export interface CustomerSummary {
  email: string;
  name: string;
  total: number;
  confirmed: number;
  cancelled: number;
  upcoming: number;
  firstStartsAt: number;
  lastStartsAt: number;
  nextStartsAt: number | null;
  lastSeenAt: number | null;
}

export interface SkippedOccurrence {
  startsAt: number;
  reason: string;
  code: SlotUnavailableReason;
}

export type BookingEvent =
  | { kind: 'booked'; booking: Booking }
  | {
      kind: 'rescheduled';
      booking: Booking;
      previous: Pick<Booking, 'startsAt' | 'endsAt' | 'resourceId'>;
    }
  | { kind: 'cancelled'; booking: Booking }
  | { kind: 'series-booked'; seriesId: string; booked: Booking[]; skipped: SkippedOccurrence[] }
  | { kind: 'series-cancelled'; seriesId: string; cancelled: Booking[] };

export interface OutboxDraft {
  to: string;
  subject: string;
  body: string;
}

export interface OutboxMessage extends OutboxDraft {
  id: number;
  createdAt: number;
  kind: BookingEvent['kind'];
  bookingId: number | null;
  seriesId: string | null;
}

export interface EngineOptions {
  path?: string;
  now?: () => number;
  newToken?: () => string;
  outbox?: (event: BookingEvent) => OutboxDraft | OutboxDraft[] | null;
}

function migrate(db: Db): void {
  const columns = db.prepare<[], { name: string }>('PRAGMA table_info(bookings)').all();
  if (!columns.some((c) => c.name === 'held_until')) {
    db.transaction(() => {
      db.exec('ALTER TABLE bookings ADD COLUMN held_until INTEGER');
      db.exec('UPDATE bookings SET held_until = ends_at WHERE held_until IS NULL');
    })();
  }
}

export class SchedulingEngine {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly newToken: () => string;
  private readonly compose: EngineOptions['outbox'];

  constructor(opts: EngineOptions = {}) {
    this.db = new Database(opts.path ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    migrate(this.db);
    this.now = opts.now ?? (() => Date.now());
    this.newToken = opts.newToken ?? (() => randomUUID());
    this.compose = opts.outbox;
  }

  private emit(event: BookingEvent): void {
    if (!this.compose) return;
    const drafts = this.compose(event);
    if (!drafts) return;
    const insert = this.db.prepare(
      `INSERT INTO outbox (created_at, kind, booking_id, series_id, recipient, subject, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const bookingId = 'booking' in event ? event.booking.id : null;
    const seriesId = 'seriesId' in event ? event.seriesId : ('booking' in event ? event.booking.seriesId : null);
    for (const d of Array.isArray(drafts) ? drafts : [drafts]) {
      insert.run(this.now(), event.kind, bookingId, seriesId, d.to, d.subject, d.body);
    }
  }

  close(): void {
    this.db.close();
  }

  busy(resourceId: string, from: number, to: number): Interval[] {
    return this.held(resourceId, from, to, -1);
  }

  private held(resourceId: string, from: number, to: number, exceptId: number): Interval[] {
    return this.db
      .prepare<[string, number, number, number], { starts_at: number; held_until: number }>(
        `SELECT starts_at, held_until FROM bookings
          WHERE resource_id = ? AND status = 'confirmed'
            AND held_until > ? AND starts_at < ? AND id <> ?`,
      )
      .all(resourceId, from, to, exceptId)
      .map((r) => ({ start: r.starts_at, end: r.held_until }));
  }

  available(
    resourceId: string,
    calendar: Calendar,
    service: Service,
    from: number,
    to: number,
  ): Interval[] {
    const bufferMs = (service.bufferAfterMin ?? 0) * 60_000;
    return slots({
      calendar, service, from, to,
      busy: this.busy(resourceId, from, to + bufferMs),
      now: this.now(),
    });
  }

  book(req: BookRequest): Booking {
    return this.bookWithin(req, true);
  }

  private bookWithin(req: BookRequest, announce: boolean): Booking {
    const now = this.now();
    const durationMs = req.service.durationMin * 60_000;
    const endsAt = req.startsAt + durationMs;
    const heldUntil = endsAt + (req.service.bufferAfterMin ?? 0) * 60_000;

    const run = this.db.transaction((): Row => {
      const offered = slots({
        calendar: req.calendar,
        service: req.service,
        from: req.startsAt,
        to: endsAt,
        busy: [],
        now,
      });
      if (!offered.some((s) => s.start === req.startsAt)) {
        throw new SlotUnavailable('that time is not offered for this service', 'not-offered');
      }

      const clash = this.busy(req.resourceId, req.startsAt, heldUntil)
        .some((b) => overlaps({ start: req.startsAt, end: heldUntil }, b));
      if (clash) throw new SlotUnavailable('that time was just taken');

      const token = this.newToken();
      const info = this.db
        .prepare(
          `INSERT INTO bookings
             (public_token, resource_id, service_id, customer_name, customer_email,
              starts_at, ends_at, held_until, status, series_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
        )
        .run(
          token, req.resourceId, req.serviceId, req.customerName, req.customerEmail,
          req.startsAt, endsAt, heldUntil, req.seriesId ?? null, now, now,
        );
      const row = this.db
        .prepare<[number], Row>('SELECT * FROM bookings WHERE id = ?')
        .get(Number(info.lastInsertRowid));
      if (!row) throw new Error('book: failed to read back inserted row');
      if (announce) this.emit({ kind: 'booked', booking: toBooking(row) });
      return row;
    });

    try {
      return toBooking(this.db.inTransaction ? run() : run.immediate());
    } catch (err) {
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

  reschedule(
    token: string,
    newStart: number,
    ctx: {
      calendar: Calendar;
      service: Service;
      resourceId?: string;
    },
  ): Booking {
    const endsAt = newStart + ctx.service.durationMin * 60_000;
    const heldUntil = endsAt + (ctx.service.bufferAfterMin ?? 0) * 60_000;

    const run = this.db.transaction((): Row => {
      const now = this.now();
      const before = this.db
        .prepare<[string], Row>('SELECT * FROM bookings WHERE public_token = ?')
        .get(token);
      if (!before || before.status !== 'confirmed') {
        throw new BookingNotFound('no confirmed booking for that link');
      }
      const resourceId = ctx.resourceId ?? before.resource_id;

      const offered = slots({
        calendar: ctx.calendar, service: ctx.service,
        from: newStart, to: endsAt, busy: [], now,
      });
      if (!offered.some((s) => s.start === newStart)) {
        throw new SlotUnavailable('that time is not offered for this service', 'not-offered');
      }

      const clash = this.held(resourceId, newStart, heldUntil, before.id)
        .some((b) => overlaps({ start: newStart, end: heldUntil }, b));
      if (clash) throw new SlotUnavailable('that time was just taken');

      this.db
        .prepare(
          `UPDATE bookings
              SET resource_id = ?, starts_at = ?, ends_at = ?, held_until = ?, updated_at = ?
            WHERE id = ? AND status = 'confirmed'`,
        )
        .run(resourceId, newStart, endsAt, heldUntil, now, before.id);

      const row = this.db
        .prepare<[number], Row>('SELECT * FROM bookings WHERE id = ?')
        .get(before.id);
      if (!row) throw new Error('reschedule: row vanished');
      this.emit({
        kind: 'rescheduled',
        booking: toBooking(row),
        previous: { startsAt: before.starts_at, endsAt: before.ends_at, resourceId: before.resource_id },
      });
      return row;
    });

    try {
      return toBooking(run.immediate());
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint/i.test(err.message)) {
        throw new SlotUnavailable('that time was just taken');
      }
      throw err;
    }
  }

  cancel(token: string): Booking {
    const run = this.db.transaction((): Booking => {
      const existing = this.byToken(token);
      if (!existing) throw new BookingNotFound('no booking for that link');
      if (existing.status === 'cancelled') return existing;

      const now = this.now();
      this.db
        .prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now, existing.id);
      const cancelled: Booking = { ...existing, status: 'cancelled', updatedAt: now };
      this.emit({ kind: 'cancelled', booking: cancelled });
      return cancelled;
    });
    return run.immediate();
  }

  cancelSeriesFrom(seriesId: string, fromStartsAt: number): Booking[] {
    const run = this.db.transaction((): Booking[] => {
      const now = this.now();
      const rows = this.db
        .prepare<[string, number], Row>(
          `SELECT * FROM bookings
            WHERE series_id = ? AND status = 'confirmed' AND starts_at >= ?
            ORDER BY starts_at`,
        )
        .all(seriesId, fromStartsAt);
      const update = this.db.prepare(
        "UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?",
      );
      const cancelled = rows.map((r) => {
        update.run(now, r.id);
        return { ...toBooking(r), status: 'cancelled' as const, updatedAt: now };
      });
      if (cancelled.length) this.emit({ kind: 'series-cancelled', seriesId, cancelled });
      return cancelled;
    });
    return run.immediate();
  }

  bookSeries(
    occurrences: number[],
    req: Omit<BookRequest, 'startsAt' | 'seriesId'>,
  ): { seriesId: string; booked: Booking[]; skipped: SkippedOccurrence[] } {
    const seriesId = this.newToken();

    const run = this.db.transaction(() => {
      const booked: Booking[] = [];
      const skipped: SkippedOccurrence[] = [];
      for (const startsAt of occurrences) {
        try {
          booked.push(this.bookWithin({ ...req, startsAt, seriesId }, false));
        } catch (err) {
          if (err instanceof SlotUnavailable) {
            skipped.push({ startsAt, reason: err.message, code: err.reason });
          } else {
            throw err;
          }
        }
      }
      this.emit({ kind: 'series-booked', seriesId, booked, skipped });
      return { seriesId, booked, skipped };
    });
    return run.immediate();
  }

  byId(id: number): Booking | null {
    const row = this.db
      .prepare<[number], Row>('SELECT * FROM bookings WHERE id = ?')
      .get(id);
    return row ? toBooking(row) : null;
  }

  list(q: ListQuery = {}): Booking[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.from != null) { where.push('starts_at >= ?'); args.push(q.from); }
    if (q.to != null) { where.push('starts_at < ?'); args.push(q.to); }
    if (q.resourceId != null) { where.push('resource_id = ?'); args.push(q.resourceId); }
    if (q.serviceId != null) { where.push('service_id = ?'); args.push(q.serviceId); }
    if (q.status != null) { where.push('status = ?'); args.push(q.status); }
    if (q.customerEmail != null) {
      where.push('lower(customer_email) = lower(?)');
      args.push(q.customerEmail);
    }
    if (q.limit != null && (!Number.isInteger(q.limit) || q.limit < 0)) {
      throw new RangeError(`limit must be a non-negative integer, got ${q.limit}`);
    }
    const sql = `SELECT * FROM bookings
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY starts_at ${q.order === 'desc' ? 'DESC' : 'ASC'}, id
      ${q.limit != null ? `LIMIT ${q.limit}` : ''}`;
    return this.db.prepare<typeof args, Row>(sql).all(...args).map(toBooking);
  }

  customers(): CustomerSummary[] {
    const now = this.now();
    const rows = this.db
      .prepare<[number, number, number], {
        email: string; name: string; total: number; confirmed: number;
        cancelled: number; upcoming: number; first_at: number; last_at: number;
        next_at: number | null; seen_at: number | null;
      }>(
        `SELECT lower(customer_email) AS email,
                (SELECT b2.customer_name FROM bookings b2
                  WHERE lower(b2.customer_email) = lower(b.customer_email)
                  ORDER BY b2.created_at DESC, b2.id DESC LIMIT 1) AS name,
                count(*) AS total,
                sum(status = 'confirmed') AS confirmed,
                sum(status = 'cancelled') AS cancelled,
                sum(status = 'confirmed' AND starts_at > ?) AS upcoming,
                min(starts_at) AS first_at,
                max(starts_at) AS last_at,
                min(CASE WHEN status = 'confirmed' AND starts_at > ? THEN starts_at END) AS next_at,
                max(CASE WHEN status = 'confirmed' AND starts_at <= ? THEN starts_at END) AS seen_at
           FROM bookings b
          GROUP BY lower(customer_email)
          ORDER BY seen_at DESC NULLS LAST, next_at ASC NULLS LAST, email`,
      )
      .all(now, now, now);
    return rows.map((r) => ({
      email: r.email, name: r.name, total: r.total, confirmed: r.confirmed,
      cancelled: r.cancelled, upcoming: r.upcoming, firstStartsAt: r.first_at,
      lastStartsAt: r.last_at, nextStartsAt: r.next_at, lastSeenAt: r.seen_at,
    }));
  }

  outbox(q: { limit?: number; to?: string; bookingId?: number; seriesId?: string } = {}): OutboxMessage[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.to != null) { where.push('lower(recipient) = lower(?)'); args.push(q.to); }
    const about: string[] = [];
    if (q.bookingId != null) { about.push('booking_id = ?'); args.push(q.bookingId); }
    if (q.seriesId != null) { about.push('series_id = ?'); args.push(q.seriesId); }
    if (about.length) where.push(`(${about.join(' OR ')})`);
    const limit = q.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 0) {
      throw new RangeError(`limit must be a non-negative integer, got ${limit}`);
    }
    return this.db
      .prepare<typeof args, OutboxRow>(
        `SELECT * FROM outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
      )
      .all(...args)
      .map(toMessage);
  }

  outboxMessage(id: number): OutboxMessage | null {
    const row = this.db.prepare<[number], OutboxRow>('SELECT * FROM outbox WHERE id = ?').get(id);
    return row ? toMessage(row) : null;
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

interface OutboxRow {
  id: number;
  created_at: number;
  kind: BookingEvent['kind'];
  booking_id: number | null;
  series_id: string | null;
  recipient: string;
  subject: string;
  body: string;
}

function toMessage(r: OutboxRow): OutboxMessage {
  return {
    id: r.id, createdAt: r.created_at, kind: r.kind, bookingId: r.booking_id,
    seriesId: r.series_id, to: r.recipient, subject: r.subject, body: r.body,
  };
}
