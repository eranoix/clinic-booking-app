#!/usr/bin/env node
/**
 * npm run app: install what is missing, build the engine and the site, and
 * start the production server. Reads .env at the repository root if present.
 * Touches nothing outside the repository's git-ignored build directories.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, 'web');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node ${process.versions.node} is too old: this needs Node 22.12 or later. Or run it with Docker: docker compose up`);
  process.exit(1);
}

// .env at the root, without overriding anything already set in the shell.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function step(title, cmd, args, cwd) {
  console.log(`\n> ${title}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`\n${title} failed. Fix the error above and run \`npm run app\` again.`);
    process.exit(r.status ?? 1);
  }
}

const installed = (dir, probe) => fs.existsSync(path.join(dir, 'node_modules', probe));

if (!installed(root, 'typescript')) step('Installing the engine’s dependencies', npm, ['ci', '--no-audit', '--no-fund'], root);
step('Building the engine', npm, ['run', 'build'], root);
if (!installed(web, 'next') || !installed(web, 'clinic-booking-app')) {
  step('Installing the site’s dependencies', npm, ['ci', '--no-audit', '--no-fund'], web);
}
step('Building the site', npm, ['run', 'build'], web);

function free(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

const host = process.env.HOST || '127.0.0.1';
const wanted = Number(process.env.PORT || 3000);
let port = wanted;
while (!(await free(port, host))) {
  if (port - wanted >= 20) {
    console.error(`Ports ${wanted} to ${port} are all in use. Set PORT to a free one.`);
    process.exit(1);
  }
  port += 1;
}
if (port !== wanted) console.log(`\nPort ${wanted} is in use; using ${port}.`);

const shown = host === '0.0.0.0' ? 'localhost' : host;
const url = `http://${shown}:${port}`;
process.env.PORT = String(port);
process.env.PUBLIC_URL ||= `http://localhost:${port}`;

console.log(`\nStarting on ${url}`);
console.log(`  Booking page: ${url}/book`);
console.log(`  Front desk:   ${url}/admin${process.env.ADMIN_PASSWORD ? '  (password: ADMIN_PASSWORD)' : '  (no sign-in: local demo)'}`);
console.log('  Ctrl+C to stop.\n');

const server = spawn(npm, ['exec', '--', 'next', 'start', '-H', host, '-p', String(port)], { cwd: web, stdio: 'inherit', env: process.env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
