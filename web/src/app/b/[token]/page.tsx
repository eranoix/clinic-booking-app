import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicShell } from '@/components/PublicShell';
import { today } from '@/lib/time';
import { bookingByToken, catalog } from '@/server/scheduling';
import { ManageBooking } from './ManageBooking';

export const metadata: Metadata = { title: 'Your appointment', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = bookingByToken(token);

  if (!booking) notFound();

  const service = catalog().service(booking.serviceId);
  return (
    <PublicShell>
      <ManageBooking initial={booking} horizonDays={service?.maxAdvanceDays ?? 30} todayDate={today()} />
    </PublicShell>
  );
}
