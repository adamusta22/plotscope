import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /lr proxies HM Land Registry's INSPIRE plot-boundary service (no CORS on their side).
const proxy = {
  '/api': 'http://localhost:8787',
  '/lr': { target: 'https://inspire.landregistry.gov.uk', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/lr/, '') },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
