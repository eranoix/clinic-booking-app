# scheduling-engine

Availability rules, recurrence and conflict-free booking — with reschedule and
cancel links that work without an account.

```bash
npm install
npm run demo
```

```
Open slots, week of 2 March: 12
  first: Mon 02 Mar, 09:00
  last:  Sat 07 Mar, 12:00
  Wed 4 Mar is closed: true
  Sat 7 Mar opened for one week: true

Booked Mon 02 Mar, 09:00 — link token d83127b2…
Second attempt refused: that time was just taken

Course of treatment — Every week on Mon, 4 times
  booked   Mon 09 Mar, 14:00
  booked   Mon 16 Mar, 14:00
  booked   Mon 23 Mar, 14:00
  booked   Mon 30 Mar, 14:00

Rescheduled to Mon 02 Mar, 11:00; link token unchanged: true
Cancelled. Slot free again: true
Record kept rather than deleted: cancelled
```

The token is new on every run; everything else is reproducible.

---

## Why this is harder than a loop over opening hours

The naive version subtracts bookings from opening hours. It falls apart on the
cases that make up most of real scheduling, and each one here is a test:

**The gap between appointments is a rule, not rounding.** A 50-minute service
offered on a 60-minute grid leaves ten minutes by construction, rather than by
asking staff to remember.

**Exceptions add availability as well as remove it.** Opening one Saturday and
closing one Wednesday are the same shape of data. Modelling only the closure
means the opening gets hacked in later, somewhere else.

**Touching is not overlapping.** An appointment ending at 10:00 and one
starting at 10:00 do not collide. Treating that as a clash loses one slot per
boundary, every day, and the loss is invisible.

**Days are not always 24 hours long.** A weekly series across a daylight-saving
boundary must keep landing at 09:00 local. Adding `7 × 86_400_000` lands it an
hour out, and nobody finds out until someone misses an appointment. Expansion
walks the local calendar; wall-clock times are resolved against a named zone
and never carried inward as a stored offset.

**The 31st of a 30-day month is skipped, not clamped.** Moving it to the 30th
invents an occurrence the person never asked for, and it shows up as a stranger
in their calendar.

## The race that matters

Offering a slot and taking it are separated by however long someone spends
deciding. Two people can both be told the same slot is free, because it was
when they asked.

So **availability is advice and the write is the authority.** The conflict check
runs inside the same transaction as the insert, re-reading what is booked
rather than trusting what was offered. Checking in application code that ran a
moment earlier and inserting after it is the classic double-booking bug, and it
appears only under the load that makes it expensive. Where the check runs
matters less than when: inside the transaction, nothing can commit between the
read and the insert.

Two collisions need two mechanisms. A second booking starting at the same
instant is refused by a partial unique index on `(resource_id, starts_at)`
limited to confirmed rows — enforced by the database, and the backstop for the
one race a single transaction cannot see, another connection committing between
our read and our insert. A partial overlap — 09:00 to 09:50 against one
starting at 09:30 — is not something a single-column constraint can express, so
it is an explicit overlap check over the rows re-read inside the transaction.

A reschedule is one transaction too, and one row: the same checks run, and then
the start and end are updated in place. Nothing is cancelled and re-inserted, so
there is no moment when the old appointment is gone and the new one has not
landed — a move that cannot land leaves the original exactly as it was. Done as
two calls, that moment exists, and a failure inside it leaves someone with
nothing.

## Links without accounts

Every booking carries an unguessable token, separate from its row id. A
sequential id in a URL lets anyone enumerate other people's appointments, and
the link has to work without a login because the person booking may not have an
account. Rescheduling preserves the token, so the link already sitting in their
inbox keeps working.

Cancelled bookings are marked, not deleted. *Was there ever an appointment?* is
a question people ask precisely when something has gone wrong.

## Using it

```ts
import { SchedulingEngine, expand, type Calendar } from 'scheduling-engine';

const engine = new SchedulingEngine({ path: './bookings.db' });

const calendar: Calendar = {
  timeZone: 'Europe/Lisbon',
  weekly: [{ weekday: 1, start: '09:00', end: '17:00' }],
  exceptions: [{ date: '2026-03-04', kind: 'closed' }],
};
const service = { durationMin: 50, stepMin: 60, minNoticeMin: 60, bufferAfterMin: 10 };

const free = engine.available('dr-lee', calendar, service, from, to);
const first = free[0];
if (!first) throw new Error('nothing free in that window');

const booking = engine.book({
  resourceId: 'dr-lee', serviceId: 'consult', service, calendar,
  customerName: 'Ana', customerEmail: 'ana@example.com',
  startsAt: first.start,
});

// Partial success is the honest result: refusing the whole series because
// week three clashes helps nobody, and dropping it silently is worse.
const { booked, skipped } = engine.bookSeries(
  expand({ rule: { frequency: 'weekly', byWeekday: [1], count: 8 }, start, timeZone }),
  { resourceId: 'dr-lee', serviceId: 'therapy', service, calendar,
    customerName: 'Rui', customerEmail: 'rui@example.com' },
);
```

## Tests

```bash
npm test        # 42 tests
npm run typecheck
```

The clock is injected, so notice periods, horizons and daylight-saving
behaviour are asserted exactly rather than waited for. Each test opens its own
in-memory database.

## Scope

Recurrence covers daily, weekly-by-weekday and monthly-by-day-of-month with
count, until and exception dates — a deliberate subset of RFC 5545. The full
specification includes rules almost nobody schedules against, and each one is a
branch that can be wrong.

SQLite via `better-sqlite3`, so there is nothing to provision. The shape ports
to Postgres unchanged; an exclusion constraint over a `tstzrange` replaces the
in-transaction overlap check when more than one process writes.

Node 22+, TypeScript strict, no runtime dependency beyond the driver.

## Languages

TypeScript, 53,589 bytes — 100% of GitHub's language bar. Strict, with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on; the 42 vitest
tests are TypeScript too.

Time-zone arithmetic is `Intl.DateTimeFormat` and no date library:
`zonedTimeToUtc`, `dateInZone` and `weekdayInZone` in `src/availability.ts`
resolve wall-clock against a named zone, which is what holds 09:00 local across
a transition.

The SQL is hand-written but embedded — the `bookings` DDL, the partial unique
index on `(resource_id, starts_at)` and the two lookup indexes over the booking
window and the series id are a template literal in `src/booking.ts`, so the
build stays `tsc` with nothing to copy into `dist`, and the language bar reads
TypeScript. The WAL pragma is not in the literal: it is a `db.pragma` call in
the constructor, run before the schema.
