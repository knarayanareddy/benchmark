#!/usr/bin/env node
/**
 * Serve the repository so the demo can actually be opened.
 *
 * `mockups/benchmark-expert-flow.html` imports live ES modules from
 * `packages/core/src/`. Opened as a file, every browser blocks those imports as
 * cross-origin, so the page degrades to its static <noscript> copy and the
 * anonymity panel a reader is meant to touch is not the module.
 *
 * There was no server in the repo at all, and no instruction to start one, so
 * the one demo asset required the reader to invent a document root.
 *
 * Usage:  npm run serve          → http://localhost:4173
 *         PORT=8080 npm run serve
 *
 * Binds 0.0.0.0 and accepts any Host header, so it also works behind a preview
 * proxy. Path traversal is blocked by resolving before comparing.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const INDEX = 'mockups/benchmark-expert-flow.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function createServer() {
  return http.createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad request');
      return;
    }
    if (url === '/') url = '/' + INDEX;
    // Resolve first, then compare: `..%2f..%2fetc/passwd` decodes to a path that
    // startsWith(ROOT) only after normalisation.
    const file = path.resolve(ROOT, '.' + url);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
      return;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    if (stat.isDirectory()) {
      res.writeHead(302, { location: '/' }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Benchmark demo → http://localhost:${PORT}`);
    console.log(`  ${INDEX}`);
    console.log('  Ctrl-C to stop.');
  });
}
