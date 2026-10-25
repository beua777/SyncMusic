import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Windows 기능 (폴더 선택 창, 탐색기에서 보기, 바로가기·자동 실행)
// PowerShell은 서명된 시스템 프로그램이라 Smart App Control에 막히지 않는다.

function runPowerShell(script, { env = {}, timeout = 10 * 60_000 } = {}) {
  const full = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ErrorActionPreference = 'Stop'\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const p = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, windowsHide: true },
    );
    const out = [];
    const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    const timer = setTimeout(() => p.kill(), timeout);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8').trim());
      else reject(new Error(Buffer.concat(err).toString('utf8').trim() || `PowerShell 종료 코드 ${code}`));
    });
  });
}

export async function pickFolder(initialDir) {
  if (process.platform !== 'win32') return null;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:SM_TITLE
$d.ShowNewFolderButton = $true
if ($env:SM_INITIAL -and (Test-Path -LiteralPath $env:SM_INITIAL)) { $d.SelectedPath = $env:SM_INITIAL }
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
$owner.Dispose()`;
  const out = await runPowerShell(script, { env: { SM_TITLE: '음악 폴더를 선택하세요', SM_INITIAL: initialDir || '' } });
  return out || null;
}

export function revealInExplorer(file) {
  if (process.platform !== 'win32') return;
  spawn('explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

export function createShortcut(lnkPath, { target, args = '', cwd = '', icon = '', windowStyle = 1 }) {
  const script = `
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($env:SM_LNK)
$s.TargetPath = $env:SM_TARGET
$s.Arguments = $env:SM_ARGS
$s.WorkingDirectory = $env:SM_CWD
$s.WindowStyle = [int]$env:SM_STYLE
if ($env:SM_ICON) { $s.IconLocation = $env:SM_ICON }
$s.Description = 'SyncMusic'
$s.Save()`;
  return runPowerShell(script, {
    env: { SM_LNK: lnkPath, SM_TARGET: target, SM_ARGS: args, SM_CWD: cwd, SM_ICON: icon, SM_STYLE: String(windowStyle) },
    timeout: 60_000,
  });
}

export function startupShortcutPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'SyncMusic.lnk');
}

export function desktopShortcutPath() {
  return path.join(os.homedir(), 'Desktop', 'SyncMusic.lnk');
}

export function getAutostart() {
  return fs.existsSync(startupShortcutPath());
}

// 로그인할 때 서버만 백그라운드로 켜서, 창을 안 열어도 폰 동기화가 되게 한다
export async function setAutostart(enabled, { launcher, icon }) {
  const lnk = startupShortcutPath();
  if (!enabled) {
    fs.rmSync(lnk, { force: true });
    return false;
  }
  await createShortcut(lnk, { target: process.execPath, args: `"${launcher}" --background`, cwd: path.dirname(launcher), icon, windowStyle: 7 });
  return true;
}

export async function createDesktopShortcut({ launcher, icon }) {
  const lnk = desktopShortcutPath();
  await createShortcut(lnk, { target: process.execPath, args: `"${launcher}"`, cwd: path.dirname(launcher), icon, windowStyle: 7 });
  return lnk;
}
