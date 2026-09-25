/**
 * npm run reset -- empty the demo database and seed it again.
 *
 * Safe with the site running: the tables are emptied in place, so a running
 * server sees the new data on its next request. Uses CLINIC_DB when set,
 * else web/data/clinic.db. Run through tsx with the react-server condition,
 * which is what lets it import the server modules outside Next.js.
 */
import { dbFile, resetDemo } from '../src/server/db';

const { bookings } = resetDemo();
console.log(`Reset ${dbFile()}: ${bookings} invented bookings around today.`);
