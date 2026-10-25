import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFile, selectCover } from 'music-metadata';
import { UNKNOWN } from './config.js';

const clean = (s) => (typeof s === 'string' ? s.replace(/\0/g, '').trim() : '');

// 삼성 뮤직처럼: 제목이 없으면 파일 이름, 가수가 없으면 <알 수 없음>, 앨범이 없으면 폴더 이름
export async function readTrackInfo(file) {
  let mm = null;
  try {
    mm = await parseFile(file, { duration: false, skipCovers: true });
  } catch {
    // 태그를 못 읽어도 파일 이름으로 등록한다
  }
  const c = mm?.common ?? {};
  const f = mm?.format ?? {};
  const base = path.basename(file, path.extname(file));
  const folderName = path.basename(path.dirname(file));
  return {
    title: clean(c.title) || base,
    artist: clean(c.artist) || clean(c.artists?.join(', ')) || UNKNOWN,
    album: clean(c.album) || folderName || UNKNOWN,
    albumArtist: clean(c.albumartist) || null,
    trackNo: c.track?.no ?? null,
    discNo: c.disk?.no ?? null,
    year: c.year ?? null,
    genre: clean(c.genre?.[0]) || null,
    duration: Number.isFinite(f.duration) ? Math.round(f.duration * 1000) / 1000 : 0,
    codec: f.codec || f.container || null,
    lossless: !!f.lossless,
    sampleRate: f.sampleRate || null,
    bitrate: f.bitrate ? Math.round(f.bitrate) : null,
    hasLyrics: !!c.lyrics?.length || fs.existsSync(lrcPathFor(file)),
  };
}

const lrcPathFor = (file) => file.slice(0, -path.extname(file).length) + '.lrc';

export async function readCover(file) {
  try {
    const mm = await parseFile(file, { duration: false, skipCovers: false });
    const pic = selectCover(mm.common.picture);
    if (pic?.data?.length) return { format: pic.format || 'image/jpeg', data: Buffer.from(pic.data) };
  } catch {
    // 커버 없음
  }
  return null;
}

const FOLDER_COVERS = ['cover', 'folder', 'front', 'albumart', 'album'];
const IMG_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// 태그에 커버가 없으면 같은 폴더의 cover.jpg / folder.jpg 등을 찾는다
export async function findFolderCover(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const imgs = names.filter((n) => IMG_EXT[path.extname(n).toLowerCase()]);
  const pick =
    imgs.find((n) => FOLDER_COVERS.includes(path.basename(n, path.extname(n)).toLowerCase())) ||
    imgs.find((n) => /^albumart/i.test(n));
  if (!pick) return null;
  return { file: path.join(dir, pick), format: IMG_EXT[path.extname(pick).toLowerCase()] };
}

// 가사: 같은 이름의 .lrc 파일(시간 동기) → 태그의 동기 가사 → 태그의 일반 가사 순서
export async function readLyrics(file) {
  try {
    const text = await fsp.readFile(lrcPathFor(file), 'utf8');
    const synced = parseLrc(text);
    if (synced.length) return { synced, text: synced.map((l) => l.line).join('\n'), source: 'lrc' };
  } catch {
    // .lrc 없음
  }
  try {
    const mm = await parseFile(file, { duration: false, skipCovers: true });
    for (const l of mm.common.lyrics || []) {
      if (l?.syncText?.length && l.syncText.some((s) => Number.isFinite(s.timestamp))) {
        const synced = l.syncText
          .filter((s) => Number.isFinite(s.timestamp))
          .map((s) => ({ t: s.timestamp / 1000, line: clean(s.text) }))
          .sort((a, b) => a.t - b.t);
        return { synced, text: synced.map((s) => s.line).join('\n'), source: 'tag' };
      }
    }
    const plain = (mm.common.lyrics || []).map((l) => (typeof l === 'string' ? l : l?.text)).find((t) => clean(t));
    if (plain) {
      const synced = parseLrc(plain); // 일부 태그는 LRC 텍스트를 그대로 넣어 둔다
      if (synced.length) return { synced, text: synced.map((s) => s.line).join('\n'), source: 'tag' };
      return { synced: null, text: clean(plain), source: 'tag' };
    }
  } catch {
    // 태그 없음
  }
  return { synced: null, text: '', source: null };
}

export function parseLrc(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const line = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, line });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
