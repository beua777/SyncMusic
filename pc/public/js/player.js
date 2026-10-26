// 재생: 소리 엔진(audio.js) + 대기열(queue.js) + Windows 미디어 키(Media Session) + 상태 저장
// 그리고 크로스페이드 · A-B 구간 반복 · 무음 건너뛰기 · 음량 평준화·곡 음량 · 재생 속도 · 들은 기록 · 재생목록별 재생 방식
import { audioUrl, coverUrl, post, put } from './api.js';
import { AudioEngine, normalizeGainDb } from './audio.js';
import { PlayQueue, PREV_RESTART_SECONDS } from './queue.js';
import { store } from './store.js';
import { clamp, debounce } from './util.js';

const AUDIO_DEFAULTS = { crossfade: 0, fadeMs: 0, eqOn: false, eqPre: 0, eqBands: [], normalize: 'off', normTarget: -14, rate: 1, keepPitch: true, skipSilence: false, deviceVolume: true, shuffleMode: 'random', shuffleSpread: 0, noRepeatArtist: false };

export class Player extends EventTarget {
  constructor() {
    super();
    this.engine = new AudioEngine();
    this.queue = new PlayQueue();
    this.loadedId = null;
    this.counted = false;
    this.errorStreak = 0;
    this.pendingSeek = null;
    this.sleep = null; // { at, timer } 또는 { endOfTrack: true }
    this.ab = null; // A-B 구간 반복 { a, b }
    this.session = null; // 지금 곡을 들은 기록 { id, start, listened, last }
    this.opts = { ...AUDIO_DEFAULTS };
    this.device = null; // 지금 출력 장치
    this.ticker = 0;
    this.saveSoon = debounce(() => this.save(), 800);
    this.saveDeviceVolume = debounce(() => {
      if (!this.device || !this.opts.deviceVolume) return;
      put('/api/settings', { deviceVolumes: { [this.device.id]: this.engine.vol } }).catch(() => {});
    }, 1500);
    this.bindAudio();
    this.bindMediaSession();
    window.addEventListener('pagehide', () => {
      this.endSession('stop', true);
      this.save(true);
    });
  }

  get audio() {
    return this.engine.el;
  }

  get track() {
    return store.tracks.get(this.queue.current) || null;
  }

  get playing() {
    return this.engine.playing;
  }

  get time() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : this.track?.duration || 0;
  }

  get volume() {
    return this.engine.vol;
  }

  get muted() {
    return this.engine.muted;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ───── 소리 설정 (설정 → 소리, 재생 화면의 사운드 탭) ─────
  applyAudioSettings(a = {}) {
    const prev = this.opts;
    this.opts = { ...AUDIO_DEFAULTS, ...a };
    const e = this.engine;
    e.fadeMs = this.opts.fadeMs;
    e.setEq({ on: this.opts.eqOn, pre: this.opts.eqPre, bands: this.opts.eqBands });
    e.setRate(this.opts.rate, this.opts.keepPitch);
    if (prev.normalize !== this.opts.normalize || prev.normTarget !== this.opts.normTarget) this.applyTrim();
    this.updateShuffleOpts();
    if (prev.shuffleMode !== this.opts.shuffleMode || prev.shuffleSpread !== this.opts.shuffleSpread || prev.noRepeatArtist !== this.opts.noRepeatArtist) {
      if (this.queue.shuffle) this.reshuffle();
    }
    this.emit('audiosettings', this.opts);
  }

  // 곡 음량 = 음량 평준화 + 곡마다 정한 음량
  gainFor(t) {
    if (!t) return 0;
    const albumLufs = this.opts.normalize === 'album' ? albumLoudness(t) : null;
    return normalizeGainDb(t, this.opts.normalize, { target: this.opts.normTarget, albumLufs }) + (t.userGain || 0);
  }

  applyTrim() {
    this.engine.setTrim(this.gainFor(this.track));
  }

  // ───── 셔플 방식: 고르게 · 취향(자주 듣고 즐겨찾기한 곡이 앞쪽에), 다양성, 같은 가수 연속 막기, 셔플 제외 곡 ─────
  updateShuffleOpts() {
    const o = this.opts;
    const tr = (id) => store.tracks.get(id);
    const unknown = (a) => !a || /^<.*>$/.test(a) || /알 수 없음/.test(a);
    this.queue.opts = {
      mode: o.shuffleMode,
      spread: (o.shuffleSpread || 0) / 100,
      noRepeatArtist: o.noRepeatArtist,
      weight: (id) => tasteWeight(tr(id)),
      artist: (id) => {
        const a = tr(id)?.artist;
        return unknown(a) ? null : a;
      },
      album: (id) => {
        const t = tr(id);
        return t ? `${t.album}\u0001${t.albumArtist || t.dir}` : null;
      },
      excluded: (id) => !!tr(id)?.noShuffle,
    };
  }

  // 셔플 설정이 바뀌면 지금 곡은 두고 남은 곡을 다시 섞는다
  reshuffle() {
    this.queue.setShuffle(false);
    this.queue.setShuffle(true);
    this.queueChanged();
  }

  // 앱을 다시 열면 듣던 곡·위치·섞인 순서 그대로 (S10)
  restore(saved) {
    this.updateShuffleOpts();
    if (saved?.queue) this.queue.load(saved.queue);
    const missing = new Set(this.queue.items.filter((it) => !store.tracks.has(it.id)).map((it) => it.id));
    if (missing.size) this.queue.removeIds(missing);
    this.engine.setVolume(clamp(Number(saved?.volume ?? 1), 0, 1));
    this.engine.setMuted(!!saved?.muted);
    if (this.queue.current) this.load(this.queue.current, { play: false, at: Number(saved?.positionSec) || 0, reason: null });
    this.emit('queue');
    this.emit('state');
    this.emit('volume');
  }

  load(id, { play = true, at = 0, reason = 'select' } = {}) {
    if (!store.tracks.has(id)) return;
    if (reason) this.endSession(reason);
    this.clearAB();
    const t = store.tracks.get(id);
    this.loadedId = id;
    this.counted = false;
    const skipStart = this.opts.skipSilence && at <= 0 && t.loud?.start > 0.3 ? t.loud.start : 0;
    this.pendingSeek = at > 0 ? at : skipStart || null;
    this.engine.load(audioUrl(id));
    this.engine.setTrim(this.gainFor(t));
    this.beginSession(id, at);
    if (play) this.engine.play().catch(() => {});
    this.updateMetadata();
    this.emit('track');
    this.emit('state');
    this.saveSoon();
  }

  // ───── 재생 시작 ─────

  // 재생목록마다 정한 재생 방식 (셔플·반복)
  modeFor(source) {
    if (source?.type !== 'playlist') return null;
    return store.playlist(source.id)?.mode || null;
  }

  applyRepeatMode(mode) {
    if (mode?.repeat && mode.repeat !== 'keep') this.queue.setRepeat(mode.repeat);
  }

  // 목록에서 곡을 눌렀을 때 (S11)
  playList(ids, index, { source } = {}) {
    if (!ids.length) return;
    const mode = this.modeFor(source);
    const keep = store.settings.tapKeepsShuffle !== false;
    let shuffle = keep ? undefined : false;
    if (mode?.shuffle === 'on') shuffle = true;
    else if (mode?.shuffle === 'off') shuffle = false;
    this.updateShuffleOpts();
    this.queue.setQueue(ids, index, { source, shuffle });
    this.applyRepeatMode(mode);
    this.load(this.queue.current);
    this.queueChanged();
  }

  // '셔플 재생' 버튼: 아무 곡에서나 시작
  shufflePlay(ids, source) {
    if (!ids.length) return;
    this.updateShuffleOpts();
    this.queue.setQueue(ids, -1, { shuffle: true, source });
    this.applyRepeatMode(this.modeFor(source));
    this.load(this.queue.current);
    this.queueChanged();
  }

  // '재생' 버튼: 목록 순서대로 처음부터 (재생목록이 '셔플 켜기'로 정해져 있으면 셔플)
  playInOrder(ids, source) {
    if (!ids.length) return;
    const mode = this.modeFor(source);
    this.updateShuffleOpts();
    this.queue.setQueue(ids, mode?.shuffle === 'on' ? -1 : 0, { shuffle: mode?.shuffle === 'on', source });
    this.applyRepeatMode(mode);
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
    if (this.playing) this.engine.pause();
    else this.engine.play().catch(() => {});
  }

  next() {
    this.step(this.queue.next(), true, 'next');
  }

  // 이전: 3초가 지났으면 곡 처음으로, 아니면 이전 곡 (S5: 한 번 = 처음, 두 번 = 이전 곡)
  prev() {
    if (this.time > PREV_RESTART_SECONDS) return this.seek(this.opts.skipSilence && this.track?.loud?.start > 0.3 ? this.track.loud.start : 0);
    this.step(this.queue.prev(), true, 'prev');
  }

  step(r, play, reason) {
    if (!r) return;
    if (r.restart) {
      this.seek(0);
      if (play) this.engine.play().catch(() => {});
      return;
    }
    this.load(r.id, { play, reason });
    this.emit('queue');
  }

  onEnded() {
    const r = this.queue.next({ auto: true });
    if (this.sleep?.endOfTrack) {
      // 수면 타이머 '현재 곡이 끝나면'
      this.clearSleep();
      if (r && !r.restart) this.load(r.id, { play: false, reason: 'ended' });
      this.emit('slept');
      return;
    }
    if (!r) return this.emit('state');
    if (r.restart) {
      this.endSession('ended');
      this.beginSession(r.id, 0);
      this.counted = false;
      this.audio.currentTime = this.opts.skipSilence && this.track?.loud?.start > 0.3 ? this.track.loud.start : 0;
      this.engine.play().catch(() => {});
      return;
    }
    this.load(r.id, { play: !r.ended, reason: 'ended' });
    this.emit('queue');
  }

  // ───── 크로스페이드 · 무음 건너뛰기 · A-B 반복 (재생 중 0.1초마다 확인) ─────

  // 곡이 '실제로' 끝나는 시각: 무음 건너뛰기를 켰으면 끝의 무음을 뺀다
  effectiveEnd(t = this.track) {
    const d = this.duration;
    if (this.opts.skipSilence && t?.loud?.end > 1 && t.loud.end < d - 0.3) return t.loud.end;
    return d;
  }

  tick() {
    const t = this.track;
    const a = this.audio;
    if (!t || a.paused) return;
    const time = a.currentTime;
    // A-B 구간 반복
    if (Number.isFinite(this.ab?.b) && time >= this.ab.b) {
      a.currentTime = this.ab.a;
      return;
    }
    // 가운데 긴 무음 건너뛰기
    if (this.opts.skipSilence && t.loud?.gaps?.length) {
      const g = t.loud.gaps.find(([s, e]) => time > s + 0.15 && time < e - 0.4);
      if (g) {
        a.currentTime = g[1];
        return;
      }
    }
    const end = this.effectiveEnd(t);
    const remain = end - time;
    // 크로스페이드: 다음 곡이 있고, 곡이 충분히 길고, A-B 반복·수면 타이머(곡 끝)가 아니면.
    // 페이드는 실제 시간으로 흐르니 남은 시간도 재생 속도로 나눠서 본다 (1.5배속이면 남은 6초 = 실제 4초)
    const xf = this.opts.crossfade;
    const left = remain / (a.playbackRate || 1);
    if (xf > 0 && !this.ab && !this.sleep?.endOfTrack && this.engine.canCrossfade() && end > xf * 2 + 2 && left <= xf && left > 0.2 && this.queue.hasAutoNext()) {
      this.startCrossfade(Math.min(xf, left));
      return;
    }
    // 끝 무음: 크로스페이드가 없으면 거기서 곡을 끝낸 것으로
    if (end < this.duration - 0.3 && remain <= 0.05) {
      a.pause();
      this.onEnded();
    }
  }

  startCrossfade(secs) {
    const r = this.queue.next({ auto: true });
    if (!r || r.restart || r.ended) return;
    const t = store.tracks.get(r.id);
    if (!t) return;
    this.endSession('crossfade');
    this.clearAB();
    this.loadedId = r.id;
    this.counted = false;
    this.pendingSeek = null;
    const start = this.opts.skipSilence && t.loud?.start > 0.3 ? t.loud.start : 0;
    this.engine.crossfade(audioUrl(r.id), secs, { trimDb: this.gainFor(t), startAt: start });
    this.beginSession(r.id, start);
    this.updateMetadata();
    this.emit('track');
    this.emit('queue');
    this.emit('state');
    this.saveSoon();
  }

  // A-B 구간 반복: 버튼 하나로 A 정하기 → B 정하기(반복 시작) → 끄기
  cycleAB() {
    const now = this.time;
    if (!this.ab) this.ab = { a: now, b: null };
    else if (this.ab.b === null) {
      if (now <= this.ab.a + 0.5) return this.ab;
      this.ab = { a: this.ab.a, b: now };
      this.audio.currentTime = this.ab.a;
    } else this.ab = null;
    this.emit('ab', this.ab);
    return this.ab;
  }

  clearAB() {
    if (!this.ab) return;
    this.ab = null;
    this.emit('ab', null);
  }

  seek(sec) {
    if (!Number.isFinite(sec)) return;
    const d = this.duration;
    this.audio.currentTime = clamp(sec, 0, d > 0 ? Math.max(0, d - 0.25) : sec);
    if (this.session) this.session.last = this.audio.currentTime;
    this.emit('time');
    this.updatePosition();
  }

  seekBy(delta) {
    this.seek(this.time + delta);
  }

  setVolume(v) {
    this.engine.setVolume(v);
    this.emit('volume');
    this.saveSoon();
    this.saveDeviceVolume();
  }

  toggleMute() {
    this.engine.setMuted(!this.engine.muted);
    this.emit('volume');
    this.saveSoon();
  }

  // 출력 장치가 바뀌면(헤드폰 연결 등) 그 장치에서 쓰던 음량으로
  setDevice(dev) {
    const prev = this.device;
    this.device = dev;
    this.emit('device', dev);
    if (!dev || !this.opts.deviceVolume || prev?.id === dev.id) return;
    const saved = store.settings.deviceVolumes?.[dev.id];
    if (Number.isFinite(saved)) {
      this.engine.setVolume(saved);
      this.emit('volume');
      this.saveSoon();
    }
  }

  setRate(rate) {
    this.opts.rate = clamp(Math.round(Number(rate) * 20) / 20, 0.5, 2);
    this.engine.setRate(this.opts.rate, this.opts.keepPitch);
    this.emit('audiosettings', this.opts);
    return this.opts.rate;
  }

  toggleShuffle() {
    this.updateShuffleOpts();
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
    this.endSession('stop');
    this.engine.stop();
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
    if (missing.size) {
      const wasPlaying = this.playing;
      const { currentChanged } = this.queue.removeIds(missing);
      if (currentChanged) this.afterCurrentRemoved(wasPlaying);
      this.queueChanged();
    }
    this.applyTrim(); // 곡 음량·분석 결과가 바뀌었을 수 있음
  }

  queueChanged() {
    this.emit('queue');
    this.emit('state');
    this.saveSoon();
  }

  // ───── 들은 기록 (통계): 곡마다 실제로 들은 시간, 끝까지 들었는지, 30초 전에 넘겼는지 ─────

  beginSession(id, at = 0) {
    this.session = { id, start: Date.now(), listened: 0, last: at || 0 };
  }

  endSession(reason, beacon = false) {
    const s = this.session;
    this.session = null;
    if (!s || s.listened < 1) return;
    const t = store.tracks.get(s.id);
    const nearEnd = t?.duration ? s.last >= this.effectiveEnd(t) - 8 : false;
    const completed = reason === 'ended' || reason === 'crossfade' || nearEnd;
    const skipped = !completed && (reason === 'next' || reason === 'select') && s.listened < 30;
    const body = { id: s.id, start: s.start, listened: Math.round(s.listened), completed, skipped };
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/history', new Blob([JSON.stringify(body)], { type: 'application/json' }));
    else post('/api/history', body).catch(() => {});
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
          this.engine.fadeOutAndPause(3000).then(() => this.emit('slept'));
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

  // ───── 저장 ─────

  snapshot() {
    return { queue: this.queue.toJSON(), positionSec: this.time, volume: this.engine.vol, muted: this.engine.muted, playing: this.playing, trackId: this.loadedId };
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
    const e = this.engine;
    e.on('play', () => {
      this.playbackChanged();
      clearInterval(this.ticker);
      this.ticker = setInterval(() => this.tick(), 100);
    });
    e.on('pause', () => {
      clearInterval(this.ticker);
      this.playbackChanged();
      this.save();
    });
    e.addEventListener('pausing', () => this.playbackChanged());
    e.on('ended', () => {
      clearInterval(this.ticker);
      this.onEnded();
    });
    e.on('playing', () => {
      this.errorStreak = 0;
    });
    e.on('loadedmetadata', () => {
      const a = this.audio;
      if (this.pendingSeek !== null) {
        a.currentTime = Math.min(this.pendingSeek, Math.max(0, (a.duration || this.pendingSeek) - 0.5));
        if (this.session) this.session.last = a.currentTime;
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
    e.on('timeupdate', () => {
      const a = this.audio;
      this.emit('time');
      // 들은 시간: 정상적으로 흘러간 만큼만 (건너뛴 부분은 빼고)
      const s = this.session;
      if (s) {
        const d = a.currentTime - s.last;
        if (d > 0 && d < 2.5) s.listened += d / (a.playbackRate || 1);
        s.last = a.currentTime;
      }
      const t = this.track;
      const dur = this.duration;
      // 30초 또는 절반 넘게 들으면 재생 횟수 +1 ('가장 많이 재생', '최근 재생'에 반영)
      if (t && !this.counted && (a.currentTime >= 30 || (dur && a.currentTime >= dur * 0.5))) {
        this.counted = true;
        post(`/api/tracks/${t.id}/played`).catch(() => {});
      }
      if (!a.paused && Date.now() - lastSave > 5000) {
        lastSave = Date.now();
        this.save();
      }
    });
    e.on('error', () => {
      const a = this.audio;
      if (!this.loadedId || !a.getAttribute('src')) return;
      this.errorStreak++;
      const t = this.track;
      this.emit('playerror', t);
      post('/api/errors', { source: 'play', message: `재생할 수 없는 파일: ${t?.title || this.loadedId}`, detail: `${a.error?.message || ''} (코드 ${a.error?.code ?? '?'})`, context: { path: t?.path } }).catch(() => {});
      if (this.errorStreak < Math.max(3, Math.min(this.queue.length, 20))) {
        setTimeout(() => {
          const r = this.queue.next({ auto: true });
          if (r && !r.restart && !r.ended) this.load(r.id, { reason: null });
        }, 1200);
      }
    });
  }

  playbackChanged() {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
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
    set('play', () => (this.loadedId ? this.engine.play().catch(() => {}) : this.toggle()));
    set('pause', () => this.engine.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => this.seek(d.seekTime));
    set('seekbackward', (d) => this.seek(this.time - (d.seekOffset || 10)));
    set('seekforward', (d) => this.seek(this.time + (d.seekOffset || 10)));
    set('stop', () => {
      this.engine.pause();
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

// 앨범의 소리 세기: 잰 곡들의 평균 (에너지 평균)
function albumLoudness(t) {
  const a = store.albumOf(t);
  const vals = (a?.tracks || []).map((x) => x.loud?.lufs).filter(Number.isFinite);
  if (!vals.length) return null;
  return 10 * Math.log10(vals.reduce((s, v) => s + 10 ** (v / 10), 0) / vals.length);
}

// 취향 셔플의 무게: 즐겨찾기·많이 들은 곡은 크게, 자주 넘긴 곡·방금 들은 곡은 작게
export function tasteWeight(t, now = Date.now()) {
  if (!t) return 1;
  let w = 1 + Math.min(3, Math.log2(1 + (t.playCount || 0)));
  if (store.isFavorite?.(t.id)) w += 2;
  if (t.skips) w /= 1 + Math.min(4, t.skips * 0.5);
  const days = t.lastPlayed ? (now - t.lastPlayed) / 86_400_000 : 999;
  if (days < 1) w *= 0.3;
  else if (days < 3) w *= 0.6;
  return w;
}
