// 오디오 스펙트럼: <audio> → Web Audio 분석기 → 캔버스(재생 화면의 막대·대칭·물결, 커버 둘레 원형, 화면 아래 전체, 미니 플레이어)
// CPU 아끼기: 초당 그리는 횟수를 정해 두고(기본 30번, 창이 뒤에 있으면 15번, 미니 플레이어만이면 20번),
// 크기는 ResizeObserver로만 읽고(매 프레임 레이아웃 계산 안 함), 그라데이션은 색이 바뀔 때만 새로 만들고,
// 막대가 거의 그대로면 다시 그리지 않는다. 캔버스 해상도도 화면 배율보다 조금 낮게 (장식이라 티가 안 남)
import { cycleHue, rainbowPhase, rgb } from './colors.js';
import { bandEdges, bandLevels, bassLevel, demoLevels, fallLevels } from './spectrum.js';

const FFT = 4096;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 부드러움(초당 프레임) → 캔버스 배율 상한 (화면 아래 전체는 흐려지는 배경이라 1배로 충분)
const DPR_CAP = { 60: 2, 30: 1.25, 15: 1 };

export class Visualizer {
  // engine: 소리 엔진 (audio.js). 분석기는 엔진이 만들어 둔 것을 쓴다 (주 음량 앞이라 음량과 상관없이 같은 높이)
  constructor(engine) {
    this.engine = engine;
    this.db = null;
    this.dbAt = 0;
    this.views = [];
    this.enabled = false;
    this.fps = 30;
    this.palette = { rainbow: false, a: [29, 111, 230], b: [120, 170, 255] };
    this.paletteId = 0;
    this.demo = false; // 디자인 탭을 연 동안 멈춰 있으면 미리보기로 움직인다
    this.raf = 0;
    this.timer = 0;
    this.last = 0;
    this.t0 = performance.now();
    this.focused = document.hasFocus();
    const wake = () => this.wake();
    for (const e of ['play', 'pause', 'ended', 'emptied']) engine.onAny(e, wake);
    engine.addEventListener('ready', () => {
      for (const v of this.views) v.key = ''; // 표본율에 맞춰 막대를 다시 나눈다
      this.wake(true);
    });
    document.addEventListener('visibilitychange', wake);
    // 다른 창을 보고 있으면 덜 자주 그린다
    addEventListener('focus', () => {
      this.focused = true;
      this.wake();
    });
    addEventListener('blur', () => {
      this.focused = false;
    });
    this.resize = new ResizeObserver((entries) => {
      for (const e of entries) {
        const v = this.views.find((x) => x.canvas === e.target);
        if (!v) continue;
        v.cw = e.contentRect.width;
        v.ch = e.contentRect.height;
        v.dirty = true;
      }
      this.wake(true);
    });
  }

  get playing() {
    return this.engine.playing;
  }

  // kind: strip(재생 화면, 커버 아래) · bottom(재생 화면 아래 전체) · ring(커버 둘레) · mini(미니 플레이어). visible: 지금 화면에 보이는지
  add(canvas, kind, visible) {
    const v = { canvas, kind, visible, on: false, shape: null, g: canvas.getContext('2d'), key: '', bands: null, target: null, shown: null, drawn: null, cw: 0, ch: 0, dirty: true, styleKey: '', style: null };
    this.views.push(v);
    this.resize.observe(canvas);
    return v;
  }

  // cover: 커버 쪽 모양(bars · mirror · wave · circle · off) · bottom: 화면 아래 전체 모양(bars · mirror · wave · off)
  // fps: 초당 그리는 횟수 (15 · 30 · 60)
  configure({ enabled, cover, bottom, mini, palette, fps }) {
    this.enabled = !!enabled;
    if (palette) {
      this.palette = palette;
      this.paletteId++;
    }
    if (DPR_CAP[fps]) this.fps = fps;
    const line = (s) => (['bars', 'mirror', 'wave'].includes(s) ? s : null);
    const shapes = { strip: line(cover), ring: cover === 'circle' ? 'circle' : null, bottom: line(bottom), mini: mini ? 'bars' : null };
    for (const v of this.views) {
      const shape = this.enabled ? shapes[v.kind] : null;
      if (shape !== v.shape) v.key = ''; // 막대 개수가 바뀔 수 있음
      v.shape = shape;
      v.on = !!shape;
      v.dirty = true;
    }
    if (this.enabled && this.playing) this.engine.ensureGraph();
    this.wake(true);
  }

  setDemo(on) {
    if (this.demo === !!on) return;
    this.demo = !!on;
    this.wake(true);
  }

  // 분석기의 지금 스펙트럼 (같은 프레임에 여러 번 부르면 한 번만 계산)
  spectrum() {
    const an = this.engine.analyser;
    if (!an || !this.playing) return null;
    const now = performance.now();
    this.db ||= new Float32Array(an.frequencyBinCount);
    if (now - this.dbAt > 12) {
      an.getFloatFrequencyData(this.db);
      this.dbAt = now;
    }
    return this.db;
  }

  // 낮은음 세기 0~1 (화면 효과·커버 박자 반응용). 분석기가 없거나 멈춰 있으면 0
  bass() {
    const db = this.spectrum();
    if (!db) return 0;
    const an = this.engine.analyser;
    return bassLevel(db, { sampleRate: this.engine.ac.sampleRate, fftSize: an.fftSize });
  }

  shouldRun() {
    return !document.hidden && this.views.some((v) => v.on && v.visible());
  }

  // 지금 그릴 간격(ms): 창이 뒤에 있거나 미니 플레이어(흐린 배경)만 보이면 초당 15번까지
  interval() {
    let fps = this.fps;
    if (!this.focused || !this.views.some((v) => v.on && v.kind !== 'mini' && v.visible())) fps = Math.min(fps, 15);
    return 1000 / fps;
  }

  wake(once = false) {
    if (this.raf || this.timer || !this.shouldRun()) return;
    if (once || this.playing || this.demo) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  next(now) {
    // 다음 그릴 때까지는 타이머로 쉰다 (requestAnimationFrame을 매번 걸면 화면이 계속 새로 그려짐)
    const wait = this.interval() - (performance.now() - now) - 3;
    if (wait > 4) {
      this.timer = setTimeout(() => {
        this.timer = 0;
        if (this.shouldRun()) this.raf = requestAnimationFrame((x) => this.frame(x));
      }, wait);
    } else this.raf = requestAnimationFrame((x) => this.frame(x));
  }

  frame(now) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const t = (now - this.t0) / 1000;
    const db = this.spectrum();
    const live = !!db;
    let moving = false;
    for (const v of this.views) {
      if (!v.on || !v.visible()) continue;
      if (!this.fit(v)) continue;
      if (live) bandLevels(db, v.bands, v.target);
      else if (this.demo && !this.playing) demoLevels(v.target, t);
      else v.target.fill(0);
      if (fallLevels(v.shown, v.target, dt)) moving = true;
      if (this.changed(v)) this.draw(v);
    }
    if (this.shouldRun() && (moving || live || (this.demo && !this.playing))) this.next(now);
    else this.last = 0;
  }

  // 지난번에 그린 것과 거의 같으면 다시 그리지 않는다 (조용한 부분·멈춘 뒤)
  changed(v) {
    const style = this.styleKey(v);
    let diff = v.dirty || style !== v.styleKey;
    if (!diff) {
      const s = v.shown;
      const d = v.drawn;
      for (let i = 0; i < s.length; i++) {
        if (Math.abs(s[i] - d[i]) > 0.004) {
          diff = true;
          break;
        }
      }
    }
    if (diff) v.drawn.set(v.shown);
    return diff;
  }

  // 캔버스 크기를 화면 픽셀에 맞추고, 너비에 맞는 막대 개수로 주파수를 나눈다
  fit(v) {
    const cw = v.cw;
    const ch = v.ch;
    if (!cw || !ch) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, v.kind === 'mini' || (v.kind === 'bottom' && this.fps < 60) ? 1 : DPR_CAP[this.fps] || 1.25);
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (v.canvas.width !== w || v.canvas.height !== h) {
      v.canvas.width = w;
      v.canvas.height = h;
      v.dirty = true;
    }
    const wide = v.kind === 'bottom';
    const n =
      v.kind === 'ring'
        ? 40
        : v.kind === 'mini'
          ? clamp(Math.floor(cw / 9), 24, 120)
          : v.shape === 'wave'
            ? clamp(Math.floor(cw / (wide ? 20 : 14)), 16, wide ? 72 : 40)
            : clamp(Math.floor(cw / (wide ? 12 : 10)), 16, wide ? 128 : 64);
    const sr = this.engine.ac?.sampleRate || 48000;
    const key = `${n}|${sr}`;
    if (v.key !== key) {
      v.key = key;
      v.bands = bandEdges(n, { sampleRate: sr, fftSize: FFT });
      const old = v.shown;
      v.target = new Float32Array(n);
      v.shown = new Float32Array(n);
      v.drawn = new Float32Array(n);
      if (old) for (let i = 0; i < n; i++) v.shown[i] = old[Math.floor((i / n) * old.length)];
      v.dirty = true;
    }
    return true;
  }

  // 색이 바뀌었는지 알아보는 열쇠: 고정된 색은 팔레트가 바뀔 때만, 무지개·무지개 단색은 2도씩
  styleKey(v) {
    const p = this.palette;
    const moving = p.rainbow || p.cycle ? Math.floor(cycleHue(performance.now(), p.period) / 2) : 0;
    return `${this.paletteId}|${moving}|${v.shape}|${v.canvas.width}x${v.canvas.height}`;
  }

  // 한 색 막대의 두 색(아래 진하게 → 위 밝게). 무지개 단색은 지금 시각의 색
  pair(alpha = 1) {
    const p = this.palette;
    if (!p.cycle) return [rgb(p.a, alpha), rgb(p.b, alpha)];
    const h = Math.round(cycleHue(performance.now(), p.period) + p.offset) % 360;
    const a = alpha < 1 ? ` / ${alpha}` : '';
    return [`hsl(${h} ${p.s}% ${p.l}%${a})`, `hsl(${(h + 12) % 360} ${p.s}% ${Math.min(p.l + 18, 92)}%${a})`];
  }

  // 무지개(여러 색)는 정한 속도로 색이 흐른다 (위쪽 배경과 같은 시계, 정한 만큼 어긋나게)
  fill(g, x0, y0, x1, y1) {
    const p = this.palette;
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    if (p.rainbow) {
      const base = cycleHue(performance.now(), p.period) + p.offset;
      for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, `hsl(${Math.round(base + k * 55) % 360} ${p.s}% ${p.l}%)`);
    } else {
      const [a, b] = this.pair();
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
    }
    return grad;
  }

  // 모양·크기·색이 그대로면 지난번 그라데이션을 다시 쓴다
  styles(v) {
    const key = this.styleKey(v);
    if (v.style && v.styleKey === key) return v.style;
    const { g } = v;
    const { width: W, height: H } = v.canvas;
    const p = this.palette;
    let s;
    if (v.shape === 'circle') {
      const c = W / 2;
      const r0 = W * 0.375;
      const maxLen = W * 0.5 - r0 - 3 * (W / Math.max(1, v.cw));
      if (p.rainbow) {
        const grad = g.createConicGradient(-Math.PI / 2 + rainbowPhase(performance.now(), p.period) * Math.PI * 2, c, c);
        for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, `hsl(${(k * 60 + p.offset) % 360} ${p.s}% ${p.l}%)`);
        s = { stroke: grad };
      } else {
        const [a, b] = this.pair();
        const grad = g.createRadialGradient(c, c, r0, c, c, r0 + maxLen);
        grad.addColorStop(0, a);
        grad.addColorStop(1, b);
        s = { stroke: grad };
      }
    } else if (v.shape === 'wave') {
      s = { fill: p.rainbow ? this.fill(g, 0, 0, W, 0) : this.fill(g, 0, H, 0, 0), stroke: p.rainbow ? this.fill(g, 0, 0, W, 0) : this.pair()[1] };
    } else if (v.shape === 'mirror') {
      s = { fill: p.rainbow ? this.fill(g, 0, 0, W, 0) : this.mirrorFill(g, H) };
    } else {
      s = { fill: p.rainbow ? this.fill(g, 0, 0, W, 0) : this.fill(g, 0, H, 0, 0) };
    }
    // 화면 아래 전체: 위로 갈수록 투명하게 (CSS mask 대신 캔버스 안에서 — 화면 합성 비용이 훨씬 적다)
    if (v.kind === 'bottom') {
      const fade = g.createLinearGradient(0, H, 0, 0);
      fade.addColorStop(0, '#000');
      fade.addColorStop(0.55, '#000');
      fade.addColorStop(1, 'rgb(0 0 0 / 0)');
      s.fade = fade;
    }
    v.style = s;
    v.styleKey = key;
    return s;
  }

  draw(v) {
    const { g, canvas } = v;
    v.dirty = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const s = this.styles(v);
    if (v.shape === 'circle') this.drawRing(v, s);
    else if (v.shape === 'wave') this.drawWave(v, s);
    else this.drawBars(v, s, v.shape === 'mirror');
    if (s.fade) {
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = s.fade;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.globalCompositeOperation = 'source-over';
    }
  }

  drawBars(v, s, mirror) {
    const { g, shown } = v;
    const { width: W, height: H } = v.canvas;
    const n = shown.length;
    const slot = W / n;
    const bw = Math.max(1, slot * 0.6);
    const r = bw / 2;
    const minH = v.kind === 'mini' ? 0 : bw; // 재생 화면은 조용할 때 점이 한 줄 남고, 미니 플레이어는 깨끗하게
    // 무지개: 왼쪽→오른쪽으로 색이 바뀜 · 한 색: 아래(진하게)→위(밝게)
    g.fillStyle = s.fill;
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
    const [a, b] = this.pair();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, b);
    grad.addColorStop(0.5, a);
    grad.addColorStop(1, this.pair(0.55)[1]);
    return grad;
  }

  drawWave(v, s) {
    const { g, shown } = v;
    const { width: W, height: H } = v.canvas;
    const n = shown.length;
    const y = (i) => H - (0.06 + shown[i] * 0.88) * H;
    const x = (i) => (i / (n - 1)) * W;
    const curve = new Path2D();
    curve.moveTo(x(0), y(0));
    for (let i = 1; i < n; i++) curve.quadraticCurveTo(x(i - 1), y(i - 1), (x(i - 1) + x(i)) / 2, (y(i - 1) + y(i)) / 2);
    curve.lineTo(x(n - 1), y(n - 1));
    const area = new Path2D(curve);
    area.lineTo(W, H);
    area.lineTo(0, H);
    area.closePath();
    g.globalAlpha = 0.4;
    g.fillStyle = s.fill;
    g.fill(area);
    g.globalAlpha = 1;
    g.lineWidth = 2.2 * (W / Math.max(1, v.cw));
    g.lineJoin = 'round';
    g.strokeStyle = s.stroke;
    g.stroke(curve);
  }

  // 커버(가운데 72%) 둘레로 퍼지는 막대. 왼쪽·오른쪽이 같은 모양(위가 낮은음)
  drawRing(v, s) {
    const { g, shown } = v;
    const W = v.canvas.width;
    const c = W / 2;
    const scale = W / Math.max(1, v.cw);
    const r0 = W * 0.375;
    const maxLen = W * 0.5 - r0 - 3 * scale;
    const half = shown.length;
    const n = half * 2;
    const step = (Math.PI * 2) / n;
    g.lineWidth = Math.max(1.5 * scale, step * r0 * 0.5);
    g.lineCap = 'round';
    g.strokeStyle = s.stroke;
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const lv = shown[k < half ? k : n - 1 - k];
      const len = Math.max(g.lineWidth * 0.2, lv * maxLen);
      const a = -Math.PI / 2 + (k + 0.5) * step;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      g.moveTo(c + cos * r0, c + sin * r0);
      g.lineTo(c + cos * (r0 + len), c + sin * (r0 + len));
    }
    g.stroke();
  }
}
