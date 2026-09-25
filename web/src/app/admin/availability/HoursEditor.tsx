'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { slots, windowsForDate, type Calendar, type Interval, type WeeklyRule } from 'clinic-booking-app/availability';
import {
  WEEKDAYS, WEEK_ORDER, addDays, dayBounds, dayLong, dayShort, durationLabel, minutesOf, noonOf, time, weekdayOf,
} from '@/lib/time';
import { TimeSelect } from '@/components/TimeSelect';
import type { ExceptionWithNote, ServiceDef, StaffMember } from '@/lib/types';
import {
  busyAction, putExceptionAction, removeExceptionAction, saveHoursAction, type HoursResult,
} from '../actions';

type Win = { start: string; end: string };
type Week = Record<number, Win[]>;

function toWeek(rules: WeeklyRule[]): Week {
  const w: Week = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rules) w[r.weekday]!.push({ start: r.start, end: r.end });
  for (const d of Object.keys(w)) w[Number(d)]!.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  return w;
}

function toRules(week: Week): WeeklyRule[] {
  return Object.entries(week).flatMap(([d, ws]) => ws.map((w) => ({ weekday: Number(d), ...w })));
}

const same = (a: Week, b: Week) => JSON.stringify(toRules(a)) === JSON.stringify(toRules(b));

/** A problem with one day's windows, or null. Mirrors the server's check so mistakes show before saving. */
function problemWith(ws: Win[]): string | null {
  const sorted = [...ws].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (const w of sorted) {
    if (!w.start || !w.end) return 'Fill in both times.';
    if (minutesOf(w.end) <= minutesOf(w.start)) return `${w.start}–${w.end} ends before it starts.`;
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (minutesOf(sorted[i]!.start) < minutesOf(sorted[i - 1]!.end)) return 'Two periods overlap.';
  }
  return null;
}

export function HoursEditor({ member, services, exceptions, todayDate }: {
  member: StaffMember;
  services: ServiceDef[];
  exceptions: ExceptionWithNote[];
  todayDate: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Week>(() => toWeek(member.calendar.weekly));
  const [draft, setDraft] = useState<Week>(() => toWeek(member.calendar.weekly));
  const [result, setResult] = useState<HoursResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = !same(saved, draft);
  const problems = Object.fromEntries(Object.entries(draft).map(([d, ws]) => [d, problemWith(ws)]));
  const invalid = Object.values(problems).some(Boolean);

  const firstName = member.name.split(' ')[0]!;

  const update = (day: number, fn: (ws: Win[]) => Win[]) => {
    setResult(null);
    setDraft((d) => ({ ...d, [day]: fn(d[day] ?? []) }));
  };

  const save = () => start(async () => {
    const r = await saveHoursAction(member.id, toRules(draft));
    setResult(r);
    if (r.ok) {
      setSaved(draft);
      router.refresh();
    }
  });

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-12">
        <section aria-labelledby="weekly-h">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="weekly-h" className="text-lg font-semibold">Weekly hours</h2>
            <p className="text-sm text-ink-3">Add a second period for a lunch break.</p>
          </div>
          <div className="panel divide-y divide-line-2">
            {WEEK_ORDER.map((day) => {
              const ws = draft[day] ?? [];
              const changed = JSON.stringify(ws) !== JSON.stringify(saved[day] ?? []);
              return (
                <fieldset key={day} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <legend className="sr-only">{WEEKDAYS[day]}</legend>
                  <div className="flex items-center gap-2 pt-1.5 font-medium" aria-hidden="true">
                    {WEEKDAYS[day]}
                    {changed ? <span className="size-1.5 rounded-full bg-accent" title="Changed, not saved" /> : null}
                  </div>
                  <div className="space-y-2">
                    {ws.length === 0 ? <p className="pt-1.5 text-ink-3">Not working</p> : null}
                    {ws.map((w, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <TimeSelect
                          id={`h-${day}-${i}-s`} label={`${WEEKDAYS[day]} period ${i + 1} starts`} value={w.start}
                          onChange={(v) => update(day, (xs) => xs.map((x, j) => (j === i ? { ...x, start: v } : x)))}
                        />
                        <span className="text-ink-3" aria-hidden="true">to</span>
                        <TimeSelect
                          id={`h-${day}-${i}-e`} label={`${WEEKDAYS[day]} period ${i + 1} ends`} value={w.end}
                          onChange={(v) => update(day, (xs) => xs.map((x, j) => (j === i ? { ...x, end: v } : x)))}
                        />
                        <button
                          type="button" className="rounded-md px-2 py-1.5 text-sm text-ink-3 hover:text-danger"
                          onClick={() => update(day, (xs) => xs.filter((_, j) => j !== i))}
                          aria-label={`Remove ${WEEKDAYS[day]} ${w.start} to ${w.end}`}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-4">
                      <button
                        type="button" className="text-sm text-accent hover:underline"
                        onClick={() => update(day, (xs) => {
                          const last = xs.at(-1);
                          const from = last ? Math.min(minutesOf(last.end) + 60, 21 * 60) : 9 * 60;
                          const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                          return [...xs, { start: hh(from), end: hh(Math.min(from + 240, 22 * 60)) }];
                        })}
                      >
                        {ws.length ? 'Add another period' : 'Add hours'}
                      </button>
                      {problems[day] ? <span className="text-sm text-danger" role="alert">{problems[day]}</span> : null}
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={!dirty || invalid || pending} onClick={save}>
              {pending ? 'Saving…' : 'Save weekly hours'}
            </button>
            {dirty ? (
              <button type="button" className="btn-quiet" onClick={() => { setDraft(saved); setResult(null); }}>
                Discard changes
              </button>
            ) : null}
            {dirty && !invalid ? <span className="text-sm text-ink-3">The preview already shows these changes.</span> : null}
          </div>
          <SaveResult result={result} firstName={firstName} />
        </section>

        <ExceptionsSection member={member} exceptions={exceptions} todayDate={todayDate} onResult={setResult} />
      </div>

      <Preview
        member={member}
        services={services}
        saved={member.calendar}
        draft={{ ...member.calendar, weekly: toRules(invalid ? saved : draft) }}
        dirty={dirty && !invalid}
        todayDate={todayDate}
      />
    </div>
  );
}

function SaveResult({ result, firstName }: { result: HoursResult | null; firstName: string }) {
  if (!result) return null;
  if (result.error) {
    return <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{result.error}</p>;
  }
  const outside = result.outside ?? [];
  return (
    <div role="status" className={`mt-4 rounded-md border px-4 py-3 text-sm ${outside.length ? 'border-notice/30 bg-notice-soft text-notice' : 'border-ok/30 bg-ok-soft text-ok'}`}>
      {outside.length === 0 ? (
        <p>Saved. Every upcoming appointment still falls inside {firstName}’s hours.</p>
      ) : (
        <>
          <p>
            Saved. {outside.length === 1 ? 'One upcoming appointment is' : `${outside.length} upcoming appointments are`} now outside {firstName}’s hours.
            {' '}{outside.length === 1 ? 'It is' : 'They are'} still booked; nothing was cancelled. Contact the {outside.length === 1 ? 'patient' : 'patients'} to move {outside.length === 1 ? 'it' : 'them'}:
          </p>
          <ul className="mt-2 space-y-1 text-ink">
            {outside.slice(0, 8).map((b) => (
              <li key={b.id}>
                <Link className="underline underline-offset-2" href={`/admin/bookings/${b.id}`}>
                  {dayShort(b.startsAt)}, {time(b.startsAt)}: {b.customerName}
                </Link>
              </li>
            ))}
          </ul>
          {outside.length > 8 ? <p className="mt-1">and {outside.length - 8} more.</p> : null}
        </>
      )}
    </div>
  );
}

function ExceptionsSection({ member, exceptions, todayDate, onResult }: {
  member: StaffMember;
  exceptions: ExceptionWithNote[];
  todayDate: string;
  onResult: (r: HoursResult) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<'closed' | 'open'>('closed');
  const [date, setDate] = useState(addDays(todayDate, 7));
  const [note, setNote] = useState('');
  const [windows, setWindows] = useState<Win[]>([{ start: '09:00', end: '13:00' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const existing = exceptions.find((e) => e.date === date);

  const add = () => start(async () => {
    const r = await putExceptionAction(member.id, { date, kind, note, windows });
    if (r.error) { setError(r.error); return; }
    setError(null);
    setNote('');
    onResult(r);
    router.refresh();
  });

  const remove = (d: string) => start(async () => {
    const r = await removeExceptionAction(member.id, d);
    onResult(r);
    router.refresh();
  });

  return (
    <section aria-labelledby="exc-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="exc-h" className="text-lg font-semibold">Days that differ</h2>
        <p className="text-sm text-ink-3">A closed day removes it. An open day replaces that day’s usual hours.</p>
      </div>

      {exceptions.length ? (
        <ul className="panel mb-6 divide-y divide-line-2">
          {exceptions.map((e) => (
            <li key={e.date} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
              <div>
                <span className="font-medium">{dayLong(noonOf(e.date))}</span>
                <span className="ml-3 text-ink-2">
                  {e.kind === 'closed'
                    ? 'Closed all day'
                    : `Open ${(e.windows ?? []).map((w) => `${w.start}–${w.end}`).join(', ')}`}
                </span>
                {e.note ? <span className="block text-sm text-ink-3">{e.note}</span> : null}
              </div>
              <button type="button" className="text-sm text-ink-3 hover:text-danger" disabled={pending} onClick={() => remove(e.date)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-ink-3">No upcoming exceptions. The weekly hours apply every week.</p>
      )}

      <div className="panel space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div>
            <label className="label" htmlFor="exc-date">Date</label>
            <input id="exc-date" type="date" className="field" min={todayDate} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <fieldset>
            <legend className="label">On that day</legend>
            <div className="flex flex-wrap gap-2">
              {(['closed', 'open'] as const).map((k) => (
                <label key={k} className={`cursor-pointer rounded-md border px-3 py-2 ${kind === k ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
                  <input type="radio" name="exc-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mr-2 accent-[var(--accent)]" />
                  {k === 'closed' ? `${member.name.split(' ')[0]} is away` : 'Open, with these hours'}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {kind === 'open' ? (
          <div className="space-y-2">
            {windows.map((w, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <TimeSelect id={`exc-${i}-s`} label={`Period ${i + 1} starts`} value={w.start}
                  onChange={(v) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                <span className="text-ink-3" aria-hidden="true">to</span>
                <TimeSelect id={`exc-${i}-e`} label={`Period ${i + 1} ends`} value={w.end}
                  onChange={(v) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                {windows.length > 1 ? (
                  <button type="button" className="px-2 text-sm text-ink-3 hover:text-danger" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" className="text-sm text-accent hover:underline" onClick={() => setWindows((ws) => [...ws, { start: '14:00', end: '17:00' }])}>
              Add another period
            </button>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="exc-note">Note for the team <span className="font-normal text-ink-3">(optional)</span></label>
          <input id="exc-note" className="field" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'closed' ? 'Training course' : 'Saturday clinic'} />
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={pending} onClick={add}>
            {existing ? 'Replace this day' : kind === 'closed' ? 'Add day away' : 'Add opening'}
          </button>
          {existing ? <span className="text-sm text-ink-3">This date already has an exception; saving replaces it.</span> : null}
        </div>
      </div>
    </section>
  );
}

/**
 * The slots a date would offer, computed in the browser by the engine's own
 * `slots()` -- the function `book()` checks against -- from the draft hours
 * and the bookings already in the diary. What it shows is what patients
 * would be offered, not an approximation of it.
 */
function Preview({ member, services, saved, draft, dirty, todayDate }: {
  member: StaffMember;
  services: ServiceDef[];
  saved: Calendar;
  draft: Calendar;
  dirty: boolean;
  todayDate: string;
}) {
  const firstWorking = useMemo(() => {
    // A week out: near days are usually full, and a full day shows nothing changing.
    for (let i = 7; i <= 21; i += 1) {
      const d = addDays(todayDate, i);
      if (windowsForDate(saved, d).length) return d;
    }
    return addDays(todayDate, 7);
  }, [saved, todayDate]);
  const [date, setDate] = useState(firstWorking);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [busy, setBusy] = useState<Interval[] | null>(null);
  const service = services.find((s) => s.id === serviceId);

  useEffect(() => {
    let live = true;
    busyAction(member.id, date).then((b) => { if (live) setBusy(b); });
    return () => { live = false; };
  }, [member.id, date]);

  const compute = (cal: Calendar) => {
    if (!service || !busy) return [];
    const { from, to } = dayBounds(date);
    return slots({
      calendar: cal,
      service: {
        durationMin: service.durationMin, stepMin: service.stepMin, bufferAfterMin: service.bufferAfterMin,
        minNoticeMin: service.minNoticeMin, maxAdvanceDays: service.maxAdvanceDays,
      },
      from, to, busy, now: Date.now(),
    });
  };
  const before = compute(saved);
  const after = compute(draft);
  const beforeSet = new Set(before.map((s) => s.start));
  const afterSet = new Set(after.map((s) => s.start));
  const union = [...new Set([...before, ...after].map((s) => s.start))].sort((a, b) => a - b);
  const windows = windowsForDate(draft, date);
  const exception = draft.exceptions?.find((e) => e.date === date);

  return (
    <aside aria-labelledby="prev-h" className="xl:sticky xl:top-6 xl:self-start">
      <div className="panel p-4">
        <h2 id="prev-h" className="text-lg font-semibold">What patients would see</h2>
        <p className="mt-1 text-sm text-ink-2">
          Free times for one day, from {dirty ? 'the hours on the left, before saving' : 'the saved hours'}, with bookings already in the diary taken out.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pv-date">Day</label>
            <input id="pv-date" type="date" className="field" value={date} min={todayDate} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pv-svc">Service</label>
            <select id="pv-svc" className="field" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 border-t border-line-2 pt-4" aria-live="polite">
          <p className="font-medium">{dayLong(noonOf(date))}</p>
          <p className="text-sm text-ink-2">
            {windows.length
              ? `${exception?.kind === 'open' ? 'Special hours' : WEEKDAYS[weekdayOf(date)]}: ${windows.map((w) => `${time(w.start)}–${time(w.end)}`).join(', ')}`
              : exception?.kind === 'closed' ? 'Away all day' : 'Not working'}
          </p>
          {!service ? (
            <p className="mt-3 text-sm text-ink-3">{member.name} offers no services yet.</p>
          ) : busy === null ? (
            <p className="mt-3 text-sm text-ink-3">Loading bookings…</p>
          ) : union.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No {service.name.toLowerCase()} times on this day.</p>
          ) : (
            <>
              <p className="mt-3 text-sm">
                <span className="font-medium">{after.length}</span> {after.length === 1 ? 'time' : 'times'} for {durationLabel(service.durationMin)} {service.name.toLowerCase()}
                {dirty && after.length !== before.length ? <span className="text-ink-2"> (was {before.length})</span> : null}
              </p>
              <ul className="mt-2 grid grid-cols-4 gap-1.5" aria-label="Free times">
                {union.map((t) => {
                  const gained = afterSet.has(t) && !beforeSet.has(t);
                  const lost = beforeSet.has(t) && !afterSet.has(t);
                  return (
                    <li
                      key={t}
                      className={`tnum rounded border px-1 py-1 text-center text-sm ${
                        lost ? 'border-dashed border-line text-ink-3 line-through'
                          : gained ? 'border-accent bg-accent-soft font-medium text-accent'
                            : 'border-line bg-surface'
                      }`}
                    >
                      {time(t)}
                      <span className="sr-only">{lost ? ' (removed by your changes)' : gained ? ' (added by your changes)' : ''}</span>
                    </li>
                  );
                })}
              </ul>
              {dirty ? (
                <p className="mt-3 text-xs text-ink-3">
                  {union.length !== before.length || union.length !== after.length
                    ? 'Highlighted: added by your changes. Struck through: removed by them.'
                    : 'Your changes leave this day’s times as they are. Try another day.'}
                </p>
              ) : null}
            </>
          )}
          {service ? (
            <p className="mt-3 text-xs text-ink-3">
              Times start every {service.stepMin} minutes, need {service.minNoticeMin >= 60 ? `${Math.round(service.minNoticeMin / 60)} h` : `${service.minNoticeMin} min`} notice
              {service.bufferAfterMin ? ` and keep ${service.bufferAfterMin} minutes clear afterwards` : ''}.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
