// 소리: 곡 세기(LUFS)·무음 재기 · 음량 평준화 계산 · 이퀄라이저 프리셋
import assert from 'node:assert/strict';
import test from 'node:test';
import { EQ_FREQS, EQ_PRESETS, normalizeGainDb } from '../public/js/audio.js';
import { analyze, ANALYSIS_VERSION } from '../public/js/loudness.js';

// 1kHz 사인파 (dBFS 진폭), 앞뒤·가운데 무음은 [시작초, 끝초] 구간으로
function tone(fs, seconds, dbfs, silences = []) {
  const n = Math.round(fs * seconds);
  const amp = 10 ** (dbfs / 20);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    if (silences.some(([a, b]) => t >= a && t < b)) continue;
    x[i] = amp * Math.sin(2 * Math.PI * 1000 * t);
  }
  return x;
}

test('BS.1770: -23 dBFS 1kHz 사인(스테레오)은 약 -23 LUFS (EBU 기준 신호)', () => {
  const fs = 48000;
  const ch = tone(fs, 10, -23);
  const r = analyze([ch, ch], fs);
  assert.equal(r.v, ANALYSIS_VERSION);
  assert.ok(Math.abs(r.lufs - -23) < 0.15, `${r.lufs}`);
  assert.ok(Math.abs(20 * Math.log10(r.peak) - -23) < 0.1);
  assert.equal(r.start, 0);
  assert.deepEqual(r.gaps, []);
});

test('모노는 두 채널로 들리는 것과 같게 잼 · 표본율이 달라도 거의 같음', () => {
  const a = analyze([tone(22050, 6, -20)], 22050).lufs;
  const b = analyze([tone(48000, 6, -20), tone(48000, 6, -20)], 48000).lufs;
  assert.ok(Math.abs(a - b) < 0.3, `${a} vs ${b}`);
});

test('무음: 앞뒤 무음은 start·end로, 가운데 2.5초 넘는 무음은 gaps로', () => {
  const fs = 22050;
  const ch = tone(fs, 12, -18, [
    [0, 1.5],
    [5, 8.5],
    [11, 12],
  ]);
  const r = analyze([ch], fs);
  assert.ok(Math.abs(r.start - 1.4) < 0.25, `start ${r.start}`);
  assert.ok(Math.abs(r.end - 11.1) < 0.25, `end ${r.end}`);
  assert.equal(r.gaps.length, 1);
  assert.ok(Math.abs(r.gaps[0][0] - 5.2) < 0.25 && Math.abs(r.gaps[0][1] - 8.3) < 0.25, JSON.stringify(r.gaps));
  // 짧은 쉼(1초)은 건너뛰지 않음
  assert.deepEqual(analyze([tone(fs, 8, -18, [[3, 4]])], fs).gaps, []);
});

test('완전한 무음 파일은 lufs null', () => {
  const r = analyze([new Float32Array(22050 * 3)], 22050);
  assert.equal(r.lufs, null);
});

test('음량 평준화: ReplayGain 태그 우선, 없으면 잰 세기 · 앨범 모드 · 피크 보호 · 범위 제한', () => {
  assert.equal(normalizeGainDb({ loud: { lufs: -20 } }, 'off'), 0);
  assert.equal(normalizeGainDb({ loud: { lufs: -20, peak: 0.1 } }, 'track', { target: -14 }), 6);
  // RG2는 -18 LUFS 기준: 목표 -14면 4dB 더
  assert.equal(normalizeGainDb({ rg: { track: -3 }, loud: { lufs: -30 } }, 'track', { target: -14 }), 1);
  assert.equal(normalizeGainDb({ rg: { track: -3, album: -5 } }, 'album', { target: -14 }), -1);
  assert.equal(normalizeGainDb({ loud: { lufs: -10 } }, 'album', { target: -14, albumLufs: -12 }), -2);
  // 키울 때는 피크가 0dBFS를 1dB 넘지 않게
  assert.ok(Math.abs(normalizeGainDb({ loud: { lufs: -24, peak: 0.5 } }, 'track', { target: -14 }) - (6.02 + 1)) < 0.05);
  assert.equal(normalizeGainDb({ loud: { lufs: -40 } }, 'track', { target: -8 }), 10);
  assert.equal(normalizeGainDb({ loud: { lufs: 5 } }, 'track', { target: -23 }), -15);
  assert.equal(normalizeGainDb({}, 'track'), 0, '아직 안 잰 곡은 그대로');
});

test('이퀄라이저 프리셋은 모두 10밴드, ±12dB 안', () => {
  assert.equal(EQ_FREQS.length, 10);
  for (const [k, p] of Object.entries(EQ_PRESETS)) {
    assert.equal(p.bands.length, 10, k);
    assert.ok(p.bands.every((b) => b >= -12 && b <= 12), k);
    assert.ok(p.name, k);
  }
});
