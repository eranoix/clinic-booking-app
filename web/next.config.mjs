import fs from 'node:fs';
import path from 'node:path';

const rootEnv = path.resolve(process.cwd(), '..', '.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ['better-sqlite3', 'clinic-booking-app'],
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  poweredByHeader: false,
  typedRoutes: false,
};

export default config;
