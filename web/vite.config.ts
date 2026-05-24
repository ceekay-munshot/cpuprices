import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite config for the dashboard. Output goes to web/dist/ so `wrangler pages
// deploy web/dist` ships it. In dev, /api/* is proxied to wrangler pages dev
// on 8788. In prod the dashboard and the API live at the same origin, so the
// API client uses empty-string base URLs.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
});
