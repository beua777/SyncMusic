// 음량 분석 워커: 풀어 놓은 소리(채널마다 Float32Array)를 받아 세기·피크·무음 구간을 잰다 (화면이 버벅이지 않게 따로)
import { analyze } from './loudness.js';

self.onmessage = (e) => {
  const { id, fs, channels } = e.data;
  try {
    self.postMessage({ id, result: analyze(channels, fs) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
