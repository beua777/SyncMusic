// 설정 · 휴대폰 동기화
import { del, get, post, put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { $, esc, fmtAgo, fmtClock } from '../util.js';
import { confirmDialog, openMenu, promptText, toast } from './dom.js';
import { openNp, sleepDialog } from './nowplaying.js';

let pairTimer = null;

const scanText = (s) =>
  !s ? '' : s.scanning ? `음악을 찾는 중… ${s.done}/${s.total}` : `${store.list.length}곡 · 마지막 검색 ${s.lastScan ? fmtAgo(s.lastScan) : '없음'}`;

export function onScanProgress(s) {
  const el = $('#scan-status');
  if (el) el.textContent = scanText(s);
}

const resultText = (r) =>
  r ? `받은 곡 ${r.uploaded} · 보낸 곡 ${r.downloaded} · 재생목록 ${r.playlists}${r.errors ? ` · 오류 ${r.errors}` : ''}` : '아직 동기화 전';

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
  </select></div>`;
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

export async function settingsView(el) {
  if (!el.querySelector('.settings')) el.innerHTML = '<div class="settings"><div class="empty compact"><p>불러오는 중…</p></div></div>';
  const [sync, auto] = await Promise.all([get('/api/sync/status'), get('/api/system/autostart').catch(() => ({ enabled: false }))]);
  ctx.list = { ids: [], source: null };
  const s = store.settings;
  const addr = sync.addresses.length ? sync.addresses.map((a) => a.address).join(', ') : '네트워크 연결 없음';
  const sleep = ctx.player.sleep;
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
</div>

<div class="group-title">재생</div>
<div class="card">
  <div class="set-row"><div class="label"><b>목록에서 곡을 누르면</b><small>셔플 유지: 누른 곡부터 지금 셔플 상태 그대로 · 목록 순서대로: 셔플을 끄고 목록 순서로 (삼성 뮤직 도움말에 적힌 동작)</small></div>
    ${seg('tapKeepsShuffle', [
      [true, '셔플 유지'],
      [false, '목록 순서대로'],
    ])}</div>
  <div class="set-row click" data-act="sleep">${icon('moon')}<div class="label"><b>수면 타이머</b><small>${sleep?.at ? `${fmtClock(sleep.at)}에 멈춰요` : sleep ? '지금 곡이 끝나면 멈춰요' : '꺼짐'}</small></div></div>
  <div class="set-row">${icon('info')}<div class="label"><b>셔플·반복 규칙</b><small>셔플은 한 바퀴 동안 같은 곡이 다시 나오지 않아요 · 반복 버튼은 반복 안 함 → 전체 반복 → 한 곡 반복 · 이전 버튼은 3초가 지났으면 처음부터, 아니면 이전 곡 · 앱을 다시 켜도 섞인 순서가 그대로예요</small></div></div>
</div>

<div class="group-title">화면</div>
<div class="card"><div class="set-row"><div class="label"><b>테마</b></div>${seg('theme', [
    ['system', '시스템'],
    ['light', '라이트'],
    ['dark', '다크'],
  ])}</div>
  <div class="set-row click" data-act="design">${icon('palette')}<div class="label"><b>디자인 꾸미기</b><small>포인트 색 · 재생 화면 배경 색(앨범 색 · 랜덤 · 무지개 · 직접 고르기) · 오디오 스펙트럼</small></div></div></div>

<div class="group-title">Windows</div>
<div class="card">
  <div class="set-row"><div class="label"><b>로그인할 때 백그라운드로 실행</b><small>창을 열지 않아도, 폰이 같은 Wi-Fi에 오면 동기화돼요</small></div>
    <label class="switch"><input type="checkbox" data-act="autostart" ${auto.enabled ? 'checked' : ''}><span></span></label></div>
  <div class="set-row click" data-act="shortcut">${icon('desktop')}<div class="label"><b>바탕화면 바로가기 만들기</b><small>바로가기로 열면 주소창 없는 앱 창으로 열려요</small></div></div>
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

export function bindSettingsEvents(root) {
  root.addEventListener('click', async (e) => {
    if (!root.querySelector('.settings')) return;
    const segBtn = e.target.closest('.seg[data-setting] button');
    if (segBtn) {
      const key = segBtn.parentElement.dataset.setting;
      const raw = segBtn.dataset.v;
      await saveSetting({ [key]: raw === 'true' ? true : raw === 'false' ? false : raw });
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
        case 'sleep':
          await sleepDialog();
          return ctx.refresh({ keepScroll: true });
        case 'design':
          return openNp('design');
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

  root.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.act === 'autostart') {
        const r = await put('/api/system/autostart', { enabled: t.checked });
        toast(r.enabled ? '로그인할 때 백그라운드로 켜져요' : '자동 실행을 껐어요');
      } else if (t.dataset.devicePhone) {
        await put(`/api/sync/devices/${encodeURIComponent(t.dataset.devicePhone)}`, { options: { phoneToPc: t.value } });
        toast('다음 동기화부터 적용돼요');
      } else if (t.dataset.devicePc) {
        await put(`/api/sync/devices/${encodeURIComponent(t.dataset.devicePc)}`, { options: { pcToPhone: t.value } });
        toast('다음 동기화부터 적용돼요');
      }
    } catch (err) {
      toast(err.message, 4000);
      ctx.refresh({ keepScroll: true });
    }
  });
}
