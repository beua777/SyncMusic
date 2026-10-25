import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { findFolderCover, readCover } from './tags.js';

const EXT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// 앨범 커버 캐시. 같은 폴더의 같은 앨범은 한 번만 꺼낸다.
export class Covers {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'covers');
    fs.mkdirSync(this.dir, { recursive: true });
    this.memo = new Map(); // key → { file, format } | null
    this.inflight = new Map();
  }

  keyFor(t) {
    return crypto.createHash('sha1').update(`${path.dirname(t.path).toLowerCase()}|${t.album || ''}`).digest('hex').slice(0, 20);
  }

  clearMemo() {
    // 커버 없음(null)으로 기억한 것만 지운다 (새 cover.jpg가 생겼을 수 있음)
    for (const [k, v] of this.memo) if (!v) this.memo.delete(k);
  }

  get(t) {
    const key = this.keyFor(t);
    if (this.memo.has(key)) return Promise.resolve(this.memo.get(key));
    if (!this.inflight.has(key)) {
      const p = this.load(key, t).then((v) => {
        this.memo.set(key, v);
        this.inflight.delete(key);
        return v;
      });
      this.inflight.set(key, p);
    }
    return this.inflight.get(key);
  }

  async load(key, t) {
    for (const ext of Object.keys(EXT_TYPES)) {
      const file = path.join(this.dir, `${key}.${ext}`);
      try {
        await fsp.access(file);
        return { file, format: EXT_TYPES[ext] };
      } catch {
        // 캐시에 없음
      }
    }
    const pic = await readCover(t.path);
    if (pic) {
      const ext = pic.format.includes('png') ? 'png' : pic.format.includes('webp') ? 'webp' : 'jpg';
      const file = path.join(this.dir, `${key}.${ext}`);
      await fsp.writeFile(file, pic.data);
      return { file, format: EXT_TYPES[ext] };
    }
    return findFolderCover(path.dirname(t.path));
  }
}
