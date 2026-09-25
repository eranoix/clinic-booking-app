import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout -> clears the session and goes back to /login. */
export async function POST() {
  // Relative, so it works behind Docker and proxies alike.
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login?signed_out=1' } });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
