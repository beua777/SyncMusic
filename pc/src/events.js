// 화면으로 실시간 알림 보내기 (Server-Sent Events)
export class EventHub {
  constructor() {
    this.clients = new Set();
    this.timer = setInterval(() => this.broadcast(': ping\n\n'), 25_000);
    this.timer.unref();
  }

  handle(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  emit(type, data) {
    this.broadcast(`event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
  }

  broadcast(text) {
    for (const c of this.clients) c.write(text);
  }

  closeAll() {
    clearInterval(this.timer);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
