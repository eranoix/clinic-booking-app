import { PageHeader } from '@/components/ui';
import { today } from '@/lib/time';
import { bookableServices, catalog, engine } from '@/server/scheduling';
import { NewBookingForm } from './NewBookingForm';

export const metadata = { title: 'New booking' };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const services = bookableServices();
  const staff = catalog().staff().filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, hue: s.hue }));
  const patients = engine().customers().map((c) => ({ name: c.name, email: c.email, lastSeenAt: c.lastSeenAt, nextStartsAt: c.nextStartsAt }));
  const preset = typeof sp.patient === 'string' ? sp.patient.toLowerCase() : null;
  return (
    <>
      <PageHeader
        title="New booking"
        lead="For a patient on the phone or at the desk. The front desk can book inside the online notice period and further ahead; hours, gaps and other appointments still apply."
      />
      <NewBookingForm
        services={services}
        staff={staff}
        patients={patients}
        todayDate={today()}
        initialPatient={patients.some((p) => p.email === preset) ? preset : null}
      />
    </>
  );
}
