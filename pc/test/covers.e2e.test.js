// 커버는 곡마다: 같은 폴더(=같은 앨범 이름)라도 곡마다 그림이 다르면 각자 자기 그림
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { Covers } from '../src/covers.js';
import { coverArt, id3v24, melodyPcm, wav } from '../tools/fixtures.js';

const RED = coverArt([200, 30, 30], [250, 120, 90], [255, 255, 255], 64);
const BLUE = coverArt([20, 40, 200], [90, 160, 250], [255, 255, 255], 64);
const GREEN = coverArt([20, 160, 60], [150, 230, 120], [255, 255, 255], 64);
const song = (seed, title, cover) => wav(melodyPcm({ seed, seconds: 2 }), id3v24({ title, artist: '유튜버', cover }));

test('같은 그림을 동시에 저장해도 실패 없이 한 파일로 (같은 커버의 앨범 곡들)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-covers-race-'));
  try {
    const covers = new Covers(dir);
    const ids = await Promise.all([...Array.from({ length: 8 }, () => covers.save(RED, 'image/png')), covers.save(BLUE, 'image/png')]);
    assert.equal(new Set(ids.slice(0, 8)).size, 1);
    assert.notEqual(ids[8], ids[0]);
    const files = fs.readdirSync(path.join(dir, 'covers')).sort();
    assert.deepEqual(files, [`${ids[0]}.png`, `${ids[8]}.png`].sort(), '임시 파일이 남지 않음');
    assert.deepEqual(fs.readFileSync(path.join(dir, 'covers', `${ids[0]}.png`)), RED);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('커버는 곡마다 따로, 같은 그림은 하나로, 태그에 없으면 폴더 그림', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmusic-covers-'));
  const music = path.join(root, 'music');
  const yt = path.join(music, '테'); // 앨범 태그 없음 → 앨범 이름 = 폴더 이름 (예전에는 모두 첫 곡 그림)
  const album = path.join(music, '앨범');
  fs.mkdirSync(yt, { recursive: true });
  fs.mkdirSync(album, { recursive: true });
  fs.writeFileSync(path.join(yt, 'a.wav'), song(1, '빨강 1', RED));
  fs.writeFileSync(path.join(yt, 'b.wav'), song(2, '파랑', BLUE));
  fs.writeFileSync(path.join(yt, 'c.wav'), song(3, '빨강 2', RED));
  fs.writeFileSync(path.join(yt, 'd.wav'), song(4, '그림 없음', null));
  fs.writeFileSync(path.join(album, 'cover.png'), GREEN);
  fs.writeFileSync(path.join(album, 'e.wav'), song(5, '폴더 그림', null));

  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'covers'), { recursive: true });
  const stale = path.join(data, 'covers', '0123456789abcdef0123.jpg'); // 예전 버전의 앨범 단위 캐시
  fs.writeFileSync(stale, 'old');
  const old = new Date(Date.now() - 86_400_000);
  fs.utimesSync(stale, old, old);

  const app = await createApp({ dataDir: data, musicFolders: [music], ports: { ui: 0 }, lan: false, system: false, onQuit: () => {} });
  await app.start();
  await app.initialScan;
  t.after(async () => {
    await app.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const by = (title) => app.library.list().find((x) => x.title === title);
  const get = (p) => fetch(`http://127.0.0.1:${app.ports.ui}${p}`);

  const [r1, b, r2, none, folder] = ['빨강 1', '파랑', '빨강 2', '그림 없음', '폴더 그림'].map(by);
  assert.match(r1.cover, /^[0-9a-f]{20}$/);
  assert.equal(r1.coverFrom, 'tag');
  assert.equal(r1.cover, r2.cover, '같은 그림은 같은 ID (한 번만 저장)');
  assert.notEqual(r1.cover, b.cover, '같은 폴더라도 곡마다 자기 그림');
  assert.equal(none.cover, null, '그림 없는 곡은 남의 그림을 빌리지 않음');
  assert.equal(folder.coverFrom, 'folder');

  const res = await get(`/api/covers/${b.cover}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BLUE);
  assert.equal((await get(`/api/covers/${'f'.repeat(20)}`)).status, 404);
  assert.equal((await get(`/api/tracks/${none.id}/cover`)).status, 404);
  assert.equal((await get(`/api/tracks/${folder.id}/cover`)).status, 200);

  assert.equal(fs.existsSync(stale), false, '아무 곡도 안 쓰는 옛 그림은 지움');
  assert.equal(fs.readdirSync(path.join(data, 'covers')).length, 3, '빨강·파랑·초록');

  await t.test('예전 버전에서 넘어온 곡(커버 정보 없음)은 검색할 때 채움', async () => {
    for (const x of app.library.list()) {
      delete x.cover;
      delete x.coverFrom;
    }
    let changed = 0;
    app.library.once('changed', (info) => (changed = info.total));
    await app.library.scan();
    assert.equal(changed, 5, '커버만 바뀌어도 화면에 알림');
    assert.equal(by('파랑').cover, b.cover);
    assert.equal(by('그림 없음').cover, null);
  });

  await t.test('나중에 폴더에 cover.png를 넣으면 그림 없는 곡만 그걸 씀', async () => {
    fs.writeFileSync(path.join(yt, 'cover.png'), GREEN);
    await app.library.scan();
    assert.equal(by('그림 없음').cover, folder.cover);
    assert.equal(by('그림 없음').coverFrom, 'folder');
    assert.equal(by('빨강 1').cover, r1.cover, '태그 그림이 있는 곡은 그대로');
  });
});
