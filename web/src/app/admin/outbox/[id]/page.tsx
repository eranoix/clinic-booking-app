import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KIND_LABEL, MessageView } from '@/components/MessageView';
import { engine } from '@/server/scheduling';

export const metadata = { title: 'Message' };

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = /^\d+$/.test(id) ? engine().outboxMessage(Number(id)) : null;
  if (!m) notFound();
  return (
    <div className="max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-3">
        <Link href="/admin/outbox" className="hover:text-accent">Outbox</Link>
        <span aria-hidden="true"> / </span>
        <span>{KIND_LABEL[m.kind]}</span>
      </nav>
      <MessageView message={m} />
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        {m.bookingId ? <Link href={`/admin/bookings/${m.bookingId}`} className="btn-quiet">Open the booking</Link> : null}
        <Link href={`/admin/outbox?to=${encodeURIComponent(m.to)}`} className="btn-quiet">Everything sent to {m.to}</Link>
      </div>
    </div>
  );
}
