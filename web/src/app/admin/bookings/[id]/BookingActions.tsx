'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { SlotGrid } from '@/components/SlotGrid';
import { dayShort, time } from '@/lib/time';
import type { SlotDTO } from '@/lib/types';
import { cancelAction, cancelCourseAction, rescheduleAction, type ActionState } from '../../actions';

export function RescheduleForm({ id, slots, staffId, staffName, moving }: {
  id: number; slots: SlotDTO[]; staffId: string; staffName: string; moving: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(rescheduleAction, {});
  const [chosen, setChosen] = useState<SlotDTO | null>(null);
  const alternatives = state.error?.alternatives ?? [];

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="startsAt" value={chosen?.start ?? ''} />
      <input type="hidden" name="staffId" value={staffId} />
      {state.error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <p>{state.error.message}</p>
          {alternatives.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {alternatives.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => setChosen(s)}
                  className={`rounded-md border px-3 py-1.5 text-ink ${chosen?.start === s.start ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent'}`}
                >
                  <span className="tnum">{dayShort(s.start)}, {time(s.start)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {slots.length ? (
        <SlotGrid slots={slots} value={chosen?.start ?? null} onChange={setChosen} name="slot" label="New time" />
      ) : (
        <p className="text-ink-2">Nothing is free on this day for this service. Pick another day above.</p>
      )}
      <Submit chosen={chosen} who={moving ? staffName : null} />
    </form>
  );
}

function Submit({ chosen, who }: { chosen: SlotDTO | null; who: string | null }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={!chosen || pending}>
      {pending ? 'Moving…' : chosen ? `Move to ${dayShort(chosen.start)}, ${time(chosen.start)}${who ? ` with ${who.split(' ')[0]}` : ''}` : 'Choose a new time'}
    </button>
  );
}

export function CancelCourseForm({ id, count }: { id: number; count: number }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="text-sm text-danger hover:underline" onClick={() => setConfirming(true)}>
        Cancel this session and the {count - 1} after it
      </button>
    );
  }
  return (
    <form action={cancelCourseAction} className="rounded-md border border-danger/30 bg-danger-soft p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink">
        Cancel {count} sessions, from this one to the end of the course? Earlier sessions stay as they are. One notice listing them goes to the Outbox.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <CancelSubmit label={`Cancel ${count} sessions`} />
        <button type="button" className="btn-quiet" onClick={() => setConfirming(false)} autoFocus>Keep the course</button>
      </div>
    </form>
  );
}

export function CancelForm({ id, name }: { id: number; name: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
        Cancel appointment
      </button>
    );
  }
  return (
    <form action={cancelAction} className="rounded-md border border-danger/30 bg-danger-soft p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink">
        Cancel {name}’s appointment? The time becomes free for others to book. The record stays in the history.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <CancelSubmit />
        <button type="button" className="btn-quiet" onClick={() => setConfirming(false)} autoFocus>Keep it</button>
      </div>
    </form>
  );
}

function CancelSubmit({ label = 'Yes, cancel it' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn bg-danger text-surface hover:opacity-90" disabled={pending}>
      {pending ? 'Cancelling…' : label}
    </button>
  );
}
