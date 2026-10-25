// 재생목록 3-way 병합. 곡 순서를 최대한 지키는 것이 목표다.
//   base  : 양쪽이 마지막으로 같았던 내용 (없으면 null)
//   pc    : PC의 지금 내용
//   phone : 폰(삼성 뮤직)의 지금 내용
// 규칙 (docs/PLAN.md 6.6)
//   1. 한쪽만 바뀌었으면 바뀐 쪽을 그대로 쓴다
//   2. 둘 다 바뀌었으면 최근에 바뀐 쪽(prefer)의 순서를 그대로 쓰고
//   3. 반대쪽에서 지운 곡은 빼고
//   4. 반대쪽에서 새로 넣은 곡은, 반대쪽 목록에서 그 곡 바로 뒤에 있던 곡 앞에 끼운다 (뒤가 없으면 맨 끝)
//   5. 같은 곡이 여러 번 들어 있으면 "id#몇번째"로 구분한다

export const sameList = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

export function tokenize(list) {
  const seen = new Map();
  return list.map((id) => {
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    return `${id}#${n}`;
  });
}

const untoken = (t) => t.slice(0, t.lastIndexOf('#'));

export function merge3(base, pc, phone, { prefer = 'phone' } = {}) {
  const b = base || [];
  if (sameList(pc, phone)) return pc.slice();
  if (base && sameList(b, pc)) return phone.slice();
  if (base && sameList(b, phone)) return pc.slice();

  const [primary, secondary] = prefer === 'pc' ? [pc, phone] : [phone, pc];
  const B = new Set(tokenize(b));
  const S = tokenize(secondary);
  const inSecondary = new Set(S);

  // 반대쪽에서 지운 곡(기준점엔 있었는데 반대쪽엔 없음)을 뺀다
  const result = tokenize(primary).filter((t) => !(B.has(t) && !inSecondary.has(t)));
  const inResult = new Set(result);

  // 반대쪽에서 새로 넣은 곡을 끼운다
  for (let i = 0; i < S.length; i++) {
    const t = S[i];
    if (B.has(t) || inResult.has(t)) continue;
    let at = result.length;
    for (let j = i + 1; j < S.length; j++) {
      const k = result.indexOf(S[j]);
      if (k !== -1) {
        at = k;
        break;
      }
    }
    result.splice(at, 0, t);
    inResult.add(t);
  }
  return result.map(untoken);
}
