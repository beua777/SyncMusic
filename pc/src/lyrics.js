import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { phoneticKey } from '../public/js/phonetic.js';
import { readingKey } from './reading.js';
import { lrcPathFor, readLyrics } from './tags.js';
import { JsonStore } from './util/jsonfile.js';

// 가사: 온라인 가사 찾기(LRCLIB, 사용자가 허락함) · .lrc로 저장 · 자동 번역(Google, 파일에 번역이 없을 때) · 가사로 곡 찾기
const UA = 'SyncMusic (https://github.com/beua777/SyncMusic)';

// 유튜브에서 받은 곡 제목은 군더더기가 많아서 검색 전에 다듬는다:
//   "【 4人 COVER 】 노래 제목 (song title) Cover by. 누군가" → "노래 제목"
export function cleanTitle(title) {
  let s = String(title ?? '')
    .normalize('NFKC')
    .replace(/[【\[(（][^】\])）]*[】\])）]/g, ' ')
    .replace(/\b(cover(ed)? by|feat\.?|ft\.)[\s\S]*$/i, ' ')
    .replace(/\b(official|music video|video|mv|m\/v|lyrics?|audio|hd|4k|cover)\b/gi, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[|｜/／⧸~～].*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = String(title ?? '').trim();
  return s;
}

// 가수를 모르는 곡은 제목에서 가수를 꺼내 본다 (유튜브에서 받은 곡):
//   일본식 "가수「제목」", 또는 왼쪽이 짧고 괄호가 없는 "가수 - 제목" (반대 순서일 수도 있어서 조심스럽게)
export function guessArtistTitle(title, artist) {
  const known = artist && !/^<.*>$/.test(artist) && !/알 수 없음/.test(artist);
  const raw = String(title ?? '').normalize('NFKC').split(/\s*[|｜⧸／]\s*/)[0];
  if (!known) {
    const jp = /^([^「『]{1,40})[「『]([^」』]+)[」』]/.exec(raw);
    if (jp) return { artist: jp[1].trim(), title: jp[2].trim() };
    const m = /^([^[\]()【】（）]{1,40}?)\s+[-–—]\s+(.+)$/.exec(raw);
    if (m && m[1].trim().split(/\s+/).length <= 4) return { artist: m[1].trim(), title: cleanTitle(m[2]) };
  }
  return { artist: known ? artist : '', title: cleanTitle(raw) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LRCLIB은 바쁠 때 503(Retry-After: 1초)을 자주 준다 → 잠깐 쉬고 두 번까지 다시
async function getJson(url, { timeout = 10_000, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      if (i >= tries || e.name === 'TimeoutError') throw e;
      await sleep(500 * i);
      continue;
    }
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if (i >= tries || ![429, 502, 503, 504].includes(res.status)) throw new Error(`가사 서버 응답 ${res.status}`);
    res.body?.cancel().catch(() => {});
    const after = Number.parseFloat(res.headers.get('retry-after'));
    await sleep(Math.min(5, Number.isFinite(after) ? after : i) * 1000 + Math.random() * 300);
  }
}

const pick = (r) => ({
  id: r.id,
  title: r.trackName,
  artist: r.artistName,
  album: r.albumName,
  duration: r.duration,
  synced: !!r.syncedLyrics,
  instrumental: !!r.instrumental,
  lyrics: r.syncedLyrics || r.plainLyrics || '',
});

// ───── 곡 제목에서 찾을 말 뽑기 ─────
// 유튜브에서 받은 곡은 진짜 제목·가수가 제목 안 여기저기에 있다:
//   "가수『제목』MV" · "【올린 사람】 가수(Singer) - 제목 Cover" · "【歌ってみた】제목 - 가수 covered by 누군가"
//   "번역 제목 (原題) COVER" · "Title / 歌手(official)" · "タイトル  歌手 (Title  Singer)"
// 그래서 제목 후보·가수 후보를 여럿 뽑고(어느 쪽이 가수인지 모르면 둘 다), 실제로 찾은 결과를 점수로 고른다.

const QUOTE = /[『「‘“〈《"]([^』」’”〉》"]{1,80})[』」’”〉》"]/g;
const QUOTE_START = /^\s*[『「‘“〈《"]/;
const BRACKET = /[【\[(（]([^【\[(（】\])）]{0,80})[】\])）]/g;
const MARK = /\uE000(\d+)\uE001/g;
const HAN = /\p{Script=Han}/u;
const HANGUL = /[가-힣]/;
const NOT_HANGUL = /[぀-ヿ一-鿿A-Za-z]/;
const UNKNOWN_ARTIST = /^<.*>$|알 수 없음|^unknown$/i;
// 보컬로이드·합성 음성 이름: 제목 쪽에 섞여 있으면 가수로 돌린다
const VOICES = /初音ミク|鏡音リン|鏡音レン|巡音ルカ|重音テト|歌愛ユキ|結月ゆかり|小春六花|可不|裏命|\b(?:v\s?flower|GUMI|IA|MEIKO|KAITO|hatsune\s?miku)\b/i;
// 검색에 방해되는 말: 영상·커버 표시, 업로더 꼬리표, 피처링
const NOISE = [
  /\b(?:official|original)(?=$|[\s\])）】,.])/gi, // "Official髭男dism"처럼 이름에 붙은 건 그대로
  /\b(?:music\s*video|music\s*clip|lyrics?\s*video|official\s*(?:video|audio)|audio\s*track|full\s*ver(?:sion)?\.?|tv\s*size|short\s*ver(?:sion)?\.?|mv|m\/v|pv|lyrics?|hd|4k|hq)\b/gi,
  /\b(?:korean|japanese|english|kor|jpn|eng)\s*(?:ver(?:sion)?\.?|cover|sub(?:title)?s?)\b/gi,
  /\bcover(?:ed)?\s*by\b.*$/i,
  /\bcover\b/gi,
  /\bacoustic\s*arrange\s*ver\.?/gi,
  /\S*ver\.(?:\s*\S+)?/gi,
  /\b(?:feat|ft)\b\.?\s*(?=\S).*$/i,
  /\bvo(?:cal)?\.\s*.*$/i,
  /(?:オフィシャル|オリジナル)\s*(?:mv|ミュージックビデオ)?/gi,
  /歌ってみた|歌いました|歌わせて(?:いただき|頂き)ました|弾き語り|\d*時間耐久/g,
  /한국어\s*(?:커버|버전|ver\.?|자막)|한글\s*(?:번역|자막)|우타이테|커버송|커버|고음질|라이브|가사|자막|번역/g,
  /\b(?:OST|O\.S\.T\.?|OP|ED)\b/g,
  /테마곡|주제곡/g,
  /#\d+/g,
  /[【\[(（][^】\])）]*$/, // 잘린 괄호 꼬리 "【Official Music V"
];
// 괄호 안이 이것뿐이면 다른 제목이 아니라 설명
const BRACKET_NOTE = /^(?:live|.*\bremix|re-?master(?:ed)?|\d{4}\s*re-?master(?:ed)?|inst(?:rumental)?\.?|off\s*vocal|acoustic|piano|short|full|tv\s*size|.*\bver(?:sion)?\.?|video|audio|lyrics?|prod\b.*|.*\bedit|explicit|clean|sped\s*up|slowed.*|nightcore)$/i;
const SPLIT = /\s*(?:[\/／⧸|｜│]|\s[-–—~_]\s|\s[xX×]\s)\s*/;

// 비교용: 모양만 다른 글자를 맞춘다 (전각·대소문자·띄어쓰기·문장부호, 가타카나→히라가나)
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const normKey = (s) => toHira(String(s ?? '').normalize('NFKC').toLowerCase()).replace(/[\s\p{P}\p{S}]+/gu, '');

function denoise(s) {
  let x = String(s ?? '');
  for (const re of NOISE) x = x.replace(re, ' ');
  return x.replace(/\s+/g, ' ').trim();
}
const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/^[\s\-–—~:：|｜│/／⧸・、,.]+|[\s\-–—~:：|｜│/／⧸・、,]+$/g, '').trim();
const hangulOnly = (x) => HANGUL.test(x) && !NOT_HANGUL.test(x);
const onlyVoice = (x) => {
  const m = VOICES.exec(x);
  return !!m && !tidy(x.replace(m[0], ' '));
};

// 띄어 쓴 가수·제목 ("Sora 星空"는 글자 종류가 바뀌는 곳에서), 붙여 쓴 영문+일본어 ("melodyさくら", "SunsetあおぞらBLUE")
function scriptSplit(s, glued = false) {
  const kind = (w) => (/[぀-ヿ一-鿿]/.test(w) ? 'j' : HANGUL.test(w) ? 'k' : /[a-z0-9]/i.test(w) ? 'l' : 'o');
  const runs = [];
  for (const w of String(s).split(' ')) {
    const k = kind(w);
    if (runs.length && runs[runs.length - 1].k === k) runs[runs.length - 1].t += ` ${w}`;
    else runs.push({ k, t: w });
  }
  const out = runs.length > 1 ? runs.map((r) => r.t) : [];
  if (glued) {
    for (const w of String(s).split(' ')) {
      const bits = w.match(/[A-Za-z][A-Za-z0-9'&.!?-]*|[぀-ヿ一-鿿ー]+/g) || [];
      if (bits.length >= 2 && bits.length <= 4 && bits.join('') === w && new Set(bits.map(kind)).size > 1) out.push(...bits);
    }
  }
  return out;
}

export function lyricTerms(title, artist = '') {
  const s = String(title ?? '')
    .normalize('NFKC')
    .replace(/[^\S\n]{2,}/g, ' ｜ ') // 두 칸 띄움도 구분자 ("タイトル  歌手"). NFKC 뒤라 ｜는 이것뿐
    .replace(/\p{Extended_Pictographic}|[\u2600-\u27BF\u2B00-\u2BFF\uFE0F]/gu, ' ')
    .replace(/y2mate\.com\s*-?/gi, ' ')
    .replace(/^\s*[【\[]([^】\]]*\s[-–—]\s[^】\]]*)[】\]]/, ' $1 / ') // 맨 앞 괄호에 "가수 - 제목"이 통째로 든 것
    .replace(/\s+/g, ' ')
    .trim();
  const cover = /cover|커버|歌って|歌いました|弾き語り|ver\./i.test(s);
  const korean = /(?:한국어|korean|kor)\s*(?:커버|cover|ver\.?|버전)|(?:커버|cover)\s*[(（]?\s*(?:한국어|korean)/i.test(s);
  const titles = [];
  const artists = []; // 가수가 거의 확실한 자리: "가수 - 제목"의 한쪽, 『』 앞, 곡의 가수 태그
  const maybe = []; // 가수일 수도 있는 것: 제목 옆 괄호, 붙여 쓴 말, 보컬로이드 이름, 커버한 사람
  const voices = [];
  const add = (list, x) => {
    let v = tidy(x);
    const voice = VOICES.exec(v);
    if (voice && list === titles) {
      voices.push(voice[0]);
      v = tidy(v.replace(voice[0], ' '));
    }
    const k = normKey(v);
    if (!k || k.length > 80 || /^\d+$/.test(k) || (k.length < 2 && /[a-z0-9]/.test(k))) return;
    if (!list.some((y) => normKey(y) === k)) list.push(v);
  };
  const addAll = (list, xs) => {
    for (const x of xs) add(list, x);
  };
  // 한 덩어리 → [이름, 괄호 속 다른 이름…]. 한글 이름 옆 괄호의 원어(일본어·영어)를 먼저: "번역 제목 (原題)", "가수(Singer)"
  const expand = (base, aliases) => {
    const first = HANGUL.test(base) && !NOT_HANGUL.test(base) ? aliases.filter((a) => NOT_HANGUL.test(a)) : [];
    return [...first, base, ...aliases.filter((a) => !first.includes(a))].filter(Boolean);
  };
  const inner = (raw) => {
    const x = denoise(raw);
    return x && !BRACKET_NOTE.test(x) ? x.split(SPLIT).map(tidy).filter(Boolean) : [];
  };

  // 1. 따옴표: 가수『제목』. 안이 "제목/가수"면 나누고, "제목 / 『가수』"처럼 빗금 바로 뒤면 거꾸로 ("가수 - 『제목』"은 그대로)
  const quoted = [...s.matchAll(QUOTE)];
  if (quoted.length) {
    const pre = s.slice(0, quoted[0].index);
    const who = expand(tidy(denoise(pre.replace(BRACKET, ' '))), [...pre.matchAll(BRACKET)].filter((b) => b.index > 0).flatMap((b) => inner(b[1])));
    const flipped = /[/⧸|│]\s*$/.test(pre);
    const qs = quoted.map((m) => denoise(m[1].replace(BRACKET, ' ')).split(SPLIT).map(tidy).filter(Boolean));
    if (flipped) {
      addAll(titles, who);
      for (const [q0] of qs) add(artists, q0);
    }
    for (const [q0, ...rest] of qs) {
      add(titles, q0);
      addAll(artists, rest);
    }
    for (const m of quoted) for (const b of m[1].matchAll(BRACKET)) addAll(titles, inner(b[1]));
    if (!flipped) addAll(artists, who);
  }

  // 2. 나머지: 괄호는 자리 표시로 바꿔 두고(그 앞 말의 다른 이름) 구분자로 나눈다. 맨 앞 괄호는 업로더 꼬리표(【올린 사람】·[MV])라 뺀다
  const groups = [];
  const noQuote = s.replace(QUOTE, ' ');
  const marked = noQuote.replace(BRACKET, (m, raw, at) => {
    const lead = !QUOTE_START.test(s) && !noQuote.slice(0, at).replace(BRACKET, '').trim();
    return `\uE000${groups.push({ raw, lead }) - 1}\uE001`;
  });
  const core = denoise(marked);
  const parts = core
    .split(SPLIT)
    .map((p) => {
      const aliases = [...p.matchAll(MARK)].map(([, n]) => groups[Number(n)]).filter((g) => !g.lead).flatMap((g) => inner(g.raw));
      return { base: tidy(denoise(p.replace(MARK, ' '))), aliases };
    })
    .filter((p) => p.base || p.aliases.length);
  const dashed = /\s[-–—~_]\s/.test(core.replace(MARK, 'x'));
  if (parts.length === 2 && dashed) {
    // "가수 - 제목"이 흔하지만 거꾸로도 있어서 둘 다
    const [a, b] = parts.map((p) => expand(p.base, p.aliases));
    addAll(titles, [...b, ...a]);
    addAll(quoted.length ? maybe : artists, [...a, ...b]);
  } else if (parts.length) {
    const [head, ...rest] = parts;
    const tail = rest.flatMap((p) => expand(p.base, p.aliases));
    addAll(titles, expand(head.base, head.aliases));
    addAll(quoted.length ? maybe : artists, tail);
    addAll(titles, tail);
    // "제목 (원래 가수) cover". 한글 ↔ 원어 짝은 번역 제목이라 가수 후보가 아님
    addAll(maybe, head.aliases.filter((x) => hangulOnly(x) === hangulOnly(head.base)));
    if (parts.length === 1 && !quoted.length) {
      // 띄어 쓴 "가수 제목"(글자 종류가 바뀌는 곳) · 붙여 쓴 "제목가수"
      const bits = scriptSplit(head.base, true);
      addAll(titles, bits);
      addAll(maybe, bits);
    }
  }

  // 3. 곡의 가수 태그: 커버면 대개 부른 사람이라 뒤로, 아니면 맨 앞
  const tag = String(artist ?? '')
    .normalize('NFKC')
    .replace(/[『』「」]/g, '')
    .replace(/\s*-\s*topic$|\bvevo$|\b(?:official|channel|ch\.?)(?=$|\s)|公式|チャンネル|オフィシャル/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tagged = [];
  if (tag && !UNKNOWN_ARTIST.test(tag)) {
    tagged.push(tag);
    for (const p of tag.split(/\s*(?:[/,、&]|\s(?:feat\.?|ft\.?|x|×)\s)\s*/i)) tagged.push(p, ...scriptSplit(p));
  }
  const sure = [];
  addAll(sure, cover ? artists : [...tagged, ...artists]);
  const all = [...sure];
  addAll(all, [...maybe, ...(cover ? tagged : []), ...voices]);
  // 가수 이름만으로 찾아볼 후보: 커버한 사람·보컬로이드 이름은 빼고 (그 사람 곡이 너무 많거나 원곡이 아니라서)
  const byArtist = [];
  addAll(byArtist, [...sure, ...maybe].filter((a) => !onlyVoice(a)));
  return { titles: titles.slice(0, 8), artists: all.slice(0, 6), byArtist: byArtist.slice(0, 3), sure: sure.length > 0, cover, korean };
}

// ───── 찾은 결과 점수 매기기 ─────

function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) || 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    if (grams.get(g) > 0) {
      hit++;
      grams.set(g, grams.get(g) - 1);
    }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

// 소리 열쇠: phoneticKey는 한자를 그냥 빼서 夏のうた와 冬のうた가 같아진다 → 한자가 있으면 읽는 법(readingKey)을 알 때만
const soundKey = (s) => (HAN.test(s) ? '' : phoneticKey(s));

// 두 이름이 얼마나 같은지 0~1: 글자 그대로 → 소리(가나·한글·로마자, 한자는 읽는 법) → 한쪽이 다른 쪽에 들어 있음 → 비슷한 글자
export function nameSim(a, b, phon = soundKey) {
  const A = normKey(a);
  const B = normKey(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const pa = phon(a);
  const pb = phon(b);
  if (pa && pa === pb && pa.length >= 2) return 0.92;
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  if (s.length >= 2 && l.includes(s)) return 0.6 + 0.3 * (s.length / l.length);
  if (pa && pb && Math.min(pa.length, pb.length) >= 3) {
    const [ps, pl] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
    if (pl.includes(ps)) return 0.55 + 0.3 * (ps.length / pl.length);
  }
  return Math.max(dice(A, B), pa && pb ? dice(pa, pb) : 0) * 0.7;
}

// 길이가 비슷할수록 같은 녹음 (커버는 원곡과 몇 초씩 다를 수 있어서 조금 너그럽게)
function durScore(d, rd, cover) {
  if (!(d > 0) || !(rd > 0)) return 0.5;
  const x = Math.abs(d - rd);
  if (x <= 2) return 1;
  if (x <= 5) return 0.85;
  if (x <= 10) return cover ? 0.75 : 0.6;
  if (x <= 25) return cover ? 0.55 : 0.3;
  return cover ? 0.3 : 0.1;
}

const ARTIST_SPLIT = /\s*(?:,|&|、|×|\bx\b|\bfeat\.?|\bft\.?|\/|・)\s*/i;

// 찾은 결과의 제목도 꾸밈말을 떼어 본다: "제목 - Romaji [Cover] (feat. 누구)" → "제목", "Romaji"
function titleVariants(t) {
  const out = [String(t ?? '')];
  const bare = tidy(denoise(out[0].replace(BRACKET, ' ')));
  if (bare) out.push(bare, ...bare.split(SPLIT).map(tidy));
  return [...new Set(out.filter(Boolean))];
}

// 점수 0~1 = 제목·가수·길이가 얼마나 맞는지. 가수를 확실히 아는 곡(terms.sure)은 가수가 다르면 "잘 맞음"이 못 된다
function scoreParts(r, terms, duration, phon) {
  // 앞쪽 제목 후보를 조금 더 믿는다 ("가수 - 제목"에서는 오른쪽이 제목일 때가 많아서). 번역한 제목은 조금 덜
  const translated = new Set(terms.translated || []);
  const asTitle = [
    ...terms.titles.map((c, i) => [c, Math.min(1 - Math.min(0.09, i * 0.03), translated.has(c) ? 0.9 : 1)]),
    ...terms.artists.map((c) => [c, 0.8]),
  ];
  const variants = titleVariants(r.title);
  let ts = 0;
  let best = null;
  for (const [c, w] of asTitle) {
    for (const [i, v] of variants.entries()) {
      const x = nameSim(c, v, phon) * w * (i ? 0.97 : 1);
      if (x > ts) {
        ts = x;
        best = c;
      }
    }
  }
  const resultArtists = [r.artist, ...String(r.artist ?? '').split(ARTIST_SPLIT)].filter(Boolean);
  let as = 0;
  for (const [c, w] of [...terms.artists.map((c) => [c, 1]), ...terms.titles.map((c) => [c, 0.8])]) {
    if (c === best) continue; // 제목과 가수가 같은 후보로 맞으면 안 셈
    for (const ra of resultArtists) as = Math.max(as, nameSim(c, ra, phon) * w);
  }
  const ds = durScore(duration, r.duration, terms.cover);
  const [wt, wa, wd] = terms.sure ? [0.45, 0.3, 0.25] : [0.6, 0.15, 0.25];
  let s = wt * ts + wa * as + wd * ds;
  if (ts < 0.5) s *= 0.6;
  if (r.synced) s += 0.02;
  if (r.instrumental) s *= 0.4;
  return { score: Math.max(0, Math.min(1, s)), ts };
}

export function scoreResult(r, terms, duration, phon = soundKey) {
  return scoreParts(r, terms, duration, phon).score;
}

// ───── LRCLIB에서 찾기 ─────
// 제목 후보·가수 후보로 여러 번 동시에 찾는다(4개씩). 1차로 가장 그럴듯한 제목·가수, 2차로 다른 후보(원제·거꾸로 된
// "가수 - 제목"·둘째 가수), 3차로 남은 조각과 가수 이름만으로(그 가수 곡 중에서 제목 비교). 잘 맞는 게 나오면 거기서 끝.
// title·artist를 주면(가사 찾기 창에서 고친 말) 그 말로
const searchCache = new Map(); // 같은 검색은 10분 동안 다시 묻지 않음
const SURE_ENOUGH = 0.85;

async function lrclib(kind, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  const url = `https://lrclib.net/api/${kind}?${qs}`;
  const hit = searchCache.get(url);
  if (hit && Date.now() - hit.at < 600_000) return hit.data;
  const data = await getJson(url);
  searchCache.set(url, { at: Date.now(), data });
  if (searchCache.size > 400) searchCache.delete(searchCache.keys().next().value);
  return data;
}

async function inPool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function searchPlan(terms, { query, qTitle, qArtist, dur }) {
  if (query) return [[['search', { q: query }]]];
  const exact = (t, a) => [['search', { track_name: t, artist_name: a }], ['search', { q: `${t} ${a}` }], ...(dur ? [['get', { track_name: t, artist_name: a, duration: dur }]] : [])];
  if (qTitle) return [[['search', { q: qTitle }], ...(qArtist ? exact(qTitle, qArtist) : [])], qArtist ? [['search', { q: qArtist }]] : []];
  // 앨범 이름은 안 넣는다: 유튜브 곡은 앨범 태그가 엉뚱해서 넣으면 정확히 찾기가 오히려 실패
  const [t0, t1, t2, ...more] = terms.titles;
  const [a0, a1] = terms.artists;
  const pair = (t, a) => t && a && normKey(t) !== normKey(a);
  const first = [...(t0 ? [['search', { q: t0 }]] : []), ...(pair(t0, a0) ? exact(t0, a0) : [])];
  const second = [t1, t2].filter(Boolean).map((t) => ['search', { q: t }]);
  for (const [t, a] of [[t0, a1], [t1, a0], [t1, a1]]) if (pair(t, a)) second.push(['search', { track_name: t, artist_name: a }]);
  const third = [...more.slice(0, 3).map((t) => ['search', { q: t }]), ...(terms.byArtist || []).map((a) => ['search', { q: a }])];
  return [first, second, third];
}

// 제목이 한국어뿐이면(번역 제목만 단 한국어 커버) LRCLIB의 원제와 안 맞는다 → 일본어로 번역한 제목도 후보로.
// translate는 가사 자동 번역과 같은 구글 번역 (설정에서 자동 번역을 끄면 안 씀)
async function withTranslated(terms, translate) {
  const ko = terms.titles.filter(hangulOnly).slice(0, 2);
  if (!ko.length || terms.titles.some((t) => !hangulOnly(t))) return terms;
  let lines = [];
  try {
    lines = (await translate(ko))?.lines || [];
  } catch {
    return { ...terms, translateFailed: true }; // 번역이 안 돼도 찾기는 계속 (창에 알려 줌)
  }
  const translated = ko.map((k, i) => tidy(lines[i])).filter((x, i) => x && NOT_HANGUL.test(x) && normKey(x) !== normKey(ko[i]));
  if (!translated.length) return terms;
  // "한국어 커버"라고 적힌 곡은 원제(번역)부터, 아니면 한국어 제목과 번갈아
  const [a, b] = terms.korean ? [translated, terms.titles] : [terms.titles, translated];
  const titles = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const x of [a[i], b[i]]) if (x && !titles.some((t) => normKey(t) === normKey(x))) titles.push(x);
  }
  return { ...terms, titles, translated };
}

export async function findLyrics({ title, artist, duration, query, qTitle, qArtist, translate } = {}) {
  const auto = lyricTerms(title, artist);
  let terms = qTitle || qArtist
    ? { ...auto, titles: [qTitle, ...auto.titles].filter(Boolean), artists: [qArtist, ...auto.artists].filter(Boolean), sure: !!qArtist }
    : auto;
  const d = Number(duration) || 0;
  const started = Date.now();
  const found = new Map();
  const keys = new Map(); // 이름 → 소리 열쇠 (한자는 kuromoji 읽는 법, 필요할 때만 불러옴)
  let asked = 0;
  let failed = 0;
  let results = [];
  const rank = async () => {
    const list = [...found.values()].filter((r) => r.lyrics || r.instrumental);
    for (const s of new Set([...terms.titles, ...terms.artists, ...list.flatMap((r) => [...titleVariants(r.title), r.artist])].filter(Boolean))) {
      if (!keys.has(s)) keys.set(s, HAN.test(s) ? await readingKey(s) : phoneticKey(s));
    }
    const phon = (s) => keys.get(s) ?? soundKey(s);
    const titleFit = new Map();
    for (const r of list) {
      const p = scoreParts(r, terms, d, phon);
      r.score = Math.round(p.score * 100) / 100;
      r.durDiff = d && r.duration ? Math.round(r.duration - d) : null;
      titleFit.set(r, p.ts);
    }
    // 가수를 모르는데 같은 제목을 여러 가수가 불렀으면 어느 곡인지 확신할 수 없다 → "잘 맞음"은 안 줌
    if (!terms.sure) {
      const same = list.filter((r) => titleFit.get(r) >= 0.9);
      const who = (a) => {
        const main = String(a ?? '').split(ARTIST_SPLIT)[0].trim();
        return keys.get(main) || soundKey(main) || normKey(main);
      };
      if (new Set(same.map((r) => who(r.artist))).size > 1) for (const r of same) r.score = Math.min(r.score, 0.79);
    }
    list.sort((x, y) => y.score - x.score);
    // LRCLIB에는 같은 곡이 여러 번 올라와 있다 → 제목·가수·길이(1초 안)·시간 맞춤이 같으면 하나만
    const out = [];
    for (const r of list) {
      const dup = (x) => x.synced === r.synced && Math.abs(x.duration - r.duration) <= 1 && normKey(x.title) === normKey(r.title) && normKey(x.artist) === normKey(r.artist);
      if (!out.some(dup)) out.push(r);
      if (out.length >= 15) break;
    }
    return out;
  };
  const opts = { query, qTitle, qArtist, dur: Math.round(d) };
  const seen = new Set(); // 차례마다 같은 검색이 겹치면 한 번만
  let plan = searchPlan(terms, opts);
  let mayTranslate = !!translate && !query && !qTitle;
  for (let w = 0; w < plan.length; w++) {
    const jobs = plan[w].filter(([kind, params]) => {
      const k = `${kind} ${JSON.stringify(params)}`;
      return !seen.has(k) && seen.add(k);
    });
    if (jobs.length) {
      asked += jobs.length;
      await inPool(jobs, 4, async ([kind, params]) => {
        let data;
        try {
          data = await lrclib(kind, params);
        } catch {
          failed++;
          return;
        }
        for (const x of Array.isArray(data) ? data : data ? [data] : []) if (x?.id && !found.has(x.id)) found.set(x.id, pick(x));
      });
      results = await rank();
      // 잘 맞는 게 나왔거나, 서버가 느린데(바쁠 때 다시 묻느라) 쓸 만한 게 이미 있으면 다음 차례는 건너뜀
      if (results[0]?.score >= SURE_ENOUGH || (results[0]?.score >= 0.65 && Date.now() - started > 5000)) break;
    }
    // 1차에서 잘 맞는 게 없을 때만 한국어 제목을 번역해 본다 (구글에 묻는 일을 줄이려고). 번역 제목이 생기면 처음부터 다시 짠다(한 번 한 검색은 건너뜀)
    if (mayTranslate) {
      mayTranslate = false;
      const next = await withTranslated(terms, translate);
      if (next !== terms) {
        terms = next;
        plan = searchPlan(terms, opts);
        w = -1;
      }
    }
  }
  if (asked && failed === asked) throw new Error('가사 서버에 연결하지 못했어요');
  return { results, terms: { titles: terms.titles, artists: terms.artists, sure: terms.sure, cover: terms.cover, korean: terms.korean, translated: terms.translated || [], translateFailed: !!terms.translateFailed } };
}

// .lrc 저장: 곡 파일 옆에. 있던 .lrc는 데이터 폴더에 백업해 둔다
export async function saveLrc(dataDir, track, text) {
  const file = lrcPathFor(track.path);
  try {
    const old = await fsp.readFile(file, 'utf8');
    if (old.trim() === String(text).trim()) return file;
    const dir = path.join(dataDir, 'lyrics-backup');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${track.id}-${Date.now()}.lrc`), old);
  } catch {
    // 처음 만드는 가사
  }
  await fsp.writeFile(file, String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
  return file;
}

const hangulRatio = (s) => {
  const letters = String(s).replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return 1;
  return (letters.match(/[가-힣]/g) || []).length / letters.length;
};

// 자동 번역 (Google 번역 무료 주소). 한 번 번역한 가사는 저장해 두고 다시 쓴다
export class Translator {
  constructor(dataDir) {
    this.cache = new JsonStore(path.join(dataDir, 'lyrics-translations.json'), { items: {} });
  }

  async translate(lines, target = 'ko') {
    const text = lines.join('\n');
    if (!text.trim()) return { lang: null, lines: lines.map(() => '') };
    if (target === 'ko' && hangulRatio(text) > 0.5) return { lang: 'ko', lines: lines.map(() => ''), same: true };
    const key = crypto.createHash('sha1').update(`${target}\n${text}`).digest('hex');
    const hit = this.cache.data.items[key];
    if (hit) return hit;
    // 줄 수가 많으면 나눠서 (주소 길이 제한)
    const out = [];
    let lang = null;
    let chunk = [];
    const flush = async () => {
      if (!chunk.length) return;
      const r = await googleTranslate(chunk.join('\n'), target);
      lang ||= r.lang;
      const parts = r.text.split('\n');
      if (parts.length === chunk.length) out.push(...parts);
      else for (const line of chunk) out.push(line.trim() ? (await googleTranslate(line, target)).text : '');
      chunk = [];
    };
    for (const line of lines) {
      if (chunk.join('\n').length + line.length > 1500) await flush();
      chunk.push(line);
    }
    await flush();
    const result = { lang, lines: out.map((s) => s.trim()) };
    this.cache.data.items[key] = result;
    const keys = Object.keys(this.cache.data.items);
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete this.cache.data.items[k];
    this.cache.save(1000);
    return result;
  }

  flush() {
    this.cache.flush();
  }
}

// 구글이 "요청이 너무 많다"(429, 자동 접근 확인 페이지)고 하면 30분 동안은 묻지 않는다 (더 막히지 않게)
let translateBlockedUntil = 0;
export class TranslateBlocked extends Error {}

async function googleTranslate(text, target) {
  if (Date.now() < translateBlockedUntil) throw new TranslateBlocked('구글 번역이 요청이 많다고 잠시 막았어요. 30분쯤 뒤에 다시 돼요');
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: `q=${encodeURIComponent(text)}`,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) {
    res.body?.cancel().catch(() => {});
    translateBlockedUntil = Date.now() + 30 * 60_000;
    throw new TranslateBlocked('구글 번역이 요청이 많다고 잠시 막았어요. 30분쯤 뒤에 다시 돼요');
  }
  if (!res.ok) throw new Error(`번역 서버 응답 ${res.status}`);
  const j = await res.json();
  return { text: (j?.[0] || []).map((seg) => seg?.[0] ?? '').join(''), lang: j?.[2] || null };
}

// 가사로 곡 찾기: 가사가 있는 곡의 가사를 한 번 읽어 두고, 바뀐 곡만 다시 읽는다
export class LyricsIndex {
  constructor(library) {
    this.library = library;
    this.items = new Map(); // id → { text, mtime }
    this.building = null;
  }

  async refresh() {
    this.building ||= (async () => {
      const list = this.library.list().filter((t) => t.hasLyrics);
      const keep = new Set(list.map((t) => t.id));
      for (const id of this.items.keys()) if (!keep.has(id)) this.items.delete(id);
      for (const t of list) {
        const cur = this.items.get(t.id);
        let lrcTime = 0;
        try {
          lrcTime = (await fsp.stat(lrcPathFor(t.path))).mtimeMs;
        } catch {
          // .lrc 없음 (태그 가사)
        }
        if (cur && cur.mtime === t.mtime && cur.lrcTime === lrcTime) continue;
        const ly = await readLyrics(t.path).catch(() => null);
        this.items.set(t.id, { text: norm(ly?.text || ''), raw: ly?.text || '', mtime: t.mtime, lrcTime });
      }
    })().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  async search(q, limit = 50) {
    await this.refresh();
    const nq = norm(q);
    if (nq.length < 2) return [];
    const out = [];
    for (const [id, it] of this.items) {
      const i = it.text.indexOf(nq);
      if (i < 0) continue;
      const line = it.raw.split(/\r?\n/).find((l) => norm(l).includes(nq)) || '';
      out.push({ id, snippet: line.trim().slice(0, 120) });
      if (out.length >= limit) break;
    }
    return out;
  }
}

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
