import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORTS, defaultDataDir } from './config.js';
import { Covers } from './covers.js';
import { EventHub } from './events.js';
import { Library } from './library.js';
import { Playlists } from './playlists.js';
import { Settings } from './settings.js';
import { startDiscovery } from './sync/discovery.js';
import { createLanServer } from './sync/lanServer.js';
import { SyncService } from './sync/service.js';
import { createUiServer } from './uiServer.js';
import { JsonStore } from './util/jsonfile.js';

// 앱 전체 조립. 테스트에서는 dataDir·musicFolders·ports(0 = 빈 포트)를 바꿔서 여러 개를 띄운다.
export async function createApp(opts = {}) {
  const dataDir = path.resolve(opts.dataDir ?? defaultDataDir());
  fs.mkdirSync(dataDir, { recursive: true });
  const ports = { ...DEFAULT_PORTS, ...(opts.ports || {}) };
  // 테스트·데모에서는 127.0.0.1로 묶어서 Wi-Fi에 열지 않는다 (방화벽 창도 안 뜸)
  const lanHost = opts.lanHost || process.env.SYNCMUSIC_LAN_HOST || '0.0.0.0';

  const settings = new Settings(dataDir, opts.musicFolders);
  const covers = new Covers(dataDir);
  const library = new Library({ dataDir, getFolders: () => settings.data.musicFolders, covers });
  const playlists = new Playlists({ dataDir });
  const state = new JsonStore(path.join(dataDir, 'state.json'), {});
  const events = new EventHub();
  const sync = new SyncService({ dataDir, library, playlists, settings });

  library.on('remap', (oldId, newId) => playlists.remap(oldId, newId));
  library.on('changed', (info) => events.emit('library', info));
  library.on('progress', (s) => events.emit('scan', s));
  playlists.on('changed', (info) => events.emit('playlists', info));
  sync.on('pairing', (p) => events.emit('pairing', p));
  sync.on('devices', () => events.emit('devices', sync.devicesPublic()));
  sync.on('log', (e) => events.emit('synclog', e));
  sync.on('nowplaying', (np) => events.emit('nowplaying', np));

  const app = { dataDir, lanHost, ports: { ...ports }, settings, library, playlists, state, covers, events, sync, lanError: null };
  let uiServer = null;
  let lanServer = null;
  let discovery = null;
  let stopped = false;

  app.start = async () => {
    uiServer = createUiServer(app);
    await listen(uiServer, ports.ui, '127.0.0.1');
    app.ports.ui = uiServer.address().port;
    if (opts.lan !== false) {
      try {
        lanServer = createLanServer({ sync });
        await listen(lanServer, ports.sync, lanHost);
        app.ports.sync = lanServer.address().port;
        discovery = await startDiscovery({
          port: ports.discovery,
          host: lanHost,
          getInfo: () => ({ pcId: sync.pcId, pcName: sync.pcName, port: app.ports.sync, pairing: !!sync.pairingPublic() }),
          onError: (e) => {
            app.lanError = e.message;
          },
        });
        app.ports.discovery = discovery.port;
      } catch (e) {
        // 동기화만 못 하고 플레이어는 계속 쓸 수 있게
        app.lanError = e.message;
        console.error('동기화 서버를 열지 못했어요:', e.message);
      }
    }
    if (opts.scan !== false) {
      app.initialScan = library.scan();
      library.watch();
    }
    return app;
  };

  app.stop = async () => {
    if (stopped) return;
    stopped = true;
    library.unwatch();
    events.closeAll();
    await Promise.all([close(uiServer), close(lanServer), discovery?.close()]);
    await library.scanning;
    for (const s of [library, playlists, sync, settings, state]) s.flush();
  };

  app.quit =
    opts.onQuit ||
    (async () => {
      await app.stop();
      process.exit(0);
    });

  return app;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
