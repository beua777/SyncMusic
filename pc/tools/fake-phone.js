// 가짜 폰: 안드로이드 동반 앱(SyncEngine.kt)과 같은 순서로 동기화를 흉내 낸다.
// 테스트(test/sync.e2e.test.js)와 프로토콜 설계 확인용. 폰의 파일·삼성 뮤직 백업 폴더는 메모리에 둔다.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { parsePlaylistFile, writeM3u, writeSmpl } from '../src/m3u.js';
import { quickHashBuffer } from '../src/quickhash.js';
import { deriveSecret, pairProof, safeEqual, sha256hex, signRequest, signResponse } from '../src/sync/crypto.js';

export const STORAGE = '/storage/emulated/0';

export class FakePhone {
  constructor({ deviceId = `phone-${crypto.randomBytes(6).toString('hex')}`, name = 'Galaxy 테스트폰' } = {}) {
    this.deviceId = deviceId;
    this.name = name;
    this.files = new Map(); // 절대 경로 → { data, qh, title, artist, album, duration }
    this.playlistFiles = new Map(); // 삼성 뮤직 백업 폴더의 파일 이름 → { text, mtime }
    this.written = new Map(); // 우리가 쓴 파일 이름 → 쓴 내용의 sha256 (그대로면 'ours')
    this.downloadDir = `${STORAGE}/Music/SyncMusic`;
    this.pc = null;
    this.secret = null;
  }

  addTrack(path, data, meta = {}) {
    this.files.set(path, { data, qh: quickHashBuffer(data), duration: 0, ...meta });
  }

  pathOfQh(qh) {
    for (const [p, f] of this.files) if (f.qh === qh) return p;
    return null;
  }

  // ───── PC 찾기 (UDP) ─────
  discover({ host = '255.255.255.255', port, timeout = 1500 }) {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error('PC를 찾지 못했어요'));
      }, timeout);
      sock.on('message', (msg, rinfo) => {
        let m;
        try {
          m = JSON.parse(msg.toString('utf8'));
        } catch {
          return;
        }
        if (m.t !== 'here') return;
        clearTimeout(timer);
        sock.close();
        this.pc = { host: rinfo.address, port: m.port, pcId: m.pcId, pcName: m.pcName };
        resolve(this.pc);
      });
      sock.bind(0, () => {
        sock.setBroadcast(true);
        sock.send(Buffer.from(JSON.stringify({ t: 'discover', app: 'SyncMusic', v: 1, deviceId: this.deviceId })), port, host);
      });
    });
  }

  url(p) {
    return `http://${this.pc.host}:${this.pc.port}${p}`;
  }

  // ───── 페어링 (ECDH P-256 + 6자리 코드) ─────
  async pair(code) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const phonePub = ecdh.getPublicKey().toString('base64');
    const res = await fetch(this.url('/sync/pair'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: this.deviceId, deviceName: this.name, phonePub, proof: pairProof(code, 'pair1', this.deviceId, phonePub) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error}`);
    if (!safeEqual(pairProof(code, 'pair1-ok', body.pcId, body.pcPub, phonePub), body.proof)) throw new Error('PC 증명이 맞지 않아요');
    this.secret = deriveSecret(ecdh.computeSecret(Buffer.from(body.pcPub, 'base64')), code, this.deviceId, body.pcId);
    this.pc = { ...this.pc, pcId: body.pcId, pcName: body.pcName };
    return body;
  }

  // ───── 서명한 요청 ─────
  async call(method, path, { json, body, headers = {}, time = Date.now(), tamper = false } = {}) {
    const buf = json !== undefined ? Buffer.from(JSON.stringify(json)) : (body ?? Buffer.alloc(0));
    const bodyHash = sha256hex(buf);
    const sig = signRequest(this.secret, method, path, time, bodyHash);
    const res = await fetch(this.url(path), {
      method,
      body: method === 'GET' ? undefined : tamper ? Buffer.concat([buf, Buffer.from(' ')]) : buf,
      headers: {
        'Content-Type': json !== undefined ? 'application/json' : 'application/octet-stream',
        'X-SM-Device': this.deviceId,
        'X-SM-Time': String(time),
        'X-SM-Body': bodyHash,
        'X-SM-Sig': sig,
        ...headers,
      },
    });
    const out = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${out.toString('utf8')}`), { status: res.status });
    if (!res.headers.get('content-type')?.includes('json')) return out;
    // 가짜 PC가 아닌지: 응답 서명 확인
    const h = sha256hex(out);
    if (res.headers.get('x-sm-body') !== h || !safeEqual(signResponse(this.secret, sig, h), res.headers.get('x-sm-sig') || '')) {
      throw new Error('PC 응답 서명이 맞지 않아요');
    }
    return JSON.parse(out.toString('utf8'));
  }

  // ───── 매니페스트: 폰의 곡 목록 + 삼성 뮤직 백업 폴더의 재생목록 ─────
  buildManifest() {
    const byPath = new Map([...this.files].map(([p, f]) => [p.toLowerCase(), f.qh]));
    const byName = new Map([...this.files].map(([p, f]) => [p.split('/').pop().toLowerCase(), f.qh]));
    const resolve = (p) => byPath.get(p.toLowerCase()) || byName.get(p.split(/[\\/]/).pop().toLowerCase()) || null;
    const playlists = [];
    for (const [file, pf] of this.playlistFiles) {
      const key = file.replace(/\.[^.]+$/, '');
      if (this.written.get(file) === sha256hex(Buffer.from(pf.text))) {
        playlists.push({ key, name: key, file, state: 'ours', mtime: pf.mtime });
        continue;
      }
      const parsed = parsePlaylistFile(pf.text, file);
      const entries = [];
      let unresolved = 0;
      for (const it of parsed.items) {
        const qh = resolve(it.path);
        if (qh) entries.push(qh);
        else unresolved++;
      }
      playlists.push({ key, name: parsed.name || key, file, state: 'samsung', entries, unresolved, mtime: pf.mtime });
    }
    return {
      deviceId: this.deviceId,
      deviceName: this.name,
      playlistsEnabled: true,
      tracks: [...this.files].map(([path, f]) => ({ qh: f.qh, size: f.data.length, path, title: f.title, artist: f.artist, album: f.album, duration: f.duration })),
      playlists,
    };
  }

  // ───── 동기화 한 번 (docs/PLAN.md 6.5) ─────
  async sync() {
    // 삼성 뮤직이 .smpl로 백업하는 폰이면 새로 쓰는 재생목록도 .smpl로
    const usesSmpl = [...this.playlistFiles.keys()].some((f) => /\.smpl$/i.test(f));
    const plan = await this.call('POST', '/sync/manifest', { json: this.buildManifest() });
    let uploaded = 0;
    let downloaded = 0;
    const errors = [];
    const written = [];
    for (const qh of plan.upload) {
      const path = this.pathOfQh(qh);
      await this.call('PUT', `/sync/file/${qh}`, { body: this.files.get(path).data, headers: { 'X-SM-Path': encodeURIComponent(path) } });
      uploaded++;
    }
    for (const d of plan.download) {
      const data = await this.call('GET', `/sync/file/${d.id}`);
      if (quickHashBuffer(data) !== d.id) {
        errors.push(`${d.name}: 받은 파일이 손상됐어요`);
        continue;
      }
      const path = `${this.downloadDir}/${d.relDir ? `${d.relDir}/` : ''}${d.name}`;
      this.files.set(path, { data, qh: d.id, title: d.title, artist: d.artist, album: d.album, duration: d.duration });
      downloaded++;
    }
    for (const p of plan.playlists) {
      let file = p.file || `${p.key}.m3u`;
      if (p.action !== 'delete' && !this.playlistFiles.has(file) && usesSmpl && !/\.smpl$/i.test(file)) {
        file = `${file.replace(/\.[^.]+$/, '')}.smpl`;
      }
      if (p.action === 'delete') {
        const cur = this.playlistFiles.get(file);
        if (cur && this.written.get(file) === sha256hex(Buffer.from(cur.text))) this.playlistFiles.delete(file);
        this.written.delete(file);
        continue;
      }
      const items = [];
      const entries = [];
      for (const qh of p.entries) {
        const path = this.pathOfQh(qh);
        if (!path) continue; // 폰에 없는 곡은 빼고 쓴다 (실제로 쓴 내용을 commit으로 알려 줌)
        const f = this.files.get(path);
        items.push({ path, duration: f.duration, artist: f.artist, title: f.title });
        entries.push(qh);
      }
      let text;
      if (/\.smpl$/i.test(file)) {
        let template = null;
        try {
          template = JSON.parse(this.playlistFiles.get(file)?.text || 'null');
        } catch {
          // 깨진 파일이면 기본값으로
        }
        text = writeSmpl(p.name || p.key, items, template);
      } else {
        text = writeM3u(items);
      }
      this.playlistFiles.set(file, { text, mtime: Date.now() });
      this.written.set(file, sha256hex(Buffer.from(text)));
      written.push({ key: p.key, file, entries });
    }
    await this.call('POST', '/sync/commit', { json: { syncId: plan.syncId, uploaded, downloaded, written, errors } });
    return { plan, uploaded, downloaded, written, errors };
  }

  // 삼성 뮤직 흉내: '자동 백업'이 재생목록 파일을 다시 쓴다 (우리 형식과 다르게 CRLF, #EXTINF 없음)
  samsungWrite(file, paths, { mtime = Date.now() } = {}) {
    this.playlistFiles.set(file, { text: `#EXTM3U\r\n${paths.join('\r\n')}\r\n`, mtime });
  }

  // 삼성 뮤직 흉내 (.smpl 백업 기기): 실제 S26 파일처럼 members는 order 큰 곡부터, order는 0부터
  samsungWriteSmpl(file, paths, { mtime = Date.now(), name = file.replace(/\.[^.]+$/, '') } = {}) {
    const members = paths
      .map((p, i) => ({ artist: this.files.get(p)?.artist || '<unknown>', info: p, order: i, title: this.files.get(p)?.title || p, type: 65537 }))
      .reverse();
    const text = JSON.stringify({ members, name, recentlyPlayedDate: 1791370269, sortBy: 4, version: 1 }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    this.playlistFiles.set(file, { text, mtime });
  }

  readPlaylistPaths(file) {
    const pf = this.playlistFiles.get(file);
    return pf ? parsePlaylistFile(pf.text, file).items.map((i) => i.path) : null;
  }

  readPlaylistTitles(file) {
    return this.readPlaylistPaths(file)?.map((p) => this.files.get(p)?.title ?? `?${p}`);
  }

  sendNowPlaying(info) {
    return this.call('POST', '/sync/nowplaying', { json: info });
  }
}
