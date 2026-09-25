'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TimePicker } from '@/components/TimePicker';
import { dateOf, dayFull, dayShort, durationLabel, relativeDayInline, time } from '@/lib/time';
import type { ApiError, BookingDTO, ServiceDef, SlotDTO, StaffMember } from '@/lib/types';

type Staff = Pick<StaffMember, 'id' | 'name' | 'hue'>;
type Patient = { name: string; email: string; lastSeenAt: number | null; nextStartsAt: number | null };
type Course = {
  seriesId: string;
  booked: BookingDTO[];
  skipped: { startsAt: number; reason: string; code: string; why: string }[];
};

export function NewBookingForm({ services, staff, patients, todayDate, initialPatient }: {
  services: ServiceDef[];
  staff: Staff[];
  patients: Patient[];
  todayDate: string;
  initialPatient: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'existing' | 'new'>(patients.length ? 'existing' : 'new');
  const [filter, setFilter] = useState('');
  const [patientEmail, setPatientEmail] = useState<string | null>(initialPatient);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDTO | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [count, setCount] = useState(6);
  const [every, setEvery] = useState(1);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiError['error'] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [course, setCourse] = useState<Course | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (problem || course) alertRef.current?.focus(); }, [problem, course]);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const offeredBy = staff.filter((s) => service?.staffIds.includes(s.id));
  const patient = mode === 'existing'
    ? patients.find((p) => p.email === patientEmail) ?? null
    : (newName.trim() && newEmail.trim() ? { name: newName.trim(), email: newEmail.trim() } : null);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? patients.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q)) : patients;
    return list.slice(0, 60);
  }, [filter, patients]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!service || !slot || !patient) return;
    setPending(true);
    setProblem(null);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service: service.id, staff: slot.staffId, preference: staffId, startsAt: slot.start,
          name: patient.name, email: patient.email,
          ...(repeat ? { repeat: { count, intervalWeeks: every } } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const err = (body as ApiError).error;
        setProblem(err);
        if (err.code === 'slot_taken' || err.code === 'not_offered') {
          setSlot(null);
          setRefreshKey((k) => k + 1);
        }
        return;
      }
      if (body.course) {
        setCourse(body.course as Course);
        router.refresh();
      } else {
        router.push(`/admin/bookings/${(body.booking as BookingDTO).id}?done=created`);
      }
    } catch {
      setProblem({ code: 'invalid', message: 'The diary could not be reached. Nothing was booked; try again.' });
    } finally {
      setPending(false);
    }
  };

  if (course) return <CourseResult course={course} />;

  const ready = Boolean(service && slot && patient);
  return (
    <form onSubmit={submit} className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_19rem]" noValidate>
      <div className="min-w-0 space-y-10">
        <Step n={1} title="Patient">
          <div className="mb-4 inline-flex rounded-md border border-line bg-surface p-0.5" role="radiogroup" aria-label="Patient">
            {(['existing', 'new'] as const).map((m) => (
              <label key={m} className="cursor-pointer rounded px-3 py-1.5 text-sm has-[:checked]:bg-accent has-[:checked]:text-accent-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                <input type="radio" name="mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                {m === 'existing' ? 'Existing patient' : 'New patient'}
              </label>
            ))}
          </div>
          {mode === 'existing' ? (
            <div className="max-w-xl">
              <label className="sr-only" htmlFor="p-filter">Find a patient</label>
              <input id="p-filter" className="field" type="search" placeholder="Filter by name or email" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
              <fieldset className="mt-2">
                <legend className="sr-only">Choose the patient</legend>
                <div className="panel max-h-64 divide-y divide-line-2 overflow-y-auto">
                  {shown.length === 0 ? <p className="px-3 py-3 text-sm text-ink-3">Nobody matches. Choose “New patient” to add them.</p> : null}
                  {shown.map((p) => (
                    <label key={p.email} className="flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 hover:bg-surface-2 has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent">
                      <input type="radio" name="patient" className="sr-only" checked={patientEmail === p.email} onChange={() => setPatientEmail(p.email)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-sm text-ink-3">{p.email}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-ink-3">
                        {p.nextStartsAt ? `Next ${relativeDayInline(p.nextStartsAt)}` : p.lastSeenAt ? `Seen ${relativeDayInline(p.lastSeenAt)}` : 'Not seen yet'}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {patients.length > shown.length && !filter ? <p className="mt-1 text-xs text-ink-3">Showing the 60 most recent. Filter to find anyone else.</p> : null}
            </div>
          ) : (
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-name">Full name</label>
                <input id="n-name" className="field" value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className="label" htmlFor="n-email">Email</label>
                <input id="n-email" className="field" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="off" />
              </div>
              <p className="text-sm text-ink-3 sm:col-span-2">The confirmation and their link go to this address, through the Outbox.</p>
            </div>
          )}
        </Step>

        <Step n={2} title="Treatment" muted={!patient}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Treatment">
            {services.map((s) => (
              <label key={s.id} className="cursor-pointer rounded-md border border-line bg-surface px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                <input type="radio" name="service" className="sr-only" checked={serviceId === s.id}
                  onChange={() => { setServiceId(s.id); setDate(null); setSlot(null); setProblem(null); if (!s.staffIds.includes(staffId)) setStaffId('any'); }} />
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-sm text-ink-3">{durationLabel(s.durationMin)}</span>
              </label>
            ))}
          </div>
        </Step>

        <Step n={3} title="Practitioner and time" muted={!service}>
          {!service ? <p className="text-ink-3">Choose a treatment first.</p> : (
            <>
              <fieldset className="mb-6">
                <legend className="label">With</legend>
                <div className="flex flex-wrap gap-2">
                  {[{ id: 'any', name: 'Whoever is free first' }, ...offeredBy].map((p) => (
                    <label key={p.id} className="cursor-pointer rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                      <input type="radio" name="with" className="sr-only" checked={staffId === p.id}
                        onChange={() => { setStaffId(p.id); setSlot(null); setDate(null); setProblem(null); }} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <TimePicker
                key={`${service.id}:${staffId}`}
                serviceId={service.id}
                staffId={staffId}
                todayDate={todayDate}
                horizonDays={120}
                date={date}
                onDate={(d) => { setDate(d); setSlot(null); }}
                slot={slot}
                onSlot={(s) => { setSlot(s); setProblem(null); }}
                refreshKey={refreshKey}
                showStaff={staffId === 'any' && offeredBy.length > 1}
                rules="desk"
              />
            </>
          )}
        </Step>

        <Step n={4} title="Repeat" muted={!slot}>
          <fieldset className="space-y-3">
            <legend className="sr-only">Repeat</legend>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="repeat" checked={!repeat} onChange={() => setRepeat(false)} className="accent-[var(--accent)]" />
              Just this appointment
            </label>
            <label className="flex cursor-pointer flex-wrap items-center gap-2">
              <input type="radio" name="repeat" checked={repeat} onChange={() => setRepeat(true)} className="accent-[var(--accent)]" />
              A course of
              <select aria-label="Number of sessions" className="field w-20 py-1" value={count} onChange={(e) => { setCount(Number(e.target.value)); setRepeat(true); }}>
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              sessions,
              <select aria-label="How often" className="field w-40 py-1" value={every} onChange={(e) => { setEvery(Number(e.target.value)); setRepeat(true); }}>
                <option value={1}>every week</option>
                <option value={2}>every two weeks</option>
                <option value={3}>every three weeks</option>
                <option value={4}>every four weeks</option>
              </select>
            </label>
            {repeat ? (
              <p className="max-w-[62ch] text-sm text-ink-3">
                Same practitioner, same time of day{slot ? `, starting ${dayShort(slot.start)} at ${time(slot.start)}` : ''}.
                Dates that cannot be booked, because of a day away or another appointment, are skipped and listed afterwards; the rest are booked.
              </p>
            ) : null}
          </fieldset>
        </Step>

        {problem ? (
          <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-4 outline-none">
            <p className="font-medium text-danger">
              {problem.code === 'slot_taken' ? 'That time has just gone' : problem.code === 'not_offered' ? 'That time is not available' : 'Please check this'}
            </p>
            <p className="mt-1 text-ink">{problem.message}</p>
            {problem.alternatives?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {problem.alternatives.map((a) => (
                  <button key={`${a.start}-${a.staffId}`} type="button" className="rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-accent"
                    onClick={() => { setDate(dateOf(a.start)); setSlot(a); setProblem(null); }}>
                    <span className="block font-medium">{dayShort(a.start)}, <span className="tnum">{time(a.start)}</span></span>
                    <span className="block text-xs text-ink-2">with {a.staffName}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="panel p-5">
          <h2 className="font-semibold">Booking</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <Item label="Patient">{patient ? <>{patient.name}<br /><span className="text-ink-3">{patient.email}</span></> : null}</Item>
            <Item label="Treatment">{service ? `${service.name}, ${durationLabel(service.durationMin)}` : null}</Item>
            <Item label="When">{slot ? <>{dayFull(slot.start)}<br /><span className="tnum">{time(slot.start)}–{time(slot.end)}</span></> : null}</Item>
            <Item label="With">{slot?.staffName ?? null}</Item>
            {repeat ? <Item label="Course">{`${count} sessions, ${every === 1 ? 'weekly' : `every ${every} weeks`}`}</Item> : null}
          </dl>
          <button type="submit" className="btn-primary mt-5 w-full" disabled={!ready || pending}>
            {pending ? 'Booking…' : !ready ? 'Book' : repeat ? `Book ${count} sessions` : `Book ${time(slot!.start)}, ${dayShort(slot!.start)}`}
          </button>
          <p className="mt-3 text-xs text-ink-3">A confirmation with their link goes to the Outbox.</p>
        </div>
      </aside>
    </form>
  );
}

function CourseResult({ course }: { course: Course }) {
  const [first] = course.booked;
  return (
    <div className="max-w-3xl space-y-6" tabIndex={-1}>
      <div role="status" className={`rounded-lg border p-5 ${course.skipped.length ? 'border-notice/30 bg-notice-soft' : 'border-ok/30 bg-ok-soft'}`}>
        <h2 className={`text-lg font-semibold ${course.skipped.length ? 'text-notice' : 'text-ok'}`}>
          {course.booked.length} of {course.booked.length + course.skipped.length} sessions booked
        </h2>
        <p className="mt-1 text-ink-2">
          {course.skipped.length
            ? 'The dates below could not be booked and are not part of the course. The patient’s confirmation lists them too.'
            : 'Every session is booked. One confirmation listing them all is in the Outbox.'}
        </p>
      </div>
      <section aria-label="Booked">
        <h3 className="mb-2 font-semibold">Booked</h3>
        <ul className="panel divide-y divide-line-2">
          {course.booked.map((b) => (
            <li key={b.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <Link href={`/admin/bookings/${b.id}`} className="hover:text-accent">{dayFull(b.startsAt)}, <span className="tnum">{time(b.startsAt)}</span></Link>
              <span className="text-sm text-ink-3">{b.staffName}</span>
            </li>
          ))}
        </ul>
      </section>
      {course.skipped.length ? (
        <section aria-label="Skipped">
          <h3 className="mb-2 font-semibold">Skipped</h3>
          <ul className="panel divide-y divide-line-2">
            {course.skipped.map((s) => (
              <li key={s.startsAt} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-ink-3 line-through">{dayFull(s.startsAt)}, {time(s.startsAt)}</span>
                <span className="text-sm text-ink-2">{s.why}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {first ? <Link href={`/admin/bookings/${first.id}`} className="btn-primary">Open the first session</Link> : null}
        <Link href="/admin/outbox" className="btn-quiet">See the confirmation</Link>
        <button type="button" className="btn-quiet" onClick={() => window.location.assign('/admin/bookings/new')}>Book another</button>
      </div>
    </div>
  );
}

function Step({ n, title, muted, children }: { n: number; title: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`nb-${n}`}>
      <h2 id={`nb-${n}`} className={`mb-4 flex items-baseline gap-3 text-lg font-semibold ${muted ? 'text-ink-3' : ''}`}>
        <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm ${muted ? 'border border-line' : 'bg-ink text-bg'}`} aria-hidden="true">{n}</span>
        {title}
      </h2>
      <div className="sm:pl-10">{children}</div>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className={children ? 'text-ink' : 'text-ink-3'}>{children ?? 'Not chosen yet'}</dd>
    </div>
  );
}
