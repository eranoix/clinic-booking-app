import { NextResponse, type NextRequest } from 'next/server';
import { isValidDate } from '@/lib/time';
import { requireAdmin } from '@/server/auth';
import { failure } from '@/server/http';
import { ANY, DiaryError, slotsOn } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** GET /api/slots?service=follow-up&staff=any&date=2026-10-01 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    // `rules=desk` is the front desk's view (no notice period, longer horizon).
    const rules = q.get('rules') === 'desk' ? 'desk' : 'public';
    if (rules === 'desk') await requireAdmin();
    const date = q.get('date');
    if (!isValidDate(date)) throw new DiaryError('invalid', 'date must be YYYY-MM-DD.');
    const slots = slotsOn(q.get('service') ?? '', q.get('staff') || ANY, date, rules);
    return NextResponse.json({ date, slots });
  } catch (err) {
    return failure(err);
  }
}
