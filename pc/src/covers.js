import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { findFolderCover } from './tags.js';

const EXT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
export const COVER_ID = '[0-9a-f]{20}';

// 파일 앞부분으로 그림 형식을 알아낸다 (태그에 적힌 형식은 틀린 경우가 많다)
function extFor(data, format = '') {
  if (data[0] === 0xff && data[1] === 0xd8) return 'jpg';
  if (data[0] === 0x89 && data[1] === 0x50) return 'png';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (data.toString('latin1', 0, 3) === 'GIF') return 'gif';
  if (data[0] === 0x42 && data[1] === 0x4d) return 'bmp';
  return /png/i.test(format) ? 'png' : /webp/i.test(format) ? 'webp' : 'jpg';
}

// 커버 그림 저장소. 곡마다 자기 커버를 쓰고(삼성 뮤직처럼), 같은 그림은 내용 해시를 ID로 한 번만 저장한다.
export class Covers {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'covers');
    fs.mkdirSync(this.dir, { recursive: true });
    this.folderMemo = new Map(); // 폴더 → { sig, id }
  }

  async save(data, format) {
    const buf = Buffer.from(data);
    const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
    const file = path.join(this.dir, `${id}.${extFor(buf, format)}`);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
    }
    return id;
  }

  // 같은 폴더의 cover.jpg / folder.jpg 등 (태그에 커버가 없는 곡용)
  async folderCover(dir) {
    const f = await findFolderCover(dir);
    const st = f && (await fsp.stat(f.file).catch(() => null));
    if (!st) return null;
    const sig = `${f.file}|${st.size}|${st.mtimeMs}`;
    const memo = this.folderMemo.get(dir);
    if (memo?.sig === sig) return memo.id;
    const id = await this.save(await fsp.readFile(f.file), f.format);
    this.folderMemo.set(dir, { sig, id });
    return id;
  }

  find(id) {
    for (const [ext, format] of Object.entries(EXT_TYPES)) {
      const file = path.join(this.dir, `${id}.${ext}`);
      if (fs.existsSync(file)) return { file, format };
    }
    return null;
  }

  // 어느 곡도 쓰지 않는 그림을 지운다 (예전 버전이 앨범 단위로 저장한 그림 포함).
  // 방금 만든 파일은 동기화로 막 들어온 곡의 것일 수 있어서 남겨 둔다.
  async prune(isUsed, { minAgeMs = 10 * 60_000 } = {}) {
    let names;
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const n of names) {
      if (isUsed(n.split('.')[0]) && !n.endsWith('.tmp')) continue;
      const file = path.join(this.dir, n);
      const st = await fsp.stat(file).catch(() => null);
      if (!st || Date.now() - st.mtimeMs < minAgeMs) continue;
      await fsp.unlink(file).then(() => removed++, () => {});
    }
    return removed;
  }
}
