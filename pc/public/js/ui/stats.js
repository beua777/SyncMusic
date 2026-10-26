// 들은 기록 통계: 주간·월간·연간 리포트 · 시간대 · 아티스트 비율 · 오래 안 들은 곡 · 최근 추가 · 취향 추천 · 취향 변화 · 청취 목표
// 그리고 연말 결산(Wrapped)
import { get, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { fmtMinutes, peakHour, series } from '../statsdata.js';
import { store } from '../store.js';
import { esc, fmtAgo } from '../util.js';
import { reloadPlaylists, trackRow } from './common.js';
import { dialog, openMenu, toast } from './dom.js';

const KINDS = { week: '이번 주', month: '이번 달', year: '올해', all: '전체' };
const PREV = { week: '지난주', month: '지난달', year: '작년' };
const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

// 곡 목록 한 묶음: 라이브러리에 있는 곡만 누르면 재생 (ctx.groups로 이 묶음만 대기열이 됨)
function trackGroup(group, entries, sub, name) {
  const ids = [];
  const rows = entries
    .map((x) => {
      const t = store.tracks.get(x.id);
      if (!t) return `<div class="row gone"><div class="thumb"></div><div class="meta"><div class="title">${esc(x.title || '없는 곡')}</div><div class="sub">${esc(x.artist || '')} · PC에 없는 곡</div></div><div></div></div>`;
      ids.push(t.id);
      return trackRow(t, ids.length - 1, { sub: sub(x, t) });
    })
    .join('');
  ctx.groups[group] = { ids, source: { type: 'stats', name } };
  return `<div class="card list" data-group="${group}">${rows}</div>`;
}

const playBtns = (g, n) =>
  n ? `<button class="btn small" data-act="group-play" data-g="${g}">${icon('play')}재생</button><button class="btn small" data-act="group-shuffle" data-g="${g}">${icon('shuffle')}셔플</button>` : '';

function bars(items, unit = '분') {
  const max = Math.max(1, ...items.map((x) => x.v));
  return `<div class="chart-bars" style="--n:${items.length}">${items
    .map((x) => `<div class="chart-bar${x.future ? ' future' : ''}" title="${esc(x.title)}${x.future ? '' : ` · ${x.v}${unit}`}"><i style="height:${((x.v / max) * 100).toFixed(1)}%"></i><span>${esc(x.label)}</span></div>`)
    .join('')}</div>`;
}

function heat(h) {
  const max = Math.max(1, ...h.flat());
  const head = `<div class="hrow head"><span></span>${Array.from({ length: 24 }, (_, i) => `<span>${i % 3 === 0 ? i : ''}</span>`).join('')}</div>`;
  return `<div class="heat">${head}${h
    .map((row, d) => `<div class="hrow"><span>${DOW[d]}</span>${row.map((v, hr) => `<i style="--a:${v ? (0.18 + 0.82 * (v / max)).toFixed(2) : 0}" title="${DOW[d]}요일 ${hr}시 · ${v}분"></i>`).join('')}</div>`)
    .join('')}</div>`;
}

function share(list) {
  return `<div class="share">${list
    .map((a) => {
      const link = store.artistByName.has(a.artist) ? ` data-artist="${esc(a.artist)}"` : '';
      return `<div class="share-row"${link}><span class="name">${esc(a.artist || '알 수 없음')}</span><span class="track"><i style="width:${Math.max(1, a.share * 100).toFixed(1)}%"></i></span><b>${pct(a.share)}</b></div>`;
    })
    .join('')}</div>`;
}

function delta(cur, prev, kind, fmt = (v) => v) {
  if (prev === null || prev === undefined || !PREV[kind]) return '';
  const d = cur - prev;
  if (!d) return `<small>${PREV[kind]}와 같아요</small>`;
  return `<small class="${d > 0 ? 'up' : 'down'}">${PREV[kind]}보다 ${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</small>`;
}

const bar = (v, max) => `<span class="meter"><i style="width:${Math.min(100, max ? (v / max) * 100 : 0).toFixed(1)}%"></i></span>`;

export async function statsView(el, param) {
  const route = ctx.route;
  const kind = KINDS[param] ? param : 'week';
  ctx.list = { ids: [], source: null };
  if (!el.querySelector('.stats')) el.innerHTML = '<div class="stats"><div class="empty compact"><p>통계를 계산하는 중…</p></div></div>';
  let o;
  try {
    o = await get('/api/stats/overview');
  } catch (e) {
    el.innerHTML = `<div class="empty">${icon('warning')}<h3>통계를 못 읽었어요</h3><p>${esc(e.message)}</p></div>`;
    return { title: '통계' };
  }
  if (ctx.route !== route) return {};
  ctx.groups = {};
  const r = o[kind];
  const g = o.goals;
  const peak = peakHour(r.byHour);
  const seg = `<div class="seg">${Object.entries(KINDS)
    .map(([k, l]) => `<a href="#/stats/${k}" class="seg-a${k === kind ? ' on' : ''}">${l}</a>`)
    .join('')}</div>`;
  const kpi = (v, label, d = '') => `<div class="kpi"><b>${v}</b><span>${label}</span>${d}</div>`;
  const year = new Date().getFullYear();

  if (!o.total) {
    el.innerHTML = `<div class="stats"><div class="empty">${icon('chart')}<h3>아직 들은 기록이 없어요</h3><p>곡을 들으면 얼마나, 언제, 무엇을 들었는지 여기에 모여요.<br>기록은 이 PC에만 저장돼요.</p></div></div>`;
    return { title: '통계' };
  }

  const goals =
    g.dailyMinutes || g.weeklyNew
      ? `<section class="st-card goals"><div class="st-head"><h3>${icon('trophy')}청취 목표</h3><button class="btn small" data-act="goals">바꾸기</button></div>
  ${g.dailyMinutes ? `<div class="goal"><span>오늘 ${fmtMinutes(g.todayMinutes)} / ${fmtMinutes(g.dailyMinutes)}</span>${bar(g.todayMinutes, g.dailyMinutes)}<small>${g.todayMinutes >= g.dailyMinutes ? '오늘 목표를 채웠어요 🎉' : `${fmtMinutes(g.dailyMinutes - g.todayMinutes)} 남았어요`}${g.streak ? ` · ${g.streak}일째 이어서 채우는 중` : ''}</small></div>` : ''}
  ${g.weeklyNew ? `<div class="goal"><span>이번 주 새로 들은 곡 ${g.weekNew} / ${g.weeklyNew}곡</span>${bar(g.weekNew, g.weeklyNew)}<small>${g.weekNew >= g.weeklyNew ? '이번 주 목표를 채웠어요 🎉' : '처음 듣는 곡이 하나씩 쌓여요'}</small></div>` : ''}
</section>`
      : `<section class="st-card goals empty-goal"><div class="st-head"><h3>${icon('trophy')}청취 목표</h3><button class="btn small primary" data-act="goals">목표 정하기</button></div><p class="dz-note">하루에 들을 시간이나 한 주에 새로 들을 곡 수를 정하면, 얼마나 채웠는지 보여 줘요</p></section>`;

  const t = o.taste;
  const shift = (rows, sign) => rows.map((x) => `<li><span>${esc(x.name)}</span><b class="${sign > 0 ? 'up' : 'down'}">${sign > 0 ? '+' : '−'}${Math.round(Math.abs(x.delta) * 100)}%p</b></li>`).join('');
  const taste = t.enough
    ? `<div class="taste">
  <div><div class="dz-sub">요즘 더 듣는 가수</div><ul>${shift(t.artists.rising, 1) || '<li class="none">없음</li>'}</ul></div>
  <div><div class="dz-sub">요즘 덜 듣는 가수</div><ul>${shift(t.artists.falling, -1) || '<li class="none">없음</li>'}</ul></div>
  ${t.genres.rising.length || t.genres.falling.length ? `<div><div class="dz-sub">장르</div><ul>${shift(t.genres.rising, 1)}${shift(t.genres.falling, -1)}</ul></div>` : ''}
</div>${t.discovered.length ? `<p class="dz-note">최근 30일에 처음 들은 가수: ${t.discovered.map(esc).join(', ')}</p>` : ''}`
    : '<p class="dz-note">최근 30일과 그 전 석 달의 기록이 조금씩 더 쌓이면 보여 줘요</p>';

  const f = o.forgotten;
  const ra = o.recentlyAdded;
  ctx.groups.never = { ids: f.never.map((x) => x.id).filter((id) => store.tracks.has(id)), source: { type: 'stats', name: '한 번도 안 들은 곡' } };
  const weeks = ra.weeks.map((w) => ({ label: `${Number(w.week.slice(5, 7))}/${Number(w.week.slice(8))}`, title: `${w.week} 주`, v: w.count }));

  el.innerHTML = `<div class="stats">
<div class="list-head wrap">${seg}<span class="spacer"></span>
  <a class="btn small" href="#/wrapped/${year}">${icon('trophy')}${year} 결산</a>
  <button class="btn small" data-act="stats-export">${icon('export')}내보내기</button></div>
<div class="kpis">
  ${kpi(fmtMinutes(r.minutes), '들은 시간', delta(r.minutes, r.prev?.minutes, kind, fmtMinutes))}
  ${kpi(`${r.plays}번`, '재생', delta(r.plays, r.prev?.plays, kind, (v) => `${v}번`))}
  ${kpi(`${r.uniqueTracks}곡`, '들은 곡', delta(r.uniqueTracks, r.prev?.uniqueTracks, kind, (v) => `${v}곡`))}
  ${kpi(`${r.uniqueArtists}명`, '들은 가수')}
  ${kpi(`${r.activeDays}일`, '들은 날')}
  ${kpi(r.plays + r.skips ? pct(r.skips / (r.plays + r.skips)) : '0%', '넘긴 비율', `<small>${r.skips}번 넘김 · ${r.completed}번 끝까지</small>`)}
</div>
${goals}
<section class="st-card"><div class="st-head"><h3>${kind === 'week' || kind === 'month' ? '날마다 들은 시간' : '달마다 들은 시간'}</h3></div>${bars(series(kind, r.byDay, r.from, r.to))}</section>
<section class="st-card"><div class="st-head"><h3>언제 듣나요</h3>${peak ? `<span class="st-sub">주로 ${peak}쯤</span>` : ''}</div>${heat(r.heat)}</section>
<div class="st-grid">
  <section class="st-card"><div class="st-head"><h3>많이 들은 곡</h3>${playBtns('top', r.topTracks.length)}</div>${r.topTracks.length ? trackGroup('top', r.topTracks.slice(0, 10), (x) => `${x.artist} · ${x.plays}번 · ${fmtMinutes(x.secs / 60)}`, `${KINDS[kind]} 많이 들은 곡`) : '<p class="dz-note">아직 없어요</p>'}</section>
  <section class="st-card"><div class="st-head"><h3>아티스트 비율</h3><span class="st-sub">들은 시간 기준</span></div>${r.topArtists.length ? share(r.topArtists.slice(0, 10)) : '<p class="dz-note">아직 없어요</p>'}
  ${r.topAlbums.length ? `<div class="dz-sub">많이 들은 앨범</div><ol class="plain-list">${r.topAlbums.slice(0, 5).map((a) => `<li><b>${esc(a.album)}</b> · ${esc(a.artist)} <small>${a.plays}번</small></li>`).join('')}</ol>` : ''}</section>
</div>
<section class="st-card"><div class="st-head"><h3>${icon('sparkle')}취향 추천</h3><span class="st-sub">좋아하는 가수·장르인데 아직 거의 안 들은 곡</span>${playBtns('rec', o.recommend.length)}</div>
  ${o.recommend.length ? trackGroup('rec', o.recommend.slice(0, 15), (x) => `${x.artist} · ${x.reason}`, '취향 추천') : '<p class="dz-note">더 들으면 추천할 곡을 찾아 드려요</p>'}</section>
<section class="st-card"><div class="st-head"><h3>취향 변화</h3><span class="st-sub">최근 30일 ↔ 그 전 석 달</span></div>${taste}</section>
<div class="st-grid">
  <section class="st-card"><div class="st-head"><h3>오랫동안 안 들은 곡</h3><span class="st-sub">예전에 즐겨 들었는데 ${f.days}일 넘게 안 들은 곡</span>${playBtns('old', f.old.length)}</div>
    ${f.old.length ? trackGroup('old', f.old.slice(0, 12), (x) => `${x.artist} · ${x.playCount}번 · 마지막 ${fmtAgo(x.lastPlayed)}`, '오랫동안 안 들은 곡') : '<p class="dz-note">없어요. 골고루 듣고 있어요</p>'}
    ${f.neverCount ? `<div class="st-foot"><span>한 번도 안 들은 곡 <b>${f.neverCount}곡</b> (추가한 지 30일 넘음)</span><button class="btn small" data-act="group-shuffle" data-g="never">셔플로 들어 보기</button></div>` : ''}</section>
  <section class="st-card"><div class="st-head"><h3>최근 추가한 음악</h3><span class="st-sub">최근 30일 ${ra.last30}곡 · 그중 ${ra.last30Played}곡 들어 봄</span>${playBtns('new', ra.newest.length)}</div>
    ${bars(weeks, '곡')}
    ${ra.topArtists.length ? `<div class="chips small-chips">${ra.topArtists.map((a) => `<span class="chip">${esc(a.artist)} ${a.count}</span>`).join('')}</div>` : ''}
    ${ra.newest.length ? trackGroup('new', ra.newest.slice(0, 8), (x) => `${x.artist} · ${fmtAgo(x.addedAt)} 추가`, '최근 추가') : ''}</section>
</div>
<p class="dz-note center">기록 ${o.total}개 · ${o.since ? `${new Date(o.since).toLocaleDateString('ko-KR')}부터` : ''} · 이 PC에만 저장돼요</p>
</div>`;
  return { title: '통계' };
}

// ───── 청취 목표 ─────
export async function goalsDialog() {
  const g = { dailyMinutes: 0, weeklyNew: 0, ...(store.settings.goals || {}) };
  const v = await dialog({
    title: '청취 목표',
    html: `<p>0이면 목표 없음이에요. 통계 화면에서 얼마나 채웠는지 보여 줘요.</p>
<label class="num-row"><span>하루에 듣기</span><input type="number" min="0" max="1440" step="5" data-g="dailyMinutes" value="${g.dailyMinutes}"><em>분</em></label>
<label class="num-row"><span>한 주에 새로 들을 곡</span><input type="number" min="0" max="500" step="1" data-g="weeklyNew" value="${g.weeklyNew}"><em>곡</em></label>`,
    actions: [
      { label: '취소', value: null },
      { label: '저장', value: (d) => Object.fromEntries([...d.querySelectorAll('[data-g]')].map((i) => [i.dataset.g, Math.max(0, Number(i.value) || 0)])) },
    ],
  });
  if (!v) return false;
  try {
    store.settings = await put('/api/settings', { goals: v });
    toast(v.dailyMinutes || v.weeklyNew ? '목표를 정했어요' : '목표를 없앴어요');
    return true;
  } catch (e) {
    toast(e.message, 4000);
    return false;
  }
}

// ───── 연말 결산 ─────
export async function wrappedView(el, param) {
  const route = ctx.route;
  const year = Number(param) || new Date().getFullYear();
  ctx.list = { ids: [], source: null };
  let w;
  try {
    w = await get(`/api/stats/wrapped?year=${year}`);
  } catch (e) {
    el.innerHTML = `<div class="empty">${icon('warning')}<h3>결산을 못 만들었어요</h3><p>${esc(e.message)}</p></div>`;
    return { title: `${year} 결산` };
  }
  if (ctx.route !== route) return {};
  ctx.groups = {};
  const years = [...new Set([...(w.years || []), year])].sort();
  const yearChips = `<div class="chips wr-years">${years.map((y) => `<a class="chip${y === year ? ' on' : ''}" href="#/wrapped/${y}"><span>${y}</span></a>`).join('')}</div>`;
  if (!w.minutes) {
    el.innerHTML = `<div class="wrapped">${yearChips}<div class="empty">${icon('trophy')}<h3>${year}년에 들은 기록이 없어요</h3><p>곡을 들으면 한 해 동안 무엇을 얼마나 들었는지 모아서 보여 줘요.</p></div></div>`;
    return { title: `${year} 결산` };
  }
  const topA = w.topArtists[0];
  const hour = w.topHour === null ? null : peakHour(Array.from({ length: 24 }, (_, h) => (h === w.topHour ? 1 : 0)));
  const fact = (label, v, sub = '') => `<div class="wr-fact"><span>${label}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const day = w.topDay ? new Date(`${w.topDay.date}T00:00:00`) : null;
  el.innerHTML = `<div class="wrapped">
${yearChips}
<section class="wr-card wr-hero"><div class="wr-kicker">${year}년 결산</div><h2>${fmtMinutes(w.minutes)}</h2>
  <p>올해 음악을 들은 시간 · ${w.plays}번 재생 · ${w.uniqueTracks}곡 · 가수 ${w.uniqueArtists}명</p>${w.type ? `<div class="wr-type">${icon('sparkle')}${esc(w.type)}</div>` : ''}</section>
${topA ? `<section class="wr-card"><div class="wr-kicker">올해의 가수</div><h3>${esc(topA.artist)}</h3><p>들은 시간의 ${pct(topA.share)} · ${topA.plays}번</p>
  <ol class="wr-rank">${w.topArtists.map((a) => `<li><span>${esc(a.artist)}</span><b>${fmtMinutes(a.secs / 60)}</b></li>`).join('')}</ol></section>` : ''}
<section class="wr-card"><div class="st-head"><div class="wr-kicker">가장 많이 들은 곡</div>${playBtns('wr', w.topTracks.length)}<button class="btn small" data-act="wr-playlist" data-year="${year}">${icon('plus')}재생목록으로</button></div>
  ${trackGroup('wr', w.topTracks, (x) => `${x.artist} · ${x.plays}번`, `${year} 많이 들은 곡`)}</section>
${w.topAlbums.length ? `<section class="wr-card"><div class="wr-kicker">많이 들은 앨범</div><ol class="wr-rank">${w.topAlbums.map((a) => `<li><span>${esc(a.album)} · ${esc(a.artist)}</span><b>${a.plays}번</b></li>`).join('')}</ol></section>` : ''}
<section class="wr-card"><div class="wr-kicker">달마다</div>${bars(w.monthly.map((v, i) => ({ label: `${i + 1}`, title: `${i + 1}월`, v })))}<p>가장 많이 들은 달은 <b>${w.topMonth}월</b>이에요</p></section>
<section class="wr-card wr-facts">
  ${day ? fact('가장 많이 들은 날', `${day.getMonth() + 1}월 ${day.getDate()}일`, fmtMinutes(w.topDay.minutes)) : ''}
  ${hour ? fact('주로 듣는 시간', hour) : ''}
  ${fact('하루도 안 빼고 들은 최장 기록', `${w.longestStreak}일`)}
  ${fact('음악을 들은 날', `${w.activeDays}일`)}
  ${fact('새로 알게 된 가수', `${w.newArtists}명`)}
  ${w.firstSong ? fact('올해 첫 곡', esc(w.firstSong.title), `${esc(w.firstSong.artist)} · ${new Date(w.firstSong.at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}`) : ''}
</section>
</div>`;
  return { title: `${year} 결산` };
}

export function bindStatsEvents(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !root.querySelector('.stats, .wrapped')) return;
    const act = b.dataset.act;
    if (act === 'goals') {
      if (await goalsDialog()) ctx.refresh({ keepScroll: true });
    } else if (act === 'stats-export') {
      openMenu(
        [
          { icon: 'export', label: 'CSV (엑셀)', run: () => (location.href = '/api/stats/export?format=csv') },
          { icon: 'export', label: 'JSON', run: () => (location.href = '/api/stats/export?format=json') },
        ],
        { anchor: b },
      );
    } else if (act === 'wr-playlist') {
      const ids = ctx.groups.wr?.ids || [];
      if (!ids.length) return toast('라이브러리에 있는 곡이 없어요');
      try {
        const p = await post('/api/playlists', { name: `${b.dataset.year} 결산`, entries: ids });
        await reloadPlaylists();
        toast(`"${p.name}" 재생목록을 만들었어요`);
        ctx.go(`#/playlist/${p.id}`);
      } catch (err) {
        toast(err.message, 4000);
      }
    }
    return undefined;
  });
}
