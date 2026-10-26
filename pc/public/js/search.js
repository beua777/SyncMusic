// 검색: 고급 필터(여러 조건 조합) · 자연어 검색(한국어 문장 → 조건) · 오타를 허용하는 유사 검색.
// 화면에 의존하지 않아서 테스트에서도 쓴다.
import { scripts } from './phonetic.js';

const DAY = 86_400_000;

// 곡의 주 언어 (제목·가수로 짐작)
export function langOf(t) {
  const s = scripts(`${t.title} ${t.artist}`);
  if (s.kana || (s.kanji && !s.hangul)) return 'ja';
  if (s.hangul) return 'ko';
  if (s.latin) return 'en';
  return null;
}

// 필드: 이름 · 종류 · 값 꺼내기 (ctx: isFavorite(id), inPlaylist(id), now)
export const FIELDS = {
  title: { label: '제목', type: 'text', get: (t) => t.title },
  artist: { label: '아티스트', type: 'text', get: (t) => t.artist },
  album: { label: '앨범', type: 'text', get: (t) => t.album },
  genre: { label: '장르', type: 'text', get: (t) => t.genre || '' },
  folder: { label: '폴더', type: 'text', get: (t) => t.dir || '' },
  codec: { label: '파일 형식', type: 'text', get: (t) => t.codec || '' },
  year: { label: '연도', type: 'number', get: (t) => t.year || null },
  duration: { label: '길이(분)', type: 'number', get: (t) => (t.duration ? t.duration / 60 : 0) },
  playCount: { label: '재생 횟수', type: 'number', get: (t) => t.playCount || 0 },
  skips: { label: '넘긴 횟수', type: 'number', get: (t) => t.skips || 0 },
  bitrate: { label: '비트레이트(kbps)', type: 'number', get: (t) => (t.bitrate ? Math.round(t.bitrate / 1000) : null) },
  lastPlayed: { label: '마지막 재생', type: 'date', get: (t) => t.lastPlayed || 0 },
  addedAt: { label: '추가한 날', type: 'date', get: (t) => t.addedAt || 0 },
  lossless: { label: '무손실', type: 'bool', get: (t) => !!t.lossless },
  favorite: { label: '즐겨찾기', type: 'bool', get: (t, ctx) => !!ctx.isFavorite?.(t.id) },
  hasLyrics: { label: '가사 있음', type: 'bool', get: (t) => !!t.hasLyrics },
  hasCover: { label: '커버 있음', type: 'bool', get: (t) => !!t.cover },
  inPlaylist: { label: '재생목록에 들어 있음', type: 'bool', get: (t, ctx) => !!ctx.inPlaylist?.(t.id) },
  noShuffle: { label: '셔플 제외', type: 'bool', get: (t) => !!t.noShuffle },
  language: { label: '언어', type: 'enum', values: { ko: '한국어', ja: '일본어', en: '영어' }, get: (t) => langOf(t) },
};

export const OPS = {
  text: { contains: '포함', notContains: '포함 안 함', is: '같음', isNot: '같지 않음', startsWith: '~로 시작' },
  number: { gt: '보다 큼', lt: '보다 작음', eq: '같음', between: '사이' },
  date: { withinDays: '최근 N일 안', olderDays: 'N일보다 오래됨', never: '한 번도 없음' },
  bool: { is: '맞음', isNot: '아님' },
  enum: { is: '같음', isNot: '같지 않음' },
};

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function matchRule(t, rule, ctx = {}) {
  const f = FIELDS[rule.field];
  if (!f) return true;
  const v = f.get(t, ctx);
  const x = rule.value;
  switch (`${f.type}:${rule.op}`) {
    case 'text:contains':
      return norm(v).includes(norm(x));
    case 'text:notContains':
      return !norm(v).includes(norm(x));
    case 'text:is':
      return norm(v) === norm(x);
    case 'text:isNot':
      return norm(v) !== norm(x);
    case 'text:startsWith':
      return norm(v).startsWith(norm(x));
    case 'number:gt':
      return v !== null && v > Number(x);
    case 'number:lt':
      return v !== null && v < Number(x);
    case 'number:eq':
      return v !== null && Math.abs(v - Number(x)) < 1e-9;
    case 'number:between':
      return v !== null && v >= Number(x?.[0]) && v <= Number(x?.[1]);
    case 'date:withinDays':
      return v > 0 && v >= (ctx.now ?? Date.now()) - Number(x) * DAY;
    case 'date:olderDays':
      return v > 0 && v < (ctx.now ?? Date.now()) - Number(x) * DAY;
    case 'date:never':
      return !v;
    case 'bool:is':
      return v === (x !== false);
    case 'bool:isNot':
      return v !== (x !== false);
    case 'enum:is':
      return v === x;
    case 'enum:isNot':
      return v !== x;
    default:
      return true;
  }
}

// filter: { match: 'all'|'any', rules, sort: { by, dir }, limit }
export function applyFilter(tracks, filter = {}, ctx = {}) {
  const rules = Array.isArray(filter.rules) ? filter.rules : [];
  const any = filter.match === 'any';
  let out = rules.length ? tracks.filter((t) => (any ? rules.some((r) => matchRule(t, r, ctx)) : rules.every((r) => matchRule(t, r, ctx)))) : tracks.slice();
  const by = filter.sort?.by;
  if (by === 'random') {
    const rand = ctx.random || Math.random;
    out = out.map((t) => [t, rand()]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  } else if (by && FIELDS[by]) {
    const dir = filter.sort.dir === 'asc' ? 1 : -1;
    const get = (t) => FIELDS[by].get(t, ctx) ?? (dir > 0 ? Infinity : -Infinity);
    out.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return typeof x === 'string' ? dir * x.localeCompare(y, 'ko') : dir * (x - y);
    });
  }
  if (filter.limit > 0) out = out.slice(0, filter.limit);
  return out;
}

export function describeRule(r) {
  const f = FIELDS[r.field];
  if (!f) return '';
  const op = OPS[f.type]?.[r.op] ?? r.op;
  const val = f.type === 'bool' ? '' : f.type === 'enum' ? f.values[r.value] ?? r.value : Array.isArray(r.value) ? r.value.join('~') : r.value;
  if (f.type === 'date' && r.op === 'withinDays') return `${f.label}: 최근 ${r.value}일`;
  if (f.type === 'date' && r.op === 'olderDays') return `${f.label}: ${r.value}일 넘음`;
  if (f.type === 'bool') return r.op === 'is' === (r.value !== false) ? f.label : `${f.label} 아님`;
  return `${f.label} ${val} ${op}`.trim();
}

// ───── 자연어 검색 ─────
// "최근 추가한 일본 노래 10곡", "많이 들은 YOASOBI 노래", "3분 이하 짧은 곡", "90년대", "가사 있는 즐겨찾기"
// 알아들은 부분은 조건으로, 남은 낱말은 아티스트 이름이면 아티스트, 아니면 일반 검색어로.
// 아무것도 못 알아들으면 null (그냥 검색)
const STOP = /(노래|곡|음악|들려\s*줘|틀어\s*줘|재생해?\s*줘?|찾아\s*줘|보여\s*줘|주세요|해\s*줘|좀|중에서|중에|만|모두|전부|것|거)$/;

export function parseNatural(q, ctx = {}) {
  let s = ` ${String(q ?? '').trim()} `;
  if (!s.trim()) return null;
  const rules = [];
  const labels = [];
  let sort = null;
  let limit = 0;
  const take = (re, fn) => {
    const m = re.exec(s);
    if (!m) return false;
    s = s.replace(re, ' ');
    fn(m);
    return true;
  };
  take(/(\d{1,3})\s*(곡|개)/, (m) => {
    limit = Number(m[1]);
    labels.push(`${limit}곡`);
  });
  take(/(오래|오랫동안|한동안)\s*(안|못)\s*들은/, () => {
    rules.push({ field: 'lastPlayed', op: 'olderDays', value: 90 });
    labels.push('오래 안 들은');
  }) ||
    take(/(한\s*번도\s*)?(안|못)\s*들은|들어\s*본\s*적\s*(이\s*)?없는/, () => {
      rules.push({ field: 'playCount', op: 'eq', value: 0 });
      labels.push('안 들은');
    });
  take(/(최근|요즘|새로|이번\s*(주|달))\s*(에\s*)?(추가(한|된)?|넣은|받은|들어온)/, (m) => {
    const days = /주/.test(m[2] || '') ? 7 : 30;
    rules.push({ field: 'addedAt', op: 'withinDays', value: days });
    sort ||= { by: 'addedAt', dir: 'desc' };
    labels.push('최근 추가');
  });
  take(/(오늘|어제|최근|요즘|이번\s*주)\s*(에\s*)?들은/, (m) => {
    const days = m[1] === '오늘' ? 1 : m[1] === '어제' ? 2 : 7;
    rules.push({ field: 'lastPlayed', op: 'withinDays', value: days });
    sort ||= { by: 'lastPlayed', dir: 'desc' };
    labels.push(`${m[1]} 들은`);
  });
  take(/(많이|자주)\s*(들은|듣는|재생한)/, () => {
    rules.push({ field: 'playCount', op: 'gt', value: 0 });
    sort = { by: 'playCount', dir: 'desc' };
    labels.push('많이 들은');
  });
  take(/(자주\s*)?(넘긴|건너뛴)/, () => {
    rules.push({ field: 'skips', op: 'gt', value: 0 });
    sort ||= { by: 'skips', dir: 'desc' };
    labels.push('자주 넘긴');
  });
  take(/즐겨\s*찾기(한|에\s*있는)?|좋아요\s*(한|누른)?|좋아하는/, () => {
    rules.push({ field: 'favorite', op: 'is', value: true });
    labels.push('즐겨찾기');
  });
  take(/가사\s*(가\s*)?(있는|있음)/, () => {
    rules.push({ field: 'hasLyrics', op: 'is', value: true });
    labels.push('가사 있는');
  }) ||
    take(/가사\s*(가\s*)?없는/, () => {
      rules.push({ field: 'hasLyrics', op: 'is', value: false });
      labels.push('가사 없는');
    });
  take(/커버\s*(가\s*)?없는/, () => {
    rules.push({ field: 'hasCover', op: 'is', value: false });
    labels.push('커버 없는');
  });
  take(/(\d{1,3})\s*분\s*(이하|이내|안쪽|미만|보다\s*짧은|안\s*되는)/, (m) => {
    rules.push({ field: 'duration', op: 'lt', value: Number(m[1]) });
    labels.push(`${m[1]}분 이하`);
  });
  take(/(\d{1,3})\s*분\s*(이상|넘는|초과|보다\s*긴)/, (m) => {
    rules.push({ field: 'duration', op: 'gt', value: Number(m[1]) });
    labels.push(`${m[1]}분 넘는`);
  });
  const hasDuration = () => rules.some((r) => r.field === 'duration');
  if (!hasDuration()) {
    take(/짧은/, () => {
      rules.push({ field: 'duration', op: 'lt', value: 3 });
      labels.push('짧은 (3분 안)');
    });
  }
  if (!hasDuration()) {
    take(/긴(?=\s|$)/, () => {
      rules.push({ field: 'duration', op: 'gt', value: 6 });
      labels.push('긴 (6분 넘게)');
    });
  }
  take(/(\d{2,4})\s*년대/, (m) => {
    let y = Number(m[1]);
    if (y < 100) y += y >= 30 ? 1900 : 2000;
    rules.push({ field: 'year', op: 'between', value: [y, y + 9] });
    labels.push(`${y}년대`);
  });
  take(/(\d{4})\s*년(?!대)/, (m) => {
    rules.push({ field: 'year', op: 'eq', value: Number(m[1]) });
    labels.push(`${m[1]}년`);
  });
  take(/무손실|flac|고음질/i, () => {
    rules.push({ field: 'lossless', op: 'is', value: true });
    labels.push('무손실');
  });
  take(/일본\s*(어\s*)?(노래|곡|음악)?|j-?pop|제이\s*팝/i, () => {
    rules.push({ field: 'language', op: 'is', value: 'ja' });
    labels.push('일본 노래');
  });
  take(/한국\s*(어\s*)?(노래|곡|음악)?|가요|k-?pop|케이\s*팝/i, () => {
    rules.push({ field: 'language', op: 'is', value: 'ko' });
    labels.push('한국 노래');
  });
  take(/영어\s*(노래|곡)?|팝송|해외\s*(노래|곡)?/, () => {
    rules.push({ field: 'language', op: 'is', value: 'en' });
    labels.push('영어 노래');
  });
  take(/랜덤|아무거나|무작위|섞어서/, () => {
    sort = { by: 'random' };
    labels.push('무작위');
  });
  // 남은 낱말: "~의" 떼고, 아티스트 이름과 맞으면 아티스트
  const words = s
    .split(/\s+/)
    .map((w) => w.replace(/의$/, '').replace(STOP, ''))
    .filter((w) => w && !STOP.test(w) && !/^(노래|곡|음악|것|거)$/.test(w));
  let text = words.join(' ');
  if (text && ctx.artists?.length) {
    const nt = norm(text);
    const hit = ctx.artists.find((a) => norm(a) === nt) || (nt.length >= 2 && ctx.artists.find((a) => norm(a).includes(nt)));
    if (hit) {
      rules.push({ field: 'artist', op: norm(hit) === nt ? 'is' : 'contains', value: norm(hit) === nt ? hit : text });
      labels.push(`가수: ${hit}`);
      text = '';
    }
  }
  if (!labels.length) return null;
  return { rules, sort, limit, text, labels };
}

// ───── 오타 허용 검색 ─────
// 한글은 자모로 풀어서 비교 (받침 하나·모음 하나 틀린 것도 한 글자 차이로)
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

export function decompose(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFC').toLowerCase()) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c < 11172) out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
    else if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

// pattern이 text 안의 어느 부분과 가장 비슷한지: 최소 편집 거리 (Sellers 알고리즘)
export function approxDistance(pattern, text) {
  const m = pattern.length;
  if (!m) return 0;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = m;
  for (let j = 1; j <= text.length; j++) {
    cur[0] = 0; // 아무 데서나 시작해도 된다
    for (let i = 1; i <= m; i++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + cost);
    }
    if (cur[m] < best) best = cur[m];
    [prev, cur] = [cur, prev];
  }
  return Math.min(best, prev[m]);
}

// 허용할 오타 수: 짧은 말은 엄격하게
export const allowedTypos = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : len <= 12 ? 2 : 3);

// tracks에서 query와 비슷한 곡, 가까운 것부터 (정확히 찾은 곡을 빼는 건 부르는 쪽에서)
export function fuzzySearch(tracks, query, limit = 50) {
  const q = decompose(query);
  const max = allowedTypos(q.length);
  if (!max) return [];
  const out = [];
  for (const t of tracks) {
    const hay = t._f ?? decompose(`${t.title} ${t.artist} ${t.album}`);
    const d = approxDistance(q, hay);
    if (d <= max) out.push([t, d]);
  }
  return out
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map((x) => x[0]);
}
