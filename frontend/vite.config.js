import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port auto-selection: Vite starts at `port` and, because strictPort is false,
// automatically moves to the next free port if it is busy. Both the frontend
// port and the backend (proxy target) port can be overridden via env vars.
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3002;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 8000;

// Opt-in HTTPS for the dev server: `DEV_HTTPS=1 npm run dev`.
//
// Needed only to test the camera barcode scanner from a phone. Browsers expose
// getUserMedia solely in a secure context — HTTPS, or localhost — so a phone
// hitting http://<lan-ip>:3002 has the camera blocked by the browser itself,
// no matter what permissions are granted. Certs are generated into ../.certs
// (gitignored); the phone will warn that they're self-signed, which is expected
// — accept once and the camera works. Off by default so the normal
// http://localhost workflow is unchanged.
const CERT_DIR = path.resolve(__dirname, '../.certs');
function devHttps() {
  if (process.env.DEV_HTTPS !== '1') return undefined;
  const key = path.join(CERT_DIR, 'dev-key.pem');
  const cert = path.join(CERT_DIR, 'dev-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    console.warn(
      `\n[vite] DEV_HTTPS=1 but no certs at ${CERT_DIR}.\n` +
      `       Generate them with:\n` +
      `         mkdir -p .certs && openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \\\n` +
      `           -keyout .certs/dev-key.pem -out .certs/dev-cert.pem -subj "/CN=meesho-p-dev" \\\n` +
      `           -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<your-lan-ip>"\n` +
      `       Falling back to HTTP — the phone camera will not work.\n`
    );
    return undefined;
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

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
    https: devHttps(),
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
}));
