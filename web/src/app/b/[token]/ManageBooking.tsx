'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TimePicker } from '@/components/TimePicker';
import { dateOf, dayFull, dayShort, time } from '@/lib/time';
import type { ApiError, BookingDTO, SlotDTO } from '@/lib/types';

type Mode = 'view' | 'move' | 'cancel';

export function ManageBooking({ initial, horizonDays, todayDate }: { initial: BookingDTO; horizonDays: number; todayDate: string }) {
  const [booking, setBooking] = useState(initial);
  const [mode, setMode] = useState<Mode>('view');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDTO | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiError['error'] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Rendered on the server and again in the browser: compare against a clock
  // read once, so both agree on whether the appointment has passed.
  const [now] = useState(() => Date.now());

  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  const past = booking.endsAt <= now;
  const cancelled = booking.status === 'cancelled';

  const call = async (path: string, body?: object) => {
    setPending(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(booking.token)}/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) {
        setProblem((json as ApiError).error);
        return null;
      }
      return (json as { booking: BookingDTO }).booking;
    } catch {
      setProblem({ code: 'invalid', message: 'We could not reach the clinic’s diary. Nothing has changed; try again.' });
      return null;
    } finally {
      setPending(false);
    }
  };

  const move = async () => {
    if (!slot) return;
    const b = await call('reschedule', { startsAt: slot.start });
    if (b) {
      setBooking(b);
      setMode('view');
      setSlot(null);
      setNotice(`Moved to ${dayFull(b.startsAt)} at ${time(b.startsAt)}. This link still works for the new time, and a notice is with your emails.`);
    } else {
      setSlot(null);
      setRefreshKey((k) => k + 1);
    }
  };

  const cancel = async () => {
    const b = await call('cancel');
    if (b) {
      setBooking(b);
      setMode('view');
      setNotice('Cancelled. The time is free again for someone else, and a notice is with your emails.');
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
        {cancelled ? 'This appointment is cancelled' : past ? 'This appointment has passed' : 'Your appointment'}
      </h1>
      <p className="mt-1.5 text-ink-2">
        Booked for {booking.customerName}. <Link className="text-accent hover:underline" href={`/b/${booking.token}/mail`}>Emails about this appointment</Link>
      </p>

      {notice ? (
        <p ref={noticeRef} tabIndex={-1} role="status" className="mt-6 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-ok outline-none">{notice}</p>
      ) : null}

      <div className={`panel mt-6 overflow-hidden ${cancelled ? 'opacity-80' : ''}`}>
        <dl className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <dt className="text-sm text-ink-3">When</dt>
            <dd className={`text-lg font-semibold ${cancelled ? 'text-ink-3 line-through' : ''}`}>
              {dayFull(booking.startsAt)}, <span className="tnum">{time(booking.startsAt)}–{time(booking.endsAt)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-3">Treatment</dt>
            <dd className="font-medium">{booking.serviceName}</dd>
            <dd className="text-sm text-ink-2">with {booking.staffName}</dd>
          </div>
        </dl>
        {!cancelled && !past && mode === 'view' ? (
          <div className="flex flex-wrap gap-3 border-t border-line-2 bg-surface-2 px-5 py-4">
            <button type="button" className="btn-primary" onClick={() => { setMode('move'); setNotice(null); setDate(dateOf(booking.startsAt) >= todayDate ? dateOf(booking.startsAt) : null); }}>
              Move to another time
            </button>
            <button type="button" className="btn-danger" onClick={() => { setMode('cancel'); setNotice(null); }}>
              Cancel appointment
            </button>
          </div>
        ) : null}
      </div>

      {cancelled || past ? (
        <div className="mt-6">
          <Link href="/book" className="btn-primary">Book a new appointment</Link>
        </div>
      ) : null}

      {problem ? (
        <div role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger-soft p-4">
          <p className="font-medium text-danger">{problem.code === 'slot_taken' ? 'That time has just gone' : 'That did not work'}</p>
          <p className="mt-1 text-ink">{problem.message}</p>
          {problem.alternatives?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {problem.alternatives.map((a) => (
                <button key={a.start} type="button" className="rounded-md border border-line bg-surface px-3 py-2 hover:border-accent"
                  onClick={() => { setDate(dateOf(a.start)); setSlot(a); setProblem(null); }}>
                  <span className="font-medium">{dayShort(a.start)}, <span className="tnum">{time(a.start)}</span></span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'move' ? (
        <section aria-labelledby="move-h" className="mt-10">
          <h2 id="move-h" className="text-lg font-semibold">Choose a new time with {booking.staffName.split(' ')[0]}</h2>
          <p className="mb-5 mt-1 text-sm text-ink-2">Your current time stays booked until the new one is confirmed.</p>
          <TimePicker
            serviceId={booking.serviceId}
            staffId={booking.staffId}
            todayDate={todayDate}
            horizonDays={horizonDays}
            date={date}
            onDate={(d) => { setDate(d); setSlot(null); }}
            slot={slot}
            onSlot={(s) => { setSlot(s); setProblem(null); }}
            refreshKey={refreshKey}
            showStaff={false}
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn-primary" disabled={!slot || pending} onClick={move}>
              {pending ? 'Moving…' : slot ? `Move to ${dayShort(slot.start)}, ${time(slot.start)}` : 'Choose a time'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => { setMode('view'); setSlot(null); setProblem(null); }}>Keep current time</button>
          </div>
        </section>
      ) : null}

      {mode === 'cancel' ? (
        <section aria-labelledby="cancel-h" className="mt-8 rounded-lg border border-danger/30 bg-danger-soft p-5">
          <h2 id="cancel-h" className="font-semibold">Cancel this appointment?</h2>
          <p className="mt-1 text-ink-2">The time is released for someone else. If you change your mind you will need to book again.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn bg-danger text-surface hover:opacity-90" disabled={pending} onClick={cancel}>
              {pending ? 'Cancelling…' : 'Yes, cancel it'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setMode('view')} autoFocus>Keep it</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
