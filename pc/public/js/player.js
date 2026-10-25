// 오디오 재생 + 대기열(queue.js) + Windows 미디어 키(Media Session) + 상태 저장
import { audioUrl, coverUrl, post } from './api.js';
import { PlayQueue, PREV_RESTART_SECONDS } from './queue.js';
import { store } from './store.js';
import { clamp, debounce } from './util.js';

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = new PlayQueue();
    this.loadedId = null;
    this.counted = false;
    this.errorStreak = 0;
    this.pendingSeek = null;
    this.sleep = null; // { at, timer } 또는 { endOfTrack: true }
    this.saveSoon = debounce(() => this.save(), 800);
    this.bindAudio();
    this.bindMediaSession();
    window.addEventListener('pagehide', () => this.save(true));
  }

  get track() {
    return store.tracks.get(this.queue.current) || null;
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  get time() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : this.track?.duration || 0;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // 앱을 다시 열면 듣던 곡·위치·섞인 순서 그대로 (S10)
  restore(saved) {
    if (saved?.queue) this.queue.load(saved.queue);
    const missing = new Set(this.queue.items.filter((it) => !store.tracks.has(it.id)).map((it) => it.id));
    if (missing.size) this.queue.removeIds(missing);
    this.audio.volume = clamp(Number(saved?.volume ?? 1), 0, 1);
    this.audio.muted = !!saved?.muted;
    if (this.queue.current) this.load(this.queue.current, { play: false, at: Number(saved?.positionSec) || 0 });
    this.emit('queue');
    this.emit('state');
  }

  load(id, { play = true, at = 0 } = {}) {
    if (!store.tracks.has(id)) return;
    this.loadedId = id;
    this.counted = false;
    this.pendingSeek = at > 0 ? at : null;
    this.audio.src = audioUrl(id);
    if (play) this.audio.play().catch(() => {});
    this.updateMetadata();
    this.emit('track');
    this.emit('state');
    this.saveSoon();
  }

  // ───── 재생 시작 ─────

  // 목록에서 곡을 눌렀을 때 (S11)
  playList(ids, index, { source } = {}) {
    if (!ids.length) return;
    const keep = store.settings.tapKeepsShuffle !== false;
    this.queue.setQueue(ids, index, { source, shuffle: keep ? undefined : false });
    this.load(this.queue.current);
    this.queueChanged();
  }

  // '셔플 재생' 버튼: 아무 곡에서나 시작
  shufflePlay(ids, source) {
    if (!ids.length) return;
    this.queue.setQueue(ids, -1, { shuffle: true, source });
    this.load(this.queue.current);
    this.queueChanged();
  }

  // '재생' 버튼: 목록 순서대로 처음부터
  playInOrder(ids, source) {
    if (!ids.length) return;
    this.queue.setQueue(ids, 0, { shuffle: false, source });
    this.load(this.queue.current);
    this.queueChanged();
  }

  toggle() {
    if (!this.queue.current) {
      const ids = store.list.map((t) => t.id);
      if (ids.length) this.shufflePlay(ids, { type: 'all', name: '전체 트랙' });
      return;
    }
    if (this.loadedId !== this.queue.current) return this.load(this.queue.current);
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  next() {
    this.step(this.queue.next(), true);
  }

  // 이전: 3초가 지났으면 곡 처음으로, 아니면 이전 곡 (S5: 한 번 = 처음, 두 번 = 이전 곡)
  prev() {
    if (this.time > PREV_RESTART_SECONDS) return this.seek(0);
    this.step(this.queue.prev(), true);
  }

  step(r, play) {
    if (!r) return;
    if (r.restart) {
      this.seek(0);
      if (play) this.audio.play().catch(() => {});
      return;
    }
    this.load(r.id, { play });
    this.emit('queue');
  }

  onEnded() {
    const r = this.queue.next({ auto: true });
    if (this.sleep?.endOfTrack) {
      // 수면 타이머 '현재 곡이 끝나면'
      this.clearSleep();
      if (r && !r.restart) this.load(r.id, { play: false });
      this.emit('slept');
      return;
    }
    if (!r) return this.emit('state');
    if (r.restart) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    this.load(r.id, { play: !r.ended });
    this.emit('queue');
  }

  seek(sec) {
    if (!Number.isFinite(sec)) return;
    const d = this.duration;
    this.audio.currentTime = clamp(sec, 0, d > 0 ? Math.max(0, d - 0.25) : sec);
    this.emit('time');
    this.updatePosition();
  }

  setVolume(v) {
    this.audio.volume = clamp(v, 0, 1);
    if (v > 0) this.audio.muted = false;
    this.saveSoon();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.saveSoon();
  }

  toggleShuffle() {
    const on = this.queue.toggleShuffle();
    this.queueChanged();
    return on;
  }

  cycleRepeat() {
    const m = this.queue.cycleRepeat();
    this.emit('state');
    this.saveSoon();
    return m;
  }

  // ───── 대기열 편집 ─────

  playNext(ids) {
    const wasEmpty = !this.queue.length;
    this.queue.playNext(ids);
    if (wasEmpty) this.load(this.queue.current);
    this.queueChanged();
  }

  addToQueue(ids) {
    const wasEmpty = !this.queue.length;
    this.queue.addToEnd(ids);
    if (wasEmpty) this.load(this.queue.current);
    this.queueChanged();
  }

  jumpTo(index) {
    const id = this.queue.jumpTo(index);
    if (id) this.load(id);
    this.queueChanged();
  }

  moveInQueue(from, to) {
    this.queue.move(from, to);
    this.queueChanged();
  }

  removeFromQueue(key) {
    const wasPlaying = this.playing;
    const { currentChanged } = this.queue.removeKey(key);
    if (currentChanged) this.afterCurrentRemoved(wasPlaying);
    this.queueChanged();
  }

  clearQueue() {
    this.queue.clear();
    this.afterCurrentRemoved(false);
    this.queueChanged();
  }

  afterCurrentRemoved(play) {
    if (this.queue.current) return this.load(this.queue.current, { play });
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.loadedId = null;
    this.emit('track');
  }

  // 폰에서 듣던 대기열 이어 듣기 (S13)
  handoff(h) {
    this.queue.loadExternal(h.ids, h.index, { shuffle: h.shuffle, repeat: h.repeat, source: { type: 'phone', name: '휴대폰에서 이어 듣기' } });
    this.load(this.queue.current, { play: true, at: h.positionSec });
    this.queueChanged();
  }

  // 라이브러리가 바뀌면 사라진 곡을 대기열에서 뺀다
  libraryChanged() {
    const missing = new Set(this.queue.items.filter((it) => !store.tracks.has(it.id)).map((it) => it.id));
    if (!missing.size) return;
    const wasPlaying = this.playing;
    const { currentChanged } = this.queue.removeIds(missing);
    if (currentChanged) this.afterCurrentRemoved(wasPlaying);
    this.queueChanged();
  }

  queueChanged() {
    this.emit('queue');
    this.emit('state');
    this.saveSoon();
  }

  // ───── 수면 타이머 ─────

  setSleep(minutes) {
    this.clearSleep(true);
    if (minutes === 'track') this.sleep = { endOfTrack: true };
    else if (minutes > 0) {
      this.sleep = {
        at: Date.now() + minutes * 60_000,
        timer: setTimeout(() => {
          this.clearSleep();
          this.fadeOutAndPause();
          this.emit('slept');
        }, minutes * 60_000),
      };
    }
    this.emit('sleep');
  }

  clearSleep(silent = false) {
    clearTimeout(this.sleep?.timer);
    this.sleep = null;
    if (!silent) this.emit('sleep');
  }

  fadeOutAndPause() {
    const start = this.audio.volume;
    let i = 0;
    const t = setInterval(() => {
      i++;
      this.audio.volume = start * (1 - i / 20);
      if (i >= 20) {
        clearInterval(t);
        this.audio.pause();
        this.audio.volume = start;
      }
    }, 150);
  }

  // ───── 저장 ─────

  snapshot() {
    return { queue: this.queue.toJSON(), positionSec: this.time, volume: this.audio.volume, muted: this.audio.muted };
  }

  save(beacon = false) {
    const body = JSON.stringify(this.snapshot());
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/state', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
  }

  bindAudio() {
    const a = this.audio;
    a.addEventListener('play', () => this.playbackChanged());
    a.addEventListener('pause', () => {
      this.playbackChanged();
      this.save();
    });
    a.addEventListener('ended', () => this.onEnded());
    a.addEventListener('playing', () => {
      this.errorStreak = 0;
    });
    a.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== null) {
        a.currentTime = Math.min(this.pendingSeek, Math.max(0, (a.duration || this.pendingSeek) - 0.5));
        this.pendingSeek = null;
      }
      const t = this.track;
      if (t && Number.isFinite(a.duration) && (!t.duration || Math.abs(t.duration - a.duration) > 1)) {
        t.duration = a.duration;
        post(`/api/tracks/${t.id}/duration`, { duration: a.duration }).catch(() => {});
      }
      this.emit('time');
      this.updatePosition();
    });
    let lastSave = 0;
    a.addEventListener('timeupdate', () => {
      this.emit('time');
      const t = this.track;
      const d = this.duration;
      // 30초 또는 절반 넘게 들으면 재생 횟수 +1 ('가장 많이 재생', '최근 재생'에 반영)
      if (t && !this.counted && (a.currentTime >= 30 || (d && a.currentTime >= d * 0.5))) {
        this.counted = true;
        post(`/api/tracks/${t.id}/played`).catch(() => {});
      }
      if (!a.paused && Date.now() - lastSave > 5000) {
        lastSave = Date.now();
        this.save();
      }
    });
    a.addEventListener('error', () => {
      if (!this.loadedId || !a.getAttribute('src')) return;
      this.errorStreak++;
      this.emit('playerror', this.track);
      if (this.errorStreak < Math.max(3, Math.min(this.queue.length, 20))) {
        setTimeout(() => {
          const r = this.queue.next({ auto: true });
          if (r && !r.restart && !r.ended) this.load(r.id);
        }, 1200);
      }
    });
    a.addEventListener('volumechange', () => this.emit('volume'));
  }

  playbackChanged() {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    this.updatePosition();
    this.emit('state');
  }

  // Windows 미디어 키·볼륨 팝업의 재생 컨트롤
  bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        // 지원하지 않는 동작
      }
    };
    set('play', () => (this.loadedId ? this.audio.play().catch(() => {}) : this.toggle()));
    set('pause', () => this.audio.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => this.seek(d.seekTime));
    set('seekbackward', (d) => this.seek(this.time - (d.seekOffset || 10)));
    set('seekforward', (d) => this.seek(this.time + (d.seekOffset || 10)));
    set('stop', () => {
      this.audio.pause();
      this.seek(0);
    });
  }

  updateMetadata() {
    const t = this.track;
    if (!t || !('mediaSession' in navigator)) return;
    const cover = store.coverIdFor(t);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: cover ? [{ src: coverUrl(cover) }] : [],
    });
  }

  updatePosition() {
    try {
      const d = this.audio.duration;
      if ('mediaSession' in navigator && Number.isFinite(d) && d > 0) {
        navigator.mediaSession.setPositionState({ duration: d, position: Math.min(this.audio.currentTime, d), playbackRate: this.audio.playbackRate || 1 });
      }
    } catch {
      // 일부 상태에서는 위치를 못 넣는다
    }
  }
}
