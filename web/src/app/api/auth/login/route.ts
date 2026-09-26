import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_HOURS, adminPassword, issueSession } from '@/lib/session';
import { passwordMatches } from '@/server/auth';

export const dynamic = 'force-dynamic';

/** Only paths inside the admin: a `next` pointing anywhere else is ignored. */
function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === 'string' ? raw : '';
  return /^\/admin(\/|\?|$)/.test(next) ? next : '/admin';
}

/** A relative Location: built from req.url it would carry the bind address (0.0.0.0 in Docker). */
const seeOther = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location } });

const secure = (req: NextRequest) =>
  req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

/** POST /api/auth/login (form: password, next) -> 303 to `next` with the session cookie, or back to /login. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get('next') ?? null);
  const password = adminPassword();
  if (!password) return seeOther(next);

  const attempt = form?.get('password');
  if (typeof attempt !== 'string' || !passwordMatches(attempt)) {
    // A small, fixed delay makes guessing slow without telling anyone anything.
    await new Promise((r) => setTimeout(r, 400));
    return seeOther(`/login?${new URLSearchParams({ error: '1', next })}`);
  }

  const res = seeOther(next);
  res.cookies.set(SESSION_COOKIE, await issueSession(password), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600, secure: secure(req),
  });
  return res;
}
