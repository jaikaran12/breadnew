/**
 * Runs the server with Node.js and a SQLite file (for your own computer or server, and for tests).
 * In production on Cloudflare, src/worker.ts is used instead (same app, Cloudflare D1 database).
 */
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openSqliteDb } from './db-sqlite.js';
import { migrate } from './migrate.js';
import { ensureInitialAdmin } from './services/bootstrap.js';

async function main() {
  const config = loadConfig();
  const db = openSqliteDb(config.databasePath);
  await migrate(db);
  await ensureInitialAdmin(db, config);
  const app = createApp(config, db);
  const server = app.listen(config.port, () => {
    console.log(
      `Bread Sales server listening on port ${config.port} (${config.nodeEnv}, time zone ${config.appTimezone}, database ${config.databasePath})`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
