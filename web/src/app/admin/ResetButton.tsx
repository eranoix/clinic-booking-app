'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { resetAction } from './actions';

/** Empty the demo and seed it again, after one explicit confirmation. */
export function ResetButton() {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="-ml-2 block rounded-md px-2 py-1.5 text-sm text-ink-3 hover:text-ink" onClick={() => setAsking(true)}>
        Reset demo data
      </button>
    );
  }
  return (
    <form action={resetAction} className="w-full rounded-md border border-danger/30 bg-danger-soft p-3 text-xs text-ink">
      <p>Replace every booking, message and setting with a fresh set of invented ones?</p>
      <div className="mt-2 flex gap-2">
        <Confirm />
        <button type="button" className="rounded px-2 py-1 text-ink-2 hover:text-ink" onClick={() => setAsking(false)} autoFocus>Keep</button>
      </div>
    </form>
  );
}

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded bg-danger px-2 py-1 font-medium text-surface">
      {pending ? 'Resetting…' : 'Reset'}
    </button>
  );
}
