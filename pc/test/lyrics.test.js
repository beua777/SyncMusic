// 가사: LRC 읽기·쓰기 · 온라인에서 찾을 때 쓰는 제목 다듬기
import assert from 'node:assert/strict';
import test from 'node:test';
import { fmtStamp, parseLrc, plainLines, toLrc } from '../public/js/lrc.js';
import { cleanTitle, guessArtistTitle } from '../src/lyrics.js';

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
