/**
 * Refresh the engine copy in web/node_modules after rebuilding it.
 *
 * The engine is installed as a real copy (install-links=true in .npmrc), not a
 * symlink, so Next.js treats it and its native driver as external packages; a
 * copy does not see later edits, hence this step. If the engine's
 * dependencies change, run `npm install` here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(web, '..');
const target = path.join(web, 'node_modules', 'clinic-booking-app');

if (!fs.existsSync(target)) {
  console.error('clinic-booking-app is not installed in web/node_modules. Run `npm install` in web/ first.');
  process.exit(1);
}
if (fs.lstatSync(target).isSymbolicLink()) {
  console.error('web/node_modules/clinic-booking-app is a symlink. Reinstall with `npm install` (web/.npmrc sets install-links=true).');
  process.exit(1);
}
if (!fs.existsSync(path.join(source, 'dist', 'index.js'))) {
  console.error('The engine is not built. Run `npm ci && npm run build` in the repository root.');
  process.exit(1);
}

fs.rmSync(path.join(target, 'dist'), { recursive: true, force: true });
fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
console.log('clinic-booking-app: copied ../dist into node_modules');
