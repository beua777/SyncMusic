// 들은 기록 통계 (서버 stats.js) · 통계 화면 막대 자료 (statsdata.js) · 기록 한 줄 만들기·CSV
import assert from 'node:assert/strict';
import test from 'node:test';
import { fmtMinutes, peakHour, series } from '../public/js/statsdata.js';
import { makeEvent, toCsv } from '../src/history.js';
import { DAY, dayKey, forgotten, goalProgress, recentlyAdded, recommend, report, startOfWeek, summarize, tasteShift, wrapped } from '../src/stats.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 28, 20); // 수요일 저녁
const ev = (id, s, l, extra = {}) => ({ id, s, l, c: 0, k: 0, t: `곡 ${id}`, a: `가수${id.slice(0, 1)}`, al: `앨범${id.slice(0, 1)}`, g: null, d: 200, ...extra });

const events = [
  ev('a1', at(2026, 10, 26, 9), 200, { c: 1 }),
  ev('a1', at(2026, 10, 27, 9), 200, { c: 1 }),
  ev('a2', at(2026, 10, 27, 22), 40),
  ev('b1', at(2026, 10, 28, 22), 10, { k: 1 }),
  ev('b1', at(2026, 10, 20, 8), 300, { c: 1 }), // 지난주
  ev('c1', at(2025, 3, 1, 8), 300, { c: 1 }), // 작년
];

test('요약: 들은 시간·재생(30초 넘게 또는 끝까지)·넘김·많이 들은 곡·요일×시간대', () => {
  const s = summarize(events.slice(0, 4));
  assert.equal(s.minutes, Math.round(450 / 60));
  assert.equal(s.plays, 3, '10초만 듣고 넘긴 건 재생으로 안 셈');
  assert.equal(s.skips, 1);
  assert.equal(s.uniqueTracks, 3);
  assert.deepEqual(s.topTracks[0], { id: 'a1', title: '곡 a1', artist: '가수a', plays: 2, secs: 400 });
  assert.equal(s.topArtists[0].artist, '가수a');
  assert.ok(Math.abs(s.topArtists[0].share - 440 / 450) < 1e-9);
  assert.equal(s.heat.length, 7);
  assert.equal(s.heat[0][9], Math.round(200 / 60), '월요일 9시');
  assert.equal(s.byDay.length, 3);
});

test('주간 리포트: 이번 주(월요일부터)와 지난주 비교', () => {
  assert.equal(new Date(startOfWeek(NOW)).getDay(), 1, '한 주는 월요일부터');
  const r = report(events, 'week', NOW);
  assert.equal(r.plays, 3);
  assert.equal(r.prev.plays, 1);
  assert.equal(report(events, 'all', NOW).prev, null);
  assert.equal(report(events, 'year', NOW).prev.plays, 1, '작년 기록');
});

test('오래 안 들은 곡 · 최근 추가 · 취향 추천 · 취향 변화', () => {
  const tracks = [
    { id: 'x', title: '옛날 곡', artist: '가수a', playCount: 9, lastPlayed: NOW - 200 * DAY, addedAt: NOW - 400 * DAY },
    { id: 'y', title: '안 들은 곡', artist: '가수a', playCount: 0, addedAt: NOW - 60 * DAY },
    { id: 'z', title: '새 곡', artist: '가수z', playCount: 0, addedAt: NOW - 2 * DAY },
  ];
  const f = forgotten(tracks, NOW);
  assert.deepEqual(f.old.map((t) => t.id), ['x']);
  assert.equal(f.neverCount, 1, '추가한 지 30일 넘은 안 들은 곡만');
  const ra = recentlyAdded(tracks, NOW);
  assert.equal(ra.weeks.length, 12);
  assert.equal(ra.weeks.at(-1).count, 1);
  assert.equal(ra.last30, 1);
  const rec = recommend(tracks, events, new Set(), NOW);
  assert.deepEqual(rec.map((r) => r.id), ['y'], '자주 듣는 가수a의 아직 안 들은 곡');
  assert.match(rec[0].reason, /가수a/);
  const shift = tasteShift(events, NOW);
  assert.equal(shift.enough, false, '기록이 적으면 아직 안 보여 줌');
});

test('청취 목표: 오늘 들은 분 · 이번 주 처음 들은 곡 · 이어서 채운 날', () => {
  const day = (d) => ev('a1', at(2026, 10, d, 10), 1800);
  const g = goalProgress([day(25), day(26), day(27), ev('n1', at(2026, 10, 28, 9), 60)], { dailyMinutes: 30, weeklyNew: 5 }, NOW);
  assert.equal(g.todayMinutes, 1);
  assert.equal(g.streak, 3, '오늘은 아직이라 어제부터 셈');
  assert.equal(g.weekNew, 1, '이번 주에 처음 들은 곡 (a1은 지난 일요일에 처음)');
});

test('연말 결산', () => {
  const w = wrapped(events, 2026);
  assert.equal(w.year, 2026);
  assert.equal(w.plays, 4);
  assert.equal(w.topTracks[0].id, 'a1');
  assert.equal(w.topMonth, 10);
  assert.equal(w.firstSong.id, 'b1');
  assert.equal(w.newArtists, 2, '작년에는 가수c만 들음');
  assert.ok(w.type);
  assert.equal(wrapped(events, 2020).type, null);
});

test('통계 화면 막대: 이번 주는 월~일 7칸(앞으로 올 날은 future) · 올해는 12달', () => {
  const byDay = [{ date: dayKey(at(2026, 10, 27)), minutes: 12 }];
  const w = series('week', byDay, startOfWeek(NOW), NOW);
  assert.deepEqual(
    w.map((x) => `${x.label}${x.v}${x.future ? '*' : ''}`),
    ['월0', '화12', '수0', '목0*', '금0*', '토0*', '일0*'],
  );
  const m = series('month', byDay, at(2026, 10, 1, 0), NOW);
  assert.equal(m.length, 31);
  assert.equal(m.filter((x) => x.future).length, 3);
  const y = series('year', byDay, at(2026, 1, 1, 0), NOW);
  assert.equal(y.length, 12);
  assert.equal(y[9].v, 12);
  assert.equal(peakHour(Array.from({ length: 24 }, (_, h) => (h === 22 ? 5 : 1))), '밤 10시');
  assert.equal(peakHour(new Array(24).fill(0)), null);
  assert.equal(fmtMinutes(125), '2시간 5분');
  assert.equal(fmtMinutes(59.6), '1시간');
});

test('들은 기록 한 줄: 이상한 값은 버리고, CSV는 엑셀이 한글을 읽게 BOM', () => {
  const t = { id: 'q', title: '제목, "따옴표"', artist: '가수', album: '앨범', duration: 180 };
  assert.equal(makeEvent({ start: Date.now() - 1000, listened: 0.5 }, t), null, '1초도 안 들음');
  assert.equal(makeEvent({ start: Date.now() + 3_600_000, listened: 30 }, t), null, '미래 시각');
  assert.equal(makeEvent({ start: Date.now(), listened: 30 }, null), null, '없는 곡');
  const e = makeEvent({ start: Date.now() - 60_000, listened: 42.4, completed: true }, t);
  assert.deepEqual({ l: e.l, c: e.c, k: e.k, d: e.d }, { l: 42, c: 1, k: 0, d: 180 });
  const csv = toCsv([e]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"제목, ""따옴표"""'), csv);
});
