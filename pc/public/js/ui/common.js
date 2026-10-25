// 여러 화면에서 쓰는 조각: 곡 행, 커버, 곡 메뉴, 즐겨찾기, 재생목록에 추가
import { coverUrl, get, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { esc, fmtTime } from '../util.js';
import { dialog, openMenu, promptText, toast } from './dom.js';

export const EQ = '<span class="eq"><i></i><i></i><i></i></span>';

// 커버 그림 (없으면 CSS의 음표 기본 그림이 보인다). 한 번 없다고 확인된 커버는 다시 요청하지 않는다
export const noCover = new Set();
export const coverImg = (id) => (id && !noCover.has(id) ? `<img src="${coverUrl(id)}" alt="" loading="lazy" decoding="async" data-cover="${id}">` : '');

export function mosaic(ids, cls = 'thumb') {
  const covers = [];
  const seen = new Set();
  for (const id of ids) {
    const t = store.tracks.get(id);
    if (!t) continue;
    const c = store.coverIdFor(t);
    if (seen.has(c)) continue;
    seen.add(c);
    covers.push(c);
    if (covers.length === 4) break;
  }
  if (covers.length < 4 || covers.some((c) => noCover.has(c))) return `<div class="${cls}">${coverImg(covers.find((c) => !noCover.has(c)))}</div>`;
  return `<div class="${cls} mosaic">${covers.map((c) => `<img src="${coverUrl(c)}" alt="" loading="lazy" data-cover="${c}">`).join('')}</div>`;
}

// mode: list(커버) · album(트랙 번호) · edit(손잡이+삭제)
export function trackRow(t, i, { mode = 'list', sub } = {}) {
  const lead =
    mode === 'album'
      ? `<div class="track-no">${t.trackNo || '·'}</div>`
      : `<div class="thumb">${coverImg(store.coverIdFor(t))}${EQ}</div>`;
  const trail =
    mode === 'edit'
      ? `<button class="icon-btn keep" data-act="row-remove" aria-label="재생목록에서 빼기">${icon('close')}</button><span class="icon-btn drag keep" aria-label="끌어서 순서 바꾸기">${icon('drag')}</span>`
      : `<span>${fmtTime(t.duration)}</span><button class="icon-btn" data-act="more" aria-label="더 보기">${icon('more')}</button>`;
  return `<div class="row track${mode === 'album' ? ' no-thumb' : ''}" data-i="${i}" data-id="${t.id}">
  ${lead}
  <div class="meta"><div class="title">${esc(t.title)}</div><div class="sub">${esc(sub ?? t.artist)}</div></div>
  <div class="trail">${trail}</div>
</div>`;
}

export function markPlaying(root = document) {
  const id = ctx.player?.queue.current;
  for (const el of root.querySelectorAll('.row.track.playing')) if (el.dataset.id !== id) el.classList.remove('playing');
  if (id) for (const el of root.querySelectorAll(`.row.track[data-id="${id}"]`)) el.classList.add('playing');
}

export async function reloadPlaylists() {
  const { playlists } = await get('/api/playlists');
  store.setPlaylists(playlists);
}

export async function toggleFavorite(id) {
  const fav = store.favorites;
  if (!fav) return;
  const on = fav.entries.includes(id);
  const entries = on ? fav.entries.filter((x) => x !== id) : [...fav.entries, id];
  fav.entries = entries; // 바로 반영하고 서버에 저장
  store.emit('playlists');
  await put('/api/playlists/favorites', { entries });
  toast(on ? '즐겨찾기에서 뺐어요' : '즐겨찾기에 추가했어요');
  reloadPlaylists();
}

export async function addToPlaylistDialog(ids) {
  if (!ids.length) return;
  const lists = store.playlists.filter((p) => !p.system);
  const html = `<div class="dlg-list">
    <div class="row" data-new><div class="thumb folder-icon">${icon('plus')}</div><div class="meta"><div class="title">새 재생목록</div></div><div></div></div>
    ${lists
      .map(
        (p) =>
          `<div class="row" data-id="${p.id}">${mosaic(p.entries)}<div class="meta"><div class="title">${esc(p.name)}</div><div class="sub">${p.entries.length}곡</div></div><div></div></div>`,
      )
      .join('')}
  </div>`;
  const choice = await dialog({
    title: `재생목록에 추가 · ${ids.length}곡`,
    html,
    actions: [{ label: '취소', value: null }],
    onOpen: (d, done) => {
      d.querySelector('.dlg-list').onclick = (e) => {
        const r = e.target.closest('.row');
        if (r) done(r.dataset.new !== undefined ? { new: true } : { id: r.dataset.id });
      };
    },
  });
  if (!choice) return;
  try {
    let p;
    if (choice.new) {
      const name = await promptText('새 재생목록', '', { okLabel: '만들기', placeholder: '재생목록 이름' });
      if (!name) return;
      p = await post('/api/playlists', { name, entries: ids });
    } else {
      p = await post(`/api/playlists/${choice.id}/add`, { ids });
    }
    toast(`"${p.name}"에 ${ids.length}곡을 추가했어요`);
    reloadPlaylists();
  } catch (e) {
    toast(e.message);
  }
}

export async function newPlaylist() {
  const name = await promptText('새 재생목록', '', { okLabel: '만들기', placeholder: '재생목록 이름' });
  if (!name) return null;
  const p = await post('/api/playlists', { name });
  await reloadPlaylists();
  return p;
}

// 곡 하나의 메뉴 (오른쪽 클릭·⋮)
export function trackMenu(t, { playlistId = null, index = -1 } = {}) {
  const player = ctx.player;
  const fav = store.isFavorite(t.id);
  const album = store.albumOf(t);
  const items = [
    { icon: 'playNext', label: '다음에 재생', run: () => (player.playNext([t.id]), toast('다음 곡으로 넣었어요')) },
    { icon: 'addQueue', label: '재생 대기열에 추가', run: () => (player.addToQueue([t.id]), toast('재생 대기열 맨 끝에 넣었어요')) },
    { icon: 'plus', label: '재생목록에 추가', run: () => addToPlaylistDialog([t.id]) },
    { icon: fav ? 'heartFill' : 'heart', label: fav ? '즐겨찾기 해제' : '즐겨찾기 추가', run: () => toggleFavorite(t.id) },
    '-',
  ];
  if (album) items.push({ icon: 'album', label: '앨범으로 이동', run: () => ctx.go(`#/album/${encodeURIComponent(album.key)}`) });
  items.push(
    { icon: 'artist', label: '아티스트로 이동', run: () => ctx.go(`#/artist/${encodeURIComponent(t.artist)}`) },
    { icon: 'folderOpen', label: '파일 위치 열기', run: () => post(`/api/tracks/${t.id}/reveal`).catch((e) => toast(e.message)) },
  );
  if (playlistId && index >= 0) {
    items.push('-', {
      icon: 'trash',
      label: '재생목록에서 빼기',
      danger: true,
      run: () => removeFromPlaylist(playlistId, [index]),
    });
  }
  return items;
}

export function showTrackMenu(t, opts, pos) {
  openMenu(trackMenu(t, opts), pos);
}

// 화면에 보이는 순서(index) 기준으로 재생목록에서 빼기
export async function removeFromPlaylist(playlistId, visibleIndexes) {
  const p = store.playlist(playlistId);
  if (!p) return;
  const { visible, missing } = splitEntries(p.entries);
  const drop = new Set(visibleIndexes);
  const entries = [...visible.filter((_, i) => !drop.has(i)), ...missing];
  p.entries = entries;
  store.emit('playlists');
  await put(`/api/playlists/${playlistId}`, { entries });
  toast(`${drop.size}곡을 뺐어요`);
  reloadPlaylists();
}

// 라이브러리에 있는 곡 / 아직 없는 곡(다음 동기화 때 들어올 수 있음) 나누기
export function splitEntries(entries) {
  const visible = [];
  const missing = [];
  for (const id of entries) (store.tracks.has(id) ? visible : missing).push(id);
  return { visible, missing };
}
