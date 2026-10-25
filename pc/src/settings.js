import os from 'node:os';
import path from 'node:path';
import { defaultMusicDir } from './config.js';
import { JsonStore } from './util/jsonfile.js';

export class Settings {
  constructor(dataDir, musicFolders) {
    this.store = new JsonStore(path.join(dataDir, 'settings.json'), {
      musicFolders: [defaultMusicDir()],
      theme: 'system', // system | light | dark
      pcName: os.hostname(),
      tapKeepsShuffle: true, // 목록에서 곡을 누를 때 셔플 유지 (끄면 삼성 도움말의 '목록 순서대로')
    });
    if (musicFolders) {
      this.store.data.musicFolders = musicFolders.map((f) => path.resolve(f));
      this.store.save();
    }
  }

  get data() {
    return this.store.data;
  }

  update(patch = {}) {
    const d = this.data;
    let foldersChanged = false;
    if (Array.isArray(patch.musicFolders)) {
      const next = [];
      for (const f of patch.musicFolders) {
        if (typeof f !== 'string' || !path.isAbsolute(f)) continue;
        const p = path.resolve(f);
        if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
      }
      foldersChanged = next.join('|') !== d.musicFolders.join('|');
      d.musicFolders = next;
    }
    if (['system', 'light', 'dark'].includes(patch.theme)) d.theme = patch.theme;
    if (typeof patch.pcName === 'string' && patch.pcName.trim()) d.pcName = patch.pcName.trim().slice(0, 40);
    if (typeof patch.tapKeepsShuffle === 'boolean') d.tapKeepsShuffle = patch.tapKeepsShuffle;
    this.store.save();
    return { foldersChanged };
  }

  flush() {
    this.store.flush();
  }
}
