// 소리 엔진. <audio> 두 개(곡 사이 크로스페이드용)를 Web Audio로 잇는다
//   덱마다: <audio> → 페이드(재생·일시정지 페이드, 크로스페이드) → 곡 음량(음량 평준화 + 곡별 음량)
//   → 합치기 → 프리앰프 → 이퀄라이저 10밴드 → 리미터(소리를 키웠을 때 찢어지지 않게) → 분석기(스펙트럼) → 주 음량 → 스피커
// AudioContext는 창을 한 번이라도 눌러야 돈다. 그 전에는 <audio>가 직접 소리를 내고(음량도 <audio>로),
// 돌기 시작하면 이 경로로 옮긴다. 멈춘 컨텍스트에 연결하면 소리가 안 나서, 돌 때만 연결한다.

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: { name: '기본', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: '저음 강화', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  treble: { name: '고음 강화', bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  vocal: { name: '보컬', bands: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  pop: { name: '팝', bands: [-1, 1, 3, 4, 2, 0, -1, -1, 1, 2] },
  rock: { name: '록', bands: [5, 4, 2, -1, -2, -1, 2, 3, 4, 5] },
  jazz: { name: '재즈', bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  classical: { name: '클래식', bands: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  electronic: { name: '일렉트로닉', bands: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5] },
  hiphop: { name: '힙합', bands: [5, 4, 2, 3, -1, -1, 1, -1, 2, 3] },
  acoustic: { name: '어쿠스틱', bands: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1] },
  night: { name: '밤에 작게', bands: [-4, -3, -1, 0, 1, 2, 1, 0, -2, -3] },
};

export const dbToGain = (db) => 10 ** (db / 20);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 같은 소리 세기로 들리게 바꾸는 곡선 (크로스페이드). in: 0→1, out: 1→0
function powerCurve(kind, n = 64) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    a[i] = kind === 'in' ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
  }
  return a;
}

function newDeck() {
  const el = new Audio();
  el.preload = 'auto';
  return { el, src: null, fade: null, trim: null, trimDb: 0 };
}

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.decks = [newDeck(), newDeck()];
    this.active = 0;
    this.ac = null;
    this.nodes = null; // 연결되면 { mix, pre, bands, limiter, analyser, master }
    this.connecting = null;
    this.vol = 1;
    this.muted = false;
    this.eq = { on: false, pre: 0, bands: EQ_FREQS.map(() => 0) };
    this.fadeMs = 0;
    this.rate = 1;
    this.keepPitch = true;
    this.pausing = null; // 페이드 아웃 중인 일시정지
    this.xf = null; // 진행 중인 크로스페이드 { out, timer }
    for (const d of this.decks) d.el.addEventListener('play', () => this.ensureGraph());
    // 미디어 키로 시작해서 아직 못 붙었으면, 창을 처음 누를 때 붙인다
    const retry = () => !this.nodes && !this.el.paused && this.ensureGraph();
    document.addEventListener('pointerdown', retry, { passive: true });
    document.addEventListener('keydown', retry, { passive: true });
  }

  get el() {
    return this.decks[this.active].el;
  }

  get deck() {
    return this.decks[this.active];
  }

  get ready() {
    return !!this.nodes;
  }

  get analyser() {
    return this.nodes?.analyser || null;
  }

  get playing() {
    return !this.el.paused && !this.el.ended && !this.pausing;
  }

  // 두 덱의 <audio> 이벤트를 한 곳에서 (지금 덱의 것만 넘긴다)
  on(type, fn) {
    for (const d of this.decks) d.el.addEventListener(type, (e) => d === this.deck && fn(e));
  }

  // 지금 덱이든 아니든 모든 덱의 이벤트 (스펙트럼·효과가 그릴지 말지 정할 때)
  onAny(type, fn) {
    for (const d of this.decks) d.el.addEventListener(type, fn);
  }

  ensureGraph() {
    if (this.nodes) {
      if (this.ac.state === 'suspended' && !this.el.paused) this.ac.resume().catch(() => {});
      return Promise.resolve(true);
    }
    this.connecting ||= (async () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ac ||= new AC({ latencyHint: 'playback' });
        if (this.ac.state !== 'running') await this.ac.resume();
        if (this.ac.state !== 'running' || this.nodes) return !!this.nodes;
        this.build();
        return true;
      } catch (e) {
        console.warn('Web Audio를 켤 수 없어요:', e);
        return false;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  build() {
    const ac = this.ac;
    const mix = ac.createGain();
    const pre = ac.createGain();
    const bands = EQ_FREQS.map((f, i) => {
      const b = ac.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -0.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.6;
    const master = ac.createGain();
    for (const d of this.decks) {
      d.src = ac.createMediaElementSource(d.el);
      d.fade = ac.createGain();
      d.trim = ac.createGain();
      d.trim.gain.value = dbToGain(d.trimDb);
      d.src.connect(d.fade).connect(d.trim).connect(mix);
      d.el.volume = 1; // 이제 음량은 주 음량(master)이 맡는다
      d.el.muted = false;
    }
    analyser.connect(master).connect(ac.destination);
    this.nodes = { mix, pre, bands, limiter, analyser, master };
    this.routeKey = '';
    this.route(true);
    ac.addEventListener('statechange', () => {
      if (ac.state === 'suspended' && !this.el.paused) ac.resume().catch(() => {});
    });
    this.applyVolume();
    this.applyEq(true);
    this.dispatchEvent(new Event('ready'));
  }

  // ───── 음량 ─────

  setVolume(v) {
    this.vol = clamp(Number(v) || 0, 0, 1);
    if (this.vol > 0) this.muted = false;
    this.applyVolume();
  }

  setMuted(m) {
    this.muted = !!m;
    this.applyVolume();
  }

  applyVolume() {
    const v = this.muted ? 0 : this.vol;
    if (this.nodes) {
      this.nodes.master.gain.setTargetAtTime(v, this.ac.currentTime, 0.02);
      return;
    }
    // 아직 Web Audio 전: <audio>로 직접. 곡 음량(평준화)도 줄이는 쪽만 흉내 낸다
    for (const d of this.decks) d.el.volume = clamp(v * Math.min(1, dbToGain(d.trimDb)), 0, 1);
  }

  // 곡 음량 (음량 평준화 + 곡별 음량, dB). deck을 안 주면 지금 덱
  setTrim(db, deck = this.deck) {
    deck.trimDb = clamp(Number(db) || 0, -24, 15);
    if (deck.trim) {
      deck.trim.gain.setTargetAtTime(dbToGain(deck.trimDb), this.ac.currentTime, 0.05);
      this.route(!this.playing); // 키우는 곡이면 리미터를 넣는다 (빼는 건 멈췄을 때만 — 재생 중에 잇기를 바꾸면 '틱' 소리가 날 수 있음)
    } else this.applyVolume();
  }

  // 쓰지 않는 처리는 빼고 잇는다 (CPU 아끼기): EQ가 꺼져 있으면 필터 10개를, 소리를 키우는 게 없으면 리미터를 거치지 않는다
  // mix → [프리앰프 → 필터 10개] → [리미터] → 분석기 → 주 음량 → 스피커
  route(allowRemove = true) {
    const n = this.nodes;
    if (!n) return;
    const e = this.eq;
    const eqUsed = e.on && (e.pre !== 0 || e.bands.some((b) => b !== 0));
    const boost = (eqUsed && (e.pre > 0 || e.bands.some((b) => b > 0))) || this.decks.some((d) => d.trimDb > 0);
    const [wasEq, wasLimit] = this.routeKey ? this.routeKey.split('|').map((x) => x === '1') : [null, null];
    const limit = boost || (!allowRemove && !!wasLimit);
    const useEq = eqUsed || (!allowRemove && !!wasEq);
    const key = `${useEq ? 1 : 0}|${limit ? 1 : 0}`;
    if (key === this.routeKey) return;
    this.routeKey = key;
    n.mix.disconnect();
    n.pre.disconnect();
    for (const b of n.bands) b.disconnect();
    n.limiter.disconnect();
    let node = n.mix;
    if (useEq) {
      node = node.connect(n.pre);
      for (const b of n.bands) node = node.connect(b);
    }
    if (limit) node = node.connect(n.limiter);
    node.connect(n.analyser);
  }

  // ───── 이퀄라이저 ─────

  setEq({ on, pre, bands }) {
    this.eq = {
      on: !!on,
      pre: clamp(Number(pre) || 0, -12, 12),
      bands: EQ_FREQS.map((_, i) => clamp(Number(bands?.[i]) || 0, -12, 12)),
    };
    this.applyEq();
  }

  applyEq(now = false) {
    if (!this.nodes) return;
    const t = this.ac.currentTime;
    const set = (param, v) => (now ? (param.value = v) : param.setTargetAtTime(v, t, 0.03));
    set(this.nodes.pre.gain, dbToGain(this.eq.on ? this.eq.pre : 0));
    this.nodes.bands.forEach((b, i) => set(b.gain, this.eq.on ? this.eq.bands[i] : 0));
    this.route(true);
  }

  // ───── 속도 ─────

  setRate(rate, keepPitch = true) {
    this.rate = clamp(Number(rate) || 1, 0.5, 2);
    this.keepPitch = !!keepPitch;
    for (const d of this.decks) this.applyRate(d.el);
  }

  applyRate(el) {
    el.defaultPlaybackRate = this.rate; // 새 곡을 불러올 때 이 값으로 돌아간다
    el.playbackRate = this.rate;
    el.preservesPitch = this.keepPitch;
  }

  // ───── 재생 ─────

  load(url) {
    this.cancelCrossfade();
    this.cancelPausing();
    const d = this.deck;
    this.resetFade(d, 1);
    d.el.src = url;
    this.applyRate(d.el);
  }

  play() {
    this.cancelPausing();
    const d = this.deck;
    if (this.nodes && d.el.paused && this.fadeMs > 0) this.rampFade(d, 0, 1, this.fadeMs / 1000, 'linear');
    else this.resetFade(d, 1);
    this.ensureGraph();
    return d.el.play();
  }

  // 페이드 아웃 뒤에 멈춘다. 그사이 다시 재생하면 취소
  pause() {
    this.cancelCrossfade();
    const d = this.deck;
    if (d.el.paused || this.pausing) return;
    if (!this.nodes || this.fadeMs <= 0) {
      d.el.pause();
      return;
    }
    this.rampFade(d, null, 0, this.fadeMs / 1000, 'linear');
    const timer = setTimeout(() => {
      if (this.pausing?.timer !== timer) return;
      this.pausing = null;
      d.el.pause();
    }, this.fadeMs);
    this.pausing = { timer };
    this.dispatchEvent(new Event('pausing'));
  }

  cancelPausing() {
    if (!this.pausing) return;
    clearTimeout(this.pausing.timer);
    this.pausing = null;
  }

  stop() {
    this.cancelCrossfade();
    this.cancelPausing();
    const el = this.el;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  // 수면 타이머: 천천히 줄이다가 멈춘다
  fadeOutAndPause(ms = 3000) {
    return new Promise((resolve) => {
      const d = this.deck;
      if (this.nodes) {
        this.rampFade(d, null, 0, ms / 1000, 'linear');
        setTimeout(() => {
          d.el.pause();
          this.resetFade(d, 1);
          resolve();
        }, ms);
        return;
      }
      const start = this.vol;
      let i = 0;
      const t = setInterval(() => {
        i++;
        d.el.volume = start * (1 - i / 20);
        if (i >= 20) {
          clearInterval(t);
          d.el.pause();
          this.applyVolume();
          resolve();
        }
      }, ms / 20);
    });
  }

  // ───── 크로스페이드: 다음 곡을 다른 덱에서 시작하고, 두 곡을 secs초 동안 겹친다 ─────

  canCrossfade() {
    return !!this.nodes && !this.xf;
  }

  crossfade(url, secs, { trimDb = 0, startAt = 0 } = {}) {
    const out = this.deck;
    const inc = this.decks[1 - this.active];
    inc.el.src = url;
    this.applyRate(inc.el);
    if (startAt > 0) inc.el.addEventListener('loadedmetadata', () => (inc.el.currentTime = startAt), { once: true });
    this.setTrim(trimDb, inc);
    this.rampFade(inc, 0, 1, secs, 'in');
    this.rampFade(out, null, 0, secs, 'out');
    this.active = 1 - this.active;
    inc.el.play().catch(() => {});
    const timer = setTimeout(() => {
      if (this.xf?.timer !== timer) return;
      this.xf = null;
      this.silence(out);
    }, secs * 1000 + 150);
    this.xf = { out, timer };
    return inc.el;
  }

  // 겹치던 앞 곡을 바로 끈다 (곡을 고르거나 멈출 때)
  cancelCrossfade() {
    if (!this.xf) return;
    clearTimeout(this.xf.timer);
    this.silence(this.xf.out);
    this.xf = null;
  }

  silence(d) {
    d.el.pause();
    d.el.removeAttribute('src');
    d.el.load();
    this.resetFade(d, 1);
  }

  // 예약된 변화를 멈추고 지금 값에 붙잡아 둔다 (그냥 취소하면 이전 값으로 튀어서 '틱' 소리가 난다)
  hold(g, t) {
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else {
      const v = g.value;
      g.cancelScheduledValues(t);
      g.setValueAtTime(v, t);
    }
  }

  resetFade(d, v) {
    if (!d.fade) return;
    const t = this.ac.currentTime;
    d.fade.gain.cancelScheduledValues(t);
    d.fade.gain.setValueAtTime(v, t);
  }

  // from이 null이면 지금 값에서 시작. kind: linear · in · out(같은 세기로 들리는 곡선)
  rampFade(d, from, to, secs, kind) {
    if (!d.fade) return;
    const g = d.fade.gain;
    const t = this.ac.currentTime;
    this.hold(g, t);
    const start = from ?? g.value;
    if (kind === 'linear' || secs <= 0) {
      g.setValueAtTime(start, t);
      g.linearRampToValueAtTime(to, t + Math.max(0.005, secs));
      return;
    }
    // 곡선은 시작 값도 곡선 안에 들어 있어서 따로 setValueAtTime을 두지 않는다 (같은 시각에 겹치면 오류)
    const curve = powerCurve(kind).map((x) => (kind === 'in' ? start + (to - start) * x : to + (start - to) * x));
    g.setValueCurveAtTime(curve, t + 0.001, secs);
  }
}

// 음량 평준화: 곡(또는 앨범)이 목표 세기(LUFS)로 들리게 하는 dB.
// ReplayGain 태그(기준 -18 LUFS)가 있으면 그걸, 없으면 직접 잰 세기(loud.lufs)를 쓴다.
// 소리를 키우면 피크가 0dBFS를 넘지 않게 줄인다 (넘는 만큼은 리미터가 잡는다)
export function normalizeGainDb(t, mode, { target = -14, albumLufs = null } = {}) {
  if (!t || mode === 'off' || !mode) return 0;
  let gain = null;
  if (mode === 'album') {
    if (Number.isFinite(t.rg?.album)) gain = t.rg.album + (target + 18);
    else if (Number.isFinite(albumLufs)) gain = target - albumLufs;
  }
  if (gain === null) {
    if (Number.isFinite(t.rg?.track)) gain = t.rg.track + (target + 18);
    else if (Number.isFinite(t.loud?.lufs)) gain = target - t.loud.lufs;
    else return 0;
  }
  const peak = t.rg?.peak || t.loud?.peak;
  if (gain > 0 && peak > 0) gain = Math.min(gain, -20 * Math.log10(peak) + 1);
  return clamp(gain, -15, 10);
}
