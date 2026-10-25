import { createApp } from './app.js';
import { APP_NAME } from './config.js';

const app = await createApp();
try {
  await app.start();
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    // 이미 켜져 있으면 조용히 끝낸다 (launch.js가 창만 연다)
    const running = await fetch(`http://127.0.0.1:${app.ports.ui}/api/ping`)
      .then((r) => r.json())
      .catch(() => null);
    if (running?.app === APP_NAME) {
      console.log(`${APP_NAME}이(가) 이미 실행 중이에요: http://127.0.0.1:${app.ports.ui}/`);
      process.exit(0);
    }
    console.error(`포트 ${app.ports.ui}를 다른 프로그램이 쓰고 있어요. SYNCMUSIC_UI_PORT로 바꿀 수 있어요.`);
    process.exit(1);
  }
  throw e;
}

console.log(`${APP_NAME} 실행 중`);
console.log(`  화면:   http://127.0.0.1:${app.ports.ui}/`);
console.log(`  동기화: ${app.lanHost}:${app.ports.sync} (UDP 찾기 ${app.ports.discovery})${app.lanError ? `  ⚠ ${app.lanError}` : ''}`);
console.log(`  데이터: ${app.dataDir}`);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, async () => {
    await app.stop();
    process.exit(0);
  });
}
