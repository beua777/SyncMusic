// 발음으로 찾기: 가나·한글을 로마자로 바꾸고, 같은 소리가 같은 글자가 되게 다듬은 '소리 열쇠'를 만든다.
//   ヨルシカ → yorushika → yorusika,  요루시카 → yorusika  (그래서 서로 찾아진다)
// 한자는 서버가 kuromoji로 읽는 법(가나)을 구해서 같은 열쇠로 만든다. 화면과 서버가 같이 쓴다.

const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu', ゎ: 'wa',
}; // prettier-ignore
const SMALL_VOWEL = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
const SMALL_Y = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' };

// 가타카나 → 히라가나 (ァ~ヶ는 히라가나보다 0x60 뒤)
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function kanaToRomaji(input) {
  const s = toHiragana(String(input ?? ''));
  let out = '';
  let geminate = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'っ') {
      geminate = true;
      continue;
    }
    if (c === 'ー') continue; // 장음은 소리 열쇠에서 어차피 줄인다
    let r = KANA[c];
    if (r === undefined) {
      if (SMALL_VOWEL[c]) r = SMALL_VOWEL[c];
      else if (SMALL_Y[c]) r = SMALL_Y[c];
      else {
        out += c;
        geminate = false;
        continue;
      }
    }
    const nx = s[i + 1];
    if (nx && SMALL_Y[nx] && /i$/.test(r) && r.length > 1) {
      // きゃ → kya, しゃ → sha, ちゃ → cha, じゃ → ja
      const base = r.slice(0, -1);
      r = /^(sh|ch|j)$/.test(base) ? base + SMALL_Y[nx].slice(1) : base + SMALL_Y[nx];
      i++;
    } else if (nx && SMALL_VOWEL[nx] && r.length > 1) {
      // ファ → fa, ティ → ti, チェ → che (앞 글자의 모음을 작은 모음으로)
      r = r.slice(0, -1) + SMALL_VOWEL[nx];
      i++;
    }
    if (geminate) {
      out += r[0] === 'c' ? 't' : r[0];
      geminate = false;
    }
    out += r;
  }
  return out;
}

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// 받침: ㅅ·ㅆ은 일본어 촉음(っ)을 적을 때 쓰여서 소리 열쇠에서는 비운다
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', '', '', 'ng', 't', 't', 'k', 't', 'p', 't'];

export function hangulToRomaji(input) {
  let out = '';
  for (const ch of String(input ?? '')) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c >= 11172) {
      out += ch;
      continue;
    }
    out += INITIAL[Math.floor(c / 588)] + MEDIAL[Math.floor((c % 588) / 28)] + FINAL[c % 28];
  }
  return out;
}

// 소리 열쇠: 로마자로 바꾼 뒤, 언어마다 다르게 적는 같은 소리를 하나로
export function phoneticKey(input) {
  let s = hangulToRomaji(kanaToRomaji(String(input ?? '').normalize('NFKC').toLowerCase()));
  s = s
    .replace(/eu/g, 'u') // 한글 ㅡ (츠 → cheu → chu)
    .replace(/eo/g, 'o') // ㅓ
    .replace(/ae|oe/g, 'e')
    .replace(/ng/g, 'n')
    .replace(/tsu|ssu/g, 'tu') // つ: 츠·쓰
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti')
    .replace(/sh/g, 's')
    .replace(/ch/g, 't')
    .replace(/j/g, 'z')
    .replace(/f(?=u)/g, 'h') // ふ는 한글로 후
    .replace(/f/g, 'p') // ファ는 한글로 파
    .replace(/v/g, 'b')
    .replace(/l/g, 'r')
    .replace(/[^a-z0-9]/g, '')
    .replace(/([tsz])y(?=[aeiou])/g, '$1') // 챠·샤·쟈 (일본어 ちゃ·しゃ·じゃ를 적은 것)
    .replace(/([a-z])\1+/g, '$1') // 겹친 글자 (kk, ss, oo, uu)
    .replace(/ou/g, 'o')
    .replace(/ei/g, 'e');
  return s;
}

// 글자 종류: 일본어(가나·한자) · 한국어 · 라틴 문자가 들어 있는지
export function scripts(text) {
  const s = String(text ?? '');
  return {
    kana: /[぀-ヿ]/.test(s),
    kanji: /[一-鿿]/.test(s),
    hangul: /[가-힣ㄱ-ㆎ]/.test(s),
    latin: /[a-z]/i.test(s),
  };
}
