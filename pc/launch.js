// SyncMusic 실행기
//   node launch.js               서버가 꺼져 있으면 백그라운드로 켜고, Edge 앱 창을 연다
//   node launch.js --background  서버만 켠다 (로그인 시 자동 실행용)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORTS, defaultDataDir } from './src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = `http://127.0.0.1:${DEFAULT_PORTS.ui}/`;
const background = process.argv.includes('--background');

const ping = () =>
  fetch(`${url}api/ping`, { signal: AbortSignal.timeout(800) })
    .then((r) => r.ok)
    .catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await ping())) {
  const dataDir = defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  const child = spawn(process.execPath, [path.join(here, 'src', 'server.js')], {
    cwd: here,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  let up = false;
  for (let i = 0; i < 60 && !(up = await ping()); i++) await sleep(250);
  if (!up) {
    console.error(`서버가 켜지지 않았어요. 로그: ${path.join(dataDir, 'server.log')}`);
    process.exit(1);
  }
}

if (!background) openWindow(url);

function openWindow(target) {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const edge = candidates.find((p) => fs.existsSync(p));
  if (edge) {
    // 주소창 없는 앱 창 (설치하고 싶으면 창 메뉴의 "앱 설치")
    spawn(edge, [`--app=${target}`, '--window-size=1280,860'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}
