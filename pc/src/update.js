import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// 앱 업데이트 알림: 이 PC의 코드(git)가 GitHub 저장소보다 뒤처져 있으면 알려 주고, 누르면 받아서 다시 켠다.
// 이 PC에서 직접 고친 파일이 있으면 자동으로는 받지 않는다 (덮어쓰지 않게).
const run = (cmd, args, cwd, timeout = 120_000) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, windowsHide: true, timeout, maxBuffer: 4 << 20 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(String(out).trim()))),
  );

export class Updater extends EventEmitter {
  constructor({ root, enabled = () => true }) {
    super();
    this.root = root; // 저장소 맨 위 (pc 폴더의 부모)
    this.enabled = enabled;
    this.status = { supported: fs.existsSync(path.join(root, '.git')), available: false, checkedAt: null };
    this.timer = null;
  }

  start() {
    if (!this.status.supported) return;
    const tick = () => this.enabled() && this.check().catch(() => {});
    setTimeout(tick, 30_000).unref?.();
    this.timer = setInterval(tick, 6 * 3600_000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  async repo() {
    const url = await run('git', ['remote', 'get-url', 'origin'], this.root);
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
    if (!m) throw new Error('GitHub 저장소가 아니에요');
    return { owner: m[1], name: m[2] };
  }

  async check() {
    if (!this.status.supported) return this.status;
    const [local, branch, dirty, repo] = await Promise.all([
      run('git', ['rev-parse', 'HEAD'], this.root),
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], this.root),
      run('git', ['status', '--porcelain', '--untracked-files=no'], this.root),
      this.repo(),
    ]);
    const api = `https://api.github.com/repos/${repo.owner}/${repo.name}`;
    const headers = { 'User-Agent': 'SyncMusic', Accept: 'application/vnd.github+json' };
    const res = await fetch(`${api}/compare/${local}...${encodeURIComponent(branch)}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub 응답 ${res.status}`);
    const cmp = await res.json();
    const prevAvailable = this.status.available;
    this.status = {
      supported: true,
      checkedAt: Date.now(),
      local: local.slice(0, 7),
      remote: cmp.commits?.at(-1)?.sha?.slice(0, 7) || local.slice(0, 7),
      available: cmp.status === 'ahead' && cmp.ahead_by > 0,
      count: cmp.ahead_by || 0,
      messages: (cmp.commits || []).slice(-10).reverse().map((c) => ({ title: String(c.commit?.message || '').split('\n')[0].slice(0, 120), date: c.commit?.author?.date })),
      dirty: !!dirty,
      branch,
      url: `https://github.com/${repo.owner}/${repo.name}`,
    };
    if (this.status.available && !prevAvailable) this.emit('available', this.status);
    return this.status;
  }

  // 받아서(git pull --ff-only) 필요하면 npm install. 다시 켜는 건 부르는 쪽(restart)
  async apply() {
    const st = await this.check();
    if (!st.available) throw new Error('이미 최신 버전이에요');
    if (st.dirty) throw new Error('이 PC에서 고친 파일이 있어서 자동으로 받을 수 없어요. GitHub에서 직접 받아 주세요');
    const pc = path.join(this.root, 'pc');
    const before = await run('git', ['rev-parse', 'HEAD'], this.root);
    await run('git', ['pull', '--ff-only'], this.root);
    const changed = await run('git', ['diff', '--name-only', before, 'HEAD'], this.root);
    if (/^pc\/package(-lock)?\.json$/m.test(changed)) {
      await run('cmd.exe', ['/d', '/s', '/c', 'npm install --omit=dev --no-audit --no-fund'], pc, 10 * 60_000);
    }
    return { updated: true, files: changed.split('\n').filter(Boolean).length };
  }
}

// 서버를 다시 켜기: 1.5초 뒤에 launch.js --background를 실행하는 작은 프로세스를 띄우고, 지금 서버는 끈다
export function restartLater(launcher) {
  const code = `setTimeout(() => require('child_process').spawn(process.execPath, [${JSON.stringify(launcher)}, '--background'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(), 1500)`;
  spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
