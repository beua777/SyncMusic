// 단축키 실행 · 단축키 바꾸기 창 · 키보드만으로 목록 쓰기 (↑↓ 이동 · Enter 재생 · Shift+Enter 다음에 재생)
import { put } from '../api.js';
import { ctx } from '../ctx.js';
import { icon } from '../icons.js';
import { ACTIONS, actionFor, bindings, comboOf, fmtCombo, overridesOf, RESERVED } from '../keymap.js';
import { store } from '../store.js';
import { $, $$, clamp, esc, fmtTime } from '../util.js';
import { toggleFavorite } from './common.js';
import { addBookmark, openDetails } from './details.js';
import { dialog, toast } from './dom.js';
import { closeNp, isNpOpen, openNp, sleepDialog } from './nowplaying.js';
import { openPip } from './pip.js';
import { setAudio } from './sound.js';

const REPEAT_LABEL = { off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' };

// 글자를 치는 중인지 (단축키가 글자 입력을 가로채지 않게)
export const isTyping = (el) => !!el?.closest?.('input, textarea, select, [contenteditable]') && !['checkbox', 'radio', 'button', 'range', 'color'].includes(el.type);

function changeRate(delta) {
  const p = ctx.player;
  const r = delta ? clamp(Math.round(((p.opts.rate || 1) + delta) * 20) / 20, 0.5, 2) : 1;
  setAudio({ rate: r });
  toast(`재생 속도 ${r}배`, 1200);
}

function run(id) {
  const p = ctx.player;
  const t = p.track;
  switch (id) {
    case 'toggle':
      return p.toggle();
    case 'next':
      return p.next();
    case 'prev':
      return p.prev();
    case 'seekFwd':
      return p.seekBy(10);
    case 'seekBack':
      return p.seekBy(-10);
    case 'volUp':
      return p.setVolume((p.muted ? 0 : p.volume) + 0.05);
    case 'volDown':
      return p.setVolume((p.muted ? 0 : p.volume) - 0.05);
    case 'mute':
      return p.toggleMute();
    case 'shuffle':
      return toast(p.toggleShuffle() ? '셔플 켜짐' : '셔플 꺼짐', 1300);
    case 'repeat':
      return toast(REPEAT_LABEL[p.cycleRepeat()], 1300);
    case 'favorite':
      return t && toggleFavorite(t.id);
    case 'nowPlaying':
      return isNpOpen() ? closeNp() : openNp();
    case 'lyrics':
      return openNp('lyrics');
    case 'queue':
      return openNp('queue');
    case 'sound':
      return openNp('sound');
    case 'search':
      return ctx.go('#/search');
    case 'ab': {
      if (!t) return undefined;
      const ab = p.cycleAB();
      return toast(!ab ? 'A-B 반복을 껐어요' : ab.b === null ? `A: ${fmtTime(ab.a)} · 끝낼 곳에서 한 번 더 눌러요` : `${fmtTime(ab.a)} ~ ${fmtTime(ab.b)} 반복`, 2000);
    }
    case 'bookmark':
      return t && addBookmark(t.id);
    case 'speedUp':
      return changeRate(0.1);
    case 'speedDown':
      return changeRate(-0.1);
    case 'speedReset':
      return changeRate(0);
    case 'details':
      return t && openDetails(t.id);
    case 'pip':
      return openPip(p);
    case 'sleep':
      return sleepDialog();
    case 'stats':
      return ctx.go('#/stats');
    case 'help':
      return shortcutsDialog(true);
    default:
      return undefined;
  }
}

// 앱 전체의 keydown에서 부른다. 처리했으면 true
export function onKeydown(e) {
  if (e.defaultPrevented || e.isComposing) return false;
  if ($('#dialog').open || !$('#menu').hidden) return false; // 대화상자·메뉴가 먼저
  const typing = isTyping(e.target);
  const id = actionFor(comboOf(e), store.settings.shortcuts);
  // 음량·진행 막대에 손을 댄 채 화살표를 누르면 막대가 움직이게 둔다
  const onSlider = e.target?.type === 'range' && /^(Arrow|Home|End|Page)/.test(e.code) && !e.ctrlKey && !e.metaKey;
  if (id && !onSlider && (!typing || id === 'search')) {
    e.preventDefault();
    run(id);
    return true;
  }
  if (!typing && e.code === 'Slash' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    ctx.go('#/search');
    return true;
  }
  return listNav(e);
}

// ───── 키보드로 목록 쓰기 ─────

const NAV = '.row.track, .row.artist, .row.folder, .row.pl, .album-card, a.tile';
const navItems = () => $$(NAV, $('#view')).filter((el) => el.offsetParent !== null);

function focusItem(el) {
  if (!el.matches('a, button, [tabindex]')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

// 아무것도 고르지 않았을 때는 지금 화면에 보이는 첫 항목부터
function firstVisible(items) {
  const top = $('#appbar').getBoundingClientRect().bottom;
  return Math.max(0, items.findIndex((el) => el.getBoundingClientRect().top >= top - 2));
}

export function listNav(e) {
  if (e.ctrlKey || e.altKey || e.metaKey || isNpOpen()) return false;
  const k = e.key;
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp', 'Enter'].includes(k)) return false;
  const fromSearch = e.target?.id === 'search-input';
  if (isTyping(e.target) && !(fromSearch && k === 'ArrowDown')) return false;
  if (e.target?.type === 'range') return false;
  const items = navItems();
  if (!items.length) return false;
  const cur = items.indexOf(document.activeElement?.closest?.(NAV));
  if (k === 'Enter') {
    if (cur < 0) return false;
    e.preventDefault();
    const el = items[cur];
    if (e.shiftKey && el.matches('.row.track')) {
      ctx.player.playNext([el.dataset.id]);
      toast('다음 곡으로 넣었어요');
    } else el.click();
    return true;
  }
  // ←→는 앨범·타일 격자에서만 (목록에서는 단축키·스크롤에 양보)
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && !(cur >= 0 && items[cur].matches('.album-card, a.tile'))) return false;
  let i;
  if (cur < 0) i = k === 'End' ? items.length - 1 : k === 'Home' ? 0 : firstVisible(items);
  else if (k === 'ArrowDown' || k === 'ArrowRight') i = Math.min(items.length - 1, cur + 1);
  else if (k === 'ArrowUp' || k === 'ArrowLeft') {
    if (cur === 0 && ctx.route?.name === 'search') {
      e.preventDefault();
      $('#search-input').focus();
      return true;
    }
    i = Math.max(0, cur - 1);
  } else if (k === 'Home') i = 0;
  else if (k === 'End') i = items.length - 1;
  else if (k === 'PageDown') i = Math.min(items.length - 1, cur + 10);
  else i = Math.max(0, cur - 10);
  e.preventDefault();
  focusItem(items[i]);
  return true;
}

// ───── 단축키 보기·바꾸기 ─────

export function shortcutsDialog(viewOnly = false) {
  let map = bindings(store.settings.shortcuts);
  let capturing = null;
  const rows = () =>
    ACTIONS.map((a) => {
      const changed = map[a.id] !== a.key;
      const label = capturing === a.id ? '키를 누르세요…' : esc(fmtCombo(map[a.id]));
      return `<div class="kb-row"><span>${a.label}</span><button class="kb-key${map[a.id] ? '' : ' off'}${capturing === a.id ? ' wait' : ''}" data-kb="${a.id}" ${viewOnly ? 'disabled' : ''}>${label}</button>${
        !viewOnly && changed ? `<button class="icon-btn" data-kbreset="${a.id}" title="기본값: ${esc(fmtCombo(a.key))}" aria-label="기본값으로">${icon('history')}</button>` : '<span class="kb-gap"></span>'
      }</div>`;
    }).join('');
  const save = async () => {
    try {
      store.settings = await put('/api/settings', { shortcuts: overridesOf(map) });
    } catch (err) {
      toast(err.message, 4000);
    }
  };
  return dialog({
    title: viewOnly ? '단축키' : '단축키 바꾸기',
    cls: 'wide',
    html: `<div class="kb">
  ${viewOnly ? '' : '<p class="dz-note">바꿀 키를 누른 다음 새 키를 눌러요. Backspace = 끄기 · Esc = 그대로 두기. 다른 동작과 겹치면 그쪽은 꺼져요</p>'}
  <div class="kb-list">${rows()}</div>
  <p class="dz-note">늘 쓰는 키: ↑↓ 목록 이동 · Enter 재생 · Shift+Enter 다음에 재생 · / 검색 · Esc 닫기 · 메뉴 키 곡 메뉴</p>
</div>`,
    actions: viewOnly
      ? [
          { label: '바꾸기', value: 'edit' },
          { label: '닫기', value: null },
        ]
      : [
          { label: '모두 기본값', value: 'reset', danger: true },
          { label: '닫기', value: null },
        ],
    onOpen: (d) => {
      const list = d.querySelector('.kb-list');
      const redraw = () => {
        list.innerHTML = rows();
      };
      const assign = (id, combo) => {
        if (combo) {
          for (const a of ACTIONS) {
            if (a.id !== id && map[a.id] === combo) {
              map[a.id] = '';
              toast(`겹쳐서 "${a.label}" 단축키를 껐어요`, 2600);
            }
          }
        }
        map = { ...map, [id]: combo };
        capturing = null;
        redraw();
        save();
      };
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-kb]');
        if (b) {
          capturing = capturing === b.dataset.kb ? null : b.dataset.kb;
          redraw();
          list.querySelector('.kb-key.wait')?.focus();
          return;
        }
        const r = e.target.closest('[data-kbreset]');
        if (r) assign(r.dataset.kbreset, ACTIONS.find((a) => a.id === r.dataset.kbreset).key);
      });
      d.addEventListener(
        'keydown',
        (e) => {
          if (!capturing) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') {
            capturing = null;
            redraw();
            return;
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            assign(capturing, '');
            return;
          }
          const combo = comboOf(e);
          if (!combo) return; // Ctrl·Shift만 누른 상태
          if (RESERVED.has(combo)) {
            toast(`${fmtCombo(combo)}는 목록 이동에 쓰여서 고를 수 없어요. Ctrl이나 Shift와 같이 눌러 보세요`, 3000);
            return;
          }
          assign(capturing, combo);
        },
        true,
      );
    },
  }).then(async (v) => {
    if (v === 'edit') return shortcutsDialog(false);
    if (v === 'reset') {
      try {
        store.settings = await put('/api/settings', { shortcuts: {} });
        toast('단축키를 기본값으로 돌렸어요');
      } catch (err) {
        toast(err.message, 4000);
      }
    }
    return undefined;
  });
}
