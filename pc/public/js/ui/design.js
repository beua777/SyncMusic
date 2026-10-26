// 디자인 꾸미기: 포인트 색 · 재생 화면 배경(위에서 내려오는 색) · 오디오 스펙트럼 · 무지개 · 화면 효과 · 박자에 맞춰 커버
// · 이 곡 화면 테마(곡마다 덮어쓰기) · 화면 배치(커버 크기 · 패널 위치 · 보일 버튼 · 탭 순서)
import { put } from '../api.js';
import { accentVars, customTint, cycleHue, hexToRgb, hsl, LINK_OFFSET, npTint, rainbowPeriod, randomHue, rgb, rgbToHex, spectrumPalette } from '../colors.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { batteryKnown, liteActive, liteDesign, liteSetting, onBattery, onLiteChange } from '../lite.js';
import { store } from '../store.js';
import { esc } from '../util.js';
import { trackThemeDialog } from './details.js';
import { toast } from './dom.js';

// [저장 값, 이름, 보이는 색]
const ACCENTS = [
  ['', '기본 파랑', '#1d6fe6'],
  ['#7c5cff', '보라'],
  ['#e8457c', '핑크'],
  ['#e5484d', '빨강'],
  ['#f08c00', '주황'],
  ['#e6b800', '노랑'],
  ['#2f9e44', '초록'],
  ['#0ca5a5', '청록'],
  ['#64748b', '회색'],
];
const PRESETS = ['#7c5cff', '#e8457c', '#e5484d', '#f08c00', '#e6b800', '#2f9e44', '#0ca5a5', '#3fa9ff'];
const BG_MODES = [
  ['album', '앨범 색'],
  ['blur', '커버 흐리게'],
  ['random', '랜덤'],
  ['rainbow', '무지개'],
  ['cycle', '무지개 단색'],
  ['custom', '직접 고르기'],
  ['off', '끄기'],
];
const LINE_STYLES = [
  ['bars', '막대', 'bars'],
  ['mirror', '대칭', 'vizMirror'],
  ['wave', '물결', 'vizWave'],
];
const COVER_STYLES = [...LINE_STYLES, ['circle', '원형', 'vizCircle'], ['off', '끄기']];
const BOTTOM_STYLES = [...LINE_STYLES, ['off', '끄기']];
const VIZ_COLORS = [
  ['album', '앨범 색'],
  ['rainbow', '무지개'],
  ['cycle', '무지개 단색'],
  ['random', '랜덤'],
  ['accent', '포인트 색'],
  ['custom', '직접 고르기'],
];
const LINKS = [
  ['same', '같은 색'],
  ['shift', '조금 다르게'],
  ['opposite', '반대 색'],
];
// [저장 값, 이름, 앞에 붙는 그림]
const EFFECTS = [
  ['off', '끄기', ''],
  ['snow', '눈', '❄️'],
  ['sakura', '벚꽃', '🌸'],
  ['leaves', '낙엽', '🍂'],
  ['rain', '비', '🌧️'],
  ['stars', '별', '✨'],
  ['fireflies', '반딧불', ''],
  ['bubbles', '비눗방울', '🫧'],
  ['hearts', '하트', '💗'],
];
const EFFECT_COLORS = [
  ['natural', '기본'],
  ['rainbow', '무지개'],
  ['accent', '포인트 색'],
];
const SCOPES = [
  ['np', '재생 화면에서만'],
  ['all', '앱 전체'],
];
const BEATS = [
  ['off', '끄기'],
  ['pulse', '커짐'],
  ['glow', '뒤에서 빛남'],
  ['both', '둘 다'],
];
// 움직임 부드러움: 스펙트럼·화면 효과를 초당 몇 번 그릴지 (CPU 사용량과 바꾼다)
const FPS = [
  [15, '절약'],
  [30, '보통'],
  [60, '부드럽게'],
];

let viz = null;
let fx = null;
let albumRgb = null; // 지금 곡 커버의 대표 색
let coverSrc = null; // 지금 곡 커버 주소 (커버 흐리게)
let hue = randomHue(); // 랜덤 모드의 색 (곡이 바뀔 때마다 새로)
let preview = {}; // 색을 고르는 동안(아직 저장 전) 미리 보여 줄 값
let panel = null;

// 이 곡 화면 테마: 그 곡이 나올 때만 배경·스펙트럼 색·효과를 바꾼다
const THEME_KEYS = ['npBg', 'npBgColor', 'spectrumColor', 'spectrumCustom', 'effect'];
function trackTheme() {
  const th = ctx.player?.track?.theme;
  const o = {};
  if (th) for (const k of THEME_KEYS) if (th[k]) o[k] = th[k];
  return o;
}
const saved = () => ({ ...store.settings.design, ...preview }); // 디자인 탭에 보이는 값 (기본 디자인)
// 실제로 보이는 값: 기본 디자인 → 이 곡 화면 테마 → 고르는 중인 값 → 저사양 모드면 가볍게
const current = () => {
  const d = { ...store.settings.design, ...trackTheme(), ...preview };
  return liteActive() ? liteDesign(d) : d;
};

// ───── 저사양 모드 ─────
const LITE = [
  ['off', '끄기'],
  ['on', '켜기'],
  ['battery', '배터리일 때만'],
];
export const LITE_TEXT = '화면 효과·박자 반응·화면 아래 스펙트럼·미니 스펙트럼·움직이는 배경·커버 회전을 쉬고, 스펙트럼은 1초에 15번만 그려요';

// '배터리일 때만'이면 지금 상태 한 줄
export function liteStatus() {
  if (liteSetting() !== 'battery') return '';
  if (!batteryKnown()) return '이 PC에서는 배터리 상태를 알 수 없어서 켜지지 않아요';
  return onBattery() ? '지금 배터리로 쓰는 중이라 켜져 있어요' : '지금 전원이 연결돼 있어서 꺼져 있어요';
}

export async function setLite(v) {
  store.settings.power = { ...(store.settings.power || {}), lite: v }; // 바로 반영하고 서버에 저장
  applyDesign();
  if (panel && !panel.hidden) renderDesign();
  try {
    store.settings = await put('/api/settings', { power: { lite: v } });
  } catch (err) {
    toast(err.message, 4000);
  }
  applyDesign();
  if (panel && !panel.hidden) renderDesign();
  toast(v === 'battery' ? `배터리로 쓸 때만 저사양 모드가 켜져요${liteActive() ? ' (지금 켜짐)' : ''}` : liteActive() ? '저사양 모드를 켰어요' : '저사양 모드를 껐어요');
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
};

const periodText = (speed) => `한 바퀴 ${Math.round(rainbowPeriod(speed))}초`;

// ───── 화면 배치 ─────
const TAB_NAMES = { tracks: '트랙', playlists: '재생목록', albums: '앨범', artists: '아티스트', folders: '폴더' };
export const LAYOUT_DEFAULTS = {
  coverSize: 'm',
  panelSide: 'right',
  showSource: true,
  showQuality: true,
  showExtra: true,
  miniShuffle: true,
  miniRepeat: true,
  miniQueue: true,
  miniVolume: true,
  tabs: Object.keys(TAB_NAMES),
  hiddenTabs: [],
};
export const layout = () => ({ ...LAYOUT_DEFAULTS, ...(store.settings.layout || {}) });
// 주소 없이 열었을 때 보일 탭: 보이는 탭 중 맨 앞
export const firstTab = () => {
  const l = layout();
  return l.tabs.find((id) => !l.hiddenTabs.includes(id)) || 'tracks';
};
const MINI_BUTTONS = [
  ['miniShuffle', '셔플', 'shuffle'],
  ['miniRepeat', '반복', 'repeat'],
  ['miniQueue', '재생 순서', 'queue'],
  ['miniVolume', '음량', 'volume'],
];

export function applyLayout() {
  const l = layout();
  const np = document.getElementById('np');
  if (np) {
    np.dataset.cover = l.coverSize;
    np.classList.toggle('panel-left', l.panelSide === 'left');
    np.classList.toggle('hide-source', !l.showSource);
    np.classList.toggle('hide-quality', !l.showQuality);
    np.classList.toggle('hide-extra', !l.showExtra);
  }
  const mini = document.getElementById('mini');
  if (mini) for (const [k] of MINI_BUTTONS) mini.classList.toggle(`no-${k.slice(4).toLowerCase()}`, !l[k]);
  const nav = document.getElementById('tabs');
  if (nav) {
    for (const id of l.tabs) {
      const a = nav.querySelector(`.tab[data-tab="${id}"]`);
      if (!a) continue;
      nav.appendChild(a);
      a.hidden = l.hiddenTabs.includes(id);
    }
  }
}

async function saveLayout(patch) {
  store.settings.layout = { ...layout(), ...patch }; // 바로 반영하고 서버에 저장
  applyLayout();
  renderDesign();
  try {
    store.settings = await put('/api/settings', { layout: patch });
  } catch (err) {
    toast(err.message, 4000);
  }
  applyLayout();
}

export function initDesign(visualizer, el, effects) {
  viz = visualizer;
  fx = effects;
  panel = el;
  bindPanel(el);
  applyLayout();
  applyDesign();
  for (const ev of ['focus', 'blur']) addEventListener(ev, updateBgClock);
  // 저사양 모드 '배터리일 때만': 전원을 꽂거나 뽑으면 바로 바꾼다
  onLiteChange((on) => {
    applyDesign();
    if (panel && !panel.hidden) renderDesign();
    toast(on ? '배터리로 쓰는 중이라 저사양 모드로 바꿨어요' : '전원이 연결돼서 저사양 모드를 껐어요', 3000);
  });
  document.addEventListener('visibilitychange', updateBgClock);
  // 이 곡 화면 테마를 바꿨을 때 · 서버에서 지금 곡 정보가 바뀌었을 때
  store.on('design', () => {
    applyDesign();
    if (panel && !panel.hidden) renderDesign();
  });
  store.on('track', (t) => {
    if (t?.id && t.id === ctx.player?.loadedId) applyDesign();
  });
}

// 곡이 바뀌면 랜덤 색을 새로 뽑는다 (커버 색은 setAlbumColor로 따로 들어옴)
export function designTrackChanged() {
  hue = randomHue(hue);
  applyDesign();
  if (panel && !panel.hidden) renderDesign(); // 이 곡 화면 테마 안내가 바뀔 수 있음
}

// 커버 흐리게: 그림은 곡이 바뀌자마자 바꾸고, 대표 색(setAlbumColor)은 그림을 읽은 뒤에 들어온다
export function setCoverImage(src) {
  coverSrc = src;
  document.getElementById('np').style.setProperty('--np-cover', src ? `url("${src}")` : 'none');
}

export function setAlbumColor(rgbColor) {
  albumRgb = rgbColor;
  applyDesign();
}

// 위쪽 배경의 무지개·무지개 단색: CSS 애니메이션은 매 프레임 스타일을 다시 계산해서 CPU를 많이 쓴다.
// 그래서 정한 간격(움직임 부드러움에 따라 0.1~0.5초)마다 스크립트로 색만 바꾼다. 스펙트럼·효과와 같은 시계라 색이 맞는다.
// 재생 화면이 닫혀 있거나 창이 안 보이면 멈춘다
let bgTimer = 0;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function bgTick() {
  const d = current();
  const bg = document.querySelector('#np .np-bg'); // 앱을 켜는 중에는 재생 화면이 아직 없을 수 있음
  if (!bg) return;
  const h = cycleHue(performance.now(), rainbowPeriod(d.rainbowSpeed)).toFixed(1);
  if (d.npBg === 'cycle') bg.style.setProperty('--np-cycle', h);
  else if (d.npBg === 'rainbow') bg.style.filter = `hue-rotate(${h}deg)`;
}

export function updateBgClock() {
  clearInterval(bgTimer);
  bgTimer = 0;
  const np = document.getElementById('np');
  const d = current();
  const bg = np?.querySelector('.np-bg');
  if (!bg) return;
  if (d.npBg !== 'rainbow') bg.style.filter = '';
  const moving = d.npBg === 'cycle' || d.npBg === 'rainbow';
  bgTick(); // 닫혀 있어도 열 때 바로 맞는 색이 보이게 한 번은 칠해 둔다
  if (!moving || reduceMotion.matches || !np.classList.contains('open') || document.hidden) return;
  // 한 번에 4도쯤씩 바뀌게 (빠른 무지개는 더 자주), 단 움직임 부드러움보다 자주는 안 바꾼다
  const fps = d.fps || 30;
  const minMs = fps >= 60 ? 50 : fps >= 30 ? 100 : 200;
  const ms = Math.max(minMs, Math.min(500, (rainbowPeriod(d.rainbowSpeed) * 1000) / 90));
  bgTimer = setInterval(bgTick, document.hasFocus() ? ms : ms * 2);
}

export function applyDesign() {
  const d = current();
  if (!d.npBg) return; // 설정을 아직 못 받음
  const dark = isDark();
  const root = document.documentElement;

  const vars = d.accent ? accentVars(d.accent, dark) : null;
  for (const k of ['--accent', '--accent-text', '--accent-weak']) {
    if (vars) root.style.setProperty(k, vars[k]);
    else root.style.removeProperty(k);
  }
  const accentHex = getComputedStyle(root).getPropertyValue('--accent').trim();
  const accentRgb = hexToRgb(accentHex) || [29, 111, 230];

  const np = document.getElementById('np');
  const period = rainbowPeriod(d.rainbowSpeed);
  np.dataset.bg = d.npBg;
  np.dataset.fps = String(d.fps || 30);
  document.body.classList.toggle('lite', liteActive()); // 커버 회전·목록의 '재생 중' 막대 (CSS)
  np.style.setProperty('--rb-period', `${period}s`);
  const tint =
    d.npBg === 'album' || d.npBg === 'blur'
      ? albumRgb && npTint(albumRgb, dark)
      : d.npBg === 'random'
        ? hsl(hue, 55, dark ? 22 : 86)
        : d.npBg === 'custom'
          ? customTint(d.npBgColor, dark)
          : null;
  if (tint) np.style.setProperty('--np-tint', tint);
  else np.style.removeProperty('--np-tint');
  np.style.setProperty('--np-cover', coverSrc ? `url("${coverSrc}")` : 'none');
  np.style.setProperty('--np-strength', String(d.npBgStrength / 100));
  updateBgClock();

  const cover = d.spectrum ? d.spectrumStyle : 'off';
  np.classList.toggle('show-strip', ['bars', 'mirror', 'wave'].includes(cover));
  np.classList.toggle('show-ring', cover === 'circle');
  np.classList.toggle('show-bottom', d.spectrum && d.spectrumBottom !== 'off');
  document.getElementById('mini').classList.toggle('viz-on', d.spectrum && d.spectrumMini);
  const palette = spectrumPalette(d.spectrumColor, {
    album: albumRgb,
    hue,
    accent: accentHex,
    custom: d.spectrumCustom,
    dark,
    period,
    offset: LINK_OFFSET[d.rainbowLink] ?? 0,
  });
  // 박자에 맞춰 커버 뒤에서 번지는 빛: 스펙트럼 색 (무지개면 다크는 흰빛, 라이트는 포인트 색)
  np.style.setProperty('--glow-c', palette.a ? rgb(palette.a, 0.75) : dark ? 'rgb(255 255 255 / 0.55)' : rgb(accentRgb, 0.55));

  fx?.configure({
    effect: d.effect,
    amount: d.effectAmount,
    scope: d.effectScope,
    color: d.effectColor,
    react: d.effectReact,
    coverBeat: d.coverBeat,
    accent: accentRgb,
    period,
    dark,
    fps: d.fps || 30,
  });
  viz?.configure({ enabled: d.spectrum, cover: d.spectrumStyle, bottom: d.spectrumBottom, mini: d.spectrumMini, palette, fps: d.fps || 30 });
  refreshDots();
}

// ───── 디자인 탭 ─────

const dot = (bg, cls = '') => `<span class="dot ${cls}"${bg ? ` style="background:${bg}"` : ''}></span>`;

function lead(v, d, kind) {
  if (v === 'album') return dot(albumRgb ? rgbToHex(albumRgb) : '', 'album');
  if (v === 'blur') return dot(albumRgb ? rgbToHex(albumRgb) : '', 'album blur');
  if (v === 'random') return dot(hsl(hue, 75, 58), 'random');
  if (v === 'rainbow') return dot('', 'rainbow');
  if (v === 'cycle') return dot('', 'cycle');
  if (v === 'accent') return dot('var(--accent)');
  if (v === 'custom') return dot(kind === 'viz' ? d.spectrumCustom : d.npBgColor);
  if (v === 'off') return dot('', 'none');
  return '';
}

const chip = (k, v, label, on, pre = '') =>
  `<button class="chip${on ? ' on' : ''}" data-k="${k}" data-v="${v}" aria-pressed="${on}">${pre}<span>${label}</span></button>`;

const colorRow = (k, value) => `<div class="swatches small">${PRESETS.map(
  (c) => `<button class="sw${c === value ? ' on' : ''}" data-k="${k}" data-v="${c}" style="--c:${c}" aria-label="${c}"></button>`,
).join('')}<label class="sw pick${PRESETS.includes(value) ? '' : ' on'}" style="--c:${PRESETS.includes(value) ? 'transparent' : value}" title="색 고르기">${icon('plus')}<input type="color" data-k="${k}" value="${esc(value)}" aria-label="색 고르기"></label></div>`;

// 슬라이더: unit = pct(0~100%) · period(무지개 한 바퀴 초)
const range = (k, label, value, min, max, unit, off = false) =>
  `<label class="dz-range${off ? ' off' : ''}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" data-k="${k}" data-unit="${unit}" value="${value}" style="--p:${((value - min) / (max - min)) * 100}%"><output>${unit === 'period' ? periodText(value) : `${value}%`}</output></label>`;

const switchRow = (k, label, on, sub = '') =>
  `<div class="dz-switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`;

const effectLead = (v, emoji) => (v === 'off' ? dot('', 'none') : v === 'fireflies' ? dot('', 'firefly') : `<span class="emo">${emoji}</span>`);

export function renderDesign() {
  if (!panel) return;
  const d = saved();
  const customAccent = d.accent && !ACCENTS.some(([v]) => v === d.accent);
  const rainbowUsed = ['rainbow', 'cycle'].includes(d.npBg) || ['rainbow', 'cycle'].includes(d.spectrumColor) || d.effectColor === 'rainbow';
  const themed = Object.keys(trackTheme()).length > 0;
  panel.innerHTML = `<div class="design">
${liteActive() ? `<div class="dz-banner">${icon('power')}<span><b>저사양 모드</b>가 켜져 있어요${liteSetting() === 'battery' ? ' (배터리로 쓰는 중)' : ''}. ${LITE_TEXT}. 여기서 고른 값은 그대로 남아 있다가 끄면 돌아와요</span><button class="btn small" data-act="lite-off">끄기</button></div>` : ''}
${themed ? `<div class="dz-banner">${icon('palette')}<span>지금 곡에는 <b>이 곡 화면 테마</b>가 있어서 배경·스펙트럼 색·효과는 그 설정이 먼저 보여요</span><button class="btn small" data-act="theme-edit">테마 편집</button></div>` : ''}
<section class="dz">
  <div class="dz-head"><div class="label"><b>포인트 색</b><small>버튼 · 탭 · 진행 막대 · 설정 제목</small></div></div>
  <div class="swatches">${ACCENTS.map(
    ([v, name, show]) => `<button class="sw${d.accent === v ? ' on' : ''}" data-k="accent" data-v="${v}" style="--c:${show || v}" title="${name}" aria-label="${name}"></button>`,
  ).join('')}<label class="sw pick${customAccent ? ' on' : ''}" style="--c:${customAccent ? d.accent : 'transparent'}" title="직접 고르기">${icon('plus')}<input type="color" data-k="accent" value="${esc(d.accent || '#1d6fe6')}" aria-label="포인트 색 직접 고르기"></label></div>
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>재생 화면 배경</b><small>재생 화면 위에서 내려오는 색</small></div></div>
  <div class="chips">${BG_MODES.map(([v, l]) => chip('npBg', v, l, d.npBg === v, lead(v, d, 'bg'))).join('')}</div>
  ${d.npBg === 'custom' ? colorRow('npBgColor', d.npBgColor) : ''}
  ${d.npBg === 'random' ? '<p class="dz-note">곡이 바뀔 때마다 새 색이 나와요. 랜덤을 한 번 더 누르면 지금 바꿔요</p>' : ''}
  ${d.npBg === 'album' ? '<p class="dz-note">커버 그림의 대표 색을 써요 (삼성 뮤직처럼)</p>' : ''}
  ${d.npBg === 'blur' ? '<p class="dz-note">커버 그림을 크게 흐려서 배경에 깔아요. 커버가 없는 곡은 기본 배경이에요</p>' : ''}
  ${d.npBg === 'rainbow' ? '<p class="dz-note">여러 색이 함께 천천히 흘러요</p>' : ''}
  ${d.npBg === 'cycle' ? '<p class="dz-note">한 가지 색이 무지개 순서로 서서히 바뀌어요</p>' : ''}
  ${range('npBgStrength', '진하기', d.npBgStrength, 0, 100, 'pct', d.npBg === 'off')}
</section>
<section class="dz${d.spectrum ? '' : ' off'}">
  <div class="dz-head"><div class="label"><b>오디오 스펙트럼</b><small>재생 중인 소리를 주파수별로 그려요</small></div>
    <label class="switch"><input type="checkbox" data-k="spectrum" ${d.spectrum ? 'checked' : ''} aria-label="오디오 스펙트럼"><span></span></label></div>
  <div class="dz-body">
    <div class="dz-sub">커버 쪽</div>
    <div class="chips">${COVER_STYLES.map(([v, l, ic]) => chip('spectrumStyle', v, l, d.spectrumStyle === v, ic ? icon(ic) : dot('', 'none'))).join('')}</div>
    ${d.spectrumStyle === 'circle' ? '<p class="dz-note">원형은 커버 둘레에 그려요. 커버가 LP처럼 돌아요</p>' : ''}
    <div class="dz-sub">화면 아래 전체</div>
    <div class="chips">${BOTTOM_STYLES.map(([v, l, ic]) => chip('spectrumBottom', v, l, d.spectrumBottom === v, ic ? icon(ic) : dot('', 'none'))).join('')}</div>
    <div class="dz-sub">색</div>
    <div class="chips">${VIZ_COLORS.map(([v, l]) => chip('spectrumColor', v, l, d.spectrumColor === v, lead(v, d, 'viz'))).join('')}</div>
    ${d.spectrumColor === 'custom' ? colorRow('spectrumCustom', d.spectrumCustom) : ''}
    ${switchRow('spectrumMini', '미니 플레이어에도 보이기', d.spectrumMini)}
  </div>
</section>
<section class="dz${rainbowUsed ? '' : ' off'}">
  <div class="dz-head"><div class="label"><b>무지개</b><small>배경 · 스펙트럼 · 화면 효과에서 무지개를 고르면 써요</small></div></div>
  <div class="dz-body">
    ${range('rainbowSpeed', '속도', d.rainbowSpeed, 1, 10, 'period')}
    <div class="dz-sub">위쪽 배경과 스펙트럼의 색</div>
    <div class="chips">${LINKS.map(([v, l]) => chip('rainbowLink', v, l, d.rainbowLink === v)).join('')}</div>
    <p class="dz-note">같은 색: 둘이 같은 색으로 함께 바뀌어요 · 조금 다르게: 무지개에서 몇 칸 떨어진 색 · 반대 색: 정반대 색</p>
  </div>
</section>
<section class="dz${d.effect === 'off' ? ' off' : ''}">
  <div class="dz-head"><div class="label"><b>화면 효과</b><small>눈이 내리거나 꽃잎·낙엽이 날려요</small></div></div>
  <div class="chips">${EFFECTS.map(([v, l, emoji]) => chip('effect', v, l, d.effect === v, effectLead(v, emoji))).join('')}</div>
  <div class="dz-body">
    ${range('effectAmount', '양', d.effectAmount, 1, 100, 'pct')}
    <div class="dz-sub">색</div>
    <div class="chips">${EFFECT_COLORS.map(([v, l]) => chip('effectColor', v, l, d.effectColor === v, v === 'natural' ? '' : lead(v, d))).join('')}</div>
    <div class="dz-sub">보일 곳</div>
    <div class="chips">${SCOPES.map(([v, l]) => chip('effectScope', v, l, d.effectScope === v)).join('')}</div>
    ${switchRow('effectReact', '음악에 반응', d.effectReact, '박자에 맞춰 빨라지고 밝아져요')}
  </div>
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>박자에 맞춰 커버가</b><small>음악이 나올 때 낮은음(쿵쿵)에 맞춰 움직여요</small></div></div>
  <div class="chips">${BEATS.map(([v, l]) => chip('coverBeat', v, l, d.coverBeat === v, v === 'off' ? dot('', 'none') : '')).join('')}</div>
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>움직임 부드러움</b><small>스펙트럼·화면 효과를 1초에 몇 번 그릴지. 낮출수록 CPU를 덜 써요 (다른 창을 보고 있을 때는 알아서 줄여요)</small></div></div>
  <div class="chips">${FPS.map(([v, l]) => chip('fps', v, `${l} · 초당 ${v}번`, (d.fps || 30) === v)).join('')}</div>
  <div class="dz-sub">저사양 모드</div>
  <div class="chips">${LITE.map(([v, l]) => `<button class="chip${liteSetting() === v ? ' on' : ''}" data-lite="${v}" aria-pressed="${liteSetting() === v}"><span>${l}</span></button>`).join('')}</div>
  <p class="dz-note">${LITE_TEXT}. 고른 디자인은 그대로 남아요${liteStatus() ? ` · ${liteStatus()}` : ''}</p>
</section>
${layoutSection()}
<div class="dz-foot"><button class="btn small" data-act="design-reset">${icon('history')}기본값으로 되돌리기</button></div>
</div>`;
}

function layoutSection() {
  const l = layout();
  const lchip = (k, v, label) => `<button class="chip${l[k] === v ? ' on' : ''}" data-l="${k}" data-v="${v}" aria-pressed="${l[k] === v}"><span>${label}</span></button>`;
  const lsw = (k, label, sub = '') =>
    `<div class="dz-switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" data-l="${k}" ${l[k] ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`;
  const tabs = l.tabs
    .map((id, i) => {
      const shown = !l.hiddenTabs.includes(id);
      return `<div class="tab-row${shown ? '' : ' off'}"><label class="switch"><input type="checkbox" data-tabshow="${id}" ${shown ? 'checked' : ''} aria-label="${TAB_NAMES[id]} 탭 보이기"><span></span></label><span class="name">${TAB_NAMES[id]}</span><button class="icon-btn" data-tabmove="${id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="앞으로">${icon('up')}</button><button class="icon-btn" data-tabmove="${id}" data-d="1" ${i === l.tabs.length - 1 ? 'disabled' : ''} aria-label="뒤로">${icon('down')}</button></div>`;
    })
    .join('');
  return `<section class="dz">
  <div class="dz-head"><div class="label"><b>화면 배치</b><small>재생 화면과 미니 플레이어에 무엇을 어디에 둘지</small></div></div>
  <div class="dz-sub">커버 크기</div>
  <div class="chips">${lchip('coverSize', 's', '작게')}${lchip('coverSize', 'm', '보통')}${lchip('coverSize', 'l', '크게')}</div>
  <div class="dz-sub">옆 패널 (재생 순서·가사·사운드·디자인)</div>
  <div class="chips">${lchip('panelSide', 'right', '오른쪽')}${lchip('panelSide', 'left', '왼쪽')}</div>
  <p class="dz-note">넓은 창에서만 옆에 나와요. 좁은 창에서는 아래에서 올라와요</p>
  ${lsw('showSource', '재생 출처', '맨 위의 "앨범 · 이름", "재생목록 · 이름"')}
  ${lsw('showQuality', '음질 표시', '제목 아래 FLAC 24bit/96kHz 같은 표시')}
  ${lsw('showExtra', '보조 버튼', '재생 속도 · A-B 반복 · 수면 타이머 · 사운드 · 디자인 버튼 (⋮ 메뉴에도 있어요)')}
  <div class="dz-sub">미니 플레이어 버튼</div>
  <div class="chips">${MINI_BUTTONS.map(([k, label, ic]) => `<button class="chip${l[k] ? ' on' : ''}" data-ltoggle="${k}" aria-pressed="${l[k]}">${icon(ic)}<span>${label}</span></button>`).join('')}</div>
  <div class="dz-sub">위쪽 탭 · 순서와 보이기</div>
  <div class="tab-list">${tabs}</div>
</section>`;
}

// 곡이 바뀌어도 탭 전체를 다시 그리지 않고(색 고르는 창이 닫히지 않게) 색 점만 바꾼다
function refreshDots() {
  if (!panel) return;
  for (const el of panel.querySelectorAll('.dot.album')) el.style.background = albumRgb ? rgbToHex(albumRgb) : '';
  for (const el of panel.querySelectorAll('.dot.random')) el.style.background = hsl(hue, 75, 58);
}

async function save(patch) {
  preview = {};
  if (patch) store.settings.design = { ...store.settings.design, ...patch }; // 바로 반영하고 서버에 저장
  applyDesign();
  renderDesign();
  try {
    store.settings = await put('/api/settings', { design: patch });
    if (!patch) toast('기본 디자인으로 되돌렸어요');
  } catch (err) {
    toast(err.message, 4000);
  }
  applyDesign();
  renderDesign();
}

function bindPanel(el) {
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="design-reset"]')) return save(null);
    if (e.target.closest('[data-act="theme-edit"]')) return trackThemeDialog(ctx.player?.track);
    if (e.target.closest('[data-act="lite-off"]')) return setLite('off');
    const lite = e.target.closest('button[data-lite]');
    if (lite) return setLite(lite.dataset.lite);
    const lb = e.target.closest('button[data-l][data-v]');
    if (lb) return saveLayout({ [lb.dataset.l]: lb.dataset.v });
    const lt = e.target.closest('button[data-ltoggle]');
    if (lt) return saveLayout({ [lt.dataset.ltoggle]: !layout()[lt.dataset.ltoggle] });
    const mv = e.target.closest('button[data-tabmove]');
    if (mv) {
      const tabs = layout().tabs.slice();
      const i = tabs.indexOf(mv.dataset.tabmove);
      const j = i + Number(mv.dataset.d);
      if (i < 0 || j < 0 || j >= tabs.length) return undefined;
      [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
      return saveLayout({ tabs });
    }
    const b = e.target.closest('button[data-k][data-v]');
    if (!b) return undefined;
    const { k, v } = b.dataset;
    if (v === 'random' && saved()[k] === 'random') {
      hue = randomHue(hue); // 랜덤을 한 번 더 누르면 지금 새 색
      return applyDesign();
    }
    return save({ [k]: k === 'fps' ? Number(v) : v });
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    const k = t.dataset.k;
    if (!k) return;
    if (t.type === 'color') {
      preview = { ...preview, [k]: t.value };
      t.closest('.sw')?.style.setProperty('--c', t.value);
    } else if (t.type === 'range') {
      const v = Number(t.value);
      const min = Number(t.min);
      const max = Number(t.max);
      preview = { ...preview, [k]: v };
      t.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
      t.parentElement.querySelector('output').textContent = t.dataset.unit === 'period' ? periodText(v) : `${v}%`;
    } else return;
    applyDesign();
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.l && t.type === 'checkbox') return saveLayout({ [t.dataset.l]: t.checked });
    if (t.dataset.tabshow) {
      const l = layout();
      const hidden = t.checked ? l.hiddenTabs.filter((x) => x !== t.dataset.tabshow) : [...l.hiddenTabs, t.dataset.tabshow];
      if (hidden.length >= l.tabs.length) {
        t.checked = true;
        return toast('탭은 하나 이상 보여야 해요');
      }
      return saveLayout({ hiddenTabs: hidden });
    }
    const k = t.dataset.k;
    if (!k) return undefined;
    if (t.type === 'checkbox') return save({ [k]: t.checked });
    if (t.type === 'color') return save({ [k]: t.value });
    if (t.type === 'range') return save({ [k]: Number(t.value) });
    return undefined;
  });
}
