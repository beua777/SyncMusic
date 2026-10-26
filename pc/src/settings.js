import os from 'node:os';
import path from 'node:path';
import { defaultMusicDir } from './config.js';
import { JsonStore } from './util/jsonfile.js';

// 디자인 꾸미기 (설정 → 디자인 꾸미기, 재생 화면의 디자인 탭)
export const DESIGN_DEFAULTS = Object.freeze({
  accent: '', // 포인트 색: '' = 기본 파랑, '#rrggbb' = 직접 고른 색
  npBg: 'album', // 재생 화면 위에서 내려오는 색: album · blur(커버 흐리게) · random · rainbow(여러 색) · cycle(무지개 단색) · custom · off
  npBgColor: '#7c5cff',
  npBgStrength: 100, // 0~100
  spectrum: true, // 오디오 스펙트럼
  spectrumStyle: 'bars', // 커버 쪽: bars · mirror · wave · circle(커버 둘레) · off
  spectrumBottom: 'off', // 재생 화면 아래 전체: bars · mirror · wave · off (커버 쪽과 따로)
  spectrumColor: 'album', // album · rainbow(여러 색) · cycle(무지개 단색) · random · accent · custom
  spectrumCustom: '#3fa9ff',
  spectrumMini: true, // 미니 플레이어에도
  rainbowSpeed: 5, // 무지개가 바뀌는 속도 1(느리게) ~ 10(빠르게)
  rainbowLink: 'same', // 위쪽 배경과 스펙트럼의 무지개 색: same(같은 색) · shift(조금 다르게) · opposite(반대 색)
  effect: 'off', // 화면 효과: off · snow · sakura · leaves · rain · stars · fireflies · bubbles · hearts
  effectAmount: 50, // 1~100
  effectScope: 'np', // np(재생 화면에서만) · all(앱 전체)
  effectColor: 'natural', // natural(효과마다 기본 색) · rainbow · accent
  effectReact: true, // 음악 박자에 맞춰 빨라지고 밝아짐
  coverBeat: 'off', // 박자에 맞춰 커버가: off · pulse(커짐) · glow(뒤에서 빛남) · both
  fps: 30, // 스펙트럼·화면 효과를 초당 몇 번 그릴지: 15(절약) · 30(보통) · 60(부드럽게). 높을수록 CPU를 많이 씀
});

const HEX = /^#[0-9a-f]{6}$/i;
const SHAPES = ['bars', 'mirror', 'wave'];
const ENUMS = {
  npBg: ['album', 'blur', 'random', 'rainbow', 'cycle', 'custom', 'off'],
  spectrumStyle: [...SHAPES, 'circle', 'off'],
  spectrumBottom: [...SHAPES, 'off'],
  spectrumColor: ['album', 'rainbow', 'cycle', 'random', 'accent', 'custom'],
  rainbowLink: ['same', 'shift', 'opposite'],
  effect: ['off', 'snow', 'sakura', 'leaves', 'rain', 'stars', 'fireflies', 'bubbles', 'hearts'],
  effectScope: ['np', 'all'],
  effectColor: ['natural', 'rainbow', 'accent'],
  coverBeat: ['off', 'pulse', 'glow', 'both'],
};
const RANGES = { npBgStrength: [0, 100], rainbowSpeed: [1, 10], effectAmount: [1, 100] };

// 들어온 값 중 올바른 것만 base 위에 덮는다 (모르는 항목은 버림)
export function normalizeDesign(raw, base = DESIGN_DEFAULTS) {
  const r = raw && typeof raw === 'object' ? { ...raw } : {};
  // 예전 '위치'(커버 아래 · 화면 아래 전체 중 하나)가 화면 아래였으면, 그 모양을 아래 자리로 옮긴다
  if (r.spectrumPlace === 'bottom' && r.spectrumBottom === undefined && SHAPES.includes(r.spectrumStyle)) {
    r.spectrumBottom = r.spectrumStyle;
    r.spectrumStyle = 'off';
  }
  const o = {};
  for (const k of Object.keys(DESIGN_DEFAULTS)) o[k] = base[k] ?? DESIGN_DEFAULTS[k];
  if (r.accent === '' || HEX.test(r.accent)) o.accent = r.accent.toLowerCase();
  for (const k of ['npBgColor', 'spectrumCustom']) if (HEX.test(r[k])) o[k] = r[k].toLowerCase();
  for (const [k, list] of Object.entries(ENUMS)) if (list.includes(r[k])) o[k] = r[k];
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (Number.isFinite(Number(r[k])) && r[k] !== null && r[k] !== '') o[k] = Math.round(Math.max(lo, Math.min(hi, Number(r[k]))));
  }
  for (const k of ['spectrum', 'spectrumMini', 'effectReact']) if (typeof r[k] === 'boolean') o[k] = r[k];
  if ([15, 30, 60].includes(Number(r.fps))) o.fps = Number(r.fps);
  return o;
}

// 이 곡 화면 테마: 곡이 나올 때만 디자인 일부(배경·스펙트럼 색·화면 효과)를 바꾼다. 아는 값만 남긴다 (없으면 null)
export function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = {};
  for (const k of ['npBg', 'spectrumColor', 'effect']) if (ENUMS[k].includes(raw[k])) o[k] = raw[k];
  for (const k of ['npBgColor', 'spectrumCustom']) if (HEX.test(raw[k])) o[k] = raw[k].toLowerCase();
  return Object.keys(o).length ? o : null;
}

// ───── 나머지 설정 묶음: 항목마다 모양(스키마)을 적어 두고 같은 방식으로 검사한다 ─────
const enm = (...values) => ({ values });
const num = (lo, hi, step = 1) => ({ lo, hi, step });
const bool = { bool: true };
const nums = (len, lo, hi) => ({ len, lo, hi });

export const SECTIONS = {
  // 소리
  audio: {
    defaults: {
      crossfade: 0, // 곡 사이 크로스페이드 초 (0 = 끄기)
      fadeMs: 0, // 재생·일시정지할 때 페이드 (ms)
      eqOn: false,
      eqPreset: 'flat',
      eqPre: 0, // 프리앰프 dB
      eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      normalize: 'off', // 음량 평준화: off · track(곡마다) · album(앨범마다)
      normTarget: -14, // 목표 세기 LUFS
      rate: 1, // 재생 속도
      keepPitch: true, // 속도를 바꿔도 음 높이는 그대로
      skipSilence: false, // 곡 앞뒤·가운데 긴 무음 건너뛰기
      deviceVolume: true, // 출력 장치마다 음량 기억
      shuffleMode: 'random', // random(고르게, 삼성 뮤직처럼) · smart(취향)
      shuffleSpread: 0, // 아티스트·앨범 다양성 0~100
      noRepeatArtist: false, // 같은 아티스트 연속 재생 막기
    },
    schema: {
      crossfade: num(0, 12),
      fadeMs: num(0, 3000, 50),
      eqOn: bool,
      eqPreset: enm('flat', 'bass', 'treble', 'vocal', 'pop', 'rock', 'jazz', 'classical', 'electronic', 'hiphop', 'acoustic', 'night', 'custom'),
      eqPre: num(-12, 12, 0.5),
      eqBands: nums(10, -12, 12),
      normalize: enm('off', 'track', 'album'),
      normTarget: num(-23, -8),
      rate: num(0.5, 2, 0.05),
      keepPitch: bool,
      skipSilence: bool,
      deviceVolume: bool,
      shuffleMode: enm('random', 'smart'),
      shuffleSpread: num(0, 100),
      noRepeatArtist: bool,
    },
  },
  // 가사 표시
  lyrics: {
    defaults: { size: 'm', align: 'left', style: 'scale', translate: true, online: true },
    schema: { size: enm('s', 'm', 'l', 'xl'), align: enm('left', 'center'), style: enm('scale', 'color', 'karaoke'), translate: bool, online: bool },
  },
  // 전원·성능: 수면 타이머가 끝나면 · 재생 중에는 화면이 잠들지 않게 ·
  // 저사양 모드(off · on · battery=배터리로 쓸 때만): 고른 디자인은 그대로 두고 무거운 효과만 쉰다
  power: {
    defaults: { sleepAction: 'pause', keepAwake: false, lite: 'off' },
    schema: { sleepAction: enm('pause', 'quit', 'sleep', 'shutdown'), keepAwake: bool, lite: enm('off', 'on', 'battery') },
  },
  // 화면 배치
  layout: {
    defaults: {
      coverSize: 'm',
      panelSide: 'right',
      showSource: true,
      showQuality: true,
      showExtra: true,
      miniShuffle: true,
      miniRepeat: true,
      miniQueue: true,
      miniVolume: true,
      tabs: ['tracks', 'playlists', 'albums', 'artists', 'folders'],
      hiddenTabs: [],
    },
    schema: {
      coverSize: enm('s', 'm', 'l'),
      panelSide: enm('right', 'left'),
      showSource: bool,
      showQuality: bool,
      showExtra: bool,
      miniShuffle: bool,
      miniRepeat: bool,
      miniQueue: bool,
      miniVolume: bool,
      tabs: { order: ['tracks', 'playlists', 'albums', 'artists', 'folders'] },
      hiddenTabs: { subset: ['tracks', 'playlists', 'albums', 'artists', 'folders'] },
    },
  },
  // 청취 목표 (0 = 없음)
  goals: {
    defaults: { dailyMinutes: 0, weeklyNew: 0 },
    schema: { dailyMinutes: num(0, 1440), weeklyNew: num(0, 500) },
  },
};

function normalizeValue(rule, v, cur) {
  if (rule.values) return rule.values.includes(v) ? v : cur;
  if (rule.bool) return typeof v === 'boolean' ? v : cur;
  if (rule.len) {
    if (!Array.isArray(v) || v.length !== rule.len) return cur;
    return v.map((x, i) => (Number.isFinite(Number(x)) ? Math.max(rule.lo, Math.min(rule.hi, Math.round(Number(x) * 2) / 2)) : cur[i]));
  }
  if (rule.order) {
    // 순서 바꾸기: 아는 값만, 빠진 것은 뒤에 붙인다
    if (!Array.isArray(v)) return cur;
    const seen = v.filter((x, i) => rule.order.includes(x) && v.indexOf(x) === i);
    return [...seen, ...rule.order.filter((x) => !seen.includes(x))];
  }
  if (rule.subset) return Array.isArray(v) ? rule.subset.filter((x) => v.includes(x)) : cur;
  if ('lo' in rule) {
    if (v === null || v === '' || !Number.isFinite(Number(v))) return cur;
    const step = rule.step || 1;
    return Math.max(rule.lo, Math.min(rule.hi, Math.round(Number(v) / step) * step));
  }
  return cur;
}

export function normalizeSection(name, raw, base) {
  const { defaults, schema } = SECTIONS[name];
  const b = { ...defaults, ...(base && typeof base === 'object' ? base : {}) };
  const r = raw && typeof raw === 'object' ? raw : {};
  const o = {};
  for (const [k, rule] of Object.entries(schema)) o[k] = k in r ? normalizeValue(rule, r[k], b[k]) : b[k];
  return o;
}

const MAX_KEY = 40;
// 단축키: 동작 이름 → 'Ctrl+Shift+K' 같은 글자
function normalizeShortcuts(raw) {
  const o = {};
  if (!raw || typeof raw !== 'object') return o;
  for (const [k, v] of Object.entries(raw).slice(0, 60)) {
    if (/^[a-zA-Z]{1,30}$/.test(k) && typeof v === 'string' && v.length <= MAX_KEY && /^[\w+\-=[\];',./\\`]*$/.test(v)) o[k] = v;
  }
  return o;
}

// 저장된 검색 필터: [{ id, name, filter }]
function normalizeFilters(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.name.trim() && f.filter && typeof f.filter === 'object')
    .slice(0, 50)
    .map((f) => ({ id: typeof f.id === 'string' && /^[\w-]{1,40}$/.test(f.id) ? f.id : Math.random().toString(36).slice(2, 10), name: f.name.trim().slice(0, 60), filter: JSON.parse(JSON.stringify(f.filter)) }))
    .filter((f) => JSON.stringify(f.filter).length < 4000);
}

const normalizeHistory = (raw) =>
  Array.isArray(raw) ? [...new Set(raw.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 100)))].slice(0, 20) : [];

// 출력 장치마다 음량: { 장치 ID: 0~1 }
function normalizeDeviceVolumes(raw) {
  const o = {};
  if (!raw || typeof raw !== 'object') return o;
  for (const [k, v] of Object.entries(raw).slice(0, 40)) if (/^[\w{}.-]{1,80}$/.test(k) && Number.isFinite(Number(v))) o[k] = Math.max(0, Math.min(1, Number(v)));
  return o;
}

export class Settings {
  constructor(dataDir, musicFolders) {
    this.store = new JsonStore(path.join(dataDir, 'settings.json'), {
      musicFolders: [defaultMusicDir()],
      theme: 'system', // system | light | dark
      pcName: os.hostname(),
      tapKeepsShuffle: true, // 목록에서 곡을 누를 때 셔플 유지 (끄면 삼성 도움말의 '목록 순서대로')
      design: { ...DESIGN_DEFAULTS },
      shortcuts: {},
      savedFilters: [],
      searchHistory: [],
      deviceVolumes: {},
      updateCheck: true, // GitHub에 새 버전이 있는지 확인
    });
    const d = this.store.data;
    d.design = normalizeDesign(d.design); // 예전 파일에 없던 항목 채우기
    for (const name of Object.keys(SECTIONS)) d[name] = normalizeSection(name, d[name]);
    d.shortcuts = normalizeShortcuts(d.shortcuts);
    d.savedFilters = normalizeFilters(d.savedFilters);
    d.searchHistory = normalizeHistory(d.searchHistory);
    d.deviceVolumes = normalizeDeviceVolumes(d.deviceVolumes);
    if (musicFolders) {
      this.store.data.musicFolders = musicFolders.map((f) => path.resolve(f));
      this.store.save();
    }
  }

  get data() {
    return this.store.data;
  }

  update(patch = {}) {
    const d = this.data;
    let foldersChanged = false;
    if (Array.isArray(patch.musicFolders)) {
      const next = [];
      for (const f of patch.musicFolders) {
        if (typeof f !== 'string' || !path.isAbsolute(f)) continue;
        const p = path.resolve(f);
        if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
      }
      foldersChanged = next.join('|') !== d.musicFolders.join('|');
      d.musicFolders = next;
    }
    if (['system', 'light', 'dark'].includes(patch.theme)) d.theme = patch.theme;
    if (typeof patch.pcName === 'string' && patch.pcName.trim()) d.pcName = patch.pcName.trim().slice(0, 40);
    if (typeof patch.tapKeepsShuffle === 'boolean') d.tapKeepsShuffle = patch.tapKeepsShuffle;
    if (patch.design === null) d.design = { ...DESIGN_DEFAULTS };
    else if (patch.design && typeof patch.design === 'object') d.design = normalizeDesign(patch.design, d.design);
    for (const name of Object.keys(SECTIONS)) {
      if (patch[name] === null) d[name] = normalizeSection(name, {});
      else if (patch[name] && typeof patch[name] === 'object') d[name] = normalizeSection(name, patch[name], d[name]);
    }
    if (patch.shortcuts !== undefined) d.shortcuts = normalizeShortcuts(patch.shortcuts);
    if (patch.savedFilters !== undefined) d.savedFilters = normalizeFilters(patch.savedFilters);
    if (patch.searchHistory !== undefined) d.searchHistory = normalizeHistory(patch.searchHistory);
    if (patch.deviceVolumes && typeof patch.deviceVolumes === 'object') d.deviceVolumes = normalizeDeviceVolumes({ ...d.deviceVolumes, ...patch.deviceVolumes });
    if (typeof patch.updateCheck === 'boolean') d.updateCheck = patch.updateCheck;
    this.store.save();
    return { foldersChanged };
  }

  flush() {
    this.store.flush();
  }
}
