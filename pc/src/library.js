import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { AUDIO_TYPES, UNKNOWN } from './config.js';
import { quickHash } from './quickhash.js';
import { readTrackInfo } from './tags.js';
import { JsonStore } from './util/jsonfile.js';

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git']);
const MIN_SIZE = 1024;
const UNKNOWN_ARTISTS = new Set(['', '<unknown>', 'unknown', UNKNOWN.toLowerCase(), '알 수 없음', '알수없음']);

// 제목·가수 비교용: 대소문자·공백·기호 무시
export const normText = (s) =>
  String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const normArtist = (s) => (UNKNOWN_ARTISTS.has(String(s ?? '').trim().toLowerCase()) ? '' : normText(s));

// 곡 ID = 파일 내용의 quick hash. 파일 하나하나(files)와 곡(tracks)을 따로 관리해서
// 같은 파일이 두 폴더에 있으면 곡 하나로 보고, 태그를 고쳐 해시가 바뀌면 옛 ID를 새 ID로 옮긴다(remap).
export class Library extends EventEmitter {
  constructor({ dataDir, getFolders }) {
    super();
    this.getFolders = getFolders;
    this.store = new JsonStore(path.join(dataDir, 'library.json'), { version: 1, tracks: {}, files: {} });
    this.tracks = new Map(Object.entries(this.store.data.tracks));
    this.files = new Map(Object.entries(this.store.data.files)); // 경로 키 → { path, size, mtime, id }
    this.scanning = null;
    this.rescanQueued = false;
    this.watchers = [];
    this.scanTimer = null;
    this.metaIndex = null;
    this.nameIndex = null;
    this.status = { scanning: false, done: 0, total: 0, lastScan: null };
  }

  static key(p) {
    return path.resolve(p).toLowerCase(); // Windows는 대소문자 구분 없음
  }

  list() {
    return [...this.tracks.values()];
  }

  get(id) {
    return this.tracks.get(id) || null;
  }

  idForPath(p) {
    return this.files.get(Library.key(p))?.id || null;
  }

  persist() {
    this.store.data.tracks = Object.fromEntries(this.tracks);
    this.store.data.files = Object.fromEntries(this.files);
    this.store.save(800);
  }

  scan() {
    if (this.scanning) {
      this.rescanQueued = true;
      return this.scanning;
    }
    this.scanning = this._scan()
      .catch((e) => console.error('라이브러리 검색 실패:', e))
      .finally(() => {
        this.scanning = null;
        if (this.rescanQueued) {
          this.rescanQueued = false;
          this.scan();
        }
      });
    return this.scanning;
  }

  async _scan() {
    const scanStart = Date.now();
    const folders = [...new Set(this.getFolders().filter(Boolean).map((f) => path.resolve(f)))];
    const seen = new Map();
    for (const dir of folders) await walk(dir, seen);

    // 크기·수정 시간이 같으면 다시 읽지 않는다 (두 번째 검색부터 빠름)
    const todo = [];
    for (const [k, f] of seen) {
      const rec = this.files.get(k);
      if (!(rec && rec.size === f.size && rec.mtime === f.mtime)) todo.push(f);
    }
    this.status = { scanning: true, done: 0, total: todo.length, lastScan: this.status.lastScan };
    this.emit('progress', { ...this.status });

    const remaps = [];
    const newInfo = new Map();
    await pool(todo, 4, async (f) => {
      try {
        const id = await quickHash(f.path);
        const old = this.files.get(f.key);
        if (old && old.id !== id) remaps.push([old.id, id]);
        if (!this.tracks.has(id) && !newInfo.has(id)) newInfo.set(id, await readTrackInfo(f.path));
        this.files.set(f.key, { path: f.path, size: f.size, mtime: f.mtime, id, added: f.added });
      } catch {
        // 다른 프로그램이 쓰는 중인 파일 등은 다음 검색 때 다시 시도
      }
      this.status.done++;
      if (this.status.done % 25 === 0) this.emit('progress', { ...this.status });
    });

    let filesRemoved = 0;
    for (const [k, rec] of [...this.files]) {
      if (seen.has(k)) continue;
      if (rec.ingested && rec.ingested >= scanStart) continue; // 검색 도중 동기화로 들어온 파일
      this.files.delete(k);
      filesRemoved++;
    }

    const prev = this.tracks;
    const { added, removed } = this.rebuildTracks(newInfo);
    for (const [oldId, newId] of remaps) {
      const before = prev.get(oldId);
      const now = this.tracks.get(newId);
      if (!before || !now || this.tracks.has(oldId)) continue;
      // 태그만 바뀐 같은 곡: 재생 기록을 넘기고 재생목록의 ID도 바꾼다
      now.playCount = (now.playCount || 0) + (before.playCount || 0);
      now.lastPlayed = Math.max(now.lastPlayed || 0, before.lastPlayed || 0);
      now.addedAt = before.addedAt || now.addedAt;
      this.emit('remap', oldId, newId);
    }

    this.status = { scanning: false, done: todo.length, total: todo.length, lastScan: Date.now() };
    this.metaIndex = null;
    this.nameIndex = null;
    this.persist();
    this.emit('progress', { ...this.status });
    if (todo.length || filesRemoved || removed.length) {
      this.emit('changed', { added, removed: removed.length, total: this.tracks.size });
    }
  }

  rebuildTracks(newInfo) {
    const byId = new Map();
    for (const rec of this.files.values()) {
      if (!byId.has(rec.id)) byId.set(rec.id, []);
      byId.get(rec.id).push(rec);
    }
    const next = new Map();
    let added = 0;
    for (const [id, recs] of byId) {
      let t = this.tracks.get(id);
      if (!t) {
        const info = newInfo.get(id);
        if (!info) continue;
        t = {
          id,
          ...info,
          addedAt: Math.min(...recs.map((r) => r.added || Date.now())),
          playCount: 0,
          lastPlayed: 0,
        };
        added++;
      }
      recs.sort((a, b) => a.path.localeCompare(b.path));
      const primary = recs.find((r) => t.path && Library.key(r.path) === Library.key(t.path)) || recs[0];
      t.path = primary.path;
      t.size = primary.size;
      t.mtime = primary.mtime;
      const alt = recs.filter((r) => r !== primary).map((r) => r.path);
      if (alt.length) t.altPaths = alt;
      else delete t.altPaths;
      next.set(id, t);
    }
    const removed = [...this.tracks.keys()].filter((id) => !next.has(id));
    this.tracks = next;
    return { added, removed };
  }

  // 동기화로 받은 파일을 바로 라이브러리에 넣는다 (폴더 감시를 기다리지 않음)
  async ingestFile(file, knownId) {
    const st = await fsp.stat(file);
    const id = knownId || (await quickHash(file));
    this.files.set(Library.key(file), {
      path: file,
      size: st.size,
      mtime: Math.round(st.mtimeMs),
      id,
      added: Date.now(),
      ingested: Date.now(),
    });
    const newInfo = new Map();
    if (!this.tracks.has(id)) newInfo.set(id, await readTrackInfo(file));
    const { added } = this.rebuildTracks(newInfo);
    this.metaIndex = null;
    this.nameIndex = null;
    this.persist();
    this.emit('changed', { added, removed: 0, total: this.tracks.size });
    return this.tracks.get(id);
  }

  // 내용이 다른 같은 곡(다른 인코딩 등)을 제목+가수(+길이 ±2초)로 찾는다
  findByMeta(title, artist, duration) {
    if (!title) return null;
    if (!this.metaIndex) {
      this.metaIndex = new Map();
      for (const t of this.tracks.values()) {
        const k = `${normText(t.title)}|${normArtist(t.artist)}`;
        if (!this.metaIndex.has(k)) this.metaIndex.set(k, []);
        this.metaIndex.get(k).push(t);
      }
    }
    const cands = this.metaIndex.get(`${normText(title)}|${normArtist(artist)}`) || [];
    if (!cands.length) return null;
    if (!duration) return cands[0];
    return cands.find((t) => !t.duration || Math.abs(t.duration - duration) <= 2) || null;
  }

  findByFileName(name) {
    if (!this.nameIndex) {
      this.nameIndex = new Map();
      for (const rec of this.files.values()) {
        const k = path.basename(rec.path).toLowerCase();
        if (!this.nameIndex.has(k)) this.nameIndex.set(k, rec.id);
      }
    }
    const id = this.nameIndex.get(String(name).toLowerCase());
    return id ? this.tracks.get(id) || null : null;
  }

  markPlayed(id) {
    const t = this.tracks.get(id);
    if (!t) return null;
    t.playCount = (t.playCount || 0) + 1;
    t.lastPlayed = Date.now();
    this.persist();
    return t;
  }

  setDuration(id, seconds) {
    const t = this.tracks.get(id);
    if (!t || !(seconds > 0) || (t.duration && Math.abs(t.duration - seconds) < 1)) return false;
    t.duration = Math.round(seconds * 1000) / 1000;
    this.persist();
    return true;
  }

  watch() {
    this.unwatch();
    for (const dir of this.getFolders()) {
      try {
        const w = fs.watch(dir, { recursive: true }, (_ev, name) => {
          if (name) {
            const ext = path.extname(String(name)).toLowerCase();
            if (ext && !AUDIO_TYPES[ext]) return; // 가사·이미지 등은 무시 (확장자 없는 건 폴더 변경이라 다시 검색)
          }
          this.scheduleScan();
        });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch {
        // 폴더가 없으면 감시하지 않음
      }
    }
  }

  unwatch() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    clearTimeout(this.scanTimer);
  }

  scheduleScan(delay = 1500) {
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => this.scan(), delay);
  }

  flush() {
    this.store.flush();
  }
}

async function walk(dir, seen) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase()) || e.name.startsWith('.')) continue;
      await walk(full, seen);
    } else if (e.isFile() && AUDIO_TYPES[path.extname(e.name).toLowerCase()]) {
      try {
        const st = await fsp.stat(full);
        if (st.size < MIN_SIZE) continue;
        const key = Library.key(full);
        if (seen.has(key)) continue;
        const mtime = Math.round(st.mtimeMs);
        seen.set(key, { key, path: full, size: st.size, mtime, added: Math.round(Math.min(st.birthtimeMs || mtime, mtime)) });
      } catch {
        // 권한 없는 파일
      }
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
