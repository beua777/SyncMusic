import path from 'node:path';
import { EventEmitter } from 'node:events';
import { JsonStore } from './util/jsonfile.js';

// 오류 기록: 화면(재생 실패, 스크립트 오류)과 서버(검색·동기화·가사)의 오류를 최근 500개까지 모아 둔다.
// 같은 오류가 잇달아 나면 한 줄로 합치고 횟수만 센다.
export class ErrorLog extends EventEmitter {
  constructor(dataDir) {
    super();
    this.store = new JsonStore(path.join(dataDir, 'errors.json'), { items: [] });
  }

  add({ source = 'server', message, detail = null, context = null } = {}) {
    const msg = String(message ?? '').slice(0, 500);
    if (!msg) return null;
    const items = this.store.data.items;
    const last = items[items.length - 1];
    if (last && last.source === source && last.message === msg && Date.now() - last.at < 60_000) {
      last.count = (last.count || 1) + 1;
      last.at = Date.now();
    } else {
      items.push({
        at: Date.now(),
        source: String(source).slice(0, 20),
        message: msg,
        detail: detail ? String(detail).slice(0, 2000) : null,
        context: context ? (typeof context === 'string' ? context : JSON.stringify(context)).slice(0, 1000) : null,
        count: 1,
      });
      if (items.length > 500) items.splice(0, items.length - 500);
    }
    this.store.save(1000);
    this.emit('added', items[items.length - 1]);
    return items[items.length - 1];
  }

  list() {
    return this.store.data.items.slice().reverse();
  }

  clear() {
    this.store.data.items = [];
    this.store.save();
  }

  flush() {
    this.store.flush();
  }
}
