import { NextResponse } from 'next/server';
import { failure } from '@/server/http';
import { DiaryError, bookingByToken } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** GET /api/bookings/:token -- the booking behind a manage link. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const booking = bookingByToken(token);
    if (!booking) throw new DiaryError('not_found', 'We could not find that booking. Check the link in your confirmation.');
    return NextResponse.json({ booking });
  } catch (err) {
    return failure(err);
  }
}
