'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Today' },
  { href: '/admin/bookings', label: 'Bookings' },
  { href: '/admin/availability', label: 'Availability' },
  { href: '/admin/team', label: 'Team' },
  { href: '/admin/services', label: 'Services' },
  { href: '/admin/patients', label: 'Patients' },
  { href: '/admin/outbox', label: 'Outbox' },
] as const;

export function AdminNav() {
  const path = usePathname();
  const active = (href: string) => (href === '/admin'
    ? path === href
    : path.startsWith(href) && !(href === '/admin/bookings' && path.startsWith('/admin/bookings/new')));
  return (
    <nav aria-label="Front desk" className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col md:overflow-visible">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active(item.href) ? 'page' : undefined}
          className={`relative shrink-0 rounded-md px-3 py-1.5 text-base transition-colors md:py-2 ${
            active(item.href)
              ? 'bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)] md:before:absolute md:before:inset-y-2 md:before:-left-3 md:before:w-[3px] md:before:rounded-full md:before:bg-accent'
              : 'text-ink-2 hover:bg-surface/60 hover:text-ink'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
