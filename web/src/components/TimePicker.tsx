'use client';

import { useEffect, useState } from 'react';
import { addDays, daysBetween, dayLong, dayNum, monthShort, noonOf, weekdayShort } from '@/lib/time';
import type { SlotDTO } from '@/lib/types';
import { SlotGrid } from './SlotGrid';

const PAGE = 14;

type Days = { date: string; count: number }[];

/**
 * A two-week strip of days with how many times each has free, and the free
 * times of the chosen day. Every number here comes from the engine through
 * /api/days and /api/slots; nothing is guessed in the browser.
 *
 * `refreshKey` forces a re-read, which is what happens after a booking
 * attempt loses a race: the list the person was looking at is stale.
 */
export function TimePicker({
  serviceId, staffId, todayDate, horizonDays, date, onDate, slot, onSlot, refreshKey = 0, showStaff, rules = 'public',
}: {
  serviceId: string;
  staffId: string;
  todayDate: string;
  horizonDays: number;
  date: string | null;
  onDate: (d: string) => void;
  slot: SlotDTO | null;
  onSlot: (s: SlotDTO) => void;
  refreshKey?: number;
  showStaff: boolean;
  /** 'desk' shows the front desk's times: no online notice period. Needs a signed-in session. */
  rules?: 'public' | 'desk';
}) {
  const extra = rules === 'desk' ? '&rules=desk' : '';
  const [pageStart, setPageStart] = useState(todayDate);
  const [days, setDays] = useState<Days | null>(null);
  const [slots, setSlots] = useState<SlotDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastPage = addDays(todayDate, Math.max(0, Math.floor(horizonDays / PAGE)) * PAGE);

  // Keep the chosen date visible: an alternative offered after a lost race
  // can sit on a later page.
  useEffect(() => {
    if (date && (daysBetween(pageStart, date) < 0 || daysBetween(pageStart, date) >= PAGE)) {
      setPageStart(addDays(todayDate, Math.floor(daysBetween(todayDate, date) / PAGE) * PAGE));
    }
  }, [date, pageStart, todayDate]);

  useEffect(() => {
    let live = true;
    setDays(null);
    fetch(`/api/days?service=${encodeURIComponent(serviceId)}&staff=${encodeURIComponent(staffId)}&from=${pageStart}&days=${PAGE}${extra}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { days: Days }) => {
        if (!live) return;
        setDays(body.days);
        setError(null);
        if (!date || daysBetween(pageStart, date) < 0 || daysBetween(pageStart, date) >= PAGE) {
          const first = body.days.find((d) => d.count > 0);
          if (first) onDate(first.date);
        }
      })
      .catch(() => live && setError('The diary could not be loaded. Check your connection and try again.'));
    return () => { live = false; };
    // onDate/date are read, not subscribed to: re-running on every choice would refetch the strip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, staffId, pageStart, refreshKey, extra]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    setSlots(null);
    fetch(`/api/slots?service=${encodeURIComponent(serviceId)}&staff=${encodeURIComponent(staffId)}&date=${date}${extra}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { slots: SlotDTO[] }) => { if (live) setSlots(body.slots); })
      .catch(() => live && setError('Free times could not be loaded. Try again.'));
    return () => { live = false; };
  }, [serviceId, staffId, date, refreshKey, extra]);

  const canBack = daysBetween(todayDate, pageStart) > 0;
  const canForward = daysBetween(pageStart, lastPage) > 0;
  const first = days?.[0]?.date ?? pageStart;
  const last = days?.at(-1)?.date ?? addDays(pageStart, PAGE - 1);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {dayNum(noonOf(first))} {monthShort(noonOf(first))} to {dayNum(noonOf(last))} {monthShort(noonOf(last))}
        </p>
        <div className="flex gap-1">
          <button type="button" className="btn-quiet px-3 py-1 text-sm" disabled={!canBack} onClick={() => setPageStart(addDays(pageStart, -PAGE))}>
            Earlier
          </button>
          <button type="button" className="btn-quiet px-3 py-1 text-sm" disabled={!canForward} onClick={() => setPageStart(addDays(pageStart, PAGE))}>
            Later
          </button>
        </div>
      </div>

      <ul className="-mx-1 grid grid-cols-7 gap-1 px-1 pb-1" aria-label="Choose a day">
        {(days ?? Array.from({ length: PAGE }, (_, i) => ({ date: addDays(pageStart, i), count: -1 }))).map((d) => {
          const chosen = d.date === date;
          const loading = d.count < 0;
          const full = d.count === 0;
          return (
            <li key={d.date}>
              <button
                type="button"
                disabled={loading || full}
                aria-pressed={chosen}
                aria-label={`${dayLong(noonOf(d.date))}: ${loading ? 'loading' : full ? 'nothing free' : `${d.count} times free`}`}
                onClick={() => onDate(d.date)}
                className={`flex w-full flex-col items-center rounded-md border py-1.5 text-center transition-colors ${
                  chosen ? 'border-accent bg-accent text-accent-ink'
                    : full || loading ? 'border-transparent text-ink-3'
                      : 'border-line bg-surface hover:border-accent'
                }`}
              >
                <span className="text-xs">{weekdayShort(noonOf(d.date))}</span>
                <span className="tnum text-base font-semibold leading-6">{dayNum(noonOf(d.date))}</span>
                <span className={`h-1 w-1 rounded-full ${loading ? 'bg-transparent' : full ? 'bg-line' : chosen ? 'bg-accent-ink' : 'bg-ok'}`} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}

      <div className="mt-6" aria-live="polite">
        {!date ? (
          days && days.every((d) => d.count === 0) ? (
            <p className="text-ink-2">Nothing is free in these two weeks. Try later dates{staffId !== 'any' ? ' or anyone available' : ''}.</p>
          ) : null
        ) : (
          <>
            <h3 className="mb-3 font-medium">{dayLong(noonOf(date))}</h3>
            {slots === null ? (
              <p className="text-sm text-ink-3">Finding free times…</p>
            ) : slots.length === 0 ? (
              <p className="text-ink-2">Nothing is free on this day any more. Choose another day.</p>
            ) : (
              <SlotGrid slots={slots} value={slot?.start ?? null} onChange={onSlot} name="time" label={`Times on ${dayLong(noonOf(date))}`} showStaff={showStaff} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
