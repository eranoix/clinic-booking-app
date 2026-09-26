import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, adminPassword, verifySession } from '@/lib/session';

/**
 * The front desk behind a password, when ADMIN_PASSWORD is set: pages redirect
 * to /login and admin API calls get a 401. Server actions and admin routes
 * check the session again; this is the front door, not the only lock.
 */
export async function middleware(req: NextRequest) {
  const password = adminPassword();
  if (!password) return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, password)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in to the front desk first.' } }, { status: 401 });
  }
  // nextUrl follows the Host the browser sent; behind Docker the server's own
  // address would be 0.0.0.0.
  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?${new URLSearchParams({ next: req.nextUrl.pathname + req.nextUrl.search })}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Node, not Edge: ADMIN_PASSWORD is read when the server runs, so a Docker
  // image built without it can be started with it.
  runtime: 'nodejs',
  matcher: ['/admin/:path*', '/admin', '/api/admin/:path*'],
};
