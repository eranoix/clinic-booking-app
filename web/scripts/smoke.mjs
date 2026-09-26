/**
 * Walk the patient and front-desk flows against a running server.
 *
 *   node scripts/smoke.mjs http://127.0.0.1:3000                     # sign-in off
 *   node scripts/smoke.mjs http://127.0.0.1:3000 --password secret   # ADMIN_PASSWORD=secret
 *
 * Exits non-zero at the first step that fails. Writes real bookings, to
 * example.com addresses.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const pwIndex = args.indexOf('--password');
const password = pwIndex >= 0 ? args[pwIndex + 1] : null;

let step = 0;
function check(ok, what, detail = '') {
  step += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(step).padStart(2)} ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) process.exit(1);
}

let cookie = '';
async function call(path, init = {}) {
  const res = await fetch(base + path, {
    redirect: 'manual',
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}
const get = (path) => call(path);
const post = (path, body) => call(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

/** The first day from `from` with at least one free time, and its times. */
async function firstFree(service, staff, from, rules = 'public') {
  const extra = rules === 'desk' ? '&rules=desk' : '';
  for (let i = 0; i < 45; i += 1) {
    const date = addDays(from, i);
    const r = await get(`/api/slots?service=${service}&staff=${staff}&date=${date}${extra}`);
    if (r.status !== 200) return { status: r.status, date, slots: [] };
    if (r.body.slots.length) return { status: 200, date, slots: r.body.slots };
  }
  return { status: 200, date: null, slots: [] };
}

if (password) {
  const gate = await get('/admin');
  check(gate.status === 307 && /\/login/.test(gate.headers.get('location') ?? ''), 'the front desk asks for sign-in', gate.headers.get('location'));
  check((await get('/api/admin/outbox')).status === 401, 'the admin API refuses without a session');
  check((await get(`/api/slots?service=follow-up&staff=any&date=${today}&rules=desk`)).status === 401, 'the front desk’s view of the diary is refused too');
  const wrong = await call('/api/auth/login', { method: 'POST', body: new URLSearchParams({ password: `${password}-wrong`, next: '/admin' }) });
  check(wrong.status === 303 && /error=1/.test(wrong.headers.get('location') ?? ''), 'a wrong password is refused');
  const right = await call('/api/auth/login', { method: 'POST', body: new URLSearchParams({ password, next: '/admin/outbox' }) });
  const set = right.headers.get('set-cookie') ?? '';
  check(right.status === 303 && /HttpOnly/i.test(set) && /qp_admin=v1\./.test(set), 'the right password sets an HttpOnly session', right.headers.get('location'));
  cookie = set.split(';')[0];
  const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const tampered = await fetch(`${base}/admin`, { redirect: 'manual', headers: { cookie: forged } });
  check(tampered.status === 307, 'a tampered session is refused');
} else {
  const open = await get('/admin');
  check(open.status === 200 && String(open.body).includes('no sign-in'), 'sign-in is off, and the admin says so');
}
check((await get('/admin')).status === 200, 'the front desk opens');

const service = 'follow-up';
const days = await get(`/api/days?service=${service}&staff=any&days=21`);
const openDays = days.body.days?.filter((d) => d.count > 0) ?? [];
check(days.status === 200 && openDays.length > 0, 'days with free times', `${openDays.length} of ${days.body.days?.length}`);

const date = openDays[0].date;
const slots = await get(`/api/slots?service=${service}&staff=any&date=${date}`);
check(slots.status === 200 && slots.body.slots.length > 0, `free times on ${date}`, `${slots.body.slots.length}`);
const [slot] = slots.body.slots;

const booked = await post('/api/bookings', {
  service, staff: slot.staffId, startsAt: slot.start, name: 'Smoke Test', email: 'smoke.test@example.com',
});
check(booked.status === 201 && booked.body.booking.status === 'confirmed', 'book the first free time', booked.body.manageUrl);
const { token } = booked.body.booking;

const after = await get(`/api/slots?service=${service}&staff=${slot.staffId}&date=${date}`);
check(!after.body.slots.some((s) => s.start === slot.start), 'the time is no longer offered');

const race = await post('/api/bookings', {
  service, staff: slot.staffId, startsAt: slot.start, name: 'Second Person', email: 'second.person@example.com',
});
check(race.status === 409 && race.body.error.code === 'slot_taken' && race.body.error.alternatives.length > 0,
  'a second booking of the same time is refused with alternatives', race.body.error?.message);

const bad = await post('/api/bookings', { service, staff: slot.staffId, startsAt: slot.start, name: 'X', email: 'nope' });
check(bad.status === 400 && bad.body.error.code === 'invalid', 'bad input is refused with a reason', bad.body.error?.message);

const mail = await get(`/b/${token}/mail`);
check(mail.status === 200 && String(mail.body).includes(`/b/${token}`) && String(mail.body).includes('Your appointment on'),
  'the confirmation email is readable from the link, with the link in it');
check(String((await get(`/b/${token}`)).body).includes('Your appointment'), 'the manage link opens');

const later = await firstFree(service, slot.staffId, date);
const moved = await post(`/api/bookings/${token}/reschedule`, { startsAt: later.slots.at(-1).start });
check(moved.status === 200 && moved.body.booking.startsAt === later.slots.at(-1).start && moved.body.booking.token === token,
  'the patient moves it; the link stays the same', moved.body.error?.message ?? later.date);

const cancelled = await post(`/api/bookings/${token}/cancel`);
check(cancelled.status === 200 && cancelled.body.booking.status === 'cancelled', 'the patient cancels from the link');
check((await post(`/api/bookings/${token}/cancel`)).status === 200, 'cancelling twice is harmless');
check(String((await get(`/b/${token}`)).body).includes('This appointment is cancelled'), 'the link now shows the cancellation');
check((await get('/b/not-a-real-token')).status === 404, 'an unknown link is a 404');

let box = await get(`/api/admin/outbox?booking=${booked.body.booking.id}`);
const kinds = box.body.messages.map((m) => m.kind);
check(kinds.join(',') === 'cancelled,rescheduled,booked', 'the Outbox has the confirmation, the move and one cancellation', kinds.join(', '));

const deskFree = await firstFree(service, 'any', addDays(today, 1), 'desk');
check(deskFree.slots.length > 0, 'the front desk sees free times', deskFree.date);
const deskSlot = deskFree.slots[0];
const desk = await post('/api/admin/bookings', {
  service, staff: deskSlot.staffId, startsAt: deskSlot.start, name: 'Desk Walk-In', email: 'desk.walkin@example.com',
});
check(desk.status === 201 && desk.body.booking.staffId === deskSlot.staffId, 'the front desk books for a new patient', desk.body.booking?.staffName ?? desk.body.error?.message);
const deskRace = await post('/api/admin/bookings', {
  service, staff: deskSlot.staffId, startsAt: deskSlot.start, name: 'Desk Second', email: 'desk.second@example.com',
});
check(deskRace.status === 409 && deskRace.body.error.code === 'slot_taken', 'the front desk loses a race the same way', deskRace.body.error?.message);

let move = null;
for (const other of ['marta', 'tomas', 'helena'].filter((s) => s !== desk.body.booking.staffId)) {
  const free = await firstFree(service, other, deskFree.date, 'desk');
  if (free.slots.length) {
    move = await post(`/api/admin/bookings/${desk.body.booking.id}/move`, { startsAt: free.slots[0].start, staff: other });
    break;
  }
}
check(move?.status === 200 && move.body.booking.staffId !== desk.body.booking.staffId && move.body.booking.token === desk.body.booking.token
  && move.body.booking.id === desk.body.booking.id,
  'moved to another practitioner: same booking, same link', `${desk.body.booking.staffName} to ${move?.body.booking?.staffName}`);
box = await get(`/api/admin/outbox?booking=${desk.body.booking.id}`);
check(box.body.messages[0]?.kind === 'rescheduled' && box.body.messages[0].body.includes(`with ${move.body.booking.staffName}`),
  'the move notice names the new practitioner');

// A weekly course with Marta, long enough to cross her training day.
const courseFree = await firstFree(service, 'marta', addDays(today, 3), 'desk');
const course = await post('/api/admin/bookings', {
  service, staff: 'marta', startsAt: courseFree.slots[0].start, name: 'Course Patient', email: 'course.patient@example.com',
  repeat: { count: 6, intervalWeeks: 1 },
});
const sessions = course.body.course?.booked ?? [];
const skipped = course.body.course?.skipped ?? [];
check(course.status === 201 && sessions.length + skipped.length === 6 && sessions.length >= 2,
  'a six-week course: what was booked, and why the rest was not',
  `${sessions.length} booked, ${skipped.length} skipped${skipped.length ? `: ${skipped.map((s) => s.why).join('; ')}` : ''}`);
check(new Set(sessions.map((b) => b.seriesId)).size === 1, 'every session belongs to one course');

const stop = await post(`/api/admin/bookings/${sessions[1].id}/cancel-course`);
check(stop.status === 200 && stop.body.cancelled.length === sessions.length - 1,
  'cancel the rest of the course from session two; session one stays', `${stop.body.cancelled.length} cancelled`);
box = await get(`/api/admin/outbox?series=${sessions[0].seriesId}`);
check(box.body.messages.map((m) => m.kind).join(',') === 'series-cancelled,series-booked', 'one message for the course, one for stopping it');

const done = await post(`/api/admin/bookings/${desk.body.booking.id}/cancel`);
check(done.status === 200 && done.body.booking.status === 'cancelled', 'the front desk cancels');

console.log('smoke: all steps passed');
