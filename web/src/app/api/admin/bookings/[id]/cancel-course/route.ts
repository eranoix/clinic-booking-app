import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth';
import { failure } from '@/server/http';
import { cancelCourseFrom } from '@/server/scheduling';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    return NextResponse.json({ cancelled: cancelCourseFrom(Number((await ctx.params).id)) });
  } catch (err) {
    return failure(err);
  }
}
