import Link from 'next/link';
import { windowsForDate } from 'clinic-booking-app/availability';
import { dayBounds, time } from '@/lib/time';
import type { BookingDTO, StaffMember } from '@/lib/types';
import { EmptyState } from './ui';

const PX_PER_MIN = 1.15;
const MIN = 60_000;

/**
 * The day as a clinic's paper day sheet: one column per practitioner, time
 * running down, appointments where they fall. Hatched where someone is not
 * working, so a gap you could fill looks different from a gap nobody can.
 */
export function DaySheet({ date, staff, bookings, now }: {
  date: string;
  staff: StaffMember[];
  bookings: BookingDTO[];
  now: number;
}) {
  const windows = new Map(staff.map((s) => [s.id, windowsForDate(s.calendar, date)]));
  const all = [...windows.values()].flat();
  const { from: midnight } = dayBounds(date);

  const earliest = Math.min(...all.map((w) => w.start), ...bookings.map((b) => b.startsAt));
  const latest = Math.max(...all.map((w) => w.end), ...bookings.map((b) => b.endsAt));
  if (!Number.isFinite(earliest)) {
    return <EmptyState title="Nobody is working today">No one has opening hours on this date.</EmptyState>;
  }

  // Whole hours either side, so the ruler starts and ends on a label.
  const hour = 60 * MIN;
  const start = midnight + Math.floor((earliest - midnight) / hour) * hour;
  const end = midnight + Math.ceil((latest - midnight) / hour) * hour;
  const y = (ts: number) => ((ts - start) / MIN) * PX_PER_MIN;
  const height = y(end);
  const hours = Array.from({ length: Math.round((end - start) / hour) + 1 }, (_, i) => start + i * hour);
  const showNow = now >= start && now <= end;

  return (
    <div className="panel overflow-x-auto" role="group" aria-label="Day sheet">
      <div className="grid min-w-[36rem]" style={{ gridTemplateColumns: `3.5rem repeat(${staff.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-line" />
        {staff.map((s) => {
          const count = bookings.filter((b) => b.staffId === s.id && b.status === 'confirmed').length;
          const off = (windows.get(s.id) ?? []).length === 0;
          return (
            <div key={s.id} className={`hue-${s.hue} border-b border-l border-line px-3 py-2.5`}>
              <div className="flex items-center gap-2 font-medium">
                <span className="h-3.5 w-1 rounded-full bg-[var(--hue)]" aria-hidden="true" />
                <span className="truncate">{s.name}</span>
              </div>
              <div className="mt-0.5 text-sm text-ink-3">
                {off ? 'Not working today' : `${count} ${count === 1 ? 'appointment' : 'appointments'}`}
              </div>
            </div>
          );
        })}

        <div className="relative" style={{ height }} aria-hidden="true">
          {hours.filter((h) => !showNow || Math.abs(h - now) > 14 * MIN).map((h) => (
            <span
              key={h}
              className="tnum absolute right-2 -translate-y-1/2 text-xs text-ink-3"
              style={{ top: Math.min(Math.max(y(h), 8), height - 8) }}
            >
              {time(h)}
            </span>
          ))}
          {showNow ? (
            <span className="tnum absolute right-1 z-20 -translate-y-1/2 rounded bg-danger px-1 text-xs font-medium text-surface" style={{ top: y(now) }}>
              {time(now)}
            </span>
          ) : null}
        </div>

        {staff.map((s) => (
          <div key={s.id} className={`hue-${s.hue} off-hours relative border-l border-line`} style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute inset-x-0 border-t border-line-2" style={{ top: y(h) }} aria-hidden="true" />
            ))}
            {(windows.get(s.id) ?? []).map((w) => (
              <div
                key={w.start}
                className="absolute inset-x-0 bg-surface/90"
                style={{ top: y(w.start), height: y(w.end) - y(w.start) }}
                aria-hidden="true"
              />
            ))}
            {(windows.get(s.id) ?? []).flatMap((w) => [w.start, w.end]).map((edge, i) => (
              <div key={`${edge}-${i}`} className="absolute inset-x-0 border-t border-line" style={{ top: y(edge) }} aria-hidden="true" />
            ))}
            {lanes(bookings.filter((b) => b.staffId === s.id)).map(({ b, lane }) => (
              <Block key={b.id} b={b} lane={lane} top={y(b.startsAt)} h={y(b.endsAt) - y(b.startsAt)} past={b.endsAt <= now} />
            ))}
            {showNow ? (
              <div className="pointer-events-none absolute inset-x-0 z-20 h-px bg-danger" style={{ top: y(now) }} aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

type Lane = 'full' | 'main' | 'side';

/**
 * A cancelled appointment keeps its place on the sheet, but a new booking can
 * take the same time: the live one takes the main lane and the cancelled one a
 * narrow lane beside it, so neither covers the other's text.
 */
function lanes(list: BookingDTO[]): { b: BookingDTO; lane: Lane }[] {
  const live = list.filter((b) => b.status === 'confirmed');
  const gone = list.filter((b) => b.status === 'cancelled');
  const hit = (a: BookingDTO, b: BookingDTO) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
  return [
    ...gone.map((b) => ({ b, lane: (live.some((l) => hit(l, b)) ? 'side' : 'full') as Lane })),
    ...live.map((b) => ({ b, lane: (gone.some((g) => hit(g, b)) ? 'main' : 'full') as Lane })),
  ];
}

const LANE: Record<Lane, string> = {
  full: 'left-1.5 right-1.5',
  main: 'left-1.5 right-[34%]',
  side: 'left-[67%] right-1.5',
};

function Block({ b, lane, top, h, past }: { b: BookingDTO; lane: Lane; top: number; h: number; past: boolean }) {
  const cancelled = b.status === 'cancelled';
  const compact = h < 34;
  const narrow = lane === 'side';
  const label = `${time(b.startsAt)} to ${time(b.endsAt)}, ${b.customerName}, ${b.serviceName}${cancelled ? ', cancelled' : ''}`;
  return (
    <Link
      href={`/admin/bookings/${b.id}`}
      aria-label={label}
      title={label}
      className={`group absolute ${LANE[lane]} overflow-hidden rounded-[5px] px-2 text-sm leading-tight transition-[filter] hover:brightness-[0.97] ${
        cancelled
          ? 'z-0 border border-dashed border-line bg-surface text-ink-3'
          : `z-10 border-l-[3px] border-[var(--hue)] bg-[var(--hue-soft)] text-ink ${past ? 'opacity-60' : ''}`
      } ${compact ? 'flex items-center gap-2 py-0' : 'py-1'}`}
      style={{ top: top + 1, height: Math.max(h - 2, 16) }}
    >
      <span className={`tnum shrink-0 ${compact ? 'text-xs' : 'block text-xs'} text-ink-2 ${cancelled ? 'line-through' : ''}`}>{time(b.startsAt)}</span>
      <span className={`truncate font-medium ${compact || narrow ? 'text-xs' : ''} ${compact ? '' : 'block'} ${cancelled ? 'line-through decoration-ink-3' : ''}`}>{b.customerName}</span>
      {!compact && !narrow && h > 52 ? <span className="block truncate text-xs text-ink-2">{b.serviceName}</span> : null}
    </Link>
  );
}
