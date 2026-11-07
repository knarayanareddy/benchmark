#!/usr/bin/env node
/**
 * Draw the app icons (a clock-like dial) as PNGs with no image library: rasterise to
 * pixels, then write a PNG with zlib. Run once; the output is committed.
 *   node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../packages/web/public/', import.meta.url));
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const png = (size, rgba) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

const distToSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** @param {number} size @param {boolean} maskable full-bleed background with the art inside the safe zone */
function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const scale = maskable ? 0.72 : 1;
  const c = 256 * s;
  const cover = (d, r) => Math.max(0, Math.min(1, r - d + 0.5)); // 1px anti-aliasing
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let col = [22, 32, 42]; let a = 255;
      if (!maskable) { // rounded square, transparent corners
        const r = 96 * s; const dx = Math.max(Math.abs(x + 0.5 - c) - (c - r), 0); const dy = Math.max(Math.abs(y + 0.5 - c) - (c - r), 0);
        a = Math.round(255 * cover(Math.hypot(dx, dy), r));
      }
      const mix = (rgb, k) => { col = col.map((v, j) => Math.round(v * (1 - k) + rgb[j] * k)); };
      const X = x + 0.5; const Y = y + 0.5;
      mix([255, 255, 255], cover(Math.abs(Math.hypot(X - c, Y - c) - 150 * s * scale), 14 * s * scale));
      mix([240, 180, 41], cover(distToSeg(X, Y, c, c, c, c - 126 * s * scale), 14 * s * scale));
      mix([255, 255, 255], cover(distToSeg(X, Y, c, c, c + 84 * s * scale, c + 44 * s * scale), 14 * s * scale));
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = a;
    }
  }
  return png(size, px);
}

fs.writeFileSync(`${OUT}icon-192.png`, draw(192, false));
fs.writeFileSync(`${OUT}icon-512.png`, draw(512, false));
fs.writeFileSync(`${OUT}icon-maskable-512.png`, draw(512, true));
console.log('wrote icon-192.png, icon-512.png, icon-maskable-512.png');
