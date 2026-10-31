import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { ensureInitialAdmin } from './services/bootstrap.js';

async function waitForDatabase(pool: ReturnType<typeof createPool>, attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`Waiting for the database (${(err as Error).message})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  await waitForDatabase(pool);
  await migrate(pool);
  await ensureInitialAdmin(pool, config);
  const app = createApp(config, pool);
  const server = app.listen(config.port, () => {
    console.log(`Bread Sales server listening on port ${config.port} (${config.nodeEnv}, time zone ${config.appTimezone})`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
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
