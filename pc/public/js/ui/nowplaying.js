// 미니 플레이어 · 전체 재생 화면 · 재생 순서 · 가사 · 수면 타이머 · 폰 이어듣기
import { coverUrl, get, post } from '../api.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { $, $$, dominantColor, esc, fmtClock, fmtTime, rgbToHsl } from '../util.js';
import { addToPlaylistDialog, coverImg, EQ, markPlaying, toggleFavorite, trackMenu } from './common.js';
import { dialog, openMenu, sortable, toast } from './dom.js';

let player;
let panel = readPref('np.panel', 'queue');
let seeking = false;
let lyrics = { id: null, synced: null, idx: -1 };
let lyricsScrollHold = 0;
let lastTint = null;
let phoneDismissedAt = 0;

const REPEAT_LABEL = { off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' };
const REPEAT_ICON = { off: 'repeatOff', all: 'repeat', one: 'repeatOne' };

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
    <button class="icon-btn" data-act="shuffle"></button>
    <button class="icon-btn" data-act="repeat"></button>
    <button class="icon-btn" data-act="open-queue" aria-label="재생 순서" title="재생 순서">${icon('queue')}</button>
    <div class="vol"><button class="icon-btn" data-act="mute" aria-label="음소거"></button><input type="range" id="mini-vol" min="0" max="1" step="0.01" aria-label="음량"></div>
  </div>
</div>`;

  $('#np').innerHTML = `<div class="np-bg"></div>
<div class="np-top">
  <button class="icon-btn" data-act="close-np" aria-label="닫기" title="닫기 (Esc)">${icon('down')}</button>
  <div class="np-source" id="np-source"></div>
  <button class="icon-btn" data-act="np-more" aria-label="더 보기">${icon('more')}</button>
</div>
<div class="np-body">
  <div class="np-main">
    <div class="cover np-art" id="np-art"></div>
    <div class="np-titlebar">
      <div class="np-titles"><h2 id="np-title"></h2><a id="np-artist" href="#"></a></div>
      <button class="icon-btn heart" data-act="fav" id="np-fav" aria-label="즐겨찾기">${icon('heart')}</button>
      <button class="icon-btn" data-act="np-add" aria-label="재생목록에 추가" title="재생목록에 추가">${icon('plus')}</button>
    </div>
    <div class="np-seek">
      <input type="range" id="np-range" min="0" max="1000" step="1" value="0" aria-label="재생 위치">
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
      <button class="icon-btn" data-act="sleep" id="np-sleep" aria-label="수면 타이머" title="수면 타이머">${icon('moon')}</button>
      <button class="icon-btn panel-toggle" data-act="panel-queue" aria-label="재생 순서" title="재생 순서">${icon('queue')}</button>
    </div>
  </div>
  <aside class="np-side">
    <div class="np-side-head">
      <div class="seg" id="np-tabs"><button data-panel="queue">재생 순서</button><button data-panel="lyrics">가사</button></div>
      <button class="icon-btn panel-close" data-act="panel-close" aria-label="닫기">${icon('close')}</button>
    </div>
    <div class="np-side-sub" id="np-side-sub"></div>
    <div class="np-panel" id="np-queue"></div>
    <div class="np-panel" id="np-lyrics" hidden></div>
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
  $('#np-lyrics').addEventListener('click', (e) => {
    const p = e.target.closest('p[data-t]');
    if (p) player.seek(Number(p.dataset.t));
  });
  $('#np-lyrics').addEventListener('wheel', () => {
    lyricsScrollHold = Date.now() + 4000; // 직접 스크롤하는 동안은 따라가지 않음
  });
  $('#np-artist').addEventListener('click', () => closeNp());

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
        player.setVolume((player.audio.muted ? 0 : player.audio.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
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
  player.addEventListener('slept', () => toast('수면 타이머: 재생을 멈췄어요', 4000));
  player.addEventListener('playerror', (e) => toast(`재생할 수 없는 파일이에요${e.detail ? `: ${e.detail.title}` : ''}`, 3500));
  store.on('playlists', updateFav);
  window.addEventListener('popstate', () => {
    if (isNpOpen() && !history.state?.np) closeNp(true);
  });
  matchMedia('(min-width: 1000px)').addEventListener('change', () => refreshPanel());

  showPanel(panel, false);
  onTrack();
  onState();
  onVolume();
  onSleep();
}

// ───── 열기·닫기 ─────

export const isNpOpen = () => $('#np').classList.contains('open');
const isWide = () => matchMedia('(min-width: 1000px)').matches;

export function openNp(withPanel) {
  const np = $('#np');
  if (!isNpOpen()) {
    np.classList.add('open');
    np.setAttribute('aria-hidden', 'false');
    history.pushState({ np: true }, '');
  }
  if (withPanel) showPanel(withPanel, true);
  else refreshPanel(true);
}

export function closeNp(fromPopstate = false) {
  if (!isNpOpen()) return;
  const np = $('#np');
  np.classList.remove('open', 'side-open');
  np.setAttribute('aria-hidden', 'true');
  if (!fromPopstate && history.state?.np) history.back();
}

function showPanel(name, open = false) {
  panel = name;
  try {
    localStorage.setItem('sm.np.panel', name);
  } catch {
    // 무시
  }
  for (const b of $$('#np-tabs button')) b.classList.toggle('on', b.dataset.panel === name);
  $('#np-queue').hidden = name !== 'queue';
  $('#np-lyrics').hidden = name !== 'lyrics';
  if (open && !isWide()) $('#np').classList.add('side-open');
  refreshPanel(true);
}

const panelVisible = (name) => isNpOpen() && panel === name && (isWide() || $('#np').classList.contains('side-open'));

function refreshPanel(scrollToCurrent = false) {
  if (panelVisible('queue')) renderQueue(scrollToCurrent);
  else if (panelVisible('lyrics')) loadLyrics();
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
  tint(coverId);
  markPlaying(document);
  $('#np-source').textContent = sourceLabel();
  if (panelVisible('lyrics')) loadLyrics();
  else lyrics = { id: null, synced: null, idx: -1 };
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
  if (lyrics.synced) highlightLyric(c);
}

function onQueue() {
  if (panelVisible('queue')) renderQueue(false);
  updateSideSub();
  markPlaying(document);
}

function onVolume() {
  const vol = player.audio.muted ? 0 : player.audio.volume;
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
  if (panel !== 'queue') {
    el.textContent = player.track ? `${player.track.title} · ${player.track.artist}` : '';
    return;
  }
  el.innerHTML = `${q.length}곡 · ${q.shuffle ? `<span class="badge">${icon('shuffle')}셔플</span> 섞인 순서` : '목록 순서'}${q.source?.name ? ` · ${esc(q.source.name)}` : ''}`;
}

// 앨범 커버 색을 재생 화면 배경에 깐다 (삼성 뮤직처럼)
async function tint(coverId) {
  const np = $('#np');
  if (!coverId) {
    lastTint = null;
    np.style.removeProperty('--np-tint');
    return;
  }
  const rgb = await dominantColor(coverUrl(coverId));
  if (player.track && store.coverIdFor(player.track) !== coverId) return;
  lastTint = rgb;
  applyTint();
}

export function retint() {
  applyTint();
}

function applyTint() {
  const np = $('#np');
  if (!lastTint) return np.style.removeProperty('--np-tint');
  const [h, s] = rgbToHsl(lastTint);
  const theme = document.documentElement.dataset.theme;
  const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
  np.style.setProperty('--np-tint', `hsl(${Math.round(h)} ${Math.min(60, Math.round(s))}% ${dark ? 22 : 86}%)`);
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
      return `<div class="row track${it.current ? ' playing' : ''}${it.index < q.pos ? ' past' : ''}" data-qi="${it.index}" data-key="${it.key}" data-id="${it.id}">
<div class="thumb">${coverImg(t ? store.coverIdFor(t) : null)}${EQ}</div>
<div class="meta"><div class="title">${esc(t?.title || '없는 곡')}</div><div class="sub">${esc(t?.artist || '')}</div></div>
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

// ───── 가사 ─────

async function loadLyrics() {
  const el = $('#np-lyrics');
  const t = player.track;
  if (!t) {
    lyrics = { id: null, synced: null, idx: -1 };
    el.innerHTML = '<div class="lyrics-empty">재생 중인 곡이 없어요</div>';
    return;
  }
  if (lyrics.id === t.id) return;
  lyrics = { id: t.id, synced: null, idx: -1 };
  el.innerHTML = '<div class="lyrics-empty">가사를 불러오는 중…</div>';
  try {
    const ly = await get(`/api/tracks/${t.id}/lyrics`);
    if (lyrics.id !== t.id) return;
    if (ly.synced?.length) {
      lyrics.synced = ly.synced;
      el.innerHTML = `<div class="lyrics">${ly.synced.map((l, i) => `<p data-li="${i}" data-t="${l.t}">${esc(l.line) || '♪'}</p>`).join('')}</div>`;
      highlightLyric(player.time, true);
    } else if (ly.text) {
      el.innerHTML = `<div class="lyrics plain">${esc(ly.text)}</div>`;
    } else {
      el.innerHTML = '<div class="lyrics-empty">가사가 없어요<br><small>곡 파일의 가사 태그나, 같은 이름의 .lrc 파일을 읽어요</small></div>';
    }
  } catch {
    el.innerHTML = '<div class="lyrics-empty">가사를 불러오지 못했어요</div>';
  }
}

function highlightLyric(time, force = false) {
  const s = lyrics.synced;
  let i = -1;
  for (let k = 0; k < s.length && s[k].t <= time + 0.15; k++) i = k;
  if (i === lyrics.idx && !force) return;
  lyrics.idx = i;
  const el = $('#np-lyrics');
  el.querySelector('p.now')?.classList.remove('now');
  const p = el.querySelector(`p[data-li="${i}"]`);
  if (!p) return;
  p.classList.add('now');
  if (panelVisible('lyrics') && Date.now() > lyricsScrollHold) p.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
}

// ───── 동작 ─────

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
    case 'panel-lyrics':
      return showPanel('lyrics', true);
    case 'panel-queue':
      return showPanel('queue', true);
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
  const html = `<div class="dlg-list">${opts
    .map(([v, l]) => `<div class="row" data-v="${v}"><div class="thumb folder-icon">${icon('moon')}</div><div class="meta"><div class="title">${l}</div></div><div></div></div>`)
    .join('')}</div>`;
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
