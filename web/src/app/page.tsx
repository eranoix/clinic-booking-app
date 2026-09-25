import Link from 'next/link';
import { Mark } from '@/components/Mark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CLINIC } from '@/lib/clinic';

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-10 sm:py-16">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mark size={32} />
          <span className="text-lg font-semibold tracking-[-0.01em]">{CLINIC.name}</span>
        </div>
        <ThemeToggle />
      </div>

      <h1 className="mt-16 max-w-[22ch] text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
        A physiotherapy clinic’s diary, from both sides of the desk.
      </h1>
      <p className="mt-4 max-w-[60ch] text-ink-2">
        The clinic, its staff and its patients are invented. The scheduling is real: every
        time offered and every booking taken goes through the same engine, in Lisbon time,
        with the same rules for notice, gaps and double-booking.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/book" className="panel group block p-5 hover:border-accent">
          <span className="block text-lg font-semibold group-hover:text-accent">Book an appointment</span>
          <span className="mt-1 block text-ink-2">What a patient sees: choose a treatment, a day and a time.</span>
        </Link>
        <Link href="/admin" className="panel group block p-5 hover:border-accent">
          <span className="block text-lg font-semibold group-hover:text-accent">Front desk</span>
          <span className="mt-1 block text-ink-2">What reception sees: today’s sheet, bookings, hours and services.</span>
        </Link>
      </div>

      <p className="mt-auto pt-16 text-sm text-ink-3">
        Local demo with no sign-in. Do not put it on the public internet as it is.
      </p>
    </div>
  );
}
