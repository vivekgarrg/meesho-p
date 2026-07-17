import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port auto-selection: Vite starts at `port` and, because strictPort is false,
// automatically moves to the next free port if it is busy. Both the frontend
// port and the backend (proxy target) port can be overridden via env vars.
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3002;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 8000;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/static/frontend/' : '/',
  build: {
    outDir: '../backend/frontend_build',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: FRONTEND_PORT,
    strictPort: false,
    allowedHosts: 'all',
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
}));
