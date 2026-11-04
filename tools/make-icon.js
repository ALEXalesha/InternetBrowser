// Значок приложения build/icon.png (512x512): стеклянный скруглённый квадрат с градиентом
// темы «Стеклянная» и белым щитом с глобусом. Рисуется формулами, без сторонних пакетов.
//   node tools/make-icon.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 512;

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;

// расстояние до скруглённого квадрата (отрицательное внутри)
function roundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// щит: сверху прямой, снизу сходится в острие
function shield(x, y) {
  const cx = 256;
  const top = 128;
  const w = 118;
  const nx = Math.abs(x - cx) / w;
  const ny = (y - top) / 270;
  if (ny < 0) return Math.max(top - y, Math.abs(x - cx) - w);
  const edge = ny < 0.4 ? 1 : Math.max(0, 1 - Math.pow((ny - 0.4) / 0.6, 1.7));
  const d = (nx - edge) * w;
  return Math.max(d, y - (top + 270));
}

function pixel(x, y) {
  // фон: градиент синий -> фиолетовый -> розовый с бликом
  const base = roundRect(x, y, 256, 256, 232, 232, 104);
  const a = clamp(0.5 - base);
  if (a <= 0) return [0, 0, 0, 0];
  const t = clamp((x + y) / (2 * N));
  let r = mix(70, 170, t);
  let g = mix(120, 80, t);
  let b = mix(240, 230, t);
  const glow = Math.exp(-(Math.pow(x - 150, 2) + Math.pow(y - 110, 2)) / 30000);
  r = mix(r, 255, glow * 0.35); g = mix(g, 255, glow * 0.35); b = mix(b, 255, glow * 0.35);
  // кромка стекла
  const rim = clamp(1 - Math.abs(base + 6) / 6) * 0.35;
  r = mix(r, 255, rim); g = mix(g, 255, rim); b = mix(b, 255, rim);
  // щит
  const s = shield(x, y);
  const sa = clamp(0.5 - s);
  if (sa > 0) {
    const inner = clamp((-s - 4) / 3);
    const lit = clamp(1 - (y - 128) / 400);
    r = mix(r, mix(220, 255, lit), sa); g = mix(g, mix(226, 255, lit), sa); b = mix(b, 255, sa);
    // глобус внутри щита: окружность и меридианы цветом фона
    const gx = x - 256;
    const gy = y - 262;
    const rr = Math.hypot(gx, gy);
    const ring = Math.abs(rr - 70);
    const eq = Math.abs(gy);
    const mer = Math.abs(Math.hypot(gx / 0.45, gy) - 70) * 0.45;
    const line = Math.min(ring, rr < 70 ? Math.min(eq, mer, Math.abs(gx)) : 99);
    const la = clamp(7 - line) * inner;
    r = mix(r, 90, la); g = mix(g, 100, la); b = mix(b, 220, la);
  }
  return [r, g, b, a * 255];
}

const buf = Buffer.alloc(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let acc = [0, 0, 0, 0];
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const p = pixel(x + dx, y + dy);
      acc = acc.map((v, i) => v + p[i] / 4);
    }
    buf.set(acc.map((v) => Math.round(v)), (y * N + x) * 4);
  }
}
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), png(N, N, buf));
console.log('build/icon.png');
