import 'server-only';
import { NextResponse } from 'next/server';
import type { ApiError } from '@/lib/types';
import { Unauthorized } from './auth';
import { DiaryError } from './scheduling';

/** Every public endpoint answers errors in one shape: `{ error: { code, message, alternatives? } }`. */
export function failure(err: unknown): NextResponse<ApiError> {
  if (err instanceof Unauthorized) {
    return NextResponse.json({ error: { code: 'unauthorized', message: err.message } }, { status: 401 });
  }
  if (err instanceof DiaryError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.alternatives ? { alternatives: err.alternatives } : {}) } },
      { status: err.status },
    );
  }
  console.error(err);
  return NextResponse.json(
    { error: { code: 'invalid', message: 'Something went wrong on our side. Please try again.' } },
    { status: 500 },
  );
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new DiaryError('invalid', 'The request body must be a JSON object.');
}

export const str = (v: unknown) => (typeof v === 'string' ? v : '');
export const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : Number.NaN);
