// Minimal types for the Cloudflare Workers modules used by src/worker.ts (so no extra type packages are needed).
interface ExportedHandler {
  fetch?: (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;
}

declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}

declare module 'cloudflare:node' {
  /** Turns a Node.js HTTP server listening on `port` (e.g. Express) into a Workers fetch handler. */
  export function httpServerHandler(options: { port: number }): ExportedHandler;
}
