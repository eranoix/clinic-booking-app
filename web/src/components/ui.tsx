import type { StaffMember } from '@/lib/types';

export function PageHeader({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h1>
        {lead ? <p className="mt-1.5 max-w-[62ch] text-ink-2">{lead}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, aside, id }: { children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-lg font-semibold tracking-[-0.01em]">{children}</h2>
      {aside ? <div className="text-sm text-ink-3">{aside}</div> : null}
    </div>
  );
}

export function StatusPill({ status, past }: { status: 'confirmed' | 'cancelled'; past?: boolean }) {
  if (status === 'cancelled') {
    return <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs text-ink-3">Cancelled</span>;
  }
  if (past) {
    return <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2 ring-1 ring-line">Past</span>;
  }
  return <span className="inline-flex items-center rounded-full bg-ok-soft px-2 py-0.5 text-xs text-ok">Booked</span>;
}

export function StaffTag({ member, name, hue }: {
  member?: Pick<StaffMember, 'name' | 'hue'>;
  name?: string | undefined;
  hue?: StaffMember['hue'] | undefined;
}) {
  const n = member?.name ?? name ?? '';
  const h = member?.hue ?? hue ?? 'blue';
  return (
    <span className={`hue-${h} inline-flex items-center gap-1.5 whitespace-nowrap`}>
      <span className="size-2 rounded-full bg-[var(--hue)]" aria-hidden="true" />
      {n}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-[48ch] text-sm text-ink-2">{children}</div> : null}
    </div>
  );
}
