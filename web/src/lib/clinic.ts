/**
 * The fictional business this demo is dressed as. The zone observes daylight
 * saving on purpose, to exercise clock changes; it is shared by server and
 * browser, and changing it would reinterpret every stored opening hour.
 */
export const CLINIC = {
  name: 'Quillmere Physiotherapy',
  shortName: 'Quillmere',
  city: 'Lisbon',
  timeZone: 'Europe/Lisbon',
  phone: '+351 210 000 000',
} as const;
