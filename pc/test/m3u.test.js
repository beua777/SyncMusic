// 삼성 뮤직 재생목록 파일 (.m3u / .m3u8 / .smpl)
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchItems, parsePlaylistFile, safeFileName, writeM3u } from '../src/m3u.js';

test('삼성 뮤직 .m3u: 절대 경로 + #EXTINF', () => {
  const text = '#EXTM3U\n#EXTINF:215,아이유 - 밤편지\n/storage/emulated/0/Music/아이유/밤편지.mp3\n#EXTINF:-1,\n/storage/emulated/0/Download/song.flac\n';
  const p = parsePlaylistFile(text, '드라이브.m3u');
  assert.equal(p.name, '드라이브');
  assert.equal(p.format, 'm3u');
  assert.deepEqual(p.items[0], { path: '/storage/emulated/0/Music/아이유/밤편지.mp3', title: '밤편지', artist: '아이유', duration: 215 });
  assert.equal(p.items[1].path, '/storage/emulated/0/Download/song.flac');
  assert.equal(p.items[1].duration, null);
});

test('BOM · CRLF · file:// · #PLAYLIST', () => {
  const text = '\uFEFF#EXTM3U\r\n#PLAYLIST:여름 노래\r\nfile:///C:/Music/%EC%97%AC%EB%A6%84.mp3\r\n\r\nD:\\Music\\b.mp3\r\n';
  const p = parsePlaylistFile(text, 'x.m3u8');
  assert.equal(p.name, '여름 노래');
  assert.equal(p.format, 'm3u8');
  assert.deepEqual(
    p.items.map((i) => i.path),
    ['C:/Music/여름.mp3', 'D:\\Music\\b.mp3'],
  );
});

test('구형 기기 .smpl(JSON): order 순서대로', () => {
  const smpl = JSON.stringify({
    name: '운동',
    members: [
      { info: '/storage/emulated/0/Music/b.mp3', order: 2, title: 'B', artist: 'X', type: 65537 },
      { info: '/storage/emulated/0/Music/a.mp3', order: 1, title: 'A', artist: 'X', type: 65537 },
    ],
    sortBy: 4,
    version: 1,
  });
  const p = parsePlaylistFile(smpl, '운동.smpl');
  assert.equal(p.name, '운동');
  assert.equal(p.format, 'smpl');
  assert.deepEqual(
    p.items.map((i) => i.title),
    ['A', 'B'],
  );
  assert.equal(p.items[0].path, '/storage/emulated/0/Music/a.mp3');
});

test('writeM3u → parsePlaylistFile 왕복 (한글·길이)', () => {
  const items = [
    { path: '/storage/emulated/0/Music/SyncMusic/하늘빛/꽃길.wav', duration: 20.4, artist: '하늘빛', title: '꽃길' },
    { path: '/storage/emulated/0/Music/x.mp3', duration: 0, artist: null, title: 'X' },
  ];
  const text = writeM3u(items);
  assert.ok(text.startsWith('#EXTM3U\n#EXTINF:20,하늘빛 - 꽃길\n'));
  const p = parsePlaylistFile(text, 'a.m3u');
  assert.deepEqual(
    p.items.map((i) => [i.path, i.title, i.artist]),
    [
      [items[0].path, '꽃길', '하늘빛'],
      [items[1].path, 'X', null],
    ],
  );
});

test('파일 이름 정리', () => {
  assert.equal(safeFileName('a/b:c?'), 'a_b_c_');
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('   '), '재생목록');
  assert.equal(safeFileName('끝에 점...'), '끝에 점');
});

test('곡 맞추기: 경로 → 파일 이름 → 제목+가수', () => {
  const tracks = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } };
  const lib = {
    get: (id) => tracks[id] || null,
    idForPath: (p) => (p.toLowerCase().endsWith('one.mp3') ? 'a' : null),
    findByFileName: (n) => (n === 'two.mp3' ? tracks.b : null),
    findByMeta: (title) => (title === '셋' ? tracks.c : null),
  };
  const { ids, missing } = matchItems(
    [
      { path: 'C:\\Music\\one.mp3' },
      { path: '/storage/emulated/0/Music/two.mp3' },
      { path: '/nowhere/3.mp3', title: '셋', artist: '가수' },
      { path: '/nowhere/4.mp3', title: '넷' },
    ],
    lib,
  );
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(missing.length, 1);
});
