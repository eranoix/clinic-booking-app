import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';

export default function BookingNotFound() {
  return (
    <PublicShell>
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold sm:text-2xl">We could not find that appointment</h1>
        <p className="mt-2 text-ink-2">
          The link may be incomplete: check it matches the one in your confirmation, including the end.
          If it still does not work, call the clinic and we will find it for you.
        </p>
        <Link href="/book" className="btn-primary mt-6">Book an appointment</Link>
      </div>
    </PublicShell>
  );
}
