// Puts the two built websites into one folder for Cloudflare (wrangler.jsonc -> assets.directory):
//   site/          admin website   (from ../admin-web/dist)
//   site/driver/   driver app      (from ../driver-app/dist)
// Build them first: (cd ../admin-web && npm run build) && (cd ../driver-app && npm run build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, '..');
const site = path.join(server, 'site');
const admin = path.resolve(server, '..', 'admin-web', 'dist');
const driver = path.resolve(server, '..', 'driver-app', 'dist');

for (const [name, dir] of [['admin-web', admin], ['driver-app', driver]]) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    console.error(`Missing ${dir}/index.html. Build it first: cd ${name} && npm ci && npm run build`);
    process.exit(1);
  }
}
fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(admin, site, { recursive: true });
fs.cpSync(driver, path.join(site, 'driver'), { recursive: true });
fs.copyFileSync(path.join(here, '_headers'), path.join(site, '_headers'));
console.log(`Website files ready in ${path.relative(process.cwd(), site) || site}`);
