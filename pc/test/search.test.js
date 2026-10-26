// 검색: 자연어 · 고급 필터 · 오타 허용 · 발음(로마자·가나·한글)으로 찾기
import assert from 'node:assert/strict';
import test from 'node:test';
import { hangulToRomaji, kanaToRomaji, phoneticKey, scripts } from '../public/js/phonetic.js';
import { allowedTypos, applyFilter, approxDistance, decompose, describeRule, fuzzySearch, langOf, matchRule, parseNatural } from '../public/js/search.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26, 12);
const tracks = [
  { id: '1', title: '夜に駆ける', artist: 'YOASOBI', album: 'THE BOOK', year: 2019, duration: 261, playCount: 40, addedAt: NOW - 5 * DAY, lastPlayed: NOW - DAY, lossless: true, hasLyrics: true },
  { id: '2', title: '바람의 노래', artist: '하늘빛', album: '봄날의 산책', year: 1995, duration: 175, playCount: 0, addedAt: NOW - 200 * DAY, lastPlayed: 0 },
  { id: '3', title: 'Lemon', artist: '米津玄師', album: 'BOOTLEG', year: 2018, duration: 255, playCount: 12, skips: 4, addedAt: NOW - 100 * DAY, lastPlayed: NOW - 120 * DAY, hasLyrics: true },
  { id: '4', title: 'City Lights', artist: 'Neon Coast', album: 'Night Drive', year: 1998, duration: 150, playCount: 3, addedAt: NOW - 10 * DAY, lastPlayed: NOW - 3 * DAY },
];
const ctx = { now: NOW, isFavorite: (id) => id === '3', inPlaylist: (id) => id === '1' };

test('발음 열쇠: 같은 이름을 한글·로마자·가나로 써도 같은 열쇠', () => {
  assert.equal(phoneticKey('요아소비'), phoneticKey('YOASOBI'));
  assert.equal(phoneticKey('ヨアソビ'), phoneticKey('yoasobi'));
  assert.equal(phoneticKey('ヨルシカ'), phoneticKey('요루시카'));
  assert.equal(phoneticKey('アイドル'), phoneticKey('아이도루'));
  assert.notEqual(phoneticKey('요아소비'), phoneticKey('요루시카'));
});

test('가나·한글 → 로마자', () => {
  assert.equal(kanaToRomaji('きゃりーぱみゅぱみゅ'), 'kyaripamyupamyu');
  assert.equal(kanaToRomaji('がっこう'), 'gakkou');
  assert.equal(kanaToRomaji('ファン'), 'fan');
  assert.equal(hangulToRomaji('한글'), 'hangeul');
  assert.deepEqual(scripts('夜に駆ける'), { kana: true, kanji: true, hangul: false, latin: false });
});

test('곡의 언어 짐작', () => {
  assert.equal(langOf(tracks[0]), 'ja');
  assert.equal(langOf(tracks[1]), 'ko');
  assert.equal(langOf(tracks[3]), 'en');
});

test('자연어: "최근 추가한 일본 노래 10곡"', () => {
  const r = parseNatural('최근 추가한 일본 노래 10곡');
  assert.equal(r.limit, 10);
  assert.deepEqual(r.sort, { by: 'addedAt', dir: 'desc' });
  assert.ok(r.rules.some((x) => x.field === 'addedAt' && x.op === 'withinDays' && x.value === 30));
  assert.ok(r.rules.some((x) => x.field === 'language' && x.value === 'ja'));
  assert.equal(r.text, '');
  const out = applyFilter(tracks, r, ctx);
  assert.deepEqual(out.map((t) => t.id), ['1']);
});

test('자연어: 가수 이름은 가수 조건으로, 많이 들은 순서로', () => {
  const r = parseNatural('많이 들은 YOASOBI 노래', { artists: ['YOASOBI', '하늘빛'] });
  assert.deepEqual(r.sort, { by: 'playCount', dir: 'desc' });
  assert.ok(r.rules.some((x) => x.field === 'artist' && x.op === 'is' && x.value === 'YOASOBI'));
  assert.ok(r.labels.includes('가수: YOASOBI'));
});

test('자연어: 길이 · 연대 · 안 들은 곡 · 알아듣지 못하면 null', () => {
  const short = parseNatural('3분 이하 짧은 곡');
  assert.equal(short.rules.filter((x) => x.field === 'duration').length, 1, '짧은 곡 조건이 두 번 붙지 않음');
  assert.deepEqual(applyFilter(tracks, short, ctx).map((t) => t.id), ['2', '4']);
  assert.deepEqual(parseNatural('90년대').rules[0], { field: 'year', op: 'between', value: [1990, 1999] });
  assert.deepEqual(applyFilter(tracks, parseNatural('90년대'), ctx).map((t) => t.id).sort(), ['2', '4']);
  assert.deepEqual(applyFilter(tracks, parseNatural('안 들은 곡'), ctx).map((t) => t.id), ['2']);
  assert.deepEqual(applyFilter(tracks, parseNatural('오래 안 들은 노래'), ctx).map((t) => t.id), ['3']);
  assert.equal(parseNatural('lemon'), null);
});

test('고급 필터: 모두/하나라도 · 정렬 · 개수 · 즐겨찾기·재생목록 같은 곡 밖의 정보', () => {
  const rules = [
    { field: 'playCount', op: 'gt', value: 5 },
    { field: 'favorite', op: 'is', value: true },
  ];
  assert.deepEqual(applyFilter(tracks, { match: 'all', rules }, ctx).map((t) => t.id), ['3']);
  assert.deepEqual(applyFilter(tracks, { match: 'any', rules, sort: { by: 'playCount', dir: 'asc' } }, ctx).map((t) => t.id), ['3', '1']);
  // 제목 정렬은 한국어 순서 (한글 → 한자 → 영어)
  assert.deepEqual(applyFilter(tracks, { rules: [], sort: { by: 'title', dir: 'asc' }, limit: 2 }, ctx).map((t) => t.title), ['바람의 노래', '夜に駆ける']);
  assert.equal(matchRule(tracks[0], { field: 'inPlaylist', op: 'is', value: true }, ctx), true);
  assert.equal(matchRule(tracks[1], { field: 'lastPlayed', op: 'never' }, ctx), true);
  assert.equal(matchRule(tracks[3], { field: 'addedAt', op: 'withinDays', value: 7 }, ctx), false);
  assert.equal(matchRule(tracks[3], { field: 'title', op: 'contains', value: 'city light' }, ctx), true, '띄어쓰기·대소문자 무시');
  assert.equal(describeRule({ field: 'addedAt', op: 'withinDays', value: 30 }), '추가한 날: 최근 30일');
  assert.equal(describeRule({ field: 'lossless', op: 'is', value: true }), '무손실');
});

test('오타 허용: 자모로 풀어서 한두 글자 틀려도 찾고, 짧은 말은 엄격하게', () => {
  assert.equal(decompose('노래'), 'ㄴㅗㄹㅐ');
  assert.equal(approxDistance(decompose('노레'), decompose('바람의 노래')), 1);
  const lib = tracks.map((t) => ({ ...t, _f: decompose(`${t.title} ${t.artist} ${t.album}`) }));
  assert.deepEqual(fuzzySearch(lib, '바람의 노레').map((t) => t.id), ['2']);
  assert.deepEqual(fuzzySearch(lib, 'Lemno').map((t) => t.id), ['3']);
  assert.equal(allowedTypos(3), 0);
  assert.deepEqual(fuzzySearch(lib, 'Lmn'), [], '짧은 말은 오타를 허용하지 않음');
});
