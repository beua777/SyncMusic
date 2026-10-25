// 폰 앱(Kotlin) 단위 테스트에 넣을 프로토콜 계산 기준값 만들기
//   node tools/protocol-vectors.js
// 이 값과 Kotlin 결과가 바이트 단위로 같아야 페어링·서명·곡 식별이 맞는다.
import crypto from 'node:crypto';
import { quickHashBuffer } from '../src/quickhash.js';
import { deriveSecret, pairProof, sha256hex, signRequest, signResponse } from '../src/sync/crypto.js';

const a = crypto.createECDH('prime256v1');
a.setPrivateKey(Buffer.from('1f'.repeat(32), 'hex'));
const b = crypto.createECDH('prime256v1');
b.setPrivateKey(Buffer.from('2e'.repeat(32), 'hex'));
const shared = a.computeSecret(b.getPublicKey());
const secret = deriveSecret(shared, '123456', 'dev-12345678', 'pc-0001');
const body = Buffer.from('{"hello":"폰"}');
const bodyHash = sha256hex(body);
const sig = signRequest(secret, 'POST', '/sync/manifest', 1700000000000, bodyHash);
const big = Buffer.alloc(200000);
for (let i = 0; i < big.length; i++) big[i] = i % 251;
const small = Buffer.alloc(1000);
for (let i = 0; i < small.length; i++) small[i] = (i * 7) % 256;

console.log(
  JSON.stringify(
    {
      privA: '1f'.repeat(32),
      pubA: a.getPublicKey().toString('hex'),
      pubB: b.getPublicKey().toString('hex'),
      shared: shared.toString('hex'),
      secret: secret.toString('hex'),
      bodyHash,
      sig,
      respSig: signResponse(secret, sig, sha256hex(Buffer.from('{}'))),
      proof: pairProof('123456', 'pair1', 'dev-12345678', 'AAAA'),
      qhBig: quickHashBuffer(big),
      qhSmall: quickHashBuffer(small),
      qhEmpty: quickHashBuffer(Buffer.alloc(0)),
    },
    null,
    1,
  ),
);
