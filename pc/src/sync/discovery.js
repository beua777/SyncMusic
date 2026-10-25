import dgram from 'node:dgram';
import { APP_NAME, PROTOCOL_VERSION } from '../config.js';

// 폰이 브로드캐스트로 {"t":"discover","app":"SyncMusic"}를 보내면 우리 정보를 답한다.
export function startDiscovery({ port, host = '0.0.0.0', getInfo, onError }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    let m;
    try {
      m = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (m?.t !== 'discover' || m.app !== APP_NAME) return;
    const reply = Buffer.from(JSON.stringify({ t: 'here', app: APP_NAME, v: PROTOCOL_VERSION, ...getInfo() }));
    sock.send(reply, rinfo.port, rinfo.address);
  });
  sock.on('error', (e) => onError?.(e));
  return new Promise((resolve) => {
    sock.bind(port, host, () => {
      resolve({
        port: sock.address().port,
        close: () => new Promise((r) => sock.close(() => r())),
      });
    });
  });
}
