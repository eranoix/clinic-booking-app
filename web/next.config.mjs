import fs from 'node:fs';
import path from 'node:path';

// One .env for every way of running it: the repository root's, shared with
// `npm run app` and docker compose. Variables already set -- in the shell, or
// by a web/.env that Next.js loaded first -- are not overridden.
const rootEnv = path.resolve(process.cwd(), '..', '.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Plain JavaScript on purpose: a next.config.ts needs TypeScript installed
// wherever the server starts, and the Docker image ships without dev tools.
/** @type {import('next').NextConfig} */
const config = {
  // better-sqlite3 is a native addon: Node must load it at runtime, it can
  // never be bundled. The engine is left external as well, so the server has
  // exactly one copy of it -- one SchedulingEngine class, one SlotUnavailable
  // for `instanceof` to recognise -- loaded from node_modules the way
  // `npm test` loads it. It is installed as a real copy, not a symlink (see
  // .npmrc and scripts/sync-engine.mjs); a symlink would resolve outside web/
  // and defeat both rules. Browser code only imports
  // "clinic-booking-app/availability", which has no driver in it and is
  // bundled normally.
  serverExternalPackages: ['better-sqlite3', 'clinic-booking-app'],
  // The engine is the parent package (web/ depends on it as "file:.."), so the
  // tracing root is the repository, not web/.
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  poweredByHeader: false,
  typedRoutes: false,
};

export default config;
