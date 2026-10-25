import crypto from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { JsonStore } from './util/jsonfile.js';

export const FAVORITES_ID = 'favorites';

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
  }
}

export const normName = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase();
