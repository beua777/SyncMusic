// 재생목록 꾸미기·관리: 색·아이콘 · 재생 방식(셔플·반복) · 변경 이력(되돌리기) · 중복 곡 정리 · 지운 재생목록
import { get, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { playlistDuplicates, withoutDuplicates } from '../dupes.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { esc, fmtAgo } from '../util.js';
import { playlistArt, reloadPlaylists } from './common.js';
import { dialog, toast } from './dom.js';

const COLORS = ['#3e8cf0', '#7c5cff', '#e8457c', '#f0445a', '#ff9330', '#e6b800', '#22b07d', '#0ca5a5', '#64748b'];
const EMOJIS = ['🎵', '🎧', '🔥', '💤', '🏃', '🚗', '☕', '🌙', '❤️', '⭐', '🎉', '📚', '🌧️', '🌸', '🎸', '🎹', '🎤', '🧘', '💼', '🎮'];
const SHUFFLE = [
  ['keep', '그때 설정 그대로'],
  ['on', '항상 셔플'],
  ['off', '항상 순서대로'],
];
const REPEAT = [
  ['keep', '그때 설정 그대로'],
  ['off', '반복 안 함'],
  ['all', '전체 반복'],
  ['one', '한 곡 반복'],
];
const SOURCE = { user: '직접 바꿈', phone: '폰 동기화', sync: '폰 동기화', restore: '되돌리기 전', import: '가져오기', pc: 'PC' };
const fmtDate = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function save(p, patch, msg) {
  try {
    await put(`/api/playlists/${p.id}`, patch);
    await reloadPlaylists();
    if (msg) toast(msg);
    return true;
  } catch (e) {
    toast(e.message, 4000);
    return false;
  }
}

// "항상 셔플 · 전체 반복" (정한 게 없으면 '')
export function modeLabel(mode) {
  if (!mode) return '';
  const parts = [];
  if (mode.shuffle === 'on') parts.push('항상 셔플');
  if (mode.shuffle === 'off') parts.push('항상 순서대로');
  if (mode.repeat && mode.repeat !== 'keep') parts.push(REPEAT.find(([v]) => v === mode.repeat)?.[1]);
  return parts.join(' · ');
}

// ───── 색·아이콘 ─────
export async function playlistStyleDialog(p) {
  let color = p.color || '';
  let ic = p.icon || '';
  const preview = () => playlistArt({ entries: p.entries, color, icon: ic }, 'cover');
  const custom = () => !!color && !COLORS.includes(color);
  const v = await dialog({
    title: '색·아이콘',
    html: `<div class="pl-style">
  <div class="pl-style-top"><div class="pl-preview">${preview()}</div><p>재생목록 목록과 재생목록 화면 위쪽에 보여요. 둘 다 비우면 곡 커버를 모아서 보여 줘요</p></div>
  <div class="dz-sub">색</div>
  <div class="swatches">${['', ...COLORS]
    .map((c) => `<button class="sw${c ? '' : ' none'}${c === color ? ' on' : ''}" data-color="${c}" style="--c:${c || 'transparent'}" aria-label="${c || '색 없음'}"></button>`)
    .join('')}<label class="sw pick${custom() ? ' on' : ''}" style="--c:${custom() ? color : 'transparent'}" title="직접 고르기">${icon('plus')}<input type="color" value="${esc(color || '#3e8cf0')}" aria-label="색 직접 고르기"></label></div>
  <div class="dz-sub">아이콘</div>
  <div class="emoji-grid">${['', ...EMOJIS].map((e) => `<button class="emo-btn${e === ic ? ' on' : ''}" data-icon="${e}" aria-label="${e || '아이콘 없음'}">${e || '없음'}</button>`).join('')}</div>
  <input type="text" class="pl-icon-input" maxlength="12" placeholder="직접 입력 (이모지나 글자 4자까지)" value="${esc(EMOJIS.includes(ic) ? '' : ic)}" spellcheck="false">
</div>`,
    actions: [
      { label: '취소', value: null },
      { label: '저장', value: () => ({ color, icon: ic }) },
    ],
    onOpen: (d) => {
      const box = d.querySelector('.pl-style');
      const sync = () => {
        box.querySelector('.pl-preview').innerHTML = preview();
        for (const b of box.querySelectorAll('[data-color]')) b.classList.toggle('on', b.dataset.color === color);
        const pick = box.querySelector('.sw.pick');
        pick.classList.toggle('on', custom());
        pick.style.setProperty('--c', custom() ? color : 'transparent');
        for (const b of box.querySelectorAll('[data-icon]')) b.classList.toggle('on', b.dataset.icon === ic);
      };
      box.addEventListener('click', (e) => {
        const c = e.target.closest('[data-color]');
        if (c) {
          color = c.dataset.color;
          return sync();
        }
        const i = e.target.closest('[data-icon]');
        if (i) {
          ic = i.dataset.icon;
          box.querySelector('.pl-icon-input').value = '';
          sync();
        }
        return undefined;
      });
      box.querySelector('input[type="color"]').addEventListener('input', (e) => {
        color = e.target.value;
        sync();
      });
      box.querySelector('.pl-icon-input').addEventListener('input', (e) => {
        ic = [...e.target.value.trim()].slice(0, 4).join('');
        sync();
      });
    },
  });
  if (v) await save(p, { color: v.color || null, icon: v.icon || null }, '재생목록 모양을 바꿨어요');
}

// ───── 재생 방식 ─────
export async function playlistModeDialog(p) {
  let m = { shuffle: p.mode?.shuffle || 'keep', repeat: p.mode?.repeat || 'keep' };
  const seg = (k, opts) => `<div class="seg wrap" data-mk="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${m[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const v = await dialog({
    title: '재생 방식',
    html: `<p>"${esc(p.name)}"을(를) 틀 때마다 셔플·반복을 이렇게 맞춰요. 곡을 눌러서 틀 때도, 재생·셔플 버튼으로 틀 때도 똑같아요.</p>
<div class="dz-sub">셔플</div>${seg('shuffle', SHUFFLE)}
<div class="dz-sub">반복</div>${seg('repeat', REPEAT)}`,
    actions: [
      { label: '취소', value: null },
      { label: '저장', value: () => m },
    ],
    onOpen: (d) =>
      d.querySelector('.dlg-body').addEventListener('click', (e) => {
        const b = e.target.closest('.seg[data-mk] button');
        if (!b) return;
        m = { ...m, [b.parentElement.dataset.mk]: b.dataset.v };
        for (const x of b.parentElement.children) x.classList.toggle('on', x === b);
      }),
  });
  if (v) await save(p, { mode: v }, modeLabel(v) ? `이제 ${modeLabel(v)}으로 틀어요` : '재생 방식을 따로 정하지 않아요');
}

// ───── 변경 이력 (바뀌기 전 모습으로 되돌리기) ─────
export async function playlistHistoryDialog(p) {
  let versions;
  try {
    ({ versions } = await get(`/api/playlists/${p.id}/history`));
  } catch (e) {
    toast(e.message);
    return;
  }
  const cur = new Set(p.entries);
  const title = (id) => store.tracks.get(id)?.title || '(PC에 없는 곡)';
  const rows = versions
    .map((v) => {
      const was = new Set(v.entries);
      const plus = v.entries.filter((x) => !cur.has(x)).length; // 되돌리면 다시 들어올 곡
      const minus = p.entries.filter((x) => !was.has(x)).length; // 되돌리면 빠질 곡
      const same = v.entries.length === p.entries.length && v.entries.every((x, k) => x === p.entries[k]) && v.name === p.name;
      const sameSongs = !plus && !minus;
      const count = v.entries.length - p.entries.length;
      const diff = same
        ? ' · 지금과 같음'
        : sameSongs
          ? count
            ? ` · 되돌리면 같은 곡이 ${Math.abs(count)}번 ${count > 0 ? '더 들어가요' : '덜 들어가요'}`
            : v.name !== p.name && v.entries.every((x, k) => x === p.entries[k])
              ? ' · 이름만 다름'
              : ' · 순서만 다름'
          : ` · 되돌리면${plus ? ` +${plus}곡` : ''}${minus ? ` −${minus}곡` : ''}`;
      return `<div class="ver">
  <div class="ver-head"><div class="meta"><div class="title">${fmtDate(v.at)} · ${esc(SOURCE[v.source] || v.source || '')}</div><div class="sub">${esc(v.name)} · ${v.entries.length}곡${diff}</div></div>
    <button class="btn small" data-restore="${v.at}" ${same ? 'disabled' : ''}>되돌리기</button></div>
  <ol class="ver-tracks" hidden>${v.entries.slice(0, 300).map((id) => `<li class="${cur.has(id) ? '' : 'gone'}">${esc(title(id))}</li>`).join('')}</ol>
</div>`;
    })
    .join('');
  const at = await dialog({
    title: `변경 이력 · ${p.name}`,
    cls: 'wide',
    html: versions.length
      ? `<p>곡을 넣고 빼거나 순서를 바꾸기 전 모습이 최대 50개까지 남아요. 줄을 누르면 곡 목록이 보여요. 되돌려도 지금 모습이 이력에 남아서 다시 돌아올 수 있어요.</p><div class="ver-list">${rows}</div>`
      : '<p>아직 바뀐 적이 없어요. 곡을 넣거나 빼고 순서를 바꾸면 그 전 모습이 여기에 남아요.</p>',
    actions: [{ label: '닫기', value: null }],
    onOpen: (d, done) =>
      d.querySelector('.dlg-body').addEventListener('click', (e) => {
        const r = e.target.closest('[data-restore]');
        if (r) return done(Number(r.dataset.restore));
        const h = e.target.closest('.ver-head');
        if (h) h.nextElementSibling.hidden = !h.nextElementSibling.hidden;
        return undefined;
      }),
  });
  if (!at) return;
  try {
    await post(`/api/playlists/${p.id}/restore`, { at });
    await reloadPlaylists();
    toast('그때 모습으로 되돌렸어요');
    ctx.refresh?.({ keepScroll: true });
  } catch (e) {
    toast(e.message, 4000);
  }
}

// ───── 중복 곡 정리 ─────
export async function dedupeDialog(p) {
  const getT = (id) => store.tracks.get(id);
  let similar = true;
  let dups = playlistDuplicates(p.entries, getT, { similar });
  if (!dups.length) {
    toast('중복된 곡이 없어요');
    return;
  }
  const list = () =>
    dups.length
      ? dups
          .map((x) => {
            const t = getT(x.id);
            return `<div class="kv"><span>${x.index + 1}번째 · ${x.kind === 'same' ? '같은 곡' : '같은 제목·가수'}</span><b>${esc(t?.title || '(PC에 없는 곡)')}${t ? ` — ${esc(t.artist)}` : ''}</b></div>`;
          })
          .join('')
      : '<p class="dz-note">같은 파일이 두 번 들어간 곡은 없어요</p>';
  const v = await dialog({
    title: `중복 곡 정리 · ${p.name}`,
    html: `<p>처음 나온 곡은 남기고, 뒤에 또 나온 곡을 빼요. 빼기 전 모습은 변경 이력에 남아요.</p>
<div class="dz-switch"><span>같은 제목·가수의 다른 파일도<small>길이가 3초 안쪽으로 같으면 같은 곡으로 봐요 (라이브·리믹스는 보통 길이가 달라서 남아요)</small></span><label class="switch"><input type="checkbox" data-sim checked aria-label="같은 제목·가수의 다른 파일도"><span></span></label></div>
<div class="kv-list dup-list">${list()}</div>`,
    actions: [
      { label: '취소', value: null },
      { label: '정리하기', value: () => (dups.length ? 'go' : null) },
    ],
    onOpen: (d) =>
      d.querySelector('[data-sim]').addEventListener('change', (e) => {
        similar = e.target.checked;
        dups = playlistDuplicates(p.entries, getT, { similar });
        d.querySelector('.dup-list').innerHTML = list();
      }),
  });
  if (v === 'go') await save(p, { entries: withoutDuplicates(p.entries, dups) }, `${dups.length}곡을 뺐어요`);
}

// ───── 지운 재생목록 ─────
export async function trashDialog() {
  let lists;
  try {
    ({ lists } = await get('/api/playlist-trash'));
  } catch (e) {
    toast(e.message);
    return;
  }
  const id = await dialog({
    title: '지운 재생목록',
    html: lists.length
      ? `<p>지운 재생목록을 되살릴 수 있어요. 곡 파일은 처음부터 그대로예요.</p><div class="dlg-list">${lists
          .map(
            (l) =>
              `<div class="row"><div class="thumb folder-icon">${icon('trash')}</div><div class="meta"><div class="title">${esc(l.name)}</div><div class="sub">${l.count}곡 · ${fmtAgo(l.deletedAt)} 지움</div></div><div class="trail"><button class="btn small" data-undelete="${esc(l.id)}">되살리기</button></div></div>`,
          )
          .join('')}</div>`
      : '<p>지운 재생목록이 없어요.</p>',
    actions: [{ label: '닫기', value: null }],
    onOpen: (d, done) =>
      d.querySelector('.dlg-body').addEventListener('click', (e) => {
        const b = e.target.closest('[data-undelete]');
        if (b) done(b.dataset.undelete);
      }),
  });
  if (!id) return;
  try {
    const p = await post(`/api/playlist-trash/${encodeURIComponent(id)}/restore`);
    await reloadPlaylists();
    toast(`"${p.name}"을(를) 되살렸어요`);
  } catch (e) {
    toast(e.message, 4000);
  }
}
