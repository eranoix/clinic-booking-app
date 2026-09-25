import { NextResponse } from 'next/server';
import { failure, num, readJson, str } from '@/server/http';
import { ANY, book } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bookings
 * { service, staff, preference?, startsAt, name, email } -> 201 { booking, manageUrl }
 *
 * 409 slot_taken carries `alternatives`: the nearest times still free.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const booking = book({
      serviceId: str(body.service), staffId: str(body.staff), preference: str(body.preference) || ANY,
      startsAt: num(body.startsAt), name: str(body.name), email: str(body.email),
    });
    return NextResponse.json({ booking, manageUrl: `/b/${booking.token}` }, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}
