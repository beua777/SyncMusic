import path from 'node:path';

// 삼성 뮤직이 내보내는 재생목록 파일 읽기/쓰기.
// - .m3u / .m3u8: 줄마다 경로, #EXTINF:길이,가수 - 제목
// - .smpl: 구형 기기의 JSON 형식 { name, members: [{ info: 경로, order, title, artist }] }
//   (공식 문서가 없어서 필드 이름이 조금 달라도 읽히도록 너그럽게 처리)
export function parsePlaylistFile(text, fileName = 'playlist.m3u') {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, path.extname(fileName));
  const body = String(text).replace(/^﻿/, '');

  if (ext === '.smpl' || /^\s*\{/.test(body)) {
    let j;
    try {
      j = JSON.parse(body);
    } catch {
      return { name: baseName, items: [], format: 'smpl', error: 'JSON을 읽을 수 없음' };
    }
    const members = Array.isArray(j.members) ? j.members : Array.isArray(j.items) ? j.items : Array.isArray(j.tracks) ? j.tracks : [];
    const items = members
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (num(a.m.order) ?? a.i) - (num(b.m.order) ?? b.i) || a.i - b.i)
      .map(({ m }) => ({
        path: String(m.info ?? m.path ?? m.data ?? m.uri ?? ''),
        title: m.title ?? null,
        artist: m.artist ?? null,
        duration: null,
      }))
      .filter((x) => x.path || x.title);
    return { name: String(j.name || baseName), items, format: 'smpl' };
  }

  const items = [];
  let name = baseName;
  let pending = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const inf = /^#EXTINF:\s*(-?[\d.]+)?[^,]*,(.*)$/i.exec(line);
      if (inf) {
        const dur = Number(inf[1]);
        const [artist, title] = splitLabel(inf[2].trim());
        pending = { duration: dur > 0 ? dur : null, artist, title };
      } else if (/^#PLAYLIST:/i.test(line)) {
        name = line.slice(10).trim() || name;
      }
      continue;
    }
    items.push({ path: decodePath(line), title: null, artist: null, duration: null, ...(pending || {}) });
    pending = null;
  }
  return { name, items, format: ext === '.m3u8' ? 'm3u8' : 'm3u' };
}

// 삼성 뮤직 가져오기용 .m3u (UTF-8, BOM 없음, 절대 경로)
export function writeM3u(items) {
  const lines = ['#EXTM3U'];
  for (const it of items) {
    const dur = it.duration ? Math.round(it.duration) : -1;
    const label = [it.artist, it.title].filter(Boolean).join(' - ');
    lines.push(`#EXTINF:${dur},${label}`, it.path);
  }
  return `${lines.join('\n')}\n`;
}

// 삼성 뮤직 .smpl — 실제 갤럭시(S26)가 내보낸 파일과 같은 모양으로 쓴다:
// 한 줄 JSON, members 배열은 order가 큰 곡부터(재생 순서는 order 오름차순), <>는 < >로.
// 기존 파일이 있으면 recentlyPlayedDate·sortBy·version을 그대로 둔다.
export function writeSmpl(name, items, template = null) {
  const members = items
    .map((it, i) => ({
      artist: it.artist || '<unknown>',
      info: it.path,
      order: i + 1,
      title: it.title || String(it.path).split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
      type: 65537,
    }))
    .reverse();
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return JSON.stringify({
    members,
    name: String(name),
    recentlyPlayedDate: num(template?.recentlyPlayedDate, 0),
    sortBy: num(template?.sortBy, 4),
    version: num(template?.version, 1),
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

// 재생목록 파일의 항목을 PC 라이브러리 곡에 맞춘다: 경로 → 파일 이름 → 제목+가수
export function matchItems(items, library, { baseDir } = {}) {
  const ids = [];
  const missing = [];
  for (const it of items) {
    let t = null;
    if (it.path) {
      const p = it.path.replace(/[\\/]/g, path.sep);
      // "C:\..." 같은 Windows 경로는 어느 OS에서 읽어도 절대 경로로 본다
      const isAbs = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(it.path) || it.path.startsWith('\\\\');
      const abs = isAbs ? p : baseDir ? path.resolve(baseDir, p) : null;
      if (abs) {
        const id = library.idForPath(abs);
        if (id) t = library.get(id);
      }
      if (!t) t = library.findByFileName(it.path.split(/[\\/]/).pop());
    }
    if (!t && it.title) t = library.findByMeta(it.title, it.artist, it.duration);
    if (t) ids.push(t.id);
    else missing.push(it);
  }
  return { ids, missing };
}

function splitLabel(label) {
  const i = label.indexOf(' - ');
  return i > 0 ? [label.slice(0, i).trim(), label.slice(i + 3).trim()] : [null, label || null];
}

function decodePath(p) {
  if (/^file:\/\//i.test(p)) {
    try {
      return decodeURIComponent(new URL(p).pathname).replace(/^\/([A-Za-z]:)/, '$1');
    } catch {
      return p;
    }
  }
  return p;
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// 파일 이름으로 쓸 수 없는 글자 정리 (Windows·안드로이드 공통)
export function safeFileName(name, fallback = '재생목록') {
  let s = String(name ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}
