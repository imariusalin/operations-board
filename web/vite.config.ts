import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const allowedHosts = [process.env.RAILWAY_PUBLIC_DOMAIN].filter(Boolean) as string[];

const api = process.env.API_URL ?? 'http://localhost:5174';

export default defineConfig({
  plugins: [react()],
  server: {
    // Default "localhost" only binds ::1 on this Mac, so 127.0.0.1 is
    // refused. "::" is dual-stack here: both localhost addresses connect.
    host: '::',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
      // The PDFs, served by the API so the board's own address opens them too.
      '/how-it-works': { target: api, changeOrigin: true },
      '/sample-handover': { target: api, changeOrigin: true },
    },
  },
  preview: { allowedHosts },
});
