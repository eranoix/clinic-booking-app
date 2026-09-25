import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { failure, num, readJson, str } from '@/server/http';
import { ANY, book, bookCourse } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/bookings -- the front desk books for someone.
 * { service, staff, preference?, startsAt, name, email, repeat?: { count, intervalWeeks } }
 *
 * Desk rules: no online notice period, a longer horizon. Without `repeat`,
 * 201 { booking }. With it, 201 { course: { seriesId, booked, skipped } }.
 * A lost race is 409 slot_taken with `alternatives`, as on /api/bookings.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const base = {
      serviceId: str(body.service), staffId: str(body.staff), startsAt: num(body.startsAt),
      name: str(body.name), email: str(body.email), rules: 'desk' as const,
    };
    const repeat = body.repeat && typeof body.repeat === 'object' ? body.repeat as Record<string, unknown> : null;
    if (repeat) {
      const course = bookCourse({ ...base, count: num(repeat.count), intervalWeeks: num(repeat.intervalWeeks) });
      return NextResponse.json({ course }, { status: 201 });
    }
    const booking = book({ ...base, preference: str(body.preference) || ANY });
    return NextResponse.json({ booking }, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}
