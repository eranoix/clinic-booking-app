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

/**
 * Why a slot could not be taken.
 *
 * `taken`: the rules offer that time, but a confirmed booking now occupies it
 * -- the race between seeing a slot and taking it, lost. The person should be
 * shown the nearest alternatives.
 *
 * `not-offered`: the rules never offered that time (outside opening hours, too
 * soon, too far ahead, off the grid). Showing alternatives "near" it would be
 * answering a different question.
 *
 * A field rather than two subclasses, so every existing
 * `instanceof SlotUnavailable` keeps catching both.
 */
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

/**
 * Filter for {@link SchedulingEngine.list}. Every field narrows; none is
 * required. `from`/`to` select by START time, half-open: `[from, to)`, so the
 * bookings "on" a day are exactly those starting between its two midnights and
 * a day boundary never counts one twice.
 */
export interface ListQuery {
  from?: number;
  to?: number;
  resourceId?: string;
  serviceId?: string;
  status?: BookingStatus;
  /** Matched case-insensitively: Ana@Example.com and ana@example.com are one person. */
  customerEmail?: string;
  /** Newest first instead of oldest first. */
  order?: 'asc' | 'desc';
  limit?: number;
}

/**
 * One person, as seen through their bookings.
 *
 * There is no customer table: the booking row is the only place a customer is
 * ever written, because booking needs no account. So a customer is derived --
 * grouped by lower-cased email -- and cannot drift out of step with the history
 * it summarises.
 */
export interface CustomerSummary {
  /** Lower-cased: the grouping key. */
  email: string;
  /** The name on their most recent booking; people correct typos over time. */
  name: string;
  total: number;
  confirmed: number;
  cancelled: number;
  /** Confirmed bookings starting after now. */
  upcoming: number;
  firstStartsAt: number;
  lastStartsAt: number;
  /** Start of the next confirmed booking after now, if any. */
  nextStartsAt: number | null;
  /** Start of the most recent confirmed booking at or before now, if any. */
  lastSeenAt: number | null;
}

/** An occurrence of a series that could not be booked, and why. */
export interface SkippedOccurrence {
  startsAt: number;
  reason: string;
  code: SlotUnavailableReason;
}

/** Something that happened to a booking, as handed to the outbox composer. */
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

/** A message the composer wants written. */
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
  /**
   * Turn a change into messages -- confirmations, notices of a move or a
   * cancellation -- or return null for none.
   *
   * This is a transactional outbox. The composer runs inside the transaction
   * that makes the change, and what it returns is written in that same
   * transaction: a message exists exactly when the change it describes
   * committed. Sending email straight from the request handler gets this wrong
   * both ways -- a confirmation for a booking that then rolled back, or a
   * booking whose confirmation was lost because the mail server was down.
   * If the composer throws, the change is rolled back with it.
   *
   * Nothing is delivered here. Something else reads the outbox and sends.
   */
  outbox?: (event: BookingEvent) => OutboxDraft | OutboxDraft[] | null;
}

/**
 * Bring a database created by an earlier version up to the current schema.
 *
 * `held_until` arrived after the first release. A row written before it has
 * no record of its service's buffer, so it is backfilled with its own end: it
 * holds exactly the appointment, which is what the old version enforced.
 */
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

  /** Write the composer's messages for an event. Call only inside a transaction. */
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

  /**
   * Time a resource cannot offer, from confirmed bookings overlapping a window.
   *
   * Each interval runs from a booking's start to the end of its buffer, not
   * just to the end of the appointment: the buffer is held by the booking
   * that needs it. Holding it only on the slot being offered made the gap
   * depend on booking order -- the time after an existing appointment was
   * offered to the next person, and book() did not check buffers at all.
   */
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

  /** What a customer may choose from. Advice, not a reservation. */
  available(
    resourceId: string,
    calendar: Calendar,
    service: Service,
    from: number,
    to: number,
  ): Interval[] {
    // A slot near the end of the window holds its buffer past `to`, so the
    // bookings that buffer could run into are read that far too.
    const bufferMs = (service.bufferAfterMin ?? 0) * 60_000;
    return slots({
      calendar, service, from, to,
      busy: this.busy(resourceId, from, to + bufferMs),
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
    return this.bookWithin(req, true);
  }

  private bookWithin(req: BookRequest, announce: boolean): Booking {
    const now = this.now();
    const durationMs = req.service.durationMin * 60_000;
    const endsAt = req.startsAt + durationMs;
    const heldUntil = endsAt + (req.service.bufferAfterMin ?? 0) * 60_000;

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
        throw new SlotUnavailable('that time is not offered for this service', 'not-offered');
      }

      // Re-read inside the transaction. The availability the customer saw is
      // already stale by the time they click.
      // Both buffers count: the one this booking needs after itself, and the
      // ones already held by the bookings around it.
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
      // IMMEDIATE takes the write lock before the read, so another connection
      // cannot commit between the conflict check and the insert: it waits.
      // Inside an outer transaction (a series) this is a savepoint instead.
      return toBooking(this.db.inTransaction ? run() : run.immediate());
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
    ctx: {
      calendar: Calendar;
      service: Service;
      /**
       * Move to a different resource -- another practitioner, another room.
       * `calendar` is then that resource's calendar. Omitted, the booking
       * stays where it is.
       */
      resourceId?: string;
    },
  ): Booking {
    const endsAt = newStart + ctx.service.durationMin * 60_000;
    const heldUntil = endsAt + (ctx.service.bufferAfterMin ?? 0) * 60_000;

    const run = this.db.transaction((): Row => {
      const now = this.now();
      // Read the booking inside the transaction too: a cancellation that
      // lands first must win, not be overwritten by a move.
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

      // Everything the target resource holds except this booking itself,
      // which is excluded by id: it is about to move, and it must not block
      // its own new time.
      const clash = this.held(resourceId, newStart, heldUntil, before.id)
        .some((b) => overlaps({ start: newStart, end: heldUntil }, b));
      if (clash) throw new SlotUnavailable('that time was just taken');

      // One UPDATE of one row, resource included. There is no insert on the
      // new resource and no cancel on the old one, so at no instant does the
      // appointment exist twice or not at all.
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

  /**
   * Cancel.
   *
   * The row is kept and marked, not deleted. A deleted booking loses the fact
   * that it existed, and "was there ever an appointment?" is a question people
   * ask precisely when something went wrong.
   */
  cancel(token: string): Booking {
    const run = this.db.transaction((): Booking => {
      const existing = this.byToken(token);
      if (!existing) throw new BookingNotFound('no booking for that link');
      // Repeating a cancellation changes nothing and announces nothing.
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

  /**
   * Cancel a series from one occurrence onward: "stop the course here".
   *
   * One transaction, so the course is never half-cancelled. Earlier
   * occurrences, attended or not, are left alone; so are ones already
   * cancelled. Returns what this call cancelled.
   */
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
  ): { seriesId: string; booked: Booking[]; skipped: SkippedOccurrence[] } {
    const seriesId = this.newToken();

    // One transaction around the whole series, each occurrence a savepoint
    // inside it: an occurrence that cannot land rolls back alone, and the
    // series -- with its outcome and its one message -- commits together.
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

  /**
   * Bookings matching a filter, in start order.
   *
   * Cancelled rows are included unless `status` says otherwise: a front desk
   * asking "what happened on Tuesday" needs to see the cancellations too, and
   * hiding them by default is how a no-show gets mistaken for a gap.
   */
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
    // Only fixed fragments are concatenated; every value is a bound parameter.
    const sql = `SELECT * FROM bookings
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY starts_at ${q.order === 'desc' ? 'DESC' : 'ASC'}, id
      ${q.limit != null ? `LIMIT ${q.limit}` : ''}`;
    return this.db.prepare<typeof args, Row>(sql).all(...args).map(toBooking);
  }

  /** Everyone who has ever booked: most recently seen first, then people not yet seen. */
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

  /** Messages written by the outbox composer, newest first. */
  outbox(q: { limit?: number; to?: string; bookingId?: number; seriesId?: string } = {}): OutboxMessage[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.to != null) { where.push('lower(recipient) = lower(?)'); args.push(q.to); }
    // Given both, either matches: a booking's own messages and its course's.
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
