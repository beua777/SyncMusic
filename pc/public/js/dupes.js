// 재생목록 안의 중복 곡 찾기 (화면에 의존하지 않아서 테스트에서도 쓴다)
// 같은 곡(ID)이 또 나옴 + (similar) 제목·가수가 같고 길이가 3초 안쪽인 다른 파일. 처음 나온 것을 남긴다.
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

// → [{ index, id, of: 남기는 쪽 index, kind: 'same' | 'similar' }]
export function playlistDuplicates(entries, getTrack, { similar = true } = {}) {
  const firstById = new Map();
  const byMeta = new Map(); // 제목|가수 → [{ index, duration }]
  const out = [];
  entries.forEach((id, index) => {
    if (firstById.has(id)) {
      out.push({ index, id, of: firstById.get(id), kind: 'same' });
      return;
    }
    firstById.set(id, index);
    if (!similar) return;
    const t = getTrack(id);
    if (!t || !norm(t.title)) return;
    const key = `${norm(t.title)}|${norm(t.artist)}`;
    const list = byMeta.get(key) || [];
    const hit = list.find((x) => Math.abs(x.duration - (t.duration || 0)) <= 3);
    if (hit) out.push({ index, id, of: hit.index, kind: 'similar' });
    else {
      list.push({ index, duration: t.duration || 0 });
      byMeta.set(key, list);
    }
  });
  return out;
}

export function withoutDuplicates(entries, dups) {
  const drop = new Set(dups.map((d) => d.index));
  return entries.filter((_, i) => !drop.has(i));
}
