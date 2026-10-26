import { spawn } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { JsonStore } from './util/jsonfile.js';

// 지금 소리가 나는 출력 장치와 그 형식(표본율·비트·채널) — 출력 장치마다 음량 기억, 음질 정보 표시에 쓴다.
// 네이티브 코드 없이 레지스트리의 '켜진' 재생 장치 목록만 3초마다 본다 (PowerShell 하나를 계속 띄워 둠).
// Windows는 기본 장치를 레지스트리에 적지 않아서, 새로 켜진 장치(블루투스 헤드폰을 연결하는 등)를 지금 장치로 본다.
// Windows도 보통 새로 연결된 장치로 소리를 옮긴다. 그 장치가 꺼지면 바로 전 장치로 돌아간다.
const SCRIPT = `
$base = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render'
$last = ''
while ($true) {
  $list = @(Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p.DeviceState -ne 1) { return }
    $props = Get-ItemProperty (Join-Path $_.PSPath 'Properties') -ErrorAction SilentlyContinue
    $fmt = $props.'{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
    [pscustomobject]@{
      id = $_.PSChildName
      name = [string]$props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
      desc = [string]$props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
      fmt = if ($fmt) { [Convert]::ToBase64String([byte[]]$fmt) } else { '' }
    }
  })
  $json = ConvertTo-Json -Compress -InputObject $list
  if ($json -ne $last) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $last = $json }
  Start-Sleep -Seconds 3
}`;

// 레지스트리에 든 WAVEFORMATEX(앞 8바이트는 속성 머리) → { rate, bits, channels, float }
export function parseFormat(b64) {
  if (!b64) return null;
  const b = Buffer.from(b64, 'base64');
  if (b.length < 8 + 16) return null;
  const o = 8;
  const tag = b.readUInt16LE(o);
  const channels = b.readUInt16LE(o + 2);
  const rate = b.readUInt32LE(o + 4);
  let bits = b.readUInt16LE(o + 14);
  let float = tag === 3;
  if (tag === 0xfffe && b.length >= o + 18 + 22) {
    bits = b.readUInt16LE(o + 18) || bits; // 실제 비트 (32비트 칸에 24비트 등)
    float = b.readUInt32LE(o + 24) === 3; // SubFormat GUID 앞 4바이트: 1 = PCM, 3 = float
  }
  return { rate, bits, channels, float };
}

export class AudioDevices extends EventEmitter {
  constructor(dataDir) {
    super();
    this.store = new JsonStore(path.join(dataDir, 'audio-device.json'), { current: null, stack: [] });
    this.devices = [];
    this.current = this.store.data.current;
    this.ready = false;
    this.proc = null;
    this.stopped = false;
  }

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    const full = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ErrorActionPreference = 'Continue'\n${SCRIPT}`;
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')], { windowsHide: true });
    this.proc = p;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const raw = JSON.parse(line);
          this.update(Array.isArray(raw) ? raw : raw ? [raw] : []);
        } catch {
          // 잘린 줄
        }
      }
    });
    p.on('exit', () => {
      this.proc = null;
      if (!this.stopped) setTimeout(() => this.start(), 10_000).unref?.();
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }

  update(list) {
    const now = list.map((d) => ({ id: String(d.id), name: d.name || '알 수 없는 장치', desc: d.desc || '', format: parseFormat(d.fmt) }));
    const before = new Set(this.devices.map((d) => d.id));
    const has = (id) => now.some((d) => d.id === id);
    const appeared = this.ready ? now.filter((d) => !before.has(d.id)) : [];
    const stack = this.store.data.stack.filter(has);
    let cur = this.current;
    if (appeared.length) {
      if (cur && has(cur)) stack.push(cur);
      cur = appeared[appeared.length - 1].id;
    } else if (!cur || !has(cur)) {
      cur = stack.pop() || now[0]?.id || null;
    }
    this.devices = now;
    this.ready = true;
    this.store.data.stack = stack.slice(-10);
    if (cur !== this.current || !this.announced) {
      this.current = cur;
      this.announced = true;
      this.store.data.current = cur;
      this.emit('change', this.info());
    }
    this.store.save(500);
  }

  info() {
    const d = this.devices.find((x) => x.id === this.current);
    return d ? { ...d, active: this.devices.length } : null;
  }

  flush() {
    this.store.flush();
  }
}
