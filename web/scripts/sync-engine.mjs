/**
 * Refresh the engine copy in web/node_modules after rebuilding it.
 *
 * web/ depends on the parent package as "file:..", installed as a real copy
 * (install-links=true in .npmrc) rather than a symlink. A copy is what lets
 * Next.js treat the engine and its native SQLite driver as ordinary external
 * packages under node_modules; a symlink resolves outside web/ and Next.js
 * would try to bundle the driver. The cost of a copy is that it does not see
 * later edits, so `npm run dev` and `npm run build` rebuild the engine and
 * copy dist/ and package.json across first. Dependencies are unaffected:
 * if the engine's dependencies change, run `npm install` here.
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
