// 시작 · 화면 이동 · 실시간 알림 · 단축키 · 이어 듣기 · 수면 타이머 끝난 뒤 · 화면 꺼짐 막기 · 오류 기록
import { get, post, subscribe } from './api.js';
import { ctx } from './ctx.js';
import { icon } from './icons.js';
import { Player } from './player.js';
import { store } from './store.js';
import { $, debounce, esc, fmtTime } from './util.js';
import { initLite, liteActive } from './lite.js';
import { checkLetterbox, markPlaying, noCover, reloadPlaylists } from './ui/common.js';
import { applyLayout, firstTab, setLite } from './ui/design.js';
import { openMenu, showNotice, toast } from './ui/dom.js';
import { onKeydown, shortcutsDialog } from './ui/keys.js';
import { lyricsSettingsChanged } from './ui/lyrics.js';
import { closeNp, initNowPlaying, isNpOpen, openNp, retint, showPhoneChip, sleepDialog } from './ui/nowplaying.js';
import { openPip } from './ui/pip.js';
import { bindSettingsEvents, onScanProgress, settingsView } from './ui/settings.js';
import { bindStatsEvents, statsView, wrappedView } from './ui/stats.js';
import { bindToolsEvents, errorsView, toolsView } from './ui/tools.js';
import { bindSelectionBar, bindViewEvents, clearSelection, recordSearch, views } from './ui/views.js';

const MAIN_TABS = ['tracks', 'playlists', 'albums', 'artists', 'folders'];
const allViews = { ...views, settings: settingsView, stats: statsView, wrapped: wrappedView, tools: toolsView, errors: errorsView };
let renderToken = 0;
let navDepth = 0;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || firstTab();
  const i = h.indexOf('/');
  const name = i < 0 ? h : h.slice(0, i);
  let param = i < 0 ? null : h.slice(i + 1);
  try {
    param = param === null ? null : decodeURIComponent(param);
  } catch {
    param = null;
  }
  return { name: allViews[name] ? name : firstTab(), param };
}

async function render({ keepScroll = false } = {}) {
  const r = parseHash();
  const sameRoute = ctx.route && ctx.route.name === r.name && ctx.route.param === r.param;
  ctx.route = r;
  ctx.groups = {};
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
  else go(`#/${firstTab()}`);
}

function refreshIf(...names) {
  if (names.includes(ctx.route?.name)) render({ keepScroll: true });
}

function applyTheme() {
  const t = store.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  retint();
  applyLayout();
}

// ───── 화면에서 난 오류를 기록 화면(#/errors)에 남긴다 (너무 많으면 그만) ─────
let errorsSent = 0;
function reportError(message, detail) {
  if (!message || errorsSent++ > 30) return;
  post('/api/errors', { source: 'ui', message: String(message).slice(0, 300), detail: String(detail || '').slice(0, 3000), context: { route: location.hash } }).catch(() => {});
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
  const remember = debounce((q) => recordSearch(q), 3000); // 잠깐 멈추면 검색 기록에
  $('#search-input').addEventListener(
    'input',
    debounce((e) => {
      history.replaceState(history.state, '', `#/search/${encodeURIComponent(e.target.value)}`);
      render({ keepScroll: false });
      remember(e.target.value);
    }, 120),
  );
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') remember.flush(e.target.value);
  });
  bindViewEvents($('#view'));
  bindSettingsEvents($('#view'));
  bindToolsEvents($('#view'));
  bindStatsEvents($('#view'));
  bindSelectionBar();

  document.addEventListener(
    'load',
    (e) => {
      if (e.target.tagName === 'IMG' && e.target.hasAttribute('data-cover')) checkLetterbox(e.target);
    },
    true,
  );
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
  // 다른 창을 보고 있으면 목록의 '재생 중' 막대 애니메이션을 멈춘다 (작아도 화면을 매 프레임 다시 그리게 함)
  const focusClass = () => document.body.classList.toggle('unfocused', !document.hasFocus());
  addEventListener('focus', focusClass);
  addEventListener('blur', focusClass);
  focusClass();
  window.addEventListener('error', (e) => reportError(e.message, e.error?.stack || `${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.message || String(e.reason), e.reason?.stack));

  window.addEventListener('hashchange', () => {
    navDepth++;
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#dialog').open || !$('#menu').hidden) return undefined;
      if (document.activeElement?.closest?.('#view .row, #view .album-card')) return document.activeElement.blur();
      if (ctx.selection.size) return clearSelection();
      if (isNpOpen()) return closeNp();
      if (ctx.route?.name === 'search') return back();
      return undefined;
    }
    return onKeydown(e);
  });
}

function openAppMenu(anchor) {
  openMenu(
    [
      { icon: 'phone', label: '휴대폰 동기화', run: () => go('#/settings') },
      { icon: 'moon', label: '수면 타이머', run: () => sleepDialog() },
      { icon: 'eq', label: '사운드 (이퀄라이저)', run: () => openNp('sound') },
      { icon: 'palette', label: '디자인 꾸미기', run: () => openNp('design') },
      { icon: 'pip', label: '작은 창 (항상 위)', run: () => openPip(ctx.player) },
      { icon: 'power', label: liteActive() ? '저사양 모드 끄기' : '저사양 모드 켜기', run: () => setLite(liteActive() ? 'off' : 'on') },
      '-',
      { icon: 'chart', label: '통계', run: () => go('#/stats') },
      { icon: 'tools', label: '라이브러리 도구', run: () => go('#/tools') },
      {
        icon: 'sync',
        label: '음악 폴더 다시 검색',
        run: () => post('/api/library/rescan').then(() => toast('음악 폴더를 다시 검색해요')),
      },
      { icon: 'keyboard', label: '단축키', run: () => shortcutsDialog(true) },
      '-',
      { icon: 'settings', label: '설정', run: () => go('#/settings') },
    ],
    { anchor },
  );
}

// ───── 수면 타이머가 끝난 뒤: 설정 → 전원 (앱 종료 · PC 절전 · PC 끄기). 30초 동안 취소할 수 있다 ─────
const POWER_TEXT = { quit: 'SyncMusic을 종료해요', sleep: 'PC를 절전 모드로 바꿔요', shutdown: 'PC를 꺼요' };
function onSlept() {
  const act = store.settings.power?.sleepAction || 'pause';
  if (!POWER_TEXT[act]) return;
  let left = 30;
  let timer = 0;
  const text = () => `수면 타이머 끝 · <b>${left}초</b> 뒤에 ${POWER_TEXT[act]}`;
  const n = showNotice({
    icon: 'moon',
    html: text(),
    actions: [{ label: '취소', primary: true, run: () => clearInterval(timer) }],
    onClose: () => clearInterval(timer),
  });
  timer = setInterval(async () => {
    left--;
    if (left > 0) return n.update(text());
    clearInterval(timer);
    n.close();
    ctx.player.save();
    try {
      if (act === 'quit') {
        await post('/api/system/quit');
        document.body.innerHTML = '<div class="empty" style="padding-top:30vh"><h3>수면 타이머로 SyncMusic을 종료했어요</h3><p>이 창을 닫아도 돼요.</p></div>';
      } else await post('/api/system/power', { action: act });
    } catch (e) {
      toast(e.message, 5000);
    }
  }, 1000);
}

// ───── 재생 중에는 화면이 꺼지지 않게 (설정 → 전원). 창이 보이는 동안만 ─────
let wakeLock = null;
async function updateWakeLock() {
  const want = !!store.settings.power?.keepAwake && ctx.player?.playing && document.visibilityState === 'visible';
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null; // 배터리 절약 모드 등에서는 거절될 수 있음
    }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// ───── 지난번에 듣던 곡 이어 듣기 (재생 중에 창을 닫았거나 PC가 꺼졌을 때) ─────
// 업데이트로 창이 방금 새로 고쳐졌으면(듣는 중이었으면) 바로 이어서 튼다. 브라우저가 막으면 알림으로
async function offerResume(saved) {
  const p = ctx.player;
  const t = p.track;
  if (!saved?.playing || !t) return;
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav?.type === 'reload' && Date.now() - (saved.savedAt || 0) < 20_000) {
    try {
      await p.engine.play();
      return;
    } catch {
      // 자동 재생이 막힘 → 아래 알림으로
    }
  }
  const n = showNotice({
    icon: 'history',
    html: `지난번에 듣던 곡 · <b>${esc(t.title)}</b> ${fmtTime(saved.positionSec || 0)}부터`,
    actions: [{ label: '이어 듣기', primary: true, run: () => p.toggle() }],
    timeout: 25_000,
  });
  const onState = () => {
    if (!p.playing) return;
    n.close();
    p.removeEventListener('state', onState);
  };
  p.addEventListener('state', onState);
}

// ───── 새 버전 알림 ─────
let updateShown = false;
function offerUpdate(u) {
  if (!u?.available || updateShown || store.settings.updateCheck === false) return;
  updateShown = true;
  showNotice({
    icon: 'update',
    html: `SyncMusic 새 버전이 있어요 · <b>${u.count}개</b> 바뀜`,
    actions: [{ label: '보기', primary: true, run: () => go('#/settings') }],
    timeout: 20_000,
  });
}

// ───── 출력 장치가 바뀌면 (헤드폰 연결 등) 그 장치에서 쓰던 음량으로 ─────
function onAudioDevice(d) {
  const prev = ctx.player.device;
  ctx.player.setDevice(d);
  if (prev && d && prev.id !== d.id) toast(`출력 장치: ${d.name}`, 2500);
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
      lyricsSettingsChanged();
      updateWakeLock();
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
    syncpreview: (p) => {
      refreshIf('settings');
      showNotice({
        icon: 'sync',
        html: `<b>${esc(p.deviceName)}</b> 동기화 전에 확인이 필요해요 · 받을 곡 ${p.upload.length} · 보낼 곡 ${p.download.length} · 재생목록 ${p.playlists.length}`,
        actions: [{ label: '확인하기', primary: true, run: () => go('#/settings') }],
      });
    },
    audiodevice: onAudioDevice,
    update: offerUpdate,
  });
  es.addEventListener('open', () => {
    clearTimeout(offlineTimer);
    offlineTimer = null;
    // 서버가 새 버전으로 다시 켜졌으면(화면 파일이 바뀜) 열려 있던 창도 새로 고친다. 듣던 곡·위치는 저장돼 있음
    get('/api/ping')
      .then((p) => {
        if (p.build && store.app.build && p.build !== store.app.build) {
          ctx.player.save(true);
          location.reload();
        }
      })
      .catch(() => {});
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
  await initLite(); // 노트북이면 전원 연결 여부 (저사양 모드 '배터리일 때만')
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
  player.addEventListener('slept', onSlept);
  player.addEventListener('state', updateWakeLock);
  document.addEventListener('visibilitychange', updateWakeLock);
  store.on('power', updateWakeLock);

  store.on('playlists', () => refreshIf('playlists', 'playlist'));
  store.on('track', debounce(() => refreshIf('smart'), 500));
  store.on('settings', applyTheme);

  await render();
  connectEvents();
  offerResume(b.state);
  get('/api/system/audiodevice')
    .then((d) => d.current && player.setDevice(d.current))
    .catch(() => {});
  get('/api/system/update')
    .then(offerUpdate)
    .catch(() => {});
  get('/api/sync/status')
    .then((s) => showPhoneChip(s.nowPlaying))
    .catch(() => {});
  if (!store.list.length && store.scan?.scanning) toast('음악 폴더를 검색하는 중이에요…', 3000);
}

boot().catch((e) => {
  console.error(e);
  reportError(`시작 실패: ${e.message || e}`, e.stack);
  document.body.innerHTML = `<div class="empty" style="padding-top:30vh"><h3>SyncMusic을 시작하지 못했어요</h3><p>${esc(String(e.message || e))}</p></div>`;
});
