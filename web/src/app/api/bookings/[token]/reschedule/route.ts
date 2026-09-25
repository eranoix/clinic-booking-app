import { NextResponse } from 'next/server';
import { failure, num, readJson } from '@/server/http';
import { reschedule } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** POST /api/bookings/:token/reschedule { startsAt } -- same booking, same link, new time. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const body = await readJson(req);
    return NextResponse.json({ booking: reschedule(token, num(body.startsAt)) });
  } catch (err) {
    return failure(err);
  }
}
