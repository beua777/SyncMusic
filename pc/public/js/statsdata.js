// 통계 화면의 막대그래프 자료 (화면에 의존하지 않아서 테스트에서도 쓴다)
// 날짜는 이 PC의 지역 시간 'YYYY-MM-DD' (서버 stats.js의 dayKey와 같은 모양)

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ['월', '화', '수', '목', '금', '토', '일'];

// → [{ label, title, v, future }]
// week: 월~일 7일 · month: 그달 1일~말일 (들은 기록이 없는 날은 0, 아직 안 온 날은 future) · year: 1~12월 · all: 달마다 (최근 24달)
export function series(kind, byDay, from, to) {
  const by = new Map(byDay.map((x) => [x.date, x.minutes]));
  const out = [];
  if (kind === 'week' || kind === 'month') {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    const now = new Date(to);
    const end = kind === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6) : new Date(d.getFullYear(), d.getMonth() + 1, 0);
    while (d <= end) {
      const label = kind === 'week' ? DOW[(d.getDay() + 6) % 7] : d.getDate() === 1 || d.getDate() % 5 === 0 ? String(d.getDate()) : '';
      out.push({ label, title: `${d.getMonth() + 1}월 ${d.getDate()}일`, v: by.get(dayKey(d)) || 0, future: d > now });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  const months = new Map();
  for (const x of byDay) months.set(x.date.slice(0, 7), (months.get(x.date.slice(0, 7)) || 0) + x.minutes);
  const end = new Date(to);
  let d;
  if (kind === 'year') d = new Date(end.getFullYear(), 0, 1);
  else {
    const first = byDay.length ? new Date(`${byDay[0].date.slice(0, 7)}-01T00:00:00`) : new Date(end.getFullYear(), end.getMonth(), 1);
    const cut = new Date(end.getFullYear(), end.getMonth() - 23, 1);
    d = first < cut ? cut : first;
  }
  const many = kind === 'all' && (end.getFullYear() - d.getFullYear()) * 12 + end.getMonth() - d.getMonth() > 12;
  while (d <= end) {
    const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const label = many && d.getMonth() % 3 !== 0 ? '' : `${d.getMonth() + 1}월`;
    out.push({ label, title: `${d.getFullYear()}년 ${d.getMonth() + 1}월`, v: months.get(k) || 0, future: false });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  if (kind === 'year') {
    // 올해 남은 달도 빈칸으로 (12달을 다 보여 준다)
    for (let m = end.getMonth() + 1; m < 12; m++) out.push({ label: `${m + 1}월`, title: `${end.getFullYear()}년 ${m + 1}월`, v: 0, future: true });
  }
  return out;
}

// 들은 시간이 가장 많은 시간대 → '밤 10시'
export function peakHour(byHour) {
  const max = Math.max(...byHour);
  if (!(max > 0)) return null;
  const h = byHour.indexOf(max);
  const part = h < 5 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : '밤';
  return `${part} ${h % 12 || 12}시`;
}

export function fmtMinutes(m) {
  const n = Math.max(0, Math.round(m || 0));
  if (n < 60) return `${n}분`;
  const h = Math.floor(n / 60);
  return n % 60 ? `${h}시간 ${n % 60}분` : `${h}시간`;
}
