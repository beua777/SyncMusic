import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { AUDIO_TYPES, UNKNOWN } from './config.js';
import { quickHash } from './quickhash.js';
import { readingKey } from './reading.js';
import { readCover, readExtended, readTrackInfo } from './tags.js';
import { JsonStore } from './util/jsonfile.js';
import { normalizeTheme } from './settings.js';

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git']);
// 재생은 못 하지만 음악 파일인 형식 (라이브러리 점검에서 알려 준다)
const UNSUPPORTED = new Set(['.wma', '.aif', '.aiff', '.ape', '.wv', '.dsf', '.dff', '.mka', '.amr', '.mid', '.midi', '.ra', '.tta']);
// 곡마다 사용자가 정한 값 (태그를 고쳐 곡 ID가 바뀌어도 넘겨준다)
const USER_FIELDS = ['userGain', 'noShuffle', 'coverOverride', 'bookmarks', 'theme', 'loud', 'skips', 'metaLog'];
// 바뀌면 메타데이터 변경 기록에 남기는 태그
const META_FIELDS = { title: '제목', artist: '아티스트', album: '앨범', albumArtist: '앨범 아티스트', year: '연도', genre: '장르', trackNo: '트랙 번호' };
export const EXTENDED_VERSION = 1;
const MIN_SIZE = 1024;
const UNKNOWN_ARTISTS = new Set(['', '<unknown>', 'unknown', UNKNOWN.toLowerCase(), '알 수 없음', '알수없음']);

// 제목·가수 비교용: 대소문자·공백·기호 무시
export const normText = (s) =>
  String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const normArtist = (s) => (UNKNOWN_ARTISTS.has(String(s ?? '').trim().toLowerCase()) ? '' : normText(s));

// 곡 ID = 파일 내용의 quick hash. 파일 하나하나(files)와 곡(tracks)을 따로 관리해서
// 같은 파일이 두 폴더에 있으면 곡 하나로 보고, 태그를 고쳐 해시가 바뀌면 옛 ID를 새 ID로 옮긴다(remap).
export class Library extends EventEmitter {
  constructor({ dataDir, getFolders, covers = null }) {
    super();
    this.getFolders = getFolders;
    this.covers = covers;
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
    this.changes = new JsonStore(path.join(dataDir, 'changes.json'), { scans: [] }); // 라이브러리 변경 기록
    this.unsupported = [];
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
    const unsupported = [];
    for (const dir of folders) await walk(dir, seen, unsupported);
    this.unsupported = unsupported.slice(0, 500);

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
    const changed = [];
    for (const [oldId, newId] of remaps) {
      const before = prev.get(oldId);
      const now = this.tracks.get(newId);
      if (!before || !now || this.tracks.has(oldId)) continue;
      // 태그만 바뀐 같은 곡: 재생 기록·사용자 값을 넘기고 재생목록의 ID도 바꾼다
      now.playCount = (now.playCount || 0) + (before.playCount || 0);
      now.lastPlayed = Math.max(now.lastPlayed || 0, before.lastPlayed || 0);
      now.addedAt = before.addedAt || now.addedAt;
      for (const k of USER_FIELDS) if (before[k] !== undefined && now[k] === undefined) now[k] = before[k];
      for (const [k, label] of Object.entries(META_FIELDS)) {
        if ((before[k] ?? null) !== (now[k] ?? null)) this.logMeta(now, label, before[k], now[k], '파일 태그');
      }
      changed.push({ from: oldId, to: newId, title: now.title, artist: now.artist });
      this.emit('remap', oldId, newId);
    }
    const remapped = new Set(changed.map((c) => c.from));
    this.logChange({
      added: [...this.tracks.values()].filter((t) => !prev.has(t.id) && !changed.some((c) => c.to === t.id)).map(brief),
      removed: removed.filter((id) => !remapped.has(id)).map((id) => brief(prev.get(id))),
      changed,
    });

    const coversChanged = await this.refreshCovers();
    if (this.covers) {
      const used = new Set([...this.tracks.values()].flatMap((t) => [t.cover, t.coverOverride]).filter(Boolean));
      await this.covers.prune((id) => used.has(id));
    }
    await this.refreshExtended();

    this.status = { scanning: false, done: todo.length, total: todo.length, lastScan: Date.now() };
    this.metaIndex = null;
    this.nameIndex = null;
    this.persist();
    this.emit('progress', { ...this.status });
    if (todo.length || filesRemoved || removed.length || coversChanged) {
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
    await this.refreshCovers([id]);
    await this.refreshExtended([id]);
    if (added) this.logChange({ added: [brief(this.tracks.get(id))], source: 'sync' });
    this.metaIndex = null;
    this.nameIndex = null;
    this.persist();
    this.emit('changed', { added, removed: 0, total: this.tracks.size });
    return this.tracks.get(id);
  }

  // 곡마다 자기 커버: 태그에 든 그림(곡마다 한 번만 읽음) → 없으면 같은 폴더의 cover.jpg (검색할 때마다 다시 봄).
  // 같은 폴더·앨범 이름이어도 곡마다 그림이 다를 수 있다 (유튜브에서 받은 곡 등). 바뀐 곡 수를 돌려준다.
  async refreshCovers(ids = null) {
    if (!this.covers) return 0;
    const list = ids ? ids.map((id) => this.tracks.get(id)).filter(Boolean) : [...this.tracks.values()];
    const folder = new Map();
    let changed = 0;
    await pool(list, 4, async (t) => {
      try {
        let cover = t.cover ?? null;
        let from = t.coverFrom;
        if (from === undefined) {
          const pic = await readCover(t.path);
          cover = pic ? await this.covers.save(pic.data, pic.format) : null;
          from = pic ? 'tag' : null;
        }
        if (from !== 'tag') {
          const dir = path.dirname(t.path);
          if (!folder.has(dir)) folder.set(dir, this.covers.folderCover(dir).catch(() => null));
          cover = await folder.get(dir);
          from = cover ? 'folder' : null;
        }
        if (cover !== (t.cover ?? null) || from !== t.coverFrom) {
          t.cover = cover;
          t.coverFrom = from;
          changed++;
        }
      } catch {
        // 읽을 수 없는 파일은 다음 검색 때 다시
      }
    });
    return changed;
  }

  // 처음 보는 곡(또는 예전 버전에서 넘어온 곡)만: 비트 깊이·채널·작곡가·ReplayGain 태그, 일본어 읽는 법(검색용)
  async refreshExtended(ids = null) {
    const list = (ids ? ids.map((id) => this.tracks.get(id)) : [...this.tracks.values()]).filter((t) => t && t.xv !== EXTENDED_VERSION);
    if (!list.length) return 0;
    await pool(list, 3, async (t) => {
      const x = await readExtended(t.path);
      if (!x) return;
      t.x = { bits: x.bits, channels: x.channels, container: x.container, composer: x.composer, comment: x.comment, bpm: x.bpm };
      if (x.rg) t.rg = x.rg;
      else delete t.rg;
      const reading = [await readingKey(t.title), await readingKey(t.artist), await readingKey(t.album)].filter(Boolean).join(' ');
      if (reading) t.reading = reading;
      else delete t.reading;
      t.xv = EXTENDED_VERSION;
    });
    this.persist();
    return list.length;
  }

  // ───── 곡마다 사용자 값: 곡 음량 · 셔플 제외 · 바꾼 커버 · 북마크 · 화면 테마 ─────
  setUser(id, patch = {}) {
    const t = this.tracks.get(id);
    if (!t) return null;
    if ('userGain' in patch) {
      const v = Number(patch.userGain);
      const g = Number.isFinite(v) ? Math.round(Math.max(-12, Math.min(12, v)) * 2) / 2 : 0;
      if (g !== (t.userGain || 0)) this.logMeta(t, '곡 음량', fmtDb(t.userGain || 0), fmtDb(g), '앱');
      if (g) t.userGain = g;
      else delete t.userGain;
    }
    if ('noShuffle' in patch) {
      if (patch.noShuffle === true) t.noShuffle = true;
      else delete t.noShuffle;
    }
    if ('coverOverride' in patch) {
      const c = patch.coverOverride;
      if (typeof c === 'string' && /^[0-9a-f]{20}$/.test(c)) {
        if (c !== t.coverOverride) this.logMeta(t, '커버', t.coverOverride ? '바꾼 커버' : '원래 커버', '새 커버', '앱');
        t.coverOverride = c;
      } else if (c === null && t.coverOverride) {
        this.logMeta(t, '커버', '바꾼 커버', '원래 커버', '앱');
        delete t.coverOverride;
      }
    }
    if ('bookmarks' in patch) {
      const list = Array.isArray(patch.bookmarks) ? patch.bookmarks : [];
      const bm = list
        .filter((b) => b && Number.isFinite(Number(b.t)) && Number(b.t) >= 0)
        .slice(0, 100)
        .map((b) => ({ t: Math.round(Number(b.t) * 10) / 10, note: String(b.note ?? '').slice(0, 120), at: Number(b.at) || Date.now() }))
        .sort((a, b) => a.t - b.t);
      if (bm.length) t.bookmarks = bm;
      else delete t.bookmarks;
    }
    if ('theme' in patch) {
      const th = normalizeTheme(patch.theme);
      if (th) t.theme = th;
      else delete t.theme;
    }
    this.persist();
    return t;
  }

  // 음량 평준화·무음 건너뛰기용 분석 결과 (화면에서 재서 보내 준다)
  setAnalysis(id, a = {}) {
    const t = this.tracks.get(id);
    if (!t) return null;
    const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : null);
    const dur = t.duration || 36_000;
    t.loud = {
      v: Number.isInteger(a.v) ? a.v : 1,
      lufs: a.lufs === null ? null : num(a.lufs, -90, 10),
      peak: num(a.peak, 0, 4),
      start: num(a.start, 0, dur) ?? 0,
      end: num(a.end, 0, dur + 5) ?? dur,
      gaps: (Array.isArray(a.gaps) ? a.gaps : [])
        .filter((g) => Array.isArray(g) && g.length === 2)
        .slice(0, 50)
        .map(([x, y]) => [num(x, 0, dur), num(y, 0, dur)])
        .filter(([x, y]) => x !== null && y !== null && y > x),
    };
    this.persist();
    return t;
  }

  addSkip(id) {
    const t = this.tracks.get(id);
    if (!t) return null;
    t.skips = (t.skips || 0) + 1;
    this.persist();
    return t;
  }

  // 곡 정보 변경 기록 (곡마다 최근 100개)
  logMeta(t, field, from, to, source) {
    (t.metaLog ||= []).push({ at: Date.now(), field, from: from ?? null, to: to ?? null, source });
    if (t.metaLog.length > 100) t.metaLog.splice(0, t.metaLog.length - 100);
  }

  // 라이브러리 변경 기록: 검색할 때마다 추가·삭제·변경된 곡 (최근 40번). 동기화로 잇달아 들어온 곡은 하나로 모은다
  logChange({ added = [], removed = [], changed = [], source = 'scan' }) {
    if (!added.length && !removed.length && !changed.length) return;
    const scans = this.changes.data.scans;
    const last = scans[scans.length - 1];
    const cap = (a) => a.slice(0, 300);
    if (last && last.source === source && source === 'sync' && Date.now() - last.at < 5 * 60_000) {
      last.added = cap([...last.added, ...added]);
      last.at = Date.now();
    } else {
      scans.push({ at: Date.now(), source, added: cap(added), removed: cap(removed), changed: cap(changed) });
      if (scans.length > 40) scans.splice(0, scans.length - 40);
    }
    this.changes.save(500);
  }

  changeLog() {
    return this.changes.data.scans.slice().reverse();
  }

  // ───── 라이브러리 점검 ─────
  check(playlists) {
    const list = this.list();
    const pick = (arr) => arr.slice(0, 300).map(brief);
    const missing = list.filter((t) => !fs.existsSync(t.path));
    const zero = list.filter((t) => !(t.duration > 0));
    const untagged = list.filter((t) => t.artist === UNKNOWN || t.title === path.basename(t.path, path.extname(t.path)));
    const noCover = list.filter((t) => !t.cover && !t.coverOverride);
    const brokenLists = playlists
      .all()
      .map((p) => ({ id: p.id, name: p.name, missing: p.entries.filter((x) => !this.tracks.has(x)).length, total: p.entries.length }))
      .filter((p) => p.missing);
    return {
      checkedAt: Date.now(),
      total: list.length,
      missing: pick(missing),
      zeroDuration: pick(zero),
      untagged: { count: untagged.length, items: pick(untagged) },
      noCover: { count: noCover.length },
      noLyrics: { count: list.filter((t) => !t.hasLyrics).length },
      unsupported: this.unsupported.slice(0, 300),
      playlists: brokenLists,
      duplicates: this.duplicates().length,
    };
  }

  // 같은 곡 다른 파일: 제목+가수가 같고 길이가 3초 안쪽. 음질 좋은 것부터
  duplicates() {
    const groups = new Map();
    for (const t of this.tracks.values()) {
      const k = `${normText(t.title)}|${normArtist(t.artist)}`;
      if (!normText(t.title)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => (a.duration || 0) - (b.duration || 0));
      // 길이가 3초 넘게 다르면 다른 곡(라이브·리믹스 등)으로 보고 나눈다
      let cur = [g[0]];
      const flush = () => cur.length > 1 && out.push(cur.slice().sort((a, b) => quality(b) - quality(a)).map(briefQ));
      for (let i = 1; i < g.length; i++) {
        if (Math.abs((g[i].duration || 0) - (cur[cur.length - 1].duration || 0)) <= 3) cur.push(g[i]);
        else {
          flush();
          cur = [g[i]];
        }
      }
      flush();
    }
    return out;
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
    this.changes.flush();
  }
}

const brief = (t) => (t ? { id: t.id, title: t.title, artist: t.artist, path: t.path } : null);
const quality = (t) => (t.lossless ? 100_000 : 0) + (t.bitrate || 0) / 1000 + (t.sampleRate || 0) / 10_000 + (t.x?.bits || 0);
const briefQ = (t) => ({ ...brief(t), codec: t.codec, bitrate: t.bitrate, lossless: t.lossless, sampleRate: t.sampleRate, size: t.size, duration: t.duration, playCount: t.playCount || 0 });
const fmtDb = (v) => `${v > 0 ? '+' : ''}${v}dB`;

async function walk(dir, seen, unsupported = []) {
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
      await walk(full, seen, unsupported);
    } else if (e.isFile() && UNSUPPORTED.has(path.extname(e.name).toLowerCase())) {
      unsupported.push(full);
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
