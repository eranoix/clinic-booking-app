import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, adminPassword, verifySession } from '@/lib/session';

export async function middleware(req: NextRequest) {
  const password = adminPassword();
  if (!password) return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, password)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in to the front desk first.' } }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?${new URLSearchParams({ next: req.nextUrl.pathname + req.nextUrl.search })}`;
  return NextResponse.redirect(login);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/admin/:path*', '/admin', '/api/admin/:path*'],
};
