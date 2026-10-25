import fs from 'node:fs';
import path from 'node:path';

// JSON 파일 하나를 메모리에 들고 있다가, 바뀌면 잠깐 모아서 임시 파일 → 이름 바꾸기로 저장한다.
// (저장 도중 꺼져도 파일이 반쯤 쓰인 상태로 남지 않게)
export class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.timer = null;
    this.data = structuredClone(defaults);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...this.data, ...parsed };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // 깨진 파일은 옆에 남겨 두고 기본값으로 시작
        try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch { /* 무시 */ }
      }
    }
  }

  save(delay = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), delay);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    renameWithRetry(tmp, this.file);
  }

  flush() {
    if (this.timer) this.saveNow();
  }
}

// Windows에서는 백신이 파일을 잠깐 잡고 있으면 rename이 EPERM으로 실패할 수 있어서 몇 번 다시 시도한다.
export function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (i >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
    }
  }
}
