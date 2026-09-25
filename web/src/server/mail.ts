/**
 * What the clinic would email, composed from the engine's booking events.
 *
 * The engine calls `compose` inside the transaction that makes each change and
 * writes the result to its outbox table in that same transaction (see
 * EngineOptions.outbox). This demo has no SMTP: the admin's Outbox page and
 * each patient's "view the email" page read the table instead. A real
 * deployment would add a worker that reads the outbox and sends.
 */
import 'server-only';
import type { Booking, BookingEvent, OutboxDraft, SkippedOccurrence } from 'clinic-booking-app';
import { CLINIC } from '@/lib/clinic';
import { dayFull, dayShort, time } from '@/lib/time';
import type { Catalog } from './catalog';

/**
 * Where links in messages point. PUBLIC_URL when set (behind a proxy, in
 * Docker), else the local server on PORT -- the same default `next start`
 * listens on.
 */
export function baseUrl(): string {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `http://localhost:${process.env.PORT || 3000}`;
}

export const manageUrl = (token: string) => `${baseUrl()}/b/${token}`;

const SIGNATURE = `${CLINIC.name}\n${CLINIC.city}, ${CLINIC.phone}`;

export function composer(catalog: Catalog) {
  const staffName = (id: string) => catalog.member(id)?.name ?? id;
  const serviceName = (id: string) => catalog.service(id)?.name ?? id;
  const first = (b: Booking) => b.customerName.split(' ')[0] ?? b.customerName;
  const when = (b: Pick<Booking, 'startsAt' | 'endsAt'>) =>
    `${dayFull(b.startsAt)}, ${time(b.startsAt)}–${time(b.endsAt)} (Lisbon time)`;

  return (event: BookingEvent): OutboxDraft | null => {
    switch (event.kind) {
      case 'booked': {
        const b = event.booking;
        return {
          to: b.customerEmail,
          subject: `Your appointment on ${dayShort(b.startsAt)} at ${time(b.startsAt)}`,
          body: [
            `Hello ${first(b)},`,
            '',
            `You are booked for ${serviceName(b.serviceId)} with ${staffName(b.resourceId)}.`,
            '',
            `  When:  ${when(b)}`,
            `  Where: ${CLINIC.name}, ${CLINIC.city}`,
            '',
            'To move or cancel it, use this link. It works without an account, so keep it to yourself:',
            manageUrl(b.publicToken),
            '',
            SIGNATURE,
          ].join('\n'),
        };
      }
      case 'rescheduled': {
        const b = event.booking;
        const moved = event.previous.resourceId !== b.resourceId;
        return {
          to: b.customerEmail,
          subject: `Your appointment has moved to ${dayShort(b.startsAt)} at ${time(b.startsAt)}`,
          body: [
            `Hello ${first(b)},`,
            '',
            `Your ${serviceName(b.serviceId)} has moved.`,
            '',
            `  Was: ${when(event.previous)}${moved ? `, with ${staffName(event.previous.resourceId)}` : ''}`,
            `  Now: ${when(b)}${moved ? `, with ${staffName(b.resourceId)}` : ''}`,
            '',
            'Your link still works and shows the new time:',
            manageUrl(b.publicToken),
            '',
            SIGNATURE,
          ].join('\n'),
        };
      }
      case 'cancelled': {
        const b = event.booking;
        return {
          to: b.customerEmail,
          subject: `Cancelled: your appointment on ${dayShort(b.startsAt)} at ${time(b.startsAt)}`,
          body: [
            `Hello ${first(b)},`,
            '',
            `Your ${serviceName(b.serviceId)} with ${staffName(b.resourceId)} on ${when(b)} is cancelled.`,
            '',
            'If that is a mistake, or you would like another time, you can book again here:',
            `${baseUrl()}/book`,
            '',
            SIGNATURE,
          ].join('\n'),
        };
      }
      case 'series-booked': {
        const [one] = event.booked;
        if (!one) return null; // nothing booked, nothing to confirm
        return {
          to: one.customerEmail,
          subject: `Your course: ${event.booked.length} ${serviceName(one.serviceId).toLowerCase()} sessions`,
          body: [
            `Hello ${first(one)},`,
            '',
            `You are booked for ${event.booked.length} sessions of ${serviceName(one.serviceId)} with ${staffName(one.resourceId)}.`,
            'Each has its own link, to move or cancel that session alone:',
            '',
            ...event.booked.map((b) => `  ${dayShort(b.startsAt)}, ${time(b.startsAt)}   ${manageUrl(b.publicToken)}`),
            ...(event.skipped.length
              ? ['', 'These dates could not be booked, so they are not part of the course:', ...event.skipped.map((s) => `  ${dayShort(s.startsAt)}, ${time(s.startsAt)}: ${skipReason(s, staffName(one.resourceId))}`)]
              : []),
            '',
            SIGNATURE,
          ].join('\n'),
        };
      }
      case 'series-cancelled': {
        const [one] = event.cancelled;
        if (!one) return null;
        return {
          to: one.customerEmail,
          subject: `Cancelled: the remaining ${event.cancelled.length} sessions of your course`,
          body: [
            `Hello ${first(one)},`,
            '',
            `These sessions of ${serviceName(one.serviceId)} with ${staffName(one.resourceId)} are cancelled:`,
            '',
            ...event.cancelled.map((b) => `  ${dayShort(b.startsAt)}, ${time(b.startsAt)}`),
            '',
            'Sessions before them are unchanged.',
            '',
            SIGNATURE,
          ].join('\n'),
        };
      }
    }
  };
}

/** A skipped course date, in words the front desk and the patient both understand. */
export function skipReason(s: Pick<SkippedOccurrence, 'code'>, staff: string): string {
  return s.code === 'taken'
    ? `${staff} already has an appointment then`
    : `${staff} is not working then, or it is outside the booking window`;
}
