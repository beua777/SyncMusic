// 폰 ↔ PC 동기화 전체 흐름 (가짜 폰으로 실제 HTTP·UDP 통신)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { FakePhone, STORAGE } from '../tools/fake-phone.js';
import { id3v24, melodyPcm, wav } from '../tools/fixtures.js';

const song = (seed, title, artist) => wav(melodyPcm({ seed, seconds: 3 }), id3v24({ title, artist, album: '테스트 앨범' }));
const M = `${STORAGE}/Music`;

test('폰 ↔ PC 동기화: 찾기 → 페어링 → 파일 → 재생목록 순서 → 충돌 병합 → 보안', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-e2e-'));
  const pcMusic = path.join(root, 'pc-music');
  const S = {
    a1: song(1, 'PC 노래 1', 'PC가수'),
    a2: song(2, 'PC 노래 2', 'PC가수'),
    shared: song(3, '같이 있는 노래', '공통가수'),
    p1: song(4, '폰 노래 1', '폰가수'),
    p2: song(5, '폰 노래 2', '폰가수'),
    p3: song(6, '폰 노래 3', '폰가수'),
    sharedOther: song(77, '같이 있는 노래', '공통가수'), // 같은 곡, 다른 파일(다른 인코딩이라고 가정)
  };
  for (const [rel, data] of [
    ['PC가수/PC 노래 1.wav', S.a1],
    ['PC가수/PC 노래 2.wav', S.a2],
    ['공통가수/같이 있는 노래.wav', S.shared],
  ]) {
    fs.mkdirSync(path.dirname(path.join(pcMusic, rel)), { recursive: true });
    fs.writeFileSync(path.join(pcMusic, rel), data);
  }

  const app = await createApp({
    dataDir: path.join(root, 'data'),
    musicFolders: [pcMusic],
    ports: { ui: 0, sync: 0, discovery: 0 },
    lanHost: '127.0.0.1',
    onQuit: () => {},
  });
  await app.start();
  await app.initialScan;
  t.after(async () => {
    await app.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ui = async (p, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${app.ports.ui}${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };
  const lib = app.library;
  const idOf = (title) => lib.list().find((x) => x.title === title)?.id;
  const titles = (ids) => ids.map((id) => lib.get(id)?.title ?? `?${id}`);

  const study = await ui('/api/playlists', 'POST', { name: '공부', entries: [idOf('PC 노래 1'), idOf('같이 있는 노래')] });

  const phone = new FakePhone({ name: 'Galaxy 테스트폰' });
  phone.addTrack(`${M}/폰가수/폰 노래 1.wav`, S.p1, { title: '폰 노래 1', artist: '폰가수', duration: 3 });
  phone.addTrack(`${M}/공통가수/같이 있는 노래.wav`, S.shared, { title: '같이 있는 노래', artist: '공통가수', duration: 3 });
  phone.addTrack(`${M}/폰가수/폰 노래 2.wav`, S.p2, { title: '폰 노래 2', artist: '폰가수', duration: 3 });
  phone.samsungWrite('드라이브.m3u', [`${M}/폰가수/폰 노래 1.wav`, `${M}/공통가수/같이 있는 노래.wav`, `${M}/폰가수/폰 노래 2.wav`]);

  await t.test('UDP 브로드캐스트에 PC가 답함', async () => {
    const pc = await phone.discover({ host: '127.0.0.1', port: app.ports.discovery });
    assert.equal(pc.port, app.ports.sync);
    assert.equal(pc.pcId, app.sync.pcId);
  });

  await t.test('페어링: 코드를 안 띄웠거나 틀리면 거부, 맞으면 양쪽이 같은 비밀키', async () => {
    await assert.rejects(phone.pair('000000'), /403/);
    const { code } = await ui('/api/sync/pairing', 'POST');
    await assert.rejects(phone.pair(code === '123456' ? '654321' : '123456'), /403/);
    await phone.pair(code);
    assert.ok(Buffer.from(app.sync.devices[phone.deviceId].secret, 'base64').equals(phone.secret));
    assert.equal((await ui('/api/sync/status')).pairing, null); // 코드는 한 번 쓰면 끝
  });

  await t.test('첫 동기화: 폰 곡은 PC로, 재생목록 곡은 폰으로, 순서는 그대로', async () => {
    const r = await phone.sync();
    assert.equal(r.uploaded, 2, '폰에만 있는 2곡 (같이 있는 노래는 이미 있음)');
    assert.equal(r.downloaded, 1, "'공부'에 든 PC 노래 1");
    assert.deepEqual(r.errors, []);
    const drive = app.playlists.findByName('드라이브');
    assert.deepEqual(titles(drive.entries), ['폰 노래 1', '같이 있는 노래', '폰 노래 2']);
    assert.equal(drive.origin, 'phone');
    assert.ok(fs.existsSync(path.join(pcMusic, 'From Phone', '폰가수', '폰 노래 1.wav')));
    assert.deepEqual(phone.readPlaylistPaths('공부.m3u'), [`${M}/SyncMusic/PC가수/PC 노래 1.wav`, `${M}/공통가수/같이 있는 노래.wav`]);
  });

  await t.test('바뀐 게 없으면 아무것도 옮기지 않음', async () => {
    const r = await phone.sync();
    assert.deepEqual([r.uploaded, r.downloaded, r.written.length], [0, 0, 0]);
  });

  await t.test('같은 곡이 다른 파일이어도 제목·가수·길이로 맞춰서 다시 올리지 않음', async () => {
    phone.addTrack(`${M}/다른 폴더/같이 있는 노래 (재인코딩).wav`, S.sharedOther, { title: '같이 있는 노래', artist: '공통가수', duration: 3 });
    const r = await phone.sync();
    assert.equal(r.uploaded, 0);
  });

  await t.test('삼성 뮤직이 가져온 뒤 같은 내용으로 백업하면 기준점이 확정됨', async () => {
    phone.samsungWrite('공부.m3u', phone.readPlaylistPaths('공부.m3u'));
    const r = await phone.sync();
    assert.equal(r.written.length, 0);
    const link = Object.values(app.sync.devices[phone.deviceId].links).find((l) => l.key === '공부');
    assert.deepEqual(titles(link.base), ['PC 노래 1', '같이 있는 노래']);
  });

  await t.test('양쪽에서 동시에 고치면 3-way 병합: 최근 쪽 순서 + 반대쪽 추가·삭제 반영', async () => {
    const drive = app.playlists.findByName('드라이브');
    const [p1, shared, p2] = drive.entries;
    await ui(`/api/playlists/${drive.id}`, 'PUT', { entries: [p2, p1, shared, idOf('PC 노래 2')] }); // PC: 순서 바꾸고 PC 노래 2 추가
    phone.addTrack(`${M}/폰가수/폰 노래 3.wav`, S.p3, { title: '폰 노래 3', artist: '폰가수', duration: 3 });
    // 폰(나중에 고침): '같이 있는 노래'를 빼고 '폰 노래 3'을 맨 앞에
    phone.samsungWrite('드라이브.m3u', [`${M}/폰가수/폰 노래 3.wav`, `${M}/폰가수/폰 노래 1.wav`, `${M}/폰가수/폰 노래 2.wav`], { mtime: Date.now() + 5000 });
    const r = await phone.sync();
    const merged = ['폰 노래 3', '폰 노래 1', '폰 노래 2', 'PC 노래 2'];
    assert.deepEqual(titles(app.playlists.findByName('드라이브').entries), merged);
    assert.equal(r.uploaded, 1, '폰 노래 3');
    assert.equal(r.downloaded, 1, 'PC 노래 2');
    assert.deepEqual(phone.readPlaylistTitles('드라이브.m3u'), merged);
    const again = await phone.sync(); // 다시 해도 그대로 (흔들리지 않음)
    assert.deepEqual([again.uploaded, again.downloaded, again.written.length], [0, 0, 0]);
    assert.deepEqual(titles(app.playlists.findByName('드라이브').entries), merged);
  });

  await t.test('PC에서 만든 재생목록은 폰에 .m3u로 써 두고, 삼성 뮤직 백업이 덮어써도 PC 변경은 남음', async () => {
    const created = await ui('/api/playlists', 'POST', { name: '운동', entries: [idOf('폰 노래 2'), idOf('PC 노래 2')] });
    let r = await phone.sync();
    assert.deepEqual(phone.readPlaylistTitles('운동.m3u'), ['폰 노래 2', 'PC 노래 2']);
    // 사용자가 가져오기 전에 PC에서 한 곡 더 넣음 → 폰 파일만 바뀜
    await ui(`/api/playlists/${created.id}/add`, 'POST', { ids: [idOf('폰 노래 1')] });
    r = await phone.sync();
    assert.equal(r.written.length, 1);
    assert.deepEqual(phone.readPlaylistTitles('운동.m3u'), ['폰 노래 2', 'PC 노래 2', '폰 노래 1']);
  });

  await t.test('PC에서 지운 재생목록: 삼성 뮤직 백업 파일은 건드리지 않고 안내만', async () => {
    await ui(`/api/playlists/${study.id}`, 'DELETE');
    const r = await phone.sync();
    assert.ok(r.plan.notices.some((n) => n.includes('공부')));
    assert.ok(phone.playlistFiles.has('공부.m3u'));
    assert.equal(app.playlists.findByName('공부'), null, '다시 살아나지 않음');
  });

  await t.test('PC에서 지운 재생목록: 우리가 쓴 파일(아직 안 가져옴)은 폰에서도 지움', async () => {
    const workout = app.playlists.findByName('운동');
    await ui(`/api/playlists/${workout.id}`, 'DELETE');
    await phone.sync();
    assert.equal(phone.playlistFiles.has('운동.m3u'), false);
  });

  await t.test('폰에서 재생목록이 없어지면 PC 것은 남기고 연결만 끊음 (다시 보내지 않음)', async () => {
    phone.playlistFiles.delete('드라이브.m3u');
    const r = await phone.sync();
    const drive = app.playlists.findByName('드라이브');
    assert.ok(drive);
    assert.equal(drive.syncToPhone, false);
    assert.ok(r.plan.notices.some((n) => n.includes('드라이브')));
    await phone.sync();
    assert.equal(phone.playlistFiles.has('드라이브.m3u'), false);
  });

  await t.test('이어듣기: 폰 대기열을 PC 곡으로 바꿔 받은 순서 그대로', async () => {
    await phone.sendNowPlaying({
      app: 'com.sec.android.app.music',
      current: { title: '폰 노래 1', artist: '폰가수', durationMs: 3000 },
      positionMs: 1200,
      playing: false,
      shuffle: true,
      repeat: 'all',
      queue: [
        { title: '폰 노래 3', artist: '폰가수' },
        { title: '폰 노래 1', artist: '폰가수' },
        { title: 'PC에 없는 노래', artist: '누군가' },
        { title: 'PC 노래 2', artist: 'PC가수' },
      ],
      activeIndex: 1,
    });
    const h = await ui('/api/sync/handoff', 'POST');
    assert.deepEqual(titles(h.ids), ['폰 노래 3', '폰 노래 1', 'PC 노래 2']);
    assert.deepEqual([h.index, h.missing, h.shuffle, h.repeat], [1, 1, true, 'all']);
    assert.ok(Math.abs(h.positionSec - 1.2) < 0.01);
  });

  await t.test('이어듣기: 재생 위치가 곡 길이를 넘으면 끝 직전에서 시작 (바로 다음 곡으로 튀지 않게)', async () => {
    await phone.sendNowPlaying({
      current: { title: 'PC 노래 2', artist: 'PC가수', durationMs: 3000 }, // 실제 곡 길이 3초
      positionMs: 45_000, // 받은 뒤 오래 지났거나 폰이 이미 다음 곡으로 간 경우
      playing: true,
      queue: [],
    });
    const h = await ui('/api/sync/handoff', 'POST');
    assert.deepEqual(titles(h.ids), ['PC 노래 2']);
    assert.ok(h.positionSec <= 2, `곡 끝 1초 전까지만: ${h.positionSec}`);
  });

  await t.test('보안: 서명 위조·모르는 기기·본문 변조·오래된 요청·내용이 다른 업로드는 거부', async () => {
    const good = phone.secret;
    phone.secret = crypto.randomBytes(32);
    await assert.rejects(phone.call('POST', '/sync/manifest', { json: {} }), /401/);
    phone.secret = good;

    const stranger = new FakePhone();
    stranger.pc = phone.pc;
    stranger.secret = good;
    await assert.rejects(stranger.call('POST', '/sync/manifest', { json: {} }), /401/);

    await assert.rejects(phone.call('POST', '/sync/manifest', { json: { a: 1 }, tamper: true }), /400/);
    await assert.rejects(phone.call('POST', '/sync/manifest', { json: {}, time: Date.now() - 10 * 60_000 }), /401/);
    await assert.rejects(
      phone.call('PUT', `/sync/file/${'0'.repeat(32)}`, { body: S.p1, headers: { 'X-SM-Path': encodeURIComponent(`${M}/x.wav`) } }),
      /400/,
    );
  });

  await t.test("업로드 경로에 '..'가 있어도 From Phone 폴더 밖으로 못 나감", async () => {
    const evil = song(99, '경로 테스트', '보안');
    phone.addTrack(`${STORAGE}/../../../Windows/evil.wav`, evil, { title: '경로 테스트', artist: '보안', duration: 3 });
    await phone.sync();
    assert.ok(fs.existsSync(path.join(pcMusic, 'From Phone', 'Windows', 'evil.wav')));
    assert.ok(!fs.existsSync(path.join(root, 'Windows')));
  });

  await t.test('페어링 코드를 5번 틀리면 코드가 취소됨', async () => {
    const { code } = await ui('/api/sync/pairing', 'POST');
    const intruder = new FakePhone();
    intruder.pc = phone.pc;
    for (let i = 1; i <= 5; i++) await assert.rejects(intruder.pair(String((Number(code) + i) % 1e6).padStart(6, '0')), /403/);
    await assert.rejects(intruder.pair(code), /403/);
  });

  await t.test('화면 서버(127.0.0.1)는 다른 Host·다른 사이트 요청을 거부', async () => {
    const status = (headers, method = 'GET', p = '/api/ping') =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: app.ports.ui, path: p, method, headers }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.end(method === 'POST' ? '{}' : undefined);
      });
    assert.equal(await status({}), 200);
    assert.equal(await status({ Host: 'evil.example' }), 403);
    assert.equal(await status({ 'Sec-Fetch-Site': 'cross-site' }), 403);
    assert.equal(await status({ Origin: 'https://evil.example', 'Content-Type': 'application/json' }, 'POST', '/api/playlists'), 403);
  });

  await t.test('동기화 서버는 화면용 API를 노출하지 않음', async () => {
    const r = await fetch(`http://127.0.0.1:${app.ports.sync}/api/library`);
    assert.equal(r.status, 404);
  });
});
