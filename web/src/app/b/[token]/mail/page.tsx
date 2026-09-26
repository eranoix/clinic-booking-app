import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessageView } from '@/components/MessageView';
import { PublicShell } from '@/components/PublicShell';
import { engine } from '@/server/scheduling';

export const metadata: Metadata = { title: 'Your messages', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

/**
 * The emails about one appointment, readable by whoever holds its link (who
 * can already move or cancel it). This demo sends no real email.
 */
export default async function MailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = engine().byToken(token);
  if (!b) notFound();
  const messages = engine().outbox({ bookingId: b.id, ...(b.seriesId ? { seriesId: b.seriesId } : {}), limit: 50 })
    .filter((m) => m.to.toLowerCase() === b.customerEmail.toLowerCase());
  return (
    <PublicShell>
      <div className="max-w-3xl">
        <Link href={`/b/${token}`} className="text-sm text-accent hover:underline">Back to your appointment</Link>
        <h1 className="mt-3 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">Emails about this appointment</h1>
        <p className="mt-1.5 text-ink-2">
          This demo sends no email. These are the messages the clinic would have sent to {b.customerEmail}, newest first.
        </p>
        <div className="mt-6 space-y-6">
          {messages.length === 0 ? <p className="text-ink-3">No messages yet.</p> : messages.map((m) => <MessageView key={m.id} message={m} />)}
        </div>
      </div>
    </PublicShell>
  );
}
