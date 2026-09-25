import Link from 'next/link';
import { EmptyState, PageHeader, StaffTag, StatusPill } from '@/components/ui';
import { addDays, dateOf, dayBounds, dayLong, daysBetween, isValidDate, time, today } from '@/lib/time';
import { bookings, catalog } from '@/server/scheduling';

export const metadata = { title: 'Bookings' };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function BookingsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const now = Date.now();
  const staff = catalog().staff();
  const services = catalog().services();

  let from = isValidDate(one(sp.from)) ? one(sp.from) : today(now);
  let to = isValidDate(one(sp.to)) ? one(sp.to) : addDays(from, 13);
  if (daysBetween(from, to) < 0) [from, to] = [to, from];
  // A year is plenty for one screen and keeps a typo from rendering a decade.
  if (daysBetween(from, to) > 366) to = addDays(from, 366);
  const staffId = staff.some((s) => s.id === one(sp.staff)) ? one(sp.staff) : '';
  const serviceId = services.some((s) => s.id === one(sp.service)) ? one(sp.service) : '';
  const status = one(sp.status) === 'confirmed' || one(sp.status) === 'cancelled' ? (one(sp.status) as 'confirmed' | 'cancelled') : '';
  const q = one(sp.q).trim();

  const rows = bookings({
    from: dayBounds(from).from,
    to: dayBounds(to).to,
    ...(staffId ? { resourceId: staffId } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(status ? { status } : {}),
  }).filter((b) => !q || `${b.customerName} ${b.customerEmail}`.toLowerCase().includes(q.toLowerCase()));

  const days = new Map<string, typeof rows>();
  for (const b of rows) {
    const d = dateOf(b.startsAt);
    days.set(d, [...(days.get(d) ?? []), b]);
  }
  const hue = new Map(staff.map((s) => [s.id, s.hue]));
  const cancelled = rows.filter((b) => b.status === 'cancelled').length;
  const filtered = Boolean(staffId || serviceId || status || q || one(sp.from) || one(sp.to));

  return (
    <>
      <PageHeader
        title="Bookings"
        lead={`${rows.length - cancelled} booked${cancelled ? ` and ${cancelled} cancelled` : ''} between ${dayLong(dayBounds(from).from + 12 * 3_600_000)} and ${dayLong(dayBounds(to).from + 12 * 3_600_000)}.`}
      />

      <form className="panel mb-8 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]" role="search" aria-label="Filter bookings">
        <div>
          <label className="label" htmlFor="f-from">From</label>
          <input className="field" type="date" id="f-from" name="from" defaultValue={from} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">To</label>
          <input className="field" type="date" id="f-to" name="to" defaultValue={to} />
        </div>
        <div>
          <label className="label" htmlFor="f-staff">Practitioner</label>
          <select className="field" id="f-staff" name="staff" defaultValue={staffId}>
            <option value="">Everyone</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (former)'}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-service">Service</label>
          <select className="field" id="f-service" name="service" defaultValue={serviceId}>
            <option value="">All services</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (no longer offered)'}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select className="field" id="f-status" name="status" defaultValue={status}>
            <option value="">Booked and cancelled</option>
            <option value="confirmed">Booked only</option>
            <option value="cancelled">Cancelled only</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-q">Patient</label>
          <input className="field" type="search" id="f-q" name="q" defaultValue={q} placeholder="Name or email" autoComplete="off" />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary w-full xl:w-auto" type="submit">Show</button>
          {filtered ? <Link href="/admin/bookings" className="btn-quiet">Reset</Link> : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No bookings match">
          Widen the dates or clear a filter. <Link className="text-accent underline" href="/admin/bookings">Show the next two weeks</Link>.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {[...days.entries()].map(([date, list]) => {
            const booked = list.filter((b) => b.status === 'confirmed').length;
            return (
              <section key={date} aria-labelledby={`d-${date}`}>
                <div className="sticky top-0 z-10 -mx-1 mb-1 flex items-baseline justify-between bg-bg/95 px-1 py-2 backdrop-blur">
                  <h2 id={`d-${date}`} className="font-semibold">
                    {date === today(now) ? 'Today, ' : ''}{dayLong(list[0]!.startsAt)}
                  </h2>
                  <span className="text-sm text-ink-3">{booked} booked{list.length - booked ? `, ${list.length - booked} cancelled` : ''}</span>
                </div>
                <ul className="panel divide-y divide-line-2">
                  {list.map((b) => {
                    const off = b.status === 'cancelled';
                    return (
                      <li key={b.id}>
                        <Link
                          href={`/admin/bookings/${b.id}`}
                          className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[3.5rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_6rem]"
                        >
                          <span className={`tnum font-medium ${off ? 'text-ink-3 line-through' : ''}`}>{time(b.startsAt)}</span>
                          <span className="min-w-0">
                            <span className={`block truncate font-medium ${off ? 'text-ink-3' : ''}`}>{b.customerName}</span>
                            <span className="block truncate text-sm text-ink-3">{b.customerEmail}</span>
                          </span>
                          <span className="col-start-2 row-start-2 truncate text-sm text-ink-2 sm:col-start-auto sm:row-start-auto sm:text-base">
                            {b.serviceName}
                          </span>
                          <span className="hidden text-sm sm:block"><StaffTag name={b.staffName} hue={hue.get(b.staffId)} /></span>
                          <span className="col-start-3 row-start-1 text-right sm:col-start-auto sm:row-start-auto"><StatusPill status={b.status} past={b.endsAt <= now} /></span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
