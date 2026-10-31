import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// `npm run build` -> web version served by the server at /driver/
// `npm run build:android` -> bundled inside the Android app (reads .env.android for the server address)
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.APP_VERSION || pkg.version),
  },
  build: {
    // Older Android phones have older WebView versions; keep the output conservative.
    target: ['es2019', 'chrome70'],
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
