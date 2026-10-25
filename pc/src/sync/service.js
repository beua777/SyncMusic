import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AUDIO_TYPES, PHONE_FOLDER_NAME } from '../config.js';
import { isQh, quickHash } from '../quickhash.js';
import { safeFileName } from '../m3u.js';
import { normName } from '../playlists.js';
import { HttpError } from '../util/http.js';
import { JsonStore } from '../util/jsonfile.js';
import * as sc from './crypto.js';
import { merge3, sameList } from './merge.js';

const PAIR_TTL = 3 * 60_000;
const MAX_PAIR_ATTEMPTS = 5;
const CLOCK_SKEW = 5 * 60_000;
const COPY_MODES = ['playlists', 'all', 'none'];
// 기본은 양쪽 다 '재생목록에 든 곡만' 옮긴다
export const DEFAULT_DEVICE_OPTIONS = { phoneToPc: 'playlists', pcToPhone: 'playlists' };

export function deviceOptions(raw = {}) {
  const o = { ...DEFAULT_DEVICE_OPTIONS };
  // 0.1의 true/false: true(폰 음악 전부)는 새 기본값(재생목록 곡만)으로, false는 '가져오지 않음'으로
  if (typeof raw.phoneToPc === 'boolean') o.phoneToPc = raw.phoneToPc ? 'playlists' : 'none';
  else if (COPY_MODES.includes(raw.phoneToPc)) o.phoneToPc = raw.phoneToPc;
  if (COPY_MODES.includes(raw.pcToPhone)) o.pcToPhone = raw.pcToPhone;
  return o;
}

// 폰과의 동기화 전체를 맡는다: 페어링, 요청 인증, 동기화 계획, 파일 받기, 결과 반영, 이어듣기
export class SyncService extends EventEmitter {
  constructor({ dataDir, library, playlists, settings }) {
    super();
    this.library = library;
    this.playlists = playlists;
    this.settings = settings;
    this.store = new JsonStore(path.join(dataDir, 'sync.json'), { pcId: null, devices: {}, log: [] });
    if (!this.store.data.pcId) {
      this.store.data.pcId = crypto.randomUUID();
      this.store.saveNow();
    }
    this.pairing = null;
    this.sessions = new Map();
    this.nowPlaying = null;
    this.tmpDir = path.join(dataDir, 'tmp');
    fs.mkdirSync(this.tmpDir, { recursive: true });
    for (const f of fs.readdirSync(this.tmpDir)) {
      try {
        fs.unlinkSync(path.join(this.tmpDir, f)); // 지난번에 끊긴 업로드 조각
      } catch {
        // 무시
      }
    }
  }

  get pcId() {
    return this.store.data.pcId;
  }

  get pcName() {
    return this.settings.data.pcName || os.hostname();
  }

  get devices() {
    return this.store.data.devices;
  }

  // ───────── 페어링 ─────────

  startPairing() {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.pairing = { code, expiresAt: Date.now() + PAIR_TTL, attempts: 0 };
    this.emit('pairing', this.pairingPublic());
    return this.pairingPublic();
  }

  cancelPairing() {
    this.pairing = null;
    this.emit('pairing', null);
  }

  pairingPublic() {
    const p = this.pairing;
    if (!p || p.expiresAt < Date.now()) return null;
    return { code: p.code, expiresAt: p.expiresAt };
  }

  pair({ deviceId, deviceName, phonePub, proof } = {}) {
    const p = this.pairing;
    if (!p || p.expiresAt < Date.now()) throw new HttpError(403, 'PC 설정에서 "새 휴대폰 연결"을 먼저 눌러 주세요');
    if (typeof deviceId !== 'string' || !/^[\w-]{8,64}$/.test(deviceId)) throw new HttpError(400, 'deviceId 형식 오류');
    const phoneKey = Buffer.from(String(phonePub || ''), 'base64');
    if (phoneKey.length !== 65 || phoneKey[0] !== 4) throw new HttpError(400, '공개키 형식 오류');

    const expected = sc.pairProof(p.code, 'pair1', deviceId, phonePub);
    if (!sc.safeEqual(expected, String(proof || ''))) {
      p.attempts++;
      if (p.attempts >= MAX_PAIR_ATTEMPTS) {
        this.cancelPairing();
        this.log('warn', '페어링 코드가 5번 틀려서 코드를 취소했어요');
      }
      throw new HttpError(403, '코드가 맞지 않아요');
    }

    const ecdh = sc.newEcdh();
    let shared;
    try {
      shared = ecdh.computeSecret(phoneKey);
    } catch {
      throw new HttpError(400, '공개키가 올바르지 않아요');
    }
    const secret = sc.deriveSecret(shared, p.code, deviceId, this.pcId);
    const pcPub = ecdh.getPublicKey().toString('base64');
    const prev = this.devices[deviceId];
    const name = String(deviceName || '휴대폰').slice(0, 60);
    this.devices[deviceId] = {
      id: deviceId,
      name,
      secret: secret.toString('base64'),
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      lastSync: prev?.lastSync || null,
      lastResult: prev?.lastResult || null,
      options: deviceOptions(prev?.options),
      links: prev?.links || {},
    };
    this.store.save();
    const response = { pcId: this.pcId, pcName: this.pcName, pcPub, proof: sc.pairProof(p.code, 'pair1-ok', this.pcId, pcPub, phonePub) };
    this.cancelPairing();
    this.emit('devices');
    this.log('info', `${name} 연결됨`);
    return response;
  }

  // ───────── 요청 인증 ─────────

  authenticate(req, actualBodyHash) {
    const deviceId = String(req.headers['x-sm-device'] || '');
    const dev = this.devices[deviceId];
    if (!dev) throw new HttpError(401, '페어링되지 않은 기기예요');
    const time = Number(req.headers['x-sm-time']);
    if (!Number.isFinite(time) || Math.abs(Date.now() - time) > CLOCK_SKEW) {
      throw new HttpError(401, '시간이 맞지 않아요 (폰·PC 시계를 확인해 주세요)');
    }
    const claimed = String(req.headers['x-sm-body'] || '');
    const sig = String(req.headers['x-sm-sig'] || '');
    const secret = Buffer.from(dev.secret, 'base64');
    if (!sc.safeEqual(sc.signRequest(secret, req.method, req.url, time, claimed), sig)) {
      throw new HttpError(401, '서명이 맞지 않아요');
    }
    if (actualBodyHash !== undefined && actualBodyHash !== claimed) throw new HttpError(400, '본문 해시가 맞지 않아요');
    dev.lastSeen = Date.now();
    return { dev, secret, sig };
  }

  // ───────── 동기화 계획 ─────────
  // 폰이 보낸 곡·재생목록 목록을 보고: 받을 곡, 보낼 곡, 폰에 쓸 재생목록을 정한다.
  async planSync(dev, m) {
    const opts = deviceOptions(dev.options);
    const lib = this.library;
    const notices = [];
    const links = (dev.links ||= {});
    if (m.deviceName) dev.name = String(m.deviceName).slice(0, 60);

    // 폰 → PC로 가져올 곡 (기본: 재생목록에 든 곡만). 삼성 뮤직 재생목록 + PC와 연결된 재생목록이 가리키는 곡
    const listed = new Set();
    if (m.playlistsEnabled) {
      for (const pl of Array.isArray(m.playlists) ? m.playlists : []) {
        for (const qh of Array.isArray(pl?.entries) ? pl.entries : []) if (isQh(qh)) listed.add(qh);
      }
    } else if (opts.phoneToPc === 'playlists') {
      notices.push('폰 앱에서 삼성 뮤직 재생목록 폴더를 고르면, 재생목록에 든 곡을 PC로 가져와요');
    }
    for (const pcId of Object.keys(links)) for (const id of this.playlists.get(pcId)?.entries || []) listed.add(id);
    const wantFromPhone = (qh) => opts.phoneToPc === 'all' || (opts.phoneToPc === 'playlists' && listed.has(qh));

    // 1) 폰 곡 → PC 곡 ID (같은 파일이면 같은 ID, 아니면 제목+가수로)
    const phoneTracks = new Map();
    for (const t of Array.isArray(m.tracks) ? m.tracks : []) if (isQh(t?.qh)) phoneTracks.set(t.qh, t);
    const toPc = new Map();
    const upload = [];
    for (const [qh, t] of phoneTracks) {
      if (lib.get(qh)) {
        toPc.set(qh, qh);
        continue;
      }
      const alias = lib.findByMeta(t.title, t.artist, t.duration);
      if (alias) {
        toPc.set(qh, alias.id);
        continue;
      }
      if (wantFromPhone(qh)) {
        upload.push(qh);
        toPc.set(qh, qh); // 올라오면 같은 ID가 된다
      }
    }
    const phoneHas = new Map(); // PC 곡 ID → 폰의 qh
    for (const [qh, id] of toPc) if (!phoneHas.has(id)) phoneHas.set(id, qh);
    const mapPhone = (list) => list.filter(isQh).map((qh) => toPc.get(qh) || qh);

    // 2) 재생목록 병합
    const playlistsOut = [];
    const pending = new Map();
    const results = [];
    if (m.playlistsEnabled) {
      const phoneLists = new Map();
      for (const pl of Array.isArray(m.playlists) ? m.playlists : []) {
        const key = normName(pl?.key ?? pl?.name);
        if (key) phoneLists.set(key, pl);
      }
      const linkByKey = new Map(Object.entries(links).map(([pcId, l]) => [l.key, pcId]));
      const seenPc = new Set();

      for (const [key, pl] of phoneLists) {
        const ours = pl.state === 'ours'; // 우리가 써 둔 파일이 그대로 있음 → 삼성 뮤직 쪽 상태는 모름
        const P = ours ? null : mapPhone(Array.isArray(pl.entries) ? pl.entries : []);
        const name = String(pl.name || key).slice(0, 120);
        let pcId = linkByKey.get(key);
        let link = pcId ? links[pcId] : null;
        let pcList = pcId ? this.playlists.get(pcId) : null;

        if (link && !pcList) {
          // PC에서 지운 재생목록
          if (ours) {
            playlistsOut.push({ key, name, file: pl.file || link.file, action: 'delete' });
            delete links[pcId];
            continue;
          }
          if (link.base && sameList(P, link.base)) {
            if (!link.deletedNotice) {
              notices.push(`"${name}"은 PC에서 지웠어요. 삼성 뮤직에서도 직접 지워 주세요`);
              link.deletedNotice = true;
            }
            continue;
          }
          delete links[pcId]; // 지운 뒤에 폰에서 고쳤으면 다시 살린다
          link = null;
          pcId = null;
        }

        if (!link) {
          if (ours) continue;
          const existing = this.playlists.findByName(name);
          if (existing && !links[existing.id]) {
            pcList = existing;
            pcId = existing.id;
            link = links[pcId] = { key, file: pl.file || null, base: null, pushed: null };
          } else {
            pcList = this.playlists.create(name, P, { origin: 'phone', syncToPhone: true });
            links[pcList.id] = { key, file: pl.file || null, base: P.slice(), pushed: null };
            seenPc.add(pcList.id);
            continue;
          }
        }

        seenPc.add(pcId);
        if (pl.file) link.file = String(pl.file);
        const B = link.base;
        const C = pcList.entries;
        const Peff = P ?? B ?? C;
        const prefer = (Number(pl.mtime) || 0) > (pcList.updatedAt || 0) ? 'phone' : 'pc';
        const M = merge3(B, C, Peff, { prefer });
        if (!sameList(M, C)) this.playlists.update(pcId, { entries: M }, { source: 'sync' });
        results.push({ key, pcId, link, P, ours });
      }

      // 폰에 파일이 없는 PC 재생목록
      for (const pcList of this.playlists.all()) {
        if (seenPc.has(pcList.id) || pcList.system) continue;
        const link = links[pcList.id];
        if (link && (link.base || link.pushed)) {
          // 폰에 있던 파일이 없어짐 = 폰에서 지움 → PC에는 남기고 다시 보내지 않는다
          delete links[pcList.id];
          this.playlists.update(pcList.id, { syncToPhone: false }, { source: 'sync' });
          notices.push(`폰에서 "${pcList.name}" 재생목록이 없어져서 연결을 끊었어요 (PC에는 남아 있어요)`);
          continue;
        }
        if (!link && !pcList.syncToPhone) continue;
        const newLink = link || (links[pcList.id] = { key: uniqueKey(normName(pcList.name), phoneLists, links), file: null, base: null, pushed: null });
        newLink.file ||= `${safeFileName(pcList.name)}.m3u`;
        results.push({ key: newLink.key, pcId: pcList.id, link: newLink, P: null, ours: true });
      }
    }

    // 3) 폰으로 보낼 곡
    const want = new Set();
    if (opts.pcToPhone === 'all') {
      for (const t of lib.list()) want.add(t.id);
    } else if (opts.pcToPhone === 'playlists') {
      for (const pcList of this.playlists.all()) {
        if (links[pcList.id] || (pcList.syncToPhone && !pcList.system)) for (const id of pcList.entries) want.add(id);
      }
    }
    const download = [];
    const dlSet = new Set();
    for (const id of want) {
      if (phoneHas.has(id) || phoneTracks.has(id)) continue;
      const t = lib.get(id);
      if (!t) continue;
      dlSet.add(id);
      download.push({
        id,
        size: t.size,
        name: path.basename(t.path),
        relDir: this.relDirFor(t),
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
      });
    }

    // 4) 폰에 쓸 재생목록 + 기준점(양쪽이 같다고 확인된 내용)
    const resolvable = (id) => phoneHas.has(id) || phoneTracks.has(id) || dlSet.has(id);
    const toPhoneId = (id) => phoneHas.get(id) || id;
    for (const r of results) {
      const pcList = this.playlists.get(r.pcId);
      const view = pcList.entries.filter(resolvable); // 폰에서 찾을 수 있는 곡만
      if (r.P && sameList(r.P, view)) r.link.base = view.slice();
      const fileContent = r.ours ? r.link.pushed : r.P;
      if (fileContent && sameList(fileContent, view)) continue;
      if (!fileContent && !view.length) continue;
      playlistsOut.push({ key: r.key, name: pcList.name, file: r.link.file, action: 'write', entries: view.map(toPhoneId) });
      pending.set(r.key, { pcId: r.pcId, entries: view });
    }

    const syncId = crypto.randomBytes(8).toString('hex');
    this.sessions.set(syncId, { deviceId: dev.id, at: Date.now(), pending, toPc: Object.fromEntries(toPc) });
    for (const [k, s] of this.sessions) if (Date.now() - s.at > 60 * 60_000) this.sessions.delete(k);
    this.store.save();
    this.log('info', `${dev.name}: 동기화 시작 · 받을 곡 ${upload.length} · 보낼 곡 ${download.length} · 재생목록 ${playlistsOut.length}`);
    for (const n of notices) this.log('warn', `${dev.name}: ${n}`);
    this.emit('devices');
    return { syncId, pcName: this.pcName, upload, download, playlists: playlistsOut, notices };
  }

  // 폰에서 동기화를 마치고 보고한 결과 반영
  commit(dev, body = {}) {
    const s = this.sessions.get(String(body.syncId || ''));
    if (!s || s.deviceId !== dev.id) throw new HttpError(409, '동기화 세션이 만료됐어요. 다시 시도해 주세요');
    this.sessions.delete(body.syncId);
    const links = (dev.links ||= {});
    const linkByKey = new Map(Object.values(links).map((l) => [l.key, l]));
    let written = 0;
    for (const w of Array.isArray(body.written) ? body.written : []) {
      const key = normName(w?.key);
      const p = s.pending.get(key);
      const link = linkByKey.get(key);
      if (!p || !link) continue;
      // 폰이 실제로 쓴 내용 (폰에서 못 찾은 곡은 빠져 있을 수 있음)
      link.pushed = Array.isArray(w.entries) ? w.entries.filter(isQh).map((qh) => s.toPc[qh] || qh) : p.entries.slice();
      if (w.file) link.file = String(w.file).slice(0, 200);
      written++;
    }
    const errors = (Array.isArray(body.errors) ? body.errors : []).map((e) => String(e).slice(0, 300));
    const uploaded = Number(body.uploaded) || 0;
    const downloaded = Number(body.downloaded) || 0;
    dev.lastSync = Date.now();
    dev.lastResult = { at: dev.lastSync, uploaded, downloaded, playlists: written, errors: errors.length };
    this.store.save();
    this.log(errors.length ? 'warn' : 'info', `${dev.name}: 동기화 완료 · ↓PC ${uploaded}곡 · ↓폰 ${downloaded}곡 · 재생목록 ${written}개${errors.length ? ` · 오류 ${errors.length}` : ''}`);
    for (const e of errors.slice(0, 5)) this.log('warn', `${dev.name}: ${e}`);
    this.emit('devices');
    return { ok: true };
  }

  // ───────── 파일 받기 (폰 → PC) ─────────

  async receiveUpload(dev, qh, phonePath, req, claimedBodyHash) {
    if (!isQh(qh)) throw new HttpError(400, '곡 ID 형식 오류');
    if (this.library.get(qh)) {
      req.resume();
      await new Promise((r) => req.on('end', r));
      return { ok: true, id: qh, existed: true };
    }
    const dest = this.destinationFor(phonePath);
    const tmp = path.join(this.tmpDir, `${qh}-${crypto.randomBytes(4).toString('hex')}.part`);
    const hash = crypto.createHash('sha256');
    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk, _enc, cb) {
            hash.update(chunk);
            cb(null, chunk);
          },
        }),
        fs.createWriteStream(tmp),
      );
      if (hash.digest('hex') !== claimedBodyHash) throw new HttpError(400, '받은 파일이 손상됐어요 (해시 불일치)');
      if ((await quickHash(tmp)) !== qh) throw new HttpError(400, '곡 ID가 파일 내용과 달라요');
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const finalPath = await uniquePath(dest);
      await moveFile(tmp, finalPath);
      await this.library.ingestFile(finalPath, qh);
      return { ok: true, id: qh };
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
  }

  // /storage/emulated/0/Music/가수/곡.mp3 → <음악 폴더>/From Phone/가수/곡.mp3
  destinationFor(phonePath) {
    const root = this.settings.data.musicFolders[0];
    if (!root) throw new HttpError(500, 'PC에 음악 폴더가 설정되지 않았어요');
    let rel = String(phonePath || '').replace(/\\/g, '/');
    rel = rel
      .replace(/^\/?storage\/emulated\/\d+\//i, '')
      .replace(/^\/?storage\/[^/]+\//i, '')
      .replace(/^\/?sdcard\//i, '')
      .replace(/^\/+/, '');
    let parts = rel.split('/').filter((s) => s && s !== '.' && s !== '..').map((s) => safeFileName(s, '_'));
    if (parts.length > 1 && parts[0].toLowerCase() === 'music') parts = parts.slice(1);
    if (!parts.length) parts = ['track.mp3'];
    const fileName = parts[parts.length - 1];
    if (!AUDIO_TYPES[path.extname(fileName).toLowerCase()]) throw new HttpError(400, '지원하지 않는 파일 형식이에요');
    return path.join(root, PHONE_FOLDER_NAME, ...parts);
  }

  // PC → 폰: 음악 폴더 안의 상대 경로를 그대로 쓴다 (폰에서는 Music/SyncMusic/<relDir>/)
  relDirFor(t) {
    const dir = path.dirname(t.path);
    for (const root of this.settings.data.musicFolders) {
      const rel = path.relative(root, dir);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.split(path.sep).map((s) => safeFileName(s, '_')).join('/');
      }
      if (rel === '') return '';
    }
    return safeFileName(t.artist || '', '');
  }

  fileForDownload(id) {
    const t = this.library.get(id);
    if (!t) throw new HttpError(404, '곡이 없어요');
    return t;
  }

  // ───────── 이어듣기 ─────────

  setNowPlaying(dev, info = {}) {
    const item = (x) => ({
      title: String(x?.title || '').slice(0, 300),
      artist: String(x?.artist || '').slice(0, 300),
      album: String(x?.album || '').slice(0, 300),
      durationMs: Number(x?.durationMs) || 0,
      qh: isQh(x?.qh) ? x.qh : null,
    });
    const queue = (Array.isArray(info.queue) ? info.queue : []).slice(0, 2000).map(item);
    this.nowPlaying = {
      deviceId: dev.id,
      deviceName: dev.name,
      receivedAt: Date.now(),
      app: String(info.app || '').slice(0, 100),
      current: item(info.current),
      positionMs: Number(info.positionMs) || 0,
      playing: !!info.playing,
      shuffle: !!info.shuffle,
      repeat: ['off', 'all', 'one'].includes(info.repeat) ? info.repeat : 'off',
      queue,
      activeIndex: Number.isInteger(info.activeIndex) ? info.activeIndex : -1,
    };
    this.emit('nowplaying', this.nowPlaying);
    return { ok: true };
  }

  // 폰에서 듣던 대기열을 PC 곡으로 바꾼다 (순서는 받은 그대로)
  handoff() {
    const np = this.nowPlaying;
    if (!np) throw new HttpError(404, '폰에서 받은 재생 정보가 없어요');
    const match = (x) => {
      if (x.qh && this.library.get(x.qh)) return x.qh;
      return this.library.findByMeta(x.title, x.artist, x.durationMs / 1000)?.id || null;
    };
    const source = np.queue.length ? np.queue : [np.current];
    const ids = [];
    let index = -1;
    const currentId = match(np.current);
    source.forEach((x, i) => {
      const id = match(x);
      if (!id) return;
      if (index === -1 && (i === np.activeIndex || (np.activeIndex < 0 && id === currentId))) index = ids.length;
      ids.push(id);
    });
    if (index === -1 && currentId) {
      index = ids.indexOf(currentId);
      if (index === -1) {
        ids.unshift(currentId);
        index = 0;
      }
    }
    if (!ids.length) throw new HttpError(404, 'PC 라이브러리에서 같은 곡을 찾지 못했어요. 먼저 동기화해 주세요');
    // 폰이 재생 중이었으면 받은 뒤 지난 시간만큼 앞으로 당긴다. 단 곡 끝을 넘기면 PC에서 바로 다음 곡으로
    // 넘어가 버리므로, 당긴 위치는 끝 3초 전까지만 (폰이 알려 준 위치보다 앞으로 깎지는 않음, 최대 끝 1초 전)
    const elapsed = np.playing ? Date.now() - np.receivedAt : 0;
    const dur = np.current.durationMs;
    let positionMs = np.positionMs + elapsed;
    if (dur > 0) positionMs = Math.min(positionMs, Math.max(dur - 3000, Math.min(np.positionMs, dur - 1000)));
    return {
      ids,
      index: Math.max(0, index),
      positionSec: Math.max(0, positionMs / 1000),
      shuffle: np.shuffle,
      repeat: np.repeat,
      missing: source.length - ids.length,
    };
  }

  // ───────── 기기 관리·로그 ─────────

  devicesPublic() {
    return Object.values(this.devices).map((d) => ({
      id: d.id,
      name: d.name,
      pairedAt: d.pairedAt,
      lastSeen: d.lastSeen,
      lastSync: d.lastSync,
      lastResult: d.lastResult,
      options: deviceOptions(d.options),
      linkedPlaylists: Object.keys(d.links || {}).length,
    }));
  }

  setDeviceOptions(id, options = {}) {
    const d = this.devices[id];
    if (!d) throw new HttpError(404, '기기를 찾을 수 없어요');
    const next = deviceOptions({ ...deviceOptions(d.options), ...options });
    d.options = next;
    this.store.save();
    this.emit('devices');
    return next;
  }

  removeDevice(id) {
    const d = this.devices[id];
    if (!d) return false;
    delete this.devices[id];
    this.store.save();
    this.emit('devices');
    this.log('info', `${d.name} 연결 해제`);
    return true;
  }

  log(level, msg) {
    const entry = { at: Date.now(), level, msg };
    const log = this.store.data.log;
    log.push(entry);
    if (log.length > 200) log.splice(0, log.length - 200);
    this.store.save();
    this.emit('log', entry);
  }

  flush() {
    this.store.flush();
  }
}

function uniqueKey(key, phoneLists, links) {
  const taken = new Set([...phoneLists.keys(), ...Object.values(links).map((l) => l.key)]);
  let k = key || '재생목록';
  for (let i = 2; taken.has(k); i++) k = `${key} (${i})`;
  return k;
}

async function uniquePath(p) {
  const ext = path.extname(p);
  const base = p.slice(0, -ext.length || undefined);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? p : `${base} (${i})${ext}`;
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(from, to); // 데이터 폴더와 음악 폴더가 다른 드라이브
    await fsp.rm(from, { force: true });
  }
}
