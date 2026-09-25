import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { resetDemo } from '@/server/db';
import { failure } from '@/server/http';

export const dynamic = 'force-dynamic';

/** POST /api/admin/reset -- empty the demo and seed it again. */
export async function POST() {
  try {
    await requireAdmin();
    return NextResponse.json(resetDemo());
  } catch (err) {
    return failure(err);
  }
}
