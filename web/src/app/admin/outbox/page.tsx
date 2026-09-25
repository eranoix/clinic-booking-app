import Link from 'next/link';
import { KIND_LABEL } from '@/components/MessageView';
import { EmptyState, PageHeader } from '@/components/ui';
import { relativeDay, time } from '@/lib/time';
import { engine } from '@/server/scheduling';

export const metadata = { title: 'Outbox' };

export default async function OutboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const to = typeof sp.to === 'string' && sp.to.trim() ? sp.to.trim() : null;
  const messages = engine().outbox({ limit: 200, ...(to ? { to } : {}) });
  const now = Date.now();
  return (
    <>
      <PageHeader
        title="Outbox"
        lead="Every confirmation, move and cancellation the clinic would email, written in the same transaction as the change itself. This demo sends nothing: the messages stay here, links included, so you can follow them."
      />
      <form role="search" className="mb-6 flex max-w-md gap-2">
        <label className="sr-only" htmlFor="o-to">Recipient</label>
        <input id="o-to" name="to" type="search" className="field" placeholder="Recipient’s email" defaultValue={to ?? ''} autoComplete="off" />
        <button className="btn-quiet" type="submit">Show</button>
        {to ? <Link href="/admin/outbox" className="btn-quiet">All</Link> : null}
      </form>
      {messages.length === 0 ? (
        <EmptyState title={to ? `Nothing sent to ${to}` : 'The outbox is empty'}>
          Messages appear here when someone books, moves or cancels. <Link className="text-accent underline" href="/admin/bookings/new">Make a booking</Link>.
        </EmptyState>
      ) : (
        <ul className="panel divide-y divide-line-2">
          {messages.map((m) => (
            <li key={m.id}>
              <Link href={`/admin/outbox/${m.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,15rem)_9rem]">
                <span className="text-sm text-ink-3 max-sm:hidden">{KIND_LABEL[m.kind]}</span>
                <span className="min-w-0 truncate font-medium">{m.subject}</span>
                <span className="col-start-1 row-start-2 truncate text-sm text-ink-2 sm:col-start-auto sm:row-start-auto">{m.to}</span>
                <span className="col-start-2 row-start-1 text-right text-sm text-ink-3 sm:col-start-auto sm:row-start-auto">{relativeDay(m.createdAt, now)}, {time(m.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-ink-3">{messages.length} {messages.length === 1 ? 'message' : 'messages'}{messages.length === 200 ? ' (the latest 200)' : ''}.</p>
    </>
  );
}
