import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Default "localhost" only binds ::1 on this Mac, so 127.0.0.1 is
    // refused. "::" is dual-stack here: both localhost addresses connect.
    host: '::',
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
      '/ws': { target: 'ws://localhost:5174', ws: true },
      // The PDFs, served by the API so the board's own address opens them too.
      '/how-it-works': { target: 'http://localhost:5174', changeOrigin: true },
      '/sample-handover': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
});
