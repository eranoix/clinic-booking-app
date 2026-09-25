import { PageHeader, SectionTitle } from '@/components/ui';
import { catalog, engine } from '@/server/scheduling';
import { ServiceForm } from './ServiceForm';
import { ServiceLifecycle } from './ServiceLifecycle';

export const metadata = { title: 'Services' };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const services = catalog().services().map((s) => ({ ...s, bookings: engine().list({ serviceId: s.id }).length }));
  const staff = catalog().staff().filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, hue: s.hue }));
  const active = services.filter((s) => s.active);
  const former = services.filter((s) => !s.active);
  const done = typeof sp.done === 'string' ? sp.done : '';
  return (
    <>
      <PageHeader
        title="Services"
        lead="What patients can book, and the rules that decide which times they are offered. A change applies to new bookings immediately; appointments already booked keep the length they were booked with."
      />
      {done ? (
        <p role="status" className="mb-6 rounded-md border border-line bg-surface-2 px-4 py-3 text-ink-2">
          {done === 'deactivated' ? 'No longer offered. Its bookings are kept in the history.'
            : done === 'reactivated' ? 'Offered again.'
              : done === 'removed' ? 'Removed. It had never been booked.'
                : 'Not removed: it has bookings in the history. Deactivate it instead.'}
        </p>
      ) : null}
      <div className="space-y-6">
        {active.map((s) => (
          <div key={s.id}>
            <ServiceForm service={s} staff={staff} bookings={s.bookings} />
            <ServiceLifecycle id={s.id} name={s.name} active bookings={s.bookings} />
          </div>
        ))}
      </div>

      <section aria-labelledby="add-svc" className="mt-12">
        <SectionTitle id="add-svc">Add a service</SectionTitle>
        {/* Keyed by the count, so the form empties itself once a service is added. */}
        <ServiceForm key={services.length} staff={staff} />
        <p className="mt-2 text-sm text-ink-3">A new service is offered as soon as it is added, by the practitioners ticked, within their hours.</p>
      </section>

      {former.length ? (
        <section aria-labelledby="former-svc" className="mt-12">
          <SectionTitle id="former-svc" aside="Kept for the history">No longer offered</SectionTitle>
          <div className="space-y-6">
            {former.map((s) => (
              <div key={s.id}>
                <ServiceForm service={s} staff={staff} bookings={s.bookings} />
                <ServiceLifecycle id={s.id} name={s.name} active={false} bookings={s.bookings} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
