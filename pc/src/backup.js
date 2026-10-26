import fs from 'node:fs';
import { APP_NAME } from './config.js';
import { Library } from './library.js';

// 설정 백업·복원: 설정 · 재생목록(이력 포함) · 곡마다 사용자 값 · 들은 기록 · 바꾼 커버 그림.
// 폰 연결 정보(비밀 키)는 넣지 않는다. 음악 파일도 넣지 않는다.
const USER_FIELDS = ['playCount', 'lastPlayed', 'addedAt', 'userGain', 'noShuffle', 'coverOverride', 'bookmarks', 'theme', 'skips', 'metaLog'];

export function makeBackup({ settings, playlists, library, history, covers }) {
  const tracks = [];
  const coverIds = new Set();
  for (const t of library.list()) {
    const u = { id: t.id, path: t.path };
    let any = false;
    for (const k of USER_FIELDS) {
      if (t[k] === undefined) continue;
      u[k] = t[k];
      any = true;
    }
    if (t.coverOverride) coverIds.add(t.coverOverride);
    if (any) tracks.push(u);
  }
  const images = {};
  for (const id of coverIds) {
    const c = covers.find(id);
    if (c) images[id] = { format: c.format, data: fs.readFileSync(c.file).toString('base64') };
  }
  return {
    app: APP_NAME,
    kind: 'backup',
    version: 1,
    createdAt: Date.now(),
    settings: settings.data,
    playlists: { lists: playlists.data.lists, order: playlists.data.order },
    playlistHistory: playlists.history.data.lists,
    tracks,
    history: history.events,
    covers: images,
  };
}

export function backupSummary(b) {
  if (!b || b.app !== APP_NAME || b.kind !== 'backup') throw new Error('SyncMusic 백업 파일이 아니에요');
  return {
    createdAt: b.createdAt,
    playlists: Object.values(b.playlists?.lists || {}).filter((p) => !p.system).length,
    tracks: (b.tracks || []).length,
    history: (b.history || []).length,
    covers: Object.keys(b.covers || {}).length,
  };
}

// 되살리기: 지금 재생목록은 이력에 남긴 뒤 백업 것으로 바꾸고, 곡 값은 ID(없으면 파일 경로)로 찾아 덮는다.
// 재생 횟수는 많은 쪽, 마지막 재생은 늦은 쪽. 들은 기록은 합친다.
export async function restoreBackup(b, { settings, playlists, library, history, covers }) {
  backupSummary(b);
  const result = { settings: false, playlists: 0, tracks: 0, history: 0, covers: 0 };

  if (b.settings && typeof b.settings === 'object') {
    const patch = { ...b.settings };
    // 이 PC에 없는 폴더는 빼고
    if (Array.isArray(patch.musicFolders)) {
      patch.musicFolders = patch.musicFolders.filter((f) => typeof f === 'string' && fs.existsSync(f));
      if (!patch.musicFolders.length) delete patch.musicFolders;
    }
    delete patch.pcName;
    settings.update(patch);
    result.settings = true;
  }

  for (const [id, img] of Object.entries(b.covers || {})) {
    if (!/^[0-9a-f]{20}$/.test(id) || typeof img?.data !== 'string') continue;
    await covers.save(Buffer.from(img.data, 'base64'), img.format);
    result.covers++;
  }

  if (b.playlists?.lists && typeof b.playlists.lists === 'object') {
    for (const p of playlists.all()) playlists.snapshot(p, 'restore', { force: true });
    const lists = {};
    for (const [id, p] of Object.entries(b.playlists.lists)) {
      if (!/^[\w-]{1,40}$/.test(id) || !p || !Array.isArray(p.entries) || typeof p.name !== 'string') continue;
      lists[id] = { ...p, id, entries: p.entries.filter((x) => typeof x === 'string') };
    }
    if (!lists.favorites) lists.favorites = playlists.get('favorites');
    playlists.data.lists = lists;
    playlists.data.order = (Array.isArray(b.playlists.order) ? b.playlists.order : []).filter((id) => lists[id]);
    if (b.playlistHistory && typeof b.playlistHistory === 'object') {
      for (const [id, versions] of Object.entries(b.playlistHistory)) {
        if (!Array.isArray(versions) || playlists.history.data.lists[id]?.length) continue;
        playlists.history.data.lists[id] = versions.slice(-50);
      }
      playlists.history.save();
    }
    playlists.changed({ source: 'user' });
    result.playlists = Object.keys(lists).length;
  }

  const byPath = new Map(library.list().map((t) => [Library.key(t.path), t]));
  for (const u of Array.isArray(b.tracks) ? b.tracks : []) {
    const t = library.get(u.id) || (u.path ? byPath.get(Library.key(u.path)) : null);
    if (!t) continue;
    t.playCount = Math.max(t.playCount || 0, Number(u.playCount) || 0);
    t.lastPlayed = Math.max(t.lastPlayed || 0, Number(u.lastPlayed) || 0);
    if (u.addedAt) t.addedAt = Math.min(t.addedAt || Infinity, Number(u.addedAt) || Infinity);
    if (u.skips) t.skips = Math.max(t.skips || 0, Number(u.skips) || 0);
    if (Array.isArray(u.metaLog)) t.metaLog = u.metaLog.slice(-100);
    library.setUser(t.id, { userGain: u.userGain ?? 0, noShuffle: !!u.noShuffle, coverOverride: u.coverOverride ?? null, bookmarks: u.bookmarks || [], theme: u.theme || null });
    result.tracks++;
  }
  library.persist();

  if (Array.isArray(b.history)) {
    const seen = new Set(history.events.map((e) => `${e.id}|${e.s}`));
    const add = b.history.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.s) && Number.isFinite(e.l) && !seen.has(`${e.id}|${e.s}`));
    await history.replace([...history.events, ...add].sort((x, y) => x.s - y.s));
    result.history = add.length;
  }
  return result;
}
