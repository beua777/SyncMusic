// 작은 창 (항상 위): 문서 PIP(Document Picture-in-Picture)로 커버 · 제목 · 재생 버튼만 띄운다.
// 다른 창 위에 늘 떠 있다. 크롬·엣지 116 이상. 한 번 더 누르면 닫힌다
import { coverUrl } from '../api.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toggleFavorite } from './common.js';
import { toast } from './dom.js';

let pip = null;

const VARS = ['--bg', '--surface', '--surface-2', '--surface-3', '--text', '--text-2', '--text-3', '--line', '--accent', '--accent-text', '--heart'];

const CSS = `
@font-face { font-family: 'Pretendard Variable'; src: url('${location.origin}/fonts/PretendardVariable.woff2') format('woff2-variations'); font-weight: 45 920; font-display: swap; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--surface); color: var(--text); font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', system-ui, sans-serif; overflow: hidden; user-select: none; -webkit-font-smoothing: antialiased; }
.pp { position: relative; height: 100%; display: flex; align-items: center; gap: 14px; padding: 12px 14px 16px; }
.art { width: min(112px, 34vw, calc(100vh - 30px)); aspect-ratio: 1; border-radius: 14px; overflow: hidden; flex: none; background: linear-gradient(135deg, var(--surface-2), var(--surface-3)); box-shadow: 0 6px 18px rgb(0 0 0 / 0.18); }
.art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.info { min-width: 0; flex: 1; }
.t { font-weight: 750; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a { color: var(--text-2); font-size: 13px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctl { display: flex; align-items: center; gap: 2px; margin-top: 8px; }
button { width: 38px; height: 38px; border: 0; border-radius: 50%; background: none; color: var(--text); display: grid; place-items: center; cursor: pointer; padding: 0; flex: none; }
button:hover { background: var(--surface-2); }
button.big { width: 44px; height: 44px; background: var(--text); color: var(--surface); }
button.big:hover { background: var(--text); filter: brightness(1.15); }
button.on { color: var(--heart); }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--line); cursor: pointer; }
.bar i { display: block; height: 100%; width: 0; background: var(--accent); pointer-events: none; }
svg.i { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
`;

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
    w = await window.documentPictureInPicture.requestWindow({ width: 380, height: 140 });
  } catch (e) {
    toast(`작은 창을 열지 못했어요: ${e.message}`, 4000);
    return;
  }
  pip = w;
  const d = w.document;
  const style = d.createElement('style');
  style.textContent = CSS;
  d.head.append(style);
  d.body.innerHTML = `<div class="pp">
  <div class="art" id="art"></div>
  <div class="info"><div class="t" id="t"></div><div class="a" id="a"></div>
    <div class="ctl">
      <button data-a="prev" aria-label="이전 곡">${icon('prev')}</button>
      <button data-a="toggle" class="big" id="play" aria-label="재생">${icon('play')}</button>
      <button data-a="next" aria-label="다음 곡">${icon('next')}</button>
      <button data-a="fav" id="fav" aria-label="즐겨찾기">${icon('heart')}</button>
    </div>
  </div>
  <div class="bar" id="bar"><i id="prog"></i></div>
</div>`;
  const el = (id) => d.getElementById(id);

  const theme = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of VARS) d.documentElement.style.setProperty(k, cs.getPropertyValue(k));
    d.documentElement.style.colorScheme = cs.colorScheme;
  };
  const onFav = () => {
    const on = !!player.track && store.isFavorite(player.track.id);
    const b = el('fav');
    b.classList.toggle('on', on);
    b.innerHTML = icon(on ? 'heartFill' : 'heart');
  };
  const onTrack = () => {
    theme(); // 라이트·다크·포인트 색이 바뀌었을 수 있음
    const t = player.track;
    const c = t ? store.coverIdFor(t) : null;
    el('art').innerHTML = c ? `<img src="${new URL(coverUrl(c), location.href).href}" alt="">` : '';
    el('art').querySelector('img')?.addEventListener('error', (e) => e.target.remove());
    el('t').textContent = t ? t.title : '재생 중인 곡 없음';
    el('a').textContent = t ? t.artist : '';
    d.title = t ? `${t.title} - ${t.artist}` : 'SyncMusic';
    onFav();
  };
  const onState = () => {
    const b = el('play');
    b.innerHTML = icon(player.playing ? 'pause' : 'play');
    b.setAttribute('aria-label', player.playing ? '일시정지' : '재생');
  };
  const onTime = () => {
    const dur = player.duration;
    el('prog').style.width = `${dur ? Math.min(100, (player.time / dur) * 100) : 0}%`;
  };

  d.body.addEventListener('click', (e) => {
    if (e.target.id === 'bar') {
      const r = e.target.getBoundingClientRect();
      player.seek(((e.clientX - r.left) / r.width) * player.duration);
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'toggle') player.toggle();
    else if (a === 'prev') player.prev();
    else if (a === 'next') player.next();
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

  player.addEventListener('track', onTrack);
  player.addEventListener('state', onState);
  player.addEventListener('time', onTime);
  store.on('playlists', onFav);
  w.addEventListener('pagehide', () => {
    player.removeEventListener('track', onTrack);
    player.removeEventListener('state', onState);
    player.removeEventListener('time', onTime);
    store.off('playlists', onFav);
    pip = null;
  });
  onTrack();
  onState();
  onTime();
}
