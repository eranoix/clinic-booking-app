import fs from 'node:fs';
import path from 'node:path';

// Load the repository root's .env, shared with `npm run app` and docker
// compose, without overriding variables already set.
const rootEnv = path.resolve(process.cwd(), '..', '.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Plain JavaScript on purpose: a next.config.ts needs TypeScript installed
// wherever the server starts, and the Docker image ships without dev tools.
/** @type {import('next').NextConfig} */
const config = {
  // better-sqlite3 is a native addon and can never be bundled. The engine is
  // external too, so the server has exactly one copy of its classes for
  // `instanceof` checks. Both rely on the real-copy install (see .npmrc).
  serverExternalPackages: ['better-sqlite3', 'clinic-booking-app'],
  // The engine is the parent package (web/ depends on it as "file:.."), so the
  // tracing root is the repository, not web/.
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  poweredByHeader: false,
  typedRoutes: false,
};

export default config;
