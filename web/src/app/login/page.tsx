import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Mark } from '@/components/Mark';
import { CLINIC } from '@/lib/clinic';
import { signInEnabled } from '@/server/auth';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!signInEnabled()) redirect('/admin');
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '/admin';
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-16">
      <div className="mb-8 flex items-center gap-3">
        <Mark size={32} />
        <span className="leading-tight">
          <span className="block font-semibold">{CLINIC.shortName}</span>
          <span className="block text-sm text-ink-3">Front desk</span>
        </span>
      </div>
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Sign in</h1>
      <p className="mt-1 text-ink-2">The front desk is protected by the password in ADMIN_PASSWORD.</p>
      {sp.error ? <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">That password is not right.</p> : null}
      {sp.signed_out ? <p role="status" className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">Signed out.</p> : null}
      <form method="post" action="/api/auth/login" className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" name="password" type="password" className="field" autoComplete="current-password" required autoFocus />
        </div>
        <button className="btn-primary w-full" type="submit">Sign in</button>
      </form>
      <Link href="/book" className="mt-8 text-sm text-accent hover:underline">Book an appointment instead</Link>
    </div>
  );
}
