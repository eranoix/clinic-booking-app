'use client';

import { useState } from 'react';
import { deleteServiceAction, setServiceActiveAction } from '../actions';

/** Stop offering a service, offer it again, or remove one that was never booked. */
export function ServiceLifecycle({ id, name, active, bookings }: { id: string; name: string; active: boolean; bookings: number }) {
  const [asking, setAsking] = useState(false);
  if (!active) {
    return (
      <form action={setServiceActiveAction} className="mt-2 text-right">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value="1" />
        <button type="submit" className="text-sm text-accent hover:underline">Offer {name} again</button>
      </form>
    );
  }
  if (!asking) {
    return (
      <div className="mt-2 text-right">
        <button type="button" className="text-sm text-ink-3 hover:text-danger" onClick={() => setAsking(true)}>
          {bookings ? `Stop offering ${name}` : `Remove ${name}`}
        </button>
      </div>
    );
  }
  return (
    <div role="dialog" aria-label={`Stop offering ${name}`} className="mt-2 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm">
      <p>
        {bookings
          ? `${name} has ${bookings} bookings, so it cannot be deleted without losing what those appointments were. It will be kept, and no longer offered to patients or at the desk. Booked appointments stay booked.`
          : `${name} has never been booked, so removing it loses nothing.`}
      </p>
      <div className="mt-3 flex gap-2">
        <form action={bookings ? setServiceActiveAction : deleteServiceAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value="0" />
          <button type="submit" className="btn bg-danger px-3 py-1.5 text-sm text-surface">{bookings ? 'Stop offering it' : 'Remove it'}</button>
        </form>
        <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={() => setAsking(false)} autoFocus>Keep it</button>
      </div>
    </div>
  );
}
