// 오디오 스펙트럼: <audio> → Web Audio 분석기 → 캔버스(재생 화면의 막대·대칭·물결, 커버 둘레 원형, 화면 아래 전체, 미니 플레이어)
import { rgb } from './colors.js';
import { bandEdges, bandLevels, demoLevels, fallLevels, volumeGainDb } from './spectrum.js';

const FFT = 4096;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Visualizer {
  constructor(audio) {
    this.audio = audio;
    this.ac = null;
    this.analyser = null;
    this.db = null;
    this.connecting = null;
    this.views = [];
    this.enabled = false;
    this.style = 'bars';
    this.palette = { rainbow: false, a: [29, 111, 230], b: [120, 170, 255] };
    this.demo = false; // 디자인 탭을 연 동안 멈춰 있으면 미리보기로 움직인다
    this.raf = 0;
    this.last = 0;
    this.t0 = performance.now();
    const wake = () => this.wake();
    audio.addEventListener('play', () => this.connect());
    for (const e of ['play', 'pause', 'ended', 'emptied', 'volumechange']) audio.addEventListener(e, wake);
    document.addEventListener('visibilitychange', wake);
    // 미디어 키로 시작해서 아직 못 붙었으면, 창을 처음 누를 때 붙인다
    const retry = () => !this.analyser && this.playing && this.connect();
    document.addEventListener('pointerdown', retry, { passive: true });
    document.addEventListener('keydown', retry, { passive: true });
    this.resize = new ResizeObserver(() => this.wake(true));
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  // kind: strip(재생 화면, 커버 아래) · bottom(재생 화면 아래 전체) · ring(커버 둘레) · mini(미니 플레이어). visible: 지금 화면에 보이는지
  add(canvas, kind, visible) {
    const v = { canvas, kind, visible, on: false, g: canvas.getContext('2d'), key: '', bands: null, target: null, shown: null };
    this.views.push(v);
    this.resize.observe(canvas);
    return v;
  }

  configure({ enabled, style, place, mini, palette }) {
    this.enabled = !!enabled;
    this.style = style;
    if (palette) this.palette = palette;
    const where = style === 'circle' ? 'ring' : place === 'bottom' ? 'bottom' : 'strip';
    for (const v of this.views) {
      v.on = this.enabled && (v.kind === 'mini' ? !!mini : v.kind === where);
      v.key = ''; // 막대 개수가 바뀔 수 있음
    }
    if (this.enabled && this.playing) this.connect();
    this.wake(true);
  }

  setDemo(on) {
    if (this.demo === !!on) return;
    this.demo = !!on;
    this.wake(true);
  }

  // 소리가 끊기지 않게, AudioContext가 실제로 돌아갈 때만 <audio>를 분석기에 연결한다
  // (한 번 연결하면 소리가 이 경로로만 나가서, 멈춘 컨텍스트에 붙이면 무음이 된다)
  connect() {
    if (!this.enabled || this.analyser) {
      if (this.ac?.state === 'suspended' && this.playing) this.ac.resume().catch(() => {});
      return this.connecting;
    }
    this.connecting ||= (async () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ac ||= new AC({ latencyHint: 'playback' });
        if (this.ac.state !== 'running') await this.ac.resume();
        if (this.ac.state !== 'running' || this.analyser) return;
        const an = this.ac.createAnalyser();
        an.fftSize = FFT;
        an.smoothingTimeConstant = 0.6;
        this.ac.createMediaElementSource(this.audio).connect(an);
        an.connect(this.ac.destination);
        this.db = new Float32Array(an.frequencyBinCount);
        this.analyser = an;
        this.ac.addEventListener('statechange', () => {
          if (this.ac.state === 'suspended' && this.playing) this.ac.resume().catch(() => {});
        });
        for (const v of this.views) v.key = ''; // 샘플레이트에 맞춰 막대를 다시 나눈다
      } catch (e) {
        console.warn('오디오 스펙트럼을 켤 수 없어요:', e);
      }
    })().finally(() => {
      this.connecting = null;
      this.wake();
    });
    return this.connecting;
  }

  shouldRun() {
    return !document.hidden && this.views.some((v) => v.on && v.visible());
  }

  wake(once = false) {
    if (this.raf || !this.shouldRun()) return;
    if (once || this.playing || this.demo) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const t = (now - this.t0) / 1000;
    const live = this.playing && this.analyser;
    if (live) this.analyser.getFloatFrequencyData(this.db);
    const gainDb = volumeGainDb(this.audio.muted ? 0 : this.audio.volume);
    let moving = false;
    for (const v of this.views) {
      if (!v.on || !v.visible()) continue;
      if (!this.fit(v)) continue;
      if (live) bandLevels(this.db, v.bands, v.target, { gainDb });
      else if (this.demo && !this.playing) demoLevels(v.target, t);
      else v.target.fill(0);
      if (fallLevels(v.shown, v.target, dt)) moving = true;
      this.draw(v, t);
    }
    if (this.shouldRun() && (moving || live || (this.demo && !this.playing))) this.raf = requestAnimationFrame((x) => this.frame(x));
    else this.last = 0;
  }

  // 캔버스 크기를 화면 픽셀에 맞추고, 너비에 맞는 막대 개수로 주파수를 나눈다
  fit(v) {
    const dpr = window.devicePixelRatio || 1;
    const cw = v.canvas.clientWidth;
    const ch = v.canvas.clientHeight;
    if (!cw || !ch) return false;
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (v.canvas.width !== w || v.canvas.height !== h) {
      v.canvas.width = w;
      v.canvas.height = h;
    }
    const wide = v.kind === 'bottom';
    const n =
      v.kind === 'ring'
        ? 40
        : v.kind === 'mini'
          ? clamp(Math.floor(cw / 9), 24, 120)
          : this.style === 'wave'
            ? clamp(Math.floor(cw / (wide ? 20 : 14)), 16, wide ? 72 : 40)
            : clamp(Math.floor(cw / (wide ? 12 : 10)), 16, wide ? 128 : 64);
    const sr = this.ac?.sampleRate || 48000;
    const key = `${n}|${sr}`;
    if (v.key !== key) {
      v.key = key;
      v.bands = bandEdges(n, { sampleRate: sr, fftSize: FFT });
      const old = v.shown;
      v.target = new Float32Array(n);
      v.shown = new Float32Array(n);
      if (old) for (let i = 0; i < n; i++) v.shown[i] = old[Math.floor((i / n) * old.length)];
    }
    return true;
  }

  // 무지개는 시간이 갈수록 색이 천천히 흐른다
  fill(g, x0, y0, x1, y1, t) {
    const p = this.palette;
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    if (p.rainbow) {
      for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, `hsl(${Math.round(t * 24 + k * 55) % 360} ${p.s}% ${p.l}%)`);
    } else {
      grad.addColorStop(0, rgb(p.a));
      grad.addColorStop(1, rgb(p.b));
    }
    return grad;
  }

  draw(v, t) {
    const { g, canvas } = v;
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (v.kind === 'ring') return this.drawRing(v, t);
    const shaped = v.kind === 'strip' || v.kind === 'bottom';
    if (shaped && this.style === 'wave') return this.drawWave(v, t);
    return this.drawBars(v, t, shaped && this.style === 'mirror');
  }

  drawBars(v, t, mirror) {
    const { g, shown } = v;
    const { width: W, height: H } = v.canvas;
    const n = shown.length;
    const slot = W / n;
    const bw = Math.max(1, slot * 0.6);
    const r = bw / 2;
    const minH = v.kind === 'mini' ? 0 : bw; // 재생 화면은 조용할 때 점이 한 줄 남고, 미니 플레이어는 깨끗하게
    // 무지개: 왼쪽→오른쪽으로 색이 바뀜 · 한 색: 아래(진하게)→위(밝게)
    g.fillStyle = this.palette.rainbow ? this.fill(g, 0, 0, W, 0, t) : mirror ? this.mirrorFill(g, H) : this.fill(g, 0, H, 0, 0, t);
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * slot + (slot - bw) / 2;
      const h = Math.max(minH, shown[i] * H);
      if (h < 0.5) continue;
      if (mirror) g.roundRect(x, (H - h) / 2, bw, h, Math.min(r, h / 2));
      else g.roundRect(x, H - h, bw, h, [Math.min(r, h), Math.min(r, h), Math.min(r, 2), Math.min(r, 2)]);
    }
    g.fill();
  }

  mirrorFill(g, H) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(this.palette.b));
    grad.addColorStop(0.5, rgb(this.palette.a));
    grad.addColorStop(1, rgb(this.palette.b, 0.55));
    return grad;
  }

  drawWave(v, t) {
    const { g, shown } = v;
    const { width: W, height: H } = v.canvas;
    const n = shown.length;
    const dpr = window.devicePixelRatio || 1;
    const pts = Array.from(shown, (s, i) => [(i / (n - 1)) * W, H - (0.06 + s * 0.88) * H]);
    const curve = new Path2D();
    curve.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      curve.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    }
    curve.lineTo(pts[n - 1][0], pts[n - 1][1]);
    const area = new Path2D(curve);
    area.lineTo(W, H);
    area.lineTo(0, H);
    area.closePath();
    g.globalAlpha = 0.4;
    g.fillStyle = this.palette.rainbow ? this.fill(g, 0, 0, W, 0, t) : this.fill(g, 0, H, 0, 0, t);
    g.fill(area);
    g.globalAlpha = 1;
    g.lineWidth = 2.2 * dpr;
    g.lineJoin = 'round';
    g.strokeStyle = this.palette.rainbow ? this.fill(g, 0, 0, W, 0, t) : rgb(this.palette.b);
    g.stroke(curve);
  }

  // 커버(가운데 72%) 둘레로 퍼지는 막대. 왼쪽·오른쪽이 같은 모양(위가 낮은음)
  drawRing(v, t) {
    const { g, shown } = v;
    const W = v.canvas.width;
    const c = W / 2;
    const dpr = window.devicePixelRatio || 1;
    const r0 = W * 0.375;
    const maxLen = W * 0.5 - r0 - 3 * dpr;
    const half = shown.length;
    const n = half * 2;
    const step = (Math.PI * 2) / n;
    g.lineWidth = Math.max(1.5 * dpr, step * r0 * 0.5);
    g.lineCap = 'round';
    if (this.palette.rainbow) {
      const grad = g.createConicGradient(-Math.PI / 2 + t * 0.4, c, c);
      for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, `hsl(${k * 60} ${this.palette.s}% ${this.palette.l}%)`);
      g.strokeStyle = grad;
    } else {
      const grad = g.createRadialGradient(c, c, r0, c, c, r0 + maxLen);
      grad.addColorStop(0, rgb(this.palette.a));
      grad.addColorStop(1, rgb(this.palette.b));
      g.strokeStyle = grad;
    }
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const s = shown[k < half ? k : n - 1 - k];
      const len = Math.max(g.lineWidth * 0.2, s * maxLen);
      const a = -Math.PI / 2 + (k + 0.5) * step;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      g.moveTo(c + cos * r0, c + sin * r0);
      g.lineTo(c + cos * (r0 + len), c + sin * (r0 + len));
    }
    g.stroke();
  }
}
