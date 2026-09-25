import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { failure } from '@/server/http';
import { DiaryError, cancel, engine } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** POST /api/admin/bookings/:id/cancel */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const b = engine().byId(Number((await ctx.params).id));
    if (!b) throw new DiaryError('not_found', 'That booking no longer exists.');
    return NextResponse.json({ booking: cancel(b.publicToken) });
  } catch (err) {
    return failure(err);
  }
}
