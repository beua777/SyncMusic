// 디자인 꾸미기: 포인트 색 · 재생 화면 배경(위에서 내려오는 색) · 오디오 스펙트럼
import { put } from '../api.js';
import { accentVars, customTint, CYCLE_SECONDS, hsl, npTint, randomHue, rgbToHex, spectrumPalette } from '../colors.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { esc } from '../util.js';
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

let viz = null;
let albumRgb = null; // 지금 곡 커버의 대표 색
let hue = randomHue(); // 랜덤 모드의 색 (곡이 바뀔 때마다 새로)
let preview = {}; // 색을 고르는 동안(아직 저장 전) 미리 보여 줄 값
let panel = null;

const current = () => ({ ...store.settings.design, ...preview });

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
};

export function initDesign(visualizer, el) {
  viz = visualizer;
  panel = el;
  bindPanel(el);
  applyDesign();
}

// 곡이 바뀌면 랜덤 색을 새로 뽑는다 (커버 색은 setAlbumColor로 따로 들어옴)
export function designTrackChanged() {
  hue = randomHue(hue);
  applyDesign();
}

export function setAlbumColor(rgb) {
  albumRgb = rgb;
  applyDesign();
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

  const np = document.getElementById('np');
  if (d.npBg === 'cycle' && np.dataset.bg !== 'cycle') {
    // 배경 애니메이션을 스펙트럼과 같은 시계에 맞춘다 (둘 다 무지개 단색이면 같은 색)
    np.querySelector('.np-bg').style.animationDelay = `${-((performance.now() / 1000) % CYCLE_SECONDS).toFixed(3)}s`;
  }
  np.dataset.bg = d.npBg;
  const tint =
    d.npBg === 'album' ? albumRgb && npTint(albumRgb, dark) : d.npBg === 'random' ? hsl(hue, 55, dark ? 22 : 86) : d.npBg === 'custom' ? customTint(d.npBgColor, dark) : null;
  if (tint) np.style.setProperty('--np-tint', tint);
  else np.style.removeProperty('--np-tint');
  np.style.setProperty('--np-strength', String(d.npBgStrength / 100));

  const cover = d.spectrum ? d.spectrumStyle : 'off';
  np.classList.toggle('show-strip', ['bars', 'mirror', 'wave'].includes(cover));
  np.classList.toggle('show-ring', cover === 'circle');
  np.classList.toggle('show-bottom', d.spectrum && d.spectrumBottom !== 'off');
  document.getElementById('mini').classList.toggle('viz-on', d.spectrum && d.spectrumMini);
  const accent = getComputedStyle(root).getPropertyValue('--accent').trim();
  viz?.configure({
    enabled: d.spectrum,
    cover: d.spectrumStyle,
    bottom: d.spectrumBottom,
    mini: d.spectrumMini,
    palette: spectrumPalette(d.spectrumColor, { album: albumRgb, hue, accent, custom: d.spectrumCustom, dark }),
  });
  refreshDots();
}

// ───── 디자인 탭 ─────

const dot = (bg, cls = '') => `<span class="dot ${cls}"${bg ? ` style="background:${bg}"` : ''}></span>`;

function lead(v, d, kind) {
  if (v === 'album') return dot(albumRgb ? rgbToHex(albumRgb) : '', 'album');
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

export function renderDesign() {
  if (!panel) return;
  const d = current();
  const customAccent = d.accent && !ACCENTS.some(([v]) => v === d.accent);
  panel.innerHTML = `<div class="design">
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
  ${d.npBg === 'rainbow' ? '<p class="dz-note">여러 색이 함께 천천히 흘러요</p>' : ''}
  ${d.npBg === 'cycle' ? '<p class="dz-note">한 가지 색이 무지개 순서로 서서히 바뀌어요</p>' : ''}
  <label class="dz-range${d.npBg === 'off' ? ' off' : ''}"><span>진하기</span><input type="range" min="0" max="100" step="1" data-k="npBgStrength" value="${d.npBgStrength}" style="--p:${d.npBgStrength}%"><output>${d.npBgStrength}%</output></label>
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
    <div class="dz-switch"><span>미니 플레이어에도 보이기</span><label class="switch"><input type="checkbox" data-k="spectrumMini" ${d.spectrumMini ? 'checked' : ''} aria-label="미니 플레이어에도 보이기"><span></span></label></div>
  </div>
</section>
<div class="dz-foot"><button class="btn small" data-act="design-reset">${icon('history')}기본값으로 되돌리기</button></div>
</div>`;
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
    const b = e.target.closest('button[data-k][data-v]');
    if (!b) return undefined;
    const { k, v } = b.dataset;
    if (v === 'random' && current()[k] === 'random') {
      hue = randomHue(hue); // 랜덤을 한 번 더 누르면 지금 새 색
      return applyDesign();
    }
    return save({ [k]: v });
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    const k = t.dataset.k;
    if (!k) return;
    if (t.type === 'color') {
      preview = { ...preview, [k]: t.value };
      t.closest('.sw')?.style.setProperty('--c', t.value);
    } else if (t.type === 'range') {
      preview = { ...preview, [k]: Number(t.value) };
      t.style.setProperty('--p', `${t.value}%`);
      t.parentElement.querySelector('output').textContent = `${t.value}%`;
    } else return;
    applyDesign();
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    const k = t.dataset.k;
    if (!k) return;
    if (t.type === 'checkbox') save({ [k]: t.checked });
    else if (t.type === 'color') save({ [k]: t.value });
    else if (t.type === 'range') save({ [k]: Number(t.value) });
  });
}
