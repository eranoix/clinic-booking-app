import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { today } from '@/lib/time';
import { catalog } from '@/server/scheduling';
import { HoursEditor } from './HoursEditor';

export const metadata = { title: 'Availability' };

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const staff = catalog().staff();
  const wanted = typeof sp.staff === 'string' ? sp.staff : '';
  const member = staff.find((s) => s.id === wanted) ?? staff.find((s) => s.active) ?? staff[0];
  if (!member) return <PageHeader title="Availability" lead="Nobody is in the diary yet." />;

  const services = catalog().services().filter((s) => s.staffIds.includes(member.id));
  const exceptions = catalog().exceptionsOf(member.id).filter((e) => e.date >= today());

  return (
    <>
      <PageHeader
        title="Availability"
        lead="When each person can be booked. Changes apply to new bookings straight away; existing appointments are never moved or cancelled by a change of hours."
      />
      <nav aria-label="Practitioner" className="mb-8 flex flex-wrap gap-2">
        {staff.map((s) => (
          <Link
            key={s.id}
            href={`/admin/availability?staff=${s.id}`}
            aria-current={s.id === member.id ? 'page' : undefined}
            className={`hue-${s.hue} inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 ${
              s.id === member.id ? 'border-[var(--hue)] bg-[var(--hue-soft)] font-medium' : 'border-line bg-surface text-ink-2 hover:text-ink'
            }`}
          >
            <span className="size-2 rounded-full bg-[var(--hue)]" aria-hidden="true" />
            {s.name}{s.active ? '' : <span className="text-ink-3"> (former)</span>}
          </Link>
        ))}
      </nav>
      {sp.added ? (
        <p role="status" className="mb-6 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-ok">
          {member.name} is on the team. Set their weekly hours below, then tick what they offer in Services; until both are done, nobody can book them.
        </p>
      ) : null}
      {member.active ? null : (
        <p className="mb-6 rounded-md border border-line bg-surface-2 px-4 py-3 text-ink-2">
          {member.name} is not taking bookings, so these hours are not offered. Reactivate them in Team to offer them again.
        </p>
      )}
      <HoursEditor
        key={member.id}
        member={member}
        services={services}
        exceptions={exceptions}
        todayDate={today()}
      />
    </>
  );
}
