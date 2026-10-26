// 미니 플레이어 · 전체 재생 화면 · 재생 순서 · 가사 · 사운드 · 디자인 · 수면 타이머 · 폰 이어듣기
import { coverUrl, post } from '../api.js';
import { Analyzer } from '../analyzer.js';
import { Effects } from '../effects.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { $, $$, dominantColor, esc, fmtClock, fmtTime } from '../util.js';
import { Visualizer } from '../visualizer.js';
import { addToPlaylistDialog, coverImg, EQ, markPlaying, toggleFavorite, trackMenu } from './common.js';
import { applyDesign, designTrackChanged, initDesign, renderDesign, setAlbumColor, setCoverImage, updateBgClock } from './design.js';
import { dialog, openMenu, sortable, toast } from './dom.js';
import { highlightLyric, initLyrics, loadLyrics, resetLyrics } from './lyrics.js';
import { openPip } from './pip.js';
import { initSound, maybeAnalyze, qualityBadge, qualityDialog, renderSound, setAudio } from './sound.js';

let player;
let viz;
let fx;
export let analyzer;
let panel = readPref('np.panel', 'queue');
let seeking = false;
let tintFor;
let lastTrackId;
let phoneDismissedAt = 0;

const PANELS = ['queue', 'lyrics', 'sound', 'design'];
const REPEAT_LABEL = { off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' };
const REPEAT_ICON = { off: 'repeatOff', all: 'repeat', one: 'repeatOne' };
const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function readPref(k, d) {
  try {
    return localStorage.getItem(`sm.${k}`) || d;
  } catch {
    return d;
  }
}

export function initNowPlaying(p) {
  player = p;
  $('#mini').innerHTML = `<div class="mini-card">
  <canvas class="viz viz-mini" id="viz-mini" aria-hidden="true"></canvas>
  <div class="mini-progress"><i></i></div>
  <div class="mini-left" data-act="open-np" title="재생 화면 열기">
    <div class="thumb" id="mini-thumb"></div>
    <div class="meta"><div class="title" id="mini-title"></div><div class="sub" id="mini-sub"></div></div>
  </div>
  <div class="mini-center">
    <button class="icon-btn prev" data-act="prev" aria-label="이전 곡">${icon('prev')}</button>
    <button class="icon-btn big" data-act="toggle" id="mini-play" aria-label="재생">${icon('play')}</button>
    <button class="icon-btn" data-act="next" aria-label="다음 곡">${icon('next')}</button>
  </div>
  <div class="mini-right">
    <button class="icon-btn mini-shuffle" data-act="shuffle"></button>
    <button class="icon-btn mini-repeat" data-act="repeat"></button>
    <button class="icon-btn mini-queue" data-act="open-queue" aria-label="재생 순서" title="재생 순서">${icon('queue')}</button>
    <button class="icon-btn mini-pip" data-act="pip" aria-label="작은 창 (항상 위)" title="작은 창 (항상 위)">${icon('pip')}</button>
    <div class="vol mini-volume"><button class="icon-btn" data-act="mute" aria-label="음소거"></button><input type="range" id="mini-vol" min="0" max="1" step="0.01" aria-label="음량"></div>
  </div>
</div>`;

  $('#np').innerHTML = `<div class="np-blur"></div>
<div class="np-bg"></div>
<canvas class="viz viz-bottom" id="viz-bottom" aria-hidden="true"></canvas>
<div class="np-top">
  <button class="icon-btn" data-act="close-np" aria-label="닫기" title="닫기 (Esc)">${icon('down')}</button>
  <div class="np-source" id="np-source"></div>
  <button class="icon-btn" data-act="np-more" aria-label="더 보기">${icon('more')}</button>
</div>
<div class="np-body">
  <div class="np-main">
    <div class="np-stage"><div class="np-glow"></div><canvas class="viz viz-ring" id="viz-ring" aria-hidden="true"></canvas><div class="cover np-art" id="np-art"></div></div>
    <canvas class="viz viz-strip" id="viz-strip" aria-hidden="true"></canvas>
    <div class="np-titlebar">
      <div class="np-titles"><h2 id="np-title"></h2><a id="np-artist" href="#"></a><button class="quality-badge" id="np-quality" data-act="quality" hidden></button></div>
      <button class="icon-btn heart" data-act="fav" id="np-fav" aria-label="즐겨찾기">${icon('heart')}</button>
      <button class="icon-btn" data-act="np-add" aria-label="재생목록에 추가" title="재생목록에 추가">${icon('plus')}</button>
    </div>
    <div class="np-seek">
      <div class="seek-wrap"><input type="range" id="np-range" min="0" max="1000" step="1" value="0" aria-label="재생 위치"><div class="seek-marks" id="np-marks"></div></div>
      <div class="np-times"><span id="np-cur">0:00</span><span id="np-dur">0:00</span></div>
    </div>
    <div class="np-controls">
      <button class="icon-btn" data-act="shuffle"></button>
      <button class="icon-btn" data-act="prev" aria-label="이전 곡">${icon('prev')}</button>
      <button class="icon-btn big" data-act="toggle" id="np-play" aria-label="재생">${icon('play')}</button>
      <button class="icon-btn" data-act="next" aria-label="다음 곡">${icon('next')}</button>
      <button class="icon-btn" data-act="repeat"></button>
    </div>
    <div class="np-extra">
      <button class="icon-btn panel-toggle" data-act="panel-lyrics" aria-label="가사" title="가사">${icon('lyrics')}</button>
      <div class="vol"><button class="icon-btn" data-act="mute" aria-label="음소거"></button><input type="range" id="np-vol" min="0" max="1" step="0.01" aria-label="음량"></div>
      <button class="text-btn x-opt" data-act="speed" id="np-speed" title="재생 속도">1.0×</button>
      <button class="icon-btn x-opt" data-act="ab" id="np-ab" aria-label="A-B 구간 반복" title="A-B 구간 반복: 시작(A) → 끝(B) → 끄기">${icon('ab')}</button>
      <button class="icon-btn x-opt" data-act="sleep" id="np-sleep" aria-label="수면 타이머" title="수면 타이머">${icon('moon')}</button>
      <button class="icon-btn x-opt" data-act="panel-sound" aria-label="사운드" title="사운드 (이퀄라이저·크로스페이드)">${icon('eq')}</button>
      <button class="icon-btn x-opt" data-act="panel-design" aria-label="디자인 꾸미기" title="디자인 꾸미기">${icon('palette')}</button>
      <button class="icon-btn panel-toggle" data-act="panel-queue" aria-label="재생 순서" title="재생 순서">${icon('queue')}</button>
    </div>
  </div>
  <aside class="np-side">
    <div class="np-side-head">
      <div class="seg" id="np-tabs"><button data-panel="queue">재생 순서</button><button data-panel="lyrics">가사</button><button data-panel="sound">사운드</button><button data-panel="design">디자인</button></div>
      <button class="icon-btn panel-close" data-act="panel-close" aria-label="닫기">${icon('close')}</button>
    </div>
    <div class="np-side-sub" id="np-side-sub"></div>
    <div class="np-panel" id="np-queue"></div>
    <div class="np-panel lyrics-panel" id="np-lyrics" hidden></div>
    <div class="np-panel" id="np-sound" hidden></div>
    <div class="np-panel" id="np-design" hidden></div>
  </aside>
</div>`;

  $('#mini').addEventListener('click', onClick);
  $('#np').addEventListener('click', onClick);
  $('#np-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-panel]');
    if (b) showPanel(b.dataset.panel);
  });
  $('#np-queue').addEventListener('click', (e) => {
    if (e.target.closest('[data-act], .drag')) return;
    const row = e.target.closest('.row');
    if (row) player.jumpTo(Number(row.dataset.qi));
  });
  $('#np-queue').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    const t = row && store.tracks.get(row.dataset.id);
    if (!t) return;
    e.preventDefault();
    openMenu(
      [
        ...trackMenu(t).filter((it) => it === '-' || !['다음에 재생', '재생 대기열에 추가'].includes(it.label)),
        '-',
        { icon: 'close', label: '대기열에서 빼기', danger: true, run: () => player.removeFromQueue(Number(row.dataset.key)) },
      ],
      { x: e.clientX, y: e.clientY },
    );
  });
  sortable($('#np-queue'), { onMove: (from, to) => player.moveInQueue(from, to), scroller: () => $('#np-queue') });
  $('#np-artist').addEventListener('click', () => closeNp());
  $('#np-marks').addEventListener('click', (e) => {
    const m = e.target.closest('[data-t]');
    if (m) player.seek(Number(m.dataset.t));
  });

  const range = $('#np-range');
  range.addEventListener('input', () => {
    seeking = true;
    $('#np-cur').textContent = fmtTime((range.value / 1000) * player.duration);
    range.style.setProperty('--p', `${range.value / 10}%`);
  });
  range.addEventListener('change', () => {
    player.seek((range.value / 1000) * player.duration);
    seeking = false;
  });
  for (const v of [$('#mini-vol'), $('#np-vol')]) {
    v.addEventListener('input', () => player.setVolume(Number(v.value)));
    v.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        player.setVolume((player.muted ? 0 : player.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
      },
      { passive: false },
    );
  }

  player.addEventListener('track', onTrack);
  player.addEventListener('state', onState);
  player.addEventListener('time', onTime);
  player.addEventListener('queue', onQueue);
  player.addEventListener('volume', onVolume);
  player.addEventListener('sleep', onSleep);
  player.addEventListener('ab', updateMarks);
  player.addEventListener('audiosettings', onAudioSettings);
  player.addEventListener('playerror', (e) => toast(`재생할 수 없는 파일이에요${e.detail ? `: ${e.detail.title}` : ''}`, 3500));
  store.on('playlists', updateFav);
  store.on('track', (t) => {
    if (t?.id === player.loadedId) {
      updateMarks();
      updateQuality();
    }
  });
  window.addEventListener('popstate', () => {
    if (isNpOpen() && !history.state?.np) closeNp(true);
  });
  matchMedia('(min-width: 1000px)').addEventListener('change', () => refreshPanel());

  viz = new Visualizer(player.engine);
  viz.add($('#viz-strip'), 'strip', isNpOpen);
  viz.add($('#viz-ring'), 'ring', isNpOpen);
  viz.add($('#viz-bottom'), 'bottom', isNpOpen);
  viz.add($('#viz-mini'), 'mini', () => !isNpOpen());
  fx = new Effects($('#fx'), viz, isNpOpen);
  fx.setCover($('#np-art'), $('#np .np-glow'));
  initDesign(viz, $('#np-design'), fx);
  analyzer = new Analyzer();
  initSound($('#np-sound'), analyzer);
  initLyrics($('#np-lyrics'));
  player.applyAudioSettings(store.settings.audio);
  setTimeout(maybeAnalyze, 15_000); // 켜자마자 말고 조금 뒤에

  showPanel(PANELS.includes(panel) ? panel : 'queue', false);
  onTrack();
  onState();
  onVolume();
  onSleep();
  onAudioSettings();
}

// ───── 열기·닫기 ─────

export const isNpOpen = () => $('#np').classList.contains('open');
const isWide = () => matchMedia('(min-width: 1000px)').matches;

// 재생 화면이 다 올라오면 가려진 라이브러리·미니 플레이어는 그리지 않는다 (CPU 아끼기)
let coverTimer = 0;
function setCovered(on) {
  clearTimeout(coverTimer);
  if (on) coverTimer = setTimeout(() => document.body.classList.add('np-covered'), 400);
  else document.body.classList.remove('np-covered');
}

export function openNp(withPanel) {
  const np = $('#np');
  if (!isNpOpen()) {
    np.classList.add('open');
    np.setAttribute('aria-hidden', 'false');
    history.pushState({ np: true }, '');
    setCovered(true);
  }
  if (withPanel) showPanel(withPanel, true);
  else refreshPanel(true);
  updateBgClock(); // 무지개 배경은 재생 화면이 열려 있을 때만 움직인다
  viz.wake(true);
  fx.wake();
}

export function closeNp(fromPopstate = false) {
  if (!isNpOpen()) return;
  const np = $('#np');
  np.classList.remove('open', 'side-open');
  np.setAttribute('aria-hidden', 'true');
  setCovered(false);
  if (!fromPopstate && history.state?.np) history.back();
  updateBgClock();
  viz.setDemo(false);
  viz.wake(true);
  fx.wake();
}

function showPanel(name, open = false) {
  panel = name;
  try {
    localStorage.setItem('sm.np.panel', name);
  } catch {
    // 무시
  }
  for (const b of $$('#np-tabs button')) b.classList.toggle('on', b.dataset.panel === name);
  for (const p of PANELS) $(`#np-${p}`).hidden = name !== p;
  $('#np').classList.toggle('design-open', name === 'design' || name === 'sound');
  if (open && !isWide()) $('#np').classList.add('side-open');
  refreshPanel(true);
}

const panelVisible = (name) => isNpOpen() && panel === name && (isWide() || $('#np').classList.contains('side-open'));

function refreshPanel(scrollToCurrent = false) {
  if (panelVisible('queue')) renderQueue(scrollToCurrent);
  else if (panelVisible('lyrics')) loadLyrics();
  else if (panelVisible('sound')) renderSound();
  else if (panelVisible('design')) renderDesign();
  viz?.setDemo(panelVisible('design')); // 멈춰 있어도 디자인 탭에서는 스펙트럼이 움직여서 바로 보임
  updateSideSub();
}

// ───── 화면 갱신 ─────

function onTrack() {
  const t = player.track;
  const coverId = t ? store.coverIdFor(t) : null;
  $('#mini-thumb').innerHTML = coverImg(coverId);
  $('#mini-title').textContent = t ? t.title : '재생 중인 곡 없음';
  $('#mini-sub').textContent = t ? t.artist : '곡을 고르거나 ▶를 누르면 전체 셔플';
  $('#np-art').innerHTML = coverImg(coverId);
  $('#np-title').textContent = t ? t.title : '재생 중인 곡 없음';
  const a = $('#np-artist');
  a.textContent = t ? t.artist : '';
  a.href = t ? `#/artist/${encodeURIComponent(t.artist)}` : '#';
  document.title = t ? `${t.title} - ${t.artist} · SyncMusic` : 'SyncMusic';
  updateFav();
  updateQuality();
  updateMarks();
  if (t?.id !== lastTrackId) {
    lastTrackId = t?.id;
    designTrackChanged();
  }
  tint(coverId);
  markPlaying(document);
  $('#np-source').textContent = sourceLabel();
  if (panelVisible('lyrics')) loadLyrics();
  else resetLyrics();
}

function updateQuality() {
  const b = $('#np-quality');
  const q = qualityBadge(player.track);
  b.hidden = !q;
  b.textContent = q;
  b.classList.toggle('hi', !!player.track?.lossless);
}

// 진행 막대 위의 표시: A-B 구간, 북마크
function updateMarks() {
  const el = $('#np-marks');
  const d = player.duration || player.track?.duration || 0;
  const ab = player.ab;
  const pct = (s) => `${Math.max(0, Math.min(100, (s / d) * 100))}%`;
  let html = '';
  if (d && ab) {
    html += `<span class="ab-range" style="left:${pct(ab.a)};width:${ab.b === null ? '2px' : `calc(${pct(ab.b)} - ${pct(ab.a)})`}"></span>`;
  }
  if (d) for (const b of player.track?.bookmarks || []) html += `<button class="bm-mark" style="left:${pct(b.t)}" data-t="${b.t}" title="${esc(`${fmtTime(b.t)} ${b.note || ''}`)}"></button>`;
  el.innerHTML = html;
  const btn = $('#np-ab');
  btn.classList.toggle('on', !!ab);
  btn.classList.toggle('half', !!ab && ab.b === null);
  btn.title = !ab ? 'A-B 구간 반복: 누르면 지금이 시작(A)' : ab.b === null ? `A ${fmtTime(ab.a)} · 한 번 더 누르면 끝(B)` : `${fmtTime(ab.a)}~${fmtTime(ab.b)} 반복 중 · 누르면 끄기`;
}

function onAudioSettings() {
  const r = player.opts.rate || 1;
  const b = $('#np-speed');
  b.textContent = `${r.toFixed(r * 10 === Math.round(r * 10) ? 1 : 2)}×`;
  b.classList.toggle('on', Math.abs(r - 1) > 0.001);
  if (panelVisible('sound')) renderSound();
}

function onState() {
  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);
  for (const b of [$('#mini-play'), $('#np-play')]) {
    b.innerHTML = icon(playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? '일시정지' : '재생');
  }
  const q = player.queue;
  for (const b of $$('[data-act="shuffle"]')) {
    b.innerHTML = icon(q.shuffle ? 'shuffle' : 'shuffleOff');
    b.classList.toggle('on', q.shuffle);
    b.classList.toggle('dim', !q.shuffle);
    b.title = q.shuffle ? '셔플 켜짐' : '셔플 꺼짐';
    b.setAttribute('aria-label', b.title);
  }
  for (const b of $$('[data-act="repeat"]')) {
    b.innerHTML = icon(REPEAT_ICON[q.repeat]);
    b.classList.toggle('on', q.repeat !== 'off');
    b.title = REPEAT_LABEL[q.repeat];
    b.setAttribute('aria-label', b.title);
  }
  $('#np-source').textContent = sourceLabel();
}

function onTime() {
  const d = player.duration;
  const c = player.time;
  const pct = d ? Math.min(100, (c / d) * 100) : 0;
  $('#mini .mini-progress i').style.width = `${pct}%`;
  if (!seeking) {
    const r = $('#np-range');
    r.value = d ? Math.round((c / d) * 1000) : 0;
    r.style.setProperty('--p', `${pct}%`);
    $('#np-cur').textContent = fmtTime(c);
  }
  $('#np-dur').textContent = fmtTime(d);
  if (panelVisible('lyrics')) highlightLyric(c);
}

function onQueue() {
  if (panelVisible('queue')) renderQueue(false);
  updateSideSub();
  markPlaying(document);
}

function onVolume() {
  const vol = player.muted ? 0 : player.volume;
  for (const v of [$('#mini-vol'), $('#np-vol')]) {
    v.value = vol;
    v.style.setProperty('--p', `${vol * 100}%`);
  }
  for (const b of $$('[data-act="mute"]')) b.innerHTML = icon(vol === 0 ? 'volumeOff' : 'volume');
}

function onSleep() {
  const b = $('#np-sleep');
  const s = player.sleep;
  b.classList.toggle('on', !!s);
  b.title = s?.at ? `${fmtClock(s.at)}에 멈춰요` : s ? '지금 곡이 끝나면 멈춰요' : '수면 타이머';
}

function updateFav() {
  const t = player?.track;
  const on = !!t && store.isFavorite(t.id);
  const b = $('#np-fav');
  if (!b) return;
  b.classList.toggle('on', on);
  b.innerHTML = icon(on ? 'heartFill' : 'heart');
  b.title = on ? '즐겨찾기 해제' : '즐겨찾기 추가';
}

function sourceLabel() {
  const s = player.queue.source;
  if (!s?.name) return '';
  const kind = { album: '앨범', artist: '아티스트', playlist: '재생목록', folder: '폴더', smart: '재생목록', phone: '', search: '', all: '', albums: '' }[s.type] ?? '';
  return kind ? `${kind} · ${s.name}` : s.name;
}

function updateSideSub() {
  const q = player.queue;
  const el = $('#np-side-sub');
  if (panel === 'design' || panel === 'sound') {
    el.textContent = '고르면 바로 바뀌고 저장돼요';
    return;
  }
  if (panel !== 'queue') {
    el.textContent = player.track ? `${player.track.title} · ${player.track.artist}` : '';
    return;
  }
  el.innerHTML = `${q.length}곡 · ${q.shuffle ? `<span class="badge">${icon('shuffle')}셔플</span> 섞인 순서` : '목록 순서'}${q.source?.name ? ` · ${esc(q.source.name)}` : ''}`;
}

// 앨범 커버의 대표 색 → 재생 화면 배경·스펙트럼 색 (삼성 뮤직처럼). 실제로 어떻게 쓸지는 디자인 설정(design.js)
async function tint(coverId) {
  if (coverId === tintFor) return;
  tintFor = coverId;
  setCoverImage(coverId ? coverUrl(coverId) : null);
  const rgb = coverId ? await dominantColor(coverUrl(coverId)) : null;
  if (tintFor !== coverId) return; // 그사이 곡이 또 바뀜
  setAlbumColor(rgb);
}

// 테마나 디자인 설정이 바뀌었을 때
export function retint() {
  applyDesign();
  if (panelVisible('design')) renderDesign();
}

// ───── 재생 순서 (S7: 실제로 나올 순서 그대로, 끌어서 바꾸기) ─────

function renderQueue(scrollToCurrent) {
  const el = $('#np-queue');
  const q = player.queue;
  const v = q.view();
  if (!v.length) {
    el.innerHTML = '<div class="lyrics-empty">재생 대기열이 비어 있어요</div>';
    return;
  }
  const keepTop = el.scrollTop;
  el.innerHTML = v
    .map((it) => {
      const t = store.tracks.get(it.id);
      const skip = q.skipped(it.id);
      return `<div class="row track${it.current ? ' playing' : ''}${it.index < q.pos ? ' past' : ''}${skip ? ' skip' : ''}" data-qi="${it.index}" data-key="${it.key}" data-id="${it.id}">
<div class="thumb">${coverImg(t ? store.coverIdFor(t) : null)}${EQ}</div>
<div class="meta"><div class="title">${esc(t?.title || '없는 곡')}</div><div class="sub">${skip ? '셔플 제외 · ' : ''}${esc(t?.artist || '')}</div></div>
<div class="trail"><button class="icon-btn" data-act="q-remove" aria-label="대기열에서 빼기">${icon('close')}</button><span class="icon-btn drag keep" aria-label="끌어서 순서 바꾸기">${icon('drag')}</span></div></div>`;
    })
    .join('');
  const cur = el.querySelector('.row.playing');
  if (scrollToCurrent && cur) cur.scrollIntoView({ block: 'center' });
  else {
    el.scrollTop = keepTop;
    if (cur) {
      const a = cur.offsetTop;
      if (a < el.scrollTop || a > el.scrollTop + el.clientHeight - cur.offsetHeight) cur.scrollIntoView({ block: 'nearest' });
    }
  }
}

// ───── 동작 ─────

function speedMenu(anchor) {
  const cur = player.opts.rate || 1;
  openMenu(
    SPEEDS.map((r) => ({
      icon: Math.abs(cur - r) < 0.001 ? 'check' : 'speed',
      label: `${r}배${r === 1 ? ' (보통)' : ''}`,
      run: () => {
        setAudio({ rate: r });
        toast(`재생 속도 ${r}배`, 1300);
      },
    })),
    { anchor },
  );
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const t = player.track;
  switch (b.dataset.act) {
    case 'toggle':
      return player.toggle();
    case 'prev':
      return player.prev();
    case 'next':
      return player.next();
    case 'shuffle':
      return toast(player.toggleShuffle() ? '셔플 켜짐' : '셔플 꺼짐', 1300);
    case 'repeat':
      return toast(REPEAT_LABEL[player.cycleRepeat()], 1300);
    case 'mute':
      return player.toggleMute();
    case 'open-np':
      return openNp();
    case 'open-queue':
      return openNp('queue');
    case 'close-np':
      return closeNp();
    case 'fav':
      return t && toggleFavorite(t.id);
    case 'np-add':
      return t && addToPlaylistDialog([t.id]);
    case 'np-more':
      return npMenu(b);
    case 'sleep':
      return sleepDialog();
    case 'speed':
      return speedMenu(b);
    case 'ab': {
      const ab = player.cycleAB();
      return toast(!ab ? 'A-B 반복을 껐어요' : ab.b === null ? `A: ${fmtTime(ab.a)} · 끝낼 곳에서 한 번 더 눌러요` : `${fmtTime(ab.a)} ~ ${fmtTime(ab.b)} 반복`, 2000);
    }
    case 'quality':
      return qualityDialog();
    case 'pip':
      return openPip(player);
    case 'panel-lyrics':
      return showPanel('lyrics', true);
    case 'panel-queue':
      return showPanel('queue', true);
    case 'panel-sound':
      return showPanel('sound', true);
    case 'panel-design':
      return showPanel('design', true);
    case 'panel-close':
      return $('#np').classList.remove('side-open');
    case 'q-remove':
      return player.removeFromQueue(Number(b.closest('.row').dataset.key));
    default:
      return undefined;
  }
}

function npMenu(anchor) {
  const t = player.track;
  const items = t ? trackMenu(t).filter((it) => it === '-' || !['다음에 재생', '재생 대기열에 추가'].includes(it.label)) : [];
  if (items.length) items.push('-');
  items.push(
    { icon: 'lyrics', label: '가사', run: () => showPanel('lyrics', true) },
    { icon: 'queue', label: '재생 순서', run: () => showPanel('queue', true) },
    { icon: 'pip', label: '작은 창 (항상 위)', run: () => openPip(player) },
    { icon: 'eq', label: '사운드 (이퀄라이저·크로스페이드)', run: () => showPanel('sound', true) },
    { icon: 'palette', label: '디자인 꾸미기', run: () => showPanel('design', true) },
    { icon: 'moon', label: player.sleep ? '수면 타이머 끄기' : '수면 타이머', run: () => (player.sleep ? (player.clearSleep(), toast('수면 타이머를 껐어요')) : sleepDialog()) },
    { icon: 'trash', label: '재생 대기열 비우기', danger: true, run: () => player.clearQueue() },
  );
  openMenu(items, { anchor });
}

export async function sleepDialog() {
  const opts = [
    [15, '15분 뒤'],
    [30, '30분 뒤'],
    [45, '45분 뒤'],
    [60, '1시간 뒤'],
    [90, '1시간 30분 뒤'],
    ['track', '지금 곡이 끝나면'],
  ];
  const after = { pause: '멈추기만', quit: '멈추고 SyncMusic 종료', sleep: '멈추고 PC 절전', shutdown: '멈추고 PC 끄기' }[store.settings.power?.sleepAction || 'pause'];
  const html = `<div class="dlg-list">${opts
    .map(([v, l]) => `<div class="row" data-v="${v}"><div class="thumb folder-icon">${icon('moon')}</div><div class="meta"><div class="title">${l}</div></div><div></div></div>`)
    .join('')}</div><p class="dz-note">끝나면: ${after} (설정 → 전원에서 바꿔요)</p>`;
  const v = await dialog({
    title: '수면 타이머',
    html,
    actions: [player.sleep ? { label: '타이머 끄기', value: 'off', danger: true } : { label: '취소', value: null }],
    onOpen: (d, done) => {
      d.querySelector('.dlg-list').onclick = (e) => {
        const r = e.target.closest('.row');
        if (r) done(r.dataset.v);
      };
    },
  });
  if (v === 'off') {
    player.clearSleep();
    toast('수면 타이머를 껐어요');
  } else if (v) {
    player.setSleep(v === 'track' ? 'track' : Number(v));
    toast(v === 'track' ? '지금 곡이 끝나면 멈춰요' : `${fmtClock(player.sleep.at)}에 멈춰요`);
  }
}

// ───── 폰에서 듣던 곡 이어 듣기 ─────

export function showPhoneChip(np) {
  const el = $('#phone-chip');
  if (!np?.current?.title || Date.now() - np.receivedAt > 30 * 60_000 || phoneDismissedAt >= np.receivedAt) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `${icon('phone')}<div class="txt"><b>${esc(np.deviceName)}</b>에서 ${np.playing ? '듣는 중' : '멈춤'} · ${esc(np.current.title)} — ${esc(np.current.artist)}</div>
<button class="btn primary small" data-act="handoff">PC에서 이어 듣기</button>
<button class="icon-btn" data-act="chip-close" aria-label="닫기">${icon('close')}</button>`;
  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    phoneDismissedAt = np.receivedAt;
    el.hidden = true;
    if (act !== 'handoff') return;
    try {
      const h = await post('/api/sync/handoff');
      player.handoff(h);
      toast(`폰에서 듣던 곳부터 이어 들어요${h.missing ? ` · PC에 없는 곡 ${h.missing}개는 빠졌어요` : ''}`, 4000);
    } catch (err) {
      toast(err.message, 4000);
    }
  };
}

