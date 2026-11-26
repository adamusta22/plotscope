import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { HttpsProxyAgent } from 'https-proxy-agent';

// If this machine reaches the internet through a proxy (HTTPS_PROXY), dev proxies must use it too.
const upstream = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = upstream ? new HttpsProxyAgent(upstream) : undefined;

// /lr proxies HM Land Registry's INSPIRE plot-boundary service (no CORS on their side).
// In production the same path is a Netlify redirect (netlify.toml).
const proxy = {
  '/api': 'http://localhost:8787',
  '/lr': { target: 'https://inspire.landregistry.gov.uk', changeOrigin: true, agent, rewrite: (p: string) => p.replace(/^\/lr/, '') },
};

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', login: 'login.html' } } },
  server: { proxy },
  preview: { proxy },
});
