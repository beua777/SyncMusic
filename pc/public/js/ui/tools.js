// 라이브러리 도구: 점검(없는 파일·태그·커버·가사·못 여는 파일·재생목록) · 중복 곡 정리 · 변경 기록 · 오류 기록
import { del, get, post } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { esc, fmtAgo, fmtTime } from '../util.js';
import { confirmDialog, toast } from './dom.js';
import { qualityBadge } from './sound.js';

const fmtBytes = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}MB` : `${Math.round((n || 0) / 1024)}KB`);
const fmtDate = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const base = (p) => String(p ?? '').split(/[\\/]/).pop();
const SRC = { play: '재생', ui: '화면', lyrics: '가사', sync: '동기화', server: '서버', network: '네트워크' };

let dupGroups = [];
let errFilter = 'all';
let errItems = [];

const trackList = (arr, more = 0) =>
  arr.length
    ? `<ul class="chk-list">${arr.map((t) => `<li><b>${esc(t.title)}</b>${t.artist ? ` — ${esc(t.artist)}` : ''}<small>${esc(t.path || '')}</small></li>`).join('')}${more > arr.length ? `<li class="more">…외 ${more - arr.length}곡</li>` : ''}</ul>`
    : '';

// 점검 한 줄: 문제없으면 체크, 있으면 느낌표 + 펼치면 목록
const item = ({ ok, label, count, body = '', action = '' }) =>
  `<details class="chk${ok ? ' ok' : ''}"${ok || !body ? ' data-empty' : ''}><summary>${icon(ok ? 'check' : 'warning')}<span class="label">${label}</span><b>${count}</b>${action}</summary>${body}</details>`;

export async function toolsView(el) {
  const route = ctx.route;
  ctx.list = { ids: [], source: null };
  if (!el.querySelector('.tools')) el.innerHTML = '<div class="tools"><div class="empty compact"><p>라이브러리를 점검하는 중…</p></div></div>';
  let check;
  let scans;
  try {
    [check, { groups: dupGroups }, { scans }] = await Promise.all([get('/api/library/check'), get('/api/library/duplicates'), get('/api/library/changes')]);
  } catch (e) {
    el.innerHTML = `<div class="empty">${icon('warning')}<h3>점검하지 못했어요</h3><p>${esc(e.message)}</p></div>`;
    return { title: '라이브러리 도구' };
  }
  if (ctx.route !== route) return {}; // 그사이 다른 화면으로 감
  const c = check;
  const brokenLists = c.playlists.reduce((n, p) => n + p.missing, 0);
  el.innerHTML = `<div class="tools">
<div class="list-head"><span class="count">${c.total}곡 점검 · ${fmtAgo(c.checkedAt)}</span><span class="spacer"></span><button class="btn small" data-act="tools-rescan">${icon('sync')}음악 폴더 다시 검색</button><a class="btn small" href="#/errors">${icon('warning')}오류 기록</a></div>
<div class="card chk-card">
  ${item({ ok: !c.missing.length, label: '파일이 없어진 곡', count: c.missing.length, body: `<p class="dz-note">옮기거나 지운 파일이에요. 다시 검색하면 라이브러리에서 빠져요</p>${trackList(c.missing)}` })}
  ${item({ ok: !c.zeroDuration.length, label: '길이를 못 읽은 곡', count: c.zeroDuration.length, body: `<p class="dz-note">파일이 깨졌거나 아직 받는 중일 수 있어요. 한 번 재생하면 길이가 채워져요</p>${trackList(c.zeroDuration)}` })}
  ${item({ ok: !c.untagged.count, label: '태그(제목·가수)가 없는 곡', count: c.untagged.count, body: `<p class="dz-note">파일 이름이 제목으로, 가수는 &lt;알 수 없음&gt;으로 보여요. 태그 편집 프로그램(Mp3tag 등)으로 채우면 다음 검색 때 반영돼요</p>${trackList(c.untagged.items, c.untagged.count)}` })}
  ${item({ ok: !c.noCover.count, label: '커버가 없는 곡', count: c.noCover.count, action: c.noCover.count ? '<a class="btn small" href="#/search/커버%20없는">보기</a>' : '' })}
  ${item({ ok: !c.noLyrics.count, label: '가사가 없는 곡', count: c.noLyrics.count, action: c.noLyrics.count ? '<a class="btn small" href="#/search/가사%20없는">보기</a>' : '' })}
  ${item({ ok: !c.unsupported.length, label: '열 수 없는 형식의 파일', count: c.unsupported.length, body: `<p class="dz-note">이 앱(브라우저)에서 재생할 수 없는 형식이에요 (WMA·APE 등). MP3·FLAC·M4A·OGG로 바꾸면 들을 수 있어요</p><ul class="chk-list">${c.unsupported.map((p) => `<li><b>${esc(base(p))}</b><small>${esc(p)}</small></li>`).join('')}</ul>` })}
  ${item({ ok: !brokenLists, label: '재생목록에 있지만 PC에 없는 곡', count: brokenLists, body: `<p class="dz-note">폰에서 아직 받지 않은 곡일 수도 있어요 (다음 동기화 때 들어오면 다시 보여요)</p><ul class="chk-list">${c.playlists.map((p) => `<li><b>${esc(p.name)}</b> · ${p.missing}/${p.total}곡</li>`).join('')}</ul>`, action: brokenLists ? '<button class="btn small" data-act="tools-clean">목록에서 빼기</button>' : '' })}
  ${item({ ok: !c.playErrors.length, label: '최근 재생 오류', count: c.playErrors.length, body: `<ul class="chk-list">${c.playErrors.map((e) => `<li><b>${esc(e.message)}</b><small>${fmtAgo(e.at)}${e.count > 1 ? ` · ${e.count}번` : ''}${e.context?.path ? ` · ${esc(e.context.path)}` : ''}</small></li>`).join('')}</ul>` })}
  ${item({ ok: !c.duplicates, label: '같은 곡 다른 파일 (중복)', count: c.duplicates, action: c.duplicates ? '<button class="btn small" data-act="tools-dup-go">아래에서 정리</button>' : '' })}
</div>
${dupSection()}
<div class="section-title">변경 기록 · 음악 폴더를 검색하거나 폰에서 받을 때마다</div>
<div class="card">${scans.length ? scans.map(scanRow).join('') : '<div class="empty compact"><p>아직 기록이 없어요. 곡이 들어오거나 없어지면 여기에 남아요</p></div>'}</div>
</div>`;
  return { title: '라이브러리 도구' };
}

function dupSection() {
  if (!dupGroups.length) return '<div class="section-title" id="dup-sec">중복 곡</div><div class="card"><div class="empty compact"><p>같은 곡이 여러 파일로 있는 경우가 없어요 👍</p></div></div>';
  const groups = dupGroups
    .map(
      (g, gi) => `<div class="card dup-group" data-g="${gi}">
  ${g
    .map(
      (t, i) => `<label class="row dup-row"><input type="radio" name="keep-${gi}" value="${esc(t.id)}" ${i === 0 ? 'checked' : ''} aria-label="이 파일 남기기">
    <div class="meta"><div class="title">${esc(t.title)} <span class="badge">${esc(qualityBadge(t))}</span>${i === 0 ? '<span class="badge good">음질 가장 좋음</span>' : ''}</div>
    <div class="sub">${esc(t.artist)} · ${fmtTime(t.duration)}${t.size ? ` · ${fmtBytes(t.size)}` : ''} · ${t.playCount}회 재생</div><div class="sub path">${esc(t.path)}</div></div>
    <div class="trail"><button class="icon-btn keep" data-act="dup-play" data-id="${esc(t.id)}" aria-label="들어 보기" title="들어 보기">${icon('play')}</button><button class="icon-btn keep" data-act="dup-reveal" data-id="${esc(t.id)}" aria-label="파일 위치 열기" title="파일 위치 열기">${icon('folderOpen')}</button></div></label>`,
    )
    .join('')}
  <div class="dup-foot"><span>고른 파일만 남기고 나머지는 휴지통으로 · 재생목록·재생 횟수는 남기는 곡으로 옮겨요</span><button class="btn small danger" data-act="dup-clean" data-g="${gi}">${icon('trash')}나머지 휴지통으로</button></div>
</div>`,
    )
    .join('');
  return `<div class="section-title row-title" id="dup-sec">중복 곡 · ${dupGroups.length}묶음 <button class="btn small" data-act="dup-all">${icon('sparkle')}모두 음질 좋은 것만 남기기</button></div><div class="dup-groups">${groups}</div>`;
}

function scanRow(s) {
  const n = (arr, cls, sign) => (arr?.length ? `<span class="${cls}">${sign}${arr.length}</span>` : '');
  const sec = (title, arr) => (arr?.length ? `<div class="dz-sub">${title} · ${arr.length}</div>${trackList(arr.filter(Boolean))}` : '');
  return `<details class="chk chg"><summary>${icon(s.source === 'sync' ? 'phone' : 'folder')}<span class="label">${fmtDate(s.at)} · ${s.source === 'sync' ? '폰에서 받음' : '폴더 검색'}</span><span class="chg-n">${n(s.added, 'plus', '+')}${n(s.removed, 'minus', '−')}${n(s.changed, 'mod', '~')}</span></summary>
${sec('추가된 곡', s.added)}${sec('없어진 곡', s.removed)}${sec('태그가 바뀐 곡', s.changed)}</details>`;
}

// ───── 오류 기록 ─────

export async function errorsView(el) {
  const route = ctx.route;
  ctx.list = { ids: [], source: null };
  try {
    ({ items: errItems } = await get('/api/errors'));
  } catch (e) {
    el.innerHTML = `<div class="empty">${icon('warning')}<h3>오류 기록을 못 읽었어요</h3><p>${esc(e.message)}</p></div>`;
    return { title: '오류 기록' };
  }
  if (ctx.route !== route) return {};
  renderErrors(el);
  return { title: '오류 기록' };
}

function renderErrors(el) {
  const counts = new Map();
  for (const e of errItems) counts.set(e.source, (counts.get(e.source) || 0) + 1);
  if (errFilter !== 'all' && !counts.has(errFilter)) errFilter = 'all';
  const shown = errFilter === 'all' ? errItems : errItems.filter((e) => e.source === errFilter);
  const chip = (v, label, n) => `<button class="chip${errFilter === v ? ' on' : ''}" data-errf="${v}"><span>${label}${n !== undefined ? ` ${n}` : ''}</span></button>`;
  el.innerHTML = `<div class="tools">
<div class="list-head wrap"><div class="chips">${chip('all', '전체', errItems.length)}${[...counts].map(([k, n]) => chip(k, SRC[k] || k, n)).join('')}</div><span class="spacer"></span>
  ${errItems.length ? `<button class="btn small" data-act="err-copy">${icon('copy')}복사</button><button class="btn small danger" data-act="err-clear">${icon('trash')}모두 지우기</button>` : ''}</div>
<div class="card">${
    shown.length
      ? shown
          .map(
            (e) => `<details class="chk err"><summary><span class="badge src">${esc(SRC[e.source] || e.source)}</span><span class="label">${esc(e.message)}</span>${e.count > 1 ? `<b>×${e.count}</b>` : ''}<time>${fmtAgo(e.at)}</time></summary>
${e.detail ? `<pre>${esc(e.detail)}</pre>` : ''}${e.context ? `<pre>${esc(JSON.stringify(e.context, null, 1))}</pre>` : ''}<p class="dz-note">${fmtDate(e.at)}</p></details>`,
          )
          .join('')
      : '<div class="empty compact"><p>오류가 없어요 👍</p></div>'
  }</div>
<p class="dz-note">재생할 수 없는 파일 · 화면 오류 · 가사·번역 서버 연결 실패 · 동기화 문제가 여기에 남아요 (최근 500개). 문제를 알릴 때 "복사"해서 붙여 넣으면 돼요</p>
</div>`;
}

// ───── 동작 ─────

export function bindToolsEvents(root) {
  root.addEventListener('click', async (e) => {
    if (!root.querySelector('.tools')) return;
    const f = e.target.closest('[data-errf]');
    if (f) {
      errFilter = f.dataset.errf;
      return renderErrors(root);
    }
    const b = e.target.closest('[data-act]');
    if (!b) return undefined;
    const act = b.dataset.act;
    if (b.closest('summary') && act) e.preventDefault(); // 줄 안의 버튼을 눌러도 펼쳐지지 않게
    const p = ctx.player;
    try {
      switch (act) {
        case 'tools-rescan':
          await post('/api/library/rescan');
          return toast('음악 폴더를 다시 검색해요. 끝나면 점검 결과도 새로 고쳐져요');
        case 'tools-clean': {
          const ok = await confirmDialog('재생목록 정리', 'PC에 없는 곡을 모든 재생목록에서 뺄까요? 폰에서 아직 받지 않은 곡이면 다음 동기화 때 폰 목록에서도 빠질 수 있어요. 빼기 전 모습은 변경 이력에 남아요.', { okLabel: '빼기', danger: true });
          if (!ok) return undefined;
          const r = await post('/api/library/clean-playlists');
          toast(`${r.removed}곡을 재생목록에서 뺐어요`);
          return ctx.refresh({ keepScroll: true });
        }
        case 'tools-dup-go':
          return document.getElementById('dup-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        case 'dup-play': {
          e.preventDefault();
          p.playNext([b.dataset.id]);
          return p.next();
        }
        case 'dup-reveal':
          e.preventDefault();
          return post(`/api/tracks/${b.dataset.id}/reveal`);
        case 'dup-clean': {
          const gi = Number(b.dataset.g);
          const g = dupGroups[gi];
          const keep = root.querySelector(`input[name="keep-${gi}"]:checked`)?.value || g[0].id;
          const others = g.filter((t) => t.id !== keep);
          const ok = await confirmDialog('휴지통으로 보내기', `${others.length}개 파일을 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.\n\n${others.map((t) => base(t.path)).join('\n')}`, { okLabel: '휴지통으로', danger: true });
          if (!ok) return undefined;
          const r = await post('/api/library/recycle', { groups: [{ ids: g.map((t) => t.id), keep }] });
          return toast(`${r.recycled}개 파일을 휴지통으로 보냈어요. 다시 검색하는 중…`, 3500);
        }
        case 'dup-all': {
          const n = dupGroups.reduce((s, g) => s + g.length - 1, 0);
          const ok = await confirmDialog('모두 정리', `${dupGroups.length}묶음에서 음질이 가장 좋은 파일만 남기고 ${n}개 파일을 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`, { okLabel: '휴지통으로', danger: true });
          if (!ok) return undefined;
          const r = await post('/api/library/recycle', { groups: dupGroups.map((g) => ({ ids: g.map((t) => t.id), keep: g[0].id })) });
          return toast(`${r.recycled}개 파일을 휴지통으로 보냈어요. 다시 검색하는 중…`, 3500);
        }
        case 'err-copy': {
          const text = errItems.map((x) => `[${fmtDate(x.at)}] (${SRC[x.source] || x.source}) ${x.message}${x.count > 1 ? ` ×${x.count}` : ''}${x.detail ? `\n${x.detail}` : ''}`).join('\n\n');
          await navigator.clipboard.writeText(text);
          return toast('오류 기록을 복사했어요');
        }
        case 'err-clear': {
          if (!(await confirmDialog('오류 기록 지우기', '모든 오류 기록을 지울까요?', { okLabel: '지우기', danger: true }))) return undefined;
          await del('/api/errors');
          errItems = [];
          return renderErrors(root);
        }
        default:
          return undefined;
      }
    } catch (err) {
      toast(err.message, 4000);
    }
    return undefined;
  });
}
