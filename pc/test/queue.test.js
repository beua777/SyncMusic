// 삼성 뮤직 셔플·반복 규칙 (docs/PLAN.md 5장 S1~S13)
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayQueue } from '../public/js/queue.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i}`);
const playThrough = (q) => {
  const heard = [q.current];
  for (let i = 1; i < q.length; i++) heard.push(q.next({ auto: true }).id);
  return heard;
};

test('S1 셔플은 한 바퀴 동안 모든 곡을 딱 한 번씩 재생', () => {
  const q = new PlayQueue(null, { seed: 42 });
  q.setQueue(ids(50), -1, { shuffle: true });
  const heard = playThrough(q);
  assert.equal(new Set(heard).size, 50);
  assert.notDeepEqual(heard, ids(50));
});

test('S1 Fisher–Yates: 어느 곡이든 첫 곡이 될 확률이 같음', () => {
  const counts = new Map();
  for (let seed = 0; seed < 4000; seed++) {
    const q = new PlayQueue(null, { seed });
    q.setQueue(ids(4), -1, { shuffle: true });
    counts.set(q.current, (counts.get(q.current) || 0) + 1);
  }
  for (const id of ids(4)) assert.ok(Math.abs(counts.get(id) - 1000) < 150, `${id}: ${counts.get(id)}`);
});

test('S2 재생 중 셔플을 켜면 지금 곡은 그대로, 나머지만 섞임', () => {
  const q = new PlayQueue(null, { seed: 1 });
  q.setQueue(ids(10), 3);
  q.setShuffle(true);
  assert.equal(q.current, 't3');
  const rest = q.upcoming().map((x) => x.id);
  assert.equal(rest.length, 9);
  assert.deepEqual([...rest].sort(), ids(10).filter((x) => x !== 't3').sort());
});

test('S3 셔플을 끄면 지금 곡의 원래 위치부터 목록 순서대로', () => {
  const q = new PlayQueue(null, { seed: 7 });
  q.setQueue(ids(10), 0, { shuffle: true });
  q.next();
  q.next();
  const cur = q.current;
  q.setShuffle(false);
  assert.equal(q.current, cur);
  assert.deepEqual(
    q.upcoming().map((x) => x.id),
    ids(10).slice(Number(cur.slice(1)) + 1),
  );
});

test('S4 반복 버튼: 반복 안 함 → 전체 반복 → 한 곡 반복 → 반복 안 함', () => {
  const q = new PlayQueue();
  assert.equal(q.repeat, 'off');
  assert.equal(q.cycleRepeat(), 'all');
  assert.equal(q.cycleRepeat(), 'one');
  assert.equal(q.cycleRepeat(), 'off');
});

test('S5 이전: 맨 앞 곡이면 처음부터, 아니면 이전 곡', () => {
  const q = new PlayQueue();
  q.setQueue(ids(3), 0);
  assert.deepEqual(q.prev(), { id: 't0', restart: true });
  q.next();
  assert.deepEqual(q.prev(), { id: 't0' });
});

test('S5 셔플 중 이전 버튼은 실제로 들은 순서대로 돌아감', () => {
  const q = new PlayQueue(null, { seed: 3 });
  q.setQueue(ids(8), 0, { shuffle: true });
  const heard = [q.current, q.next().id, q.next().id];
  assert.equal(q.prev().id, heard[1]);
  assert.equal(q.prev().id, heard[0]);
});

test('S6 한 곡 반복: 곡이 끝나면 같은 곡, 다음 버튼은 다음 곡', () => {
  const q = new PlayQueue();
  q.setQueue(ids(3), 1);
  q.setRepeat('one');
  assert.deepEqual(q.next({ auto: true }), { id: 't1', restart: true });
  assert.deepEqual(q.next(), { id: 't2' });
});

test('S7 재생 순서 화면은 섞인 순서 그대로, 끌어서 바꾸면 그 순서로 재생', () => {
  const q = new PlayQueue(null, { seed: 9 });
  q.setQueue(ids(6), 0, { shuffle: true });
  const view = q.view().map((v) => v.id);
  q.move(5, 1); // 맨 끝 곡을 바로 다음으로
  assert.equal(q.current, view[0]);
  assert.equal(q.next().id, view[5]);
  assert.equal(q.next().id, view[1]);
});

test('S7 셔플이 꺼져 있을 때 순서를 바꾸면 원래 목록 순서도 바뀜', () => {
  const q = new PlayQueue(null, { seed: 1 });
  q.setQueue(ids(4), 0);
  q.move(3, 1);
  q.setShuffle(true);
  q.setShuffle(false);
  assert.deepEqual(
    q.view().map((v) => v.id),
    ['t0', 't3', 't1', 't2'],
  );
});

test('S8 반복 안 함: 마지막 곡이 끝나면 첫 곡에서 멈춤', () => {
  const q = new PlayQueue();
  q.setQueue(ids(3), 2);
  assert.deepEqual(q.next({ auto: true }), { id: 't0', ended: true });
});

test('전체 반복: 마지막 곡 다음은 첫 곡 / 다음 버튼은 반복 안 함이어도 처음으로', () => {
  const q = new PlayQueue();
  q.setQueue(ids(3), 2);
  q.setRepeat('all');
  assert.deepEqual(q.next({ auto: true }), { id: 't0', wrapped: true });
  q.setRepeat('off');
  q.jumpTo(2);
  assert.deepEqual(q.next(), { id: 't0', wrapped: true });
});

test('S9 전체 반복 + 셔플: 한 바퀴가 끝나면 다시 섞고, 방금 곡이 바로 다시 나오지 않음', () => {
  for (let seed = 0; seed < 200; seed++) {
    const q = new PlayQueue(null, { seed });
    q.setRepeat('all');
    q.setQueue(ids(5), -1, { shuffle: true });
    const first = playThrough(q);
    const r = q.next({ auto: true });
    assert.ok(r.wrapped);
    assert.notEqual(r.id, first.at(-1));
    const second = [r.id];
    for (let i = 1; i < 5; i++) second.push(q.next({ auto: true }).id);
    assert.equal(new Set(second).size, 5);
  }
});

test('S10 저장 후 복원해도 섞인 순서·위치·다음 섞기 결과까지 같음', () => {
  const q = new PlayQueue(null, { seed: 5 });
  q.setQueue(ids(20), -1, { shuffle: true });
  q.next();
  q.next();
  q.setRepeat('all');
  const r = new PlayQueue(JSON.parse(JSON.stringify(q.toJSON())));
  assert.equal(r.current, q.current);
  assert.equal(r.repeat, 'all');
  assert.deepEqual(
    r.view().map((v) => v.id),
    q.view().map((v) => v.id),
  );
  for (const x of [q, r]) {
    x.setShuffle(false);
    x.setShuffle(true);
  }
  assert.deepEqual(
    r.view().map((v) => v.id),
    q.view().map((v) => v.id),
  );
});

test('S10 깨진 저장 상태도 고쳐서 복원', () => {
  const r = new PlayQueue({ items: [[1, 'a'], [2, 'b'], [3, 'c'], ['x', 5]], order: [3, 3, 9, 1], pos: 7, shuffle: true });
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.view().map((v) => v.id),
    ['c', 'a', 'b'],
  );
  assert.equal(r.pos, 2);
  r.addToEnd(['d']);
  assert.equal(new Set(r.items.map((it) => it.key)).size, 4); // key가 겹치지 않음
});

test('S11 목록에서 곡을 누르면 그 곡부터, 셔플 상태는 유지', () => {
  const q = new PlayQueue(null, { seed: 2 });
  q.setShuffle(true);
  q.setQueue(ids(10), 4);
  assert.equal(q.current, 't4');
  assert.equal(q.shuffle, true);
  assert.equal(q.upcoming().length, 9);
  q.setQueue(ids(10), 6, { shuffle: false }); // 설정 '곡을 누르면 목록 순서대로'
  assert.deepEqual(
    q.upcoming().map((x) => x.id),
    ['t7', 't8', 't9'],
  );
});

test('S12 다음에 재생 / 대기열 끝에 추가 (셔플 중에도 반영)', () => {
  const q = new PlayQueue(null, { seed: 4 });
  q.setQueue(ids(5), 2, { shuffle: true });
  q.playNext(['x']);
  q.addToEnd(['y']);
  assert.equal(q.view().at(-1).id, 'y');
  assert.equal(q.next().id, 'x');
  q.setShuffle(false); // 원래 목록에서도 x는 t2 다음, y는 맨 끝
  assert.deepEqual(
    q.view().map((v) => v.id),
    ['t0', 't1', 't2', 'x', 't3', 't4', 'y'],
  );
  assert.equal(q.current, 'x');
});

test('S13 폰에서 받은 대기열은 섞지 않고 받은 순서 그대로', () => {
  const q = new PlayQueue(null, { seed: 1 });
  q.loadExternal(['c', 'a', 'b', 'd'], 1, { shuffle: true, repeat: 'all' });
  assert.equal(q.current, 'a');
  assert.equal(q.shuffle, true);
  assert.equal(q.repeat, 'all');
  assert.deepEqual(
    q.upcoming().map((x) => x.id),
    ['b', 'd'],
  );
});

test('같은 곡이 두 번 들어 있어도 각각 따로 재생·삭제', () => {
  const q = new PlayQueue();
  q.setQueue(['a', 'b', 'a'], 0);
  assert.equal(q.next().id, 'b');
  assert.equal(q.next().id, 'a');
  q.removeKey(q.view()[0].key);
  assert.deepEqual(
    q.view().map((v) => v.id),
    ['b', 'a'],
  );
  assert.equal(q.current, 'a');
});

test('지금 곡을 지우면 다음 곡이 지금 곡, 마지막 곡을 지우면 앞 곡', () => {
  const q = new PlayQueue();
  q.setQueue(ids(3), 1);
  assert.deepEqual(q.removeKey(q.currentKey), { currentChanged: true });
  assert.equal(q.current, 't2');
  q.removeKey(q.currentKey);
  assert.equal(q.current, 't0');
  q.removeKey(q.currentKey);
  assert.equal(q.current, null);
  assert.equal(q.next(), null);
});

test('라이브러리에서 사라진 곡 정리', () => {
  const q = new PlayQueue(null, { seed: 8 });
  q.setQueue(ids(6), 0, { shuffle: true });
  q.removeIds(new Set(['t1', 't3']));
  assert.equal(q.length, 4);
  assert.ok(!q.view().some((v) => v.id === 't1' || v.id === 't3'));
});
