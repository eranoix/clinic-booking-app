import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, SectionTitle, StaffTag, StatusPill } from '@/components/ui';
import {
  dateOf, dayFull, dayLong, dayNum, durationLabel, isValidDate, monthShort, noonOf, time, today, weekdayShort,
} from '@/lib/time';
import { bookingById, bookings, catalog, dayCounts, engine, slotsOn } from '@/server/scheduling';
import { CancelCourseForm, CancelForm, RescheduleForm } from './BookingActions';

export const metadata = { title: 'Booking' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BookingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const b = /^\d+$/.test(id) ? bookingById(Number(id)) : null;
  if (!b) notFound();

  const now = Date.now();
  const member = catalog().member(b.staffId);
  const service = catalog().service(b.serviceId);
  const past = b.endsAt <= now;
  const live = b.status === 'confirmed' && !past;
  const done = typeof sp.done === 'string' ? sp.done : '';

  // Who it can move to: anyone active who offers the service. Staying with
  // the same person is the default when they are still taking bookings.
  const movable = catalog().staff().filter((s) => s.active && service?.staffIds.includes(s.id));
  const target = movable.find((s) => s.id === sp.staff)
    ?? movable.find((s) => s.id === b.staffId) ?? movable[0] ?? null;
  const firstDay = today(now);
  const bookingDay = dateOf(b.startsAt);
  const strip = live && target ? dayCounts(b.serviceId, target.id, firstDay, 14, 'desk') : [];
  // Open on the booking's own day when it has room, else on the first day that does.
  const fallback = strip.find((d) => d.date === bookingDay && d.count > 0)?.date
    ?? strip.find((d) => d.count > 0)?.date ?? firstDay;
  const wanted = typeof sp.date === 'string' && isValidDate(sp.date) ? sp.date : fallback;
  const slots = live && target ? slotsOn(b.serviceId, target.id, wanted, 'desk') : [];
  const qs = (extra: Record<string, string>) =>
    `?${new URLSearchParams({ ...(target ? { staff: target.id } : {}), ...extra }).toString()}`;
  const messages = engine().outbox({ bookingId: b.id, ...(b.seriesId ? { seriesId: b.seriesId } : {}), limit: 20 });

  const history = bookings({ customerEmail: b.customerEmail, order: 'desc' }).filter((x) => x.id !== b.id).slice(0, 6);
  const series = b.seriesId ? engine().seriesOf(b.seriesId) : [];
  const position = series.findIndex((x) => x.id === b.id);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-3">
        <Link href="/admin/bookings" className="hover:text-accent">Bookings</Link>
        <span aria-hidden="true"> / </span>
        <span>{b.customerName}</span>
      </nav>

      <PageHeader
        title={b.customerName}
        lead={<>{b.serviceName}, {dayFull(b.startsAt)} at <span className="tnum">{time(b.startsAt)}</span></>}
      >
        <StatusPill status={b.status} past={past} />
      </PageHeader>

      {done === 'moved' ? (
        <p role="status" className="mb-6 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-ok">
          Moved to {dayLong(b.startsAt)} at {time(b.startsAt)} with {b.staffName}. The patient’s link still works and shows the new time; a notice is in the <Link className="underline" href="/admin/outbox">Outbox</Link>.
        </p>
      ) : null}
      {done === 'created' ? (
        <p role="status" className="mb-6 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-ok">
          Booked. The confirmation with {b.customerName.split(' ')[0]}’s link is in the <Link className="underline" href="/admin/outbox">Outbox</Link>.
        </p>
      ) : null}
      {done === 'course-cancelled' ? (
        <p role="status" className="mb-6 rounded-md border border-line bg-surface-2 px-4 py-3 text-ink-2">
          Cancelled {typeof sp.n === 'string' ? sp.n : 'the remaining'} sessions of the course, from this one on. Earlier sessions are unchanged.
        </p>
      ) : null}
      {done === 'cancelled' ? (
        <p role="status" className="mb-6 rounded-md border border-line bg-surface-2 px-4 py-3 text-ink-2">
          Cancelled. {time(b.startsAt)} on {dayLong(b.startsAt)} is free for others to book again.
        </p>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {live ? (
            <section aria-labelledby="move-h">
              <SectionTitle id="move-h" aside={durationLabel(service?.durationMin ?? 0)}>Move to another time or practitioner</SectionTitle>
              <p className="mb-4 max-w-[62ch] text-ink-2">
                Only times the diary can actually offer are shown: inside the practitioner’s hours and clear of other
                appointments. The front desk may book inside the online notice period.
              </p>
              {movable.length > 1 ? (
                <nav aria-label="Move to practitioner" className="mb-5 flex flex-wrap gap-2">
                  {movable.map((p) => (
                    <Link
                      key={p.id}
                      href={`/admin/bookings/${b.id}?staff=${p.id}`}
                      scroll={false}
                      aria-current={p.id === target?.id ? 'true' : undefined}
                      className={`hue-${p.hue} inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm ${
                        p.id === target?.id ? 'border-[var(--hue)] bg-[var(--hue-soft)] font-medium' : 'border-line bg-surface text-ink-2 hover:text-ink'
                      }`}
                    >
                      <span className="size-2 rounded-full bg-[var(--hue)]" aria-hidden="true" />
                      {p.name}{p.id === b.staffId ? ' (now)' : ''}
                    </Link>
                  ))}
                </nav>
              ) : null}
              {!target ? <p className="text-ink-2">Nobody active offers this service any more, so it cannot be moved. It can still be cancelled.</p> : null}
              <ul className="mb-6 flex gap-1.5 overflow-x-auto pb-1" aria-label="Choose a day">
                {strip.map((d) => {
                  const current = d.date === wanted;
                  return (
                    <li key={d.date} className="shrink-0">
                      <Link
                        href={`/admin/bookings/${b.id}${qs({ date: d.date })}`}
                        scroll={false}
                        aria-current={current ? 'date' : undefined}
                        className={`flex w-14 flex-col items-center rounded-md border py-2 text-center ${
                          current ? 'border-accent bg-accent text-accent-ink' : d.count ? 'border-line bg-surface hover:border-accent' : 'border-line-2 text-ink-3'
                        }`}
                      >
                        <span className="text-xs">{weekdayShort(noonOf(d.date))}</span>
                        <span className="tnum text-lg font-semibold leading-6">{dayNum(noonOf(d.date))}</span>
                        <span className={`text-xs ${current ? '' : 'text-ink-3'}`}>{d.count ? `${d.count} free` : 'None'}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <h3 className="mb-3 font-medium">{dayLong(noonOf(wanted))}</h3>
              {target ? (
                <RescheduleForm key={`${wanted}:${target.id}`} id={b.id} slots={slots} staffId={target.id} staffName={target.name} moving={target.id !== b.staffId} />
              ) : null}
            </section>
          ) : (
            <section className="rounded-md border border-line bg-surface-2 px-4 py-3 text-ink-2">
              {b.status === 'cancelled'
                ? `This appointment was cancelled${b.updatedAt ? ` on ${dayLong(b.updatedAt)}` : ''}. The record is kept so the history stays complete.`
                : 'This appointment has already taken place, so it can no longer be moved or cancelled.'}
            </section>
          )}

          {series.length ? (
            <section aria-labelledby="series-h">
              <SectionTitle id="series-h" aside={`Session ${position + 1} of ${series.length}`}>Course of treatment</SectionTitle>
              {live && series.filter((x) => x.startsAt >= b.startsAt && x.status === 'confirmed').length > 1 ? (
                <div className="mb-3">
                  <CancelCourseForm id={b.id} count={series.filter((x) => x.startsAt >= b.startsAt && x.status === 'confirmed').length} />
                </div>
              ) : null}
              <ol className="panel divide-y divide-line-2">
                {series.map((s) => (
                  <li key={s.id} className={`flex items-baseline justify-between gap-4 px-4 py-2.5 ${s.id === b.id ? 'bg-accent-soft' : ''}`}>
                    <Link href={`/admin/bookings/${s.id}`} className={`tnum hover:text-accent ${s.status === 'cancelled' ? 'text-ink-3 line-through' : ''}`}>
                      {dayLong(s.startsAt)}, {time(s.startsAt)}
                    </Link>
                    <StatusPill status={s.status} past={s.endsAt <= now} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

        <aside className="space-y-8">
          <dl className="panel divide-y divide-line-2 text-sm">
            <Row label="Patient">
              <Link className="text-accent hover:underline" href={`/admin/patients/${encodeURIComponent(b.customerEmail.toLowerCase())}`}>{b.customerName}</Link>
              <span className="block break-all text-ink-3">{b.customerEmail}</span>
            </Row>
            <Row label="Practitioner">{member ? <StaffTag member={member} /> : b.staffName}</Row>
            <Row label="Time"><span className="tnum">{time(b.startsAt)}–{time(b.endsAt)}</span></Row>
            <Row label="Booked">{dayLong(b.createdAt)}</Row>
            {b.updatedAt !== b.createdAt ? <Row label="Last change">{dayLong(b.updatedAt)}</Row> : null}
            <Row label="Patient’s link">
              <Link className="break-all text-accent hover:underline" href={`/b/${b.token}`}>/b/{b.token.slice(0, 8)}…</Link>
              <span className="block text-ink-3">Where they can move or cancel it themselves.</span>
            </Row>
          </dl>
          {live ? <CancelForm id={b.id} name={b.customerName.split(' ')[0]!} /> : null}

          <section aria-labelledby="msg-h">
            <h2 id="msg-h" className="mb-2 font-semibold">Messages sent</h2>
            {messages.length === 0 ? (
              <p className="text-sm text-ink-3">None for this appointment.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {messages.map((m) => (
                  <li key={m.id}>
                    <Link href={`/admin/outbox/${m.id}`} className="block truncate hover:text-accent">{m.subject}</Link>
                    <span className="text-xs text-ink-3">{dayLong(m.createdAt)}, {time(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {history.length ? (
            <section aria-labelledby="hist-h">
              <h2 id="hist-h" className="mb-2 font-semibold">Other appointments</h2>
              <ul className="space-y-1.5 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-3">
                    <Link href={`/admin/bookings/${h.id}`} className={`hover:text-accent ${h.status === 'cancelled' ? 'text-ink-3 line-through' : ''}`}>
                      {h.serviceName}
                    </Link>
                    <span className="tnum shrink-0 text-ink-3">{dayNum(h.startsAt)} {monthShort(h.startsAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-3">
      <dt className="text-ink-3">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

