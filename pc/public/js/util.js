// 화면 공통 도우미

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function fmtTotal(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

export function fmtAgo(ms) {
  if (!ms) return '없음';
  const d = Date.now() - ms;
  if (d < 60_000) return '방금';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}시간 전`;
  return new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export const fmtClock = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

export const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

// 초성 검색: "ㅂㄴㅇ" → "봄날의 산책"
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function chosung(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}

export const normSearch = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');

export function matchQuery(hay, choHay, q) {
  if (!q) return true;
  if (/^[ㄱ-ㅎ]+$/.test(q)) return choHay.includes(q);
  return hay.includes(q);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  return d;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 커버에서 대표 색을 뽑아 재생 화면 배경에 깐다 (삼성 뮤직처럼 앨범 색이 배어 나오게)
export async function dominantColor(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  let r = 0;
  let gr = 0;
  let b = 0;
  let w = 0;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]);
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    const weight = 0.15 + (max - min) / 255; // 채도가 높은 색에 가중치
    r += d[i] * weight;
    gr += d[i + 1] * weight;
    b += d[i + 2] * weight;
    w += weight;
  }
  return [r / w, gr / w, b / w];
}
