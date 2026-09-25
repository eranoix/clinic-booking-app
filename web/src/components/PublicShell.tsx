import Link from 'next/link';
import { CLINIC } from '@/lib/clinic';
import { Mark } from './Mark';
import { ThemeToggle } from './ThemeToggle';

/** Header and footer for the pages patients see. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/book" className="flex items-center gap-2.5 rounded-md">
            <Mark />
            <span className="leading-tight">
              <span className="block font-semibold tracking-[-0.01em]">{CLINIC.name}</span>
              <span className="block text-sm text-ink-3">{CLINIC.city}</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-12">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-2 px-4 py-5 text-sm text-ink-3 sm:px-6">
          <span>All times are Lisbon time.</span>
          <span>A fictional clinic, for demonstration. Nothing booked here is real.</span>
        </div>
      </footer>
    </div>
  );
}
