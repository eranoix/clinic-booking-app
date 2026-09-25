import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { failure, num, readJson, str } from '@/server/http';
import { DiaryError, engine, reschedule } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** POST /api/admin/bookings/:id/move { startsAt, staff? } -- new time, and optionally another practitioner, in one step. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const b = engine().byId(Number((await ctx.params).id));
    if (!b) throw new DiaryError('not_found', 'That booking no longer exists.');
    const body = await readJson(req);
    const staff = str(body.staff);
    return NextResponse.json({ booking: reschedule(b.publicToken, num(body.startsAt), { ...(staff ? { staffId: staff } : {}), rules: 'desk' }) });
  } catch (err) {
    return failure(err);
  }
}
