// 곡 정보 패널 · 곡마다 도구: 곡 음량 · 셔플에서 빼기 · 커버 바꾸기 · 이 곡 화면 테마 · 북마크
import { coverUrl, get, post, put } from '../api.js';
import { normalizeGainDb } from '../audio.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { esc, fmtAgo, fmtTime } from '../util.js';
import { coverImg } from './common.js';
import { dialog, toast } from './dom.js';
import { fmtFormat } from './sound.js';

const fmtBytes = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const row = (k, v) => (v === null || v === undefined || v === '' ? '' : `<div class="kv"><span>${k}</span><b>${v}</b></div>`);

// 서버가 바꾼 곡을 화면 쪽 곡에도 반영
export function applyTrack(t) {
  if (t?.id) store.updateTrack(t);
}

export async function saveUser(id, patch, okMsg) {
  try {
    applyTrack(await put(`/api/tracks/${id}/user`, patch));
    if (id === ctx.player.loadedId) ctx.player.applyTrim();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(e.message, 4000);
  }
}

// ───── 곡 정보 ─────
export async function openDetails(id) {
  let d;
  try {
    d = await get(`/api/tracks/${id}/details`);
  } catch (e) {
    return toast(e.message);
  }
  const t = d.track;
  const f = d.file?.format || {};
  const tags = d.file?.tags || {};
  const L = d.listening;
  const norm = normalizeGainDb(t, store.settings.audio?.normalize || 'off', { target: store.settings.audio?.normTarget ?? -14 });
  const tagRows = Object.entries({
    제목: tags.title,
    아티스트: tags.artists?.join(', ') || tags.artist,
    앨범: tags.album,
    '앨범 아티스트': tags.albumartist,
    트랙: tags.track,
    디스크: tags.disk,
    연도: tags.date || tags.year,
    장르: tags.genre,
    작곡: tags.composer,
    작사: tags.lyricist,
    BPM: tags.bpm,
    레이블: tags.label,
    ISRC: tags.isrc,
    인코더: tags.encodedby || f.tool,
    설명: tags.comment,
  })
    .map(([k, v]) => row(k, v ? esc(v) : null))
    .join('');
  const bookmarks = (t.bookmarks || []).map((b, i) => `<div class="bm-row" data-i="${i}"><button class="link" data-act="bm-go" data-t="${b.t}">${fmtTime(b.t)}</button><span>${esc(b.note || '')}</span><button class="icon-btn" data-act="bm-del" data-i="${i}" aria-label="북마크 지우기">${icon('close')}</button></div>`).join('');
  const log = (t.metaLog || []).slice().reverse().map((m) => `<div class="kv"><span>${fmtAgo(m.at)} · ${esc(m.source)}</span><b>${esc(m.field)}: ${esc(m.from ?? '없음')} → ${esc(m.to ?? '없음')}</b></div>`).join('');
  const html = `<div class="details">
  <div class="details-head"><div class="cover">${coverImg(store.coverIdFor(t))}</div><div><h3>${esc(t.title)}</h3><p>${esc(t.artist)} · ${esc(t.album)}</p>
    <div class="chips">
      <button class="chip" data-act="d-cover">${icon('edit')}<span>커버 바꾸기</span></button>
      ${t.coverOriginal !== undefined ? `<button class="chip" data-act="d-cover-reset"><span>원래 커버로</span></button>` : ''}
      <button class="chip${t.noShuffle ? ' on' : ''}" data-act="d-noshuffle">${icon('shuffleOff')}<span>${t.noShuffle ? '셔플에서 빠짐' : '셔플에서 빼기'}</span></button>
      <button class="chip" data-act="d-theme">${icon('palette')}<span>이 곡 화면 테마${t.theme ? ' · 켜짐' : ''}</span></button>
      <button class="chip" data-act="d-reveal">${icon('folderOpen')}<span>파일 위치</span></button>
    </div></div></div>
  <div class="details-grid">
    <section><h4>파일 · 음질</h4>
      ${row('파일', esc(t.path))}
      ${row('크기', d.fileSize ? fmtBytes(d.fileSize) : d.exists ? null : '<span class="danger-text">파일이 없어요</span>')}
      ${row('형식', [f.container, f.codec, f.codecProfile].filter(Boolean).map(esc).join(' · '))}
      ${row('무손실', f.lossless ? '예' : '아니요')}
      ${row('표본율', fmtFormat({ rate: f.sampleRate, bits: f.bits, channels: f.channels }))}
      ${row('비트레이트', f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : null)}
      ${row('길이', f.duration ? fmtTime(f.duration) : fmtTime(t.duration))}
      ${row('태그 형식', (f.tagTypes || []).join(', '))}
      ${row('커버', d.file?.cover ? `${esc(d.file.cover.format || '')} · ${fmtBytes(d.file.cover.bytes)}` : t.cover ? '폴더 그림 또는 직접 바꾼 그림' : '없음')}
      ${row('가사', d.lrc ? '.lrc 파일' : t.hasLyrics ? '태그 안' : '없음')}
      ${row('수정한 날', fmtDate(d.modified))}
    </section>
    <section><h4>태그</h4>${tagRows || '<p class="dz-note">태그가 없어요</p>'}</section>
    <section><h4>들은 기록</h4>
      ${row('재생 횟수', `${t.playCount || 0}회`)}
      ${row('들은 시간', `${L.minutes}분 (${L.sessions}번)`)}
      ${row('넘긴 횟수', `${t.skips || 0}회`)}
      ${row('처음 들음', fmtDate(L.first))}
      ${row('마지막 재생', fmtDate(t.lastPlayed))}
      ${row('추가한 날', fmtDate(t.addedAt))}
    </section>
    <section><h4>음량</h4>
      ${row('곡 세기', t.loud?.lufs != null ? `${t.loud.lufs} LUFS` : '아직 안 잼')}
      ${row('피크', t.loud?.peak ? `${(20 * Math.log10(t.loud.peak)).toFixed(1)} dBFS` : null)}
      ${row('ReplayGain', tags.replaygainTrack != null ? `${tags.replaygainTrack} dB` : null)}
      ${row('앞뒤 무음', t.loud ? `${t.loud.start}초 · 끝 ${fmtTime(t.loud.end)}${t.loud.gaps?.length ? ` · 가운데 ${t.loud.gaps.length}곳` : ''}` : null)}
      ${row('평준화', store.settings.audio?.normalize !== 'off' ? `${norm > 0 ? '+' : ''}${norm.toFixed(1)} dB` : '꺼짐')}
      <label class="dz-range"><span>곡 음량</span><input type="range" min="-12" max="12" step="0.5" data-act="d-gain" value="${t.userGain || 0}" style="--p:${(((t.userGain || 0) + 12) / 24) * 100}%"><output>${(t.userGain || 0) > 0 ? '+' : ''}${t.userGain || 0}dB</output></label>
    </section>
    <section><h4>북마크 <button class="btn small" data-act="bm-add">${icon('bookmark')}지금 위치</button></h4>${bookmarks || '<p class="dz-note">곡의 특정 순간을 저장해 두고 바로 그 자리로 갈 수 있어요. 재생 중에 "지금 위치"를 눌러요</p>'}</section>
    <section><h4>변경 이력</h4>${log || '<p class="dz-note">아직 바뀐 정보가 없어요. 태그를 고치거나 앱에서 커버·가사·곡 음량을 바꾸면 여기에 남아요</p>'}</section>
  </div>
</div>`;
  dialog({
    title: '곡 정보',
    html,
    cls: 'wide',
    actions: [{ label: '닫기', value: null }],
    onOpen: (dlg, done) => {
      dlg.querySelector('.details').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'd-cover') {
          done(null);
          return changeCover([t.id]);
        }
        if (act === 'd-cover-reset') {
          done(null);
          return resetCover([t.id]);
        }
        if (act === 'd-noshuffle') {
          await saveUser(t.id, { noShuffle: !t.noShuffle }, t.noShuffle ? '셔플할 때 다시 나와요' : '셔플할 때 이 곡은 건너뛰어요');
          done(null);
          return openDetails(t.id);
        }
        if (act === 'd-theme') {
          done(null);
          return trackThemeDialog(store.tracks.get(t.id));
        }
        if (act === 'd-reveal') return post(`/api/tracks/${t.id}/reveal`).catch((err) => toast(err.message));
        if (act === 'bm-add') {
          done(null);
          return addBookmark(t.id);
        }
        if (act === 'bm-go') {
          done(null);
          return goBookmark(t.id, Number(b.dataset.t));
        }
        if (act === 'bm-del') {
          const list = (store.tracks.get(t.id)?.bookmarks || []).filter((_, i) => i !== Number(b.dataset.i));
          await saveUser(t.id, { bookmarks: list }, '북마크를 지웠어요');
          done(null);
          return openDetails(t.id);
        }
        return undefined;
      });
      const gain = dlg.querySelector('[data-act="d-gain"]');
      gain.addEventListener('input', () => {
        const v = Number(gain.value);
        gain.style.setProperty('--p', `${((v + 12) / 24) * 100}%`);
        gain.parentElement.querySelector('output').textContent = `${v > 0 ? '+' : ''}${v}dB`;
        const cur = store.tracks.get(t.id);
        if (cur) cur.userGain = v;
        if (ctx.player.loadedId === t.id) ctx.player.applyTrim();
      });
      gain.addEventListener('change', () => saveUser(t.id, { userGain: Number(gain.value) }, '곡 음량을 저장했어요'));
    },
  });
  return undefined;
}

// ───── 북마크 ─────
export async function addBookmark(id = ctx.player.loadedId) {
  const p = ctx.player;
  const t = store.tracks.get(id);
  if (!t) return;
  const at = id === p.loadedId ? Math.round(p.time * 10) / 10 : 0;
  const note = await new Promise((resolve) =>
    dialog({
      title: `북마크 · ${fmtTime(at)}`,
      html: '<input type="text" placeholder="메모 (예: 후렴 시작)" maxlength="120" spellcheck="false">',
      actions: [
        { label: '취소', value: null },
        { label: '저장', value: (d) => d.querySelector('input').value.trim() },
      ],
      onOpen: (d, done) => {
        const inp = d.querySelector('input');
        inp.focus();
        inp.onkeydown = (e) => e.key === 'Enter' && done(inp.value.trim());
      },
    }).then(resolve),
  );
  if (note === null) return;
  await saveUser(id, { bookmarks: [...(t.bookmarks || []), { t: at, note, at: Date.now() }] }, `${fmtTime(at)}에 북마크를 저장했어요`);
}

export function goBookmark(id, sec) {
  const p = ctx.player;
  if (p.loadedId === id) p.seek(sec);
  else {
    p.playNext([id]);
    p.next();
    setTimeout(() => p.seek(sec), 400);
  }
}

// ───── 커버 바꾸기 (앱에만 저장, 음악 파일은 그대로) ─────
export function changeCover(ids) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const res = await fetch('/api/covers', { method: 'POST', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: await file.arrayBuffer() });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '그림을 올리지 못했어요');
      await put('/api/tracks/user', { ids, patch: { coverOverride: j.id } });
      for (const id of ids) {
        const t = store.tracks.get(id);
        if (t) {
          t.coverOriginal ??= t.cover || null;
          t.coverOverride = j.id;
          t.cover = j.id;
        }
      }
      store.emit('library');
      toast(ids.length > 1 ? `${ids.length}곡의 커버를 바꿨어요` : '커버를 바꿨어요 (이 PC 앱에서만)');
      ctx.refresh?.({ keepScroll: true });
    } catch (e) {
      toast(e.message, 4000);
    }
  };
  input.click();
}

export async function resetCover(ids) {
  try {
    await put('/api/tracks/user', { ids, patch: { coverOverride: null } });
    for (const id of ids) {
      const t = store.tracks.get(id);
      if (t && t.coverOriginal !== undefined) {
        t.cover = t.coverOriginal;
        delete t.coverOriginal;
        delete t.coverOverride;
      }
    }
    store.emit('library');
    toast('원래 커버로 돌렸어요');
    ctx.refresh?.({ keepScroll: true });
  } catch (e) {
    toast(e.message, 4000);
  }
}

// ───── 이 곡 화면 테마: 이 곡이 나올 때만 디자인 설정 일부를 바꾼다 ─────
const THEME_BG = [
  ['', '기본 설정 따름'],
  ['album', '앨범 색'],
  ['blur', '커버 흐리게'],
  ['random', '랜덤'],
  ['rainbow', '무지개'],
  ['cycle', '무지개 단색'],
  ['custom', '직접 고르기'],
  ['off', '끄기'],
];
const THEME_VIZ = [
  ['', '기본 설정 따름'],
  ['album', '앨범 색'],
  ['rainbow', '무지개'],
  ['cycle', '무지개 단색'],
  ['random', '랜덤'],
  ['accent', '포인트 색'],
  ['custom', '직접 고르기'],
];
const THEME_FX = [
  ['', '기본 설정 따름'],
  ['off', '끄기'],
  ['snow', '❄️ 눈'],
  ['sakura', '🌸 벚꽃'],
  ['leaves', '🍂 낙엽'],
  ['rain', '🌧️ 비'],
  ['stars', '✨ 별'],
  ['fireflies', '반딧불'],
  ['bubbles', '🫧 비눗방울'],
  ['hearts', '💗 하트'],
];

export function trackThemeDialog(t) {
  if (!t) return;
  const th = t.theme || {};
  const sel = (k, opts) => `<select class="select" data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${(th[k] ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  dialog({
    title: '이 곡 화면 테마',
    html: `<p>"${esc(t.title)}"이(가) 나올 때만 재생 화면을 이렇게 바꿔요.</p>
<div class="theme-form">
  <label><span>재생 화면 배경</span>${sel('npBg', THEME_BG)}</label>
  <label><span>배경 색 (직접 고르기)</span><input type="color" data-k="npBgColor" value="${esc(th.npBgColor || '#7c5cff')}"></label>
  <label><span>스펙트럼 색</span>${sel('spectrumColor', THEME_VIZ)}</label>
  <label><span>스펙트럼 색 (직접 고르기)</span><input type="color" data-k="spectrumCustom" value="${esc(th.spectrumCustom || '#3fa9ff')}"></label>
  <label><span>화면 효과</span>${sel('effect', THEME_FX)}</label>
</div>`,
    actions: [
      { label: '없애기', value: 'clear', danger: true },
      { label: '취소', value: null },
      {
        label: '저장',
        value: (d) => {
          const out = {};
          for (const el of d.querySelectorAll('[data-k]')) if (el.value) out[el.dataset.k] = el.value;
          if (out.npBg !== 'custom') delete out.npBgColor;
          if (out.spectrumColor !== 'custom') delete out.spectrumCustom;
          return out;
        },
      },
    ],
  }).then(async (v) => {
    if (v === null) return;
    const theme = v === 'clear' ? null : v;
    await saveUser(t.id, { theme }, theme && Object.keys(theme).length ? '이 곡이 나올 때 이 테마로 바뀌어요' : '이 곡 테마를 없앴어요');
    store.emit('design');
  });
}

// 곡 음량만 바로 (곡 메뉴)
export function trackGainDialog(t) {
  if (!t) return;
  const orig = t.userGain || 0;
  dialog({
    title: '곡 음량',
    html: `<p>"${esc(t.title)}"만 소리를 키우거나 줄여요. 음량 평준화와 같이 쓸 수 있어요.</p>
<label class="dz-range"><span>곡 음량</span><input type="range" min="-12" max="12" step="0.5" value="${t.userGain || 0}" style="--p:${(((t.userGain || 0) + 12) / 24) * 100}%"><output>${(t.userGain || 0) > 0 ? '+' : ''}${t.userGain || 0}dB</output></label>`,
    actions: [
      { label: '0으로', value: 0 },
      { label: '취소', value: null },
      { label: '저장', value: (d) => Number(d.querySelector('input').value) },
    ],
    onOpen: (d) => {
      const r = d.querySelector('input');
      r.addEventListener('input', () => {
        const v = Number(r.value);
        r.style.setProperty('--p', `${((v + 12) / 24) * 100}%`);
        r.parentElement.querySelector('output').textContent = `${v > 0 ? '+' : ''}${v}dB`;
        t.userGain = v;
        if (ctx.player.loadedId === t.id) ctx.player.applyTrim();
      });
    },
  }).then((v) => {
    if (v === null) {
      t.userGain = orig || undefined; // 취소: 미리 들어 본 값을 되돌린다
      if (ctx.player.loadedId === t.id) ctx.player.applyTrim();
      return;
    }
    saveUser(t.id, { userGain: v }, v ? `곡 음량 ${v > 0 ? '+' : ''}${v}dB` : '곡 음량을 원래대로');
  });
}

export const coverOf = (t) => coverUrl(store.coverIdFor(t));
