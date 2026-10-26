// 음량 평준화·무음 건너뛰기에 쓰는 곡 분석. 쉬는 틈에 한 곡씩:
//   파일 받기 → 소리 풀기(22.05kHz로 줄여서, 메모리 아끼기) → 워커에서 세기·무음 재기 → 서버에 저장
import { audioUrl, put } from './api.js';
import { ANALYSIS_VERSION } from './loudness.js';
import { ctx } from './ctx.js';
import { liteActive } from './lite.js';
import { store } from './store.js';

const MAX_SECONDS = 20 * 60; // 이보다 긴 파일(믹스 등)은 재지 않는다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Analyzer extends EventTarget {
  constructor() {
    super();
    this.running = false;
    this.wanted = false;
    this.done = 0;
    this.total = 0;
    this.failed = new Set();
    this.worker = null;
    this.waiting = new Map();
  }

  pending() {
    return store.list.filter((t) => t.loud?.v !== ANALYSIS_VERSION && !this.failed.has(t.id) && !(t.duration > MAX_SECONDS));
  }

  get progress() {
    return { running: this.running, done: this.done, total: this.total, left: this.pending().length };
  }

  emit() {
    this.dispatchEvent(new CustomEvent('progress', { detail: this.progress }));
  }

  start() {
    this.wanted = true;
    if (!this.running) this.run();
  }

  stop() {
    this.wanted = false;
  }

  async run() {
    this.running = true;
    const todo = this.pending();
    this.total = todo.length;
    this.done = 0;
    this.emit();
    for (const t of todo) {
      // 저사양 모드에서는 음악을 듣는 동안 재지 않고, 멈췄을 때만 잰다
      while (this.wanted && liteActive() && ctx.player?.playing) await sleep(5000);
      if (!this.wanted) break;
      if (store.tracks.get(t.id)?.loud?.v === ANALYSIS_VERSION) {
        this.done++;
        continue;
      }
      const t0 = performance.now();
      try {
        const r = await this.analyzeTrack(t);
        t.loud = r;
        await put(`/api/tracks/${t.id}/analysis`, r);
      } catch (e) {
        this.failed.add(t.id);
        console.warn('곡 분석 실패', t.title, e);
      }
      this.done++;
      this.emit();
      // CPU를 혼자 다 쓰지 않게: 한 곡 재는 데 걸린 시간의 몇 배만큼 쉰다 (음악을 듣는 중이면 더 길게)
      const took = performance.now() - t0;
      await sleep(Math.min(20_000, Math.max(300, took * (ctx.player?.playing ? 4 : 1.5))));
    }
    this.running = false;
    this.emit();
  }

  async analyzeTrack(t) {
    const buf = await (await fetch(audioUrl(t.id))).arrayBuffer();
    const oac = new OfflineAudioContext(1, 1, 22050);
    const audio = await oac.decodeAudioData(buf);
    const channels = [];
    for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c).slice());
    return this.measure(t.id, audio.sampleRate, channels);
  }

  measure(id, fs, channels) {
    this.worker ||= this.makeWorker();
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage(
        { id, fs, channels },
        channels.map((c) => c.buffer),
      );
    });
  }

  makeWorker() {
    const w = new Worker('/js/analyzer-worker.js', { type: 'module' });
    w.onmessage = (e) => {
      const p = this.waiting.get(e.data.id);
      if (!p) return;
      this.waiting.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    w.onerror = (e) => {
      for (const p of this.waiting.values()) p.reject(new Error(e.message || '분석 워커 오류'));
      this.waiting.clear();
      this.worker = null;
    };
    return w;
  }
}
