/**
 * What the screens ask of the diary, in the clinic's vocabulary.
 *
 * Thin by design: every decision about whether a time can be booked is the
 * engine's. This module joins the engine's bookings to the catalogue's names,
 * merges several practitioners into one list of times for a patient who does
 * not mind who they see, and turns the engine's errors into sentences.
 */
import 'server-only';
import {
  BookingNotFound, SlotUnavailable, expand, type Booking, type Interval, type Service,
  type SkippedOccurrence,
} from 'clinic-booking-app';
import { CLINIC } from '@/lib/clinic';
import { addDays, dateOf, dayBounds, dayLong, time } from '@/lib/time';
import type { BookingDTO, ErrorCode, ServiceDef, SlotDTO, StaffMember } from '@/lib/types';
import { engineService } from './catalog';
import { handles } from './db';
import { skipReason } from './mail';

export const ANY = 'any';

/**
 * Whose rules apply. Patients book within each service's notice period and
 * online horizon. The front desk, on the phone to someone, may book inside
 * the notice period and further ahead; opening hours, gaps and other
 * appointments bind them exactly as they bind everyone else.
 */
export type Rules = 'public' | 'desk';
const DESK_HORIZON_DAYS = 366;

export class DiaryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly alternatives?: SlotDTO[],
  ) {
    super(message);
  }

  get status(): number {
    return this.code === 'not_found' ? 404 : this.code === 'invalid' ? 400 : 409;
  }
}

export function catalog() {
  return handles().catalog;
}

export function engine() {
  return handles().engine;
}

export function toDTO(b: Booking, staff: StaffMember[], services: ServiceDef[]): BookingDTO {
  return {
    id: b.id,
    token: b.publicToken,
    serviceId: b.serviceId,
    serviceName: services.find((s) => s.id === b.serviceId)?.name ?? b.serviceId,
    staffId: b.resourceId,
    staffName: staff.find((s) => s.id === b.resourceId)?.name ?? b.resourceId,
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
    seriesId: b.seriesId,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

const dto = (b: Booking) => toDTO(b, catalog().staff(), catalog().services());

/** Bookings joined to names, for anything that renders a list. */
export function bookings(q: Parameters<ReturnType<typeof engine>['list']>[0] = {}): BookingDTO[] {
  const staff = catalog().staff();
  const services = catalog().services();
  return engine().list(q).map((b) => toDTO(b, staff, services));
}

export function bookingById(id: number): BookingDTO | null {
  const b = engine().byId(id);
  return b ? dto(b) : null;
}

export function bookingByToken(token: string): BookingDTO | null {
  const b = engine().byToken(token);
  return b ? dto(b) : null;
}

/** Services a patient can book: active, with at least one active practitioner. */
export function bookableServices(): ServiceDef[] {
  const active = new Set(catalog().staff().filter((s) => s.active).map((s) => s.id));
  return catalog().services()
    .filter((s) => s.active)
    .map((s) => ({ ...s, staffIds: s.staffIds.filter((id) => active.has(id)) }))
    .filter((s) => s.staffIds.length > 0);
}

function requireService(serviceId: string, forNewBooking: boolean): ServiceDef {
  const svc = catalog().service(serviceId);
  if (!svc) throw new DiaryError('invalid', 'That service is not offered.');
  if (forNewBooking && !svc.active) throw new DiaryError('invalid', `${svc.name} is no longer offered.`);
  return svc;
}

export function rulesFor(svc: ServiceDef, rules: Rules): Service {
  const base = engineService(svc);
  return rules === 'desk' ? { ...base, minNoticeMin: 0, maxAdvanceDays: Math.max(base.maxAdvanceDays ?? 0, DESK_HORIZON_DAYS) } : base;
}

/** The practitioners a request may use: one named person, or any active one who offers the service. */
function practitioners(svc: ServiceDef, staffId: string): StaffMember[] {
  const all = catalog().staff().filter((s) => s.active && svc.staffIds.includes(s.id));
  if (staffId === ANY) return all;
  const one = all.find((s) => s.id === staffId);
  if (!one) {
    const who = catalog().member(staffId);
    throw new DiaryError('invalid', who && !who.active
      ? `${who.name} is not taking bookings at the moment.`
      : 'That practitioner does not offer this service.');
  }
  return [one];
}

/**
 * Bookable times in a window.
 *
 * With several practitioners, one time can be free with more than one of
 * them. Each time is listed once and given to the practitioner with the
 * least booked that day, so "anyone" spreads work instead of filling the
 * first diary in the list.
 */
export function slotsBetween(serviceId: string, staffId: string, from: number, to: number, rules: Rules = 'public'): SlotDTO[] {
  const svc = requireService(serviceId, false);
  const service = rulesFor(svc, rules);
  const people = practitioners(svc, staffId);
  const load = new Map<string, number>();
  const loadOf = (id: string, ts: number) => {
    const key = `${id}:${dateOf(ts)}`;
    if (!load.has(key)) {
      const { from: f, to: t } = dayBounds(dateOf(ts));
      load.set(key, engine().busy(id, f, t).length);
    }
    return load.get(key)!;
  };

  const byStart = new Map<number, SlotDTO>();
  for (const person of people) {
    for (const s of engine().available(person.id, person.calendar, service, from, to)) {
      const existing = byStart.get(s.start);
      if (!existing || loadOf(person.id, s.start) < loadOf(existing.staffId, s.start)) {
        byStart.set(s.start, { start: s.start, end: s.end, staffId: person.id, staffName: person.name });
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

export function slotsOn(serviceId: string, staffId: string, date: string, rules: Rules = 'public'): SlotDTO[] {
  const { from, to } = dayBounds(date);
  return slotsBetween(serviceId, staffId, from, to, rules);
}

/** How many times are free on each of the next `days` dates, for the date strip. */
export function dayCounts(serviceId: string, staffId: string, fromDate: string, days: number, rules: Rules = 'public'): { date: string; count: number }[] {
  const { from } = dayBounds(fromDate);
  const { to } = dayBounds(addDays(fromDate, days - 1));
  const slots = slotsBetween(serviceId, staffId, from, to, rules);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(fromDate, i);
    return { date, count: slots.filter((s) => dateOf(s.start) === date).length };
  });
}

/**
 * The free times closest to one that was just lost.
 *
 * Searched from the start of that day to a week later, ranked by distance
 * from the time they wanted, then shown in time order. The earlier part of
 * the same day counts: someone who wanted 15:00 may well take 14:00.
 */
export function alternatives(serviceId: string, staffId: string, wanted: number, rules: Rules = 'public', count = 3): SlotDTO[] {
  const { from } = dayBounds(dateOf(wanted));
  try {
    return slotsBetween(serviceId, staffId, from, wanted + 7 * 86_400_000, rules)
      .filter((s) => s.start !== wanted)
      .sort((a, b) => Math.abs(a.start - wanted) - Math.abs(b.start - wanted))
      .slice(0, count)
      .sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkPatient(nameIn: string, emailIn: string): { name: string; email: string } {
  const name = nameIn.trim();
  const email = emailIn.trim();
  if (name.length < 2) throw new DiaryError('invalid', 'Please enter a name.');
  if (name.length > 120) throw new DiaryError('invalid', 'That name is too long.');
  if (!EMAIL.test(email) || email.length > 200) {
    throw new DiaryError('invalid', 'Please enter an email address the confirmation can go to.');
  }
  return { name, email };
}

export function book(input: {
  serviceId: string; staffId: string; startsAt: number; name: string; email: string;
  /** What was chosen: a named practitioner, or ANY. Decides where alternatives come from. */
  preference?: string;
  rules?: Rules;
}): BookingDTO {
  const rules = input.rules ?? 'public';
  const { name, email } = checkPatient(input.name, input.email);
  if (!Number.isFinite(input.startsAt)) throw new DiaryError('invalid', 'Choose a time first.');

  const svc = requireService(input.serviceId, true);
  if (input.staffId === ANY) throw new DiaryError('invalid', 'Choose a time first.');
  const [person] = practitioners(svc, input.staffId);
  if (!person) throw new DiaryError('invalid', 'Choose a time first.');

  try {
    return dto(engine().book({
      resourceId: person.id, serviceId: svc.id, service: rulesFor(svc, rules), calendar: person.calendar,
      customerName: name, customerEmail: email, startsAt: input.startsAt,
    }));
  } catch (err) {
    throw explain(err, svc, input.preference ?? person.id, input.startsAt, person.name, rules);
  }
}

export interface CourseResult {
  seriesId: string;
  booked: BookingDTO[];
  skipped: (SkippedOccurrence & { why: string })[];
}

/**
 * A course of treatment: the first session and every `intervalWeeks` after,
 * `count` times, with the same practitioner at the same local time.
 *
 * Expanded by the engine's recurrence (walking the local calendar, so 09:00
 * stays 09:00 across a clock change) and booked by `bookSeries`, which books
 * what it can and reports what it could not.
 */
export function bookCourse(input: {
  serviceId: string; staffId: string; startsAt: number; name: string; email: string;
  count: number; intervalWeeks: number; rules?: Rules;
}): CourseResult {
  const rules = input.rules ?? 'desk';
  const { name, email } = checkPatient(input.name, input.email);
  if (!Number.isInteger(input.count) || input.count < 2 || input.count > 26) {
    throw new DiaryError('invalid', 'A course has between 2 and 26 sessions.');
  }
  if (!Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1 || input.intervalWeeks > 4) {
    throw new DiaryError('invalid', 'Sessions repeat every 1 to 4 weeks.');
  }
  if (!Number.isFinite(input.startsAt)) throw new DiaryError('invalid', 'Choose the first session’s time.');
  const svc = requireService(input.serviceId, true);
  const [person] = practitioners(svc, input.staffId);
  if (!person || input.staffId === ANY) throw new DiaryError('invalid', 'Choose the first session’s time.');

  const occurrences = expand({
    rule: { frequency: 'weekly', interval: input.intervalWeeks, count: input.count },
    start: input.startsAt,
    timeZone: CLINIC.timeZone,
  });
  const result = engine().bookSeries(occurrences, {
    resourceId: person.id, serviceId: svc.id, service: rulesFor(svc, rules), calendar: person.calendar,
    customerName: name, customerEmail: email,
  });
  return {
    seriesId: result.seriesId,
    booked: result.booked.map(dto),
    skipped: result.skipped.map((s) => ({ ...s, why: skipReason(s, person.name) })),
  };
}

export function reschedule(token: string, startsAt: number, opts: { staffId?: string; rules?: Rules } = {}): BookingDTO {
  const rules = opts.rules ?? 'public';
  const current = engine().byToken(token);
  if (!current) throw new DiaryError('not_found', 'We could not find that booking. Check the link in your confirmation.');
  if (current.status === 'cancelled') {
    throw new DiaryError('cancelled', 'This appointment was cancelled, so it cannot be moved. You can book a new one.');
  }
  const svc = requireService(current.serviceId, false);
  const targetId = opts.staffId && opts.staffId !== ANY ? opts.staffId : current.resourceId;
  const [person] = practitioners(svc, targetId);
  if (!person) throw new DiaryError('invalid', 'That practitioner does not offer this service.');
  if (!Number.isFinite(startsAt)) throw new DiaryError('invalid', 'Choose a new time first.');

  try {
    return dto(engine().reschedule(token, startsAt, {
      calendar: person.calendar, service: rulesFor(svc, rules), resourceId: person.id,
    }));
  } catch (err) {
    throw explain(err, svc, person.id, startsAt, person.name, rules);
  }
}

export function cancel(token: string): BookingDTO {
  try {
    return dto(engine().cancel(token));
  } catch (err) {
    if (err instanceof BookingNotFound) {
      throw new DiaryError('not_found', 'We could not find that booking. Check the link in your confirmation.');
    }
    throw err;
  }
}

/** Cancel this session of a course and every later one. */
export function cancelCourseFrom(bookingId: number): BookingDTO[] {
  const b = engine().byId(bookingId);
  if (!b) throw new DiaryError('not_found', 'That booking no longer exists.');
  if (!b.seriesId) throw new DiaryError('invalid', 'That booking is not part of a course.');
  return engine().cancelSeriesFrom(b.seriesId, b.startsAt).map(dto);
}

/** Engine errors, as something a person can act on. */
function explain(err: unknown, svc: ServiceDef, preference: string, wanted: number, staffName: string, rules: Rules): unknown {
  if (err instanceof SlotUnavailable) {
    const alts = alternatives(svc.id, preference, wanted, rules);
    if (err.reason === 'taken') {
      return new DiaryError(
        'slot_taken',
        `Someone else booked ${time(wanted)} on ${dayLong(wanted)} with ${staffName} while you were choosing.`
          + (alts.length ? ' These are the closest times still free.' : ' Nothing close to it is free; try another day.'),
        alts,
      );
    }
    return new DiaryError(
      'not_offered',
      `${time(wanted)} on ${dayLong(wanted)} is not a time we offer ${svc.name.toLowerCase()} with ${staffName} — `
        + 'it may be too soon, too far ahead, or outside their hours.',
      alts,
    );
  }
  if (err instanceof BookingNotFound) {
    return new DiaryError('not_found', 'We could not find that booking. It may have been cancelled in the meantime.');
  }
  return err;
}

/** Confirmed bookings of one practitioner on one date, as busy intervals. */
export function busyOn(staffId: string, date: string): Interval[] {
  const { from, to } = dayBounds(date);
  return engine().busy(staffId, from, to);
}
