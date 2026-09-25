import Link from 'next/link';
import { PageHeader, SectionTitle } from '@/components/ui';
import { WEEKDAYS, WEEK_ORDER } from '@/lib/time';
import { catalog, engine } from '@/server/scheduling';
import { AddPerson, PersonCard } from './TeamForms';

export const metadata = { title: 'Team' };

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const now = Date.now();
  const services = catalog().services();
  const people = catalog().staff().map((s) => {
    const all = engine().list({ resourceId: s.id });
    const upcoming = all.filter((b) => b.status === 'confirmed' && b.startsAt > now).length;
    const days = WEEK_ORDER.filter((d) => s.calendar.weekly.some((w) => w.weekday === d)).map((d) => WEEKDAYS[d]!.slice(0, 3));
    return {
      id: s.id, name: s.name, role: s.role, hue: s.hue, active: s.active,
      total: all.length, upcoming,
      services: services.filter((x) => x.staffIds.includes(s.id) && x.active).map((x) => x.name),
      days,
    };
  });
  const active = people.filter((p) => p.active);
  const former = people.filter((p) => !p.active);
  const done = typeof sp.done === 'string' ? sp.done : '';
  const who = people.find((p) => p.id === sp.who)?.name;

  return (
    <>
      <PageHeader
        title="Team"
        lead="Who can be booked. Someone who leaves is deactivated rather than deleted: their past appointments keep their name, and they stop being offered for new ones."
      />
      {done ? (
        <p role="status" className="mb-6 rounded-md border border-line bg-surface-2 px-4 py-3 text-ink-2">
          {done === 'deactivated' ? `${who ?? 'They'} will no longer be offered for new bookings. Their history is unchanged.`
            : done === 'reactivated' ? `${who ?? 'They'} can be booked again, within their hours.`
              : done === 'removed' ? 'Removed. They had no bookings, so nothing referred to them.'
                : done === 'kept' ? 'Not removed: they have bookings in the history. Deactivate them instead.' : null}
        </p>
      ) : null}

      <section aria-labelledby="active-h" className="mb-12">
        <SectionTitle id="active-h" aside={`${active.length} taking bookings`}>Practitioners</SectionTitle>
        <div className="space-y-3">
          {active.map((p) => <PersonCard key={p.id} person={p} />)}
        </div>
      </section>

      <section aria-labelledby="add-h" className="mb-12">
        <SectionTitle id="add-h">Add someone</SectionTitle>
        <AddPerson />
        <p className="mt-2 text-sm text-ink-3">
          A new person starts with no hours. You are taken to <Link className="text-accent underline" href="/admin/availability">Availability</Link> to set them, and to Services to say what they offer.
        </p>
      </section>

      {former.length ? (
        <section aria-labelledby="former-h">
          <SectionTitle id="former-h" aside="Kept for the history">Former practitioners</SectionTitle>
          <div className="space-y-3">
            {former.map((p) => <PersonCard key={p.id} person={p} />)}
          </div>
        </section>
      ) : null}
    </>
  );
}
