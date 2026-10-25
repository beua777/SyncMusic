// 색 계산 (화면에 의존하지 않아서 테스트에서도 쓴다)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

export const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c.map(Math.round).join(' ')})` : `rgb(${c.map(Math.round).join(' ')} / ${a})`);

// 상대 휘도 (WCAG)
export function luminance(c) {
  const [r, g, b] = c.map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// 배경 위에서 읽히도록 밝기만 조절 (색상·채도는 그대로)
export function readableOn(c, bg, minRatio = 3) {
  const [h, s, l0] = rgbToHsl(c);
  const darker = luminance(bg) > 0.5;
  let out = c;
  for (let l = l0; l >= 0 && l <= 100; l += darker ? -2 : 2) {
    out = hslToRgb(h, s, l);
    if (contrast(out, bg) >= minRatio) break;
  }
  return out;
}

const LIGHT_BG = [246, 246, 246];
const DARK_BG = [0, 0, 0];

// 포인트 색 → CSS 변수. 다크 테마에서는 검은 배경에서도 보이게 밝혀 준다
export function accentVars(hex, dark) {
  const base = hexToRgb(hex);
  if (!base) return null;
  const c = readableOn(base, dark ? DARK_BG : LIGHT_BG, dark ? 4.5 : 3);
  return {
    '--accent': rgbToHex(c),
    '--accent-text': luminance(c) > 0.4 ? '#0b0b0f' : '#ffffff',
    '--accent-weak': rgb(c, dark ? 0.16 : 0.12),
  };
}

// 재생 화면 위쪽에서 내려오는 색. 글자가 잘 보이게 밝기를 테마에 맞춘다
export function npTint(c, dark, { maxSat = 60 } = {}) {
  const [h, s] = rgbToHsl(c);
  return hsl(h, Math.min(maxSat, s), dark ? 22 : 86);
}

export function customTint(hex, dark) {
  const c = hexToRgb(hex);
  if (!c) return null;
  const [h, s, l] = rgbToHsl(c);
  return hsl(h, Math.min(85, s), dark ? clamp(l * 0.55, 16, 38) : clamp(l, 68, 90));
}

// 무지개 속도 1(느리게) ~ 10(빠르게) → 무지개가 한 바퀴 도는 데 걸리는 초 (5 = 24초, 한 칸마다 약 1.4배)
export function rainbowPeriod(speed = 5) {
  const s = Number.isFinite(Number(speed)) && speed !== null && speed !== '' ? Number(speed) : 5;
  return 24 * 2 ** ((5 - clamp(Math.round(s), 1, 10)) / 2);
}

// 무지개가 지금 한 바퀴 중 어디인지 0~1. 배경(CSS 애니메이션)과 스펙트럼·효과(캔버스)가
// 같은 시계(performance.now)를 써서, 같은 색으로 맞추거나 일정하게 어긋나게 할 수 있다
export const rainbowPhase = (ms, period = rainbowPeriod()) => (ms / 1000 / period) % 1;
export const cycleHue = (ms, period = rainbowPeriod()) => rainbowPhase(ms, period) * 360;

// 위쪽 배경과 스펙트럼의 무지개 색: 같은 색 · 조금 다르게 · 반대 색 (스펙트럼 쪽을 이만큼 돌림)
export const LINK_OFFSET = { same: 0, shift: 90, opposite: 180 };

// 랜덤 색상: 바로 전 색과 너무 비슷하지 않게
export function randomHue(prev = null, rand = Math.random) {
  for (let i = 0; i < 8; i++) {
    const h = rand() * 360;
    if (prev === null || Math.abs(((h - prev + 540) % 360) - 180) > 50) return h;
  }
  return ((prev ?? 0) + 180) % 360;
}

// 스펙트럼 색: 아래(a)에서 위(b)로 번지는 두 색, 무지개(여러 색), 또는 무지개 단색(시간에 따라 바뀜).
// period·offset은 무지개 속도와 위쪽 배경과의 색 차이
export function spectrumPalette(mode, { album = null, hue = 200, accent = null, custom = null, dark = false, period = rainbowPeriod(), offset = 0 } = {}) {
  if (mode === 'rainbow') return { rainbow: true, s: 85, l: dark ? 62 : 55, period, offset };
  if (mode === 'cycle') return { cycle: true, s: 82, l: dark ? 62 : 52, period, offset };
  let base;
  if (mode === 'random') base = hslToRgb(hue, 82, dark ? 62 : 52);
  else if (mode === 'custom') base = hexToRgb(custom);
  else if (mode === 'accent') base = hexToRgb(accent);
  else if (album) {
    const [h, s] = rgbToHsl(album);
    base = s < 10 ? hslToRgb(h, 0, dark ? 78 : 38) : hslToRgb(h, clamp(s * 1.3, 55, 92), dark ? 62 : 50);
  }
  base ||= hexToRgb(accent) || [29, 111, 230];
  const [h, s, l] = rgbToHsl(base);
  return { rainbow: false, a: base, b: hslToRgb(h + 12, s, clamp(l + 20, 0, 92)) };
}
