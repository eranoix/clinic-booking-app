import type { OutboxMessage } from 'clinic-booking-app';
import { dayFull, time } from '@/lib/time';

const URL_RE = /(https?:\/\/[^\s]+)/g;

/**
 * A message as the recipient would read it: plain text, with its links made
 * clickable. Links are the only thing turned into markup; everything else is
 * rendered as text, so nothing in a name or a note can become HTML.
 */
export function MessageView({ message }: { message: OutboxMessage }) {
  return (
    <article className="panel overflow-hidden">
      <header className="space-y-1 border-b border-line-2 bg-surface-2 px-5 py-4 text-sm">
        <p className="text-lg font-semibold text-ink">{message.subject}</p>
        <p className="text-ink-2"><span className="text-ink-3">To </span>{message.to}</p>
        <p className="text-ink-3">{dayFull(message.createdAt)}, {time(message.createdAt)}</p>
      </header>
      <div className="whitespace-pre-wrap break-words px-5 py-5 font-[inherit] leading-relaxed">
        {message.body.split(URL_RE).map((part, i) => (/^https?:\/\//.test(part)
          ? <a key={i} href={toLocal(part)} className="break-all text-accent underline underline-offset-2">{part}</a>
          : <span key={i}>{part}</span>))}
      </div>
    </article>
  );
}

/** Absolute links to PUBLIC_URL are made relative, so the demo works on whatever address it is opened on. */
function toLocal(href: string): string {
  try {
    const u = new URL(href);
    return /^\/(b\/|book)/.test(u.pathname) ? u.pathname + u.search : href;
  } catch {
    return href;
  }
}

export const KIND_LABEL: Record<OutboxMessage['kind'], string> = {
  booked: 'Confirmation',
  rescheduled: 'Moved',
  cancelled: 'Cancelled',
  'series-booked': 'Course booked',
  'series-cancelled': 'Course cancelled',
};
