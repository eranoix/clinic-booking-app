import { dbFile, resetDemo } from '../src/server/db';

const { bookings } = resetDemo();
console.log(`Reset ${dbFile()}: ${bookings} invented bookings around today.`);
