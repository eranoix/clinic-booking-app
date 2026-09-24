# scheduling-engine

Availability rules, recurrence and conflict-free booking — with reschedule and
cancel links that work without an account.

```bash
npm install
npm run demo
```

```
Open slots, week of 2 March: 12
  Wed 4 Mar is closed: true
  Sat 7 Mar opened for one week: true

Booked Mon 02 Mar, 09:00 — link token d83127b2…
Second attempt refused: that time was just taken

Course of treatment — Every week on Mon, 4 times
  booked   Mon 09 Mar, 14:00   …
```

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
runs inside the same transaction as the insert, against a constraint the
database enforces — not in application code that ran a moment earlier. Check
first and insert second is the classic double-booking bug, and it appears only
under the load that makes it expensive.

A reschedule is one transaction too: cancel and rebook together, so a move that
cannot land never destroys the appointment the person already had.

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
import { SchedulingEngine, expand } from 'scheduling-engine';

const engine = new SchedulingEngine({ path: './bookings.db' });

const calendar = {
  timeZone: 'Europe/Lisbon',
  weekly: [{ weekday: 1, start: '09:00', end: '17:00' }],
  exceptions: [{ date: '2026-03-04', kind: 'closed' }],
};
const service = { durationMin: 50, stepMin: 60, minNoticeMin: 60, bufferAfterMin: 10 };

const free = engine.available('dr-lee', calendar, service, from, to);

const booking = engine.book({
  resourceId: 'dr-lee', serviceId: 'consult', service, calendar,
  customerName: 'Ana', customerEmail: 'ana@example.com',
  startsAt: free[0].start,
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
