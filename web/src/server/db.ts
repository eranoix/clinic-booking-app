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

const holder = globalThis as unknown as { __clinic?: Handles };

export function dbFile(): string {
  return path.resolve(process.env.CLINIC_DB || path.join(process.cwd(), 'data', 'clinic.db'));
}

export function handles(): Handles {
  if (holder.__clinic) return holder.__clinic;

  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let compose: ((e: BookingEvent) => OutboxDraft | null) | null = null;
  const engine = new SchedulingEngine({ path: file, outbox: (e) => compose?.(e) ?? null });
  const catalogDb = new Database(file);
  catalogDb.pragma('busy_timeout = 5000');
  const catalog = new Catalog(catalogDb);
  compose = composer(catalog);

  const mustSeed = catalog.transaction(() => {
    if (catalog.meta('seeded_at')) return false;
    catalog.setMeta('seeded_at', new Date().toISOString());
    return true;
  });
  if (mustSeed) seed({ file, catalog, now: Date.now() });

  holder.__clinic = { engine, catalog, file };
  return holder.__clinic;
}

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
