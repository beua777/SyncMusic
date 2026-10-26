// 일본어 한자·가나의 읽는 법 → 소리 열쇠(phonetic.js) — "요루니 카케루"나 "yoru ni kakeru"로 夜に駆ける를 찾게.
// kuromoji 사전은 메모리를 많이 써서(약 90MB) 필요할 때만 불러오고, 1분 동안 안 쓰면 놓아 준다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kuromoji from 'kuromoji';
import { phoneticKey } from '../public/js/phonetic.js';

const DICT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'kuromoji', 'dict');
const JAPANESE = /[぀-ヿ一-鿿]/;
let tokenizer = null;
let loading = null;
let idle = null;

function getTokenizer() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    tokenizer = null;
  }, 60_000);
  idle.unref?.();
  if (tokenizer) return Promise.resolve(tokenizer);
  loading ||= new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DICT }).build((err, tk) => {
      loading = null;
      if (err) return reject(err);
      tokenizer = tk;
      resolve(tk);
    });
  });
  return loading;
}

// 일본어가 없으면 빈 글자 (사전을 불러오지 않음)
export async function readingKey(text) {
  const s = String(text ?? '');
  if (!JAPANESE.test(s)) return '';
  try {
    const tk = await getTokenizer();
    return phoneticKey(tk.tokenize(s).map((t) => (t.reading && t.reading !== '*' ? t.reading : t.surface_form)).join(''));
  } catch {
    return '';
  }
}
