// 탭과 상세 화면: 트랙 · 재생목록 · 앨범 · 아티스트 · 폴더 · 검색
import { del, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { $, collator, esc, fmtAgo, fmtTotal, matchQuery, normSearch } from '../util.js';
import {
  addToPlaylistDialog,
  coverImg,
  mosaic,
  newPlaylist,
  reloadPlaylists,
  removeFromPlaylist,
  showTrackMenu,
  splitEntries,
  trackRow,
} from './common.js';
import { confirmDialog, openMenu, promptText, sortable, toast } from './dom.js';

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

const playlistRow = (p) =>
  `<div class="row pl" data-pl="${p.id}">${mosaic(p.entries)}<div class="meta"><div class="title">${esc(p.name)}</div><div class="sub">${p.entries.length}곡${p.origin === 'phone' ? ' · 폰에서 가져옴' : ''}</div></div><div class="trail">${p.syncToPhone ? `<span class="badge">${icon('phone')}동기화</span>` : ''}<button class="icon-btn" data-act="pl-more" aria-label="더 보기">${icon('more')}</button></div></div>`;

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
  const cover = p.id === 'favorites' ? `<div class="cover solid" style="background:#f0445a;color:#fff">${icon('heartFill')}</div>` : mosaic(p.entries, 'cover');
  const sync = p.system ? '' : p.syncToPhone ? ` · ${icon('phone')} 폰과 동기화 켜짐` : ' · 폰 동기화 꺼짐';
  el.innerHTML = `${hero({
    cover,
    kicker: p.system ? '기본 재생목록' : p.origin === 'phone' ? '재생목록 · 폰에서 가져옴' : '재생목록',
    title: p.name,
    sub: `${tracks.length}곡 · ${fmtTotal(total)}${missing.length ? ` · 아직 PC에 없는 곡 ${missing.length}개` : ''}${sync}`,
    actions: playButtons(
      `${tracks.length ? `<button class="btn${editing ? ' primary' : ''}" data-act="edit-playlist">${icon(editing ? 'check' : 'edit')}${editing ? '완료' : '순서 편집'}</button>` : ''}${p.system ? '' : `<button class="icon-btn" data-act="pl-more" data-pl="${p.id}" aria-label="더 보기">${icon('more')}</button>`}`,
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

function searchView(el, q = '') {
  const nq = normSearch(q || '');
  if (!nq) {
    setList([], null);
    el.innerHTML = `<div class="empty">${icon('search')}<h3>무엇을 들을까요?</h3><p>곡 제목, 앨범, 아티스트로 찾아요.<br>한글 초성(예: ㅂㄴㅇ ㅅㅊ)으로도 찾을 수 있어요.</p></div>`;
    return { search: true, title: '검색' };
  }
  const starts = (t) => (t._s.startsWith(nq) ? 0 : 1);
  const tracks = store.list
    .filter((t) => matchQuery(t._s, t._c, nq))
    .sort((a, b) => starts(a) - starts(b) || collator.compare(a.title, b.title))
    .slice(0, 300);
  const albums = store.albums.filter((a) => matchQuery(a._s, a._c, nq)).slice(0, 12);
  const artists = store.artists.filter((ar) => matchQuery(ar._s, ar._c, nq)).slice(0, 8);
  setList(tracks, { type: 'search', name: `"${q}" 검색 결과` });
  const parts = [];
  if (artists.length) parts.push(`<div class="section-title">아티스트</div><div class="card">${artists.map(artistRow).join('')}</div>`);
  if (albums.length) parts.push(`<div class="section-title">앨범</div><div class="grid">${albums.map(albumCard).join('')}</div>`);
  if (tracks.length) parts.push(`<div class="section-title">트랙 · ${tracks.length}곡</div><div class="card list">${tracks.map((t, i) => trackRow(t, i, { sub: `${t.artist} · ${t.album}` })).join('')}</div>`);
  el.innerHTML = parts.join('') || `<div class="empty">${icon('search')}<h3>"${esc(q)}" 검색 결과가 없어요</h3><p>다른 단어나 초성으로 찾아보세요.</p></div>`;
  return { search: true, title: '검색' };
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
  if (!p || p.system) return;
  const player = ctx.player;
  const ids = () => splitEntries(p.entries).visible;
  const src = { type: 'playlist', id, name: p.name };
  openMenu(
    [
      { icon: 'play', label: '재생', run: () => player.playInOrder(ids(), src) },
      { icon: 'shuffle', label: '셔플 재생', run: () => player.shufflePlay(ids(), src) },
      '-',
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
          const ok = await confirmDialog('재생목록 삭제', `"${p.name}"을(를) 삭제할까요? 곡 파일은 지워지지 않아요.`, { okLabel: '삭제', danger: true });
          if (!ok) return;
          await del(`/api/playlists/${id}`);
          toast('재생목록을 삭제했어요');
          await reloadPlaylists();
          if (ctx.route?.name === 'playlist') ctx.go('#/playlists');
        },
      },
    ],
    pos,
  );
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
  for (const r of document.querySelectorAll('#view .row.track')) r.classList.toggle('selected', ctx.selection.has(Number(r.dataset.i)));
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
${inUserPlaylist() ? `<button class="btn small danger" data-sel="remove">${icon('trash')}빼기</button>` : ''}
<button class="icon-btn" data-sel="clear" aria-label="선택 해제">${icon('close')}</button>`;
}

function selectedIds() {
  return [...ctx.selection].sort((a, b) => a - b).map((i) => ctx.list.ids[i]).filter(Boolean);
}

export function bindSelectionBar() {
  $('#selbar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-sel]')?.dataset.sel;
    if (!act) return;
    const ids = selectedIds();
    const idx = [...ctx.selection];
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

const menuOpts = (row) => (inUserPlaylist() ? { playlistId: ctx.route.param, index: Number(row.dataset.i) } : {});

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
      if (e.ctrlKey || e.metaKey || e.shiftKey || ctx.selection.size) return toggleSelect(i, e.shiftKey);
      return player.playList(ctx.list.ids, i, { source: ctx.list.source });
    }

    switch (act) {
      case 'shuffle-list':
        return player.shufflePlay(ctx.list.ids, ctx.list.source);
      case 'play-list':
        return player.playInOrder(ctx.list.ids, ctx.list.source);
      case 'add-list':
        return addToPlaylistDialog(ctx.list.ids);
      case 'list-more':
        return openMenu(
          [
            { icon: 'playNext', label: '다음에 재생', run: () => (player.playNext(ctx.list.ids), toast(`${ctx.list.ids.length}곡을 다음에 재생해요`)) },
            { icon: 'addQueue', label: '재생 대기열에 추가', run: () => (player.addToQueue(ctx.list.ids), toast(`${ctx.list.ids.length}곡을 대기열에 추가했어요`)) },
          ],
          { anchor: actEl },
        );
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
    const row = e.target.closest('.row.track');
    if (row) {
      e.preventDefault();
      return showTrackMenu(store.tracks.get(row.dataset.id), menuOpts(row), { x: e.clientX, y: e.clientY });
    }
    const pl = e.target.closest('.row.pl');
    if (pl) {
      e.preventDefault();
      return playlistMenu(pl.dataset.pl, { x: e.clientX, y: e.clientY });
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
        ],
        { x: e.clientX, y: e.clientY },
      );
    }
    return undefined;
  });

  root.addEventListener('change', (e) => {
    if (e.target.id === 'import-file' && e.target.files.length) importPlaylists([...e.target.files]);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.album-card');
    if (card) ctx.go(`#/album/${encodeURIComponent(card.dataset.album)}`);
  });
}
