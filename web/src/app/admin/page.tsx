import Link from 'next/link';
import { DaySheet } from '@/components/DaySheet';
import { EmptyState, PageHeader, SectionTitle, StaffTag } from '@/components/ui';
import { dayFull, dayNum, durationLabel, noonOf, relativeDay, time, today, weekdayShort } from '@/lib/time';
import { agenda, nextFree, weekAhead } from '@/server/dashboard';
import { catalog } from '@/server/scheduling';

export const metadata = { title: 'Today' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const now = Date.now();
  const date = today(now);
  const everyone = catalog().staff();
  const hue = new Map(everyone.map((s) => [s.id, s.hue]));
  const day = agenda(date);
  // The sheet shows who is taking bookings, plus anyone former who still has
  // an appointment today.
  const staff = everyone.filter((s) => s.active || day.some((b) => b.staffId === s.id));
  const confirmed = day.filter((b) => b.status === 'confirmed');
  const cancelled = day.length - confirmed.length;
  const upcoming = confirmed.filter((b) => b.startsAt > now);
  const next = upcoming[0];
  const week = weekAhead(now);
  const free = nextFree(now);
  const maxLoad = Math.max(...week.map((d) => d.bookedMin), 1);

  return (
    <>
      <PageHeader
        title={dayFull(now)}
        lead={
          confirmed.length === 0
            ? 'No appointments today.'
            : <>
                {confirmed.length} appointments today{cancelled ? `, ${cancelled} cancelled` : ''}.{' '}
                {next
                  ? <>Next is <Link className="text-accent underline-offset-4 hover:underline" href={`/admin/bookings/${next.id}`}>{next.customerName} at {time(next.startsAt)}</Link> with {next.staffName.split(' ')[0]}.</>
                  : 'Everyone has been seen.'}
              </>
        }
      >
        <Link href="/admin/bookings" className="btn-quiet">All bookings</Link>
      </PageHeader>
      {sp.done === 'reset' ? (
        <p role="status" className="-mt-4 mb-8 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-ok">
          Demo data reset: a fresh set of invented bookings around today.
        </p>
      ) : null}

      <section aria-labelledby="today-h" className="mb-12">
        <h2 id="today-h" className="sr-only">Today&apos;s agenda</h2>
        <div className="hidden md:block">
          <DaySheet date={date} staff={staff} bookings={day} now={now} />
        </div>
        {/* The same agenda as a list: on a phone, and for anyone reading rather than scanning. */}
        <ol className="panel divide-y divide-line-2 md:hidden">
          {day.length === 0 ? <li className="p-4 text-ink-2">No appointments today.</li> : null}
          {day.map((b) => (
            <li key={b.id}>
              <Link href={`/admin/bookings/${b.id}`} className={`flex items-baseline gap-4 px-4 py-3 ${b.status === 'cancelled' ? 'text-ink-3' : ''}`}>
                <span className={`tnum w-12 shrink-0 font-medium ${b.status === 'cancelled' ? 'line-through' : ''}`}>{time(b.startsAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-medium ${b.status === 'cancelled' ? 'line-through' : ''}`}>{b.customerName}</span>
                  <span className="block truncate text-sm text-ink-2">
                    {b.serviceName}{b.status === 'cancelled' ? ', cancelled' : ''}
                  </span>
                </span>
                <span className="shrink-0 text-sm"><StaffTag name={b.staffName.split(' ')[0]} hue={hue.get(b.staffId)} /></span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="week-h">
          <SectionTitle id="week-h" aside="Share of working time booked">The next seven days</SectionTitle>
          <table className="w-full text-left">
            <thead className="text-sm text-ink-3">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-normal">Day</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Booked</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Cancelled</th>
                <th scope="col" className="w-[42%] py-2 font-normal"><span className="sr-only">Load</span></th>
              </tr>
            </thead>
            <tbody>
              {week.map((d) => {
                const share = d.openMin ? d.bookedMin / d.openMin : 0;
                return (
                  <tr key={d.date} className="border-b border-line-2">
                    <th scope="row" className="py-2.5 pr-3 font-normal">
                      <Link
                        href={`/admin/bookings?from=${d.date}&to=${d.date}`}
                        className="inline-flex items-baseline gap-2 rounded hover:text-accent"
                      >
                        <span className="tnum w-6 text-right text-lg font-semibold">{dayNum(noonOf(d.date))}</span>
                        <span className={d.date === date ? 'font-medium' : 'text-ink-2'}>
                          {d.date === date ? 'Today' : weekdayShort(noonOf(d.date))}
                        </span>
                      </Link>
                    </th>
                    <td className="tnum py-2.5 pr-3 text-right">{d.working ? d.booked : '–'}</td>
                    <td className={`tnum py-2.5 pr-3 text-right ${d.cancelled ? '' : 'text-ink-3'}`}>{d.working ? d.cancelled : '–'}</td>
                    <td className="py-2.5">
                      {d.working ? (
                        <div className="flex items-center gap-3">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${Math.round(share * 100)}% of working time booked`}>
                            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share * 100)}%`, opacity: 0.35 + 0.65 * (d.bookedMin / maxLoad) }} />
                          </div>
                          <span className="tnum w-10 text-right text-sm text-ink-2">{Math.round(share * 100)}%</span>
                        </div>
                      ) : (
                        <span className="text-sm text-ink-3">Closed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="free-h">
          <SectionTitle id="free-h" aside="With anyone who offers it">Next free time</SectionTitle>
          {free.length === 0 ? <EmptyState title="No services yet" /> : (
            <ul className="divide-y divide-line-2 border-y border-line">
              {free.map((f) => (
                <li key={f.serviceId} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate">{f.serviceName}</span>
                    <span className="text-sm text-ink-3">{durationLabel(f.durationMin)}</span>
                  </span>
                  {f.slot ? (
                    <span className="shrink-0 text-right">
                      <span className="block font-medium">{relativeDay(f.slot.start, now)}, <span className="tnum">{time(f.slot.start)}</span></span>
                      <span className="text-sm text-ink-2">{f.slot.staffName}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-ink-3">Nothing free</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-ink-3">
            Notice periods apply, so the first free time can be later than a gap on the sheet.
          </p>
        </section>
      </div>
    </>
  );
}
