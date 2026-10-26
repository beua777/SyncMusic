// 단축키 표: 동작 · 기본 키 · 키 이름 다루기 (화면에 의존하지 않아서 테스트에서도 쓴다)
// 키 이름은 KeyboardEvent.code 기준이라 한/영 상태나 자판 배열과 상관없이 같은 자리의 키다.
// 'Ctrl+Shift+Period' 처럼 Ctrl · Alt · Shift 순서로 붙인다.

export const ACTIONS = [
  { id: 'toggle', label: '재생 / 일시정지', key: 'Space' },
  { id: 'next', label: '다음 곡', key: 'Ctrl+ArrowRight' },
  { id: 'prev', label: '이전 곡', key: 'Ctrl+ArrowLeft' },
  { id: 'seekFwd', label: '10초 앞으로', key: 'Shift+ArrowRight' },
  { id: 'seekBack', label: '10초 뒤로', key: 'Shift+ArrowLeft' },
  { id: 'volUp', label: '음량 크게', key: 'Ctrl+ArrowUp' },
  { id: 'volDown', label: '음량 작게', key: 'Ctrl+ArrowDown' },
  { id: 'mute', label: '음소거', key: 'M' },
  { id: 'shuffle', label: '셔플 켜기·끄기', key: 'Ctrl+S' },
  { id: 'repeat', label: '반복 방식 바꾸기', key: 'Ctrl+R' },
  { id: 'favorite', label: '지금 곡 즐겨찾기', key: 'Ctrl+D' },
  { id: 'nowPlaying', label: '재생 화면 열기·닫기', key: 'Ctrl+L' },
  { id: 'lyrics', label: '가사 보기', key: 'L' },
  { id: 'queue', label: '재생 순서 보기', key: 'Q' },
  { id: 'sound', label: '사운드 (이퀄라이저)', key: 'E' },
  { id: 'search', label: '검색', key: 'Ctrl+F' },
  { id: 'ab', label: 'A-B 구간 반복', key: 'B' },
  { id: 'bookmark', label: '지금 위치 북마크', key: 'Ctrl+B' },
  { id: 'speedUp', label: '재생 속도 빠르게', key: 'Shift+Period' },
  { id: 'speedDown', label: '재생 속도 느리게', key: 'Shift+Comma' },
  { id: 'speedReset', label: '재생 속도 보통으로', key: 'Shift+0' },
  { id: 'details', label: '지금 곡 정보', key: 'Ctrl+I' },
  { id: 'pip', label: '작은 창 (항상 위)', key: 'P' },
  { id: 'sleep', label: '수면 타이머', key: '' },
  { id: 'stats', label: '통계', key: '' },
  { id: 'help', label: '단축키 보기', key: 'Shift+Slash' },
];

const NAMED = new Set([
  'Space',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Period',
  'Comma',
  'Slash',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'BracketLeft',
  'BracketRight',
  'Minus',
  'Equal',
]);

// KeyboardEvent.code → 키 이름 ('' = 단축키로 못 씀: Ctrl·Shift 같은 수정 키, 한/영 키 등)
export function keyName(code) {
  const c = String(code || '');
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return `Num${c.slice(6)}`;
  if (/^F([1-9]|1[0-2])$/.test(c)) return c;
  return NAMED.has(c) ? c : '';
}

export function comboOf(e) {
  const k = keyName(e.code);
  if (!k) return '';
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}

// 동작 → 키 (설정에서 바꾼 것 우선, '' = 끔)
export function bindings(custom = {}) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = typeof custom?.[a.id] === 'string' ? custom[a.id] : a.key;
  return out;
}

export function actionFor(combo, custom = {}) {
  if (!combo) return null;
  const b = bindings(custom);
  return ACTIONS.find((a) => b[a.id] === combo)?.id || null;
}

// 저장할 값: 기본과 다른 것만
export function overridesOf(map) {
  const o = {};
  for (const a of ACTIONS) if (typeof map[a.id] === 'string' && map[a.id] !== a.key) o[a.id] = map[a.id];
  return o;
}

// 목록 이동·닫기에 쓰는 키라서 단축키로 고를 수 없다 (수정 키 없이 눌렀을 때)
export const RESERVED = new Set(['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete']);

const SHOW = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

export const fmtCombo = (c) => (c ? c.split('+').map((p) => SHOW[p] ?? (/^Num\d$/.test(p) ? `숫자판 ${p.slice(3)}` : p)).join(' + ') : '없음');
