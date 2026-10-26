// 화면 쪽 데이터: 곡, 재생목록, 앨범·아티스트·폴더 묶음
import { phoneticKey } from './phonetic.js';
import { decompose } from './search.js';
import { chosung, collator, normSearch } from './util.js';

const UNKNOWN = '<알 수 없음>';
const basename = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;

export const store = {
  app: {},
  settings: {},
  scan: null,
  tracks: new Map(),
  list: [],
  playlists: [],
  albums: [],
  artists: [],
  folders: [],
  albumByKey: new Map(),
  artistByName: new Map(),
  folderByDir: new Map(),
  albumKeyOf: new Map(),
  listeners: new Map(),

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
  },

  off(evt, fn) {
    this.listeners.get(evt)?.delete(fn);
  },

  emit(evt, data) {
    for (const fn of this.listeners.get(evt) || []) fn(data);
  },

  setTracks(arr) {
    this.tracks = new Map(arr.map((t) => [t.id, prep(t)]));
    this.list = [...this.tracks.values()];
    this.derive();
    this.emit('library');
  },

  updateTrack(t) {
    const cur = this.tracks.get(t.id);
    if (!cur) return;
    Object.assign(cur, prep(t));
    this.emit('track', cur);
  },

  setPlaylists(arr) {
    this.playlists = arr;
    this.emit('playlists');
  },

  playlist(id) {
    return this.playlists.find((p) => p.id === id) || null;
  },

  get favorites() {
    return this.playlist('favorites');
  },

  isFavorite(id) {
    return !!this.favorites?.entries.includes(id);
  },

  // 앨범 = 앨범 이름 + (앨범 아티스트, 없으면 폴더). 같은 이름의 다른 앨범이 섞이지 않게
  derive() {
    const albums = new Map();
    const artists = new Map();
    const folders = new Map();
    this.albumKeyOf = new Map();
    for (const t of this.list) {
      const aKey = `${t.album}\u0001${t.albumArtist || t.dir}`;
      let a = albums.get(aKey);
      if (!a) {
        a = { key: aKey, name: t.album, artist: t.albumArtist || null, year: null, dir: t.dir, tracks: [], counts: new Map() };
        albums.set(aKey, a);
      }
      a.tracks.push(t);
      a.counts.set(t.artist, (a.counts.get(t.artist) || 0) + 1);
      if (!a.year && t.year) a.year = t.year;
      this.albumKeyOf.set(t.id, aKey);

      let ar = artists.get(t.artist);
      if (!ar) artists.set(t.artist, (ar = { name: t.artist, tracks: [], albumKeys: new Set() }));
      ar.tracks.push(t);
      ar.albumKeys.add(aKey);

      let f = folders.get(t.dir);
      if (!f) folders.set(t.dir, (f = { dir: t.dir, name: basename(t.dir), tracks: [] }));
      f.tracks.push(t);
    }
    for (const a of albums.values()) {
      a.tracks.sort(
        (x, y) => (x.discNo || 1) - (y.discNo || 1) || (x.trackNo || 9999) - (y.trackNo || 9999) || collator.compare(x.title, y.title),
      );
      a.coverId = a.tracks.find((t) => t.cover)?.cover || null; // 커버가 있는 첫 곡
      a.duration = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
      if (!a.artist) {
        const top = [...a.counts.entries()].sort((x, y) => y[1] - x[1]);
        a.artist = top.length > 1 && top[0][1] <= a.tracks.length / 2 ? '여러 아티스트' : top[0][0];
      }
      delete a.counts;
      a._s = normSearch(`${a.name} ${a.artist}`);
      a._c = chosung(a._s);
      a._p = `${phoneticKey(a.name)}|${phoneticKey(a.artist)}`;
    }
    for (const ar of artists.values()) {
      ar.albums = [...ar.albumKeys].map((k) => albums.get(k)).sort((x, y) => (y.year || 0) - (x.year || 0) || collator.compare(x.name, y.name));
      ar.coverId = ar.albums.find((a) => a.coverId)?.coverId || null;
      ar.tracks.sort((x, y) => collator.compare(x.title, y.title));
      delete ar.albumKeys;
      ar._s = normSearch(ar.name);
      ar._c = chosung(ar._s);
      ar._p = phoneticKey(ar.name);
    }
    for (const f of folders.values()) f.tracks.sort((x, y) => collator.compare(basename(x.path), basename(y.path)));

    const unknownLast = (x, y) => (x.name === UNKNOWN) - (y.name === UNKNOWN) || collator.compare(x.name, y.name);
    this.albums = [...albums.values()].sort(unknownLast);
    this.artists = [...artists.values()].sort(unknownLast);
    this.folders = [...folders.values()].sort((x, y) => collator.compare(x.name, y.name));
    this.albumByKey = albums;
    this.artistByName = artists;
    this.folderByDir = folders;
  },

  // 곡마다 자기 커버 (같은 폴더·앨범이라도 곡마다 그림이 다를 수 있음). 없으면 기본 음표 그림
  coverIdFor(t) {
    return t?.cover || null;
  },

  albumOf(t) {
    return this.albumByKey.get(this.albumKeyOf.get(t.id)) || null;
  },

  // 삼성 뮤직의 기본 재생목록: 최근 추가 · 가장 많이 재생 · 최근 재생
  smart(kind) {
    const L = this.list;
    if (kind === 'recent') return [...L].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 100);
    if (kind === 'most') return L.filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed).slice(0, 100);
    if (kind === 'history') return L.filter((t) => t.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 100);
    return [];
  },
};

// 검색용: 글자 그대로(_s) · 초성(_c) · 소리 열쇠(_p: 가나·한글·한자 읽기를 같은 로마자로) · 자모(_f: 오타 허용)
function prep(t) {
  t._s = normSearch(`${t.title} ${t.artist} ${t.album}`);
  t._c = chosung(t._s);
  t._p = [phoneticKey(t.title), phoneticKey(t.artist), phoneticKey(t.album), t.reading || ''].join('|');
  t._f = decompose(`${t.title} ${t.artist} ${t.album}`);
  return t;
}
