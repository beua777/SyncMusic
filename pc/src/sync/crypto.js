import crypto from 'node:crypto';

// 폰 앱의 SyncCrypto.kt와 바이트 단위로 같아야 한다. (형식은 docs/PLAN.md 6.2~6.3)

export const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const EMPTY_SHA256 = sha256hex(Buffer.alloc(0));

export const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg, 'utf8').digest();

export function signRequest(secret, method, pathWithQuery, time, bodyHash) {
  return hmac(secret, `${String(method).toUpperCase()}\n${pathWithQuery}\n${time}\n${bodyHash}`).toString('base64');
}

export function signResponse(secret, requestSig, bodyHash) {
  return hmac(secret, `resp\n${requestSig}\n${bodyHash}`).toString('base64');
}

export function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// 페어링 증명: HMAC(키=6자리 코드, "부분1|부분2|...")
export function pairProof(code, ...parts) {
  return hmac(Buffer.from(String(code), 'utf8'), parts.join('|')).toString('base64');
}

// ECDH 결과로 기기별 비밀키(32바이트)를 만든다
export function deriveSecret(shared, code, deviceId, pcId) {
  return Buffer.from(
    crypto.hkdfSync('sha256', shared, Buffer.from(String(code), 'utf8'), Buffer.from(`SyncMusic pair v1|${deviceId}|${pcId}`, 'utf8'), 32),
  );
}

// P-256, 공개키는 비압축 65바이트(0x04‖X‖Y)를 base64로 주고받는다
export function newEcdh() {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  return e;
}
