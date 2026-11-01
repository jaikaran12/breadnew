/**
 * Entry point on Cloudflare Workers (production). The same Express app as src/index.ts, but the data lives
 * in Cloudflare D1 and the two websites (admin + driver app) are served by Cloudflare as static files.
 * Settings come from wrangler.jsonc ("vars") and from secrets (JWT_SECRET, ADMIN_PASSWORD).
 */
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { d1Db, type D1Database } from './db-d1.js';

const PORT = 8080;

function start(): ExportedHandler {
  const bindings = env as Record<string, unknown>;
  const vars: Record<string, string | undefined> = { NODE_ENV: 'production', COOKIE_SECURE: 'true' };
  for (const [key, value] of Object.entries(bindings)) if (typeof value === 'string') vars[key] = value;
  try {
    if (!bindings.DB) throw new Error('The D1 database binding "DB" is missing (see wrangler.jsonc)');
    const app = createApp(loadConfig(vars), d1Db(bindings.DB as D1Database));
    app.listen(PORT);
    return httpServerHandler({ port: PORT });
  } catch (err) {
    // A setup mistake (for example a missing secret) should say what is wrong instead of a blank error page.
    const message = `Bread Sales server is not set up correctly: ${err instanceof Error ? err.message : String(err)}`;
    console.error(message);
    return {
      fetch: async () =>
        new Response(JSON.stringify({ error: message, code: 'setup_error' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
    };
  }
}

export default start();
