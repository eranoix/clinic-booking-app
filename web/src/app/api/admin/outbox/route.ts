import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { failure } from '@/server/http';
import { engine } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/** GET /api/admin/outbox?to=&booking=&series=&limit= -- the messages the clinic would have sent, newest first. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = req.nextUrl.searchParams;
    const limit = Math.min(500, Math.max(1, Number(q.get('limit') ?? 50) || 50));
    const to = q.get('to');
    const booking = Number(q.get('booking'));
    const series = q.get('series');
    return NextResponse.json({
      messages: engine().outbox({
        limit, ...(to ? { to } : {}), ...(booking > 0 ? { bookingId: booking } : {}), ...(series ? { seriesId: series } : {}),
      }),
    });
  } catch (err) {
    return failure(err);
  }
}
