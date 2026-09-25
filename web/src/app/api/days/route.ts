import { NextResponse, type NextRequest } from 'next/server';
import { isValidDate, today } from '@/lib/time';
import { requireAdmin } from '@/server/auth';
import { failure } from '@/server/http';
import { ANY, DiaryError, dayCounts } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** GET /api/days?service=follow-up&staff=any&from=2026-10-01&days=14 -- free times per date. */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    // `rules=desk` is the front desk's view (no notice period, longer horizon).
    const rules = q.get('rules') === 'desk' ? 'desk' : 'public';
    if (rules === 'desk') await requireAdmin();
    const from = q.get('from') ?? today();
    if (!isValidDate(from)) throw new DiaryError('invalid', 'from must be YYYY-MM-DD.');
    const days = Math.min(62, Math.max(1, Number(q.get('days') ?? 14) || 14));
    return NextResponse.json({ days: dayCounts(q.get('service') ?? '', q.get('staff') || ANY, from, days, rules) });
  } catch (err) {
    return failure(err);
  }
}
