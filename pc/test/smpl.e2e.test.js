// .smpl로 백업하는 갤럭시 (실제 S26이 이 형식) + '재생목록에 든 곡만' 옮기기
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { deviceOptions } from '../src/sync/service.js';
import { FakePhone, STORAGE } from '../tools/fake-phone.js';
import { id3v24, melodyPcm, wav } from '../tools/fixtures.js';

const song = (seed, title, artist) => wav(melodyPcm({ seed, seconds: 3 }), id3v24({ title, artist, album: '테스트' }));
const M = `${STORAGE}/Music`;
const PL = `${STORAGE}/Download/SamsungMusic/Playlists`;

test('예전 옵션 값(true/false)은 새 선택지로 바뀜', () => {
  assert.deepEqual(deviceOptions({ phoneToPc: true }), { phoneToPc: 'playlists', pcToPhone: 'playlists', confirm: false });
  assert.deepEqual(deviceOptions({ phoneToPc: false, pcToPhone: 'all' }), { phoneToPc: 'none', pcToPhone: 'all', confirm: false });
  assert.deepEqual(deviceOptions({ phoneToPc: 'weird', confirm: true }), { phoneToPc: 'playlists', pcToPhone: 'playlists', confirm: true });
});

test('.smpl 기기: 재생목록 곡만 PC로, PC에서 고친 재생목록은 .smpl로 다시 씀', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-smpl-'));
  const pcMusic = path.join(root, 'pc-music');
  fs.mkdirSync(pcMusic, { recursive: true });
  fs.writeFileSync(path.join(pcMusic, 'PC 노래.wav'), song(11, 'PC 노래', 'PC가수'));
  const app = await createApp({ dataDir: path.join(root, 'data'), musicFolders: [pcMusic], ports: { ui: 0, sync: 0, discovery: 0 }, lanHost: '127.0.0.1', system: false, onQuit: () => {} });
  await app.start();
  await app.initialScan;
  t.after(async () => {
    await app.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const ui = async (p, method = 'GET', body) =>
    (
      await fetch(`http://127.0.0.1:${app.ports.ui}${p}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
    ).json();
  const lib = app.library;
  const idOf = (title) => lib.list().find((x) => x.title === title)?.id;
  const titles = (ids) => ids.map((id) => lib.get(id)?.title ?? `?${id}`);

  const phone = new FakePhone({ name: 'S26 테스트' });
  phone.pc = { host: '127.0.0.1', port: app.ports.sync };
  phone.addTrack(`${M}/폰 노래 1.wav`, song(21, '폰 노래 1', '폰가수'), { title: '폰 노래 1', artist: '폰가수', duration: 3 });
  phone.addTrack(`${STORAGE}/Download/폰 노래 2.wav`, song(22, '폰 노래 2', null), { title: '폰 노래 2', duration: 3 }); // 가수 없음
  phone.addTrack(`${STORAGE}/Android/media/app/목록 밖 노래.wav`, song(23, '목록 밖 노래', '누군가'), { title: '목록 밖 노래', artist: '누군가', duration: 3 });
  phone.samsungWriteSmpl(`출근길.smpl`, [`${STORAGE}/Download/폰 노래 2.wav`, `${M}/폰 노래 1.wav`]);
  const { code } = await ui('/api/sync/pairing', 'POST');
  await phone.pair(code);
  const smplOf = (file) => JSON.parse(phone.playlistFiles.get(file).text);

  await t.test('기본 옵션: 재생목록에 든 곡만 PC로 가져오고, 목록 밖 곡은 안 가져옴', async () => {
    const r = await phone.sync();
    assert.equal(r.uploaded, 2);
    assert.equal(idOf('목록 밖 노래'), undefined);
    assert.deepEqual(titles(app.playlists.findByName('출근길').entries), ['폰 노래 2', '폰 노래 1']);
  });

  await t.test('PC에서 고친 재생목록은 같은 .smpl 파일에 삼성 형식(JSON)으로 씀, 기존 값 유지', async () => {
    const pl = app.playlists.findByName('출근길');
    await ui(`/api/playlists/${pl.id}`, 'PUT', { entries: [idOf('PC 노래'), ...pl.entries] });
    const r = await phone.sync();
    assert.equal(r.downloaded, 1, 'PC 노래가 폰으로');
    assert.deepEqual(r.written.map((w) => w.file), ['출근길.smpl']);
    const j = smplOf('출근길.smpl');
    assert.deepEqual([j.name, j.sortBy, j.version, j.recentlyPlayedDate], ['출근길', 4, 1, 1791370269]);
    assert.deepEqual(j.members.map((m) => m.order), [3, 2, 1], 'order 큰 곡부터');
    assert.ok(phone.playlistFiles.get('출근길.smpl').text.includes('\\u003cunknown\\u003e'));
    assert.deepEqual(phone.readPlaylistTitles('출근길.smpl'), ['PC 노래', '폰 노래 2', '폰 노래 1']);
  });

  await t.test('PC에서 새로 만든 재생목록도 이 폰에서는 .smpl로 만들고, PC가 파일 이름을 기억', async () => {
    await ui('/api/playlists', 'POST', { name: '새 목록', entries: [idOf('폰 노래 1')] });
    const r = await phone.sync();
    assert.deepEqual(r.written.map((w) => w.file), ['새 목록.smpl']);
    assert.deepEqual(phone.readPlaylistTitles('새 목록.smpl'), ['폰 노래 1']);
    const link = Object.values(app.sync.devices[phone.deviceId].links).find((l) => l.key === '새 목록');
    assert.equal(link.file, '새 목록.smpl');
    const again = await phone.sync();
    assert.equal(again.written.length, 0);
  });

  await t.test('삼성 뮤직이 가져온 뒤 다시 백업하면 기준점 확정, 더 쓰지 않음', async () => {
    phone.samsungWriteSmpl('출근길.smpl', phone.readPlaylistPaths('출근길.smpl'));
    const r = await phone.sync();
    assert.equal(r.written.length, 0);
    const link = Object.values(app.sync.devices[phone.deviceId].links).find((l) => l.key === '출근길');
    assert.deepEqual(titles(link.base), ['PC 노래', '폰 노래 2', '폰 노래 1']);
  });

  await t.test("옵션 '폰의 모든 음악'이면 목록 밖 곡도, '가져오지 않음'이면 아무것도", async () => {
    await ui(`/api/sync/devices/${phone.deviceId}`, 'PUT', { options: { phoneToPc: 'all' } });
    assert.equal((await phone.sync()).uploaded, 1);
    assert.ok(idOf('목록 밖 노래'));
    await ui(`/api/sync/devices/${phone.deviceId}`, 'PUT', { options: { phoneToPc: 'none' } });
    phone.addTrack(`${M}/더 새 노래.wav`, song(24, '더 새 노래', '폰가수'), { title: '더 새 노래', artist: '폰가수', duration: 3 });
    phone.samsungWriteSmpl('출근길.smpl', [...phone.readPlaylistPaths('출근길.smpl'), `${M}/더 새 노래.wav`], { mtime: Date.now() + 1000 });
    assert.equal((await phone.sync()).uploaded, 0);
  });
});
