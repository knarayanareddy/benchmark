import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { sha256, toHex } from '@benchmark/core/hmac';

/**
 * Writes the list of built files into the service worker, so the app shell works
 * offline. The cache name changes whenever any file does, which retires the old cache.
 */
function precacheManifest() {
  return {
    name: 'precache-manifest',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(import.meta.dirname, 'dist');
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      const files = walk(dist).map((f) => `/${path.relative(dist, f)}`).filter((f) => f !== '/sw.js').sort();
      const shell = files.filter((f) => /\.(js|css|svg|png|webmanifest|html)$/.test(f));
      const version = toHex(sha256(files.map((f) => `${f}:${fs.statSync(path.join(dist, f)).size}`).join('|'))).slice(0, 12);
      const sw = path.join(dist, 'sw.js');
      fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(shell)));
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: { index: path.resolve(import.meta.dirname, 'index.html'), staff: path.resolve(import.meta.dirname, 'staff.html'), credits: path.resolve(import.meta.dirname, 'credits.html') } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
