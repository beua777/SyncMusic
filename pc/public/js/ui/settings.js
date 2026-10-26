// 설정 · 휴대폰 동기화
import { del, get, post, put } from '../api.js';
import { EQ_PRESETS } from '../audio.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { $, esc, fmtAgo, fmtClock } from '../util.js';
import { confirmDialog, openMenu, promptText, toast } from './dom.js';
import { shortcutsDialog } from './keys.js';
import { lyricsSettingsChanged } from './lyrics.js';
import { LITE_TEXT, liteStatus } from './design.js';
import { openNp, sleepDialog } from './nowplaying.js';
import { openPip } from './pip.js';
import { audioSettings, fmtFormat, qualityDialog, setAudio } from './sound.js';
import { goalsDialog } from './stats.js';
import { searchWithFilter } from './views.js';

let pairTimer = null;

const scanText = (s) =>
  !s ? '' : s.scanning ? `음악을 찾는 중… ${s.done}/${s.total}` : `${store.list.length}곡 · 마지막 검색 ${s.lastScan ? fmtAgo(s.lastScan) : '없음'}`;

export function onScanProgress(s) {
  const el = $('#scan-status');
  if (el) el.textContent = scanText(s);
}

const resultText = (r) =>
  r ? `받은 곡 ${r.uploaded} · 보낸 곡 ${r.downloaded} · 재생목록 ${r.playlists}${r.errors ? ` · 오류 ${r.errors}` : ''}` : '아직 동기화 전';

const PL_ACTION = {
  create: (x) => `PC에 새로 만듦 (${x.after}곡)`,
  update: (x) => `PC에서 바뀜 (+${x.added} −${x.removed})`,
  unlink: () => '폰과 연결 끊김',
  phoneWrite: (x) => `폰에 저장 (${x.after}곡)`,
  phoneDelete: () => '폰에서 지움',
};

// 동기화 미리 보기: 폰이 마지막으로 알려 준 목록으로, 지금 동기화하면 무엇이 바뀌는지
function previewBlock(d) {
  const p = d.preview;
  const approved = d.approvedUntil > Date.now();
  if (!p) {
    return `<div class="set-row"><div class="label"><b>동기화 미리 보기</b><small>${d.options.confirm ? '폰이 연결되면 바뀔 내용을 먼저 보여 주고, 허락할 때까지 기다려요' : '폰이 한 번 연결된 뒤에 무엇이 바뀔지 계산해 볼 수 있어요'}</small></div><button class="btn small" data-act="sync-preview" data-id="${esc(d.id)}">미리 보기</button></div>`;
  }
  const li = (arr, fmt) => `<ul>${arr.slice(0, 100).map((x) => `<li>${fmt(x)}</li>`).join('')}${arr.length > 100 ? `<li>…외 ${arr.length - 100}개</li>` : ''}</ul>`;
  const tr = (x) => `${esc(x.title)}${x.artist ? ` — ${esc(x.artist)}` : ''}`;
  const pl = (x) => `${esc(x.name)} · ${PL_ACTION[x.action]?.(x) || esc(x.action)}`;
  return `<div class="sync-preview">
  <div class="sp-head"><b>${p.empty ? '지금 동기화해도 바뀌는 것이 없어요' : '동기화하면 이렇게 바뀌어요'}</b><small>${fmtAgo(p.at)} 폰이 알려 준 목록 기준</small></div>
  ${p.upload.length ? `<details><summary>폰 → PC로 받을 곡 <b>${p.upload.length}곡</b></summary>${li(p.upload, tr)}</details>` : ''}
  ${p.download.length ? `<details><summary>PC → 폰으로 보낼 곡 <b>${p.download.length}곡</b></summary>${li(p.download, tr)}</details>` : ''}
  ${p.playlists.length ? `<details><summary>재생목록 <b>${p.playlists.length}개</b> 바뀜</summary>${li(p.playlists, pl)}</details>` : ''}
  ${(p.notices || []).map((n) => `<p class="warn">${esc(n)}</p>`).join('')}
  <div class="sp-actions">${
    approved
      ? `<span class="badge">${icon('check')}${fmtClock(d.approvedUntil)}까지 허락됨 · 폰이 연결되면 동기화해요</span>`
      : d.options.confirm && !p.empty
        ? `<button class="btn primary small" data-act="sync-approve" data-id="${esc(d.id)}">${icon('check')}허락하고 동기화</button>`
        : ''
  }<button class="btn small" data-act="sync-preview" data-id="${esc(d.id)}">${icon('sync')}다시 계산</button></div>
</div>`;
}

function deviceBlock(d) {
  return `<div class="set-row">${icon('phone')}<div class="label"><b>${esc(d.name)}</b><small>마지막 동기화 ${d.lastSync ? fmtAgo(d.lastSync) : '없음'} · ${resultText(d.lastResult)}</small></div>
  <button class="icon-btn" data-act="device-more" data-id="${esc(d.id)}" aria-label="기기 메뉴">${icon('more')}</button></div>
<div class="set-row"><div class="label"><b>폰에서 PC로 가져올 곡</b><small>PC 음악 폴더의 "From Phone"에 복사해요 (폰의 파일은 그대로)</small></div>
  <select class="select" data-device-phone="${esc(d.id)}">
    <option value="playlists" ${d.options.phoneToPc === 'playlists' ? 'selected' : ''}>재생목록에 있는 곡만</option>
    <option value="all" ${d.options.phoneToPc === 'all' ? 'selected' : ''}>폰의 모든 음악</option>
    <option value="none" ${d.options.phoneToPc === 'none' ? 'selected' : ''}>가져오지 않음</option>
  </select></div>
<div class="set-row"><div class="label"><b>PC에서 폰으로 보낼 곡</b><small>폰의 Music/SyncMusic 폴더에 저장되고 삼성 뮤직이 바로 인식해요</small></div>
  <select class="select" data-device-pc="${esc(d.id)}">
    <option value="playlists" ${d.options.pcToPhone === 'playlists' ? 'selected' : ''}>재생목록에 있는 곡만</option>
    <option value="all" ${d.options.pcToPhone === 'all' ? 'selected' : ''}>전체 라이브러리</option>
    <option value="none" ${d.options.pcToPhone === 'none' ? 'selected' : ''}>보내지 않음</option>
  </select></div>
<div class="set-row"><div class="label"><b>동기화하기 전에 PC에서 확인</b><small>폰이 연결돼도 바로 바꾸지 않고 바뀔 내용을 먼저 보여 줘요. 허락하면 30분 안에 다시 연결될 때 동기화해요</small></div>
  <label class="switch"><input type="checkbox" data-device-confirm="${esc(d.id)}" ${d.options.confirm ? 'checked' : ''} aria-label="동기화하기 전에 PC에서 확인"><span></span></label></div>
${previewBlock(d)}`;
}

function pairBlock(p) {
  const left = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000));
  return `<div class="pair-box">
  <div>폰의 SyncMusic 앱에서 이 PC를 고르고 코드를 입력하세요</div>
  <div class="pair-code">${p.code.slice(0, 3)} ${p.code.slice(3)}</div>
  <p><span id="pair-left">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span> 동안 쓸 수 있어요 · 폰과 PC가 같은 Wi-Fi에 있어야 해요</p>
  <button class="btn" data-act="pair-cancel">취소</button>
</div>`;
}

function updateRow(u) {
  if (!u?.supported) return `<div class="set-row">${icon('update')}<div class="label"><b>업데이트</b><small>git으로 받은 폴더가 아니라서 자동 업데이트를 쓸 수 없어요. GitHub에서 새로 받아 주세요</small></div></div>`;
  if (u.available) {
    return `<div class="set-row">${icon('update')}<div class="label"><b>새 버전이 있어요 · ${u.count}개 바뀜</b><small>${(u.messages || []).slice(0, 5).map((m) => esc(m.title)).join(' · ')}${u.dirty ? '<br><span class="danger-text">이 PC에서 고친 파일이 있어서 자동으로 받을 수 없어요</span>' : ''}</small></div>${u.dirty ? '' : `<button class="btn primary small" data-act="update-apply">${icon('update')}업데이트</button>`}</div>`;
  }
  return `<div class="set-row">${icon('update')}<div class="label"><b>최신 버전이에요</b><small>${u.local ? `${esc(u.local)} · ` : ''}${u.checkedAt ? `${fmtAgo(u.checkedAt)} 확인` : '아직 확인 전'}</small></div><button class="btn small" data-act="update-now">지금 확인</button></div>`;
}

function soundSummary(a) {
  const parts = [];
  parts.push(a.eqOn ? `EQ ${EQ_PRESETS[a.eqPreset]?.name || '사용자'}` : 'EQ 꺼짐');
  parts.push(a.crossfade ? `크로스페이드 ${a.crossfade}초` : '크로스페이드 꺼짐');
  if (a.normalize && a.normalize !== 'off') parts.push(`음량 평준화 ${a.normalize === 'album' ? '앨범' : '곡'}마다`);
  if (a.skipSilence) parts.push('무음 건너뛰기');
  if ((a.rate || 1) !== 1) parts.push(`${a.rate}배속`);
  return parts.join(' · ');
}

const sw = (sect, key, on, label) =>
  `<label class="switch"><input type="checkbox" data-sect="${sect}" data-key="${key}" ${on ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;
const sseg = (sect, key, cur, opts) =>
  `<div class="seg wrap" data-sect="${sect}" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

export async function settingsView(el) {
  const route = ctx.route;
  if (!el.querySelector('.settings')) el.innerHTML = '<div class="settings"><div class="empty compact"><p>불러오는 중…</p></div></div>';
  const [sync, auto, upd] = await Promise.all([
    get('/api/sync/status'),
    get('/api/system/autostart').catch(() => ({ enabled: false })),
    get('/api/system/update').catch(() => null),
  ]);
  if (ctx.route !== route) return {};
  ctx.list = { ids: [], source: null };
  const s = store.settings;
  const a = { ...audioSettings() };
  const ly = { size: 'm', align: 'left', style: 'scale', translate: true, online: true, ...(s.lyrics || {}) };
  const pw = { sleepAction: 'pause', keepAwake: false, lite: 'off', ...(s.power || {}) };
  const goals = { dailyMinutes: 0, weeklyNew: 0, ...(s.goals || {}) };
  const addr = sync.addresses.length ? sync.addresses.map((x) => x.address).join(', ') : '네트워크 연결 없음';
  const sleep = ctx.player.sleep;
  const dev = ctx.player.device;
  const noShuffle = store.list.filter((t) => t.noShuffle).length;
  const year = new Date().getFullYear();
  const seg = (key, opts) =>
    `<div class="seg" data-setting="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  el.innerHTML = `<div class="settings">
<div class="group-title">휴대폰 동기화</div>
<div class="card">
  <div class="set-row">${icon('wifi')}<div class="label"><b>${esc(sync.pcName)}</b><small class="${sync.lanError ? 'warn' : ''}">${esc(addr)} · 포트 ${sync.port}${sync.lanError ? ` · 동기화 서버 오류: ${esc(sync.lanError)}` : ''}</small></div>
    <button class="btn small" data-act="rename-pc">${icon('edit')}이름</button></div>
  ${
    sync.pairing
      ? pairBlock(sync.pairing)
      : `<div class="set-row click" data-act="pair-start">${icon('plus')}<div class="label"><b>새 휴대폰 연결</b><small>6자리 코드를 폰 앱에 입력하면 연결돼요. 그다음부터는 같은 Wi-Fi에서 자동으로 동기화해요</small></div></div>`
  }
  ${sync.devices.map(deviceBlock).join('')}
</div>

${
  sync.nowPlaying?.current?.title
    ? `<div class="group-title">폰에서 재생 중</div><div class="card"><div class="set-row">${icon('phone')}<div class="label"><b>${esc(sync.nowPlaying.current.title)} — ${esc(sync.nowPlaying.current.artist)}</b><small>${esc(sync.nowPlaying.deviceName)} · ${fmtAgo(sync.nowPlaying.receivedAt)} · 대기열 ${sync.nowPlaying.queue.length}곡 · 셔플 ${sync.nowPlaying.shuffle ? '켜짐' : '꺼짐'}</small></div><button class="btn primary small" data-act="handoff">PC에서 이어 듣기</button></div></div>`
    : ''
}

<div class="group-title">동기화 기록</div>
<div class="card"><div class="log">${
    sync.log.length
      ? sync.log
          .slice()
          .reverse()
          .map((l) => `<div class="${l.level === 'warn' ? 'warn' : ''}"><time>${fmtClock(l.at)}</time><span>${esc(l.msg)}</span></div>`)
          .join('')
      : '<div>아직 기록이 없어요</div>'
  }</div></div>

<div class="group-title">처음 연결하는 방법</div>
<div class="card"><ol class="steps">
  <li>폰에 <b>SyncMusic 동반 앱</b>을 설치해요 (프로젝트의 android 폴더, README 참고)</li>
  <li>삼성 뮤직 → ⋮ → 설정 → <b>플레이리스트 관리</b>에서 <b>모든 플레이리스트 자동 백업</b>을 켜고 폴더를 확인해요</li>
  <li>동반 앱에서 같은 폴더를 고르고, 위의 <b>새 휴대폰 연결</b> 코드를 입력해요</li>
  <li>Windows 방화벽 창이 뜨면 <b>개인 네트워크</b>에서 Node.js를 허용해요</li>
  <li>PC에서 바꾼 재생목록은 삼성 뮤직의 <b>플레이리스트 가져오기</b>를 한 번 누르면 반영돼요</li>
</ol></div>

<div class="group-title">음악 폴더</div>
<div class="card">
  ${s.musicFolders
    .map(
      (f, i) =>
        `<div class="set-row">${icon('folder')}<div class="label"><b>${esc(f.split(/[\\/]/).filter(Boolean).pop() || f)}</b><small>${esc(f)}${i === 0 ? ' · 폰에서 받은 곡은 여기의 From Phone 폴더에 저장' : ''}</small></div><button class="icon-btn" data-act="folder-remove" data-i="${i}" aria-label="폴더 빼기">${icon('close')}</button></div>`,
    )
    .join('')}
  <div class="set-row click" data-act="folder-add">${icon('plus')}<div class="label"><b>폴더 추가</b><small>폴더 선택 창이 열려요</small></div></div>
  <div class="set-row click" data-act="rescan">${icon('sync')}<div class="label"><b>다시 검색</b><small id="scan-status">${scanText(store.scan)}</small></div></div>
  <a class="set-row click" href="#/tools">${icon('tools')}<div class="label"><b>라이브러리 도구</b><small>없어진 파일 · 태그 없는 곡 · 중복 곡 · 열 수 없는 형식 점검 · 변경 기록</small></div></a>
</div>

<div class="group-title">재생</div>
<div class="card">
  <div class="set-row"><div class="label"><b>목록에서 곡을 누르면</b><small>셔플 유지: 누른 곡부터 지금 셔플 상태 그대로 · 목록 순서대로: 셔플을 끄고 목록 순서로 (삼성 뮤직 도움말에 적힌 동작)</small></div>
    ${seg('tapKeepsShuffle', [
      [true, '셔플 유지'],
      [false, '목록 순서대로'],
    ])}</div>
  <div class="set-row"><div class="label"><b>셔플 방식</b><small>고르게: 모든 곡이 같은 확률 (삼성 뮤직처럼) · 취향: 자주 듣고 즐겨찾기한 곡이 앞쪽에, 자주 넘긴 곡·방금 들은 곡은 뒤로</small></div>
    ${sseg('audio', 'shuffleMode', a.shuffleMode || 'random', [
      ['random', '고르게'],
      ['smart', '취향'],
    ])}</div>
  <div class="set-row"><div class="label"><b>아티스트·앨범 섞기</b><small>높일수록 같은 가수·같은 앨범의 곡이 몰리지 않게 흩어 놓아요</small>
    <label class="dz-range"><input type="range" min="0" max="100" step="5" data-sect="audio" data-key="shuffleSpread" value="${a.shuffleSpread || 0}" style="--p:${a.shuffleSpread || 0}%" aria-label="아티스트·앨범 섞기"><output>${a.shuffleSpread ? `${a.shuffleSpread}%` : '끄기'}</output></label></div></div>
  <div class="set-row"><div class="label"><b>같은 아티스트 연달아 안 나오게</b><small>셔플할 때 바로 다음 곡이 같은 가수면 순서를 바꿔요</small></div>${sw('audio', 'noRepeatArtist', a.noRepeatArtist, '같은 아티스트 연달아 안 나오게')}</div>
  <div class="set-row click" data-act="no-shuffle-list">${icon('shuffleOff')}<div class="label"><b>셔플에서 뺀 곡 · ${noShuffle}곡</b><small>곡 메뉴의 "셔플에서 빼기"로 정해요. 셔플할 때 건너뛰고, 순서대로 틀 때는 나와요</small></div></div>
  <div class="set-row click" data-act="sleep">${icon('moon')}<div class="label"><b>수면 타이머</b><small>${sleep?.at ? `${fmtClock(sleep.at)}에 멈춰요` : sleep ? '지금 곡이 끝나면 멈춰요' : '꺼짐'}</small></div></div>
  <div class="set-row">${icon('info')}<div class="label"><b>셔플·반복 규칙</b><small>셔플은 한 바퀴 동안 같은 곡이 다시 나오지 않아요 · 반복 버튼은 반복 안 함 → 전체 반복 → 한 곡 반복 · 이전 버튼은 3초가 지났으면 처음부터, 아니면 이전 곡 · 앱을 다시 켜도 섞인 순서와 듣던 위치가 그대로예요</small></div></div>
</div>

<div class="group-title">소리</div>
<div class="card">
  <div class="set-row click" data-act="sound">${icon('eq')}<div class="label"><b>이퀄라이저 · 크로스페이드 · 음량 평준화 · 재생 속도</b><small>${soundSummary(a)}</small></div></div>
  <div class="set-row click" data-act="quality">${icon('info')}<div class="label"><b>음질·출력 장치 정보</b><small>${dev ? `${esc(dev.name)}${dev.format ? ` · ${fmtFormat(dev.format)}` : ''}` : '출력 장치를 읽는 중'} · 장치마다 음량 기억 ${a.deviceVolume !== false ? '켜짐' : '꺼짐'}</small></div></div>
</div>

<div class="group-title">가사</div>
<div class="card">
  <div class="set-row"><div class="label"><b>글자 크기</b></div>${sseg('lyrics', 'size', ly.size, [
    ['s', '작게'],
    ['m', '보통'],
    ['l', '크게'],
    ['xl', '아주 크게'],
  ])}</div>
  <div class="set-row"><div class="label"><b>정렬</b></div>${sseg('lyrics', 'align', ly.align, [
    ['left', '왼쪽'],
    ['center', '가운데'],
  ])}</div>
  <div class="set-row"><div class="label"><b>지금 부르는 줄</b><small>노래방: 시간에 맞춰 왼쪽부터 칠해져요</small></div>${sseg('lyrics', 'style', ly.style, [
    ['scale', '크게'],
    ['color', '색만'],
    ['karaoke', '노래방'],
  ])}</div>
  <div class="set-row"><div class="label"><b>번역 나란히 보기</b><small>.lrc 파일의 번역 줄을 보여 주고, 없으면 자동 번역해요 (한국어 가사는 그대로). 자동 번역은 가사를 Google 번역에 보내요</small></div>${sw('lyrics', 'translate', ly.translate, '번역 나란히 보기')}</div>
  <div class="set-row"><div class="label"><b>온라인에서 가사 찾기</b><small>LRCLIB(누구나 쓰는 무료 가사 모음)에서 제목·가수로 찾아요. 찾은 가사는 곡 옆에 .lrc 파일로 저장해요</small></div>${sw('lyrics', 'online', ly.online, '온라인에서 가사 찾기')}</div>
</div>

<div class="group-title">화면</div>
<div class="card"><div class="set-row"><div class="label"><b>테마</b></div>${seg('theme', [
    ['system', '시스템'],
    ['light', '라이트'],
    ['dark', '다크'],
  ])}</div>
  <div class="set-row click" data-act="design">${icon('palette')}<div class="label"><b>디자인 꾸미기</b><small>포인트 색 · 재생 화면 배경 색(앨범 색 · 랜덤 · 무지개 · 직접 고르기) · 오디오 스펙트럼 · 화면 효과</small></div></div>
  <div class="set-row click" data-act="layout">${icon('layout')}<div class="label"><b>화면 배치</b><small>커버 크기 · 옆 패널 위치 · 보일 버튼 · 위쪽 탭 순서와 보이기</small></div></div>
  <div class="set-row click" data-act="pip">${icon('pip')}<div class="label"><b>작은 창 (항상 위)</b><small>다른 창 위에 떠 있는 작은 플레이어 · 미니 플레이어의 ${icon('pip', 'inline')} 버튼으로도 열어요</small></div></div>
  <div class="set-row click" data-act="shortcuts">${icon('keyboard')}<div class="label"><b>단축키</b><small>키를 바꾸거나 끌 수 있어요 · 언제든 Shift + / (?)로 볼 수 있어요</small></div></div>
</div>

<div class="group-title">성능</div>
<div class="card">
  <div class="set-row"><div class="label"><b>저사양 모드</b><small>${LITE_TEXT}. 음악을 듣는 동안에는 곡 소리 재기(음량 평준화)도 쉬어요. 디자인에서 고른 값은 그대로 남아 있다가 끄면 돌아와요${liteStatus() ? ` · ${liteStatus()}` : ''}</small></div>${sseg('power', 'lite', pw.lite, [
    ['off', '끄기'],
    ['on', '켜기'],
    ['battery', '배터리일 때만'],
  ])}</div>
  <div class="set-row"><div class="label"><b>움직임 부드러움</b><small>스펙트럼·화면 효과를 1초에 몇 번 그릴지. 낮출수록 CPU를 덜 써요 (다른 창을 보고 있을 때는 알아서 줄여요)</small></div>${sseg('design', 'fps', s.design?.fps || 30, [
    [15, '절약'],
    [30, '보통'],
    [60, '부드럽게'],
  ])}</div>
</div>

<div class="group-title">들은 기록</div>
<div class="card">
  <a class="set-row click" href="#/stats">${icon('chart')}<div class="label"><b>통계</b><small>주간·월간 리포트 · 언제 듣는지 · 아티스트 비율 · 오래 안 들은 곡 · 취향 추천 · 취향 변화 · 내보내기(CSV·JSON)</small></div></a>
  <a class="set-row click" href="#/wrapped/${year}">${icon('trophy')}<div class="label"><b>${year}년 결산</b><small>한 해 동안 가장 많이 들은 곡·가수·앨범</small></div></a>
  <div class="set-row click" data-act="goals">${icon('check')}<div class="label"><b>청취 목표</b><small>${goals.dailyMinutes || goals.weeklyNew ? [goals.dailyMinutes ? `하루 ${goals.dailyMinutes}분` : '', goals.weeklyNew ? `한 주에 새 곡 ${goals.weeklyNew}곡` : ''].filter(Boolean).join(' · ') : '정하지 않음'}</small></div></div>
</div>

<div class="group-title">전원</div>
<div class="card">
  <div class="set-row"><div class="label"><b>수면 타이머가 끝나면</b><small>앱 종료·PC 절전·PC 끄기는 30초 전에 알려 주고, 그동안 취소할 수 있어요</small></div>${sseg('power', 'sleepAction', pw.sleepAction, [
    ['pause', '멈추기만'],
    ['quit', '앱 종료'],
    ['sleep', 'PC 절전'],
    ['shutdown', 'PC 끄기'],
  ])}</div>
  <div class="set-row"><div class="label"><b>재생 중에는 화면이 꺼지지 않게</b><small>SyncMusic 창이 보이는 동안만이에요</small></div>${sw('power', 'keepAwake', pw.keepAwake, '재생 중에는 화면이 꺼지지 않게')}</div>
</div>

<div class="group-title">백업 · 업데이트</div>
<div class="card">
  <a class="set-row click" href="/api/backup" download>${icon('backup')}<div class="label"><b>백업 파일 받기</b><small>설정 · 재생목록 · 곡마다 정한 값(재생 횟수·북마크·곡 음량·커버·테마) · 들은 기록을 파일 하나로</small></div></a>
  <div class="set-row click" data-act="backup-restore">${icon('import')}<div class="label"><b>백업에서 되살리기</b><small>지금 재생목록은 변경 이력에 남겨 두고 백업 내용으로 바꿔요. 들은 기록은 합쳐요</small></div></div>
  <input type="file" id="backup-file" accept=".json,application/json" hidden>
  ${updateRow(upd)}
  <div class="set-row"><div class="label"><b>새 버전 알림</b><small>6시간마다 GitHub에서 확인해요</small></div><label class="switch"><input type="checkbox" data-act="update-check" ${s.updateCheck !== false ? 'checked' : ''} aria-label="새 버전 알림"><span></span></label></div>
</div>

<div class="group-title">Windows</div>
<div class="card">
  <div class="set-row"><div class="label"><b>로그인할 때 백그라운드로 실행</b><small>창을 열지 않아도, 폰이 같은 Wi-Fi에 오면 동기화돼요</small></div>
    <label class="switch"><input type="checkbox" data-act="autostart" ${auto.enabled ? 'checked' : ''}><span></span></label></div>
  <div class="set-row click" data-act="shortcut">${icon('desktop')}<div class="label"><b>바탕화면 바로가기 만들기</b><small>바로가기로 열면 주소창 없는 앱 창으로 열려요</small></div></div>
  <a class="set-row click" href="#/errors">${icon('warning')}<div class="label"><b>오류 기록</b><small>재생할 수 없는 파일 · 화면 오류 · 연결 실패 기록</small></div></a>
  <div class="set-row click" data-act="quit">${icon('power')}<div class="label"><b class="danger-text">SyncMusic 완전히 종료</b><small>창을 닫아도 동기화를 위해 서버는 계속 돌아요. 여기서 끌 수 있어요</small></div></div>
</div>

<div class="group-title">정보</div>
<div class="card"><div class="set-row">${icon('info')}<div class="label"><b>SyncMusic ${esc(store.app.version || '')}</b><small>데이터 폴더: ${esc(store.app.dataDir || '')}</small></div></div></div>
</div>`;

  clearInterval(pairTimer);
  if (sync.pairing) {
    pairTimer = setInterval(() => {
      const left = Math.round((sync.pairing.expiresAt - Date.now()) / 1000);
      const t = $('#pair-left');
      if (!t || left <= 0) {
        clearInterval(pairTimer);
        if (t) ctx.refresh({ keepScroll: true });
        return;
      }
      t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }, 1000);
  }
  return { title: '설정', detail: false, plainBack: true };
}

async function saveSetting(patch) {
  store.settings = await put('/api/settings', patch);
  store.emit('settings');
}

// 설정 묶음(가사·전원·소리) 하나 바꾸기
async function saveSection(sect, key, value) {
  if (sect === 'audio') return setAudio({ [key]: value });
  await saveSetting({ [sect]: { [key]: value } });
  if (sect === 'lyrics') lyricsSettingsChanged();
  return undefined;
}

// 백업에서 되살리기: 파일 확인 → 무엇이 들어 있는지 보여 주고 → 되살리기
async function restoreFromFile(file) {
  let b;
  try {
    b = JSON.parse(await file.text());
  } catch {
    return toast('백업 파일을 읽지 못했어요 (JSON이 아니에요)', 4000);
  }
  const sum = await post('/api/backup/inspect', b);
  const ok = await confirmDialog(
    '백업에서 되살리기',
    `${new Date(sum.createdAt).toLocaleString('ko-KR')}에 만든 백업이에요.\n재생목록 ${sum.playlists}개 · 곡 정보 ${sum.tracks}곡 · 들은 기록 ${sum.history}개 · 커버 ${sum.covers}개\n\n지금 재생목록은 변경 이력에 남겨 두고 백업 내용으로 바꿔요. 되살릴까요?`,
    { okLabel: '되살리기' },
  );
  if (!ok) return undefined;
  const r = await post('/api/backup/restore', b);
  toast(`되살렸어요 · 재생목록 ${r.playlists}개 · 곡 정보 ${r.tracks}곡 · 들은 기록 ${r.history}개`, 5000);
  return ctx.refresh({ keepScroll: true });
}

export function bindSettingsEvents(root) {
  root.addEventListener('click', async (e) => {
    if (!root.querySelector('.settings')) return;
    const segBtn = e.target.closest('.seg[data-setting] button, .seg[data-sect] button');
    if (segBtn) {
      const segEl = segBtn.parentElement;
      const raw = segBtn.dataset.v;
      const v = raw === 'true' ? true : raw === 'false' ? false : raw;
      try {
        if (segEl.dataset.sect) await saveSection(segEl.dataset.sect, segEl.dataset.key, v);
        else await saveSetting({ [segEl.dataset.setting]: v });
      } catch (err) {
        toast(err.message, 4000);
      }
      return ctx.refresh({ keepScroll: true });
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    try {
      switch (b.dataset.act) {
        case 'pair-start':
          await post('/api/sync/pairing');
          return ctx.refresh({ keepScroll: true });
        case 'pair-cancel':
          await del('/api/sync/pairing');
          return ctx.refresh({ keepScroll: true });
        case 'rename-pc': {
          const name = await promptText('이 PC의 이름', store.settings.pcName, { okLabel: '저장' });
          if (name) await saveSetting({ pcName: name });
          return ctx.refresh({ keepScroll: true });
        }
        case 'device-more': {
          const id = b.dataset.id;
          return openMenu(
            [
              {
                icon: 'trash',
                label: '연결 해제',
                danger: true,
                run: async () => {
                  if (!(await confirmDialog('연결 해제', '이 폰과의 연결을 끊을까요? 다시 연결하려면 새 코드가 필요해요.', { okLabel: '해제', danger: true }))) return;
                  await del(`/api/sync/devices/${encodeURIComponent(id)}`);
                  ctx.refresh({ keepScroll: true });
                },
              },
            ],
            { anchor: b },
          );
        }
        case 'sync-preview': {
          const { preview } = await get(`/api/sync/devices/${encodeURIComponent(b.dataset.id)}/preview`);
          if (!preview) return toast('폰이 한 번 연결된 뒤에 미리 볼 수 있어요', 3500);
          return ctx.refresh({ keepScroll: true });
        }
        case 'sync-approve':
          await post(`/api/sync/devices/${encodeURIComponent(b.dataset.id)}/approve`);
          toast('허락했어요. 30분 안에 폰이 연결되면 동기화해요', 4000);
          return ctx.refresh({ keepScroll: true });
        case 'handoff': {
          const h = await post('/api/sync/handoff');
          ctx.player.handoff(h);
          return toast(`폰에서 듣던 곳부터 이어 들어요${h.missing ? ` · PC에 없는 곡 ${h.missing}개는 빠졌어요` : ''}`, 4000);
        }
        case 'folder-add': {
          let p = null;
          try {
            p = (await post('/api/system/pick-folder')).path;
          } catch {
            p = await promptText('음악 폴더 경로', '', { okLabel: '추가', placeholder: 'C:\\Users\\...\\Music' });
          }
          if (!p) return;
          await saveSetting({ musicFolders: [...store.settings.musicFolders, p] });
          toast('폴더를 추가했어요. 음악을 찾는 중…');
          return ctx.refresh({ keepScroll: true });
        }
        case 'folder-remove': {
          const i = Number(b.dataset.i);
          const f = store.settings.musicFolders[i];
          if (!(await confirmDialog('폴더 빼기', `"${f}"를 라이브러리에서 뺄까요? 파일은 지워지지 않아요.`, { okLabel: '빼기' }))) return;
          await saveSetting({ musicFolders: store.settings.musicFolders.filter((_, k) => k !== i) });
          return ctx.refresh({ keepScroll: true });
        }
        case 'rescan':
          await post('/api/library/rescan');
          return toast('음악 폴더를 다시 검색해요');
        case 'no-shuffle-list':
          return searchWithFilter({ match: 'all', rules: [{ field: 'noShuffle', op: 'is', value: true }] });
        case 'sleep':
          await sleepDialog();
          return ctx.refresh({ keepScroll: true });
        case 'sound':
          return openNp('sound');
        case 'quality':
          return qualityDialog();
        case 'design':
          return openNp('design');
        case 'layout':
          openNp('design');
          // 디자인 탭 안에서만 '화면 배치'까지 내린다 (scrollIntoView는 재생 화면 전체까지 밀어 올림)
          return setTimeout(() => {
            const pane = $('#np-design');
            const sec = pane?.querySelector('.tab-list')?.closest('.dz');
            if (sec) pane.scrollTo({ top: pane.scrollTop + sec.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8, behavior: 'smooth' });
          }, 400);
        case 'pip':
          return openPip(ctx.player);
        case 'shortcuts':
          return shortcutsDialog(false);
        case 'goals':
          if (await goalsDialog()) ctx.refresh({ keepScroll: true });
          return undefined;
        case 'backup-restore':
          return $('#backup-file').click();
        case 'update-now': {
          b.disabled = true;
          const u = await post('/api/system/update/check');
          toast(u.available ? `새 버전이 있어요 · ${u.count}개 바뀜` : '최신 버전이에요');
          return ctx.refresh({ keepScroll: true });
        }
        case 'update-apply': {
          if (!(await confirmDialog('업데이트', 'GitHub에서 새 버전을 받고 SyncMusic을 다시 켤까요? 듣던 곡과 위치는 그대로 남아요.', { okLabel: '업데이트' }))) return;
          ctx.player.save();
          await post('/api/system/update/apply');
          document.body.insertAdjacentHTML('beforeend', '<div class="overlay-msg"><div><h3>업데이트하는 중…</h3><p>잠시 뒤에 새 버전으로 다시 열려요.</p></div></div>');
          return undefined;
        }
        case 'shortcut':
          await post('/api/system/shortcut');
          return toast('바탕화면에 바로가기를 만들었어요', 3000);
        case 'quit': {
          if (!(await confirmDialog('SyncMusic 종료', '서버를 끄면 폰 자동 동기화도 멈춰요. 종료할까요?', { okLabel: '종료', danger: true }))) return;
          ctx.player.save();
          await post('/api/system/quit');
          document.body.innerHTML = '<div class="empty" style="padding-top:30vh"><h3>SyncMusic을 종료했어요</h3><p>이 창을 닫아도 돼요.</p></div>';
          return undefined;
        }
        default:
          return undefined;
      }
    } catch (err) {
      toast(err.message, 4000);
    }
    return undefined;
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.type !== 'range' || !t.dataset.sect || !root.querySelector('.settings')) return;
    const v = Number(t.value);
    t.style.setProperty('--p', `${((v - Number(t.min)) / (Number(t.max) - Number(t.min))) * 100}%`);
    const out = t.parentElement.querySelector('output');
    if (out) out.textContent = v ? `${v}%` : '끄기';
  });

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (!root.querySelector('.settings')) return;
    try {
      if (t.dataset.sect && (t.type === 'checkbox' || t.type === 'range')) {
        await saveSection(t.dataset.sect, t.dataset.key, t.type === 'checkbox' ? t.checked : Number(t.value));
        if (t.dataset.sect === 'power') store.emit('power');
      } else if (t.dataset.act === 'autostart') {
        const r = await put('/api/system/autostart', { enabled: t.checked });
        toast(r.enabled ? '로그인할 때 백그라운드로 켜져요' : '자동 실행을 껐어요');
      } else if (t.dataset.act === 'update-check') {
        await saveSetting({ updateCheck: t.checked });
      } else if (t.dataset.devicePhone) {
        await put(`/api/sync/devices/${encodeURIComponent(t.dataset.devicePhone)}`, { options: { phoneToPc: t.value } });
        toast('다음 동기화부터 적용돼요');
      } else if (t.dataset.devicePc) {
        await put(`/api/sync/devices/${encodeURIComponent(t.dataset.devicePc)}`, { options: { pcToPhone: t.value } });
        toast('다음 동기화부터 적용돼요');
      } else if (t.dataset.deviceConfirm) {
        await put(`/api/sync/devices/${encodeURIComponent(t.dataset.deviceConfirm)}`, { options: { confirm: t.checked } });
        toast(t.checked ? '이제 동기화하기 전에 PC에서 허락을 기다려요' : '폰이 연결되면 바로 동기화해요');
        ctx.refresh({ keepScroll: true });
      } else if (t.id === 'backup-file' && t.files.length) {
        const f = t.files[0];
        t.value = '';
        await restoreFromFile(f);
      }
    } catch (err) {
      toast(err.message, 4000);
      ctx.refresh({ keepScroll: true });
    }
  });
}

