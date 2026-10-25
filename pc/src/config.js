// 경로·포트·상수 모음. 테스트에서는 createApp() 옵션으로 덮어쓴다.
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'SyncMusic';
export const APP_VERSION = '0.1.0';
export const PROTOCOL_VERSION = 1;

export const DEFAULT_PORTS = {
  ui: Number(process.env.SYNCMUSIC_UI_PORT) || 47810,        // 이 PC에서만 (127.0.0.1)
  sync: Number(process.env.SYNCMUSIC_SYNC_PORT) || 47811,    // Wi-Fi에 열림, 서명 필수
  discovery: Number(process.env.SYNCMUSIC_DISCOVERY_PORT) || 47812, // UDP 찾기
};

export function defaultDataDir() {
  if (process.env.SYNCMUSIC_DATA) return path.resolve(process.env.SYNCMUSIC_DATA);
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, APP_NAME);
}

export function defaultMusicDir() {
  return path.join(os.homedir(), 'Music');
}

// Edge(Chromium)가 재생할 수 있는 형식만 라이브러리에 넣는다.
export const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

export const PLAYLIST_EXTS = new Set(['.m3u', '.m3u8', '.smpl']);

// 폰에서 받은 음악을 넣는 하위 폴더 (첫 번째 음악 폴더 아래)
export const PHONE_FOLDER_NAME = 'From Phone';

export const UNKNOWN = '<알 수 없음>';
