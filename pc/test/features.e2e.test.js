// 새 기능 API: 곡 사용자 값 · 들은 기록·통계 · 재생목록 이력·휴지통 · 라이브러리 도구 · 가사 · 오류 기록 · 백업 · 설정
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { id3v24, melodyPcm, wav } from '../tools/fixtures.js';

const song = (seed, tag, seconds = 3) => wav(melodyPcm({ seed, seconds }), id3v24(tag));

test('새 기능 API', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-features-'));
  const music = path.join(root, 'music');
  const files = {
    '하늘빛/봄날.wav': song(1, { title: '봄날', artist: '하늘빛', album: '산책', lyrics: '그대의 머릿결 같은\n나무 아래로' }),
    '하늘빛/봄날 (사본).wav': song(1, { title: '봄날', artist: '하늘빛', album: '산책 사본' }), // 같은 곡 다른 파일
    '윤서/첫눈.wav': song(2, { title: '첫눈', artist: '윤서', album: '겨울' }),
  };
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(music, rel)), { recursive: true });
    fs.writeFileSync(path.join(music, rel), data);
  }
  const app = await createApp({ dataDir: path.join(root, 'data'), musicFolders: [music], ports: { ui: 0 }, lan: false, system: false, onQuit: () => {} });
  await app.start();
  await app.initialScan;
  t.after(async () => {
    await app.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.ports.ui}`;
  const call = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
  };
  const ok = async (...a) => {
    const r = await call(...a);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const byTitle = (title, album) => app.library.list().find((x) => x.title === title && (!album || x.album === album));
  const spring = byTitle('봄날', '산책');
  const copy = byTitle('봄날', '산책 사본');
  const snow = byTitle('첫눈');
  assert.ok(spring && copy && snow);

  await t.test('곡 사용자 값: 곡 음량·셔플 제외·북마크·테마를 검사해서 저장하고 변경 이력에 남김', async () => {
    const r = await ok(`/api/tracks/${spring.id}/user`, 'PUT', {
      userGain: 3.3,
      noShuffle: true,
      bookmarks: [{ t: 5.55, note: '후렴' }, { t: -1 }, { t: 'x' }],
      theme: { npBg: 'rainbow', evil: '<b>' },
    });
    assert.equal(r.userGain, 3.5);
    assert.equal(r.noShuffle, true);
    assert.deepEqual(r.bookmarks.map((b) => [b.t, b.note]), [[5.6, '후렴']]);
    assert.deepEqual(r.theme, { npBg: 'rainbow' });
    const d = await ok(`/api/tracks/${spring.id}/details`);
    assert.ok(d.track.metaLog.some((m) => m.field === '곡 음량'));
    assert.equal(d.exists, true);
    assert.ok(d.fileSize > 0);
    const bulk = await ok('/api/tracks/user', 'PUT', { ids: [copy.id, snow.id, 'nope'], patch: { noShuffle: true } });
    assert.equal(bulk.changed, 2);
    await ok(`/api/tracks/${spring.id}/user`, 'PUT', { theme: null, userGain: 0 });
    assert.equal(app.library.get(spring.id).theme, undefined);
  });

  await t.test('들은 기록 → 통계 · 연말 결산 · 내보내기', async () => {
    assert.deepEqual(await ok('/api/history', 'POST', { id: spring.id, start: Date.now() - 60_000, listened: 45, completed: true }), { saved: true });
    assert.deepEqual(await ok('/api/history', 'POST', { id: snow.id, start: Date.now() - 30_000, listened: 0.2 }), { saved: false });
    await ok('/api/history', 'POST', { id: snow.id, start: Date.now() - 20_000, listened: 12, skipped: true });
    assert.equal(app.library.get(snow.id).skips, 1, '넘긴 횟수');
    const o = await ok('/api/stats/overview');
    assert.equal(o.total, 2);
    assert.equal(o.week.plays, 1);
    assert.equal(o.week.topTracks[0].id, spring.id);
    assert.ok(Array.isArray(o.recommend) && o.goals && o.forgotten && o.recentlyAdded && o.taste);
    const w = await ok(`/api/stats/wrapped?year=${new Date().getFullYear()}`);
    assert.deepEqual(w.years, [new Date().getFullYear()]);
    assert.equal(w.plays, 1);
    // fetch의 text()는 BOM을 떼어 버려서 바이트로 확인 (엑셀이 한글을 읽게 붙이는 표시)
    const raw = Buffer.from(await (await fetch(`${base}/api/stats/export?format=csv`)).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(raw.toString('utf8').includes('봄날'));
    const json = await call('/api/stats/export?format=json');
    assert.equal(json.body.events.length, 2);
  });

  await t.test('재생목록: 바뀌기 전 모습이 이력에 남고 되돌릴 수 있음 · 지운 목록은 모양까지 되살림', async () => {
    const p = await ok('/api/playlists', 'POST', { name: '이력 시험', entries: [spring.id] });
    await ok(`/api/playlists/${p.id}`, 'PUT', { entries: [spring.id, snow.id] });
    const { versions } = await ok(`/api/playlists/${p.id}/history`);
    assert.deepEqual(versions[0].entries, [spring.id]);
    const back = await ok(`/api/playlists/${p.id}/restore`, 'POST', { at: versions[0].at });
    assert.deepEqual(back.entries, [spring.id]);
    assert.equal((await call(`/api/playlists/${p.id}/restore`, 'POST', { at: 1 })).status, 404);
    const styled = await ok(`/api/playlists/${p.id}`, 'PUT', { color: '#FF3366', icon: '🔥', mode: { shuffle: 'on', repeat: 'bogus' } });
    assert.equal(styled.color, '#ff3366');
    assert.deepEqual(styled.mode, { shuffle: 'on', repeat: 'keep' });
    await ok(`/api/playlists/${p.id}`, 'DELETE');
    const { lists } = await ok('/api/playlist-trash');
    const gone = lists.find((l) => l.name === '이력 시험');
    assert.ok(gone);
    const again = await ok(`/api/playlist-trash/${gone.id}/restore`, 'POST');
    assert.equal(again.name, '이력 시험');
    assert.equal(again.color, '#ff3366');
    assert.equal(again.icon, '🔥');
    assert.deepEqual(again.mode, { shuffle: 'on', repeat: 'keep' });
    assert.ok(!(await ok('/api/playlist-trash')).lists.some((l) => l.name === '이력 시험'));
  });

  await t.test('라이브러리 도구: 점검 · 같은 곡 다른 파일 · 변경 기록', async () => {
    const c = await ok('/api/library/check');
    assert.equal(c.total, 3);
    assert.equal(c.missing.length, 0);
    assert.equal(c.duplicates, 1);
    const { groups } = await ok('/api/library/duplicates');
    assert.equal(groups.length, 1);
    assert.deepEqual(new Set(groups[0].map((x) => x.id)), new Set([spring.id, copy.id]));
    const { scans } = await ok('/api/library/changes');
    assert.equal(scans.at(-1).added.length, 3, '처음 검색 때 들어온 곡');
  });

  await t.test('가사: 태그 가사로 찾기 · .lrc로 저장(예전 파일은 백업) · 저장한 가사로 찾기', async () => {
    const hit = await ok(`/api/search/lyrics?q=${encodeURIComponent('머릿결')}`);
    assert.deepEqual(hit.results.map((r) => r.id), [spring.id]);
    assert.match(hit.results[0].snippet, /머릿결/);
    await ok(`/api/tracks/${snow.id}/lyrics`, 'PUT', { text: '[00:01.00]하얀 첫 줄\n[00:02.00]둘째 줄' });
    const lrc = path.join(music, '윤서', '첫눈.lrc');
    assert.ok(fs.existsSync(lrc));
    assert.equal((await ok(`/api/tracks/${snow.id}/lyrics/raw`)).text.includes('하얀 첫 줄'), true);
    await ok(`/api/tracks/${snow.id}/lyrics`, 'PUT', { text: '[00:01.00]고친 줄' });
    assert.ok(fs.readdirSync(path.join(root, 'data', 'lyrics-backup')).length >= 1, '덮어쓰기 전 가사는 백업');
    const found = await ok(`/api/search/lyrics?q=${encodeURIComponent('고친')}`);
    assert.deepEqual(found.results.map((r) => r.id), [snow.id]);
    assert.equal((await call(`/api/tracks/${snow.id}/lyrics`, 'PUT', { text: '  ' })).status, 400);
  });

  await t.test('오류 기록: 같은 오류는 1분 안이면 합치고, 지울 수 있음', async () => {
    await ok('/api/errors', 'POST', { source: 'play', message: '열 수 없는 파일' });
    await ok('/api/errors', 'POST', { source: 'play', message: '열 수 없는 파일' });
    await ok('/api/errors', 'POST', { source: 'evil', message: '모르는 출처' });
    const { items } = await ok('/api/errors');
    assert.equal(items.find((e) => e.message === '열 수 없는 파일').count, 2);
    assert.equal(items.find((e) => e.message === '모르는 출처').source, 'ui');
    await ok('/api/errors', 'DELETE');
    assert.deepEqual((await ok('/api/errors')).items, []);
  });

  await t.test('설정: 묶음마다 검사해서 저장', async () => {
    const s = await ok('/api/settings', 'PUT', { design: { fps: 60 }, audio: { crossfade: 99, eqPreset: 'rock' }, layout: { hiddenTabs: ['folders'] } });
    assert.equal(s.design.fps, 60);
    assert.equal(s.audio.crossfade, 12);
    assert.equal(s.audio.eqPreset, 'rock');
    assert.deepEqual(s.layout.hiddenTabs, ['folders']);
    assert.equal((await ok('/api/settings', 'PUT', { design: { fps: 45 } })).design.fps, 60);
  });

  await t.test('백업: 받아서 확인하고, 바뀐 설정·지운 재생목록·들은 기록을 되살림 (기록은 겹치지 않게 합침)', async () => {
    const backup = (await call('/api/backup')).body;
    const sum = await ok('/api/backup/inspect', 'POST', backup);
    assert.equal(sum.history, 2);
    assert.ok(sum.playlists >= 1);
    assert.equal((await call('/api/backup/inspect', 'POST', { app: 'Other' })).status, 400);
    await ok('/api/settings', 'PUT', { audio: { crossfade: 3 } });
    const lists = (await ok('/api/playlists')).playlists.filter((p) => !p.system);
    for (const p of lists) await ok(`/api/playlists/${p.id}`, 'DELETE');
    const r = await ok('/api/backup/restore', 'POST', backup);
    assert.equal(r.settings, true);
    assert.equal((await ok('/api/settings')).audio.crossfade, 12);
    assert.ok((await ok('/api/playlists')).playlists.some((p) => p.name === '이력 시험'));
    assert.equal((await ok('/api/stats/overview')).total, 2, '같은 기록은 한 번만');
  });
});
