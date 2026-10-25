import http from 'node:http';
import { APP_NAME, APP_VERSION, PROTOCOL_VERSION } from '../config.js';
import { HttpError, parseJsonBuffer, readBody, sendError, sendFile, sendJson } from '../util/http.js';
import { EMPTY_SHA256, sha256hex, signResponse } from './crypto.js';

// Wi-Fi에 열리는 동기화 서버. hello/pair 말고는 모두 서명이 있어야 한다.
export function createLanServer({ sync }) {
  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://lan');

      if (req.method === 'GET' && pathname === '/sync/hello') {
        return sendJson(res, 200, {
          app: APP_NAME,
          version: APP_VERSION,
          protocol: PROTOCOL_VERSION,
          pcId: sync.pcId,
          pcName: sync.pcName,
          pairing: !!sync.pairingPublic(),
        });
      }

      if (req.method === 'POST' && pathname === '/sync/pair') {
        const body = parseJsonBuffer(await readBody(req, 64 * 1024));
        return sendJson(res, 200, sync.pair(body));
      }

      if (req.method === 'POST' && ['/sync/manifest', '/sync/commit', '/sync/nowplaying'].includes(pathname)) {
        const buf = await readBody(req, 64 * 1024 * 1024);
        const { dev, secret, sig } = sync.authenticate(req, sha256hex(buf));
        const body = parseJsonBuffer(buf);
        let out;
        if (pathname === '/sync/manifest') out = await sync.planSync(dev, body);
        else if (pathname === '/sync/commit') out = sync.commit(dev, body);
        else out = sync.setNowPlaying(dev, body);
        return sendSigned(res, secret, sig, out);
      }

      const file = /^\/sync\/file\/([0-9a-f]{32})$/.exec(pathname);
      if (file && (req.method === 'GET' || req.method === 'HEAD')) {
        sync.authenticate(req, EMPTY_SHA256);
        const t = sync.fileForDownload(file[1]);
        // 응답 본문은 서명하지 않는 대신, 폰이 받은 파일의 quick hash가 요청한 ID와 같은지 확인한다
        return sendFile(req, res, t.path, 'application/octet-stream', { 'X-SM-Id': t.id, 'Cache-Control': 'no-store' });
      }
      if (file && req.method === 'PUT') {
        const claimed = String(req.headers['x-sm-body'] || '');
        if (!/^[0-9a-f]{64}$/.test(claimed)) throw new HttpError(400, 'X-SM-Body가 필요해요');
        const { dev, secret, sig } = sync.authenticate(req, claimed); // 실제 본문 해시는 받으면서 확인
        let phonePath = '';
        try {
          phonePath = decodeURIComponent(String(req.headers['x-sm-path'] || ''));
        } catch {
          throw new HttpError(400, 'X-SM-Path 형식 오류');
        }
        const out = await sync.receiveUpload(dev, file[1], phonePath, req, claimed);
        return sendSigned(res, secret, sig, out);
      }

      throw new HttpError(404, '없는 주소예요');
    } catch (e) {
      sendError(res, e);
    }
  });
  server.requestTimeout = 0; // 큰 FLAC 업로드가 5분 넘게 걸려도 끊지 않음
  server.headersTimeout = 60_000;
  return server;
}

function sendSigned(res, secret, requestSig, obj) {
  const body = Buffer.from(JSON.stringify(obj ?? {}));
  const h = sha256hex(body);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-SM-Body': h,
    'X-SM-Sig': signResponse(secret, requestSig, h),
  });
  res.end(body);
}
