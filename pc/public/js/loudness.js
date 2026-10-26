// 곡의 소리 세기(LUFS, ITU-R BS.1770 · EBU R128)·피크·무음 구간 재기.
// 화면에 의존하지 않아서 분석 워커와 테스트에서 같이 쓴다.
export const ANALYSIS_VERSION = 1;

// K-가중 필터 계수 (고역 선반 + 저역 차단, 아무 표본율에서나: libebur128과 같은 식)
export function kWeighting(fs) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

const SILENT_MS = 10 ** (-60 / 10); // -60 dBFS 아래는 무음 (조용한 도입부는 남도록 충분히 낮게)
const r2 = (v) => Math.round(v * 100) / 100;

// channels: 채널마다 Float32Array, fs: 표본율. 돌려주는 값:
//   lufs: 통합 세기 (너무 조용해서 못 재면 null) · peak: 표본 최대값 0~1
//   start·end: 앞뒤 무음을 뺀 소리 구간(초) · gaps: 가운데 2.5초 넘는 무음 [[시작, 끝], …]
export function analyze(channels, fs) {
  const n = channels[0]?.length || 0;
  const sub = Math.max(1, Math.round(fs * 0.1)); // 100ms 단위로 모은다
  const nSub = Math.ceil(n / sub);
  const kSum = new Float64Array(nSub); // K-가중 제곱합 (채널 합)
  const rawMs = new Float64Array(nSub); // 가중 없는 평균 제곱 (가장 큰 채널) — 무음 판단용
  let peak = 0;
  const [s1, s2] = kWeighting(fs);
  for (const x of channels) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let z1 = 0;
    let z2 = 0;
    for (let b = 0; b < nSub; b++) {
      const from = b * sub;
      const to = Math.min(n, from + sub);
      let ks = 0;
      let rs = 0;
      for (let i = from; i < to; i++) {
        const v = x[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        rs += v * v;
        const y = s1.b0 * v + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
        const z = s2.b0 * y + s2.b1 * y1 + s2.b2 * y2 - s2.a1 * z1 - s2.a2 * z2;
        x2 = x1;
        x1 = v;
        y2 = y1;
        y1 = y;
        z2 = z1;
        z1 = z;
        ks += z * z;
      }
      kSum[b] += ks;
      const ms = rs / Math.max(1, to - from);
      if (ms > rawMs[b]) rawMs[b] = ms;
    }
  }
  if (channels.length === 1) for (let b = 0; b < nSub; b++) kSum[b] *= 2; // 모노는 양쪽 스피커로 나오니 두 채널처럼

  // 통합 세기: 400ms 블록(100ms씩 밀며 75% 겹침) → 절대 게이트 -70 LUFS → 상대 게이트 -10 LU
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const blocks = [];
  for (let b = 0; b + 4 <= nSub; b++) {
    const len = Math.min(n, (b + 4) * sub) - b * sub;
    const z = (kSum[b] + kSum[b + 1] + kSum[b + 2] + kSum[b + 3]) / len;
    if (z > 0 && lk(z) > -70) blocks.push(z);
  }
  let lufs = null;
  if (blocks.length) {
    const rel = lk(blocks.reduce((s, z) => s + z, 0) / blocks.length) - 10;
    const gated = blocks.filter((z) => lk(z) > rel);
    if (gated.length) lufs = r2(lk(gated.reduce((s, z) => s + z, 0) / gated.length));
  }

  // 무음: 앞·뒤(0.3초 넘으면), 가운데(2.5초 넘으면)
  const dur = n / fs;
  const silent = (b) => rawMs[b] < SILENT_MS;
  let s = 0;
  while (s < nSub && silent(s)) s++;
  let e = nSub;
  while (e > s && silent(e - 1)) e--;
  const gaps = [];
  if (s >= nSub) return { v: ANALYSIS_VERSION, lufs, peak: Math.round(peak * 10000) / 10000, start: 0, end: r2(dur), gaps };
  for (let b = s; b < e; ) {
    if (!silent(b)) {
      b++;
      continue;
    }
    let k = b;
    while (k < e && silent(k)) k++;
    if (k - b >= 25) gaps.push([r2(b * 0.1 + 0.2), r2(k * 0.1 - 0.2)]);
    b = k;
  }
  return {
    v: ANALYSIS_VERSION,
    lufs,
    peak: Math.round(peak * 10000) / 10000,
    start: s > 3 ? r2(Math.max(0, s * 0.1 - 0.1)) : 0,
    end: nSub - e > 3 ? r2(Math.min(dur, e * 0.1 + 0.1)) : r2(dur),
    gaps,
  };
}
