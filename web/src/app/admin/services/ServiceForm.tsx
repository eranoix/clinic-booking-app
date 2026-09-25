'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { durationLabel } from '@/lib/time';
import type { ServiceDef, StaffMember } from '@/lib/types';
import { saveServiceAction, type ServiceResult } from '../actions';

type Staff = Pick<StaffMember, 'id' | 'name' | 'hue'>;

const hoursLabel = (h: number) =>
  h === 0 ? 'no notice' : h < 1 ? `${Math.round(h * 60)} minutes’ notice` : h % 24 === 0 && h >= 24
    ? `${h / 24} ${h / 24 === 1 ? 'day’s' : 'days’'} notice` : `${h} ${h === 1 ? 'hour’s' : 'hours’'} notice`;

const BLANK: ServiceDef = {
  id: '', name: '', description: '', durationMin: 45, stepMin: 30, bufferAfterMin: 15,
  minNoticeMin: 180, maxAdvanceDays: 60, active: true, staffIds: [],
};

/**
 * Edit a service, or with no `service`, add one. `bookings` is how many
 * appointments use it: a service with any can be deactivated but not removed.
 */
export function ServiceForm({ service: given, staff, bookings = 0 }: { service?: ServiceDef; staff: Staff[]; bookings?: number }) {
  const service = given ?? BLANK;
  const isNew = !given;
  const [state, action] = useActionState<ServiceResult, FormData>(saveServiceAction, {});
  const [v, setV] = useState({
    durationMin: service.durationMin,
    stepMin: service.stepMin,
    bufferAfterMin: service.bufferAfterMin,
    minNoticeHours: service.minNoticeMin / 60,
    maxAdvanceDays: service.maxAdvanceDays,
  });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setTouched(true);
    setV((x) => ({ ...x, [k]: Number(e.target.value) }));
  };
  const id = service.id || 'new';
  const hasFailed = Boolean(state.error);
  const err = (field: string) => (state.error && state.field === field ? state.error : null);

  return (
    <form
      action={action}
      onChange={() => setTouched(true)}
      className={`panel scroll-mt-6 ${service.active ? '' : 'bg-surface-2'}`}
      aria-labelledby={`svc-${id}`}
      id={`svc-${id}`}
    >
      {isNew ? null : <input type="hidden" name="id" value={service.id} />}
      <div className="grid gap-x-10 gap-y-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <h2 className="sr-only">{isNew ? 'New service' : service.name}</h2>
          {service.active ? null : (
            <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-2">
              Not offered: patients cannot book it and it is not in the front desk’s list. Its {bookings} past bookings are kept.
            </p>
          )}
          <div>
            <label className="label" htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} name="name" className="field text-lg font-semibold" defaultValue={service.name} required maxLength={80} />
            {err('name') ? <p className="mt-1 text-sm text-danger">{err('name')}</p> : null}
          </div>
          <div>
            <label className="label" htmlFor={`${id}-desc`}>Description for patients</label>
            <textarea id={`${id}-desc`} name="description" rows={2} className="field" defaultValue={service.description} maxLength={240} />
          </div>
          <fieldset>
            <legend className="label">Who offers it</legend>
            <div className="flex flex-wrap gap-2">
              {staff.map((s) => (
                <label key={s.id} className={`hue-${s.hue} inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 has-[:checked]:border-[var(--hue)] has-[:checked]:bg-[var(--hue-soft)]`}>
                  <input type="checkbox" name="staff" value={s.id} defaultChecked={service.staffIds.includes(s.id)} className="accent-[var(--hue)]" />
                  {s.name}
                </label>
              ))}
            </div>
            {err('staff') ? <p className="mt-1 text-sm text-danger">{err('staff')}</p> : null}
          </fieldset>
        </div>

        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Num id={`${id}-dur`} name="durationMin" label="Length" unit="min" value={v.durationMin} onChange={set('durationMin')} min={5} max={480} step={5}
            help="How long the appointment itself lasts." error={err('durationMin')} />
          <Num id={`${id}-step`} name="stepMin" label="Start times every" unit="min" value={v.stepMin} onChange={set('stepMin')} min={5} max={240} step={5}
            help="How far apart the times on offer are. 30 means 9:00, 9:30, 10:00." error={err('stepMin')} />
          <Num id={`${id}-buf`} name="bufferAfterMin" label="Kept free afterwards" unit="min" value={v.bufferAfterMin} onChange={set('bufferAfterMin')} min={0} max={120} step={5}
            help="Time after each appointment nobody else can book: notes, cleaning, a breather." error={err('bufferAfterMin')} />
          <Num id={`${id}-notice`} name="minNoticeHours" label="Book at least" unit="hours ahead" value={v.minNoticeHours} onChange={set('minNoticeHours')} min={0} max={336} step={0.5}
            help="Stops a booking arriving too late to prepare for it." error={err('minNoticeHours')} />
          <Num id={`${id}-adv`} name="maxAdvanceDays" label="Book at most" unit="days ahead" value={v.maxAdvanceDays} onChange={set('maxAdvanceDays')} min={1} max={365} step={1}
            help="How far into the future the diary is open." error={err('maxAdvanceDays')} />
          <div className="sm:row-span-1">
            <Timeline durationMin={v.durationMin} stepMin={v.stepMin} bufferAfterMin={v.bufferAfterMin} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 bg-surface-2 px-5 py-3 rounded-b-lg">
        <p className="max-w-[70ch] text-sm text-ink-2">{summary(v)}</p>
        <div className="flex items-center gap-3">
          {state.ok && !touched && !isNew ? <span role="status" className="text-sm text-ok">Saved</span> : null}
          {hasFailed && !state.field ? <span role="alert" className="text-sm text-danger">{state.error}</span> : null}
          <Save onSaved={() => setTouched(false)} label={isNew ? 'Add service' : 'Save service'} />
        </div>
      </div>
    </form>
  );
}

function Save({ onSaved, label }: { onSaved: () => void; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending} onClick={onSaved}>
      {pending ? 'Saving…' : label}
    </button>
  );
}

function Num({ id, name, label, unit, help, value, onChange, min, max, step, error }: {
  id: string; name: string; label: string; unit: string; help: string; value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; min: number; max: number; step: number; error: string | null;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id} name={name} type="number" inputMode="decimal" className="field w-24" value={Number.isFinite(value) ? value : ''}
          onChange={onChange} min={min} max={max} step={step} aria-describedby={`${id}-help`} aria-invalid={error ? true : undefined}
        />
        <span className="text-sm text-ink-2">{unit}</span>
      </div>
      <p id={`${id}-help`} className="mt-1 text-sm text-ink-3">{help}</p>
      {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

function summary(v: { durationMin: number; stepMin: number; bufferAfterMin: number; minNoticeHours: number; maxAdvanceDays: number }) {
  if (![v.durationMin, v.stepMin, v.bufferAfterMin, v.minNoticeHours, v.maxAdvanceDays].every(Number.isFinite) || v.durationMin <= 0 || v.stepMin <= 0) {
    return 'Fill in every number to see how this books.';
  }
  const perHour = v.durationMin + v.bufferAfterMin;
  const gap = Math.ceil(perHour / v.stepMin) * v.stepMin;
  return `Patients see a ${durationLabel(v.durationMin)} appointment starting every ${v.stepMin} minutes, with ${hoursLabel(v.minNoticeHours)} and up to ${v.maxAdvanceDays} days ahead. Booked back to back, one starts every ${durationLabel(gap)}${v.bufferAfterMin ? `, including ${v.bufferAfterMin} minutes kept free` : ''}.`;
}

/**
 * Two appointments booked back to back, drawn to scale on the start-time grid:
 * the clearest way to show what length, gap and grid do together.
 */
function Timeline({ durationMin, stepMin, bufferAfterMin }: { durationMin: number; stepMin: number; bufferAfterMin: number }) {
  if (!(durationMin > 0 && stepMin > 0 && bufferAfterMin >= 0)) return null;
  const second = Math.ceil((durationMin + bufferAfterMin) / stepMin) * stepMin;
  const span = Math.max(second + durationMin + bufferAfterMin, 60) + stepMin;
  const pct = (m: number) => `${(m / span) * 100}%`;
  const ticks = Array.from({ length: Math.floor(span / stepMin) + 1 }, (_, i) => i * stepMin).filter((m) => m <= span);
  const idle = second - durationMin - bufferAfterMin;
  return (
    <figure className="mt-1">
      <figcaption className="label">Two bookings in a row</figcaption>
      <div className="relative mt-2 h-9 rounded bg-surface-2 ring-1 ring-line-2" aria-hidden="true">
        {ticks.map((m) => <span key={m} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(m) }} />)}
        {[0, second].map((s) => (
          <span key={s}>
            <span className="absolute inset-y-1.5 rounded-sm bg-accent" style={{ left: pct(s), width: pct(durationMin) }} />
            {bufferAfterMin ? <span className="off-hours absolute inset-y-1.5 rounded-sm bg-accent-soft" style={{ left: pct(s + durationMin), width: pct(bufferAfterMin) }} /> : null}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-sm text-ink-3">
        Solid: the appointment. Hatched: kept free.{idle > 0 ? ` ${idle} minutes fall between the grid lines and go unused.` : ''}
      </p>
    </figure>
  );
}
