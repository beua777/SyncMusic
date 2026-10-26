import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { lrcPathFor, readLyrics } from './tags.js';
import { JsonStore } from './util/jsonfile.js';

// 가사: 온라인 가사 찾기(LRCLIB, 사용자가 허락함) · .lrc로 저장 · 자동 번역(Google, 파일에 번역이 없을 때) · 가사로 곡 찾기
const UA = 'SyncMusic (https://github.com/beua777/SyncMusic)';

// 유튜브에서 받은 곡 제목은 군더더기가 많아서 검색 전에 다듬는다:
//   "【 4人 COVER 】 노래 제목 (song title) Cover by. 누군가" → "노래 제목"
export function cleanTitle(title) {
  let s = String(title ?? '')
    .normalize('NFKC')
    .replace(/[【\[(（][^】\])）]*[】\])）]/g, ' ')
    .replace(/\b(cover(ed)? by|feat\.?|ft\.)[\s\S]*$/i, ' ')
    .replace(/\b(official|music video|video|mv|m\/v|lyrics?|audio|hd|4k|cover)\b/gi, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[|｜/／⧸~～].*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = String(title ?? '').trim();
  return s;
}

// 가수를 모르는 곡은 제목에서 가수를 꺼내 본다 (유튜브에서 받은 곡):
//   일본식 "가수「제목」", 또는 왼쪽이 짧고 괄호가 없는 "가수 - 제목" (반대 순서일 수도 있어서 조심스럽게)
export function guessArtistTitle(title, artist) {
  const known = artist && !/^<.*>$/.test(artist) && !/알 수 없음/.test(artist);
  const raw = String(title ?? '').normalize('NFKC').split(/\s*[|｜⧸／]\s*/)[0];
  if (!known) {
    const jp = /^([^「『]{1,40})[「『]([^」』]+)[」』]/.exec(raw);
    if (jp) return { artist: jp[1].trim(), title: jp[2].trim() };
    const m = /^([^[\]()【】（）]{1,40}?)\s+[-–—]\s+(.+)$/.exec(raw);
    if (m && m[1].trim().split(/\s+/).length <= 4) return { artist: m[1].trim(), title: cleanTitle(m[2]) };
  }
  return { artist: known ? artist : '', title: cleanTitle(raw) };
}

async function getJson(url, { timeout = 10_000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`가사 서버 응답 ${res.status}`);
  return res.json();
}

const pick = (r) => ({
  id: r.id,
  title: r.trackName,
  artist: r.artistName,
  album: r.albumName,
  duration: r.duration,
  synced: !!r.syncedLyrics,
  instrumental: !!r.instrumental,
  lyrics: r.syncedLyrics || r.plainLyrics || '',
});

// LRCLIB에서 찾기: 정확히(제목·가수·앨범·길이) → 제목+가수 → 아무 말(q). 시간 맞춘 가사·길이가 비슷한 것부터
export async function searchLrclib({ title, artist, album, duration, query } = {}) {
  const base = 'https://lrclib.net/api';
  const { title: t, artist: a } = guessArtistTitle(title, artist);
  const found = new Map();
  const add = (list) => {
    for (const r of list || []) if (r && !found.has(r.id)) found.set(r.id, pick(r));
  };
  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  if (query) add(await getJson(`${base}/search?${qs({ q: query })}`));
  else {
    if (t && a && duration) {
      const exact = await getJson(`${base}/get?${qs({ track_name: t, artist_name: a, album_name: album || '', duration: Math.round(duration) })}`).catch(() => null);
      if (exact) add([exact]);
    }
    if (t && a) add(await getJson(`${base}/search?${qs({ track_name: t, artist_name: a })}`).catch(() => []));
    if (found.size < 3 && t) add(await getJson(`${base}/search?${qs({ q: a ? `${t} ${a}` : t })}`).catch(() => []));
    if (found.size < 3 && t) add(await getJson(`${base}/search?${qs({ track_name: t })}`).catch(() => []));
  }
  const d = Number(duration) || 0;
  return [...found.values()]
    .filter((r) => r.lyrics || r.instrumental)
    .sort((x, y) => y.synced - x.synced || (d ? Math.abs(x.duration - d) - Math.abs(y.duration - d) : 0))
    .slice(0, 12);
}

// .lrc 저장: 곡 파일 옆에. 있던 .lrc는 데이터 폴더에 백업해 둔다
export async function saveLrc(dataDir, track, text) {
  const file = lrcPathFor(track.path);
  try {
    const old = await fsp.readFile(file, 'utf8');
    if (old.trim() === String(text).trim()) return file;
    const dir = path.join(dataDir, 'lyrics-backup');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${track.id}-${Date.now()}.lrc`), old);
  } catch {
    // 처음 만드는 가사
  }
  await fsp.writeFile(file, String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
  return file;
}

const hangulRatio = (s) => {
  const letters = String(s).replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return 1;
  return (letters.match(/[가-힣]/g) || []).length / letters.length;
};

// 자동 번역 (Google 번역 무료 주소). 한 번 번역한 가사는 저장해 두고 다시 쓴다
export class Translator {
  constructor(dataDir) {
    this.cache = new JsonStore(path.join(dataDir, 'lyrics-translations.json'), { items: {} });
  }

  async translate(lines, target = 'ko') {
    const text = lines.join('\n');
    if (!text.trim()) return { lang: null, lines: lines.map(() => '') };
    if (target === 'ko' && hangulRatio(text) > 0.5) return { lang: 'ko', lines: lines.map(() => ''), same: true };
    const key = crypto.createHash('sha1').update(`${target}\n${text}`).digest('hex');
    const hit = this.cache.data.items[key];
    if (hit) return hit;
    // 줄 수가 많으면 나눠서 (주소 길이 제한)
    const out = [];
    let lang = null;
    let chunk = [];
    const flush = async () => {
      if (!chunk.length) return;
      const r = await googleTranslate(chunk.join('\n'), target);
      lang ||= r.lang;
      const parts = r.text.split('\n');
      if (parts.length === chunk.length) out.push(...parts);
      else for (const line of chunk) out.push(line.trim() ? (await googleTranslate(line, target)).text : '');
      chunk = [];
    };
    for (const line of lines) {
      if (chunk.join('\n').length + line.length > 1500) await flush();
      chunk.push(line);
    }
    await flush();
    const result = { lang, lines: out.map((s) => s.trim()) };
    this.cache.data.items[key] = result;
    const keys = Object.keys(this.cache.data.items);
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete this.cache.data.items[k];
    this.cache.save(1000);
    return result;
  }

  flush() {
    this.cache.flush();
  }
}

async function googleTranslate(text, target) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: `q=${encodeURIComponent(text)}`,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`번역 서버 응답 ${res.status}`);
  const j = await res.json();
  return { text: (j?.[0] || []).map((seg) => seg?.[0] ?? '').join(''), lang: j?.[2] || null };
}

// 가사로 곡 찾기: 가사가 있는 곡의 가사를 한 번 읽어 두고, 바뀐 곡만 다시 읽는다
export class LyricsIndex {
  constructor(library) {
    this.library = library;
    this.items = new Map(); // id → { text, mtime }
    this.building = null;
  }

  async refresh() {
    this.building ||= (async () => {
      const list = this.library.list().filter((t) => t.hasLyrics);
      const keep = new Set(list.map((t) => t.id));
      for (const id of this.items.keys()) if (!keep.has(id)) this.items.delete(id);
      for (const t of list) {
        const cur = this.items.get(t.id);
        let lrcTime = 0;
        try {
          lrcTime = (await fsp.stat(lrcPathFor(t.path))).mtimeMs;
        } catch {
          // .lrc 없음 (태그 가사)
        }
        if (cur && cur.mtime === t.mtime && cur.lrcTime === lrcTime) continue;
        const ly = await readLyrics(t.path).catch(() => null);
        this.items.set(t.id, { text: norm(ly?.text || ''), raw: ly?.text || '', mtime: t.mtime, lrcTime });
      }
    })().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  async search(q, limit = 50) {
    await this.refresh();
    const nq = norm(q);
    if (nq.length < 2) return [];
    const out = [];
    for (const [id, it] of this.items) {
      const i = it.text.indexOf(nq);
      if (i < 0) continue;
      const line = it.raw.split(/\r?\n/).find((l) => norm(l).includes(nq)) || '';
      out.push({ id, snippet: line.trim().slice(0, 120) });
      if (out.length >= limit) break;
    }
    return out;
  }
}

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
