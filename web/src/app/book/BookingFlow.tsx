'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TimePicker } from '@/components/TimePicker';
import { dateOf, dayFull, dayShort, durationLabel, time } from '@/lib/time';
import type { ApiError, BookingDTO, ServiceDef, SlotDTO, StaffMember } from '@/lib/types';

type Staff = Pick<StaffMember, 'id' | 'name' | 'role' | 'hue'>;

export function BookingFlow({ services, staff, todayDate, initialService, initialWith }: {
  services: ServiceDef[];
  staff: Staff[];
  todayDate: string;
  initialService: string | null;
  initialWith: string;
}) {
  const [serviceId, setServiceId] = useState<string | null>(initialService);
  const [staffId, setStaffId] = useState(
    initialService && services.find((s) => s.id === initialService)?.staffIds.includes(initialWith) ? initialWith : 'any',
  );
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDTO | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiError['error'] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [done, setDone] = useState<{ booking: BookingDTO; manageUrl: string } | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const offeredBy = staff.filter((s) => service?.staffIds.includes(s.id));

  useEffect(() => { if (problem) problemRef.current?.focus(); }, [problem]);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [done]);

  const chooseService = (id: string) => {
    setServiceId(id);
    setDate(null);
    setSlot(null);
    setProblem(null);
    const svc = services.find((s) => s.id === id);
    if (staffId !== 'any' && !svc?.staffIds.includes(staffId)) setStaffId('any');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!service || !slot) return;
    setPending(true);
    setProblem(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service: service.id, staff: slot.staffId, preference: staffId, startsAt: slot.start, name, email,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const err = (body as ApiError).error;
        setProblem(err);
        if (err.code === 'slot_taken' || err.code === 'not_offered') {
          // What they were looking at is out of date; read it again.
          setSlot(null);
          setRefreshKey((k) => k + 1);
        }
        return;
      }
      setDone(body as { booking: BookingDTO; manageUrl: string });
    } catch {
      setProblem({ code: 'invalid', message: 'We could not reach the clinic’s diary. Check your connection and try again; nothing has been booked.' });
    } finally {
      setPending(false);
    }
  };

  if (done) return <Confirmation booking={done.booking} manageUrl={done.manageUrl} headingRef={doneRef} />;

  return (
    <form onSubmit={submit} className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]" noValidate>
      <div className="min-w-0 space-y-10">
        <Step n={1} title="Treatment">
          <fieldset>
            <legend className="sr-only">Treatment</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((s) => (
                <label
                  key={s.id}
                  className="relative block cursor-pointer rounded-lg border border-line bg-surface p-4 transition-colors hover:border-ink-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                >
                  <input type="radio" name="service" value={s.id} checked={serviceId === s.id} onChange={() => chooseService(s.id)} className="sr-only" />
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{s.name}</span>
                    <span className="tnum shrink-0 text-sm text-ink-2">{durationLabel(s.durationMin)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-ink-2">{s.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Step>

        <Step n={2} title="Day and time" muted={!service}>
          {!service ? (
            <p className="text-ink-3">Choose a treatment first.</p>
          ) : (
            <>
              {offeredBy.length > 1 ? (
                <fieldset className="mb-6">
                  <legend className="label">With</legend>
                  <div className="flex flex-wrap gap-2">
                    {[{ id: 'any', name: 'Whoever is free first' }, ...offeredBy].map((p) => (
                      <label key={p.id} className="cursor-pointer rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                        <input
                          type="radio" name="with" value={p.id} className="sr-only" checked={staffId === p.id}
                          onChange={() => { setStaffId(p.id); setSlot(null); setDate(null); setProblem(null); }}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <TimePicker
                key={`${service.id}:${staffId}`}
                serviceId={service.id}
                staffId={staffId}
                todayDate={todayDate}
                horizonDays={service.maxAdvanceDays}
                date={date}
                onDate={(d) => { setDate(d); setSlot(null); }}
                slot={slot}
                onSlot={(s) => { setSlot(s); setProblem(null); }}
                refreshKey={refreshKey}
                showStaff={staffId === 'any' && offeredBy.length > 1}
              />
            </>
          )}
        </Step>

        <Step n={3} title="Your details" muted={!slot}>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="b-name">Full name</label>
              <input id="b-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </div>
            <div>
              <label className="label" htmlFor="b-email">Email</label>
              <input id="b-email" className="field" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} />
            </div>
          </div>
          <p className="mt-2 max-w-[60ch] text-sm text-ink-3">We use your email to send the confirmation and the link to change it. Nothing else.</p>
        </Step>

        {problem ? (
          <div ref={problemRef} tabIndex={-1} role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-ink outline-none">
            <p className="font-medium text-danger">
              {problem.code === 'slot_taken' ? 'That time has just gone' : problem.code === 'not_offered' ? 'That time is not available' : 'Please check this'}
            </p>
            <p className="mt-1">{problem.message}</p>
            {problem.alternatives?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {problem.alternatives.map((a) => (
                  <button
                    key={`${a.start}-${a.staffId}`}
                    type="button"
                    className="rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-accent"
                    onClick={() => { setDate(dateOf(a.start)); setSlot(a); setProblem(null); }}
                  >
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
          <h2 className="font-semibold">Your appointment</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <Item label="Treatment">{service ? `${service.name}, ${durationLabel(service.durationMin)}` : null}</Item>
            <Item label="When">{slot ? <>{dayFull(slot.start)}<br /><span className="tnum">{time(slot.start)}–{time(slot.end)}</span></> : null}</Item>
            <Item label="With">{slot ? slot.staffName : null}</Item>
          </dl>
          <button type="submit" className="btn-primary mt-5 w-full" disabled={!slot || pending || !name.trim() || !email.trim()}>
            {pending ? 'Booking…' : slot ? `Book ${time(slot.start)}, ${dayShort(slot.start)}` : 'Book appointment'}
          </button>
          {slot && (!name.trim() || !email.trim()) ? (
            <p className="mt-2 text-center text-xs text-ink-3">Add your name and email to book.</p>
          ) : null}
          <p className="mt-3 text-xs text-ink-3">Free to cancel or move from the link we give you.</p>
        </div>
      </aside>
    </form>
  );
}

function Step({ n, title, muted, children }: { n: number; title: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className={`mb-4 flex items-baseline gap-3 text-lg font-semibold ${muted ? 'text-ink-3' : ''}`}>
        <span className={`tnum inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm ${muted ? 'border border-line' : 'bg-ink text-bg'}`} aria-hidden="true">{n}</span>
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

function Confirmation({ booking, manageUrl, headingRef }: { booking: BookingDTO; manageUrl: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const full = `${origin}${manageUrl}`;
  return (
    <div className="mt-8 max-w-2xl">
      <div className="panel overflow-hidden">
        <div className="border-b border-line bg-ok-soft px-5 py-4">
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ok outline-none">You’re booked</h2>
          <p className="text-sm text-ink-2">
            The confirmation is addressed to {booking.customerEmail}. This demo sends no email: the message is in its
            outbox instead, and you can <Link className="text-accent underline" href={`${manageUrl}/mail`}>read it here</Link>.
          </p>
        </div>
        <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div><dt className="text-sm text-ink-3">Treatment</dt><dd className="font-medium">{booking.serviceName}</dd></div>
          <div><dt className="text-sm text-ink-3">With</dt><dd className="font-medium">{booking.staffName}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-ink-3">When</dt>
            <dd className="text-lg font-semibold">{dayFull(booking.startsAt)}, <span className="tnum">{time(booking.startsAt)}–{time(booking.endsAt)}</span></dd>
          </div>
        </dl>
        <div className="border-t border-line-2 bg-surface-2 px-5 py-4">
          <p className="text-sm font-medium">Your link to move or cancel</p>
          <p className="mt-0.5 text-sm text-ink-2">Keep it: anyone with this link can change the appointment.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-3 py-2 text-sm">{full || manageUrl}</code>
            <button
              type="button"
              className="btn-quiet"
              onClick={async () => {
                try { await navigator.clipboard.writeText(full); setCopied(true); } catch { setCopied(false); }
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={manageUrl} className="btn-primary">Open my booking</Link>
        <Link href={`${manageUrl}/mail`} className="btn-quiet">Read the confirmation email</Link>
        <a href="/book" className="btn-quiet">Book another</a>
      </div>
    </div>
  );
}
