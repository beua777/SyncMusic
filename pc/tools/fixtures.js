// 테스트·데모용 음악 파일 만들기: 짧은 멜로디 WAV + ID3v2.4 태그(제목·가수·앨범·트랙·커버·가사)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const RATE = 16000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 펜타토닉 음계로 곡마다 다른 멜로디
export function melodyPcm({ seed = 1, seconds = 20, root = 60, bpm = 96 } = {}) {
  const rand = rng(seed);
  const n = Math.floor(RATE * seconds);
  const out = Buffer.alloc(n * 2);
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const beat = 60 / bpm / 2;
  let t0 = 0;
  while (t0 < seconds) {
    const note = root + scale[Math.floor(rand() * scale.length)];
    const freq = 440 * 2 ** ((note - 69) / 12);
    const len = beat * (rand() < 0.25 ? 2 : 1);
    const start = Math.floor(t0 * RATE);
    const end = Math.min(n, Math.floor((t0 + len) * RATE));
    for (let i = start; i < end; i++) {
      const t = (i - start) / RATE;
      const env = Math.min(1, t * 60) * Math.exp(-t * 3.2);
      const v = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t)) * env * 0.32;
      const prev = out.readInt16LE(i * 2) / 32767;
      out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, prev + v)) * 32767), i * 2);
    }
    t0 += len;
  }
  const fade = RATE; // 마지막 1초 페이드아웃
  for (let i = Math.max(0, n - fade); i < n; i++) out.writeInt16LE(Math.round((out.readInt16LE(i * 2) * (n - i)) / fade), i * 2);
  return out;
}

const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

function frame(id, content) {
  return Buffer.concat([Buffer.from(id, 'ascii'), syncsafe(content.length), Buffer.from([0, 0]), content]);
}
const textFrame = (id, text) => frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(String(text), 'utf8')]));

export function id3v24({ title, artist, album, albumArtist, track, year, genre, cover, lyrics }) {
  const frames = [];
  if (title) frames.push(textFrame('TIT2', title));
  if (artist) frames.push(textFrame('TPE1', artist));
  if (album) frames.push(textFrame('TALB', album));
  if (albumArtist) frames.push(textFrame('TPE2', albumArtist));
  if (track) frames.push(textFrame('TRCK', track));
  if (year) frames.push(textFrame('TDRC', year));
  if (genre) frames.push(textFrame('TCON', genre));
  if (lyrics) frames.push(frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('kor', 'ascii'), Buffer.from([0]), Buffer.from(lyrics, 'utf8')])));
  if (cover) {
    frames.push(frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0', 'ascii'), Buffer.from([3]), Buffer.from([0]), cover])));
  }
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.from([4, 0, 0]), syncsafe(body.length), body]);
}

export function wav(pcm, tag) {
  const chunk = (id, data) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(RATE, 4);
  fmt.writeUInt32LE(RATE * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const parts = [chunk('fmt ', fmt), chunk('data', pcm)];
  if (tag) parts.push(chunk('id3 ', tag));
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// 아주 작은 PNG 인코더 (커버 그림용)
export function png(w, h, pixel) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 대각선 그라데이션 위에 동그라미 몇 개 (앨범마다 색이 다름)
export function coverArt(c1, c2, c3, size = 320) {
  const circles = [
    [0.3, 0.35, 0.22],
    [0.68, 0.62, 0.3],
    [0.25, 0.78, 0.12],
  ];
  return png(size, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const k = (u + v) / 2;
    let col = c1.map((a, i) => Math.round(a + (c2[i] - a) * k));
    for (const [cx, cy, r] of circles) {
      const d = Math.hypot(u - cx, v - cy);
      if (d < r) {
        const a = 0.35 * (1 - d / r);
        col = col.map((ch, i) => Math.round(ch + (c3[i] - ch) * a));
      }
    }
    return col;
  });
}

export const DEMO_ALBUMS = [
  {
    artist: '하늘빛',
    album: '봄날의 산책',
    year: '2024',
    genre: '인디',
    colors: [[255, 179, 167], [255, 221, 148], [255, 255, 255]],
    root: 62,
    tracks: ['아침 햇살', '꽃길', '바람의 노래', '오후 세 시'],
    lrcTrack: '바람의 노래',
  },
  {
    artist: 'Neon Coast',
    album: 'Night Drive',
    year: '2023',
    genre: 'Synthwave',
    colors: [[42, 30, 92], [214, 54, 140], [255, 200, 90]],
    root: 57,
    tracks: ['City Lights', 'Midnight Highway', 'Afterglow'],
  },
  {
    artist: '윤서',
    album: '잔잔한 피아노',
    year: '2022',
    genre: '뉴에이지',
    colors: [[188, 214, 232], [92, 138, 178], [240, 248, 255]],
    root: 65,
    tracks: ['비 오는 날', '첫눈', '기억의 정원'],
    usltTrack: '첫눈',
  },
  {
    artist: 'Coral Reef',
    album: 'Summer Breeze',
    year: '2025',
    genre: 'Pop',
    colors: null, // 커버 없음 → 기본 그림
    root: 67,
    tracks: ['Wave', 'Sunset Boulevard'],
  },
];

export function demoTrackFiles({ seconds = 20 } = {}) {
  const files = [];
  let seed = 1;
  for (const a of DEMO_ALBUMS) {
    const cover = a.colors ? coverArt(...a.colors) : null;
    a.tracks.forEach((title, i) => {
      const tag = id3v24({
        title,
        artist: a.artist,
        album: a.album,
        track: `${i + 1}/${a.tracks.length}`,
        year: a.year,
        genre: a.genre,
        cover,
        lyrics: a.usltTrack === title ? '하얗게 내리는 첫눈처럼\n조용히 너에게 닿을게\n\n(데모 가사)' : null,
      });
      const rel = path.join(a.artist, a.album, `${String(i + 1).padStart(2, '0')} ${title}.wav`);
      const lrc =
        a.lrcTrack === title
          ? '[00:00.50]바람이 불어오는 곳\n[00:04.20]그곳으로 가네\n[00:08.00]그대의 머릿결 같은\n[00:12.10]나무 아래로\n[00:16.00](데모 가사)\n'
          : null;
      files.push({ rel, data: wav(melodyPcm({ seed: seed++, seconds, root: a.root }), tag), lrc });
    });
  }
  // 태그 없는 녹음 파일: 제목=파일 이름, 가수=<알 수 없음>, 앨범=폴더 이름 (삼성 뮤직과 같은 표시)
  files.push({ rel: path.join('Voice Memos', '녹음_0412.wav'), data: wav(melodyPcm({ seed: 99, seconds: 8, root: 72 }), null) });
  return files;
}

export function writeDemoLibrary(dir, opts) {
  const written = [];
  for (const f of demoTrackFiles(opts)) {
    const p = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
    if (f.lrc) fs.writeFileSync(p.replace(/\.wav$/i, '.lrc'), f.lrc);
    written.push(p);
  }
  return written;
}
