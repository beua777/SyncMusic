import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, APP_VERSION, AUDIO_TYPES } from './config.js';
import { COVER_ID } from './covers.js';
import { backupSummary, makeBackup, restoreBackup } from './backup.js';
import { makeEvent, toCsv } from './history.js';
import { searchLrclib, saveLrc } from './lyrics.js';
import { matchItems, parsePlaylistFile, safeFileName, writeM3u } from './m3u.js';
import { forgotten, goalProgress, recentlyAdded, recommend, report, tasteShift, wrapped } from './stats.js';
import { lrcPathFor, readAllTags, readLyrics } from './tags.js';
import { restartLater } from './update.js';
import {
  createDesktopShortcut,
  getAutostart,
  pickFolder,
  powerAction,
  recycle,
  revealInExplorer,
  setAutostart,
} from './system.js';
import { HttpError, readBody, readJson, sendError, sendFile, sendJson } from './util/http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUBLIC = path.join(ROOT, 'public');
const FONT = path.join(ROOT, 'node_modules', 'pretendard', 'dist', 'web', 'variable', 'woff2', 'PretendardVariable.woff2');
const LAUNCHER = path.join(ROOT, 'launch.js');
const ICON = path.join(PUBLIC, 'icons', 'app.ico');
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};
const ID = '([0-9a-f]{32})';
const PL = '([\\w-]{1,40})';

// 화면에 보내는 곡: 직접 바꾼 커버가 있으면 그걸 커버로 (원래 커버는 coverOriginal)
export const publicTrack = (t) => ({ ...t, dir: path.dirname(t.path), cover: t.coverOverride || t.cover, ...(t.coverOverride ? { coverOriginal: t.cover || null } : {}) });

// 화면 파일이 바뀌었는지 알아보는 값. 열려 있던 창이 서버에 다시 붙을 때 다르면 새로 고친다
export function uiBuild(dir = PUBLIC) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        h.update(`${path.relative(dir, p)}|${st.size}|${Math.round(st.mtimeMs)}\n`);
      }
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}

// 이 PC 안에서만 쓰는 화면용 서버 (127.0.0.1)
export function createUiServer(app) {
  const { library, playlists, settings, sync, events, covers, state, history, errors, translator, lyricsIndex, audioDevices, updater } = app;
  const routes = [];
  const route = (method, pattern, handler) => routes.push([method, new RegExp(`^${pattern}$`), handler]);
  const trackOr404 = (id) => {
    const t = library.get(id);
    if (!t) throw new HttpError(404, '곡을 찾을 수 없어요');
    return t;
  };
  const ok = (res, obj = { ok: true }) => sendJson(res, 200, obj);
  const build = uiBuild();

  route('GET', '/api/ping', (req, res) => ok(res, { app: APP_NAME, version: APP_VERSION, build }));

  route('GET', '/api/bootstrap', (req, res) =>
    ok(res, {
      app: { name: APP_NAME, version: APP_VERSION, build, dataDir: app.dataDir, host: os.hostname() },
      tracks: library.list().map(publicTrack),
      playlists: playlists.all(),
      settings: settings.data,
      state: state.data,
      scan: library.status,
    }),
  );

  // ── 라이브러리 ──
  route('GET', '/api/library', (req, res) => ok(res, { tracks: library.list().map(publicTrack), scan: library.status }));
  route('POST', '/api/library/rescan', (req, res) => {
    library.scan();
    ok(res);
  });
  route('GET', `/api/tracks/${ID}/audio`, (req, res, m) => {
    const t = trackOr404(m[1]);
    sendFile(req, res, t.path, AUDIO_TYPES[path.extname(t.path).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  });
  // 커버 ID = 그림 내용의 해시라서 주소가 같으면 그림도 같다 (오래 캐시해도 됨)
  route('GET', `/api/covers/(${COVER_ID})`, (req, res, m) => {
    const c = covers.find(m[1]);
    if (!c) {
      res.writeHead(404, { 'Cache-Control': 'no-cache' });
      return res.end();
    }
    sendFile(req, res, c.file, c.format, { 'Cache-Control': 'max-age=31536000, immutable' });
  });
  route('GET', `/api/tracks/${ID}/cover`, (req, res, m) => {
    const t = trackOr404(m[1]);
    const c = t.cover ? covers.find(t.cover) : null;
    if (!c) {
      res.writeHead(404, { 'Cache-Control': 'no-cache' });
      return res.end();
    }
    sendFile(req, res, c.file, c.format, { 'Cache-Control': 'no-cache' });
  });
  route('GET', `/api/tracks/${ID}/lyrics`, async (req, res, m) => ok(res, await readLyrics(trackOr404(m[1]).path)));
  route('POST', `/api/tracks/${ID}/played`, (req, res, m) => {
    const t = library.markPlayed(m[1]);
    if (t) events.emit('track', publicTrack(t));
    ok(res);
  });
  route('POST', `/api/tracks/${ID}/duration`, async (req, res, m) => {
    const { duration } = await readJson(req, 4096);
    if (library.setDuration(m[1], Number(duration))) events.emit('track', publicTrack(library.get(m[1])));
    ok(res);
  });
  route('POST', `/api/tracks/${ID}/reveal`, (req, res, m) => {
    revealInExplorer(trackOr404(m[1]).path);
    ok(res);
  });

  // ── 재생목록 ──
  route('GET', '/api/playlists', (req, res) => ok(res, { playlists: playlists.all() }));
  route('POST', '/api/playlists', async (req, res) => {
    const body = await readJson(req);
    ok(res, playlists.create(body.name, Array.isArray(body.entries) ? body.entries : []));
  });
  route('POST', '/api/playlists/reorder', async (req, res) => {
    const { ids } = await readJson(req);
    playlists.reorderLists(Array.isArray(ids) ? ids : []);
    ok(res);
  });
  route('POST', '/api/playlists/import', async (req, res) => {
    const { fileName, text } = await readJson(req, 10 * 1024 * 1024);
    const parsed = parsePlaylistFile(String(text || ''), String(fileName || 'playlist.m3u'));
    const { ids, missing } = matchItems(parsed.items, library);
    if (!ids.length) throw new HttpError(422, '라이브러리에서 이 재생목록의 곡을 하나도 찾지 못했어요', { missing: missing.length });
    const p = playlists.create(parsed.name, ids);
    ok(res, { playlist: p, matched: ids.length, missing: missing.map((x) => [x.artist, x.title].filter(Boolean).join(' - ') || x.path).slice(0, 50) });
  });
  route('PUT', `/api/playlists/${PL}`, async (req, res, m) => {
    const p = playlists.update(m[1], await readJson(req));
    if (!p) throw new HttpError(404, '재생목록이 없어요');
    ok(res, p);
  });
  route('POST', `/api/playlists/${PL}/add`, async (req, res, m) => {
    const { ids, position } = await readJson(req);
    const p = playlists.addTracks(m[1], (Array.isArray(ids) ? ids : []).filter((x) => library.get(x)), Number.isInteger(position) ? position : null);
    if (!p) throw new HttpError(404, '재생목록이 없어요');
    ok(res, p);
  });
  route('DELETE', `/api/playlists/${PL}`, (req, res, m) => {
    if (!playlists.remove(m[1])) throw new HttpError(404, '지울 수 없는 재생목록이에요');
    ok(res);
  });
  route('GET', `/api/playlists/${PL}/export`, (req, res, m) => {
    const p = playlists.get(m[1]);
    if (!p) throw new HttpError(404, '재생목록이 없어요');
    const items = p.entries.map((id) => library.get(id)).filter(Boolean);
    const body = Buffer.from(writeM3u(items.map((t) => ({ path: t.path, duration: t.duration, artist: t.artist, title: t.title }))));
    const name = `${safeFileName(p.name)}.m3u`;
    res.writeHead(200, {
      'Content-Type': 'audio/x-mpegurl; charset=utf-8',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="playlist.m3u"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.end(body);
  });

  // ── 재생 상태 (대기열·섞인 순서·위치) ──
  route('GET', '/api/state', (req, res) => ok(res, state.data));
  const saveState = async (req, res) => {
    const body = await readJson(req, 4 * 1024 * 1024);
    state.data = { ...body, savedAt: Date.now() };
    state.save(1000);
    ok(res);
  };
  route('PUT', '/api/state', saveState);
  route('POST', '/api/state', saveState); // navigator.sendBeacon

  // ── 설정 ──
  route('GET', '/api/settings', (req, res) => ok(res, settings.data));
  route('PUT', '/api/settings', async (req, res) => {
    const { foldersChanged } = settings.update(await readJson(req));
    if (foldersChanged) {
      library.watch();
      library.scan();
    }
    events.emit('settings', settings.data);
    ok(res, settings.data);
  });

  // ── Windows ──
  route('POST', '/api/system/pick-folder', async (req, res) => ok(res, { path: await pickFolder(settings.data.musicFolders[0]) }));
  route('GET', '/api/system/autostart', (req, res) => ok(res, { enabled: getAutostart() }));
  route('PUT', '/api/system/autostart', async (req, res) => {
    const { enabled } = await readJson(req);
    ok(res, { enabled: await setAutostart(!!enabled, { launcher: LAUNCHER, icon: ICON }) });
  });
  route('POST', '/api/system/shortcut', async (req, res) => ok(res, { path: await createDesktopShortcut({ launcher: LAUNCHER, icon: ICON }) }));
  route('POST', '/api/system/quit', (req, res) => {
    ok(res);
    setTimeout(() => app.quit(), 150);
  });

  // ── 휴대폰 동기화 ──
  route('GET', '/api/sync/status', (req, res) => ok(res, syncStatus(app)));
  route('POST', '/api/sync/pairing', (req, res) => ok(res, sync.startPairing()));
  route('DELETE', '/api/sync/pairing', (req, res) => {
    sync.cancelPairing();
    ok(res);
  });
  route('PUT', `/api/sync/devices/${PL}`, async (req, res, m) => {
    const { options } = await readJson(req);
    ok(res, { options: sync.setDeviceOptions(m[1], options) });
  });
  route('DELETE', `/api/sync/devices/${PL}`, (req, res, m) => {
    sync.removeDevice(m[1]);
    ok(res);
  });
  route('POST', '/api/sync/handoff', (req, res) => ok(res, sync.handoff()));

  // ── 곡: 상세 정보 · 사용자 값(곡 음량·셔플 제외·커버·북마크·테마) · 분석 ──
  const trackChanged = (t) => t && events.emit('track', publicTrack(t));
  route('GET', `/api/tracks/${ID}/details`, async (req, res, m) => {
    const t = trackOr404(m[1]);
    let file = null;
    try {
      file = await readAllTags(t.path);
    } catch (e) {
      file = { error: e.message };
    }
    const evs = history.events.filter((e) => e.id === t.id);
    const st = await fs.promises.stat(t.path).catch(() => null);
    ok(res, {
      track: publicTrack(t),
      file,
      exists: !!st,
      fileSize: st?.size ?? null,
      modified: st?.mtimeMs ?? null,
      lrc: fs.existsSync(lrcPathFor(t.path)),
      listening: { sessions: evs.length, minutes: Math.round(evs.reduce((n, e) => n + e.l, 0) / 60), skips: evs.filter((e) => e.k).length, first: evs[0]?.s ?? null, last: evs.at(-1)?.s ?? null },
    });
  });
  route('PUT', `/api/tracks/${ID}/user`, async (req, res, m) => {
    const t = library.setUser(trackOr404(m[1]).id, await readJson(req, 64 * 1024));
    trackChanged(t);
    ok(res, publicTrack(t));
  });
  // 여러 곡을 한 번에 (앨범 커버 바꾸기 등)
  route('PUT', '/api/tracks/user', async (req, res) => {
    const { ids, patch } = await readJson(req, 512 * 1024);
    let n = 0;
    for (const id of Array.isArray(ids) ? ids.slice(0, 5000) : []) {
      const t = library.setUser(id, patch || {});
      if (t) n++;
    }
    events.emit('library', { changed: n });
    ok(res, { changed: n });
  });
  route('PUT', `/api/tracks/${ID}/analysis`, async (req, res, m) => {
    const t = library.setAnalysis(trackOr404(m[1]).id, await readJson(req, 64 * 1024));
    trackChanged(t);
    ok(res);
  });
  // 커버 그림 올리기 (그림 파일 그대로) → 커버 ID
  route('POST', '/api/covers', async (req, res) => {
    const buf = await readBody(req, 15 * 1024 * 1024);
    if (buf.length < 64) throw new HttpError(400, '그림이 비어 있어요');
    const isImage = (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50) || buf.toString('latin1', 8, 12) === 'WEBP' || buf.toString('latin1', 0, 3) === 'GIF';
    if (!isImage) throw new HttpError(415, 'JPG·PNG·WEBP·GIF 그림만 쓸 수 있어요');
    ok(res, { id: await covers.save(buf, String(req.headers['content-type'] || '')) });
  });

  // ── 가사: 원문(편집용) · 저장 · 온라인에서 찾기 · 번역 · 가사로 곡 찾기 ──
  route('GET', `/api/tracks/${ID}/lyrics/raw`, async (req, res, m) => {
    const t = trackOr404(m[1]);
    let text = '';
    try {
      text = await fs.promises.readFile(lrcPathFor(t.path), 'utf8');
    } catch {
      text = (await readLyrics(t.path)).text || '';
    }
    ok(res, { text });
  });
  route('PUT', `/api/tracks/${ID}/lyrics`, async (req, res, m) => {
    const t = trackOr404(m[1]);
    const { text } = await readJson(req, 512 * 1024);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, '가사가 비어 있어요');
    await saveLrc(app.dataDir, t, text);
    if (!t.hasLyrics) t.hasLyrics = true;
    library.logMeta(t, '가사', null, '저장함', '앱');
    library.persist();
    trackChanged(t);
    ok(res);
  });
  route('GET', `/api/tracks/${ID}/lyrics/online`, async (req, res, m, url) => {
    if (settings.data.lyrics?.online === false) throw new HttpError(403, '설정에서 온라인 가사 찾기가 꺼져 있어요');
    const t = trackOr404(m[1]);
    const query = url.searchParams.get('q') || '';
    try {
      ok(res, { results: await searchLrclib({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, query }) });
    } catch (e) {
      errors.add({ source: 'lyrics', message: `온라인 가사 찾기 실패: ${e.message}`, context: { title: t.title } });
      throw new HttpError(502, '가사 서버(LRCLIB)에 연결하지 못했어요');
    }
  });
  route('POST', '/api/lyrics/translate', async (req, res) => {
    if (settings.data.lyrics?.translate === false) throw new HttpError(403, '설정에서 자동 번역이 꺼져 있어요');
    const { lines } = await readJson(req, 512 * 1024);
    if (!Array.isArray(lines) || lines.length > 600) throw new HttpError(400, '가사 줄이 잘못됐어요');
    try {
      ok(res, await translator.translate(lines.map((x) => String(x ?? '').slice(0, 500))));
    } catch (e) {
      errors.add({ source: 'lyrics', message: `가사 번역 실패: ${e.message}` });
      throw new HttpError(502, '번역 서버에 연결하지 못했어요');
    }
  });
  route('GET', '/api/search/lyrics', async (req, res, m, url) => ok(res, { results: await lyricsIndex.search(url.searchParams.get('q') || '') }));

  // ── 들은 기록 · 통계 ──
  route('POST', '/api/history', async (req, res) => {
    const body = await readJson(req, 8 * 1024);
    const t = library.get(String(body.id || ''));
    const e = makeEvent(body, t);
    if (!e) return ok(res, { saved: false });
    history.add(e);
    if (e.k) trackChanged(library.addSkip(t.id));
    return ok(res, { saved: true });
  });
  route('GET', '/api/stats/overview', (req, res) => {
    const evs = history.events;
    const tracks = library.list();
    const favs = new Set(playlists.get('favorites')?.entries || []);
    const now = Date.now();
    ok(res, {
      total: evs.length,
      since: evs[0]?.s ?? null,
      week: report(evs, 'week', now),
      month: report(evs, 'month', now),
      year: report(evs, 'year', now),
      all: report(evs, 'all', now),
      goals: goalProgress(evs, settings.data.goals, now),
      forgotten: forgotten(tracks, now),
      recentlyAdded: recentlyAdded(tracks, now),
      recommend: recommend(tracks, evs, favs, now),
      taste: tasteShift(evs, now),
      years: [...new Set(evs.map((e) => new Date(e.s).getFullYear()))].sort(),
    });
  });
  route('GET', '/api/stats/wrapped', (req, res, m, url) => {
    const evs = history.events;
    const years = [...new Set(evs.map((e) => new Date(e.s).getFullYear()))].sort();
    ok(res, { ...wrapped(evs, Number(url.searchParams.get('year')) || new Date().getFullYear()), years });
  });
  route('GET', '/api/stats/export', (req, res, m, url) => {
    const csv = url.searchParams.get('format') === 'csv';
    const body = Buffer.from(csv ? toCsv(history.events) : JSON.stringify({ app: 'SyncMusic', kind: 'listening-history', exportedAt: Date.now(), events: history.events }, null, 1));
    const name = `SyncMusic-들은기록-${new Date().toISOString().slice(0, 10)}.${csv ? 'csv' : 'json'}`;
    res.writeHead(200, {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="history.${csv ? 'csv' : 'json'}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.end(body);
  });

  // ── 재생목록 이력 · 지운 재생목록 ──
  route('GET', `/api/playlists/${PL}/history`, (req, res, m) => ok(res, { versions: playlists.versions(m[1]) }));
  route('POST', `/api/playlists/${PL}/restore`, async (req, res, m) => {
    const p = playlists.restore(m[1], (await readJson(req)).at);
    if (!p) throw new HttpError(404, '그 버전을 찾을 수 없어요');
    ok(res, p);
  });
  route('GET', '/api/playlist-trash', (req, res) => ok(res, { lists: playlists.deletedLists() }));
  route('POST', `/api/playlist-trash/${PL}/restore`, (req, res, m) => {
    const p = playlists.undelete(m[1]);
    if (!p) throw new HttpError(404, '되살릴 수 없어요');
    ok(res, p);
  });

  // ── 라이브러리 도구: 점검 · 중복 · 변경 기록 · 휴지통으로 ──
  route('GET', '/api/library/check', (req, res) => {
    const r = library.check(playlists);
    r.playErrors = errors.list().filter((e) => e.source === 'play').slice(0, 50);
    ok(res, r);
  });
  route('GET', '/api/library/duplicates', (req, res) => ok(res, { groups: library.duplicates() }));
  route('GET', '/api/library/changes', (req, res) => ok(res, { scans: library.changeLog() }));
  route('POST', '/api/library/clean-playlists', (req, res) => {
    let removed = 0;
    for (const p of playlists.all()) {
      const keep = p.entries.filter((x) => library.get(x));
      if (keep.length === p.entries.length) continue;
      removed += p.entries.length - keep.length;
      playlists.update(p.id, { entries: keep });
    }
    ok(res, { removed });
  });
  // 중복 곡 정리: 고른 곡의 파일을 휴지통으로 보내고, 재생목록에서는 남기는 곡으로 바꿔 준다
  // 여러 묶음을 한 번에: { groups: [{ ids, keep }] } (예전 모양 { ids, keep }도 받음)
  route('POST', '/api/library/recycle', async (req, res) => {
    const body = await readJson(req);
    const groups = Array.isArray(body.groups) ? body.groups.slice(0, 2000) : [{ ids: body.ids, keep: body.keep }];
    const files = [];
    const remaps = [];
    for (const g of groups) {
      const keepT = g?.keep ? library.get(g.keep) : null;
      for (const id of Array.isArray(g?.ids) ? g.ids.slice(0, 500) : []) {
        const t = library.get(id);
        if (!t || id === g.keep) continue;
        files.push(t.path, ...(t.altPaths || []));
        if (keepT) remaps.push([id, keepT.id]);
      }
    }
    const n = files.length ? await recycle(files) : 0;
    for (const [from, to] of remaps) playlists.remap(from, to);
    library.scan();
    ok(res, { recycled: n });
  });

  // ── 오류 기록 ──
  route('GET', '/api/errors', (req, res) => ok(res, { items: errors.list() }));
  route('DELETE', '/api/errors', (req, res) => {
    errors.clear();
    ok(res);
  });
  route('POST', '/api/errors', async (req, res) => {
    const b = await readJson(req, 16 * 1024);
    errors.add({ source: ['play', 'ui', 'lyrics', 'sync', 'network'].includes(b.source) ? b.source : 'ui', message: b.message, detail: b.detail, context: b.context });
    ok(res);
  });

  // ── 출력 장치 · 전원 · 업데이트 · 백업 ──
  route('GET', '/api/system/audiodevice', (req, res) => ok(res, { current: audioDevices.info(), devices: audioDevices.devices }));
  route('POST', '/api/system/power', async (req, res) => {
    const { action } = await readJson(req);
    if (!['sleep', 'shutdown'].includes(action)) throw new HttpError(400, '모르는 동작');
    ok(res);
    setTimeout(() => powerAction(action).catch((e) => errors.add({ source: 'server', message: `전원 동작 실패: ${e.message}` })), 300);
  });
  route('GET', '/api/system/update', (req, res) => ok(res, updater.status));
  route('POST', '/api/system/update/check', async (req, res) => {
    try {
      ok(res, await updater.check());
    } catch (e) {
      throw new HttpError(502, `업데이트를 확인하지 못했어요: ${e.message}`);
    }
  });
  route('POST', '/api/system/update/apply', async (req, res) => {
    let r;
    try {
      r = await updater.apply();
    } catch (e) {
      throw new HttpError(409, e.message);
    }
    ok(res, r);
    restartLater(LAUNCHER);
    setTimeout(() => app.quit(), 400);
  });
  route('GET', '/api/backup', (req, res) => {
    const body = Buffer.from(JSON.stringify(makeBackup(app)));
    const name = `SyncMusic-백업-${new Date().toISOString().slice(0, 10)}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="syncmusic-backup.json"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.end(body);
  });
  route('POST', '/api/backup/inspect', async (req, res) => {
    try {
      ok(res, backupSummary(await readJson(req, 200 * 1024 * 1024)));
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  });
  route('POST', '/api/backup/restore', async (req, res) => {
    const b = await readJson(req, 200 * 1024 * 1024);
    let r;
    try {
      r = await restoreBackup(b, app);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    events.emit('settings', settings.data);
    events.emit('library', {});
    ok(res, r);
  });

  // ── 동기화 미리 보기 · 허락 ──
  route('GET', `/api/sync/devices/${PL}/preview`, async (req, res, m) => ok(res, { preview: await sync.preview(m[1]) }));
  route('POST', `/api/sync/devices/${PL}/approve`, (req, res, m) => ok(res, sync.approve(m[1])));

  route('GET', '/api/events', (req, res) => events.handle(req, res));

  const server = http.createServer(async (req, res) => {
    try {
      // 이 PC에서 연 우리 화면만 허용 (DNS 리바인딩·다른 사이트의 요청 차단)
      const port = server.address().port;
      const host = String(req.headers.host || '');
      const self = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!self.includes(host)) throw new HttpError(403, '허용되지 않은 주소예요');
      const origin = req.headers.origin;
      if (origin && !self.some((h) => origin === `http://${h}`)) throw new HttpError(403, '허용되지 않은 출처예요');
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        const site = req.headers['sec-fetch-site'];
        if (site === 'cross-site' || site === 'same-site') throw new HttpError(403, '허용되지 않은 요청이에요');
        for (const [method, re, handler] of routes) {
          if (method !== req.method && !(method === 'GET' && req.method === 'HEAD')) continue;
          const m = re.exec(url.pathname);
          if (m) return await handler(req, res, m, url);
        }
        throw new HttpError(404, '없는 API예요');
      }
      serveStatic(req, res, url.pathname);
    } catch (e) {
      sendError(res, e);
    }
  });
  return server;
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '허용되지 않은 방법');
  if (pathname === '/fonts/PretendardVariable.woff2') {
    return sendFile(req, res, FONT, 'font/woff2', { 'Cache-Control': 'max-age=31536000, immutable' });
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, '잘못된 주소');
  }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.resolve(PUBLIC, `.${rel}`);
  if (!file.startsWith(PUBLIC + path.sep)) throw new HttpError(403, '허용되지 않은 경로');
  sendFile(req, res, file, STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
}

export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
    }
  }
  // Wi-Fi/이더넷을 앞으로, 가상 어댑터(vEthernet, VMware 등)는 뒤로
  const score = (n) => (/wi-?fi|wlan|무선/i.test(n) ? 0 : /ethernet|이더넷/i.test(n) && !/vethernet/i.test(n) ? 1 : 2);
  return out.sort((a, b) => score(a.name) - score(b.name));
}

export function syncStatus(app) {
  const { sync } = app;
  return {
    pcId: sync.pcId,
    pcName: sync.pcName,
    addresses: lanAddresses(),
    port: app.ports.sync,
    discoveryPort: app.ports.discovery,
    lanError: app.lanError,
    pairing: sync.pairingPublic(),
    devices: sync.devicesPublic(),
    log: sync.store.data.log.slice(-60),
    nowPlaying: sync.nowPlaying,
  };
}
