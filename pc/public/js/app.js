// 시작 · 화면 이동 · 실시간 알림 · 단축키
import { get, post, subscribe } from './api.js';
import { ctx } from './ctx.js';
import { icon } from './icons.js';
import { Player } from './player.js';
import { store } from './store.js';
import { $, debounce } from './util.js';
import { markPlaying, noCover, reloadPlaylists } from './ui/common.js';
import { openMenu, toast } from './ui/dom.js';
import { closeNp, initNowPlaying, isNpOpen, openNp, retint, showPhoneChip, sleepDialog } from './ui/nowplaying.js';
import { bindSettingsEvents, onScanProgress, settingsView } from './ui/settings.js';
import { bindSelectionBar, bindViewEvents, clearSelection, views } from './ui/views.js';

const MAIN_TABS = ['tracks', 'playlists', 'albums', 'artists', 'folders'];
const allViews = { ...views, settings: settingsView };
let renderToken = 0;
let navDepth = 0;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'tracks';
  const i = h.indexOf('/');
  const name = i < 0 ? h : h.slice(0, i);
  let param = i < 0 ? null : h.slice(i + 1);
  try {
    param = param === null ? null : decodeURIComponent(param);
  } catch {
    param = null;
  }
  return { name: allViews[name] ? name : 'tracks', param };
}

async function render({ keepScroll = false } = {}) {
  const r = parseHash();
  const sameRoute = ctx.route && ctx.route.name === r.name && ctx.route.param === r.param;
  ctx.route = r;
  if (r.name !== 'playlist') ctx.editing = null;
  if (!sameRoute) clearSelection(false);
  const main = $('#main');
  const top = main.scrollTop;
  const token = ++renderToken;
  const info = (await allViews[r.name]($('#view'), r.param)) || {};
  if (token !== renderToken) return;
  applyChrome(r, info);
  markPlaying($('#view'));
  main.scrollTop = keepScroll ? top : 0;
  onScroll();
}

function applyChrome(r, info) {
  const isMain = MAIN_TABS.includes(r.name);
  $('#tabs').hidden = !isMain;
  $('#back').hidden = isMain;
  for (const a of document.querySelectorAll('#tabs .tab')) a.classList.toggle('active', a.dataset.tab === r.name);
  const title = $('#bar-title');
  title.textContent = isMain ? '음악' : info.title || '';
  title.classList.toggle('fade', !!info.detail); // 상세 화면은 큰 제목을 지나 스크롤하면 위에 제목이 나타남 (One UI)
  title.hidden = !!info.search;
  $('#searchbox').hidden = !info.search;
  $('#btn-search').hidden = !!info.search;
  if (info.search) {
    const inp = $('#search-input');
    if (document.activeElement !== inp) {
      inp.value = r.param || '';
      inp.focus();
    }
  }
}

function onScroll() {
  const top = $('#main').scrollTop;
  $('#appbar').classList.toggle('scrolled', top > 4);
  $('#appbar').classList.toggle('past-hero', top > 170);
}

function go(hash) {
  if (isNpOpen()) closeNp();
  if (location.hash === hash) render();
  else location.hash = hash;
}

function back() {
  if (navDepth > 0) history.back();
  else go('#/tracks');
}

function refreshIf(...names) {
  if (names.includes(ctx.route?.name)) render({ keepScroll: true });
}

function applyTheme() {
  const t = store.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  retint();
}

function initShell() {
  $('#back').innerHTML = icon('back');
  $('#btn-search').innerHTML = icon('search');
  $('#btn-more').innerHTML = icon('more');
  $('#search-icon').innerHTML = icon('search');
  $('#main').addEventListener('scroll', onScroll, { passive: true });
  $('#back').addEventListener('click', back);
  $('#btn-search').addEventListener('click', () => go('#/search'));
  $('#btn-more').addEventListener('click', (e) => openAppMenu(e.currentTarget));
  $('#search-input').addEventListener(
    'input',
    debounce((e) => {
      history.replaceState(history.state, '', `#/search/${encodeURIComponent(e.target.value)}`);
      render({ keepScroll: false });
    }, 120),
  );
  bindViewEvents($('#view'));
  bindSettingsEvents($('#view'));
  bindSelectionBar();

  // 커버가 없으면 이미지를 빼서 기본 음표 그림이 보이게
  document.addEventListener(
    'error',
    (e) => {
      if (e.target.tagName !== 'IMG' || !e.target.hasAttribute('data-cover')) return;
      noCover.add(e.target.dataset.cover);
      e.target.remove();
    },
    true,
  );

  window.addEventListener('hashchange', () => {
    navDepth++;
    render();
  });

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select, [contenteditable]') && e.target.type !== 'range';
    if (e.key === 'Escape') {
      if ($('#dialog').open || !$('#menu').hidden) return;
      if (ctx.selection.size) return clearSelection();
      if (isNpOpen()) return closeNp();
      if (ctx.route?.name === 'search') return back();
      return undefined;
    }
    if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (!typing && e.key === '/')) {
      e.preventDefault();
      return go('#/search');
    }
    if (typing) return undefined;
    const p = ctx.player;
    if (e.code === 'Space') {
      e.preventDefault();
      return p.toggle();
    }
    if (e.ctrlKey && e.key === 'ArrowRight') return p.next();
    if (e.ctrlKey && e.key === 'ArrowLeft') return p.prev();
    if (e.ctrlKey && e.key === 'ArrowUp') return p.setVolume(p.audio.volume + 0.05);
    if (e.ctrlKey && e.key === 'ArrowDown') return p.setVolume(p.audio.volume - 0.05);
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      return toast(p.toggleShuffle() ? '셔플 켜짐' : '셔플 꺼짐', 1300);
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      return toast({ off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' }[p.cycleRepeat()], 1300);
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      return isNpOpen() ? closeNp() : openNp();
    }
    return undefined;
  });
}

function openAppMenu(anchor) {
  openMenu(
    [
      { icon: 'phone', label: '휴대폰 동기화', run: () => go('#/settings') },
      { icon: 'moon', label: '수면 타이머', run: () => sleepDialog() },
      {
        icon: 'sync',
        label: '음악 폴더 다시 검색',
        run: () => post('/api/library/rescan').then(() => toast('음악 폴더를 다시 검색해요')),
      },
      '-',
      { icon: 'settings', label: '설정', run: () => go('#/settings') },
    ],
    { anchor },
  );
}

function connectEvents() {
  let offlineTimer = null;
  const es = subscribe({
    library: debounce(async () => {
      noCover.clear(); // 새 커버가 생겼을 수 있음
      const { tracks, scan } = await get('/api/library');
      store.setTracks(tracks);
      store.scan = scan;
      ctx.player.libraryChanged();
      if (ctx.route?.name !== 'settings') render({ keepScroll: true });
    }, 400),
    playlists: debounce(() => reloadPlaylists(), 250),
    track: (t) => store.updateTrack(t),
    scan: (s) => {
      store.scan = s;
      onScanProgress(s);
    },
    settings: (s) => {
      store.settings = s;
      applyTheme();
    },
    pairing: () => refreshIf('settings'),
    devices: () => refreshIf('settings'),
    synclog: (entry) => {
      refreshIf('settings');
      if (/연결됨|동기화 완료/.test(entry.msg)) toast(entry.msg, 3500);
    },
    nowplaying: (np) => {
      showPhoneChip(np);
      refreshIf('settings');
    },
  });
  es.addEventListener('open', () => {
    clearTimeout(offlineTimer);
    offlineTimer = null;
  });
  es.addEventListener('error', () => {
    offlineTimer ??= setTimeout(() => toast('SyncMusic 서버에 연결할 수 없어요. 프로그램을 다시 실행해 주세요.', 8000), 5000);
  });
}

async function boot() {
  const b = await get('/api/bootstrap');
  store.app = b.app;
  store.settings = b.settings;
  store.scan = b.scan;
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retint);
  store.setTracks(b.tracks);
  store.setPlaylists(b.playlists);

  const player = new Player();
  ctx.player = player;
  ctx.go = go;
  ctx.refresh = (opts) => render(opts);
  initShell();
  initNowPlaying(player);
  player.restore(b.state);

  store.on('playlists', () => refreshIf('playlists', 'playlist'));
  store.on('track', debounce(() => refreshIf('smart'), 500));
  store.on('settings', applyTheme);

  await render();
  connectEvents();
  get('/api/sync/status')
    .then((s) => showPhoneChip(s.nowPlaying))
    .catch(() => {});
  if (!store.list.length && store.scan?.scanning) toast('음악 폴더를 검색하는 중이에요…', 3000);
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div class="empty" style="padding-top:30vh"><h3>SyncMusic을 시작하지 못했어요</h3><p>${String(e.message || e)}</p></div>`;
});
