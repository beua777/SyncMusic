// 탭과 상세 화면: 트랙 · 재생목록 · 앨범 · 아티스트 · 폴더 · 검색
import { del, get, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { phoneticKey } from '../phonetic.js';
import { applyFilter, FIELDS, fuzzySearch, OPS, parseNatural } from '../search.js';
import { store } from '../store.js';
import { $, collator, esc, fmtAgo, fmtTotal, matchQuery, normSearch } from '../util.js';
import {
  addToPlaylistDialog,
  coverImg,
  markPlaying,
  newPlaylist,
  playlistArt,
  reloadPlaylists,
  removeFromPlaylist,
  showTrackMenu,
  splitEntries,
  trackRow,
} from './common.js';
import { changeCover, resetCover } from './details.js';
import { confirmDialog, openMenu, promptText, sortable, toast } from './dom.js';
import { dedupeDialog, modeLabel, playlistHistoryDialog, playlistModeDialog, playlistStyleDialog, trashDialog } from './playlistTools.js';

const pref = {
  get(k, d) {
    try {
      return localStorage.getItem(`sm.${k}`) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`sm.${k}`, v);
    } catch {
      // 저장 못 해도 동작에는 문제 없음
    }
  },
};

const TRACK_SORTS = { title: '제목', artist: '아티스트', album: '앨범', added: '추가한 날짜' };
const ALBUM_SORTS = { name: '앨범 이름', artist: '아티스트', year: '연도' };
const SMART = {
  recent: { name: '최근 추가', icon: 'clock', color: '#3e8cf0', empty: '아직 추가된 곡이 없어요' },
  most: { name: '가장 많이 재생', icon: 'bars', color: '#ff9330', empty: '30초 넘게 들은 곡이 여기에 모여요' },
  history: { name: '최근 재생', icon: 'history', color: '#22b07d', empty: '들은 곡이 여기에 모여요' },
};

function sortTracks(list, by) {
  const a = [...list];
  if (by === 'artist') a.sort((x, y) => collator.compare(x.artist, y.artist) || collator.compare(x.title, y.title));
  else if (by === 'album') a.sort((x, y) => collator.compare(x.album, y.album) || (x.trackNo || 0) - (y.trackNo || 0));
  else if (by === 'added') a.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
  else a.sort((x, y) => collator.compare(x.title, y.title));
  return a;
}

const setList = (tracks, source) => {
  ctx.list = { ids: tracks.map((t) => t.id), source };
};

const listHead = (count, right = '') =>
  `<div class="list-head"><button class="btn shuffle-all" data-act="shuffle-list">${icon('shuffle')}셔플 재생</button><span class="count">${count}</span><span class="spacer"></span>${right}</div>`;

const emptyLibrary = () =>
  `<div class="empty">${icon('note')}<h3>음악이 없어요</h3><p>설정에서 음악 폴더를 추가하거나<br>폰과 연결해서 음악을 가져오세요.</p><a class="btn primary" href="#/settings">${icon('settings')}설정 열기</a></div>`;

const notFound = (what, back) =>
  `<div class="empty">${icon('info')}<h3>${what}을(를) 찾을 수 없어요</h3><p>곡이 옮겨졌거나 지워졌을 수 있어요.</p><a class="btn" href="${back}">돌아가기</a></div>`;

const albumCard = (a) =>
  `<div class="album-card" data-album="${esc(a.key)}" tabindex="0"><div class="cover">${coverImg(a.coverId)}<button class="play-fab" data-act="play-album" aria-label="${esc(a.name)} 재생">${icon('play')}</button></div><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.artist)}${a.year ? ` · ${a.year}` : ''}</div></div>`;

const artistRow = (ar) =>
  `<div class="row artist" data-artist="${esc(ar.name)}"><div class="thumb round">${coverImg(ar.coverId)}</div><div class="meta"><div class="title">${esc(ar.name)}</div><div class="sub">앨범 ${ar.albums.length}개 · 트랙 ${ar.tracks.length}곡</div></div><div class="trail"><button class="icon-btn" data-act="play-artist" aria-label="셔플 재생">${icon('shuffle')}</button></div></div>`;

const folderRow = (f) =>
  `<div class="row folder" data-dir="${esc(f.dir)}"><div class="thumb folder-icon">${icon('folder')}</div><div class="meta"><div class="title">${esc(f.name)}</div><div class="sub">${f.tracks.length}곡 · ${esc(f.dir)}</div></div><div class="trail"><button class="icon-btn" data-act="play-folder" aria-label="셔플 재생">${icon('shuffle')}</button></div></div>`;

const playlistRow = (p) => {
  const mode = modeLabel(p.mode);
  return `<div class="row pl" data-pl="${p.id}">${playlistArt(p)}<div class="meta"><div class="title">${esc(p.name)}</div><div class="sub">${p.entries.length}곡${p.origin === 'phone' ? ' · 폰에서 가져옴' : ''}${mode ? ` · ${mode}` : ''}</div></div><div class="trail">${p.syncToPhone ? `<span class="badge">${icon('phone')}동기화</span>` : ''}<button class="icon-btn" data-act="pl-more" aria-label="더 보기">${icon('more')}</button></div></div>`;
};

function hero({ cover, kicker, title, sub, actions }) {
  return `<div class="hero">${cover}<div class="hero-info"><div class="hero-kicker">${kicker}</div><h2>${esc(title)}</h2><div class="hero-sub">${sub}</div><div class="hero-actions">${actions}</div></div></div>`;
}

const playButtons = (extra = '') =>
  `<button class="btn primary" data-act="play-list">${icon('play')}재생</button><button class="btn" data-act="shuffle-list">${icon('shuffle')}셔플</button>${extra}`;

// ───────── 탭 ─────────

function tracksView(el) {
  if (!store.list.length) {
    setList([], null);
    el.innerHTML = emptyLibrary();
    return {};
  }
  const by = pref.get('sort.tracks', 'title');
  const list = sortTracks(store.list, by);
  setList(list, { type: 'all', name: '전체 트랙' });
  el.innerHTML = `${listHead(`${list.length}곡`, `<button class="sort-btn" data-act="sort-tracks">${icon('sort')}${TRACK_SORTS[by] || '제목'}</button>`)}
<div class="card list">${list.map((t, i) => trackRow(t, i)).join('')}</div>`;
  return {};
}

function albumsView(el) {
  if (!store.albums.length) {
    setList([], null);
    el.innerHTML = emptyLibrary();
    return {};
  }
  const by = pref.get('sort.albums', 'name');
  const list = [...store.albums];
  if (by === 'artist') list.sort((x, y) => collator.compare(x.artist, y.artist) || collator.compare(x.name, y.name));
  if (by === 'year') list.sort((x, y) => (y.year || 0) - (x.year || 0) || collator.compare(x.name, y.name));
  setList(list.flatMap((a) => a.tracks), { type: 'albums', name: '모든 앨범' });
  el.innerHTML = `<div class="list-head"><button class="btn shuffle-all" data-act="shuffle-list">${icon('shuffle')}셔플 재생</button><span class="count">앨범 ${list.length}개</span><span class="spacer"></span><button class="sort-btn" data-act="sort-albums">${icon('sort')}${ALBUM_SORTS[by] || '앨범 이름'}</button></div>
<div class="grid">${list.map(albumCard).join('')}</div>`;
  return {};
}

function artistsView(el) {
  if (!store.artists.length) {
    setList([], null);
    el.innerHTML = emptyLibrary();
    return {};
  }
  setList(store.list, { type: 'all', name: '전체 트랙' });
  el.innerHTML = `${listHead(`아티스트 ${store.artists.length}명`)}<div class="card">${store.artists.map(artistRow).join('')}</div>`;
  return {};
}

function foldersView(el) {
  if (!store.folders.length) {
    setList([], null);
    el.innerHTML = emptyLibrary();
    return {};
  }
  setList(store.list, { type: 'all', name: '전체 트랙' });
  el.innerHTML = `${listHead(`폴더 ${store.folders.length}개`)}<div class="card">${store.folders.map(folderRow).join('')}</div>`;
  return {};
}

function playlistsView(el) {
  const user = store.playlists.filter((p) => !p.system);
  const favCount = splitEntries(store.favorites?.entries || []).visible.length;
  const tiles = [
    { href: '#/playlist/favorites', name: '즐겨찾기', sub: `${favCount}곡`, icon: 'heartFill', color: '#f0445a' },
    ...Object.entries(SMART).map(([k, s]) => ({ href: `#/smart/${k}`, name: s.name, sub: `${store.smart(k).length}곡`, icon: s.icon, color: s.color })),
  ];
  setList([], null);
  el.innerHTML = `<div class="list-head">
  <button class="btn" data-act="new-playlist">${icon('plus')}재생목록 만들기</button>
  <button class="btn" data-act="import-playlist">${icon('import')}가져오기</button>
  <input type="file" id="import-file" accept=".m3u,.m3u8,.smpl" multiple hidden>
  <span class="spacer"></span>
  <button class="sort-btn" data-act="pl-trash">${icon('trash')}지운 재생목록</button>
</div>
<div class="section-title">기본 재생목록</div>
<div class="tiles">${tiles
    .map(
      (t) =>
        `<a class="tile" href="${t.href}"><span class="tile-icon" style="background:${t.color}">${icon(t.icon)}</span><span class="tile-text"><span class="tile-name">${t.name}</span><span class="tile-sub">${t.sub}</span></span></a>`,
    )
    .join('')}</div>
<div class="section-title">내 재생목록 · ${user.length}개</div>
${
  user.length
    ? `<div class="card">${user.map(playlistRow).join('')}</div>`
    : `<div class="card"><div class="empty compact"><p>아직 재생목록이 없어요.<br>폰과 동기화하면 삼성 뮤직 재생목록이 순서 그대로 들어와요.</p></div></div>`
}`;
  return {};
}

// ───────── 상세 ─────────

function albumView(el, key) {
  const a = store.albumByKey.get(key);
  if (!a) {
    setList([], null);
    el.innerHTML = notFound('앨범', '#/albums');
    return { title: '앨범', detail: true };
  }
  setList(a.tracks, { type: 'album', id: key, name: a.name });
  const multiDisc = new Set(a.tracks.map((t) => t.discNo || 1)).size > 1;
  let rows = '';
  let disc = null;
  a.tracks.forEach((t, i) => {
    if (multiDisc && (t.discNo || 1) !== disc) {
      disc = t.discNo || 1;
      rows += `<div class="section-title disc">디스크 ${disc}</div>`;
    }
    rows += trackRow(t, i, { mode: 'album' });
  });
  const artistLink = store.artistByName.has(a.artist) ? `<a href="#/artist/${encodeURIComponent(a.artist)}">${esc(a.artist)}</a>` : esc(a.artist);
  el.innerHTML = `${hero({
    cover: `<div class="cover">${coverImg(a.coverId)}</div>`,
    kicker: '앨범',
    title: a.name,
    sub: `${artistLink}${a.year ? ` · ${a.year}` : ''} · ${a.tracks.length}곡 · ${fmtTotal(a.duration)}`,
    actions: playButtons(
      `<button class="btn" data-act="add-list">${icon('plus')}재생목록에 추가</button><button class="icon-btn" data-act="list-more" aria-label="더 보기">${icon('more')}</button>`,
    ),
  })}<div class="card list">${rows}</div>`;
  return { title: a.name, detail: true };
}

function artistView(el, name) {
  const ar = store.artistByName.get(name);
  if (!ar) {
    setList([], null);
    el.innerHTML = notFound('아티스트', '#/artists');
    return { title: '아티스트', detail: true };
  }
  setList(ar.tracks, { type: 'artist', id: name, name });
  el.innerHTML = `${hero({
    cover: `<div class="cover round">${coverImg(ar.coverId)}</div>`,
    kicker: '아티스트',
    title: ar.name,
    sub: `앨범 ${ar.albums.length}개 · 트랙 ${ar.tracks.length}곡`,
    actions: playButtons(`<button class="btn" data-act="add-list">${icon('plus')}재생목록에 추가</button>`),
  })}
<div class="section-title">앨범</div><div class="grid">${ar.albums.map(albumCard).join('')}</div>
<div class="section-title">트랙 · ${ar.tracks.length}곡</div><div class="card list">${ar.tracks.map((t, i) => trackRow(t, i, { sub: t.album })).join('')}</div>`;
  return { title: ar.name, detail: true };
}

function folderView(el, dir) {
  const f = store.folderByDir.get(dir);
  if (!f) {
    setList([], null);
    el.innerHTML = notFound('폴더', '#/folders');
    return { title: '폴더', detail: true };
  }
  setList(f.tracks, { type: 'folder', id: dir, name: f.name });
  el.innerHTML = `${hero({
    cover: `<div class="cover solid folder-icon">${icon('folder')}</div>`,
    kicker: '폴더',
    title: f.name,
    sub: `${esc(f.dir)} · ${f.tracks.length}곡`,
    actions: playButtons(
      `<button class="btn" data-act="add-list">${icon('plus')}재생목록에 추가</button><button class="btn" data-act="reveal-folder">${icon('folderOpen')}탐색기에서 열기</button>`,
    ),
  })}<div class="card list">${f.tracks.map((t, i) => trackRow(t, i)).join('')}</div>`;
  return { title: f.name, detail: true };
}

function playlistView(el, id) {
  const p = store.playlist(id);
  if (!p) {
    setList([], null);
    el.innerHTML = notFound('재생목록', '#/playlists');
    return { title: '재생목록', detail: true };
  }
  const editing = ctx.editing === id;
  const { visible, missing } = splitEntries(p.entries);
  const tracks = visible.map((x) => store.tracks.get(x));
  setList(tracks, { type: 'playlist', id, name: p.name });
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const cover = p.id === 'favorites' ? `<div class="cover solid" style="background:#f0445a;color:#fff">${icon('heartFill')}</div>` : playlistArt(p, 'cover');
  const sync = p.system ? '' : p.syncToPhone ? ` · ${icon('phone')} 폰과 동기화 켜짐` : ' · 폰 동기화 꺼짐';
  const mode = modeLabel(p.mode);
  el.innerHTML = `${hero({
    cover,
    kicker: p.system ? '기본 재생목록' : p.origin === 'phone' ? '재생목록 · 폰에서 가져옴' : '재생목록',
    title: p.name,
    sub: `${tracks.length}곡 · ${fmtTotal(total)}${missing.length ? ` · 아직 PC에 없는 곡 ${missing.length}개` : ''}${sync}${mode ? ` · ${mode}` : ''}`,
    actions: playButtons(
      `${tracks.length ? `<button class="btn${editing ? ' primary' : ''}" data-act="edit-playlist">${icon(editing ? 'check' : 'edit')}${editing ? '완료' : '순서 편집'}</button>` : ''}<button class="icon-btn" data-act="pl-more" data-pl="${p.id}" aria-label="더 보기">${icon('more')}</button>`,
    ),
  })}
${
  tracks.length
    ? `<div class="card list" id="pl-list">${tracks.map((t, i) => trackRow(t, i, { mode: editing ? 'edit' : 'list' })).join('')}</div>`
    : `<div class="card"><div class="empty compact"><p>곡이 없어요. 곡의 ⋮ 메뉴에서 "재생목록에 추가"를 눌러 보세요.</p></div></div>`
}`;
  if (editing) sortable($('#pl-list'), { onMove: (from, to) => movePlaylistEntry(id, from, to) });
  return { title: p.name, detail: true };
}

function smartView(el, kind) {
  const s = SMART[kind];
  if (!s) {
    setList([], null);
    el.innerHTML = notFound('재생목록', '#/playlists');
    return { title: '재생목록', detail: true };
  }
  const tracks = store.smart(kind);
  setList(tracks, { type: 'smart', id: kind, name: s.name });
  const sub = (t) =>
    kind === 'most' ? `${t.artist} · ${t.playCount}회` : kind === 'history' ? `${t.artist} · ${fmtAgo(t.lastPlayed)}` : `${t.artist} · ${fmtAgo(t.addedAt)}`;
  el.innerHTML = `${hero({
    cover: `<div class="cover solid" style="background:${s.color};color:#fff">${icon(s.icon)}</div>`,
    kicker: '기본 재생목록',
    title: s.name,
    sub: `${tracks.length}곡 · 최대 100곡까지 자동으로 모여요`,
    actions: tracks.length ? playButtons(`<button class="btn" data-act="add-list">${icon('plus')}재생목록에 추가</button>`) : '',
  })}
${tracks.length ? `<div class="card list">${tracks.map((t, i) => trackRow(t, i, { sub: sub(t) })).join('')}</div>` : `<div class="card"><div class="empty compact"><p>${s.empty}</p></div></div>`}`;
  return { title: s.name, detail: true };
}

// ───────── 검색 ─────────
// 글자 그대로 · 초성 · 소리(가나·한글·로마자·한자 읽기) · 자연어("최근 추가한 일본 노래 10곡") · 고급 필터 · 가사 · 오타 허용

const EXAMPLES = ['최근 추가한 일본 노래', '많이 들은 곡 20곡', '3분 이하 짧은 곡', '가사 있는 즐겨찾기', '오래 안 들은 곡', '90년대', '무손실', '자주 넘긴 곡'];
let filter = null; // 고급 필터 { match, rules, sort, limit }
let filterOpen = false;
let lastNl = null;
let lyricsTimer = 0;
let lyricsToken = 0;

const emptyFilter = () => ({ match: 'all', rules: [], sort: null, limit: 0 });

// 값을 다 채운 조건만 쓴다
function validRule(r) {
  const f = FIELDS[r.field];
  if (!f || !OPS[f.type]?.[r.op]) return false;
  if (f.type === 'bool' || (f.type === 'date' && r.op === 'never')) return true;
  if (r.op === 'between') return Array.isArray(r.value) && r.value.length === 2 && r.value.every((x) => x !== '' && x !== null && Number.isFinite(Number(x)));
  if (f.type === 'number' || f.type === 'date') return r.value !== '' && r.value !== null && r.value !== undefined && Number.isFinite(Number(r.value));
  return String(r.value ?? '').trim() !== '';
}

const activeFilter = () => (filter ? { ...filter, rules: filter.rules.filter(validRule) } : null);
const hasFilter = () => {
  const f = activeFilter();
  return !!f && (f.rules.length > 0 || !!f.sort?.by || f.limit > 0);
};

function filterCtx() {
  const inPl = new Set(store.playlists.filter((p) => !p.system).flatMap((p) => p.entries));
  return { isFavorite: (id) => store.isFavorite(id), inPlaylist: (id) => inPl.has(id), now: Date.now() };
}

// 설정 화면 등에서: 이 필터로 검색 화면 열기
export function searchWithFilter(f) {
  filter = { ...emptyFilter(), ...structuredClone(f) };
  filterOpen = true;
  ctx.go('#/search');
}

const defaultValue = (field, op) => {
  const t = FIELDS[field].type;
  if (t === 'bool') return true;
  if (t === 'enum') return Object.keys(FIELDS[field].values)[0];
  if (op === 'between') return ['', ''];
  return '';
};

function filterBox() {
  const f = filter || emptyFilter();
  const fieldOpts = (sel) => Object.entries(FIELDS).map(([k, x]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${x.label}</option>`).join('');
  const opOpts = (field, sel) =>
    Object.entries(OPS[FIELDS[field].type])
      .map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`)
      .join('');
  const value = (r, i) => {
    const t = FIELDS[r.field].type;
    if (t === 'bool' || (t === 'date' && r.op === 'never')) return '';
    if (t === 'enum') return `<select class="select" data-fv="${i}">${Object.entries(FIELDS[r.field].values).map(([k, l]) => `<option value="${k}" ${r.value === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    if (r.op === 'between') {
      const v = Array.isArray(r.value) ? r.value : ['', ''];
      return `<input type="number" class="fb-num" data-fv="${i}" data-k="0" value="${esc(v[0])}"><span>~</span><input type="number" class="fb-num" data-fv="${i}" data-k="1" value="${esc(v[1])}">`;
    }
    if (t === 'number' || t === 'date') return `<input type="number" class="fb-num" data-fv="${i}" value="${esc(r.value ?? '')}">${t === 'date' ? '<span>일</span>' : ''}`;
    return `<input type="text" class="fb-text" data-fv="${i}" value="${esc(r.value ?? '')}" spellcheck="false" placeholder="값">`;
  };
  const sortable = Object.entries(FIELDS).filter(([, x]) => x.type !== 'bool');
  return `<div class="filter-box card">
  <div class="fb-head"><b>${icon('filter')}고급 필터</b>
    <div class="seg" data-fmatch><button data-v="all" class="${f.match !== 'any' ? 'on' : ''}">조건 모두</button><button data-v="any" class="${f.match === 'any' ? 'on' : ''}">하나라도</button></div>
    <span class="spacer"></span><button class="icon-btn" data-act="filter-close" aria-label="고급 필터 닫기">${icon('close')}</button></div>
  <div class="fb-rules">${
    f.rules.map((r, i) => `<div class="fb-rule"><select class="select" data-ff="${i}">${fieldOpts(r.field)}</select><select class="select" data-fo="${i}">${opOpts(r.field, r.op)}</select>${value(r, i)}<button class="icon-btn" data-act="fr-del" data-i="${i}" aria-label="조건 빼기">${icon('close')}</button></div>`).join('') ||
    '<p class="dz-note">조건을 더해서 곡을 골라요. 예: 장르 포함 "J-Pop" + 재생 횟수 보다 큼 5 + 마지막 재생 30일보다 오래됨</p>'
  }</div>
  <div class="fb-foot"><button class="btn small" data-act="fr-add">${icon('plus')}조건 더하기</button>
    <label class="fb-inline">정렬 <select class="select" data-fsort><option value="">기본</option>${sortable.map(([k, x]) => `<option value="${k}" ${f.sort?.by === k ? 'selected' : ''}>${x.label}</option>`).join('')}<option value="random" ${f.sort?.by === 'random' ? 'selected' : ''}>무작위</option></select></label>
    ${f.sort?.by && f.sort.by !== 'random' ? `<select class="select" data-fdir><option value="desc" ${f.sort.dir !== 'asc' ? 'selected' : ''}>큰 것부터</option><option value="asc" ${f.sort.dir === 'asc' ? 'selected' : ''}>작은 것부터</option></select>` : ''}
    <label class="fb-inline">최대 <input type="number" class="fb-num" min="0" max="5000" data-flimit value="${f.limit || ''}" placeholder="전부">곡</label>
    <span class="spacer"></span>
    <button class="btn small" data-act="filter-save">${icon('check')}필터 저장</button><button class="btn small" data-act="filter-clear">지우기</button></div>
</div>`;
}

const subFor = (t, by) =>
  by === 'playCount'
    ? `${t.artist} · ${t.playCount || 0}회`
    : by === 'addedAt'
      ? `${t.artist} · ${fmtAgo(t.addedAt)} 추가`
      : by === 'lastPlayed'
        ? `${t.artist} · ${t.lastPlayed ? fmtAgo(t.lastPlayed) : '안 들음'}`
        : by === 'skips'
          ? `${t.artist} · ${t.skips || 0}번 넘김`
          : `${t.artist} · ${t.album}`;

function searchHome(el) {
  const s = store.settings;
  const hist = s.searchHistory || [];
  const saved = s.savedFilters || [];
  setList([], null);
  el.innerHTML = `<div class="search-home">
${hist.length ? `<div class="section-title row-title">최근 검색 <button class="link" data-act="sh-clear">모두 지우기</button></div><div class="chips">${hist.map((h) => `<span class="chip hist"><button data-act="sh-go" data-q="${esc(h)}">${icon('history')}<span>${esc(h)}</span></button><button class="x" data-act="sh-del" data-q="${esc(h)}" aria-label="${esc(h)} 지우기">${icon('close')}</button></span>`).join('')}</div>` : ''}
${saved.length ? `<div class="section-title">저장한 필터</div><div class="chips">${saved.map((f) => `<span class="chip hist"><button data-act="sf-apply" data-id="${esc(f.id)}">${icon('filter')}<span>${esc(f.name)}</span></button><button class="x" data-act="sf-del" data-id="${esc(f.id)}" aria-label="${esc(f.name)} 지우기">${icon('close')}</button></span>`).join('')}</div>` : ''}
<div class="section-title">이렇게도 찾을 수 있어요</div>
<div class="chips">${EXAMPLES.map((x) => `<button class="chip" data-act="sh-go" data-q="${esc(x)}">${icon('sparkle')}<span>${esc(x)}</span></button>`).join('')}</div>
<div class="list-head"><button class="btn" data-act="filter-open">${icon('filter')}고급 필터</button></div>
<div class="empty compact">${icon('search')}<h3>무엇을 들을까요?</h3><p>곡 제목·앨범·아티스트, 한글 초성(ㅂㄴㅇ), 일본어 발음(요아소비 · yoasobi · ヨアソビ),<br>가사 한 줄, "최근 추가한 일본 노래 10곡" 같은 말로도 찾아요. 오타가 조금 있어도 비슷한 곡을 보여 줘요.</p></div>
</div>`;
  return { search: true, title: '검색' };
}

function searchView(el, q = '') {
  const raw = (q || '').trim();
  clearTimeout(lyricsTimer);
  lyricsToken++;
  if (!raw && !filterOpen && !hasFilter()) return searchHome(el);
  const fctx = filterCtx();
  const nl = raw ? parseNatural(raw, { artists: store.artists.map((a) => a.name) }) : null;
  lastNl = nl;
  const af = activeFilter();
  let base = store.list;
  if (af && hasFilter()) base = applyFilter(base, { ...af, limit: 0 }, fctx);
  let text = raw;
  if (nl) {
    base = applyFilter(base, { rules: nl.rules, sort: nl.sort }, fctx);
    text = nl.text || '';
  }
  const nq = normSearch(text);
  const pk = text ? phoneticKey(text) : '';
  const usePk = pk.length >= 3 && !/^[ㄱ-ㅎ]+$/.test(nq);
  const hit = (x) => matchQuery(x._s, x._c, nq) || (usePk && x._p?.includes(pk));
  let tracks = nq ? base.filter(hit) : base;
  const sortBy = nl?.sort?.by || af?.sort?.by || null;
  if (!sortBy) {
    const rank = (t) => (t._s.startsWith(nq) ? 0 : t._s.includes(nq) ? 1 : 2);
    tracks = nq ? [...tracks].sort((a, b) => rank(a) - rank(b) || collator.compare(a.title, b.title)) : sortTracks(tracks, 'title');
  }
  const limit = nl?.limit || af?.limit || 0;
  if (limit) tracks = tracks.slice(0, limit);
  const total = tracks.length;
  tracks = tracks.slice(0, 300);
  const plain = !!nq && !nl && !hasFilter();
  const albums = plain ? store.albums.filter(hit).slice(0, 12) : [];
  const artists = plain ? store.artists.filter(hit).slice(0, 8) : [];
  const exact = new Set(tracks.map((t) => t.id));
  const fuzzy = plain && tracks.length < 8 ? fuzzySearch(store.list, text, 40).filter((t) => !exact.has(t.id)).slice(0, 20) : [];
  setList(tracks, { type: 'search', name: raw ? `"${raw}" 검색 결과` : '필터 결과' });
  ctx.groups.fuzzy = { ids: fuzzy.map((t) => t.id), source: { type: 'search', name: `"${raw}" 비슷한 결과` } };

  const parts = [];
  if (filterOpen) parts.push(filterBox());
  if (nl) {
    parts.push(`<div class="nl-box">${icon('sparkle')}<span>이렇게 알아들었어요</span><div class="chips">${nl.labels.map((l) => `<span class="chip on">${esc(l)}</span>`).join('')}${nl.text ? `<span class="chip">검색어: ${esc(nl.text)}</span>` : ''}</div><span class="spacer"></span><button class="btn small" data-act="nl-to-filter">${icon('filter')}고급 필터로 고치기</button></div>`);
  }
  if (artists.length) parts.push(`<div class="section-title">아티스트</div><div class="card">${artists.map(artistRow).join('')}</div>`);
  if (albums.length) parts.push(`<div class="section-title">앨범</div><div class="grid">${albums.map(albumCard).join('')}</div>`);
  if (tracks.length) {
    parts.push(`<div class="section-title">트랙</div>
<div class="list-head"><button class="btn shuffle-all" data-act="shuffle-list">${icon('shuffle')}셔플 재생</button><span class="count">${total > tracks.length ? `${tracks.length} / ${total}곡` : `${total}곡`}</span><span class="spacer"></span>
  <button class="sort-btn" data-act="search-save">${icon('plus')}재생목록으로 저장</button>${filterOpen ? '' : `<button class="sort-btn" data-act="filter-open">${icon('filter')}고급 필터</button>`}</div>
<div class="card list">${tracks.map((t, i) => trackRow(t, i, { sub: subFor(t, sortBy) })).join('')}</div>`);
  } else {
    parts.push(`<div class="empty compact">${icon('search')}<h3>${raw ? `"${esc(raw)}" ` : ''}검색 결과가 없어요</h3><p>다른 단어나 초성으로 찾아보세요.${hasFilter() ? ' 고급 필터 조건도 확인해 보세요.' : ''}</p>${filterOpen ? '' : `<button class="btn small" data-act="filter-open">${icon('filter')}고급 필터</button>`}</div>`);
  }
  if (fuzzy.length) parts.push(`<div class="section-title">혹시 이 곡인가요? · 비슷한 결과</div><div class="card list" data-group="fuzzy">${fuzzy.map((t, i) => trackRow(t, i, { sub: `${t.artist} · ${t.album}` })).join('')}</div>`);
  const lyricQ = plain && text.length >= 2 ? text : '';
  if (lyricQ) parts.push('<div id="lyr-results"></div>');
  el.innerHTML = parts.join('');
  if (lyricQ) searchLyrics(lyricQ, exact, raw);
  return { search: true, title: '검색' };
}

// 가사로 찾기: 입력이 잠깐 멈추면 서버에 묻는다
function searchLyrics(text, exact, raw) {
  const token = lyricsToken;
  lyricsTimer = setTimeout(async () => {
    let results = [];
    try {
      ({ results } = await get(`/api/search/lyrics?q=${encodeURIComponent(text)}`));
    } catch {
      return;
    }
    const box = $('#lyr-results');
    if (token !== lyricsToken || !box) return;
    const rows = results.filter((r) => store.tracks.has(r.id) && !exact.has(r.id));
    if (!rows.length) return;
    ctx.groups.lyrics = { ids: rows.map((r) => r.id), source: { type: 'search', name: `"${raw}" 가사 검색` } };
    const snip = (s) => s.replace(/\[[^\]]*\]/g, '').trim();
    box.innerHTML = `<div class="section-title">가사에서 찾음 · ${rows.length}곡</div><div class="card list" data-group="lyrics">${rows
      .map((r, i) => trackRow(store.tracks.get(r.id), i, { sub: `“${snip(r.snippet)}”` }))
      .join('')}</div>`;
    markPlaying(box);
  }, 350);
}

// 검색 기록 (설정에 저장, 최근 20개)
function saveHistory(list) {
  store.settings.searchHistory = list;
  put('/api/settings', { searchHistory: list }).catch(() => {});
}

export function recordSearch(q) {
  const s = String(q || '').trim();
  if (s.length < 2) return;
  const old = store.settings.searchHistory || [];
  // 이어서 친 말(요아 → 요아소비)은 앞의 것을 바꾼다
  const rest = old.filter((x, i) => x !== s && !(i === 0 && (s.startsWith(x) || x.startsWith(s))));
  saveHistory([s, ...rest].slice(0, 20));
}

export const views = {
  tracks: tracksView,
  playlists: playlistsView,
  albums: albumsView,
  artists: artistsView,
  folders: foldersView,
  album: albumView,
  artist: artistView,
  folder: folderView,
  playlist: playlistView,
  smart: smartView,
  search: searchView,
};

// ───────── 동작 ─────────

async function movePlaylistEntry(id, from, to) {
  const p = store.playlist(id);
  if (!p) return;
  const { visible, missing } = splitEntries(p.entries);
  const [x] = visible.splice(from, 1);
  visible.splice(to, 0, x);
  p.entries = [...visible, ...missing];
  ctx.refresh({ keepScroll: true });
  try {
    await put(`/api/playlists/${id}`, { entries: p.entries });
  } catch (e) {
    toast(e.message);
  }
  reloadPlaylists();
}

function sortMenu(kind, labels, anchor) {
  const cur = pref.get(`sort.${kind}`, Object.keys(labels)[0]);
  openMenu(
    Object.entries(labels).map(([k, label]) => ({
      icon: cur === k ? 'check' : 'sort',
      label,
      run: () => {
        pref.set(`sort.${kind}`, k);
        ctx.refresh();
      },
    })),
    { anchor },
  );
}

function playlistMenu(id, pos) {
  const p = store.playlist(id);
  if (!p) return;
  const player = ctx.player;
  const ids = () => splitEntries(p.entries).visible;
  const src = { type: 'playlist', id, name: p.name };
  const mode = modeLabel(p.mode);
  const items = [
    { icon: 'play', label: '재생', run: () => player.playInOrder(ids(), src) },
    { icon: 'shuffle', label: '셔플 재생', run: () => player.shufflePlay(ids(), src) },
    '-',
  ];
  if (!p.system) {
    items.push(
      {
        icon: 'edit',
        label: '이름 바꾸기',
        run: async () => {
          const name = await promptText('이름 바꾸기', p.name, { okLabel: '저장' });
          if (!name) return;
          await put(`/api/playlists/${id}`, { name });
          reloadPlaylists();
        },
      },
      { icon: 'palette', label: '색·아이콘', run: () => playlistStyleDialog(p) },
    );
  }
  items.push(
    { icon: 'repeat', label: mode ? `재생 방식 · ${mode}` : '재생 방식 (셔플·반복)', run: () => playlistModeDialog(p) },
    { icon: 'history', label: '변경 이력 · 되돌리기', run: () => playlistHistoryDialog(p) },
    { icon: 'copy', label: '중복 곡 정리', run: () => dedupeDialog(p) },
  );
  if (!p.system) {
    items.push(
      '-',
      {
        icon: 'phone',
        label: p.syncToPhone ? '폰 동기화 끄기' : '폰 동기화 켜기',
        run: async () => {
          await put(`/api/playlists/${id}`, { syncToPhone: !p.syncToPhone });
          toast(p.syncToPhone ? '이 재생목록은 폰으로 보내지 않아요' : '다음 동기화 때 폰으로 보내요');
          reloadPlaylists();
        },
      },
      {
        icon: 'export',
        label: '.m3u 파일로 내보내기',
        run: () => {
          location.href = `/api/playlists/${id}/export`;
        },
      },
      '-',
      {
        icon: 'trash',
        label: '삭제',
        danger: true,
        run: async () => {
          const ok = await confirmDialog('재생목록 삭제', `"${p.name}"을(를) 삭제할까요? 곡 파일은 지워지지 않아요. "지운 재생목록"에서 되살릴 수 있어요.`, { okLabel: '삭제', danger: true });
          if (!ok) return;
          await del(`/api/playlists/${id}`);
          toast('재생목록을 삭제했어요');
          await reloadPlaylists();
          if (ctx.route?.name === 'playlist') ctx.go('#/playlists');
        },
      },
    );
  }
  openMenu(items, pos);
}

async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('euc-kr').decode(buf); // 예전 Windows 프로그램이 만든 재생목록
  } catch {
    return utf8;
  }
}

async function importPlaylists(files) {
  for (const f of files) {
    try {
      const r = await post('/api/playlists/import', { fileName: f.name, text: await readTextSmart(f) });
      toast(`"${r.playlist.name}" 가져옴 · ${r.matched}곡${r.missing.length ? ` · 못 찾은 곡 ${r.missing.length}개` : ''}`, 4000);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 4000);
    }
  }
  reloadPlaylists();
}

// 곡 선택 (Ctrl·Shift 클릭, 삼성 뮤직의 길게 눌러 선택과 같은 역할)
function toggleSelect(i, range) {
  const sel = ctx.selection;
  if (range && ctx.lastSelected >= 0) {
    const [a, b] = [Math.min(ctx.lastSelected, i), Math.max(ctx.lastSelected, i)];
    for (let k = a; k <= b; k++) sel.add(k);
  } else if (sel.has(i)) sel.delete(i);
  else sel.add(i);
  ctx.lastSelected = i;
  updateSelection();
}

export function clearSelection(update = true) {
  ctx.selection.clear();
  ctx.lastSelected = -1;
  if (update) updateSelection();
  else $('#selbar').hidden = true;
}

const inUserPlaylist = () => ctx.route?.name === 'playlist' && store.playlist(ctx.route.param);

export function updateSelection() {
  const bar = $('#selbar');
  for (const r of document.querySelectorAll('#view .row.track')) r.classList.toggle('selected', !r.closest('[data-group]') && ctx.selection.has(Number(r.dataset.i)));
  const n = ctx.selection.size;
  if (!n) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `<div class="txt"><b>${n}곡</b> 선택</div>
<button class="btn small" data-sel="next">${icon('playNext')}다음에 재생</button>
<button class="btn small" data-sel="queue">${icon('addQueue')}대기열에 추가</button>
<button class="btn small" data-sel="playlist">${icon('plus')}재생목록에 추가</button>
<button class="icon-btn" data-sel="more" aria-label="더 보기">${icon('more')}</button>
${inUserPlaylist() ? `<button class="btn small danger" data-sel="remove">${icon('trash')}빼기</button>` : ''}
<button class="icon-btn" data-sel="clear" aria-label="선택 해제">${icon('close')}</button>`;
}

function selectedIds() {
  return [...ctx.selection].sort((a, b) => a - b).map((i) => ctx.list.ids[i]).filter(Boolean);
}

export function bindSelectionBar() {
  $('#selbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    const act = b?.dataset.sel;
    if (!act) return;
    const ids = selectedIds();
    const idx = [...ctx.selection];
    if (act === 'more') {
      // 여러 곡 한 번에: 커버 바꾸기 · 셔플에서 빼기
      const anyOverride = ids.some((id) => store.tracks.get(id)?.coverOriginal !== undefined);
      openMenu(
        [
          { icon: 'edit', label: `커버 바꾸기 · ${ids.length}곡`, run: () => (changeCover(ids), clearSelection()) },
          ...(anyOverride ? [{ icon: 'history', label: '원래 커버로', run: () => (resetCover(ids), clearSelection()) }] : []),
          { icon: 'shuffleOff', label: '셔플에서 빼기', run: () => setNoShuffle(ids, true) },
          { icon: 'shuffle', label: '셔플에 다시 넣기', run: () => setNoShuffle(ids, false) },
        ],
        { anchor: b },
      );
      return;
    }
    if (act === 'next') {
      ctx.player.playNext(ids);
      toast(`${ids.length}곡을 다음에 재생해요`);
    } else if (act === 'queue') {
      ctx.player.addToQueue(ids);
      toast(`${ids.length}곡을 대기열에 추가했어요`);
    } else if (act === 'playlist') addToPlaylistDialog(ids);
    else if (act === 'remove' && inUserPlaylist()) removeFromPlaylist(ctx.route.param, idx);
    clearSelection();
  });
}

async function setNoShuffle(ids, on) {
  try {
    await put('/api/tracks/user', { ids, patch: { noShuffle: on } });
    for (const id of ids) {
      const t = store.tracks.get(id);
      if (t) t.noShuffle = on || undefined;
    }
    ctx.player.emit('queue');
    toast(on ? `${ids.length}곡은 셔플할 때 건너뛰어요` : `${ids.length}곡을 셔플에 다시 넣었어요`);
  } catch (e) {
    toast(e.message, 4000);
  }
  clearSelection();
}

const menuOpts = (row) => (inUserPlaylist() && !row.closest('[data-group]') ? { playlistId: ctx.route.param, index: Number(row.dataset.i) } : {});

// 곡 행이 어느 목록에 속하는지: 묶음(ctx.groups: 통계·검색의 가사 결과 등)이 있으면 그 묶음, 아니면 화면 목록
const listOf = (row) => {
  const g = row.closest('[data-group]')?.dataset.group;
  return (g && ctx.groups?.[g]) || (g ? { ids: [], source: null } : ctx.list);
};

function onFilterChange(t) {
  if (!filter) filter = emptyFilter();
  const rules = filter.rules;
  if (t.dataset.ff !== undefined) {
    const r = rules[Number(t.dataset.ff)];
    r.field = t.value;
    r.op = Object.keys(OPS[FIELDS[r.field].type])[0];
    r.value = defaultValue(r.field, r.op);
  } else if (t.dataset.fo !== undefined) {
    const r = rules[Number(t.dataset.fo)];
    const wasBetween = r.op === 'between';
    r.op = t.value;
    if (wasBetween !== (r.op === 'between')) r.value = defaultValue(r.field, r.op);
  } else if (t.dataset.fv !== undefined) {
    const r = rules[Number(t.dataset.fv)];
    if (t.dataset.k !== undefined) {
      const v = Array.isArray(r.value) ? r.value.slice() : ['', ''];
      v[Number(t.dataset.k)] = t.value;
      r.value = v;
    } else r.value = t.value;
  } else if (t.matches('[data-fsort]')) filter.sort = t.value ? { by: t.value, dir: filter.sort?.dir || 'desc' } : null;
  else if (t.matches('[data-fdir]')) filter.sort = { ...(filter.sort || {}), dir: t.value };
  else if (t.matches('[data-flimit]')) filter.limit = Math.max(0, Math.floor(Number(t.value) || 0));
  else return false;
  ctx.refresh({ keepScroll: true });
  return true;
}

function setQuery(q) {
  const inp = $('#search-input');
  if (inp) inp.value = q;
  history.replaceState(history.state, '', `#/search/${encodeURIComponent(q)}`);
  ctx.refresh({ keepScroll: false });
}

async function onSearchAct(act, el) {
  const s = store.settings;
  switch (act) {
    case 'sh-go':
      recordSearch(el.dataset.q);
      return ctx.go(`#/search/${encodeURIComponent(el.dataset.q)}`);
    case 'sh-del':
      saveHistory((s.searchHistory || []).filter((x) => x !== el.dataset.q));
      return ctx.refresh({ keepScroll: true });
    case 'sh-clear':
      saveHistory([]);
      return ctx.refresh({ keepScroll: true });
    case 'sf-apply': {
      const f = (s.savedFilters || []).find((x) => x.id === el.dataset.id);
      if (!f) return undefined;
      filter = { ...emptyFilter(), ...structuredClone(f.filter) };
      filterOpen = true;
      return ctx.refresh();
    }
    case 'sf-del': {
      const list = (s.savedFilters || []).filter((x) => x.id !== el.dataset.id);
      store.settings = await put('/api/settings', { savedFilters: list });
      return ctx.refresh({ keepScroll: true });
    }
    case 'filter-open':
      filterOpen = true;
      filter ||= emptyFilter();
      if (!filter.rules.length) filter.rules.push({ field: 'artist', op: 'contains', value: '' });
      return ctx.refresh({ keepScroll: true });
    case 'filter-close':
      filterOpen = false;
      return ctx.refresh({ keepScroll: true });
    case 'filter-clear':
      filter = emptyFilter();
      filter.rules.push({ field: 'artist', op: 'contains', value: '' });
      return ctx.refresh({ keepScroll: true });
    case 'fr-add':
      filter ||= emptyFilter();
      filter.rules.push({ field: 'title', op: 'contains', value: '' });
      ctx.refresh({ keepScroll: true });
      return setTimeout(() => document.querySelector(`.fb-rule:last-child [data-fv]`)?.focus(), 30);
    case 'fr-del':
      filter?.rules.splice(Number(el.dataset.i), 1);
      return ctx.refresh({ keepScroll: true });
    case 'filter-save': {
      const f = activeFilter();
      if (!hasFilter()) return toast('조건을 하나 이상 채워 주세요');
      const name = await promptText('필터 저장', '', { okLabel: '저장', placeholder: '필터 이름 (예: 운동할 때)' });
      if (!name) return undefined;
      const list = [...(s.savedFilters || []), { id: Math.random().toString(36).slice(2, 10), name, filter: f }];
      store.settings = await put('/api/settings', { savedFilters: list });
      return toast(`"${name}" 필터를 저장했어요. 검색 화면 처음에 보여요`);
    }
    case 'nl-to-filter': {
      if (!lastNl) return undefined;
      filter = { match: 'all', rules: structuredClone(lastNl.rules), sort: lastNl.sort, limit: lastNl.limit || 0 };
      filterOpen = true;
      return setQuery(lastNl.text || '');
    }
    case 'search-save': {
      const ids = ctx.list.ids;
      if (!ids.length) return undefined;
      const q = $('#search-input')?.value.trim();
      const name = await promptText('재생목록으로 저장', q || '검색 결과', { okLabel: '만들기' });
      if (!name) return undefined;
      const p = await post('/api/playlists', { name, entries: ids });
      await reloadPlaylists();
      return toast(`"${p.name}"에 ${ids.length}곡을 넣었어요`);
    }
    default:
      return undefined;
  }
}

export function bindViewEvents(root) {
  root.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    const act = actEl?.dataset.act;
    const row = e.target.closest('.row.track');
    const player = ctx.player;

    if (row && act === 'more') {
      e.stopPropagation();
      return showTrackMenu(store.tracks.get(row.dataset.id), menuOpts(row), { anchor: actEl });
    }
    if (row && act === 'row-remove') return removeFromPlaylist(ctx.route.param, [Number(row.dataset.i)]);
    if (e.target.closest('.drag')) return;
    if (row && !act) {
      const i = Number(row.dataset.i);
      const grouped = !!row.closest('[data-group]');
      if (!grouped && (e.ctrlKey || e.metaKey || e.shiftKey || ctx.selection.size)) return toggleSelect(i, e.shiftKey);
      if (ctx.route?.name === 'search') recordSearch($('#search-input')?.value);
      const L = listOf(row);
      return player.playList(L.ids, i, { source: L.source });
    }

    try {
      if (act?.startsWith('sh-') || act?.startsWith('sf-') || act?.startsWith('filter-') || act?.startsWith('fr-') || act === 'nl-to-filter' || act === 'search-save') return await onSearchAct(act, actEl);
    } catch (err) {
      return toast(err.message, 4000);
    }

    switch (act) {
      case 'shuffle-list':
        return player.shufflePlay(ctx.list.ids, ctx.list.source);
      case 'play-list':
        return player.playInOrder(ctx.list.ids, ctx.list.source);
      case 'group-play':
      case 'group-shuffle': {
        const L = ctx.groups?.[actEl.dataset.g];
        if (!L?.ids.length) return toast('들을 수 있는 곡이 없어요');
        return act === 'group-play' ? player.playInOrder(L.ids, L.source) : player.shufflePlay(L.ids, L.source);
      }
      case 'add-list':
        return addToPlaylistDialog(ctx.list.ids);
      case 'list-more': {
        const ids = ctx.list.ids;
        const anyOverride = ids.some((id) => store.tracks.get(id)?.coverOriginal !== undefined);
        return openMenu(
          [
            { icon: 'playNext', label: '다음에 재생', run: () => (player.playNext(ids), toast(`${ids.length}곡을 다음에 재생해요`)) },
            { icon: 'addQueue', label: '재생 대기열에 추가', run: () => (player.addToQueue(ids), toast(`${ids.length}곡을 대기열에 추가했어요`)) },
            ...(ctx.route?.name === 'album'
              ? [
                  '-',
                  { icon: 'edit', label: '앨범 커버 바꾸기', run: () => changeCover(ids) },
                  ...(anyOverride ? [{ icon: 'history', label: '원래 커버로', run: () => resetCover(ids) }] : []),
                ]
              : []),
          ],
          { anchor: actEl },
        );
      }
      case 'sort-tracks':
        return sortMenu('tracks', TRACK_SORTS, actEl);
      case 'sort-albums':
        return sortMenu('albums', ALBUM_SORTS, actEl);
      case 'play-album': {
        e.stopPropagation();
        const a = store.albumByKey.get(actEl.closest('[data-album]').dataset.album);
        return a && player.playInOrder(a.tracks.map((t) => t.id), { type: 'album', id: a.key, name: a.name });
      }
      case 'play-artist': {
        e.stopPropagation();
        const ar = store.artistByName.get(actEl.closest('[data-artist]').dataset.artist);
        return ar && player.shufflePlay(ar.tracks.map((t) => t.id), { type: 'artist', id: ar.name, name: ar.name });
      }
      case 'play-folder': {
        e.stopPropagation();
        const f = store.folderByDir.get(actEl.closest('[data-dir]').dataset.dir);
        return f && player.shufflePlay(f.tracks.map((t) => t.id), { type: 'folder', id: f.dir, name: f.name });
      }
      case 'reveal-folder': {
        const first = ctx.list.ids[0];
        return first && post(`/api/tracks/${first}/reveal`).catch((err) => toast(err.message));
      }
      case 'new-playlist': {
        const p = await newPlaylist();
        if (p) ctx.go(`#/playlist/${p.id}`);
        return;
      }
      case 'import-playlist':
        return $('#import-file').click();
      case 'pl-trash':
        return trashDialog();
      case 'edit-playlist':
        ctx.editing = ctx.editing ? null : ctx.route.param;
        return ctx.refresh({ keepScroll: true });
      case 'pl-more': {
        e.stopPropagation();
        const id = actEl.dataset.pl || actEl.closest('[data-pl]')?.dataset.pl;
        return playlistMenu(id, { anchor: actEl });
      }
      default:
        break;
    }
    if (act) return undefined; // 다른 화면(설정·도구·통계)이 처리하는 버튼

    const albumEl = e.target.closest('[data-album]');
    if (albumEl) return ctx.go(`#/album/${encodeURIComponent(albumEl.dataset.album)}`);
    const artistEl = e.target.closest('[data-artist]');
    if (artistEl) return ctx.go(`#/artist/${encodeURIComponent(artistEl.dataset.artist)}`);
    const dirEl = e.target.closest('[data-dir]');
    if (dirEl) return ctx.go(`#/folder/${encodeURIComponent(dirEl.dataset.dir)}`);
    const plEl = e.target.closest('.row.pl');
    if (plEl) return ctx.go(`#/playlist/${plEl.dataset.pl}`);
    return undefined;
  });

  root.addEventListener('contextmenu', (e) => {
    // 키보드의 메뉴 키로 열면 좌표가 0이라 그 줄 옆에 띄운다
    const at = (el) => (e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { anchor: el });
    const row = e.target.closest('.row.track');
    if (row) {
      e.preventDefault();
      return showTrackMenu(store.tracks.get(row.dataset.id), menuOpts(row), at(row));
    }
    const pl = e.target.closest('.row.pl');
    if (pl) {
      e.preventDefault();
      return playlistMenu(pl.dataset.pl, at(pl));
    }
    const albumEl = e.target.closest('[data-album]');
    if (albumEl) {
      e.preventDefault();
      const a = store.albumByKey.get(albumEl.dataset.album);
      const ids = a.tracks.map((t) => t.id);
      openMenu(
        [
          { icon: 'play', label: '재생', run: () => ctx.player.playInOrder(ids, { type: 'album', id: a.key, name: a.name }) },
          { icon: 'playNext', label: '다음에 재생', run: () => (ctx.player.playNext(ids), toast(`${ids.length}곡을 다음에 재생해요`)) },
          { icon: 'addQueue', label: '재생 대기열에 추가', run: () => (ctx.player.addToQueue(ids), toast(`${ids.length}곡을 대기열에 추가했어요`)) },
          { icon: 'plus', label: '재생목록에 추가', run: () => addToPlaylistDialog(ids) },
          '-',
          { icon: 'edit', label: '앨범 커버 바꾸기', run: () => changeCover(ids) },
        ],
        at(albumEl),
      );
    }
    return undefined;
  });

  root.addEventListener('change', (e) => {
    if (e.target.id === 'import-file' && e.target.files.length) return importPlaylists([...e.target.files]);
    if (e.target.closest('.filter-box')) return onFilterChange(e.target);
    return undefined;
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('.filter-box input')) {
      e.target.blur(); // 값 입력 후 Enter = 적용 (change)
      return;
    }
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.album-card');
    if (card) ctx.go(`#/album/${encodeURIComponent(card.dataset.album)}`);
  });

  // 고급 필터의 '조건 모두/하나라도'
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmatch] button');
    if (!b) return;
    filter ||= emptyFilter();
    filter.match = b.dataset.v;
    ctx.refresh({ keepScroll: true });
  });
}
