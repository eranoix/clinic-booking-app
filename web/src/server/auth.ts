import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, adminPassword, verifySession } from '@/lib/session';

/** True when sign-in is off, or the request carries a valid session. */
export async function isAdmin(): Promise<boolean> {
  const password = adminPassword();
  if (!password) return true;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, password);
}

export class Unauthorized extends Error {
  constructor() {
    super('Sign in to the front desk first.');
  }
}

/** For server actions and admin routes: the middleware's check, repeated where the write happens. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Unauthorized();
}

/** Hash both sides first so the comparison is over equal lengths, then compare in constant time. */
export function passwordMatches(attempt: string): boolean {
  const password = adminPassword();
  if (!password) return false;
  const a = createHash('sha256').update(attempt).digest();
  const b = createHash('sha256').update(password).digest();
  return timingSafeEqual(a, b);
}

export const signInEnabled = () => adminPassword() !== null;
