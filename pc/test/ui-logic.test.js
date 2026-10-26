// 화면 쪽 순수 계산: 단축키 표 · 재생목록 중복 곡 찾기 · 저사양 모드
import assert from 'node:assert/strict';
import test from 'node:test';
import { playlistDuplicates, withoutDuplicates } from '../public/js/dupes.js';
import { ACTIONS, actionFor, bindings, comboOf, fmtCombo, keyName, overridesOf, RESERVED } from '../public/js/keymap.js';
import { liteActive, liteDesign } from '../public/js/lite.js';
import { store } from '../public/js/store.js';

const key = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('키 이름은 자판 위치(code) 기준: 한/영 상태와 상관없이 같은 키', () => {
  assert.equal(keyName('KeyM'), 'M');
  assert.equal(keyName('Digit0'), '0');
  assert.equal(keyName('Numpad5'), 'Num5');
  assert.equal(keyName('Period'), 'Period');
  assert.equal(keyName('ShiftLeft'), '', 'Shift만 누른 건 단축키가 아님');
  assert.equal(keyName('Lang1'), '', '한/영 키');
  assert.equal(comboOf(key('KeyS', { ctrlKey: true })), 'Ctrl+S');
  assert.equal(comboOf(key('Period', { shiftKey: true, ctrlKey: true })), 'Ctrl+Shift+Period');
  assert.equal(comboOf(key('ArrowRight', { metaKey: true })), 'Ctrl+ArrowRight', 'Mac의 ⌘도 Ctrl로');
  assert.equal(fmtCombo('Ctrl+Shift+Period'), 'Ctrl + Shift + .');
  assert.equal(fmtCombo(''), '없음');
});

test('단축키 표: 기본 키가 겹치지 않고, 바꾼 키·끈 키가 반영됨', () => {
  const defaults = ACTIONS.map((a) => a.key).filter(Boolean);
  assert.equal(new Set(defaults).size, defaults.length, '기본 키 중복 없음');
  assert.ok(defaults.every((k) => !RESERVED.has(k)), '목록 이동 키와 안 겹침');
  assert.equal(actionFor('Space', {}), 'toggle');
  assert.equal(actionFor('KeyM', {}), null, '키 이름은 M');
  assert.equal(actionFor('M', {}), 'mute');
  const custom = { mute: 'N', toggle: '' };
  assert.equal(actionFor('N', custom), 'mute');
  assert.equal(actionFor('M', custom), null);
  assert.equal(actionFor('Space', custom), null, '끈 단축키');
  const map = bindings(custom);
  assert.equal(map.next, 'Ctrl+ArrowRight');
  assert.deepEqual(overridesOf(map), { mute: 'N', toggle: '' }, '기본과 다른 것만 저장');
  // 서버의 설정 검사(이름: 영문, 값: 키 글자)를 통과하는 모양
  for (const a of ACTIONS) assert.match(a.id, /^[a-zA-Z]{1,30}$/);
  for (const k of defaults) assert.match(k, /^[\w+\-=[\];',./\\`]*$/);
});

test('재생목록 중복: 같은 곡 ID가 또 나오면 빼고, 제목·가수가 같고 길이가 3초 안쪽인 다른 파일도', () => {
  const lib = new Map(
    [
      { id: 'a', title: '봄날', artist: '하늘빛', duration: 200 },
      { id: 'b', title: '봄날 ', artist: '하늘빛', duration: 201.5 }, // 다른 파일 (공백만 다름)
      { id: 'c', title: '봄날', artist: '하늘빛', duration: 260 }, // 라이브 (길이가 다름)
      { id: 'd', title: '다른 곡', artist: '하늘빛', duration: 200 },
    ].map((t) => [t.id, t]),
  );
  const get = (id) => lib.get(id);
  const entries = ['a', 'd', 'b', 'a', 'c', 'x', 'x'];
  const dups = playlistDuplicates(entries, get);
  assert.deepEqual(
    dups.map((d) => [d.index, d.kind, d.of]),
    [
      [2, 'similar', 0],
      [3, 'same', 0],
      [6, 'same', 5],
    ],
  );
  assert.deepEqual(withoutDuplicates(entries, dups), ['a', 'd', 'c', 'x']);
  assert.deepEqual(
    playlistDuplicates(entries, get, { similar: false }).map((d) => d.index),
    [3, 6],
    '같은 파일만',
  );
});

test('저사양 모드: 고른 디자인은 그대로 두고 보이는 값만 가볍게 (배경은 움직이거나 무거울 때만 앨범 색으로)', () => {
  const mine = { npBg: 'cycle', spectrum: true, spectrumStyle: 'circle', spectrumBottom: 'bars', spectrumColor: 'cycle', spectrumMini: true, effect: 'stars', coverBeat: 'both', fps: 60, accent: '#e8457c' };
  const lite = liteDesign(mine);
  assert.deepEqual(
    { fps: lite.fps, effect: lite.effect, coverBeat: lite.coverBeat, spectrumBottom: lite.spectrumBottom, spectrumMini: lite.spectrumMini, npBg: lite.npBg },
    { fps: 15, effect: 'off', coverBeat: 'off', spectrumBottom: 'off', spectrumMini: false, npBg: 'album' },
  );
  assert.equal(lite.spectrumStyle, 'circle', '커버 쪽 스펙트럼은 남김');
  assert.equal(lite.accent, '#e8457c');
  assert.equal(mine.effect, 'stars', '원래 값은 바꾸지 않음');
  for (const bg of ['rainbow', 'blur']) assert.equal(liteDesign({ npBg: bg }).npBg, 'album');
  for (const bg of ['custom', 'random', 'off', 'album']) assert.equal(liteDesign({ npBg: bg }).npBg, bg);
});

test('저사양 모드 켜짐 여부: 켜기 · 끄기 · 배터리일 때만(배터리 상태를 모르면 꺼짐)', () => {
  const was = store.settings;
  try {
    store.settings = { power: { lite: 'on' } };
    assert.equal(liteActive(), true);
    store.settings = { power: { lite: 'off' } };
    assert.equal(liteActive(), false);
    store.settings = { power: { lite: 'battery' } };
    assert.equal(liteActive(), false, 'Node에는 배터리 정보가 없음');
    store.settings = {};
    assert.equal(liteActive(), false);
  } finally {
    store.settings = was;
  }
});
