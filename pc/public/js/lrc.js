// LRC 가사 읽기·쓰기 (화면·서버가 같이 쓴다).
// 같은 시각에 줄이 여러 개면 첫 줄이 원문, 나머지는 번역·발음 (한국에서 흔한 LRC 모양)

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[(ti|ar|al|by|offset|length|re|ve):(.*)\]\s*$/i;

export function parseLrc(text) {
  const meta = {};
  const raw = [];
  const plain = [];
  for (const line of String(text ?? '').replace(/^\ufeff/, '').split(/\r?\n/)) {
    const m = META.exec(line.trim());
    if (m) {
      meta[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    const stamps = [...line.matchAll(STAMP)];
    const body = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!stamps.length) {
      if (line.trim()) plain.push(body || line.trim());
      continue;
    }
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3].padEnd(3, '0')) / 1000 : 0;
      raw.push({ t: Number(s[1]) * 60 + Number(s[2]) + frac, text: body });
    }
  }
  if (!raw.length) return { synced: false, meta, lines: plain.map((text) => ({ t: null, text, sub: [] })) };
  const offset = Number(meta.offset) / 1000 || 0; // +면 가사가 일찍 나오게
  raw.sort((a, b) => a.t - b.t);
  const lines = [];
  for (const r of raw) {
    const t = Math.max(0, r.t - offset);
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.t - t) < 0.005) {
      if (r.text) last.sub.push(r.text);
    } else lines.push({ t, text: r.text, sub: [] });
  }
  return { synced: true, meta, lines };
}

export function fmtStamp(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// lines: [{ t, text, sub }] → LRC 글. 시각이 없는 줄은 앞 줄 시각을 따른다
export function toLrc(lines, meta = {}) {
  const out = [];
  for (const [k, v] of Object.entries(meta)) if (v !== undefined && v !== '' && k !== 'offset') out.push(`[${k}:${v}]`);
  let last = 0;
  for (const l of lines) {
    const t = Number.isFinite(l.t) ? l.t : last;
    last = t;
    out.push(`[${fmtStamp(t)}]${l.text ?? ''}`);
    for (const s of l.sub || []) if (s) out.push(`[${fmtStamp(t)}]${s}`);
  }
  return `${out.join('\n')}\n`;
}

// 시각 없는 가사 → 편집기에서 시각을 찍어 갈 줄 목록
export const plainLines = (text) =>
  String(text ?? '')
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .map((s) => s.replace(/\[[^\]]*\]/g, '').trim())
    .filter((s, i, a) => s || (i > 0 && a[i - 1])); // 빈 줄은 하나만 남긴다
