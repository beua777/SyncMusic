// 재생목록 3-way 병합: 곡 순서 보존 (docs/PLAN.md 6.6)
import assert from 'node:assert/strict';
import test from 'node:test';
import { merge3 } from '../src/sync/merge.js';

test('한쪽만 바뀌면 바뀐 쪽 그대로', () => {
  const B = ['a', 'b', 'c'];
  assert.deepEqual(merge3(B, B, ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.deepEqual(merge3(B, ['b', 'c', 'a', 'd'], B), ['b', 'c', 'a', 'd']);
  assert.deepEqual(merge3(B, B, B), B);
});

test('계획서 예시: PC가 x를 a 뒤에 넣고 폰이 역순으로 → [c,x,b,a]', () => {
  assert.deepEqual(merge3(['a', 'b', 'c'], ['a', 'x', 'b', 'c'], ['c', 'b', 'a'], { prefer: 'phone' }), ['c', 'x', 'b', 'a']);
});

test('반대쪽에서 지운 곡은 빠지고, 이쪽에서 넣은 곡은 남음', () => {
  assert.deepEqual(merge3(['a', 'b', 'c'], ['a', 'c'], ['c', 'b', 'a', 'd'], { prefer: 'phone' }), ['c', 'a', 'd']);
});

test('PC는 순서만 바꾸고 폰은 곡을 추가 (PC가 최근) → PC 순서 + 폰 곡은 맨 끝', () => {
  assert.deepEqual(merge3(['a', 'b', 'c'], ['c', 'b', 'a'], ['a', 'b', 'c', 'd'], { prefer: 'pc' }), ['c', 'b', 'a', 'd']);
});

test('반대쪽에서 연달아 넣은 곡들은 순서를 지킨 채 같은 자리에', () => {
  assert.deepEqual(merge3(['a', 'b'], ['a', 'x', 'y', 'b'], ['b', 'a'], { prefer: 'phone' }), ['x', 'y', 'b', 'a']);
});

test('양쪽에서 같은 곡을 넣으면 한 번만', () => {
  assert.deepEqual(merge3(['a'], ['a', 'x'], ['x', 'a'], { prefer: 'phone' }), ['x', 'a']);
});

test('기준점이 없으면 합집합 (우선 쪽 순서)', () => {
  assert.deepEqual(merge3(null, ['a', 'b'], ['b', 'c'], { prefer: 'phone' }), ['a', 'b', 'c']);
  assert.deepEqual(merge3(null, ['a', 'b'], ['a', 'b']), ['a', 'b']);
});

test('같은 곡이 여러 번 들어간 재생목록', () => {
  assert.deepEqual(merge3(['a', 'b', 'a'], ['a', 'b', 'a', 'c'], ['b', 'a', 'a'], { prefer: 'phone' }), ['b', 'a', 'a', 'c']);
  // 폰이 두 번째 a를 지움
  assert.deepEqual(merge3(['a', 'b', 'a'], ['a', 'b', 'a', 'c'], ['a', 'b'], { prefer: 'phone' }), ['a', 'b', 'c']);
});

test('입력 배열을 바꾸지 않음', () => {
  const B = ['a', 'b'];
  const C = ['b', 'a', 'c'];
  const P = ['a', 'b', 'd'];
  merge3(B, C, P);
  assert.deepEqual([B, C, P], [['a', 'b'], ['b', 'a', 'c'], ['a', 'b', 'd']]);
});
