// 소리: 이퀄라이저 · 크로스페이드 · 페이드 · 음량 평준화 · 무음 건너뛰기 · 재생 속도 · 출력 장치·음질 정보
// 재생 화면의 '사운드' 탭에 그린다. 바꾸면 바로 들리고, 잠깐 뒤에 서버에 저장한다.
import { put } from '../api.js';
import { EQ_FREQS, EQ_PRESETS } from '../audio.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { debounce, esc } from '../util.js';
import { dialog, toast } from './dom.js';

let panel = null;
let analyzer = null;
const pending = {};
const flush = debounce(async () => {
  const patch = { ...pending };
  for (const k of Object.keys(pending)) delete pending[k];
  try {
    store.settings = await put('/api/settings', { audio: patch });
  } catch (e) {
    toast(e.message, 4000);
  }
}, 500);

export const audioSettings = () => store.settings.audio || {};

export function setAudio(patch, { save = true, render = false } = {}) {
  store.settings.audio = { ...audioSettings(), ...patch };
  ctx.player.applyAudioSettings(store.settings.audio);
  if (save) {
    Object.assign(pending, patch);
    flush();
  }
  maybeAnalyze();
  if (render) renderSound();
}

// 음량 평준화·무음 건너뛰기를 켜면 아직 안 잰 곡을 쉬는 틈에 잰다
export function maybeAnalyze() {
  const a = audioSettings();
  if (analyzer && (a.normalize !== 'off' || a.skipSilence)) analyzer.start();
}

export function initSound(el, an) {
  panel = el;
  analyzer = an;
  bind(el);
  an.addEventListener('progress', updateProgress);
  ctx.player.addEventListener('device', () => panel && !panel.hidden && renderSound());
}

const fmtFreq = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));
const fmtDb = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(Math.abs(v) % 1 ? 1 : 0)}`;

const chip = (attr, v, label, on, pre = '') => `<button class="chip${on ? ' on' : ''}" ${attr}="${v}" aria-pressed="${on}">${pre}<span>${label}</span></button>`;
const sw = (k, label, on, sub = '') =>
  `<div class="dz-switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><label class="switch"><input type="checkbox" data-a="${k}" ${on ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`;
const range = (k, label, v, min, max, step, text) =>
  `<label class="dz-range"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-a="${k}" value="${v}" style="--p:${((v - min) / (max - min)) * 100}%"><output>${text(v)}</output></label>`;

const TEXT = {
  crossfade: (v) => (Number(v) ? `${v}초` : '끄기'),
  fadeMs: (v) => (Number(v) ? `${(v / 1000).toFixed(v % 1000 ? 2 : 1)}초` : '끄기'),
  normTarget: (v) => `${v} LUFS`,
  rate: (v) => `${Number(v).toFixed(2)}배`,
};

export function renderSound() {
  if (!panel) return;
  const a = audioSettings();
  const bands = Array.isArray(a.eqBands) && a.eqBands.length === 10 ? a.eqBands : EQ_FREQS.map(() => 0);
  const dev = ctx.player.device;
  panel.innerHTML = `<div class="design sound">
<section class="dz${a.eqOn ? '' : ' off'}">
  <div class="dz-head"><div class="label"><b>이퀄라이저</b><small>10밴드 · 프리셋을 고르거나 막대를 직접 움직여요</small></div>
    <label class="switch"><input type="checkbox" data-a="eqOn" ${a.eqOn ? 'checked' : ''} aria-label="이퀄라이저"><span></span></label></div>
  <div class="dz-body">
    <div class="chips">${Object.entries(EQ_PRESETS).map(([k, p]) => chip('data-preset', k, p.name, a.eqPreset === k)).join('')}${a.eqPreset === 'custom' ? chip('data-preset', 'custom', '사용자', true) : ''}</div>
    <div class="eq-bands">
      <div class="eq-band pre"><output>${fmtDb(a.eqPre || 0)}</output><input type="range" class="vrange" min="-12" max="12" step="0.5" data-band="pre" value="${a.eqPre || 0}" aria-label="프리앰프"><span>프리앰프</span></div>
      ${EQ_FREQS.map((f, i) => `<div class="eq-band"><output>${fmtDb(bands[i])}</output><input type="range" class="vrange" min="-12" max="12" step="0.5" data-band="${i}" value="${bands[i]}" aria-label="${fmtFreq(f)}Hz"><span>${fmtFreq(f)}</span></div>`).join('')}
    </div>
  </div>
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>곡 사이 넘어가기</b><small>크로스페이드: 앞 곡이 작아지면서 다음 곡이 커져요</small></div></div>
  ${range('crossfade', '크로스페이드', a.crossfade || 0, 0, 12, 1, TEXT.crossfade)}
  ${range('fadeMs', '재생·멈춤 페이드', a.fadeMs || 0, 0, 2000, 50, TEXT.fadeMs)}
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>음량 평준화</b><small>곡마다 소리 크기가 달라도 비슷하게 들리게 (ReplayGain 태그 → 없으면 직접 잼)</small></div></div>
  <div class="chips">${[
    ['off', '끄기'],
    ['track', '곡마다'],
    ['album', '앨범마다'],
  ]
    .map(([v, l]) => chip('data-norm', v, l, (a.normalize || 'off') === v))
    .join('')}</div>
  ${a.normalize && a.normalize !== 'off' ? range('normTarget', '목표 세기', a.normTarget ?? -14, -23, -8, 1, TEXT.normTarget) : ''}
  ${sw('skipSilence', '무음 건너뛰기', a.skipSilence, '곡 앞뒤의 무음과 가운데 2.5초 넘는 무음을 건너뛰어요 (잰 곡만)')}
  <p class="dz-note" id="analyze-status">${progressText()}</p>
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>재생 속도</b><small>${a.keepPitch !== false ? '음 높이는 그대로' : '빠르면 음도 높아져요'}</small></div></div>
  <div class="chips">${[0.75, 1, 1.25, 1.5, 2].map((r) => chip('data-rate', r, `${r}배`, Math.abs((a.rate || 1) - r) < 0.001)).join('')}</div>
  ${range('rate', '속도', a.rate || 1, 0.5, 2, 0.05, TEXT.rate)}
  ${sw('keepPitch', '음 높이 유지', a.keepPitch !== false)}
</section>
<section class="dz">
  <div class="dz-head"><div class="label"><b>출력</b><small>${dev ? `${esc(dev.name)}${dev.desc ? ` (${esc(dev.desc)})` : ''}${dev.format ? ` · ${fmtFormat(dev.format)}` : ''}` : '출력 장치 정보를 읽는 중이에요'}</small></div>
    <button class="btn small" data-act="quality">${icon('info')}음질 정보</button></div>
  ${sw('deviceVolume', '출력 장치마다 음량 기억', a.deviceVolume !== false, '스피커·헤드폰을 바꾸면 그 장치에서 쓰던 음량으로')}
</section>
<div class="dz-foot"><button class="btn small" data-act="sound-reset">${icon('history')}소리 설정 기본값으로</button></div>
</div>`;
}

function progressText() {
  const a = audioSettings();
  if (!analyzer) return '';
  const p = analyzer.progress;
  const used = a.normalize !== 'off' || a.skipSilence;
  if (p.running) return `곡 소리 재는 중… ${p.done}/${p.total}`;
  if (!used) return '켜면 아직 안 잰 곡의 소리 세기·무음을 쉬는 틈에 재요';
  return p.left ? `아직 안 잰 곡 ${p.left}곡` : '모든 곡을 쟀어요';
}

function updateProgress() {
  const el = panel?.querySelector('#analyze-status');
  if (el) el.textContent = progressText();
}

export const fmtFormat = (f) => [f.rate ? `${(f.rate / 1000).toFixed(f.rate % 1000 ? 1 : 0)}kHz` : '', f.bits ? `${f.bits}비트${f.float ? ' 실수' : ''}` : '', f.channels ? (f.channels === 2 ? '스테레오' : f.channels === 1 ? '모노' : `${f.channels}채널`) : ''].filter(Boolean).join(' · ');

// 곡 형식을 짧게: "FLAC 24bit/96kHz" · "MP3 320kbps"
export function qualityBadge(t) {
  if (!t) return '';
  const codec = String(t.codec || '').replace(/^MPEG 1 Layer 3$/i, 'MP3').replace(/^MPEG-4\/AAC$/i, 'AAC').replace(/\s+.*$/, '').toUpperCase();
  const name = codec || (t.path?.split('.').pop() || '').toUpperCase();
  if (t.lossless) return `${name} ${t.x?.bits || 16}bit/${t.sampleRate ? (t.sampleRate / 1000).toFixed(t.sampleRate % 1000 ? 1 : 0) : '?'}kHz`;
  return t.bitrate ? `${name} ${Math.round(t.bitrate / 1000)}kbps` : name;
}

// 음질 정보: 파일 → 처리(평준화·EQ·속도) → 출력 장치
export function qualityDialog() {
  const p = ctx.player;
  const t = p.track;
  const a = audioSettings();
  const dev = p.device;
  const eng = p.engine;
  const row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const gain = t ? p.gainFor(t) : 0;
  dialog({
    title: '음질 정보',
    html: `<div class="kv-list">
${t ? row('파일', esc(t.path.split(/[\\/]/).pop())) : ''}
${t ? row('형식', `${esc(t.codec || '?')}${t.lossless ? ' (무손실)' : ''}`) : ''}
${t?.sampleRate ? row('표본율', `${(t.sampleRate / 1000).toFixed(1)}kHz${t.x?.bits ? ` · ${t.x.bits}비트` : ''}${t.x?.channels ? ` · ${t.x.channels}채널` : ''}`) : ''}
${t?.bitrate ? row('비트레이트', `${Math.round(t.bitrate / 1000)}kbps`) : ''}
${t?.loud?.lufs != null ? row('곡 세기', `${t.loud.lufs} LUFS · 피크 ${(20 * Math.log10(t.loud.peak || 1e-9)).toFixed(1)}dBFS`) : ''}
${t?.rg ? row('ReplayGain', `${t.rg.track ?? '-'} dB (곡) · ${t.rg.album ?? '-'} dB (앨범)`) : ''}
${row('처리', eng.ready ? `Web Audio ${eng.ac.sampleRate / 1000}kHz · ${a.eqOn ? 'EQ 켜짐' : 'EQ 꺼짐'} · 곡 음량 ${fmtDb(Math.round(gain * 10) / 10)}dB${(a.rate || 1) !== 1 ? ` · ${a.rate}배속` : ''}` : '아직 처리 전 (재생하면 연결돼요)')}
${row('출력 장치', dev ? esc(`${dev.name}${dev.desc ? ` (${dev.desc})` : ''}`) : '알 수 없음')}
${dev?.format ? row('장치 형식', fmtFormat(dev.format)) : ''}
</div>`,
    actions: [{ label: '닫기', value: null }],
  });
}

function bind(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset],[data-norm],[data-rate],[data-act]');
    if (!b) return;
    if (b.dataset.preset) {
      const p = EQ_PRESETS[b.dataset.preset];
      if (p) setAudio({ eqOn: true, eqPreset: b.dataset.preset, eqBands: p.bands.slice() }, { render: true });
    } else if (b.dataset.norm) setAudio({ normalize: b.dataset.norm }, { render: true });
    else if (b.dataset.rate) setAudio({ rate: Number(b.dataset.rate) }, { render: true });
    else if (b.dataset.act === 'quality') qualityDialog();
    else if (b.dataset.act === 'sound-reset') {
      store.settings.audio = {};
      put('/api/settings', { audio: null })
        .then((s) => {
          store.settings = s;
          ctx.player.applyAudioSettings(s.audio);
          renderSound();
          toast('소리 설정을 기본값으로 돌렸어요');
        })
        .catch((err) => toast(err.message));
    }
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.band !== undefined) {
      const a = audioSettings();
      const v = Number(t.value);
      t.parentElement.querySelector('output').textContent = fmtDb(v);
      if (t.dataset.band === 'pre') setAudio({ eqPre: v });
      else {
        const bands = (Array.isArray(a.eqBands) && a.eqBands.length === 10 ? a.eqBands : EQ_FREQS.map(() => 0)).slice();
        bands[Number(t.dataset.band)] = v;
        setAudio({ eqBands: bands, eqPreset: 'custom', eqOn: true });
        el.querySelector('.chip.on[data-preset]')?.classList.remove('on');
      }
      return;
    }
    const k = t.dataset.a;
    if (t.type === 'range' && k) {
      const v = Number(t.value);
      t.style.setProperty('--p', `${((v - Number(t.min)) / (Number(t.max) - Number(t.min))) * 100}%`);
      t.parentElement.querySelector('output').textContent = TEXT[k] ? TEXT[k](v) : v;
      setAudio({ [k]: v });
    }
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'checkbox' && t.dataset.a) setAudio({ [t.dataset.a]: t.checked }, { render: true });
    else if (t.type === 'range' && t.dataset.a === 'rate') renderSound();
  });
}
