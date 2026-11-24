import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cấu hình Vite cho frontend SPA.
// Backend Express nằm ở server.ts + api/index.ts (Vercel Serverless), không qua Vite.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
