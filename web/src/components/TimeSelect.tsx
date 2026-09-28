'use client';

const STEP = 15;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const OPTIONS = Array.from({ length: (24 * 60) / STEP }, (_, i) => hhmm(i * STEP)).filter((t) => t >= '06:00' && t <= '22:00');

export function TimeSelect({ id, value, onChange, label }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const options = OPTIONS.includes(value) || !value ? OPTIONS : [...OPTIONS, value].sort();
  return (
    <select id={id} aria-label={label} className="field w-[6.5rem] tnum" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
