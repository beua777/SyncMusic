import crypto from 'node:crypto';
import fsp from 'node:fs/promises';

// 곡 식별용 quick hash (폰 앱의 QuickHash.kt와 반드시 같아야 함)
//   qh = hex( SHA-256( size(8바이트 빅엔디언) ‖ 앞 64KiB ‖ 뒤 min(64KiB, size−64KiB) ) ) 의 앞 32글자
// 파일 전체를 읽지 않아서 큰 FLAC도 빠르고, 같은 파일이면 폰과 PC에서 같은 값이 나온다.
export const QH_CHUNK = 64 * 1024;

export async function quickHash(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const h = crypto.createHash('sha256');
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64BE(BigInt(size));
    h.update(sizeBuf);
    h.update(await readExactly(fh, 0, Math.min(QH_CHUNK, size)));
    if (size > QH_CHUNK) {
      const tailLen = Math.min(QH_CHUNK, size - QH_CHUNK);
      h.update(await readExactly(fh, size - tailLen, tailLen));
    }
    return h.digest('hex').slice(0, 32);
  } finally {
    await fh.close();
  }
}

// 메모리에 있는 파일 내용으로 계산 (테스트·가짜 폰용)
export function quickHashBuffer(buf) {
  const size = buf.length;
  const h = crypto.createHash('sha256');
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64BE(BigInt(size));
  h.update(sizeBuf);
  h.update(buf.subarray(0, Math.min(QH_CHUNK, size)));
  if (size > QH_CHUNK) {
    const tailLen = Math.min(QH_CHUNK, size - QH_CHUNK);
    h.update(buf.subarray(size - tailLen));
  }
  return h.digest('hex').slice(0, 32);
}

export const isQh = (s) => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);

async function readExactly(fh, position, length) {
  const buf = Buffer.alloc(length);
  let off = 0;
  while (off < length) {
    const { bytesRead } = await fh.read(buf, off, length - off, position + off);
    if (bytesRead === 0) break;
    off += bytesRead;
  }
  return off === length ? buf : buf.subarray(0, off);
}
