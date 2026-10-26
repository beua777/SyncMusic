// 가사: 표시(크기·정렬·강조 방식) · 번역 나란히(.lrc의 번역 줄 → 없으면 자동 번역) · 온라인에서 찾기(LRCLIB) · 시간 맞춰 편집
import { get, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { fmtStamp, parseLrc, plainLines, toLrc } from '../lrc.js';
import { store } from '../store.js';
import { esc, fmtTime } from '../util.js';
import { dialog, openMenu, toast } from './dom.js';

let el = null;
let state = { id: null, synced: null, plain: null, idx: -1, trans: null };
let scrollHold = 0;
const translations = new Map(); // 곡 ID → 번역 줄

const lyricsOpts = () => ({ size: 'm', align: 'left', style: 'scale', translate: true, online: true, ...(store.settings.lyrics || {}) });

async function saveOpts(patch) {
  store.settings.lyrics = { ...lyricsOpts(), ...patch };
  applyOpts();
  try {
    store.settings = await put('/api/settings', { lyrics: patch });
  } catch (e) {
    toast(e.message);
  }
}

function applyOpts() {
  if (!el) return;
  const o = lyricsOpts();
  el.dataset.size = o.size;
  el.dataset.align = o.align;
  el.dataset.style = o.style;
}

export function initLyrics(container) {
  el = container;
  applyOpts();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ly]');
    if (b) return toolbar(b);
    const p = e.target.closest('p[data-t]');
    if (p) ctx.player.seek(Number(p.dataset.t));
    return undefined;
  });
  el.addEventListener('wheel', () => {
    scrollHold = Date.now() + 4000; // 직접 스크롤하는 동안은 따라가지 않음
  });
}

export function resetLyrics() {
  state = { id: null, synced: null, plain: null, idx: -1, trans: null };
}

// 설정 화면에서 가사 표시 방식(크기·정렬·번역)을 바꿨을 때
export function lyricsSettingsChanged() {
  applyOpts();
  const t = ctx.player?.track;
  if (!el || !t || state.id !== t.id) return;
  render(t);
  if (lyricsOpts().translate) translate(t);
}

const bar = (t) => `<div class="ly-bar">
  <button class="icon-btn" data-ly="opts" title="가사 표시 방식" aria-label="가사 표시 방식">${icon('settings')}</button>
  <button class="icon-btn${lyricsOpts().translate ? ' on' : ''}" data-ly="trans" title="번역 보기" aria-label="번역 보기">${icon('translate')}</button>
  <span class="spacer"></span>
  ${lyricsOpts().online ? `<button class="btn small" data-ly="find">${icon('search')}가사 찾기</button>` : ''}
  <button class="btn small" data-ly="edit" ${t ? '' : 'disabled'}>${icon('edit')}편집</button>
</div>`;

export async function loadLyrics(force = false) {
  if (!el) return;
  const t = ctx.player.track;
  applyOpts();
  if (!t) {
    resetLyrics();
    el.innerHTML = `${bar(null)}<div class="lyrics-empty">재생 중인 곡이 없어요</div>`;
    return;
  }
  if (state.id === t.id && !force) return;
  state = { id: t.id, synced: null, plain: null, idx: -1, trans: null };
  el.innerHTML = `${bar(t)}<div class="lyrics-empty">가사를 불러오는 중…</div>`;
  try {
    const { text } = await get(`/api/tracks/${t.id}/lyrics/raw`);
    if (state.id !== t.id) return;
    const parsed = parseLrc(text || '');
    if (parsed.synced) state.synced = parsed.lines;
    else if (parsed.lines.length) state.plain = parsed.lines.map((l) => l.text);
    render(t);
    if (lyricsOpts().translate) translate(t);
  } catch {
    el.innerHTML = `${bar(t)}<div class="lyrics-empty">가사를 불러오지 못했어요</div>`;
  }
}

function render(t) {
  const trans = state.trans;
  const sub = (l, i) => {
    const s = l.sub?.length ? l.sub : trans?.[i] ? [trans[i]] : [];
    return lyricsOpts().translate && s.length ? s.map((x) => `<span class="sub">${esc(x)}</span>`).join('') : '';
  };
  if (state.synced?.length) {
    el.innerHTML = `${bar(t)}<div class="lyrics">${state.synced.map((l, i) => `<p data-li="${i}" data-t="${l.t}"><span class="ln">${esc(l.text) || '♪'}</span>${sub(l, i)}</p>`).join('')}</div>`;
    highlightLyric(ctx.player.time, true);
  } else if (state.plain?.length) {
    el.innerHTML = `${bar(t)}<div class="lyrics plain">${state.plain.map((l, i) => `<div class="pl">${esc(l)}${sub({}, i)}</div>`).join('')}</div>`;
  } else {
    el.innerHTML = `${bar(t)}<div class="lyrics-empty">가사가 없어요<br><small>${lyricsOpts().online ? '"가사 찾기"로 온라인에서 찾거나, ' : ''}"편집"으로 직접 넣을 수 있어요.<br>곡 파일의 가사 태그나 같은 이름의 .lrc 파일도 읽어요</small></div>`;
  }
}

// 파일에 번역 줄이 없을 때만 자동 번역 (한국어 가사는 그대로)
async function translate(t) {
  const lines = state.synced?.map((l) => l.text) || state.plain;
  if (!lines?.length || state.synced?.some((l) => l.sub?.length)) return;
  if (translations.has(t.id)) {
    state.trans = translations.get(t.id);
    render(t);
    return;
  }
  try {
    const r = await post('/api/lyrics/translate', { lines });
    if (r.same) return;
    translations.set(t.id, r.lines);
    if (state.id !== t.id) return;
    state.trans = r.lines;
    render(t);
  } catch (e) {
    if (!/꺼져/.test(e.message)) toast(e.message, 3000);
  }
}

export function highlightLyric(time, force = false) {
  const s = state.synced;
  if (!s || !el) return;
  let i = -1;
  for (let k = 0; k < s.length && s[k].t <= time + 0.15; k++) i = k;
  const p = el.querySelector(`p[data-li="${i}"]`);
  // 노래방 방식: 지금 줄이 시간에 맞춰 왼쪽부터 칠해진다
  if (p && lyricsOpts().style === 'karaoke') {
    const end = s[i + 1]?.t ?? s[i].t + 4;
    p.style.setProperty('--kp', `${Math.max(0, Math.min(100, ((time - s[i].t) / Math.max(0.3, end - s[i].t)) * 100))}%`);
  }
  if (i === state.idx && !force) return;
  state.idx = i;
  el.querySelector('p.now')?.classList.remove('now');
  if (!p) return;
  p.classList.add('now');
  if (Date.now() > scrollHold && el.offsetParent !== null) p.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
}

function toolbar(b) {
  const t = ctx.player.track;
  const act = b.dataset.ly;
  if (act === 'trans') {
    const on = !lyricsOpts().translate;
    saveOpts({ translate: on }).then(() => {
      if (t) {
        render(t);
        if (on) translate(t);
      }
    });
    return;
  }
  if (act === 'find') return t && findOnline(t);
  if (act === 'edit') return t && openLyricsEditor(t);
  if (act === 'opts') {
    const o = lyricsOpts();
    const mark = (v, cur) => (v === cur ? 'check' : 'note');
    openMenu(
      [
        { icon: mark('s', o.size), label: '글자 작게', run: () => saveOpts({ size: 's' }) },
        { icon: mark('m', o.size), label: '글자 보통', run: () => saveOpts({ size: 'm' }) },
        { icon: mark('l', o.size), label: '글자 크게', run: () => saveOpts({ size: 'l' }) },
        { icon: mark('xl', o.size), label: '글자 아주 크게', run: () => saveOpts({ size: 'xl' }) },
        '-',
        { icon: mark('left', o.align), label: '왼쪽 정렬', run: () => saveOpts({ align: 'left' }) },
        { icon: mark('center', o.align), label: '가운데 정렬', run: () => saveOpts({ align: 'center' }) },
        '-',
        { icon: mark('scale', o.style), label: '지금 줄 크게', run: () => saveOpts({ style: 'scale' }) },
        { icon: mark('color', o.style), label: '지금 줄 색만', run: () => saveOpts({ style: 'color' }) },
        { icon: mark('karaoke', o.style), label: '노래방처럼 칠하기', run: () => saveOpts({ style: 'karaoke' }) },
      ],
      { anchor: b },
    );
  }
  return undefined;
}

// ───── 온라인에서 가사 찾기 (LRCLIB) ─────
// 서버가 곡 제목에서 진짜 제목·가수 후보를 뽑아 여러 번 찾고, 결과마다 얼마나 맞는지 점수를 매겨 준다.
// 창은 바로 열고(찾는 중…) 결과가 오면 채운다. 제목·가수를 고치거나 다른 후보를 눌러 같은 창에서 다시 찾는다
const FIT = [
  [0.8, 'good', '잘 맞음'],
  [0.65, 'ok', '비슷함'],
  [0, 'low', '다를 수 있음'],
];

function durText(d) {
  if (d === null || d === undefined) return '';
  return Math.abs(d) <= 2 ? ' · 길이 같음' : ` · 길이 ${d > 0 ? '+' : '−'}${Math.abs(d)}초`;
}

function foundHtml(results, terms, title, artist) {
  const alts = (list, cur, k) =>
    list
      .filter((x) => x !== cur)
      .slice(0, 5)
      .map((x) => `<button class="chip" data-k="${k}" data-v="${esc(x)}">${esc(x)}</button>`)
      .join('');
  const altTitles = alts(terms.titles || [], title, 'title');
  const altArtists = alts(terms.artists || [], artist, 'artist');
  const row = (r, i) => {
    const [, cls, label] = FIT.find(([min]) => r.score >= min);
    return `<div class="row" data-i="${i}"><div class="meta"><div class="title">${esc(r.title)} ${r.synced ? '<span class="badge">시간 맞춤</span>' : ''}${r.instrumental ? '<span class="badge">연주곡</span>' : ''}</div><div class="sub">${esc(r.artist)}${r.album ? ` · ${esc(r.album)}` : ''} · ${fmtTime(r.duration)}${durText(r.durDiff)}</div></div><span class="lf-score ${cls}" title="제목·가수·길이가 얼마나 맞는지">${label} ${Math.round(r.score * 100)}%</span></div>`;
  };
  return `${altTitles || altArtists ? `<div class="lf-alts">${altTitles ? `<span>다른 제목</span>${altTitles}` : ''}${altArtists ? `<span>다른 가수</span>${altArtists}` : ''}</div>` : ''}
  ${terms.translated?.length ? `<p class="dz-note">한국어 제목을 일본어로 번역해서 원제로도 찾았어요: ${esc(terms.translated.join(', '))}</p>` : ''}
  ${terms.translateFailed ? '<p class="dz-note">구글 번역이 지금 안 돼서 한국어 제목을 원제로 바꿔 찾지는 못했어요. 위에 원제를 직접 넣어 찾을 수 있어요.</p>' : ''}
  ${terms.korean ? '<p class="dz-note">한국어 커버는 온라인에 원곡(일본어 등) 가사만 있는 경우가 많아요. 원곡 가사를 쓰고 "번역"을 켜면 한국어 뜻을 함께 볼 수 있어요.</p>' : ''}
  <div class="dlg-list">${
    results.length
      ? results.map(row).join('')
      : `<div class="empty compact"><p>찾은 가사가 없어요.<br>제목을 원래 제목(일본어·영어)으로 바꾸거나 가수를 넣어 다시 찾아보세요.</p></div>`
  }</div>`;
}

async function findOnline(t) {
  let results = [];
  let picked = null;
  let open = true;
  let seq = 0; // 다시 찾기를 여러 번 누르면 마지막 것만 그린다
  const v = await dialog({
    title: '가사 찾기 · LRCLIB',
    cls: 'wide',
    html: `<div class="ly-find">
  <div class="lf-form">
    <label class="search"><span>제목</span><input type="search" data-f="title" value="${esc(t.title)}" placeholder="노래 제목"></label>
    <label class="search"><span>가수</span><input type="search" data-f="artist" placeholder="몰라도 돼요"></label>
    <button class="btn primary small" data-lf="go">${icon('search')}다시 찾기</button>
  </div>
  <div class="lf-out"></div>
  <pre class="ly-preview" hidden></pre>
</div>`,
    actions: [
      { label: '닫기', value: null },
      { label: '이 가사 쓰기', value: () => (picked ? { use: picked } : null) },
    ],
    onOpen: (d) => {
      const field = (k) => d.querySelector(`input[data-f="${k}"]`);
      const out = d.querySelector('.lf-out');
      const pre = d.querySelector('.ly-preview');
      const choose = (r) => {
        for (const x of out.querySelectorAll('.row.on')) x.classList.remove('on');
        r.classList.add('on');
        picked = results[Number(r.dataset.i)];
        pre.hidden = false;
        pre.textContent = picked.lyrics || '(연주곡)';
      };
      const search = async (ask) => {
        const mine = ++seq;
        picked = null;
        pre.hidden = true;
        out.innerHTML = '<div class="empty compact"><p>찾는 중…</p></div>';
        let data;
        try {
          data = await get(`/api/tracks/${t.id}/lyrics/online${ask ? `?${new URLSearchParams(ask)}` : ''}`);
        } catch (e) {
          if (open && mine === seq) out.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`;
          return;
        }
        if (!open || mine !== seq) return;
        results = data.results || [];
        const terms = data.terms || { titles: [], artists: [] };
        if (!ask) {
          // 처음에는 곡 제목 그대로 → 서버가 뽑은 제목·가수로 (가수가 확실하지 않으면 비워 두고 후보는 칩으로)
          if (field('title').value === t.title) field('title').value = terms.titles[0] || t.title;
          if (!field('artist').value) field('artist').value = (terms.sure && terms.artists[0]) || '';
        }
        out.innerHTML = foundHtml(results, terms, field('title').value, field('artist').value);
        for (const c of out.querySelectorAll('.lf-alts .chip')) {
          c.onclick = () => {
            field(c.dataset.k).value = c.dataset.v;
            again();
          };
        }
        // 잘 맞는 게 있으면 미리 골라 둔다
        const first = out.querySelector('.row[data-i="0"]');
        if (first && results[0].score >= 0.8 && !results[0].instrumental) choose(first);
      };
      const again = () => {
        const ask = { title: field('title').value.trim(), artist: field('artist').value.trim() };
        if (ask.title || ask.artist) search(ask);
      };
      for (const k of ['title', 'artist']) field(k).onkeydown = (e) => e.key === 'Enter' && again();
      d.querySelector('[data-lf="go"]').onclick = again;
      out.onclick = (e) => {
        const r = e.target.closest('.row[data-i]');
        if (r) choose(r);
      };
      search(null);
    },
  });
  open = false;
  if (!v?.use) return undefined;
  if (!v.use.lyrics) return toast('가사가 없는 연주곡이에요');
  try {
    await put(`/api/tracks/${t.id}/lyrics`, { text: v.use.lyrics });
    toast(v.use.synced ? '시간 맞춘 가사를 저장했어요 (.lrc)' : '가사를 저장했어요. "편집"에서 시간을 맞출 수 있어요');
    translations.delete(t.id);
    if (ctx.player.track?.id === t.id) loadLyrics(true);
  } catch (e) {
    toast(e.message, 4000);
  }
  return undefined;
}

// ───── 시간 맞춰 가사 편집 ─────
// 노래를 들으면서 줄마다 Space(또는 "지금")를 누르면 그 시각이 찍힌다. 글로 직접 고칠 수도 있다.
export async function openLyricsEditor(t) {
  let text = '';
  try {
    text = (await get(`/api/tracks/${t.id}/lyrics/raw`)).text || '';
  } catch {
    // 없으면 빈 가사로
  }
  const parsed = parseLrc(text);
  let lines = parsed.synced ? parsed.lines.map((l) => ({ ...l })) : plainLines(text).map((s) => ({ t: null, text: s, sub: [] }));
  const meta = { ...parsed.meta };
  delete meta.offset;
  let cur = Math.max(0, lines.findIndex((l) => l.t === null));
  let raw = false;
  const p = ctx.player;
  const playingThis = () => p.loadedId === t.id;

  const listHtml = () =>
    lines
      .map(
        (l, i) =>
          `<div class="le-row${i === cur ? ' cur' : ''}" data-i="${i}"><button class="le-time" data-act="le-seek" data-i="${i}">${l.t === null ? '--:--.--' : fmtStamp(l.t)}</button><input type="text" value="${esc(l.text)}" data-i="${i}" spellcheck="false">${l.sub?.length ? `<span class="le-sub">${esc(l.sub.join(' / '))}</span>` : ''}</div>`,
      )
      .join('');

  const v = await dialog({
    title: `가사 편집 · ${t.title}`,
    cls: 'wide',
    html: `<div class="lyr-edit">
  <p class="dz-note">${playingThis() ? '노래를 들으면서, 그 줄이 시작될 때 <b>Space</b>(또는 "지금")를 누르면 시각이 찍히고 다음 줄로 가요.' : '이 곡을 재생하면 들으면서 시각을 찍을 수 있어요.'} 시각을 누르면 그 자리로 가요.</p>
  <div class="le-tools">
    <button class="btn small" data-act="le-play">${icon('play')}재생/멈춤</button>
    <button class="btn small" data-act="le-back">-3초</button>
    <button class="btn primary small" data-act="le-stamp">${icon('clock')}지금 (Space)</button>
    <button class="btn small" data-act="le-undo">한 줄 위로</button>
    <button class="btn small" data-act="le-shift" data-d="-0.1">모두 -0.1초</button>
    <button class="btn small" data-act="le-shift" data-d="0.1">모두 +0.1초</button>
    <button class="btn small" data-act="le-add">줄 추가</button>
    <button class="btn small" data-act="le-raw">${icon('edit')}글로 편집</button>
  </div>
  <div class="le-list">${listHtml()}</div>
  <textarea class="le-raw" hidden spellcheck="false"></textarea>
</div>`,
    actions: [
      { label: '취소', value: null },
      {
        label: '저장',
        value: (d) => {
          if (raw) return d.querySelector('.le-raw').value;
          const stamped = lines.filter((l) => l.text || l.sub?.length);
          if (stamped.length && stamped.every((l) => l.t === null)) return stamped.map((l) => l.text).join('\n');
          return toLrc(stamped, meta);
        },
      },
    ],
    onOpen: (d) => {
      const list = d.querySelector('.le-list');
      const ta = d.querySelector('.le-raw');
      const redraw = () => {
        list.innerHTML = listHtml();
        list.querySelector('.le-row.cur')?.scrollIntoView({ block: 'nearest' });
      };
      const stamp = () => {
        if (!playingThis()) return toast('이 곡을 재생해야 시각을 찍을 수 있어요');
        if (cur >= lines.length) return undefined;
        lines[cur].t = Math.round(p.time * 100) / 100;
        cur = Math.min(lines.length, cur + 1);
        redraw();
        return undefined;
      };
      list.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.i);
        if (Number.isInteger(i)) lines[i].text = e.target.value;
      });
      list.addEventListener('focusin', (e) => {
        const i = Number(e.target.dataset.i);
        if (Number.isInteger(i) && i !== cur) {
          cur = i;
          for (const r of list.querySelectorAll('.le-row')) r.classList.toggle('cur', Number(r.dataset.i) === cur);
        }
      });
      d.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'le-play') {
          if (!playingThis()) {
            p.playNext([t.id]);
            p.next();
          } else p.toggle();
        } else if (act === 'le-back') p.seekBy(-3);
        else if (act === 'le-stamp') stamp();
        else if (act === 'le-undo') {
          cur = Math.max(0, cur - 1);
          redraw();
        } else if (act === 'le-shift') {
          const dd = Number(b.dataset.d);
          for (const l of lines) if (l.t !== null) l.t = Math.max(0, Math.round((l.t + dd) * 100) / 100);
          redraw();
        } else if (act === 'le-add') {
          lines.splice(cur + 1, 0, { t: null, text: '', sub: [] });
          redraw();
          list.querySelector(`input[data-i="${cur + 1}"]`)?.focus();
        } else if (act === 'le-seek') {
          const l = lines[Number(b.dataset.i)];
          cur = Number(b.dataset.i);
          if (l.t !== null && playingThis()) p.seek(l.t);
          redraw();
        } else if (act === 'le-raw') {
          raw = !raw;
          if (raw) {
            ta.value = lines.some((l) => l.t !== null) ? toLrc(lines, meta) : lines.map((l) => l.text).join('\n');
          } else {
            const pp = parseLrc(ta.value);
            lines = pp.synced ? pp.lines.map((l) => ({ ...l })) : plainLines(ta.value).map((s) => ({ t: null, text: s, sub: [] }));
            cur = Math.max(0, lines.findIndex((l) => l.t === null));
            redraw();
          }
          ta.hidden = !raw;
          list.hidden = raw;
          b.classList.toggle('primary', raw);
        }
      });
      // 편집기 안에서 Space·Enter는 시각 찍기 (글자를 고치는 중이 아닐 때)
      d.addEventListener(
        'keydown',
        (e) => {
          if (raw || e.target.tagName === 'TEXTAREA') return;
          const typing = e.target.tagName === 'INPUT' && e.target.type === 'text';
          if ((e.code === 'Space' && !typing) || (e.key === 'Enter' && typing && e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            stamp();
          } else if (e.key === 'ArrowDown' && !typing) {
            cur = Math.min(lines.length - 1, cur + 1);
            redraw();
          } else if (e.key === 'ArrowUp' && !typing) {
            cur = Math.max(0, cur - 1);
            redraw();
          }
        },
        true,
      );
    },
  });
  if (v === null || v === undefined) return;
  if (!String(v).trim()) return toast('가사가 비어 있어서 저장하지 않았어요');
  try {
    await put(`/api/tracks/${t.id}/lyrics`, { text: v });
    toast('가사를 저장했어요 (.lrc)');
    translations.delete(t.id);
    if (ctx.player.track?.id === t.id) loadLyrics(true);
  } catch (e) {
    toast(e.message, 4000);
  }
}
