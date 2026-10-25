// 화면 효과: 눈 · 벚꽃 · 낙엽 · 비 · 별 · 반딧불 · 비눗방울 · 하트.
// '음악에 반응'이면 박자(낮은음)에 맞춰 빨라지고 밝아진다. 박자에 맞춰 커버가 커지거나 뒤에서 빛나는 것도 여기서 한다
import { cycleHue, rainbowPeriod } from './colors.js';
import { BeatFollower } from './spectrum.js';

// 1920×1080 창, 양 50일 때 개수
export const EFFECT_BASE = { snow: 150, sakura: 44, leaves: 28, rain: 200, stars: 90, fireflies: 34, bubbles: 28, hearts: 24 };

export function effectCount(kind, w, h, amount) {
  const base = EFFECT_BASE[kind];
  if (!base) return 0;
  const area = Math.min(2, Math.max(0.3, (w * h) / (1920 * 1080)));
  return Math.max(1, Math.round(base * area * (Math.max(1, Math.min(100, amount)) / 50)));
}

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// 효과마다 기본 색 (라이트 테마에서는 밝은 배경에서도 보이게 조금 진하게)
const NATURAL = {
  snow: (dark) => (dark ? [255, 255, 255] : [160, 180, 208]),
  sakura: (dark) => (dark ? [255, 192, 212] : [242, 150, 182]),
  leaves: () => pick([[232, 135, 58], [205, 80, 46], [228, 176, 64], [168, 104, 46]]),
  rain: (dark) => (dark ? [170, 196, 255] : [86, 118, 170]),
  stars: (dark) => (dark ? [255, 246, 220] : [222, 172, 48]),
  fireflies: (dark) => (dark ? [212, 255, 120] : [150, 196, 30]),
  bubbles: (dark) => (dark ? [200, 228, 255] : [100, 150, 205]),
  hearts: () => pick([[255, 92, 138], [255, 140, 172], [238, 66, 92]]),
};

function petal(g, s) {
  g.beginPath();
  g.moveTo(0, -s);
  g.bezierCurveTo(s * 0.95, -s * 0.8, s * 0.8, s * 0.6, 0, s);
  g.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.95, -s * 0.8, 0, -s);
  g.fill();
}

function leaf(g, s) {
  g.beginPath();
  g.moveTo(0, -s);
  g.quadraticCurveTo(s * 0.85, -s * 0.15, 0, s);
  g.quadraticCurveTo(-s * 0.85, -s * 0.15, 0, -s);
  g.fill();
  g.strokeStyle = 'rgb(70 35 10 / 0.45)'; // 잎맥
  g.beginPath();
  g.moveTo(0, -s * 0.75);
  g.lineTo(0, s * 1.2);
  g.stroke();
}

function sparkle(g, s) {
  g.beginPath();
  g.moveTo(0, -s);
  g.quadraticCurveTo(0, 0, s, 0);
  g.quadraticCurveTo(0, 0, 0, s);
  g.quadraticCurveTo(0, 0, -s, 0);
  g.quadraticCurveTo(0, 0, 0, -s);
  g.fill();
}

function heart(g, s) {
  g.beginPath();
  g.moveTo(0, s * 0.4);
  g.bezierCurveTo(-s * 1.15, -s * 0.3, -s * 0.5, -s * 1.1, 0, -s * 0.45);
  g.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.15, -s * 0.3, 0, s * 0.4);
  g.fill();
}

// spawn(p, w, h, fresh): 새로 놓기 (fresh면 화면 아무 데나, 아니면 들어오는 쪽 바깥에서)
// move(p, dt, w, h, sp, t): sp = 속도 배수(박자 반응). 화면을 벗어나면 다시 놓는다
// paint(g, p, t): 색·투명도는 미리 정해 둠
const KINDS = {
  snow: {
    spawn(p, w, h, fresh) {
      p.x = rand(0, w);
      p.y = fresh ? rand(0, h) : rand(-24, -4);
      p.r = rand(1.1, 3.4);
      p.vy = 16 + p.r * 14 + rand(0, 10);
      p.sway = rand(8, 26);
      p.ph = rand(0, TAU);
      p.a = rand(0.55, 0.95);
    },
    move(p, dt, w, h, sp, t) {
      p.y += p.vy * dt * sp;
      p.x += Math.sin(t * 0.9 + p.ph) * p.sway * dt;
      if (p.y > h + 6) this.spawn(p, w, h, false);
      if (p.x < -8) p.x += w + 16;
      else if (p.x > w + 8) p.x -= w + 16;
    },
    paint(g, p) {
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, TAU);
      g.fill();
    },
  },
  sakura: {
    spawn(p, w, h, fresh) {
      p.x = fresh ? rand(0, w) : rand(-w * 0.3, w * 0.9);
      p.y = fresh ? rand(0, h) : rand(-40, -10);
      p.s = rand(4, 7.5);
      p.vy = rand(26, 52);
      p.vx = rand(12, 34);
      p.rot = rand(0, TAU);
      p.vr = rand(-1.2, 1.2);
      p.flip = rand(0, TAU);
      p.vf = rand(1.5, 3.5);
      p.ph = rand(0, TAU);
      p.a = rand(0.75, 0.95);
    },
    move(p, dt, w, h, sp, t) {
      p.y += p.vy * dt * sp;
      p.x += (p.vx + Math.sin(t * 1.3 + p.ph) * 14) * dt * sp;
      p.rot += p.vr * dt * sp;
      p.flip += p.vf * dt * sp;
      if (p.y > h + 20 || p.x > w + 30) this.spawn(p, w, h, false);
    },
    paint(g, p) {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(0.3 + 0.7 * Math.abs(Math.cos(p.flip)), 1); // 뒤집히며 떨어지는 느낌
      petal(g, p.s);
      g.restore();
    },
  },
  leaves: {
    spawn(p, w, h, fresh) {
      p.x = fresh ? rand(0, w) : rand(-w * 0.1, w * 1.05);
      p.y = fresh ? rand(0, h) : rand(-50, -15);
      p.s = rand(7, 13);
      p.vy = rand(22, 46);
      p.vx = rand(-8, 22);
      p.rot = rand(0, TAU);
      p.vr = rand(-1.6, 1.6);
      p.flip = rand(0, TAU);
      p.vf = rand(1, 2.6);
      p.ph = rand(0, TAU);
      p.a = rand(0.8, 0.95);
    },
    move(p, dt, w, h, sp, t) {
      p.y += p.vy * dt * sp;
      p.x += (p.vx + Math.sin(t * 0.8 + p.ph) * 30) * dt * sp;
      p.rot += p.vr * dt * sp;
      p.flip += p.vf * dt * sp;
      if (p.y > h + 30 || p.x > w + 40 || p.x < -60) this.spawn(p, w, h, false);
    },
    paint(g, p) {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(0.25 + 0.75 * Math.abs(Math.cos(p.flip)), 1);
      leaf(g, p.s);
      g.restore();
    },
  },
  rain: {
    spawn(p, w, h, fresh) {
      p.x = rand(-w * 0.05, w * 1.15);
      p.y = fresh ? rand(-h * 0.2, h) : rand(-h * 0.35, -10);
      p.len = rand(10, 22);
      p.vy = rand(560, 900);
      p.vx = -p.vy * 0.12;
      p.a = rand(0.25, 0.5);
    },
    move(p, dt, w, h, sp) {
      p.y += p.vy * dt * sp;
      p.x += p.vx * dt * sp;
      if (p.y > h + p.len) this.spawn(p, w, h, false);
    },
    paint(g, p) {
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.022, p.y - p.len);
      g.stroke();
    },
  },
  stars: {
    spawn(p, w, h) {
      p.x = rand(0, w);
      p.y = rand(0, h);
      p.s = rand(2.2, 5.5);
      p.tw = rand(0.7, 2.1);
      p.ph = rand(0, TAU);
      p.a = 1;
    },
    move(p, dt, w, h, sp, t) {
      p.ph += (sp - 1) * dt * 2; // 박자에 맞춰 더 빨리 반짝임
      // 거의 꺼졌을 때 가끔 자리를 옮겨서 같은 자리에만 있지 않게
      if (Math.sin(t * p.tw + p.ph) < -0.99 && Math.random() < 0.02) this.spawn(p, w, h);
    },
    paint(g, p, t) {
      const tw = (0.5 + 0.5 * Math.sin(t * p.tw + p.ph)) ** 3;
      g.globalAlpha *= 0.12 + 0.88 * tw;
      g.save();
      g.translate(p.x, p.y);
      sparkle(g, p.s * (0.7 + 0.5 * tw));
      g.restore();
    },
  },
  fireflies: {
    spawn(p, w, h) {
      p.x = rand(0, w);
      p.y = rand(h * 0.15, h);
      p.r = rand(1.8, 3.2);
      p.sp = rand(12, 30);
      p.ang = rand(0, TAU);
      p.pf = rand(1.2, 2.6);
      p.ph = rand(0, TAU);
      p.a = 1;
    },
    move(p, dt, w, h, sp) {
      p.ang += rand(-1.6, 1.6) * dt * 2;
      p.x += Math.cos(p.ang) * p.sp * dt * sp;
      p.y += Math.sin(p.ang) * p.sp * dt * sp;
      if (p.x < -20) p.x += w + 40;
      else if (p.x > w + 20) p.x -= w + 40;
      if (p.y < -20) p.y += h + 40;
      else if (p.y > h + 20) p.y -= h + 40;
    },
    paint(g, p, t) {
      const glow = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * p.pf + p.ph));
      g.globalAlpha *= glow;
      const r = p.r * 5;
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, g.fillStyle);
      grad.addColorStop(1, 'transparent');
      const core = g.fillStyle;
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TAU);
      g.fill();
      g.fillStyle = core;
      g.beginPath();
      g.arc(p.x, p.y, p.r * 0.7, 0, TAU);
      g.fill();
    },
  },
  bubbles: {
    spawn(p, w, h, fresh) {
      p.x = rand(0, w);
      p.y = fresh ? rand(0, h) : h + rand(10, 80);
      p.r = rand(5, 18);
      p.vy = rand(18, 42);
      p.sway = rand(10, 24);
      p.ph = rand(0, TAU);
      p.a = rand(0.55, 0.85);
    },
    move(p, dt, w, h, sp, t) {
      p.y -= p.vy * dt * sp;
      p.x += Math.sin(t * 1.1 + p.ph) * p.sway * dt;
      if (p.y < -p.r * 2) this.spawn(p, w, h, false);
    },
    paint(g, p) {
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, TAU);
      g.stroke();
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.14;
      g.fill();
      g.globalAlpha = a * 0.9;
      g.fillStyle = 'rgb(255 255 255)';
      g.beginPath();
      g.arc(p.x - p.r * 0.35, p.y - p.r * 0.38, p.r * 0.2, 0, TAU);
      g.fill();
    },
  },
  hearts: {
    spawn(p, w, h, fresh) {
      p.x = rand(0, w);
      p.y = fresh ? rand(h * 0.3, h) : h + rand(10, 50);
      p.s = rand(6, 12);
      p.vy = rand(22, 44);
      p.sway = rand(10, 22);
      p.ph = rand(0, TAU);
      p.a = rand(0.6, 0.9);
    },
    move(p, dt, w, h, sp, t) {
      p.y -= p.vy * dt * sp;
      p.x += Math.sin(t * 1.2 + p.ph) * p.sway * dt;
      if (p.y < -20) this.spawn(p, w, h, false);
    },
    paint(g, p, t, h) {
      g.globalAlpha *= Math.min(1, Math.max(0, p.y / (h * 0.3))); // 위로 갈수록 흐려짐
      g.save();
      g.translate(p.x, p.y);
      g.rotate(Math.sin(p.ph + p.y * 0.01) * 0.25);
      heart(g, p.s);
      g.restore();
    },
  },
};

export class Effects {
  constructor(canvas, viz, isNpOpen) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.viz = viz;
    this.isNpOpen = isNpOpen;
    this.opts = { effect: 'off', amount: 50, scope: 'np', color: 'natural', react: true, coverBeat: 'off', accent: [29, 111, 230], period: rainbowPeriod(), dark: false };
    this.parts = [];
    this.raf = 0;
    this.last = 0;
    this.w = 0;
    this.h = 0;
    this.shoot = null; // 별똥별
    this.nextShoot = 0;
    this.beat = new BeatFollower();
    this.art = null;
    this.glow = null;
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.wake());
    for (const e of ['play', 'pause', 'ended']) viz.audio.addEventListener(e, () => this.wake());
  }

  setCover(art, glow) {
    this.art = art;
    this.glow = glow;
  }

  configure(o) {
    const prev = this.opts;
    this.opts = { ...prev, ...o };
    const rebuild = prev.effect !== this.opts.effect || prev.dark !== this.opts.dark || prev.color !== this.opts.color;
    if (rebuild) this.parts = [];
    this.resize();
    this.wake();
  }

  get listening() {
    const o = this.opts;
    return (o.effect !== 'off' && o.react) || o.coverBeat !== 'off';
  }

  showing() {
    return this.opts.effect !== 'off' && (this.opts.scope === 'all' || this.isNpOpen());
  }

  beating() {
    return this.opts.coverBeat !== 'off' && this.isNpOpen() && this.viz.playing;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = innerWidth;
    this.h = innerHeight;
    if (this.canvas.width !== Math.round(this.w * dpr) || this.canvas.height !== Math.round(this.h * dpr)) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const kind = KINDS[this.opts.effect];
    const want = kind ? effectCount(this.opts.effect, this.w, this.h, this.opts.amount) : 0;
    while (this.parts.length > want) this.parts.pop();
    while (this.parts.length < want) this.parts.push(this.make(kind, true));
  }

  make(kind, fresh) {
    const p = { hue: Math.random() * 360 };
    kind.spawn(p, this.w, this.h, fresh);
    const rgb = NATURAL[this.opts.effect](this.opts.dark);
    p.css = `rgb(${rgb.join(' ')})`;
    return p;
  }

  wake() {
    const on = !document.hidden && this.showing();
    this.canvas.classList.toggle('on', on);
    if (!this.beating()) this.resetCover();
    if (!this.raf && !document.hidden && (on || this.beating())) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const showing = this.showing();
    const beating = this.beating();
    const e = this.beat.step(this.listening && this.viz.playing ? this.viz.bass() : 0, dt);
    if (showing) this.drawParticles(dt, now / 1000, this.opts.react ? e : 0);
    if (beating) this.applyBeat(e);
    else this.resetCover();
    if (!document.hidden && (showing || beating)) this.raf = requestAnimationFrame((t) => this.frame(t));
    else this.last = 0;
  }

  drawParticles(dt, t, e) {
    const { g, w, h } = this;
    const o = this.opts;
    const kind = KINDS[o.effect];
    g.clearRect(0, 0, w, h);
    const sp = 1 + e * 1.5;
    const boost = 1 + e * 0.6;
    const hueNow = cycleHue(t * 1000, o.period);
    const accent = `rgb(${o.accent.join(' ')})`;
    g.globalCompositeOperation = o.dark && (o.effect === 'fireflies' || o.effect === 'stars') ? 'lighter' : 'source-over';
    g.lineWidth = 1.2;
    for (const p of this.parts) {
      kind.move(p, dt, w, h, sp, t);
      const css = o.color === 'rainbow' ? `hsl(${Math.round(p.hue + hueNow) % 360} 85% ${o.dark ? 70 : 56}%)` : o.color === 'accent' ? accent : p.css;
      g.globalAlpha = Math.min(1, p.a * boost);
      g.fillStyle = css;
      g.strokeStyle = css;
      kind.paint(g, p, t, h);
    }
    if (o.effect === 'stars') this.shootingStar(dt, t, o.dark);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // 별 효과: 가끔 별똥별이 지나간다
  shootingStar(dt, t, dark) {
    const { g, w, h } = this;
    if (!this.shoot && t > this.nextShoot) {
      this.shoot = { x: rand(w * 0.2, w), y: rand(0, h * 0.35), vx: -rand(500, 800), vy: rand(180, 300), life: 0 };
      this.nextShoot = t + rand(6, 14);
    }
    const s = this.shoot;
    if (!s) return;
    s.life += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const k = 0.12;
    const grad = g.createLinearGradient(s.x, s.y, s.x - s.vx * k, s.y - s.vy * k);
    grad.addColorStop(0, dark ? 'rgb(255 255 255 / 0.9)' : 'rgb(222 172 48 / 0.9)');
    grad.addColorStop(1, 'transparent');
    g.globalAlpha = Math.max(0, 1 - s.life / 1.2);
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.lineTo(s.x - s.vx * k, s.y - s.vy * k);
    g.stroke();
    if (s.life > 1.2 || s.x < -100 || s.y > h + 100) this.shoot = null;
  }

  // 박자에 맞춰 커버가 살짝 커지고(pulse), 뒤에서 빛이 번진다(glow)
  applyBeat(e) {
    const b = this.opts.coverBeat;
    if (this.art && (b === 'pulse' || b === 'both')) this.art.style.scale = String(1 + 0.05 * e);
    if (this.glow && (b === 'glow' || b === 'both')) this.glow.style.opacity = String(Math.min(1, e * 1.25));
  }

  resetCover() {
    if (this.art?.style.scale) this.art.style.scale = '';
    if (this.glow?.style.opacity) this.glow.style.opacity = '';
  }
}
