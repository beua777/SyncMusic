import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// 들은 기록: 곡을 들을 때마다 한 줄씩 덧붙이는 파일 (history.jsonl).
// 곡이 나중에 지워져도 통계가 남도록 제목·가수·앨범을 같이 적어 둔다.
//   { id, s: 시작 시각(ms), l: 들은 초, c: 끝까지 들음 1/0, k: 넘김 1/0, t, a, al, g, d: 곡 길이 }
export class History {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'history.jsonl');
    this.events = [];
    try {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          this.events.push(JSON.parse(line));
        } catch {
          // 반쯤 쓰인 줄은 건너뛴다
        }
      }
    } catch {
      // 처음
    }
    this.queue = Promise.resolve();
  }

  add(e) {
    this.events.push(e);
    const line = `${JSON.stringify(e)}\n`;
    this.queue = this.queue.then(() => fsp.appendFile(this.file, line)).catch(() => {});
    return e;
  }

  // 백업에서 되살릴 때: 통째로 바꾼다
  async replace(events) {
    this.events = events.slice();
    await this.queue;
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    await fsp.rename(tmp, this.file);
  }

  between(from = 0, to = Infinity) {
    return this.events.filter((e) => e.s >= from && e.s < to);
  }

  flush() {
    return this.queue;
  }
}

// 화면에서 온 기록 하나를 검사해서 저장할 모양으로
export function makeEvent(body, track) {
  const s = Number(body?.start);
  const l = Number(body?.listened);
  if (!track || !Number.isFinite(s) || !Number.isFinite(l) || l < 1 || l > 6 * 3600) return null;
  if (s < Date.UTC(2000, 0, 1) || s > Date.now() + 60_000) return null;
  return {
    id: track.id,
    s: Math.round(s),
    l: Math.round(l),
    c: body.completed ? 1 : 0,
    k: body.skipped ? 1 : 0,
    t: track.title,
    a: track.artist,
    al: track.album,
    g: track.genre || null,
    d: Math.round(track.duration || 0),
  };
}

export function toCsv(events) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['시작', '곡 ID', '제목', '아티스트', '앨범', '장르', '들은 초', '곡 길이', '끝까지', '넘김']];
  for (const e of events) rows.push([new Date(e.s).toISOString(), e.id, e.t, e.a, e.al, e.g, e.l, e.d, e.c, e.k]);
  return `\ufeff${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`; // 엑셀에서 한글이 깨지지 않게 BOM
}
