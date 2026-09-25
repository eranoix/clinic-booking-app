import Link from 'next/link';
import type { Metadata } from 'next';
import { Mark } from '@/components/Mark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CLINIC } from '@/lib/clinic';
import { signInEnabled } from '@/server/auth';
import { AdminNav } from './AdminNav';
import { ResetButton } from './ResetButton';

export const metadata: Metadata = { title: { default: 'Front desk', template: `%s · ${CLINIC.shortName} front desk` } };
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const signIn = signInEnabled();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="border-b border-line bg-surface-2 px-4 pb-3 pt-4 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-5 md:py-6">
        <div className="mb-3 flex items-center justify-between md:mb-6">
          <Link href="/admin" className="flex items-center gap-2.5 rounded-md">
            <Mark />
            <span className="leading-tight">
              <span className="block font-semibold tracking-[-0.01em]">{CLINIC.shortName}</span>
              <span className="block text-sm text-ink-3">Front desk</span>
            </span>
          </Link>
          <ThemeToggle className="md:hidden" />
        </div>
        <Link href="/admin/bookings/new" className="btn-primary mb-4 hidden w-full md:flex">New booking</Link>
        <AdminNav />
        <div className="mt-auto hidden space-y-3 pt-6 md:block">
          <Link href="/book" className="block rounded-md text-sm text-accent underline-offset-4 hover:underline">
            Open the patient booking page
          </Link>
          {signIn ? <SignedIn /> : <DemoNotice />}
          <ThemeToggle className="-ml-2" />
          <ResetButton />
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 pb-16 pt-6 sm:px-6 md:px-10 md:pt-9">
        <div className="mx-auto max-w-[76rem]">
          <Link href="/admin/bookings/new" className="btn-primary mb-6 w-full md:hidden">New booking</Link>
          {children}
          <div className="mt-12 space-y-3 md:hidden">
            {signIn ? <SignedIn /> : <DemoNotice />}
            <ResetButton />
          </div>
        </div>
      </main>
    </div>
  );
}

function DemoNotice() {
  return (
    <p className="rounded-md border border-notice/30 bg-notice-soft px-3 py-2.5 text-xs text-notice">
      <strong className="font-semibold">Local demo, no sign-in.</strong>{' '}
      Anyone who can open this address can change the diary. Set ADMIN_PASSWORD to require one. Everyone in it is invented.
    </p>
  );
}

function SignedIn() {
  return (
    <form method="post" action="/api/auth/logout" className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-2">
      <span>Signed in to the front desk</span>
      <button type="submit" className="font-medium text-accent hover:underline">Sign out</button>
    </form>
  );
}
