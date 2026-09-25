/**
 * One engine and one catalogue per server process, on one SQLite file.
 *
 * The file is `web/data/clinic.db` unless CLINIC_DB points elsewhere. It is
 * created and seeded the first time anything asks for it, so a fresh clone
 * opens on a populated diary. `resetDemo()` (the admin's "Reset demo data",
 * and `npm run reset`) empties it and seeds it again.
 */
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SchedulingEngine, type BookingEvent, type OutboxDraft } from 'clinic-booking-app';
import { Catalog } from './catalog';
import { composer } from './mail';
import { seed } from './seed';

interface Handles {
  engine: SchedulingEngine;
  catalog: Catalog;
  file: string;
}

// Survives module reloads in `next dev`, which would otherwise open a new
// connection on every edit.
const holder = globalThis as unknown as { __clinic?: Handles };

export function dbFile(): string {
  return path.resolve(process.env.CLINIC_DB || path.join(process.cwd(), 'data', 'clinic.db'));
}

export function handles(): Handles {
  if (holder.__clinic) return holder.__clinic;

  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // The composer needs the catalogue for names; the catalogue's connection is
  // opened second, so it joins a file the engine has already put in WAL mode.
  let compose: ((e: BookingEvent) => OutboxDraft | null) | null = null;
  const engine = new SchedulingEngine({ path: file, outbox: (e) => compose?.(e) ?? null });
  const catalogDb = new Database(file);
  catalogDb.pragma('busy_timeout = 5000');
  const catalog = new Catalog(catalogDb);
  compose = composer(catalog);

  // Claim the seed inside an IMMEDIATE transaction so two processes starting
  // at once (a dev server and a reset, say) cannot both seed.
  const mustSeed = catalog.transaction(() => {
    if (catalog.meta('seeded_at')) return false;
    catalog.setMeta('seeded_at', new Date().toISOString());
    return true;
  });
  if (mustSeed) seed({ file, catalog, now: Date.now() });

  holder.__clinic = { engine, catalog, file };
  return holder.__clinic;
}

/**
 * Empty the demo and seed it again, in place.
 *
 * In place rather than by deleting the file: a running server holds the file
 * open, and deleting it would leave that server reading a file nobody else
 * can see. Emptying the tables through SQL is visible to every connection.
 * The engine's tables are named by its exported schema; this is the one
 * place outside the engine that writes to them, and it only deletes.
 */
export function resetDemo(): { bookings: number } {
  const { catalog, file } = handles();
  const raw = new Database(file);
  try {
    raw.pragma('busy_timeout = 5000');
    raw.transaction(() => {
      raw.exec('DELETE FROM outbox');
      raw.exec('DELETE FROM bookings');
      raw.exec("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'outbox')");
    }).immediate();
  } finally {
    raw.close();
  }
  catalog.wipe();
  catalog.setMeta('seeded_at', new Date().toISOString());
  seed({ file, catalog, now: Date.now() });
  return { bookings: handles().engine.list({}).length };
}
