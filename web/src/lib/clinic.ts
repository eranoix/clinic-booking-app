/**
 * The business this demo is dressed as. Entirely fictional: the clinic, its
 * staff and every patient are invented, and every email is @example.com.
 *
 * The time zone is real and deliberate. Lisbon moves its clocks twice a year,
 * which is the case the engine exists to get right; a demo in UTC would hide
 * it. It lives here rather than in the database because it is a property of
 * the business, shared by the server and by the browser code that formats
 * times, and changing it would reinterpret every stored opening hour.
 */
export const CLINIC = {
  name: 'Quillmere Physiotherapy',
  shortName: 'Quillmere',
  city: 'Lisbon',
  timeZone: 'Europe/Lisbon',
  phone: '+351 210 000 000',
} as const;
