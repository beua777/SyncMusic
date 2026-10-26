// 가사: LRC 읽기·쓰기 · 온라인에서 찾을 때 쓰는 제목 다듬기 · 찾을 말 뽑기 · 결과 점수
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fmtStamp, parseLrc, plainLines, toLrc } from '../public/js/lrc.js';
import { phoneticKey } from '../public/js/phonetic.js';
import { cleanTitle, findLyrics, guessArtistTitle, lyricTerms, nameSim, scoreResult, TranslateBlocked, Translator } from '../src/lyrics.js';

test('LRC: 메타 · 한 줄에 여러 시각 · 같은 시각의 둘째 줄은 번역 · 시간순 정렬', () => {
  const r = parseLrc(`﻿[ti:바람의 노래]
[ar:하늘빛]
[00:12.50]바람이 불어오는 곳
[00:12.50]Where the wind blows
[00:05.00][00:20.25]후렴
그냥 글`);
  assert.equal(r.synced, true);
  assert.deepEqual(r.meta, { ti: '바람의 노래', ar: '하늘빛' });
  assert.deepEqual(
    r.lines.map((l) => [l.t, l.text, l.sub]),
    [
      [5, '후렴', []],
      [12.5, '바람이 불어오는 곳', ['Where the wind blows']],
      [20.25, '후렴', []],
    ],
  );
});

test('LRC: offset(+면 일찍) · 시각 없는 가사는 plain', () => {
  const r = parseLrc('[offset:500]\n[00:10.00]가\n[00:00.20]나');
  assert.deepEqual(r.lines.map((l) => l.t), [0, 9.5], '0초 밑으로는 안 내려감');
  const p = parseLrc('첫 줄\n\n둘째 줄');
  assert.equal(p.synced, false);
  assert.deepEqual(p.lines.map((l) => l.text), ['첫 줄', '둘째 줄']);
});

test('LRC 쓰기: 다시 읽으면 같은 내용 (번역 줄·메타 포함)', () => {
  const lines = [
    { t: 1.5, text: '하나', sub: ['one'] },
    { t: 65.25, text: '둘', sub: [] },
    { t: null, text: '셋 (시각 없음 → 앞 줄 시각)', sub: [] },
  ];
  const text = toLrc(lines, { ti: '제목', offset: '100' });
  assert.match(text, /^\[ti:제목\]\n\[00:01\.50\]하나\n\[00:01\.50\]one\n\[01:05\.25\]둘\n/);
  assert.ok(!text.includes('offset'), 'offset은 이미 시각에 반영된 값이라 쓰지 않음');
  const back = parseLrc(text);
  assert.deepEqual(back.lines.map((l) => [l.t, l.text, l.sub]), [
    [1.5, '하나', ['one']],
    [65.25, '둘', ['셋 (시각 없음 → 앞 줄 시각)']],
  ]);
  assert.equal(fmtStamp(3599.999), '60:00.00');
  assert.deepEqual(plainLines('[00:01.00]가\n\n\n나\n'), ['가', '', '나', '']);
});

test('온라인 가사 찾기용 제목: 유튜브식 꾸밈말을 떼고, 제목에 붙은 가수를 나눈다', () => {
  assert.equal(cleanTitle('夜に駆ける (Official Music Video) [4K]'), '夜に駆ける');
  assert.equal(cleanTitle('Lemon feat. 누군가'), 'Lemon');
  assert.deepEqual(guessArtistTitle('YOASOBI - 群青', '<알 수 없음>'), { artist: 'YOASOBI', title: '群青' });
  assert.deepEqual(guessArtistTitle('ヨルシカ「ただ君に晴れ」', ''), { artist: 'ヨルシカ', title: 'ただ君に晴れ' });
  assert.deepEqual(guessArtistTitle('Plain Song (Lyrics)', 'Some Band'), { artist: 'Some Band', title: 'Plain Song' });
});

test('가사 찾을 말: 따옴표·괄호·구분자에서 제목 후보와 가수 후보를 뽑는다', () => {
  const jp = lyricTerms('あおぞら楽団『夏のうた』Official Music Video');
  assert.equal(jp.titles[0], '夏のうた');
  assert.equal(jp.artists[0], 'あおぞら楽団');
  assert.equal(jp.sure, true, '『』 앞은 가수가 거의 확실');

  const inside = lyricTerms('「夏のうた／あおぞら楽団」 covered by 누군가');
  assert.equal(inside.titles[0], '夏のうた');
  assert.ok(inside.artists.includes('あおぞら楽団'));
  assert.equal(inside.cover, true);

  const flipped = lyricTerms('夏のうた ⧸『あおぞら楽団』【Lyric Video】');
  assert.equal(flipped.titles[0], '夏のうた', '구분자 바로 뒤 따옴표는 가수');
  assert.equal(flipped.artists[0], 'あおぞら楽団');
  const dashQuote = lyricTerms('あおぞら楽団 - 『夏のうた』');
  assert.equal(dashQuote.titles[0], '夏のうた', '"가수 - 『제목』"은 그대로');
  assert.equal(dashQuote.artists[0], 'あおぞら楽団');

  const kr = lyricTerms('【올린이】 하늘빛(Haneul) - 바람 Cover', '올린이');
  assert.equal(kr.titles[0], '바람');
  assert.deepEqual(kr.artists.slice(0, 2), ['Haneul', '하늘빛'], '한글 이름 옆 괄호의 영문 이름부터');
  assert.equal(kr.artists.at(-1), '올린이', '커버면 곡의 가수 태그(부른 사람)는 맨 뒤');
  assert.ok(!kr.titles.includes('올린이'), '맨 앞 괄호는 업로더 꼬리표');

  const orig = lyricTerms('눈꽃 (ゆきのはな) COVER');
  assert.deepEqual(orig.titles.slice(0, 2), ['ゆきのはな', '눈꽃'], '번역 제목 옆 괄호의 원제부터');

  const band = lyricTerms('Official楽団 - 夜明け (Official Video)');
  assert.ok(band.artists.includes('Official楽団'), '이름에 붙은 Official은 그대로');
  assert.equal(band.titles[0], '夜明け');

  const voice = lyricTerms('ねがいごと  初音ミク (Negaigoto  Hatsune Miku)');
  assert.equal(voice.titles[0], 'ねがいごと', '두 칸 띄움도 구분자');
  assert.ok(!voice.titles.includes('初音ミク'), '보컬로이드 이름은 제목 후보가 아님');
  assert.ok(voice.artists.includes('初音ミク'));

  assert.deepEqual(lyricTerms('Sora 星空').titles, ['Sora 星空', 'Sora', '星空'], '글자 종류가 바뀌는 곳에서 나눔');
  assert.deepEqual(lyricTerms('melodyさくら').titles, ['melodyさくら', 'melody', 'さくら'], '붙여 쓴 영문+일본어');
  assert.deepEqual(lyricTerms('SunsetあおぞらBLUE').titles, ['SunsetあおぞらBLUE', 'Sunset', 'あおぞら', 'BLUE'], '세 덩어리도');
  const plain = lyricTerms('Feather Song (Live)', 'Some Band - Topic');
  assert.deepEqual(plain.titles, ['Feather Song'], '영어 제목은 안 쪼갬, (Live)는 설명');
  assert.deepEqual(plain.artists, ['Some Band']);

  const ko = lyricTerms('夏のうた (한국어 커버) Cover by 누군가', '누군가');
  assert.deepEqual(ko.titles, ['夏のうた']);
  assert.equal(ko.korean, true);
  assert.equal(ko.sure, false, '커버한 사람만 알면 원곡 가수는 모름');
});

test('가사 결과 점수: 이름은 모양·소리로 비교하고, 확실한 가수가 다르면 "잘 맞음"이 못 된다', () => {
  assert.equal(nameSim('ＡＢＣ　Song!', 'abc song'), 1);
  assert.equal(nameSim('ヨゾラ', 'よぞら'), 1, '가타카나 = 히라가나');
  assert.ok(nameSim('요조라', 'yozora') >= 0.9, '한글·로마자 소리');
  const phon = (s) => (s === '夜空' ? 'yozora' : phoneticKey(s));
  assert.ok(nameSim('夜空', 'ヨゾラ', phon) >= 0.9, '한자는 읽는 법으로');
  assert.ok(nameSim('Lemon', 'Melon') < 0.6);

  const terms = lyricTerms('あおぞら楽団『夏のうた』MV');
  const r = (title, artist, duration, more = {}) => ({ title, artist, duration, synced: true, instrumental: false, ...more });
  const right = scoreResult(r('夏のうた', 'あおぞら楽団', 200), terms, 201);
  const other = scoreResult(r('夏のうた', '別のバンド', 200), terms, 201);
  const wrong = scoreResult(r('冬のうた', 'あおぞら楽団', 200), terms, 201);
  assert.ok(right >= 0.9, `맞는 곡 ${right}`);
  assert.ok(other < 0.8, `가수가 다른 같은 제목 ${other}`);
  assert.ok(wrong < 0.6, `제목이 다른 곡 ${wrong}`);
  assert.ok(scoreResult(r('夏のうた', 'あおぞら楽団', 200, { instrumental: true }), terms, 201) < 0.5, '연주곡은 뒤로');

  const cover = lyricTerms('「夏のうた」 歌ってみた', '歌い手');
  assert.ok(scoreResult(r('夏のうた', 'あおぞら楽団', 204), cover, 200) >= 0.8, '원곡 가수를 모르는 커버: 제목·길이로');
  assert.ok(scoreResult(r('夏のうた', 'あおぞら楽団', 290), cover, 200) < 0.8, '길이가 많이 다르면 확신은 못 함');
  const tagged = scoreResult(r('夏のうた - Natsu no Uta [Cover] (feat. 誰か)', 'うたびと', 201), cover, 200);
  assert.ok(tagged >= 0.8, `결과 제목의 꾸밈말도 떼고 비교 ${tagged}`);
});

test('LRCLIB 찾기: 후보로 여러 번 찾고, 바쁠 때(503)는 다시 묻고, 점수 순으로', async () => {
  const real = globalThis.fetch;
  const asked = [];
  let busy = 1;
  const entry = (id, trackName, artistName, duration, synced = true) => ({ id, trackName, artistName, albumName: '', duration, instrumental: false, plainLyrics: 'ら', syncedLyrics: synced ? '[00:01.00]ら' : null });
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    asked.push(`${u.pathname} ${[...u.searchParams].map(([k, v]) => `${k}=${v}`).join('&')}`);
    if (busy-- > 0) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } });
    if (u.pathname === '/api/get') return new Response('{}', { status: 404 });
    if (u.searchParams.get('q') === 'はれのひ') return Response.json([entry(1, 'はれのひ', 'ちがうひと', 150, false), entry(2, 'はれのひ', 'そらいろ', 241)]);
    return Response.json([]);
  };
  try {
    const { results, terms } = await findLyrics({ title: 'そらいろ「はれのひ」MV', artist: '<알 수 없음>', duration: 240 });
    assert.equal(terms.titles[0], 'はれのひ');
    assert.deepEqual(results.map((x) => x.id), [2, 1], '가수·길이가 맞는 것 먼저');
    assert.ok(results[0].score >= 0.9 && results[1].score < 0.6, `${results[0].score} / ${results[1].score}`);
    assert.equal(results[0].durDiff, 1);
    assert.ok(asked.length >= 4, '여러 후보로 찾음');
    assert.ok(asked.some((a) => a.includes('track_name=はれのひ&artist_name=そらいろ')));
    assert.ok(asked.every((a) => !a.includes('album_name')), '엉뚱한 앨범 태그는 안 보냄');
    assert.ok(!asked.includes('/api/search q=そらいろ'), '1차에서 잘 맞는 게 나오면 2차는 안 찾음');

    // 가수를 모르는데 같은 제목을 여러 가수가 불렀으면 "잘 맞음"은 안 줌
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.searchParams.get('q') === 'あめのうた') return Response.json([entry(3, 'あめのうた', 'ひとり', 200), entry(4, 'あめのうた', 'ふたり', 230)]);
      return Response.json([]);
    };
    const two = await findLyrics({ title: 'あめのうた', artist: '', duration: 200 });
    assert.equal(two.terms.sure, false);
    assert.deepEqual(two.results.map((x) => x.id), [3, 4], '길이가 맞는 쪽이 먼저');
    assert.ok(two.results[0].score < 0.8, `${two.results[0].score}`);

    // 붙여 쓴 제목: LRCLIB에는 띄어 쓴 제목으로 있어도 가수 이름으로 찾아 띄어쓰기 없이 비교
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.searchParams.get('q') === 'さくら') return Response.json([entry(5, 'blue moon', 'さくら', 200)]);
      return Response.json([]);
    };
    const glued = await findLyrics({ title: 'bluemoonさくら', artist: '', duration: 201 });
    assert.equal(glued.results[0]?.id, 5);
    assert.ok(glued.results[0].score >= 0.8, `${glued.results[0].score}`);

    // 한국어 제목뿐인 한국어 커버: 일본어로 번역한 제목(원제)으로도 찾음. 원어 제목이 있으면 번역 안 함
    const lines = [];
    const translate = async (ls) => {
      lines.push(...ls);
      return { lines: ls.map((l) => (l === '밤의 노래' ? 'よるのうた' : '')) };
    };
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.searchParams.get('q') === 'よるのうた') return Response.json([entry(6, 'よるのうた', 'うたびと', 180)]);
      return Response.json([]);
    };
    const ko = await findLyrics({ title: '밤의 노래 (한국어 커버)', artist: '누군가', duration: 181, translate });
    assert.deepEqual(lines, ['밤의 노래']);
    assert.equal(ko.terms.titles[0], 'よるのうた', '한국어 커버는 번역한 원제부터');
    assert.equal(ko.results[0]?.id, 6);
    lines.length = 0;
    await findLyrics({ title: 'あさのうた (한국어 커버)', artist: '누군가', duration: 181, translate });
    assert.deepEqual(lines, [], '원제가 이미 있으면 번역 안 함');
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.searchParams.get('q') === '봄날') return Response.json([entry(7, '봄날', '노래하는사람', 240)]);
      return Response.json([]);
    };
    const kr = await findLyrics({ title: '봄날', artist: '노래하는사람', duration: 240, translate });
    assert.equal(kr.results[0]?.id, 7);
    assert.deepEqual(lines, [], '한국어 제목이어도 1차에서 잘 맞는 게 나오면 번역 안 함');

    globalThis.fetch = async () => new Response('down', { status: 500 });
    await assert.rejects(findLyrics({ title: 'くもりのひ', artist: 'だれか', duration: 100 }), /연결하지 못했어요/);
  } finally {
    globalThis.fetch = real;
  }
});

test('구글 번역이 막히면(429) 30분 동안은 다시 묻지 않는다', async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('sorry', { status: 429 });
  };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sm-translate-'));
  try {
    const tr = new Translator(dir);
    await assert.rejects(tr.translate(['こんにちは'], 'ko'), TranslateBlocked);
    await assert.rejects(tr.translate(['さようなら'], 'ko'), TranslateBlocked);
    assert.equal(calls, 1, '막힌 동안은 서버에 다시 묻지 않음');
  } finally {
    globalThis.fetch = real;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
