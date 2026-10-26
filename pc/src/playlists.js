import crypto from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { JsonStore } from './util/jsonfile.js';

export const FAVORITES_ID = 'favorites';
const MAX_VERSIONS = 50;
const HEX = /^#[0-9a-f]{6}$/i;
const SHUFFLE_MODES = ['keep', 'on', 'off'];
const REPEAT_MODES = ['keep', 'off', 'all', 'one'];

// 재생목록 = 곡 ID 배열. 배열 순서가 곧 곡 순서이고, 같은 곡이 여러 번 들어갈 수 있다.
export class Playlists extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.store = new JsonStore(path.join(dataDir, 'playlists.json'), { version: 1, lists: {}, order: [], deleted: {} });
    const d = this.store.data;
    if (!d.lists[FAVORITES_ID]) {
      const now = Date.now();
      d.lists[FAVORITES_ID] = { id: FAVORITES_ID, name: '즐겨찾기', entries: [], system: true, syncToPhone: false, createdAt: now, updatedAt: now };
      this.store.save();
    }
    // 재생목록마다 예전 버전 (바뀌기 직전 내용). 지운 재생목록도 여기서 되살린다
    this.history = new JsonStore(path.join(dataDir, 'playlist-history.json'), { lists: {} });
  }

  // 바뀌기 직전 내용을 남긴다. 1분 안에 같은 쪽(사용자·동기화)에서 잇달아 바꾸면 처음 것 하나만
  snapshot(p, source, { force = false } = {}) {
    const list = (this.history.data.lists[p.id] ||= []);
    const last = list[list.length - 1];
    if (!force && last && last.source === source && Date.now() - last.at < 60_000) return;
    if (!force && last && last.name === p.name && sameEntries(last.entries, p.entries)) return;
    list.push({ at: Date.now(), name: p.name, entries: [...p.entries], source });
    if (list.length > MAX_VERSIONS) list.splice(0, list.length - MAX_VERSIONS);
    this.history.save(500);
  }

  versions(id) {
    return (this.history.data.lists[id] || []).slice().reverse();
  }

  restore(id, at) {
    const p = this.get(id);
    const v = (this.history.data.lists[id] || []).find((x) => x.at === Number(at));
    if (!p || !v) return null;
    this.snapshot(p, 'restore', { force: true });
    p.entries = [...v.entries];
    if (!p.system) p.name = this.uniqueName(v.name) === v.name || normName(v.name) === normName(p.name) ? v.name : p.name;
    p.updatedAt = Date.now();
    this.changed({ id, source: 'user' });
    return p;
  }

  deletedLists() {
    return Object.entries(this.history.data.lists)
      .map(([id, list]) => ({ id, last: list[list.length - 1] }))
      .filter(({ id, last }) => last?.deleted && !this.get(id))
      .map(({ id, last }) => ({ id, name: last.name, count: last.entries.length, deletedAt: last.at }))
      .sort((a, b) => b.deletedAt - a.deletedAt);
  }

  undelete(id) {
    const list = this.history.data.lists[id];
    const last = list?.[list.length - 1];
    if (!last?.deleted || this.get(id)) return null;
    const look = last.look || {};
    const keep = Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined && v !== null));
    const p = this.create(last.name, last.entries, { origin: 'pc', ...keep });
    this.history.data.lists[p.id] = list.map((v) => ({ ...v, deleted: undefined })).filter((v) => v.entries);
    delete this.history.data.lists[id];
    this.history.save(500);
    return p;
  }

  get data() {
    return this.store.data;
  }

  all() {
    const d = this.data;
    const ids = [FAVORITES_ID, ...d.order.filter((id) => id !== FAVORITES_ID && d.lists[id])];
    for (const id of Object.keys(d.lists)) if (!ids.includes(id)) ids.push(id);
    return ids.map((id) => d.lists[id]);
  }

  get(id) {
    return this.data.lists[id] || null;
  }

  findByName(name) {
    const k = normName(name);
    return this.all().find((p) => !p.system && normName(p.name) === k) || null;
  }

  uniqueName(name) {
    const base = String(name || '').trim() || '새 재생목록';
    let n = base;
    for (let i = 2; this.findByName(n); i++) n = `${base} (${i})`;
    return n;
  }

  create(name, entries = [], extra = {}) {
    const id = crypto.randomBytes(6).toString('hex');
    const now = Date.now();
    this.data.lists[id] = {
      id,
      name: this.uniqueName(name),
      entries: [...entries],
      system: false,
      syncToPhone: true,
      createdAt: now,
      updatedAt: now,
      origin: 'pc',
      ...extra,
    };
    this.data.order.push(id);
    this.changed({ id, source: extra.origin === 'phone' ? 'sync' : 'user' });
    return this.data.lists[id];
  }

  update(id, patch, { source = 'user' } = {}) {
    const p = this.get(id);
    if (!p) return null;
    const entriesChange = Array.isArray(patch.entries) && !sameEntries(patch.entries, p.entries);
    const nameChange = typeof patch.name === 'string' && !p.system && patch.name.trim() && patch.name.trim() !== p.name;
    if (entriesChange || nameChange) this.snapshot(p, source);
    // 꾸미기: 색 · 아이콘(이모지 하나 또는 아이콘 이름) · 이 재생목록을 틀 때의 셔플·반복
    if ('color' in patch) {
      if (HEX.test(patch.color)) p.color = patch.color.toLowerCase();
      else delete p.color;
    }
    if ('icon' in patch) {
      if (typeof patch.icon === 'string' && patch.icon.trim() && [...patch.icon.trim()].length <= 4) p.icon = patch.icon.trim();
      else delete p.icon;
    }
    if ('mode' in patch) {
      const m = patch.mode || {};
      const mode = { shuffle: SHUFFLE_MODES.includes(m.shuffle) ? m.shuffle : 'keep', repeat: REPEAT_MODES.includes(m.repeat) ? m.repeat : 'keep' };
      if (mode.shuffle === 'keep' && mode.repeat === 'keep') delete p.mode;
      else p.mode = mode;
    }
    if (typeof patch.name === 'string' && !p.system) {
      const name = patch.name.trim();
      if (name && normName(name) !== normName(p.name)) p.name = this.uniqueName(name);
      else if (name) p.name = name;
    }
    if (Array.isArray(patch.entries)) p.entries = patch.entries.filter((x) => typeof x === 'string');
    if (typeof patch.syncToPhone === 'boolean') p.syncToPhone = patch.syncToPhone;
    p.updatedAt = Date.now();
    this.changed({ id, source });
    return p;
  }

  addTracks(id, ids, position = null) {
    const p = this.get(id);
    if (!p) return null;
    const entries = [...p.entries];
    const at = position === null || position < 0 || position > entries.length ? entries.length : position;
    entries.splice(at, 0, ...ids);
    return this.update(id, { entries });
  }

  remove(id) {
    const p = this.get(id);
    if (!p || p.system) return false;
    this.snapshot(p, 'user', { force: true });
    const last = this.history.data.lists[id].at(-1);
    last.deleted = true;
    last.look = { color: p.color, icon: p.icon, mode: p.mode, syncToPhone: p.syncToPhone }; // 되살릴 때 모양·재생 방식도 그대로
    this.history.save(500);
    delete this.data.lists[id];
    this.data.order = this.data.order.filter((x) => x !== id);
    this.data.deleted[id] = { name: p.name, deletedAt: Date.now() };
    this.changed({ id, source: 'user', deleted: true });
    return true;
  }

  reorderLists(ids) {
    const known = ids.filter((id) => this.data.lists[id] && id !== FAVORITES_ID);
    const rest = this.data.order.filter((id) => !known.includes(id));
    this.data.order = [...known, ...rest];
    this.changed({ source: 'user' });
  }

  // 태그 수정으로 곡 ID가 바뀌면 모든 재생목록에서 바꿔 준다
  remap(oldId, newId) {
    let touched = false;
    for (const p of Object.values(this.data.lists)) {
      if (!p.entries.includes(oldId)) continue;
      p.entries = p.entries.map((x) => (x === oldId ? newId : x));
      touched = true;
    }
    if (touched) this.changed({ source: 'library' });
  }

  changed(info) {
    this.store.save();
    this.emit('changed', info);
  }

  flush() {
    this.store.flush();
    this.history.flush();
  }
}

export const normName = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase();
const sameEntries = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
