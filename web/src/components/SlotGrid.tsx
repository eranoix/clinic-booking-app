'use client';

import { time } from '@/lib/time';
import type { SlotDTO } from '@/lib/types';

const PARTS = [
  { label: 'Morning', until: 12 * 60 },
  { label: 'Afternoon', until: 17 * 60 },
  { label: 'Evening', until: 24 * 60 },
];

function minuteOfDay(ts: number) {
  const [h, m] = time(ts).split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * Free times as a radio group, split into morning, afternoon and evening.
 * Native radios underneath, so arrow keys, focus and screen readers behave
 * the way they do everywhere else.
 */
export function SlotGrid({ slots, value, onChange, name, showStaff = false, label }: {
  slots: SlotDTO[];
  value: number | null;
  onChange: (slot: SlotDTO) => void;
  name: string;
  showStaff?: boolean;
  label: string;
}) {
  let prev = 0;
  const groups = PARTS.map((p) => {
    const from = prev;
    prev = p.until;
    return { label: p.label, slots: slots.filter((s) => minuteOfDay(s.start) >= from && minuteOfDay(s.start) < p.until) };
  }).filter((g) => g.slots.length);

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">{label}</legend>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-2 text-sm text-ink-3">{g.label}</div>
          <div className={`grid gap-2 ${showStaff ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5'}`}>
            {g.slots.map((s) => {
              const id = `${name}-${s.start}`;
              return (
                <div key={s.start}>
                  <input
                    type="radio"
                    className="peer sr-only"
                    id={id}
                    name={name}
                    value={s.start}
                    checked={value === s.start}
                    onChange={() => onChange(s)}
                  />
                  <label
                    htmlFor={id}
                    className="block cursor-pointer rounded-md border border-line bg-surface px-2 py-2 text-center transition-colors hover:border-accent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                  >
                    <span className="tnum block font-medium">{time(s.start)}</span>
                    {showStaff ? <span className="block truncate text-xs opacity-80">{s.staffName.split(' ')[0]}</span> : null}
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
