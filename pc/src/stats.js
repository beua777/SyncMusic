// 들은 기록으로 만드는 통계 (화면에 의존하지 않는 계산만 — 테스트에서 씀)
// 기록 한 줄: { id, s: 시작(ms), l: 들은 초, c: 끝까지 1/0, k: 넘김 1/0, t: 제목, a: 가수, al: 앨범, g: 장르, d: 곡 길이 }
// 시간대·요일·날짜는 이 PC의 지역 시간으로 센다.

export const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// 한 주는 월요일부터
export function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}
export const startOfMonth = (ms) => new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), 1).getTime();
export const startOfYear = (y) => new Date(y, 0, 1).getTime();

// 30초 넘게 들었거나 끝까지 들었으면 '한 번 들음'
const isPlay = (e) => e.c || e.l >= 30;

function tally(events, keyOf, labelOf) {
  const m = new Map();
  for (const e of events) {
    const k = keyOf(e);
    if (!k) continue;
    let x = m.get(k);
    if (!x) m.set(k, (x = { ...labelOf(e), plays: 0, secs: 0 }));
    x.secs += e.l;
    if (isPlay(e)) x.plays++;
  }
  return [...m.values()].sort((a, b) => b.plays - a.plays || b.secs - a.secs);
}

// 기간 하나의 요약: 들은 시간, 많이 들은 곡·가수·앨범, 요일×시간대, 날짜별
export function summarize(events) {
  const secs = events.reduce((s, e) => s + e.l, 0);
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)); // [월~일][0~23시] 초
  const byDay = new Map();
  for (const e of events) {
    const d = new Date(e.s);
    heat[(d.getDay() + 6) % 7][d.getHours()] += e.l;
    const k = dayKey(e.s);
    byDay.set(k, (byDay.get(k) || 0) + e.l);
  }
  const artists = tally(events, (e) => e.a, (e) => ({ artist: e.a }));
  return {
    minutes: Math.round(secs / 60),
    plays: events.filter(isPlay).length,
    skips: events.filter((e) => e.k).length,
    completed: events.filter((e) => e.c).length,
    uniqueTracks: new Set(events.map((e) => e.id)).size,
    uniqueArtists: artists.length,
    activeDays: byDay.size,
    topTracks: tally(events, (e) => e.id, (e) => ({ id: e.id, title: e.t, artist: e.a })).slice(0, 20),
    topArtists: artists.slice(0, 20).map((x) => ({ ...x, share: secs ? x.secs / secs : 0 })),
    topAlbums: tally(events, (e) => (e.al ? `${e.al}\u0001${e.a}` : null), (e) => ({ album: e.al, artist: e.a })).slice(0, 10),
    heat: heat.map((row) => row.map((s) => Math.round(s / 60))),
    byHour: heat.reduce((acc, row) => acc.map((v, h) => v + row[h]), new Array(24).fill(0)).map((s) => Math.round(s / 60)),
    byDay: [...byDay.entries()].sort().map(([date, s]) => ({ date, minutes: Math.round(s / 60) })),
  };
}

// 이번 주·이번 달·올해와 그 앞 기간 비교
export function report(events, kind, now = Date.now()) {
  let from;
  let prevFrom;
  if (kind === 'week') {
    from = startOfWeek(now);
    prevFrom = from - 7 * DAY;
  } else if (kind === 'month') {
    from = startOfMonth(now);
    const d = new Date(from);
    prevFrom = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  } else if (kind === 'year') {
    from = startOfYear(new Date(now).getFullYear());
    prevFrom = startOfYear(new Date(now).getFullYear() - 1);
  } else {
    from = 0;
    prevFrom = null;
  }
  const cur = summarize(events.filter((e) => e.s >= from && e.s <= now));
  const prev = prevFrom === null ? null : summarize(events.filter((e) => e.s >= prevFrom && e.s < from));
  return { kind, from, to: now, ...cur, prev: prev && { minutes: prev.minutes, plays: prev.plays, uniqueTracks: prev.uniqueTracks } };
}

// 오랫동안 듣지 않은 곡: 예전에 자주 들었는데 days일 넘게 안 들음 · 한 번도 안 들은 곡
export function forgotten(tracks, now = Date.now(), days = 90) {
  const cut = now - days * DAY;
  const old = tracks
    .filter((t) => (t.playCount || 0) > 0 && (t.lastPlayed || 0) < cut)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0) || (a.lastPlayed || 0) - (b.lastPlayed || 0))
    .slice(0, 100)
    .map((t) => ({ id: t.id, title: t.title, artist: t.artist, playCount: t.playCount, lastPlayed: t.lastPlayed }));
  const never = tracks.filter((t) => !(t.playCount > 0) && (t.addedAt || now) < now - 30 * DAY);
  return { days, old, neverCount: never.length, never: never.slice(0, 100).map((t) => ({ id: t.id, title: t.title, artist: t.artist, addedAt: t.addedAt })) };
}

// 최근 추가한 음악: 주마다 추가한 곡 수(12주), 최근 30일에 추가해서 들어 본 비율, 많이 추가한 가수
export function recentlyAdded(tracks, now = Date.now()) {
  const thisWeek = startOfWeek(now);
  const weeks = Array.from({ length: 12 }, (_, i) => ({ from: thisWeek - (11 - i) * 7 * DAY, count: 0 }));
  for (const t of tracks) {
    const w = weeks.findLast((x) => (t.addedAt || 0) >= x.from);
    if (w) w.count++;
  }
  const recent = tracks.filter((t) => (t.addedAt || 0) >= now - 30 * DAY);
  const byArtist = new Map();
  for (const t of recent) byArtist.set(t.artist, (byArtist.get(t.artist) || 0) + 1);
  return {
    weeks: weeks.map((w) => ({ week: dayKey(w.from), count: w.count })),
    last30: recent.length,
    last30Played: recent.filter((t) => t.playCount > 0).length,
    topArtists: [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([artist, count]) => ({ artist, count })),
    newest: [...recent].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 20).map((t) => ({ id: t.id, title: t.title, artist: t.artist, addedAt: t.addedAt })),
  };
}

// 취향 점수: 최근에 들은 시간일수록 크게(60일마다 약 1/e) + 즐겨찾기
function affinity(events, tracks, favorites, now) {
  const artist = new Map();
  const genre = new Map();
  for (const e of events) {
    const w = (e.l / 60) * Math.exp(-(now - e.s) / (60 * DAY));
    if (e.a) artist.set(e.a, (artist.get(e.a) || 0) + w);
    if (e.g) genre.set(e.g, (genre.get(e.g) || 0) + w);
  }
  for (const t of tracks) {
    if (!favorites.has(t.id)) continue;
    artist.set(t.artist, (artist.get(t.artist) || 0) + 5);
    if (t.genre) genre.set(t.genre, (genre.get(t.genre) || 0) + 2);
  }
  return { artist, genre };
}

// 취향 기반 추천: 좋아하는 가수·장르인데 아직 거의 안 들은 곡 (한 가수당 3곡까지)
export function recommend(tracks, events, favorites = new Set(), now = Date.now(), limit = 30) {
  const { artist, genre } = affinity(events, tracks, favorites, now);
  const max = Math.max(1, ...artist.values());
  const scored = [];
  for (const t of tracks) {
    if ((t.playCount || 0) > 1 || favorites.has(t.id)) continue;
    if (t.lastPlayed && now - t.lastPlayed < 3 * DAY) continue;
    const a = (artist.get(t.artist) || 0) / max;
    const g = (genre.get(t.genre) || 0) / max;
    if (a + g <= 0) continue;
    const score = a + g * 0.5 + (t.playCount ? 0 : 0.15);
    scored.push({ t, score, reason: a >= g ? `자주 듣는 ${t.artist}의 곡` : `즐겨 듣는 ${t.genre} 장르` });
  }
  scored.sort((x, y) => y.score - x.score);
  const per = new Map();
  const out = [];
  for (const s of scored) {
    const n = per.get(s.t.artist) || 0;
    if (n >= 3) continue;
    per.set(s.t.artist, n + 1);
    out.push({ id: s.t.id, title: s.t.title, artist: s.t.artist, reason: s.reason, played: s.t.playCount || 0 });
    if (out.length >= limit) break;
  }
  return out;
}

// 취향 변화: 최근 30일과 그 앞 90일의 가수·장르 비율 비교
export function tasteShift(events, now = Date.now()) {
  const recent = events.filter((e) => e.s >= now - 30 * DAY);
  const before = events.filter((e) => e.s >= now - 120 * DAY && e.s < now - 30 * DAY);
  const share = (list, key) => {
    const total = list.reduce((s, e) => s + e.l, 0) || 1;
    const m = new Map();
    for (const e of list) if (e[key]) m.set(e[key], (m.get(e[key]) || 0) + e.l / total);
    return m;
  };
  const diff = (key) => {
    const a = share(recent, key);
    const b = share(before, key);
    const keys = new Set([...a.keys(), ...b.keys()]);
    const rows = [...keys].map((k) => ({ name: k, now: a.get(k) || 0, before: b.get(k) || 0, delta: (a.get(k) || 0) - (b.get(k) || 0) }));
    return {
      rising: rows.filter((r) => r.delta > 0.01).sort((x, y) => y.delta - x.delta).slice(0, 5),
      falling: rows.filter((r) => r.delta < -0.01).sort((x, y) => x.delta - y.delta).slice(0, 5),
    };
  };
  const earlier = new Set(events.filter((e) => e.s < now - 30 * DAY).map((e) => e.a));
  const discovered = [...new Set(recent.map((e) => e.a))].filter((a) => a && !earlier.has(a));
  return { enough: recent.length >= 5 && before.length >= 5, artists: diff('a'), genres: diff('g'), discovered: discovered.slice(0, 10) };
}

// 청취 목표: 오늘 들은 분 / 하루 목표, 이번 주 처음 들은 곡 수 / 주간 목표, 목표를 채운 날이 이어진 날 수
export function goalProgress(events, goals = {}, now = Date.now()) {
  const today = startOfDay(now);
  const todayMin = Math.round(events.filter((e) => e.s >= today).reduce((s, e) => s + e.l, 0) / 60);
  const first = new Map();
  for (const e of events) if (!first.has(e.id) || e.s < first.get(e.id)) first.set(e.id, e.s);
  const week = startOfWeek(now);
  const weekNew = [...first.values()].filter((s) => s >= week).length;
  let streak = 0;
  if (goals.dailyMinutes > 0) {
    const mins = new Map();
    for (const e of events) mins.set(dayKey(e.s), (mins.get(dayKey(e.s)) || 0) + e.l / 60);
    // 오늘 아직 못 채웠으면 어제부터 센다
    let d = (mins.get(dayKey(today)) || 0) >= goals.dailyMinutes ? today : today - DAY;
    while ((mins.get(dayKey(d)) || 0) >= goals.dailyMinutes) {
      streak++;
      d = new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate() - 1).getTime();
    }
  }
  return { dailyMinutes: goals.dailyMinutes || 0, todayMinutes: todayMin, weeklyNew: goals.weeklyNew || 0, weekNew, streak };
}

// 연말 결산 (Wrapped)
export function wrapped(events, year) {
  const from = startOfYear(year);
  const to = startOfYear(year + 1);
  const ev = events.filter((e) => e.s >= from && e.s < to).sort((a, b) => a.s - b.s);
  const s = summarize(ev);
  const monthly = new Array(12).fill(0);
  for (const e of ev) monthly[new Date(e.s).getMonth()] += e.l;
  const topMonth = monthly.indexOf(Math.max(...monthly));
  const topDay = [...s.byDay].sort((a, b) => b.minutes - a.minutes)[0] || null;
  const topHour = s.byHour.indexOf(Math.max(...s.byHour));
  // 하루도 안 빼고 들은 가장 긴 기간
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const { date } of s.byDay) {
    const t = new Date(`${date}T00:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  const before = new Set(events.filter((e) => e.s < from).map((e) => e.a));
  const newArtists = [...new Set(ev.map((e) => e.a))].filter((a) => a && !before.has(a));
  const top = s.topArtists[0];
  const when = topHour < 5 ? '새벽' : topHour < 11 ? '아침' : topHour < 17 ? '낮' : topHour < 21 ? '저녁' : '밤';
  const type = !ev.length ? null : top && top.share >= 0.4 ? `한 우물형 · ${top.artist}에 푹 빠진 ${when} 리스너` : s.uniqueArtists >= 30 ? `탐험가형 · 여러 가수를 두루 듣는 ${when} 리스너` : `${when}형 리스너`;
  return {
    year,
    minutes: s.minutes,
    plays: s.plays,
    uniqueTracks: s.uniqueTracks,
    uniqueArtists: s.uniqueArtists,
    topTracks: s.topTracks.slice(0, 5),
    topArtists: s.topArtists.slice(0, 5),
    topAlbums: s.topAlbums.slice(0, 5),
    monthly: monthly.map((x) => Math.round(x / 60)),
    topMonth: ev.length ? topMonth + 1 : null,
    topDay,
    topHour: ev.length ? topHour : null,
    longestStreak: longest,
    activeDays: s.activeDays,
    firstSong: ev[0] ? { id: ev[0].id, title: ev[0].t, artist: ev[0].a, at: ev[0].s } : null,
    newArtists: newArtists.length,
    type,
  };
}
