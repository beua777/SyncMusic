// 알림 · 메뉴 · 대화상자 · 끌어서 순서 바꾸기
import { icon } from '../icons.js';
import { $, clamp, esc } from '../util.js';

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// 아래쪽 알림 막대 (이어 듣기 · 업데이트 · 동기화 확인 · 수면 타이머 끝). 한 번에 하나
// actions: [{ label, primary, run }] · 버튼을 누르면 닫힌다 (run이 false를 돌려주면 그대로)
let noticeTimer;
let noticeId = 0;
export function showNotice({ icon: ic = 'info', html, actions = [], timeout = 0, onClose } = {}) {
  const el = $('#notice');
  const id = ++noticeId;
  clearTimeout(noticeTimer);
  el.hidden = false;
  el.innerHTML = `${icon(ic)}<div class="txt">${html}</div>${actions
    .map((a, i) => `<button class="btn small${a.primary ? ' primary' : ''}" data-i="${i}">${esc(a.label)}</button>`)
    .join('')}<button class="icon-btn" data-close aria-label="닫기">${icon('close')}</button>`;
  const close = () => {
    if (id !== noticeId) return; // 그새 다른 알림으로 바뀜
    clearTimeout(noticeTimer);
    el.hidden = true;
    el.onclick = null;
    onClose?.();
  };
  el.onclick = (e) => {
    if (e.target.closest('[data-close]')) return close();
    const b = e.target.closest('button[data-i]');
    if (b && actions[b.dataset.i].run() !== false) close();
    return undefined;
  };
  if (timeout) noticeTimer = setTimeout(close, timeout);
  return {
    close,
    update: (h) => {
      if (id === noticeId) el.querySelector('.txt').innerHTML = h;
    },
    get open() {
      return id === noticeId && !el.hidden;
    },
  };
}

// 오른쪽 클릭·⋮ 메뉴. items: [{ icon, label, run, danger } | '-']
export function openMenu(items, { x = 0, y = 0, anchor = null } = {}) {
  const el = $('#menu');
  el.innerHTML = items
    .map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'note')}<span>${esc(it.label)}</span></button>`))
    .join('');
  el.hidden = false;
  const r = anchor?.getBoundingClientRect();
  let left = r ? r.right - el.offsetWidth : x;
  let top = r ? r.bottom + 4 : y;
  if (left + el.offsetWidth > innerWidth - 8) left = innerWidth - el.offsetWidth - 8;
  if (top + el.offsetHeight > innerHeight - 8) top = r ? r.top - el.offsetHeight - 4 : y - el.offsetHeight;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
  const buttons = [...el.querySelectorAll('button')];
  buttons[0]?.focus({ preventScroll: true });

  const close = () => {
    el.hidden = true;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    $('#main').removeEventListener('scroll', close);
  };
  const onDown = (e) => {
    if (!el.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  el.onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    close();
    items[b.dataset.i].run();
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    $('#main').addEventListener('scroll', close, { once: true });
  });
}

// One UI 대화상자: 제목 · 내용 · 아래쪽 텍스트 버튼
// cls: 'wide'면 넓은 대화상자 (곡 정보 등)
export function dialog({ title, body = '', html = '', actions, onOpen, cls = '' }) {
  const dlg = $('#dialog');
  dlg.className = cls;
  dlg.innerHTML = `<div class="dlg-title">${esc(title)}</div><div class="dlg-body">${html || esc(body)}</div><div class="dlg-actions">${actions
    .map((a, i) => `<button data-i="${i}" class="${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`)
    .join('')}</div>`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      dlg.close();
      resolve(v);
    };
    dlg.onclick = (e) => {
      const b = e.target.closest('.dlg-actions button');
      if (b) {
        const a = actions[b.dataset.i];
        done(typeof a.value === 'function' ? a.value(dlg) : (a.value ?? null));
      } else if (e.target === dlg) {
        done(null); // 바깥(배경) 클릭
      }
    };
    dlg.oncancel = (e) => {
      e.preventDefault();
      done(null);
    };
    dlg.showModal();
    onOpen?.(dlg, done);
  });
}

export function promptText(title, value = '', { okLabel = '확인', placeholder = '' } = {}) {
  return dialog({
    title,
    html: `<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="100" spellcheck="false">`,
    actions: [
      { label: '취소', value: null },
      { label: okLabel, value: (d) => d.querySelector('input').value.trim() || null },
    ],
    onOpen: (d, done) => {
      const inp = d.querySelector('input');
      inp.focus();
      inp.select();
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done(inp.value.trim() || null);
        }
      };
    },
  });
}

export function confirmDialog(title, body, { okLabel = '확인', danger = false } = {}) {
  return dialog({
    title,
    body,
    actions: [
      { label: '취소', value: false },
      { label: okLabel, value: true, danger },
    ],
  });
}

// 손잡이(.drag)를 잡고 끌어서 .row 순서 바꾸기. 끝나면 onMove(from, to)
export function sortable(container, { onMove, scroller }) {
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag');
    if (!handle || e.button !== 0 || !container.contains(handle)) return;
    const row = handle.closest('.row');
    if (!row) return;
    e.preventDefault();
    const rows = [...row.parentElement.children].filter((c) => c.classList.contains('row'));
    const from = rows.indexOf(row);
    const h = row.offsetHeight;
    const sc = scroller?.() || $('#main');
    const startY = e.clientY;
    const startScroll = sc.scrollTop;
    let lastY = e.clientY;
    let to = from;
    row.classList.add('dragging');
    row.parentElement.classList.add('sorting');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // 펜·터치 일부 환경에서는 캡처가 안 될 수 있음 (그래도 끌기는 동작)
    }

    const update = () => {
      const dy = lastY - startY + (sc.scrollTop - startScroll);
      row.style.transform = `translateY(${dy}px)`;
      to = clamp(from + Math.round(dy / h), 0, rows.length - 1);
      rows.forEach((r, i) => {
        if (r === row) return;
        let s = 0;
        if (from < to && i > from && i <= to) s = -h;
        else if (from > to && i < from && i >= to) s = h;
        r.style.transform = s ? `translateY(${s}px)` : '';
      });
    };
    let raf = 0;
    const autoScroll = () => {
      const b = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
      const edge = 56;
      let v = 0;
      if (lastY < b.top + edge) v = -(b.top + edge - lastY) / 4;
      else if (lastY > b.bottom - edge) v = (lastY - (b.bottom - edge)) / 4;
      if (v) {
        sc.scrollTop += v;
        update();
      }
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);
    const move = (ev) => {
      lastY = ev.clientY;
      update();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      rows.forEach((r) => {
        r.style.transform = '';
      });
      row.classList.remove('dragging');
      row.parentElement.classList.remove('sorting');
      if (to !== from) onMove(from, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}
