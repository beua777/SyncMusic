import os from 'node:os';
import path from 'node:path';
import { defaultMusicDir } from './config.js';
import { JsonStore } from './util/jsonfile.js';

// 디자인 꾸미기 (설정 → 디자인 꾸미기, 재생 화면의 디자인 탭)
export const DESIGN_DEFAULTS = Object.freeze({
  accent: '', // 포인트 색: '' = 기본 파랑, '#rrggbb' = 직접 고른 색
  npBg: 'album', // 재생 화면 위에서 내려오는 색: album · random · rainbow(여러 색) · cycle(무지개 단색) · custom · off
  npBgColor: '#7c5cff',
  npBgStrength: 100, // 0~100
  spectrum: true, // 오디오 스펙트럼
  spectrumStyle: 'bars', // 커버 쪽: bars · mirror · wave · circle(커버 둘레) · off
  spectrumBottom: 'off', // 재생 화면 아래 전체: bars · mirror · wave · off (커버 쪽과 따로)
  spectrumColor: 'album', // album · rainbow(여러 색) · cycle(무지개 단색) · random · accent · custom
  spectrumCustom: '#3fa9ff',
  spectrumMini: true, // 미니 플레이어에도
});

const HEX = /^#[0-9a-f]{6}$/i;
const SHAPES = ['bars', 'mirror', 'wave'];
const ENUMS = {
  npBg: ['album', 'random', 'rainbow', 'cycle', 'custom', 'off'],
  spectrumStyle: [...SHAPES, 'circle', 'off'],
  spectrumBottom: [...SHAPES, 'off'],
  spectrumColor: ['album', 'rainbow', 'cycle', 'random', 'accent', 'custom'],
};

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
  if (Number.isFinite(Number(r.npBgStrength)) && r.npBgStrength !== null && r.npBgStrength !== '') {
    o.npBgStrength = Math.round(Math.max(0, Math.min(100, Number(r.npBgStrength))));
  }
  for (const k of ['spectrum', 'spectrumMini']) if (typeof r[k] === 'boolean') o[k] = r[k];
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
    });
    this.store.data.design = normalizeDesign(this.store.data.design); // 예전 파일에 없던 항목 채우기
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
    this.store.save();
    return { foldersChanged };
  }

  flush() {
    this.store.flush();
  }
}
