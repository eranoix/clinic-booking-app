'use server';

/**
 * Front-desk writes. Each one re-validates on the server -- a form value is a
 * claim, not a fact -- and hands the decision to the engine or the catalogue.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { windowsForDate, type WeeklyRule } from 'clinic-booking-app/availability';
import { dateOf, isValidDate, minutesOf, today } from '@/lib/time';
import type { ApiError, BookingDTO } from '@/lib/types';
import { requireAdmin } from '@/server/auth';
import { resetDemo } from '@/server/db';
import { HUES } from '@/server/catalog';
import {
  DiaryError, bookings, busyOn, cancel, cancelCourseFrom, catalog, engine, reschedule,
} from '@/server/scheduling';

export type ActionState = { ok?: true; message?: string } & Partial<ApiError>;

function asError(err: unknown): ActionState {
  if (err instanceof DiaryError) {
    return { error: { code: err.code, message: err.message, ...(err.alternatives ? { alternatives: err.alternatives } : {}) } };
  }
  throw err;
}

// -- bookings ---------------------------------------------------------------

export async function rescheduleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = Number(form.get('id'));
  const startsAt = Number(form.get('startsAt'));
  const staffId = String(form.get('staffId') ?? '');
  const current = engine().byId(id);
  if (!current) return { error: { code: 'not_found', message: 'That booking no longer exists.' } };
  if (!Number.isFinite(startsAt)) return { error: { code: 'invalid', message: 'Choose a new time first.' } };
  try {
    // Desk rules: reception may move someone inside the online notice period.
    reschedule(current.publicToken, startsAt, { ...(staffId ? { staffId } : {}), rules: 'desk' });
  } catch (err) {
    return asError(err);
  }
  revalidatePath('/admin', 'layout');
  redirect(`/admin/bookings/${id}?done=moved`);
}

export async function cancelAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(form.get('id'));
  const current = engine().byId(id);
  if (!current) redirect('/admin/bookings');
  cancel(current.publicToken);
  revalidatePath('/admin', 'layout');
  redirect(`/admin/bookings/${id}?done=cancelled`);
}

// -- availability -----------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function checkWindows(windows: { start: string; end: string }[], where: string): string | null {
  const sorted = [...windows].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (const w of sorted) {
    if (!HHMM.test(w.start) || !HHMM.test(w.end)) return `${where}: times must look like 09:00.`;
    if (minutesOf(w.end) <= minutesOf(w.start)) return `${where}: ${w.start} to ${w.end} ends before it starts.`;
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (minutesOf(sorted[i]!.start) < minutesOf(sorted[i - 1]!.end)) {
      return `${where}: ${sorted[i - 1]!.start}–${sorted[i - 1]!.end} and ${sorted[i]!.start}–${sorted[i]!.end} overlap.`;
    }
  }
  return null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface HoursResult {
  ok?: true;
  error?: string;
  /** Upcoming bookings that now fall outside the hours. They are kept, not moved. */
  outside?: BookingDTO[];
}

export async function saveHoursAction(staffId: string, rules: WeeklyRule[]): Promise<HoursResult> {
  await requireAdmin();
  const member = catalog().member(staffId);
  if (!member) return { error: 'That person is not in the diary.' };
  if (!Array.isArray(rules)) return { error: 'Nothing to save.' };
  for (let wd = 0; wd < 7; wd += 1) {
    const problem = checkWindows(rules.filter((r) => r.weekday === wd), DAY_NAMES[wd]!);
    if (problem) return { error: problem };
  }
  if (rules.some((r) => !Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6)) {
    return { error: 'A weekday is out of range.' };
  }
  const clean = rules.map((r) => ({ weekday: r.weekday, start: r.start, end: r.end }));
  catalog().setWeeklyHours(staffId, clean);
  revalidatePath('/admin', 'layout');
  return { ok: true, outside: outsideHours(staffId) };
}

export async function putExceptionAction(staffId: string, input: {
  date: string; kind: 'closed' | 'open'; note: string; windows: { start: string; end: string }[];
}): Promise<HoursResult> {
  await requireAdmin();
  if (!catalog().member(staffId)) return { error: 'That person is not in the diary.' };
  if (!isValidDate(input.date)) return { error: 'Choose a date.' };
  if (input.date < today()) return { error: 'That date has already passed.' };
  if (input.kind !== 'closed' && input.kind !== 'open') return { error: 'Choose closed or open.' };
  const note = String(input.note ?? '').trim().slice(0, 80);
  if (input.kind === 'open') {
    if (!input.windows?.length) return { error: 'Add the hours this day is open.' };
    const problem = checkWindows(input.windows, 'That day');
    if (problem) return { error: problem };
  }
  catalog().putException(staffId, {
    date: input.date, kind: input.kind, note,
    ...(input.kind === 'open' ? { windows: input.windows.map((w) => ({ start: w.start, end: w.end })) } : {}),
  });
  revalidatePath('/admin', 'layout');
  return { ok: true, outside: outsideHours(staffId) };
}

export async function removeExceptionAction(staffId: string, date: string): Promise<HoursResult> {
  await requireAdmin();
  catalog().removeException(staffId, date);
  revalidatePath('/admin', 'layout');
  return { ok: true, outside: outsideHours(staffId) };
}

/** Busy intervals for the live preview: bookings are the only input the browser cannot compute. */
export async function busyAction(staffId: string, date: string) {
  await requireAdmin();
  if (!isValidDate(date) || !catalog().member(staffId)) return [];
  return busyOn(staffId, date);
}

/**
 * Upcoming confirmed bookings that the current hours no longer cover.
 *
 * Changing hours never cancels anybody: a booking is a promise to a person,
 * and the diary does not break it silently. The front desk is told who is
 * affected so someone can call them.
 */
function outsideHours(staffId: string): BookingDTO[] {
  const member = catalog().member(staffId);
  if (!member) return [];
  const now = Date.now();
  return bookings({ from: now, to: now + 120 * 86_400_000, resourceId: staffId, status: 'confirmed' })
    .filter((b) => !windowsForDate(member.calendar, dateOf(b.startsAt))
      .some((w) => w.start <= b.startsAt && b.endsAt <= w.end));
}

// -- services ---------------------------------------------------------------

export interface ServiceResult {
  ok?: true;
  error?: string;
  field?: string;
  /** Id of a service just added. */
  created?: string;
}

export async function saveServiceAction(_prev: ServiceResult, form: FormData): Promise<ServiceResult> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const existing = id ? catalog().service(id) : null;
  if (id && !existing) return { error: 'That service no longer exists.' };

  const int = (name: string) => {
    const raw = String(form.get(name) ?? '').trim();
    return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  };
  const name = String(form.get('name') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const durationMin = int('durationMin');
  const stepMin = int('stepMin');
  const bufferAfterMin = int('bufferAfterMin');
  const minNoticeHours = Number(String(form.get('minNoticeHours') ?? '').trim());
  const maxAdvanceDays = int('maxAdvanceDays');
  const staffIds = form.getAll('staff').map(String).filter((s) => catalog().member(s));

  if (name.length < 2) return { error: 'Give the service a name patients will recognise.', field: 'name' };
  if (!(durationMin >= 5 && durationMin <= 480)) return { error: 'Length must be between 5 and 480 minutes.', field: 'durationMin' };
  if (!(stepMin >= 5 && stepMin <= 240)) return { error: 'Start times must be between 5 and 240 minutes apart.', field: 'stepMin' };
  if (!(bufferAfterMin >= 0 && bufferAfterMin <= 120)) return { error: 'The gap after must be between 0 and 120 minutes.', field: 'bufferAfterMin' };
  if (!(minNoticeHours >= 0 && minNoticeHours <= 24 * 14) || !Number.isFinite(minNoticeHours)) {
    return { error: 'Notice must be between 0 and 336 hours.', field: 'minNoticeHours' };
  }
  if (!(maxAdvanceDays >= 1 && maxAdvanceDays <= 365)) return { error: 'Booking ahead must be between 1 and 365 days.', field: 'maxAdvanceDays' };
  if (staffIds.length === 0) return { error: 'Choose at least one practitioner, or patients cannot book it.', field: 'staff' };

  const def = {
    name, description, durationMin, stepMin, bufferAfterMin,
    minNoticeMin: Math.round(minNoticeHours * 60), maxAdvanceDays, staffIds,
  };
  if (existing) {
    catalog().putService({ ...def, id: existing.id, active: existing.active }, catalog().services().findIndex((s) => s.id === id));
  } else {
    const created = catalog().addService(def);
    revalidatePath('/admin', 'layout');
    revalidatePath('/book');
    return { ok: true, created };
  }
  revalidatePath('/admin', 'layout');
  revalidatePath('/book');
  return { ok: true };
}

// -- course -----------------------------------------------------------------

export async function cancelCourseAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(form.get('id'));
  const cancelled = cancelCourseFrom(id);
  revalidatePath('/admin', 'layout');
  redirect(`/admin/bookings/${id}?done=course-cancelled&n=${cancelled.length}`);
}

// -- team -------------------------------------------------------------------

export interface TeamResult {
  ok?: true;
  error?: string;
  message?: string;
}

function staffFields(form: FormData): { name: string; role: string; hue: (typeof HUES)[number] } | string {
  const name = String(form.get('name') ?? '').trim();
  const role = String(form.get('role') ?? '').trim();
  const hue = String(form.get('hue') ?? '');
  if (name.length < 2 || name.length > 80) return 'Enter a name between 2 and 80 characters.';
  if (role.length > 80) return 'Keep the role under 80 characters.';
  if (!(HUES as readonly string[]).includes(hue)) return 'Choose a colour.';
  return { name, role, hue: hue as (typeof HUES)[number] };
}

export async function createStaffAction(_prev: TeamResult, form: FormData): Promise<TeamResult> {
  await requireAdmin();
  const fields = staffFields(form);
  if (typeof fields === 'string') return { error: fields };
  const id = catalog().addStaff(fields);
  revalidatePath('/admin', 'layout');
  redirect(`/admin/availability?staff=${id}&added=1`);
}

export async function updateStaffAction(_prev: TeamResult, form: FormData): Promise<TeamResult> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (!catalog().member(id)) return { error: 'That person is no longer in the diary.' };
  const fields = staffFields(form);
  if (typeof fields === 'string') return { error: fields };
  catalog().updateStaff(id, fields);
  revalidatePath('/admin', 'layout');
  revalidatePath('/book');
  return { ok: true, message: 'Saved.' };
}

export async function setStaffActiveAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const active = form.get('active') === '1';
  if (!catalog().member(id)) redirect('/admin/team');
  catalog().setStaffActive(id, active);
  revalidatePath('/admin', 'layout');
  revalidatePath('/book');
  redirect(`/admin/team?done=${active ? 'reactivated' : 'deactivated'}&who=${encodeURIComponent(id)}`);
}

export async function deleteStaffAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  // Someone with any booking, past or cancelled, is deactivated instead:
  // deleting them would leave appointments that name nobody.
  if (engine().list({ resourceId: id, limit: 1 }).length) redirect('/admin/team?done=kept');
  catalog().deleteStaff(id);
  revalidatePath('/admin', 'layout');
  redirect('/admin/team?done=removed');
}

// -- service lifecycle ------------------------------------------------------

export async function setServiceActiveAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const active = form.get('active') === '1';
  if (catalog().service(id)) catalog().setServiceActive(id, active);
  revalidatePath('/admin', 'layout');
  revalidatePath('/book');
  redirect(`/admin/services?done=${active ? 'reactivated' : 'deactivated'}#svc-${id}`);
}

export async function deleteServiceAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (engine().list({ serviceId: id, limit: 1 }).length) redirect('/admin/services?done=kept');
  catalog().deleteService(id);
  revalidatePath('/admin', 'layout');
  revalidatePath('/book');
  redirect('/admin/services?done=removed');
}

// -- demo -------------------------------------------------------------------

export async function resetAction(): Promise<void> {
  await requireAdmin();
  resetDemo();
  revalidatePath('/', 'layout');
  redirect('/admin?done=reset');
}
