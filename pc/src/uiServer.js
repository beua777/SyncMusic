import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, APP_VERSION, AUDIO_TYPES } from './config.js';
import { matchItems, parsePlaylistFile, safeFileName, writeM3u } from './m3u.js';
import { readLyrics } from './tags.js';
import {
  createDesktopShortcut,
  getAutostart,
  pickFolder,
  revealInExplorer,
  setAutostart,
} from './system.js';
import { HttpError, readJson, sendError, sendFile, sendJson } from './util/http.js';

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

export const publicTrack = (t) => ({ ...t, dir: path.dirname(t.path) });

// 이 PC 안에서만 쓰는 화면용 서버 (127.0.0.1)
export function createUiServer(app) {
  const { library, playlists, settings, sync, events, covers, state } = app;
  const routes = [];
  const route = (method, pattern, handler) => routes.push([method, new RegExp(`^${pattern}$`), handler]);
  const trackOr404 = (id) => {
    const t = library.get(id);
    if (!t) throw new HttpError(404, '곡을 찾을 수 없어요');
    return t;
  };
  const ok = (res, obj = { ok: true }) => sendJson(res, 200, obj);

  route('GET', '/api/ping', (req, res) => ok(res, { app: APP_NAME, version: APP_VERSION }));

  route('GET', '/api/bootstrap', (req, res) =>
    ok(res, {
      app: { name: APP_NAME, version: APP_VERSION, dataDir: app.dataDir, host: os.hostname() },
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
  route('GET', `/api/tracks/${ID}/cover`, async (req, res, m) => {
    const c = await covers.get(trackOr404(m[1]));
    if (!c) {
      res.writeHead(404, { 'Cache-Control': 'max-age=300' });
      return res.end();
    }
    sendFile(req, res, c.file, c.format, { 'Cache-Control': 'max-age=86400' });
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
