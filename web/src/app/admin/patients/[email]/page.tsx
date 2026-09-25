import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, SectionTitle, StaffTag, StatusPill } from '@/components/ui';
import { dayFull, relativeDay, time } from '@/lib/time';
import type { StaffMember } from '@/lib/types';
import { bookings, catalog, engine } from '@/server/scheduling';

export const metadata = { title: 'Patient' };

export default async function PatientPage({ params }: { params: Promise<{ email: string }> }) {
  const email = decodeURIComponent((await params).email);
  const history = bookings({ customerEmail: email, order: 'desc' });
  const summary = engine().customers().find((c) => c.email === email.toLowerCase());
  if (!history.length || !summary) notFound();

  const now = Date.now();
  const hue = new Map(catalog().staff().map((s) => [s.id, s.hue]));
  const upcoming = history.filter((b) => b.startsAt > now).reverse();
  const past = history.filter((b) => b.startsAt <= now);
  const seenBy = [...new Set(past.filter((b) => b.status === 'confirmed').map((b) => b.staffName))];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-3">
        <Link href="/admin/patients" className="hover:text-accent">Patients</Link>
        <span aria-hidden="true"> / </span>
        <span>{summary.name}</span>
      </nav>
      <PageHeader
        title={summary.name}
        lead={<><a className="text-accent hover:underline" href={`mailto:${summary.email}`}>{summary.email}</a>{seenBy.length ? `. Seen by ${new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(seenBy)}.` : '.'}</>}
      >
        <Link href={`/admin/bookings/new?patient=${encodeURIComponent(summary.email)}`} className="btn-primary">Book for {summary.name.split(' ')[0]}</Link>
        <Link href={`/admin/outbox?to=${encodeURIComponent(summary.email)}`} className="btn-quiet">Their emails</Link>
      </PageHeader>

      <dl className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          ['Visits', summary.confirmed - summary.upcoming],
          ['Booked ahead', summary.upcoming],
          ['Cancelled', summary.cancelled],
          ['First appointment', relativeDay(summary.firstStartsAt, now)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-sm text-ink-3">{k}</dt>
            <dd className="tnum mt-0.5 text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-10">
        <History title="Coming up" list={upcoming} now={now} hue={hue} empty="Nothing booked ahead." />
        <History title="History" list={past} now={now} hue={hue} empty="No past appointments yet." />
      </div>
    </>
  );
}

function History({ title, list, now, hue, empty }: {
  title: string;
  list: ReturnType<typeof bookings>;
  now: number;
  hue: Map<string, StaffMember['hue']>;
  empty: string;
}) {
  return (
    <section aria-label={title}>
      <SectionTitle aside={list.length ? `${list.length}` : undefined}>{title}</SectionTitle>
      {list.length === 0 ? <p className="text-ink-3">{empty}</p> : (
        <ul className="panel divide-y divide-line-2">
          {list.map((b) => (
            <li key={b.id}>
              <Link href={`/admin/bookings/${b.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_6rem]">
                <span className={b.status === 'cancelled' ? 'text-ink-3 line-through' : ''}>
                  {dayFull(b.startsAt)}, <span className="tnum">{time(b.startsAt)}</span>
                </span>
                <span className="row-start-2 truncate text-sm text-ink-2 sm:row-start-auto sm:text-base">{b.serviceName}</span>
                <span className="hidden text-sm sm:block"><StaffTag name={b.staffName} hue={hue.get(b.staffId)} /></span>
                <span className="col-start-2 row-start-1 text-right sm:col-start-auto sm:row-start-auto"><StatusPill status={b.status} past={b.endsAt <= now} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
