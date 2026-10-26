// 설정 검사: 소리 · 가사 · 전원 · 화면 배치 · 목표 · 단축키 · 저장한 필터 · 검색 기록 · 장치 음량 · 곡 테마
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DESIGN_DEFAULTS, normalizeDesign, normalizeSection, normalizeTheme, SECTIONS, Settings } from '../src/settings.js';

test('소리 설정: 범위·단계로 맞추고, 모르는 값은 그대로 둔다', () => {
  const a = normalizeSection('audio', { crossfade: 30, fadeMs: 1234, eqPre: 3.3, rate: 1.23, normalize: 'loud', normTarget: -30, eqBands: [1, 2, 3], shuffleSpread: '40', keepPitch: 'yes' });
  assert.equal(a.crossfade, 12);
  assert.equal(a.fadeMs, 1250);
  assert.equal(a.eqPre, 3.5);
  assert.equal(a.rate, 1.25);
  assert.equal(a.normalize, 'off', '모르는 값');
  assert.equal(a.normTarget, -23);
  assert.deepEqual(a.eqBands, SECTIONS.audio.defaults.eqBands, '밴드 수가 다르면 무시');
  assert.equal(a.shuffleSpread, 40);
  assert.equal(a.keepPitch, true);
  const b = normalizeSection('audio', { eqBands: [13, -20, 0.26, 'x', 0, 0, 0, 0, 0, 0] }, a);
  assert.deepEqual(b.eqBands.slice(0, 4), [12, -12, 0.5, 0]);
});

test('화면 배치: 탭 순서는 아는 탭만·빠진 탭은 뒤에, 숨긴 탭은 아는 것만', () => {
  const l = normalizeSection('layout', { tabs: ['folders', 'tracks', 'nope', 'tracks'], hiddenTabs: ['albums', 'x'], coverSize: 'xl' });
  assert.deepEqual(l.tabs, ['folders', 'tracks', 'playlists', 'albums', 'artists']);
  assert.deepEqual(l.hiddenTabs, ['albums']);
  assert.equal(l.coverSize, 'm');
  assert.deepEqual(normalizeSection('power', { sleepAction: 'shutdown' }).sleepAction, 'shutdown');
  assert.equal(normalizeSection('power', {}).lite, 'off', '저사양 모드는 기본 꺼짐');
  assert.equal(normalizeSection('power', { lite: 'battery' }).lite, 'battery');
  assert.equal(normalizeSection('power', { lite: 'max' }, { lite: 'on' }).lite, 'on', '모르는 값이면 원래 값');
  assert.deepEqual(normalizeSection('lyrics', { size: 'xl', style: 'karaoke', translate: false }), { size: 'xl', align: 'left', style: 'karaoke', translate: false, online: true });
  assert.deepEqual(normalizeSection('goals', { dailyMinutes: 2000, weeklyNew: -3 }), { dailyMinutes: 1440, weeklyNew: 0 });
});

test('디자인: 움직임 부드러움(초당 그리기)은 15·30·60만', () => {
  assert.equal(DESIGN_DEFAULTS.fps, 30);
  assert.equal(normalizeDesign({ fps: 60 }).fps, 60);
  assert.equal(normalizeDesign({ fps: '15' }).fps, 15);
  assert.equal(normalizeDesign({ fps: 45 }).fps, 30);
  assert.equal(normalizeDesign({ fps: 45 }, { ...DESIGN_DEFAULTS, fps: 60 }).fps, 60, '잘못 들어오면 원래 값');
});

test('이 곡 화면 테마: 아는 키·값만 남기고, 하나도 없으면 null', () => {
  assert.deepEqual(normalizeTheme({ npBg: 'rainbow', effect: 'snow', npBgColor: '#ABCDEF', evil: '<script>', spectrumColor: 'nope' }), { npBg: 'rainbow', effect: 'snow', npBgColor: '#abcdef' });
  assert.equal(normalizeTheme({ npBg: 'url(javascript:1)' }), null);
  assert.equal(normalizeTheme('x'), null);
  assert.equal(normalizeTheme(null), null);
});

test('설정 파일: 단축키·필터·검색 기록·장치 음량 검사, null이면 그 묶음을 기본값으로', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Settings(dir, [dir]);
  s.update({
    shortcuts: { mute: 'N', toggle: '', 'bad key': 'X', next: '<b>' },
    savedFilters: [{ name: ' 운동 ', filter: { rules: [] } }, { name: '', filter: {} }, { name: 'x' }],
    searchHistory: ['  요아소비 ', '요아소비', '', 3, 'lemon'],
    deviceVolumes: { 'dev-1': 0.4, 'dev-2': 7, 'bad id!': 0.5 },
    audio: { crossfade: 5 },
    layout: { coverSize: 'l' },
  });
  const d = s.data;
  assert.deepEqual(d.shortcuts, { mute: 'N', toggle: '' });
  assert.equal(d.savedFilters.length, 1);
  assert.equal(d.savedFilters[0].name, '운동');
  assert.ok(d.savedFilters[0].id);
  assert.deepEqual(d.searchHistory, ['요아소비', 'lemon']);
  assert.deepEqual(d.deviceVolumes, { 'dev-1': 0.4, 'dev-2': 1 });
  assert.equal(d.audio.crossfade, 5);
  s.update({ audio: null, deviceVolumes: { 'dev-3': 0.2 } });
  assert.equal(d.audio.crossfade, 0, '소리 설정 기본값으로');
  assert.equal(d.layout.coverSize, 'l', '다른 묶음은 그대로');
  assert.deepEqual(Object.keys(d.deviceVolumes).sort(), ['dev-1', 'dev-2', 'dev-3'], '장치 음량은 합친다');
  s.flush();
  const again = new Settings(dir);
  assert.equal(again.data.layout.coverSize, 'l', '다시 열어도 그대로');
});
