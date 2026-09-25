'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { StaffMember } from '@/lib/types';
import {
  createStaffAction, deleteStaffAction, setStaffActiveAction, updateStaffAction, type TeamResult,
} from '../actions';

const HUES: StaffMember['hue'][] = ['blue', 'green', 'ochre', 'plum', 'slate'];
const HUE_NAME: Record<StaffMember['hue'], string> = { blue: 'Blue', green: 'Green', ochre: 'Ochre', plum: 'Plum', slate: 'Slate' };

type Person = {
  id: string; name: string; role: string; hue: StaffMember['hue']; active: boolean;
  total: number; upcoming: number; services: string[]; days: string[];
};

function Fields({ person, idPrefix }: { person?: Pick<Person, 'name' | 'role' | 'hue'>; idPrefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div>
        <label className="label" htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} name="name" className="field" defaultValue={person?.name ?? ''} required maxLength={80} />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-role`}>Role, as patients see it</label>
        <input id={`${idPrefix}-role`} name="role" className="field" defaultValue={person?.role ?? ''} maxLength={80} placeholder="Physiotherapist, sports injuries" />
      </div>
      <fieldset>
        <legend className="label">Colour on the day sheet</legend>
        <div className="flex gap-1.5 pt-1">
          {HUES.map((h) => (
            <label key={h} className={`hue-${h} cursor-pointer`} title={HUE_NAME[h]}>
              <input type="radio" name="hue" value={h} defaultChecked={(person?.hue ?? 'slate') === h} className="peer sr-only" />
              <span className="block size-7 rounded-full border-2 border-transparent bg-[var(--hue)] ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-[var(--hue)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent" />
              <span className="sr-only">{HUE_NAME[h]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-primary" disabled={pending}>{pending ? pendingLabel : label}</button>;
}

export function AddPerson() {
  const [state, action] = useActionState<TeamResult, FormData>(createStaffAction, {});
  return (
    <form action={action} className="panel space-y-4 p-4">
      <Fields idPrefix="new" />
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <Submit label="Add to the team" pendingLabel="Adding…" />
    </form>
  );
}

export function PersonCard({ person }: { person: Person }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<TeamResult, FormData>(updateStaffAction, {});
  return (
    <div className={`panel hue-${person.hue} ${person.active ? '' : 'bg-surface-2'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1.5 size-3 shrink-0 rounded-full bg-[var(--hue)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">{person.name}{person.active ? '' : <span className="ml-2 text-sm font-normal text-ink-3">Not taking bookings</span>}</p>
            <p className="text-sm text-ink-2">{person.role || 'No role given'}</p>
            <p className="mt-1 text-sm text-ink-3">
              {person.days.length ? `Works ${person.days.join(', ')}.` : 'No weekly hours yet.'}{' '}
              {person.services.length ? `Offers ${person.services.join(', ')}.` : 'Offers no services yet.'}
            </p>
            <p className="mt-1 text-sm text-ink-3">{person.total} bookings in the history, {person.upcoming} upcoming</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            {editing ? 'Close' : 'Edit'}
          </button>
          <Link href={`/admin/availability?staff=${person.id}`} className="btn-quiet px-3 py-1.5 text-sm">Hours</Link>
          <Lifecycle person={person} />
        </div>
      </div>
      {editing ? (
        <form action={action} className="space-y-4 border-t border-line-2 p-4">
          <input type="hidden" name="id" value={person.id} />
          <Fields person={person} idPrefix={person.id} />
          {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
          {state.ok ? <p role="status" className="text-sm text-ok">Saved.</p> : null}
          <Submit label="Save" pendingLabel="Saving…" />
        </form>
      ) : null}
    </div>
  );
}

/**
 * Deactivate, reactivate, or remove. Remove exists only for someone with no
 * bookings at all -- added by mistake, say. Anyone with history is
 * deactivated instead, and the button says why.
 */
function Lifecycle({ person }: { person: Person }) {
  const [asking, setAsking] = useState(false);
  if (!person.active) {
    return (
      <form action={setStaffActiveAction}>
        <input type="hidden" name="id" value={person.id} />
        <input type="hidden" name="active" value="1" />
        <button type="submit" className="btn-quiet px-3 py-1.5 text-sm">Reactivate</button>
      </form>
    );
  }
  if (!asking) {
    return (
      <button type="button" className="btn-danger px-3 py-1.5 text-sm" onClick={() => setAsking(true)}>
        {person.total ? 'Deactivate' : 'Remove'}
      </button>
    );
  }
  return (
    <div role="dialog" aria-label={`${person.total ? 'Deactivate' : 'Remove'} ${person.name}`} className="w-full basis-full rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-ink sm:max-w-md">
      {person.total ? (
        <p>
          {person.name} has {person.total} bookings in the history, so they cannot be deleted without losing who treated whom.
          Deactivating keeps all of it and stops them being offered.
          {person.upcoming ? ` Their ${person.upcoming} upcoming appointments stay booked; move them to someone else from Bookings.` : ''}
        </p>
      ) : (
        <p>{person.name} has no bookings at all, so removing them loses nothing.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={person.total ? setStaffActiveAction : deleteStaffAction}>
          <input type="hidden" name="id" value={person.id} />
          <input type="hidden" name="active" value="0" />
          <button type="submit" className="btn bg-danger px-3 py-1.5 text-sm text-surface">{person.total ? 'Deactivate' : 'Remove'}</button>
        </form>
        {person.upcoming ? (
          <Link className="btn-quiet px-3 py-1.5 text-sm" href={`/admin/bookings?staff=${person.id}&status=confirmed`}>See their upcoming bookings</Link>
        ) : null}
        <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={() => setAsking(false)} autoFocus>Keep</button>
      </div>
    </div>
  );
}
