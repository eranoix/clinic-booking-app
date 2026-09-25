import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui';
import { relativeDay, time } from '@/lib/time';
import { engine } from '@/server/scheduling';

export const metadata = { title: 'Patients' };

export default async function PatientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();
  const now = Date.now();
  const all = engine().customers();
  const list = q ? all.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q.toLowerCase())) : all;

  return (
    <>
      <PageHeader
        title="Patients"
        lead="Everyone who has booked, most recently seen first. Patients do not need an account: they are recognised by the email they book with."
      />
      <form role="search" className="mb-6 flex max-w-md gap-2">
        <label className="sr-only" htmlFor="p-q">Find a patient</label>
        <input id="p-q" name="q" type="search" className="field" placeholder="Name or email" defaultValue={q} autoComplete="off" />
        <button className="btn-quiet" type="submit">Find</button>
      </form>

      {list.length === 0 ? (
        <EmptyState title={q ? `Nobody matches “${q}”` : 'No patients yet'}>
          {q ? <Link className="text-accent underline" href="/admin/patients">Show everyone</Link> : 'They appear here after their first booking.'}
        </EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="text-sm text-ink-3">
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2.5 font-normal">Patient</th>
                <th scope="col" className="px-4 py-2.5 text-right font-normal">Visits</th>
                <th scope="col" className="px-4 py-2.5 text-right font-normal">Cancelled</th>
                <th scope="col" className="px-4 py-2.5 font-normal">Last seen</th>
                <th scope="col" className="px-4 py-2.5 font-normal">Next</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {list.map((c) => {
                const visits = c.confirmed - c.upcoming;
                return (
                  <tr key={c.email} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/patients/${encodeURIComponent(c.email)}`} className="font-medium hover:text-accent">{c.name}</Link>
                      <span className="block text-sm text-ink-3">{c.email}</span>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{visits}</td>
                    <td className={`tnum px-4 py-2.5 text-right ${c.cancelled ? '' : 'text-ink-3'}`}>{c.cancelled}</td>
                    <td className="px-4 py-2.5 text-ink-2">{c.lastSeenAt ? relativeDay(c.lastSeenAt, now) : <span className="text-ink-3">Not yet seen</span>}</td>
                    <td className="px-4 py-2.5">
                      {c.nextStartsAt ? <span>{relativeDay(c.nextStartsAt, now)}, <span className="tnum">{time(c.nextStartsAt)}</span></span> : <span className="text-ink-3">Nothing booked</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-ink-3">{list.length} of {all.length} patients. Visits count past appointments that were not cancelled.</p>
    </>
  );
}
