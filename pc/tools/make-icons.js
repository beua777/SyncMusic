// 앱 아이콘 만들기: SVG + PNG(192, 512) + ICO(16~256)
//   node tools/make-icons.js [출력 폴더]
// 외부 도구 없이 거리 함수로 직접 그린다 (4×4 슈퍼샘플링으로 가장자리를 부드럽게).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve(process.argv[2] || 'public/icons');
const C1 = [79, 139, 255];
const C2 = [138, 92, 255];
const NOTE = [
  [214, 330, 214, 170],
  [214, 170, 346, 142],
  [346, 142, 346, 292],
];
const HEADS = [
  [180, 334, 40],
  [312, 300, 40],
];
const ARCS = [
  [195, 250],
  [15, 70],
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sdRoundRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function arcDist(px, py, a0, a1, R = 172) {
  const ang = ((Math.atan2(py - 256, px - 256) * 180) / Math.PI + 360) % 360;
  if (ang >= a0 && ang <= a1) return Math.abs(Math.hypot(px - 256, py - 256) - R);
  const end = (a) => [256 + R * Math.cos((a * Math.PI) / 180), 256 + R * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = end(a0);
  const [x1, y1] = end(a1);
  return Math.min(Math.hypot(px - x0, py - y0), Math.hypot(px - x1, py - y1));
}

function shade(x, y) {
  if (sdRoundRect(x, y, 512, 512, 118) > 0) return null;
  const t = clamp((x + y) / 1024, 0, 1);
  let col = C1.map((c, i) => c + (C2[i] - c) * t);
  if (ARCS.some(([a0, a1]) => arcDist(x, y, a0, a1) < 9)) col = col.map((c) => c + (255 - c) * 0.55);
  const inNote = NOTE.some(([ax, ay, bx, by]) => segDist(x, y, ax, ay, bx, by) < 15) || HEADS.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
  if (inNote) col = [255, 255, 255];
  return col;
}

function render(size, ss = 4) {
  const acc = new Float64Array(size * size * 4);
  const S = size * ss;
  const k = 512 / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const col = shade((x + 0.5) * k, (y + 0.5) * k);
      if (!col) continue;
      const o = (Math.floor(y / ss) * size + Math.floor(x / ss)) * 4;
      acc[o] += col[0];
      acc[o + 1] += col[1];
      acc[o + 2] += col[2];
      acc[o + 3] += 1;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const n = acc[i * 4 + 3];
    out[i * 4 + 3] = Math.round((n / (ss * ss)) * 255);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = n ? Math.round(acc[i * 4 + c] / n) : 0;
  }
  return out;
}

function pngRGBA(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...images.map((i) => i.png)]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${C1})"/><stop offset="1" stop-color="rgb(${C2})"/></linearGradient></defs>
<rect width="512" height="512" rx="118" fill="url(#g)"/>
${ARCS.map(([a0, a1]) => {
  const p = (a) => [256 + 172 * Math.cos((a * Math.PI) / 180), 256 + 172 * Math.sin((a * Math.PI) / 180)].map((v) => v.toFixed(1));
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `<path d="M${x0} ${y0}A172 172 0 0 1 ${x1} ${y1}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="18" stroke-linecap="round"/>`;
}).join('\n')}
<path d="M214 330V170l132-28v150" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
${HEADS.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>`).join('')}
</svg>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'app.svg'), svg);
for (const size of [192, 512]) fs.writeFileSync(path.join(OUT, `app-${size}.png`), pngRGBA(size, render(size)));
fs.writeFileSync(path.join(OUT, 'app.ico'), ico([16, 24, 32, 48, 64, 256].map((size) => ({ size, png: pngRGBA(size, render(size, size <= 32 ? 8 : 4)) }))));
console.log(`아이콘을 만들었어요 → ${OUT}`);
