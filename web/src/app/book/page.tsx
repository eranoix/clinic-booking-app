import type { Metadata } from 'next';
import { PublicShell } from '@/components/PublicShell';
import { today } from '@/lib/time';
import { bookableServices, catalog } from '@/server/scheduling';
import { BookingFlow } from './BookingFlow';

export const metadata: Metadata = { title: 'Book an appointment' };
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * `?service=massage&with=marta` preselects, so the clinic's own site can link
 * straight to "Book a sports massage with Marta".
 */
export default async function BookPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  // Only active services and practitioners are offered; a deactivated one's
  // history stays in the admin, it just stops appearing here.
  const staff = catalog().staff().filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, role: s.role, hue: s.hue }));
  const services = bookableServices();
  return (
    <PublicShell>
      <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">Book an appointment</h1>
      <p className="mt-1.5 max-w-[60ch] text-ink-2">
        Choose a treatment and a time. You will get a link to move or cancel it later, no account needed.
      </p>
      <BookingFlow
        services={services}
        staff={staff}
        todayDate={today()}
        initialService={services.find((s) => s.id === sp.service)?.id ?? null}
        initialWith={typeof sp.with === 'string' && staff.some((s) => s.id === sp.with) ? sp.with : 'any'}
      />
    </PublicShell>
  );
}
