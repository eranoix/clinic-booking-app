import { NextResponse } from 'next/server';
import { failure } from '@/server/http';
import { cancel } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** POST /api/bookings/:token/cancel -- safe to repeat; the record is kept. */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    return NextResponse.json({ booking: cancel(token) });
  } catch (err) {
    return failure(err);
  }
}
