// 오디오 스펙트럼 계산: FFT 칸(bin) → 막대 높이 0~1 (화면에 의존하지 않아서 테스트에서도 쓴다)

// 막대마다 맡을 주파수 칸. 낮은음이 몇 칸에 몰리지 않게 로그 간격을 살짝 펴서(knee) 나눈다.
export function bandEdges(count, { sampleRate = 48000, fftSize = 4096, minHz = 45, maxHz = 16000, knee = 150 } = {}) {
  const hzPerBin = sampleRate / fftSize;
  const bins = fftSize / 2;
  const top = Math.min(maxHz, (sampleRate / 2) * 0.96);
  const span = Math.log((top + knee) / (minHz + knee));
  const edgeHz = (i) => (minHz + knee) * Math.exp((span * i) / count) - knee;
  const out = [];
  let start = Math.max(1, Math.round(minHz / hzPerBin));
  for (let i = 0; i < count; i++) {
    const end = Math.min(bins, Math.max(start + 1, Math.round(edgeHz(i + 1) / hzPerBin)));
    out.push({ start, end, hz: Math.sqrt(Math.max(1, start) * end) * hzPerBin });
    start = Math.min(end, bins - 1);
  }
  return out;
}

// 음량을 줄이면 분석기에 들어오는 소리도 작아지므로 그만큼 되돌려서, 음량과 상관없이 같은 높이로 보이게
export const volumeGainDb = (volume) => (volume > 0 ? Math.min(32, -20 * Math.log10(volume)) : 0);

// dB 스펙트럼 → 막대 높이. 높은음은 원래 에너지가 작아서 옥타브마다 tilt dB씩 올려 준다
export function bandLevels(db, bands, out, { gainDb = 0, floorDb = -84, rangeDb = 60, tilt = 3 } = {}) {
  for (let i = 0; i < bands.length; i++) {
    const { start, end, hz } = bands[i];
    let m = -Infinity;
    for (let k = start; k < end; k++) if (db[k] > m) m = db[k];
    const v = (m + gainDb + tilt * Math.log2(hz / 1000) - floorDb) / rangeDb;
    out[i] = v > 0 ? (v < 1 ? v ** 1.3 : 1) : 0;
  }
  return out;
}

// 올라갈 때는 바로, 내려갈 때는 1초에 fall만큼 천천히 (막대가 떨리지 않게)
export function fallLevels(shown, target, dt, fall = 1.6) {
  let any = false;
  for (let i = 0; i < shown.length; i++) {
    const t = target[i] || 0;
    shown[i] = t >= shown[i] ? t : Math.max(t, shown[i] - fall * dt);
    if (shown[i] > 0.002) any = true;
  }
  return any;
}

// 낮은음(쿵쿵 하는 박자 쪽, 40~160Hz) 세기 0~1. 화면 효과와 커버 박자 반응에 쓴다
export function bassLevel(db, { sampleRate = 48000, fftSize = 4096, gainDb = 0, loHz = 40, hiHz = 160 } = {}) {
  const hzPerBin = sampleRate / fftSize;
  let power = 0;
  let n = 0;
  for (let k = Math.max(1, Math.floor(loHz / hzPerBin)); k <= Math.ceil(hiHz / hzPerBin); k++) {
    if (Number.isFinite(db[k])) power += 10 ** ((db[k] + gainDb) / 10);
    n++;
  }
  if (!power) return 0;
  const avgDb = 10 * Math.log10(power / n);
  return Math.max(0, Math.min(1, (avgDb + 70) / 45));
}

// 박자 따라가기: 평소(최근 평균)보다 갑자기 커질 때 크게 튀고, 천천히 가라앉는다
export class BeatFollower {
  constructor() {
    this.avg = 0;
    this.value = 0;
  }

  step(level, dt) {
    this.avg += (level - this.avg) * Math.min(1, dt * 1.5);
    const target = Math.min(1, level * 0.35 + Math.max(0, level - this.avg) * 2.5);
    this.value = target > this.value ? target : Math.max(target, this.value - dt * 2.2);
    return this.value;
  }
}

// 재생 전 미리보기용 가짜 스펙트럼 (디자인 설정에서 모양·색을 바로 볼 수 있게)
export function demoLevels(out, t) {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const x = i / Math.max(1, n - 1);
    const wave = 0.5 + 0.5 * Math.sin(t * 2.2 - x * 7.5);
    const pulse = 0.75 + 0.25 * Math.sin(t * 5.1 + i * 1.7);
    out[i] = Math.min(1, (0.18 + 0.62 * wave * (1 - x * 0.5)) * pulse);
  }
  return out;
}
