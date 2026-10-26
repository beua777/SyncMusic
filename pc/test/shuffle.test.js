// 셔플 방식: 취향 셔플 · 가수·앨범 흩기 · 같은 가수 연달아 막기 · 셔플 제외 곡
import assert from 'node:assert/strict';
import test from 'node:test';
import { avoidAdjacent, PlayQueue, spreadOut } from '../public/js/queue.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i}`);
const artistOf = (id) => `a${Number(id.slice(1)) % 4}`; // 가수 4명이 10곡씩
const seeded = (seed) => {
  const q = new PlayQueue(null, { seed });
  return () => q.random();
};
const longestRun = (arr) => {
  let best = 1;
  let run = 1;
  for (let i = 1; i < arr.length; i++) {
    run = arr[i] === arr[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
};

test('같은 가수 연달아 막기: 섞은 순서에서 같은 가수가 붙지 않고, 한 바퀴에 모든 곡이 한 번씩', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const q = new PlayQueue(null, { seed });
    q.opts = { ...q.opts, noRepeatArtist: true, artist: artistOf };
    q.setQueue(ids(40), -1, { shuffle: true });
    const order = q.view().map((v) => v.id);
    assert.equal(new Set(order).size, 40);
    const artists = order.map(artistOf);
    for (let i = 1; i < artists.length; i++) assert.notEqual(artists[i], artists[i - 1], `seed ${seed}, ${i}번째`);
  }
});

test('avoidAdjacent: 앞 곡(지금 곡)의 가수까지 보고, 모르는 가수(null)는 늘 다르게 본다', () => {
  const g = (k) => k[0];
  assert.deepEqual(avoidAdjacent(['A1', 'A2', 'B1', 'B2'], g), ['A1', 'B1', 'A2', 'B2']);
  assert.deepEqual(avoidAdjacent(['A1', 'B1'], g, 'A'), ['B1', 'A1']);
  assert.deepEqual(avoidAdjacent(['x', 'y'], () => null), ['x', 'y']);
  // 한 가수뿐이면 바꿀 곡이 없어서 그대로
  assert.deepEqual(avoidAdjacent(['A1', 'A2', 'A3'], g), ['A1', 'A2', 'A3']);
});

test('spreadOut: 한쪽에 몰린 가수를 전체에 고르게 흩는다 (세게 할수록 고르게)', () => {
  const keys = ids(12);
  const group = (k) => (Number(k.slice(1)) < 6 ? 'A' : Number(k.slice(1)) < 9 ? 'B' : 'C');
  assert.equal(longestRun(keys.map(group)), 6);
  const out = spreadOut(keys, group, 1, seeded(9));
  assert.equal(new Set(out).size, 12, '곡이 빠지거나 겹치지 않음');
  assert.ok(longestRun(out.map(group)) <= 2, `가장 긴 연속 ${longestRun(out.map(group))}`);
  assert.deepEqual(spreadOut(keys, group, 0, seeded(9)), keys, '세기 0이면 그대로');
  // 무리 안의 앞뒤 순서는 그대로
  const a = out.filter((k) => group(k) === 'A');
  assert.deepEqual(a, ['t0', 't1', 't2', 't3', 't4', 't5']);
});

test('취향 셔플: 무게가 큰 곡이 평균적으로 앞쪽에 나온다 (그래도 한 바퀴에 한 번씩)', () => {
  let heavy = 0;
  let light = 0;
  const runs = 200;
  for (let seed = 1; seed <= runs; seed++) {
    const q = new PlayQueue(null, { seed });
    q.opts = { ...q.opts, mode: 'smart', weight: (id) => (id === 't7' ? 8 : 1) };
    q.setQueue(ids(20), 0, { shuffle: true }); // 첫 곡 t0은 지금 곡
    const order = q.view().map((v) => v.id);
    assert.equal(new Set(order).size, 20);
    heavy += order.indexOf('t7');
    light += order.indexOf('t13');
  }
  assert.ok(heavy / runs < (light / runs) * 0.6, `무거운 곡 평균 ${heavy / runs}, 가벼운 곡 ${light / runs}`);
});

test('셔플 제외 곡: 셔플 중에는 맨 뒤로 가고 다음 곡으로 넘길 때 건너뜀, 순서대로 틀 때는 나옴', () => {
  const excluded = new Set(['t2', 't5']);
  const q = new PlayQueue(null, { seed: 3 });
  q.opts = { ...q.opts, excluded: (id) => excluded.has(id) };
  q.setQueue(ids(8), 0, { shuffle: true });
  const order = q.view().map((v) => v.id);
  assert.deepEqual(new Set(order.slice(-2)), excluded, '제외 곡은 섞인 순서의 맨 뒤');
  const heard = [q.current];
  for (let i = 0; i < 5; i++) heard.push(q.next().id);
  assert.ok(!heard.some((id) => excluded.has(id)), heard.join(','));
  assert.ok(q.skipped('t2'));
  // 남은 곡이 제외 곡뿐이면 곡이 끝나도 다음 곡이 없음 (반복 안 함)
  assert.equal(q.hasAutoNext(), false);
  q.setRepeat('all');
  assert.equal(q.hasAutoNext(), true);
  // 셔플을 끄면 목록 순서대로 제외 곡도 나온다
  q.setShuffle(false);
  assert.equal(q.skipped('t2'), false);
});

test('hasAutoNext: 한 곡 반복이면 크로스페이드하지 않음, 마지막 곡 + 반복 안 함이면 없음', () => {
  const q = new PlayQueue(null, { seed: 1 });
  q.setQueue(ids(3), 0, { shuffle: false });
  assert.equal(q.hasAutoNext(), true);
  q.setRepeat('one');
  assert.equal(q.hasAutoNext(), false);
  q.setRepeat('off');
  q.jumpTo(2);
  assert.equal(q.hasAutoNext(), false);
  q.setRepeat('all');
  assert.equal(q.hasAutoNext(), true);
});
