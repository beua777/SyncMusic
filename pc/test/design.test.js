// 디자인 설정: 색 계산 · 스펙트럼 막대 계산 · 서버의 설정 검사
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  accentVars,
  contrast,
  customTint,
  cycleHue,
  hexToRgb,
  hslToRgb,
  LINK_OFFSET,
  rainbowPeriod,
  randomHue,
  rgbToHex,
  rgbToHsl,
  spectrumPalette,
} from '../public/js/colors.js';
import { effectCount } from '../public/js/effects.js';
import { bandEdges, bandLevels, bassLevel, BeatFollower, demoLevels, fallLevels, volumeGainDb } from '../public/js/spectrum.js';
import { DESIGN_DEFAULTS, normalizeDesign, Settings } from '../src/settings.js';

test('색 변환은 서로 되돌릴 수 있음', () => {
  for (const hex of ['#1d6fe6', '#ff4fa3', '#000000', '#ffffff', '#7a5cff']) {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    assert.equal(rgbToHex(hslToRgb(h, s, l)), hex);
  }
  assert.equal(hexToRgb('파랑'), null);
});

test('포인트 색은 테마 배경 위에서 읽히게 밝기를 맞춤', () => {
  const yellow = accentVars('#ffe600', false);
  assert.ok(contrast(hexToRgb(yellow['--accent']), [246, 246, 246]) >= 3, '라이트: 노랑은 어둡게');
  const navy = accentVars('#1a237e', true);
  assert.ok(contrast(hexToRgb(navy['--accent']), [0, 0, 0]) >= 4.5, '다크: 남색은 밝게');
  assert.equal(accentVars('#ffe600', true)['--accent-text'], '#0b0b0f', '밝은 버튼 위 글자는 검게');
  assert.equal(accentVars('#1a237e', false)['--accent-text'], '#ffffff');
  assert.equal(accentVars('없음', false), null);
});

test('직접 고른 배경 색은 색상은 그대로, 밝기는 테마에 맞게', () => {
  assert.match(customTint('#ff0000', true), /^hsl\(0 85% (1[6-9]|2\d|3[0-8])%\)$/);
  assert.match(customTint('#ff0000', false), /^hsl\(0 85% (6[89]|[78]\d|90)%\)$/);
});

test('랜덤 색은 바로 전 색과 50도 넘게 다름', () => {
  let prev = null;
  for (let i = 0; i < 200; i++) {
    const h = randomHue(prev);
    if (prev !== null) assert.ok(Math.abs(((h - prev + 540) % 360) - 180) > 50 || h === (prev + 180) % 360);
    prev = h;
  }
});

test('스펙트럼 색: 무지개 · 앨범 색 · 흑백 커버 · 직접 고른 색', () => {
  assert.equal(spectrumPalette('rainbow').rainbow, true);
  const red = spectrumPalette('album', { album: [180, 40, 40] });
  assert.ok(red.a[0] > red.a[2], '빨간 커버 → 빨간 막대');
  const gray = spectrumPalette('album', { album: [120, 120, 120], dark: true });
  assert.equal(Math.round(rgbToHsl(gray.a)[1]), 0, '흑백 커버는 회색 막대');
  assert.deepEqual(spectrumPalette('custom', { custom: '#00ff88' }).a, [0, 255, 136]);
  assert.deepEqual(spectrumPalette('album', { accent: '#112233' }).a, [17, 34, 51], '커버가 없으면 포인트 색');
});

test('막대는 낮은음부터 높은음까지 빈틈없이, 겹치지 않게 나눔', () => {
  for (const n of [24, 48, 96]) {
    const b = bandEdges(n);
    assert.equal(b.length, n);
    for (let i = 0; i < n; i++) {
      assert.ok(b[i].end > b[i].start, `${n}개 중 ${i}번 막대가 빈 칸`);
      if (i) assert.equal(b[i].start, b[i - 1].end);
    }
    assert.ok(b[0].hz < 80 && b[n - 1].hz > 9000);
    const bass = b.filter((x) => x.hz < 250).length;
    assert.ok(bass >= n * 0.1 && bass <= n * 0.3, `낮은음 막대 ${bass}/${n}`);
  }
});

test('음량을 줄여도 막대 높이는 같게 (음량만큼 되돌림)', () => {
  const bands = bandEdges(32);
  const loud = new Float32Array(2048).fill(-40);
  const quiet = loud.map((v) => v + 20 * Math.log10(0.25));
  const a = bandLevels(loud, bands, new Float32Array(32));
  const b = bandLevels(quiet, bands, new Float32Array(32), { gainDb: volumeGainDb(0.25) });
  for (let i = 0; i < 32; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5);
  assert.equal(volumeGainDb(0), 0, '음소거는 그대로 0');
  const silent = bandLevels(new Float32Array(2048).fill(-Infinity), bands, new Float32Array(32));
  assert.ok(silent.every((v) => v === 0));
});

test('막대는 바로 올라가고 천천히 내려감', () => {
  const shown = new Float32Array([0.2, 0.9]);
  assert.equal(fallLevels(shown, [0.8, 0], 0.1), true);
  assert.ok(Math.abs(shown[0] - 0.8) < 1e-6);
  assert.ok(Math.abs(shown[1] - 0.74) < 1e-6);
  assert.equal(fallLevels(shown, [0, 0], 1), false, '다 내려가면 그리기를 멈출 수 있음');
  assert.ok(demoLevels(new Float32Array(40), 1.5).every((v) => v > 0 && v <= 1));
});

test('서버는 디자인 설정을 검사하고, 모르는 값은 기본값으로', () => {
  assert.deepEqual(normalizeDesign(undefined), DESIGN_DEFAULTS);
  const d = normalizeDesign({ accent: '#FF00AA', npBg: 'rainbow', npBgStrength: 140, spectrumStyle: 'laser', spectrumColor: 'custom', spectrumCustom: 'red', spectrum: 'yes' });
  assert.equal(d.accent, '#ff00aa');
  assert.equal(d.npBg, 'rainbow');
  assert.equal(d.npBgStrength, 100);
  assert.equal(d.spectrumStyle, DESIGN_DEFAULTS.spectrumStyle);
  assert.equal(d.spectrumColor, 'custom');
  assert.equal(d.spectrumCustom, DESIGN_DEFAULTS.spectrumCustom);
  assert.equal(d.spectrum, DESIGN_DEFAULTS.spectrum);
  assert.equal(normalizeDesign({ spectrumBottom: 'wave' }).spectrumBottom, 'wave', '화면 아래 전체');
  assert.equal(normalizeDesign({ spectrumBottom: 'circle' }).spectrumBottom, 'off', '원형은 커버 쪽에만');
  assert.equal(normalizeDesign({ spectrumStyle: 'off', npBg: 'cycle', spectrumColor: 'cycle' }).spectrumStyle, 'off');
  assert.deepEqual(
    ['npBg', 'spectrumColor'].map((k) => normalizeDesign({ npBg: 'cycle', spectrumColor: 'cycle' })[k]),
    ['cycle', 'cycle'],
    '무지개 단색',
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-design-'));
  try {
    const s = new Settings(dir);
    s.update({ design: { npBg: 'custom', npBgColor: '#123456' } });
    s.update({ design: { spectrumStyle: 'circle' } });
    assert.deepEqual([s.data.design.npBg, s.data.design.npBgColor, s.data.design.spectrumStyle], ['custom', '#123456', 'circle'], '고친 값만 바뀜');
    s.update({ design: null });
    assert.deepEqual(s.data.design, DESIGN_DEFAULTS, 'null이면 기본값으로');
    s.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('예전 "위치" 설정은 새 자리로 옮김 (커버 쪽 · 화면 아래 전체를 따로)', () => {
  const was = (design) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-design-'));
    try {
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ design }));
      return new Settings(dir).data.design;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const bottom = was({ spectrumStyle: 'wave', spectrumPlace: 'bottom', spectrumColor: 'rainbow' });
  assert.deepEqual([bottom.spectrumStyle, bottom.spectrumBottom, bottom.spectrumColor], ['off', 'wave', 'rainbow']);
  assert.equal('spectrumPlace' in bottom, false, '없어진 항목은 버림');
  const ring = was({ spectrumStyle: 'circle', spectrumPlace: 'cover' });
  assert.deepEqual([ring.spectrumStyle, ring.spectrumBottom], ['circle', 'off']);
});

test('무지개 속도: 보통(5)은 한 바퀴 24초, 빠를수록 짧게', () => {
  assert.equal(rainbowPeriod(5), 24);
  assert.equal(rainbowPeriod(1), 96);
  assert.ok(Math.abs(rainbowPeriod(10) - 24 / 2 ** 2.5) < 1e-9);
  for (let s = 1; s < 10; s++) assert.ok(rainbowPeriod(s) > rainbowPeriod(s + 1));
  assert.equal(rainbowPeriod(0), 96, '범위 밖은 끝값');
  assert.equal(rainbowPeriod('이상한 값'), 24);
});

test('무지개 단색: 정한 속도로 한 바퀴, 스펙트럼은 위쪽 배경과 정한 만큼 어긋남', () => {
  assert.equal(cycleHue(0), 0);
  assert.equal(cycleHue(12_000, 24), 180);
  assert.equal(cycleHue(3000, 6), 180, '빠르게');
  assert.ok(cycleHue(24_000 + 1, 24) < 0.1, '한 바퀴 돌면 처음 색');
  const p = spectrumPalette('cycle', { dark: true, period: 10, offset: LINK_OFFSET.opposite });
  assert.deepEqual([p.cycle, p.rainbow, p.period, p.offset], [true, undefined, 10, 180]);
  assert.deepEqual(LINK_OFFSET, { same: 0, shift: 90, opposite: 180 });
  assert.equal(spectrumPalette('rainbow', { offset: 90 }).offset, 90, '여러 색 무지개도 어긋나게');
});

test('새 디자인 항목: 무지개 속도·색 차이, 화면 효과, 커버 흐리게, 박자 반응', () => {
  const d = normalizeDesign({
    npBg: 'blur',
    rainbowSpeed: '8',
    rainbowLink: 'opposite',
    effect: 'sakura',
    effectAmount: 250,
    effectScope: 'all',
    effectColor: 'rainbow',
    effectReact: false,
    coverBeat: 'both',
  });
  assert.deepEqual(
    [d.npBg, d.rainbowSpeed, d.rainbowLink, d.effect, d.effectAmount, d.effectScope, d.effectColor, d.effectReact, d.coverBeat],
    ['blur', 8, 'opposite', 'sakura', 100, 'all', 'rainbow', false, 'both'],
  );
  const bad = normalizeDesign({ rainbowSpeed: 0, rainbowLink: 'x', effect: 'fire', effectAmount: -5, effectScope: 'x', effectColor: 'x', effectReact: 'yes', coverBeat: 'x' });
  assert.deepEqual(
    [bad.rainbowSpeed, bad.rainbowLink, bad.effect, bad.effectAmount, bad.effectScope, bad.effectColor, bad.effectReact, bad.coverBeat],
    [1, 'same', 'off', 1, 'np', 'natural', true, 'off'],
  );
});

test('박자: 낮은음 세기는 음량과 상관없고, 갑자기 커질 때 크게 튐', () => {
  const loud = new Float32Array(2048).fill(-30);
  const quiet = loud.map((v) => v - 20); // 음량 10%
  assert.ok(bassLevel(loud) > 0.8);
  assert.ok(Math.abs(bassLevel(quiet, { gainDb: volumeGainDb(0.1) }) - bassLevel(loud)) < 1e-6);
  assert.equal(bassLevel(new Float32Array(2048).fill(-Infinity)), 0, '소리 없음');

  const b = new BeatFollower();
  let steady = 0;
  for (let i = 0; i < 300; i++) steady = b.step(0.5, 1 / 60);
  assert.ok(Math.abs(steady - 0.175) < 0.02, `같은 세기면 잔잔하게: ${steady}`);
  const kick = b.step(1, 1 / 60);
  assert.ok(kick > steady + 0.5, `쿵! ${kick}`);
  let after = kick;
  for (let i = 0; i < 30; i++) after = b.step(0.5, 1 / 60);
  assert.ok(after < kick - 0.4, '천천히 가라앉음');
});

test('화면 효과 개수: 창 크기·양에 맞춰, 끄면 0', () => {
  assert.equal(effectCount('snow', 1920, 1080, 50), 150);
  assert.equal(effectCount('snow', 1920, 1080, 100), 300, '양 2배');
  assert.ok(effectCount('snow', 960, 540, 50) < 150, '작은 창은 적게');
  assert.equal(effectCount('off', 1920, 1080, 50), 0);
  assert.equal(effectCount('hearts', 100, 100, 1), 1, '아무리 적어도 하나는');
});
