// 작은 창 (항상 위): 문서 PIP(Document Picture-in-Picture). 다른 창 위에 늘 떠 있다 (크롬·엣지 116 이상, 한 번 더 누르면 닫힘)
// 디자인: 커버를 흐리게 깐 유리 카드. 창 크기에 맞춰 모양이 바뀐다
//   낮은 창(기본) — 커버 옆에 제목·버튼, 아래 가장자리에 진행 막대
//   조금 높은 창 — 진행 막대에 시간, 셔플·반복 버튼까지
//   세로로 키운 창 — 커버가 위로 크게, 가운데 정렬, 다음 곡도
// 계속 도는 애니메이션은 없다 (배경 흐림은 곡마다 한 번 그림, 진행 막대만 1초에 몇 번) → CPU를 거의 안 씀
import { coverUrl } from '../api.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { esc, fmtTime } from '../util.js';
import { toggleFavorite } from './common.js';
import { toast } from './dom.js';

let pip = null;

const SIZE_KEY = 'sm.pip.size';
const REPEAT_ICON = { off: 'repeatOff', all: 'repeat', one: 'repeatOne' };
const REPEAT_LABEL = { off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' };
const abs = (u) => new URL(u, location.href).href;

const CSS = `
@font-face { font-family: 'Pretendard Variable'; src: url('${location.origin}/fonts/PretendardVariable.woff2') format('woff2-variations'); font-weight: 45 920; font-display: swap; }
* { box-sizing: border-box; }
:root {
  color-scheme: dark;
  --fg: #fff; --fg2: rgb(255 255 255 / 0.74); --fg3: rgb(255 255 255 / 0.52);
  --hover: rgb(255 255 255 / 0.14); --track: rgb(255 255 255 / 0.22);
  --veil: linear-gradient(180deg, rgb(12 12 18 / 0.30), rgb(12 12 18 / 0.60));
  --fallback: linear-gradient(135deg, var(--accent, #5aa6ff), #14141c 88%);
  --play-bg: #fff; --play-fg: #121216; --shadow: 0 10px 26px rgb(0 0 0 / 0.38);
}
:root[data-mode='light'] {
  color-scheme: light;
  --fg: #121216; --fg2: rgb(0 0 0 / 0.62); --fg3: rgb(0 0 0 / 0.45);
  --hover: rgb(0 0 0 / 0.08); --track: rgb(0 0 0 / 0.14);
  --veil: linear-gradient(180deg, rgb(255 255 255 / 0.50), rgb(255 255 255 / 0.76));
  --fallback: linear-gradient(135deg, var(--accent, #1d6fe6), #f3f3f6 88%);
  --play-bg: #121216; --play-fg: #fff; --shadow: 0 10px 24px rgb(0 0 0 / 0.22);
}
html, body { margin: 0; height: 100%; overflow: hidden; background: #14141c; color: var(--fg); user-select: none;
  font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
:root[data-mode='light'] body { background: #f3f3f6; }
.card { position: relative; height: 100%; overflow: hidden; }
.bg { position: absolute; inset: 0; background: center / cover no-repeat; opacity: 0; transition: opacity 0.5s ease; }
.bg.on { opacity: 1; }
.bg.none { background: var(--fallback); }
.veil { position: absolute; inset: 0; background: var(--veil); }
.pp { position: relative; z-index: 1; height: 100%; display: flex; align-items: center; gap: 14px; padding: 12px 16px 15px 12px; }
.art { position: relative; height: min(118px, calc(100vh - 28px)); aspect-ratio: 1; flex: none; display: grid; place-items: center;
  border-radius: 12px; overflow: hidden; background: rgb(128 128 128 / 0.22); box-shadow: var(--shadow); color: var(--fg3); }
.art svg.i { width: 40%; height: 40%; stroke-width: 1.5; }
.art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.35s ease; }
.art img.ok { opacity: 1; }
.info { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: 4px; }
.titles { min-width: 0; flex: 1; }
.t { font-size: 15px; font-weight: 760; letter-spacing: -0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a { margin-top: 2px; font-size: 12.5px; color: var(--fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:root:not([data-mode='light']) .t, :root:not([data-mode='light']) .a { text-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
button { border: 0; padding: 0; background: none; color: var(--fg); display: grid; place-items: center; flex: none; cursor: pointer;
  border-radius: 50%; transition: background 0.15s, transform 0.12s, color 0.15s; }
button:hover { background: var(--hover); }
button:active { transform: scale(0.93); }
.fav { width: 32px; height: 32px; color: var(--fg2); }
.fav.on { color: var(--heart, #ff5d73); }
.ctl { display: flex; align-items: center; gap: 2px; margin: 8px 0 0 -6px; }
.ctl button { width: 36px; height: 36px; }
.ctl .play { width: 44px; height: 44px; margin: 0 2px; background: var(--play-bg); color: var(--play-fg); box-shadow: 0 4px 14px rgb(0 0 0 / 0.24); }
.ctl .play:hover { background: var(--play-bg); transform: scale(1.05); }
.ctl .side { display: none; color: var(--fg3); }
.ctl .side.on { color: var(--fg); }
.time { margin-left: auto; padding-left: 8px; font-size: 11.5px; color: var(--fg2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.seek { display: none; align-items: center; gap: 8px; font-size: 11px; color: var(--fg2); font-variant-numeric: tabular-nums; }
.track { position: relative; flex: 1; height: 4px; border-radius: 4px; background: var(--track); cursor: pointer; }
.track::before { content: ''; position: absolute; inset: -8px 0; }
.track i, .edge i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--fg); pointer-events: none; }
.edge { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; height: 3px; background: var(--track); cursor: pointer; transition: height 0.15s; }
.edge:hover { height: 6px; }
.up { display: none; margin-top: 10px; font-size: 11.5px; color: var(--fg3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up b { color: var(--fg2); font-weight: 650; margin-right: 4px; }
.vol { position: absolute; z-index: 3; top: 10px; left: 50%; transform: translateX(-50%); padding: 4px 12px; border-radius: 999px;
  background: rgb(0 0 0 / 0.6); color: #fff; font-size: 12px; font-weight: 650; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.vol.show { opacity: 1; }
svg.i { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.play svg.i { width: 24px; height: 24px; }
.fav svg.i { width: 20px; height: 20px; }
.side svg.i { width: 19px; height: 19px; }

/* 조금 높은 창: 진행 막대를 시간과 함께, 셔플·반복도 */
@media (min-height: 190px) {
  .seek { display: flex; margin-top: 10px; }
  .edge, .time { display: none; }
  .ctl { margin-top: 6px; }
  .ctl .side { display: grid; }
  .art { height: min(220px, calc(100vh - 30px)); border-radius: 14px; }
  .t { font-size: 16px; }
}

/* 세로로 키운 창: 커버가 위로 크게, 가운데 정렬, 다음 곡까지 */
@media (min-height: 260px) and (max-aspect-ratio: 5/4) {
  .pp { flex-direction: column; justify-content: center; align-items: stretch; gap: 14px; padding: 18px 18px 16px; text-align: center; }
  .art { align-self: center; height: auto; width: min(calc(100vw - 56px), calc(100vh - 215px)); border-radius: 18px; }
  .head { padding-left: 36px; }
  .t { font-size: 17px; }
  .ctl { justify-content: center; gap: 8px; margin: 4px 0 0; }
  .ctl .play { width: 52px; height: 52px; }
  .ctl .play svg.i { width: 28px; height: 28px; }
  .up { display: block; }
}

@media (max-width: 260px) {
  .fav, .time { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;

const MARKUP = `<div class="card">
  <div class="bg" id="bgA"></div><div class="bg" id="bgB"></div><div class="veil"></div>
  <div class="pp">
    <div class="art" id="art">${icon('note')}</div>
    <div class="info">
      <div class="head">
        <div class="titles"><div class="t" id="t"></div><div class="a" id="a"></div></div>
        <button class="fav" data-a="fav" id="fav" aria-label="즐겨찾기">${icon('heart')}</button>
      </div>
      <div class="seek"><span id="cur">0:00</span><div class="track" id="track"><i id="prog"></i></div><span id="dur">0:00</span></div>
      <div class="ctl">
        <button class="side" data-a="shuffle" id="shuffle" aria-label="셔플">${icon('shuffle')}</button>
        <button data-a="prev" aria-label="이전 곡">${icon('prev')}</button>
        <button class="play" data-a="toggle" id="play" aria-label="재생">${icon('play')}</button>
        <button data-a="next" aria-label="다음 곡">${icon('next')}</button>
        <button class="side" data-a="repeat" id="repeat" aria-label="반복">${icon('repeat')}</button>
        <span class="time" id="time"></span>
      </div>
      <div class="up" id="up"></div>
    </div>
  </div>
  <div class="edge" id="edge"><i id="edgeProg"></i></div>
  <div class="vol" id="vol"></div>
</div>`;

// 커버를 작게 흐려서 배경 그림으로 만든다 (곡마다 한 번. CSS 흐림 필터를 계속 돌리지 않게)
const backdrops = new Map();
async function backdrop(coverId) {
  if (!coverId) return null;
  if (backdrops.has(coverId)) return backdrops.get(coverId);
  const img = new Image();
  img.src = coverUrl(coverId);
  try {
    await img.decode();
  } catch {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  g.filter = 'blur(4px) saturate(1.5)';
  g.drawImage(img, -8, -8, 64, 64); // 가장자리까지 흐림이 고르게 (테두리가 어두워지지 않게)
  const url = c.toDataURL('image/jpeg', 0.85);
  if (backdrops.size > 40) backdrops.delete(backdrops.keys().next().value);
  backdrops.set(coverId, url);
  return url;
}

function savedSize() {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY));
    if (s?.width >= 240 && s?.height >= 100) return { width: Math.round(s.width), height: Math.round(s.height) };
  } catch {
    // 처음이면 기본 크기
  }
  return { width: 400, height: 150 };
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
};

export async function openPip(player) {
  if (pip) {
    pip.close(); // 열려 있으면 닫기
    return;
  }
  if (!('documentPictureInPicture' in window)) {
    toast('이 창에서는 작은 창을 열 수 없어요 (크롬·엣지 116 이상)', 4000);
    return;
  }
  let w;
  try {
    w = await window.documentPictureInPicture.requestWindow(savedSize());
  } catch (e) {
    toast(`작은 창을 열지 못했어요: ${e.message}`, 4000);
    return;
  }
  pip = w;
  mountPip(w, player);
  w.addEventListener('pagehide', () => {
    pip = null;
  });
  let sizeTimer = 0;
  w.addEventListener('resize', () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: w.innerWidth, height: w.innerHeight }));
      } catch {
        // 저장 못 해도 다음에 기본 크기로 열릴 뿐
      }
    }, 400);
  });
}

// 작은 창(또는 미리 보기용 iframe)의 창 w에 플레이어를 그린다. 창이 닫히면 알아서 정리
export function mountPip(w, player) {
  const d = w.document;
  const style = d.createElement('style');
  style.textContent = CSS;
  d.head.append(style);
  d.body.innerHTML = MARKUP;
  const el = (id) => d.getElementById(id);
  let front = 'bgA';
  let shown; // 지금 보이는 커버 ID (undefined = 아직 안 그림)

  const theme = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['--accent', '--heart']) d.documentElement.style.setProperty(k, cs.getPropertyValue(k));
    d.documentElement.dataset.mode = isDark() ? 'dark' : 'light';
  };

  // 배경: 두 장을 번갈아 써서 곡이 바뀔 때 부드럽게 넘어간다
  const setBackdrop = async (coverId) => {
    const url = await backdrop(coverId);
    if (shown !== coverId) return; // 그새 또 바뀜
    const back = front === 'bgA' ? 'bgB' : 'bgA';
    el(back).style.backgroundImage = url ? `url("${url}")` : '';
    el(back).classList.toggle('none', !url);
    el(back).classList.add('on');
    el(front).classList.remove('on');
    front = back;
  };

  const setArt = (coverId) => {
    const art = el('art');
    if (!coverId) {
      art.innerHTML = icon('note');
      return;
    }
    const img = d.createElement('img');
    img.alt = '';
    img.onload = () => img.classList.add('ok');
    img.onerror = () => img.remove();
    img.src = abs(coverUrl(coverId));
    art.innerHTML = icon('note');
    art.append(img);
  };

  const onFav = () => {
    const on = !!player.track && store.isFavorite(player.track.id);
    const b = el('fav');
    b.classList.toggle('on', on);
    b.innerHTML = icon(on ? 'heartFill' : 'heart');
    b.setAttribute('aria-label', on ? '즐겨찾기 해제' : '즐겨찾기 추가');
  };

  const onQueue = () => {
    const q = player.queue;
    const nextId = q.upcoming().find((it) => !q.skipped(it.id))?.id ?? (q.repeat === 'all' ? q.view()[0]?.id : null);
    const t = nextId ? store.tracks.get(nextId) : null;
    el('up').innerHTML = q.repeat === 'one' ? '<b>한 곡 반복 중</b>' : t ? `<b>다음 곡</b>${esc(t.title)} · ${esc(t.artist)}` : '<b>마지막 곡이에요</b>';
  };

  const onTrack = () => {
    theme(); // 라이트·다크·포인트 색이 바뀌었을 수 있음
    const t = player.track;
    const c = t ? store.coverIdFor(t) : null;
    if (c !== shown) {
      shown = c;
      setArt(c);
      setBackdrop(c);
    }
    el('t').textContent = t ? t.title : '재생 중인 곡 없음';
    el('a').textContent = t ? t.artist : 'SyncMusic';
    d.title = t ? `${t.title} - ${t.artist}` : 'SyncMusic';
    onFav();
    onQueue();
  };

  const onState = () => {
    const b = el('play');
    b.innerHTML = icon(player.playing ? 'pause' : 'play');
    b.setAttribute('aria-label', player.playing ? '일시정지' : '재생');
    const q = player.queue;
    const sh = el('shuffle');
    sh.innerHTML = icon(q.shuffle ? 'shuffle' : 'shuffleOff');
    sh.classList.toggle('on', q.shuffle);
    sh.title = q.shuffle ? '셔플 켜짐' : '셔플 꺼짐';
    const rp = el('repeat');
    rp.innerHTML = icon(REPEAT_ICON[q.repeat]);
    rp.classList.toggle('on', q.repeat !== 'off');
    rp.title = REPEAT_LABEL[q.repeat];
    onQueue();
  };

  const onTime = () => {
    const dur = player.duration;
    const cur = player.time;
    const pct = `${dur ? Math.min(100, (cur / dur) * 100) : 0}%`;
    el('prog').style.width = pct;
    el('edgeProg').style.width = pct;
    el('cur').textContent = fmtTime(cur);
    el('dur').textContent = fmtTime(dur);
    el('time').textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
  };

  const seekAt = (bar, e) => {
    const r = bar.getBoundingClientRect();
    player.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * player.duration);
  };

  d.body.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('#track, #edge');
    if (bar) seekAt(bar, e);
  });
  d.body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'toggle') player.toggle();
    else if (a === 'prev') player.prev();
    else if (a === 'next') player.next();
    else if (a === 'shuffle') player.toggleShuffle();
    else if (a === 'repeat') player.cycleRepeat();
    else if (a === 'fav' && player.track) toggleFavorite(player.track.id);
  });
  d.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      player.toggle();
    } else if (e.code === 'ArrowRight') {
      if (e.ctrlKey) player.next();
      else player.seekBy(10);
    } else if (e.code === 'ArrowLeft') {
      if (e.ctrlKey) player.prev();
      else player.seekBy(-10);
    }
  });
  // 마우스 휠로 음량 (잠깐 '음량 60%'가 보임)
  let volTimer = 0;
  d.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      player.setVolume((player.muted ? 0 : player.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
      const v = el('vol');
      v.textContent = player.muted || player.volume === 0 ? '음소거' : `음량 ${Math.round(player.volume * 100)}%`;
      v.classList.add('show');
      clearTimeout(volTimer);
      volTimer = setTimeout(() => v.classList.remove('show'), 900);
    },
    { passive: false },
  );

  player.addEventListener('track', onTrack);
  player.addEventListener('state', onState);
  player.addEventListener('time', onTime);
  player.addEventListener('queue', onQueue);
  store.on('playlists', onFav);
  w.addEventListener('pagehide', () => {
    player.removeEventListener('track', onTrack);
    player.removeEventListener('state', onState);
    player.removeEventListener('time', onTime);
    player.removeEventListener('queue', onQueue);
    store.off('playlists', onFav);
  });
  onTrack();
  onState();
  onTime();
}
