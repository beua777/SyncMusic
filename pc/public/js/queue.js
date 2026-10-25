// 삼성 뮤직 규칙을 재현하는 재생 대기열 (docs/PLAN.md 5장, test/queue.test.js가 검증)
//
//   items : 원래 목록 순서   [{ key, id }]   key는 대기열 안에서만 쓰는 고유 번호 (같은 곡이 두 번 들어가도 구분)
//   order : 실제 재생 순서   [key]           셔플이 꺼져 있으면 items와 같은 순서
//   pos   : order에서 지금 곡의 위치
//
// 화면(UI)과 Node 테스트가 같은 파일을 쓴다. DOM에 의존하지 않는다.

export const REPEAT_MODES = ['off', 'all', 'one']; // 반복 안 함 → 전체 반복 → 한 곡 반복 (S4)
export const PREV_RESTART_SECONDS = 3; // 이전 버튼: 3초가 지났으면 처음으로 (S5)

export class PlayQueue {
  constructor(state = null, { seed } = {}) {
    this.items = [];
    this.order = [];
    this.pos = -1;
    this.shuffle = false;
    this.repeat = 'off';
    this.nextKey = 1;
    this.source = null;
    this.rngState = (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
    this.map = new Map();
    if (state) this.load(state);
  }

  // ───── 상태 읽기 ─────

  get length() {
    return this.items.length;
  }

  get currentKey() {
    return this.order[this.pos] ?? null;
  }

  get current() {
    const k = this.currentKey;
    return k === null ? null : (this.map.get(k)?.id ?? null);
  }

  // 재생 순서 화면(S7): 지나간 곡 + 지금 곡 + 다음 곡을 실제 재생 순서대로
  view() {
    return this.order.map((key, index) => ({ key, id: this.map.get(key).id, index, current: index === this.pos }));
  }

  upcoming() {
    return this.order.slice(this.pos + 1).map((key) => ({ key, id: this.map.get(key).id }));
  }

  // ───── 대기열 만들기 ─────

  // 목록에서 곡을 눌렀을 때 (S11). startIndex가 -1이면 '셔플 재생' 버튼: 아무 곡에서나 시작
  setQueue(ids, startIndex = 0, { shuffle, source } = {}) {
    this.items = ids.map((id) => ({ key: this.nextKey++, id }));
    this.reindex();
    if (typeof shuffle === 'boolean') this.shuffle = shuffle;
    this.source = source ?? null;
    if (!this.items.length) {
      this.order = [];
      this.pos = -1;
      return null;
    }
    const keys = this.items.map((it) => it.key);
    if (this.shuffle) {
      if (startIndex < 0) {
        this.order = this.shuffleKeys(keys);
      } else {
        const first = keys[clamp(startIndex, 0, keys.length - 1)];
        this.order = [first, ...this.shuffleKeys(keys.filter((k) => k !== first))];
      }
      this.pos = 0;
    } else {
      this.order = keys;
      this.pos = startIndex < 0 ? Math.floor(this.random() * keys.length) : clamp(startIndex, 0, keys.length - 1);
    }
    return this.current;
  }

  // 폰에서 받은 대기열 (S13): 받은 순서를 섞지 않고 그대로 쓴다
  loadExternal(ids, index = 0, { shuffle = false, repeat, source = null } = {}) {
    this.items = ids.map((id) => ({ key: this.nextKey++, id }));
    this.order = this.items.map((it) => it.key);
    this.pos = this.items.length ? clamp(index, 0, this.items.length - 1) : -1;
    this.shuffle = !!shuffle;
    if (repeat) this.setRepeat(repeat);
    this.source = source;
    this.reindex();
    return this.current;
  }

  // ───── 셔플·반복 ─────

  // 셔플 켜기(S2): 지금 곡은 그대로 두고 나머지를 섞는다 / 끄기(S3): 지금 곡의 원래 위치부터 목록 순서대로
  setShuffle(on) {
    on = !!on;
    if (on === this.shuffle) return;
    this.shuffle = on;
    const cur = this.currentKey;
    const keys = this.items.map((it) => it.key);
    if (on) {
      const rest = keys.filter((k) => k !== cur);
      this.order = cur === null ? this.shuffleKeys(rest) : [cur, ...this.shuffleKeys(rest)];
      this.pos = this.order.length ? 0 : -1;
    } else {
      this.order = keys;
      this.pos = cur === null ? (keys.length ? 0 : -1) : keys.indexOf(cur);
    }
  }

  toggleShuffle() {
    this.setShuffle(!this.shuffle);
    return this.shuffle;
  }

  setRepeat(mode) {
    if (REPEAT_MODES.includes(mode)) this.repeat = mode;
  }

  cycleRepeat() {
    this.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(this.repeat) + 1) % REPEAT_MODES.length];
    return this.repeat;
  }

  // ───── 다음·이전 ─────
  // 돌려주는 값: { id, restart?, wrapped?, ended? }  (대기열이 비었으면 null)

  next({ auto = false } = {}) {
    if (!this.order.length) return null;
    // 한 곡 반복은 곡이 '끝나서' 넘어갈 때만 (S6). 다음 버튼을 누르면 다음 곡으로 간다
    if (auto && this.repeat === 'one') return { id: this.current, restart: true };
    if (this.pos < this.order.length - 1) {
      this.pos++;
      return { id: this.current };
    }
    // 목록 끝
    this.wrapAround();
    if (auto && this.repeat === 'off') return { id: this.current, ended: true }; // 반복 안 함: 한 번 듣고 멈춤 (S8)
    return { id: this.current, wrapped: true };
  }

  // 이전 곡으로 (3초 규칙은 player.js가 재생 시간을 보고 판단한다)
  prev() {
    if (!this.order.length) return null;
    if (this.pos > 0) {
      this.pos--;
      return { id: this.current };
    }
    if (this.repeat === 'all' && !this.shuffle && this.order.length > 1) {
      this.pos = this.order.length - 1;
      return { id: this.current, wrapped: true };
    }
    return { id: this.current, restart: true };
  }

  // 한 바퀴가 끝나면: 셔플 중이면 다시 섞되 방금 들은 곡이 첫 곡이 되지 않게 (S9)
  wrapAround() {
    if (this.shuffle && this.order.length > 1) {
      const last = this.currentKey;
      const order = this.shuffleKeys(this.items.map((it) => it.key));
      if (order[0] === last) {
        const j = 1 + Math.floor(this.random() * (order.length - 1));
        [order[0], order[j]] = [order[j], order[0]];
      }
      this.order = order;
    }
    this.pos = 0;
  }

  // 재생 순서 화면에서 곡을 눌렀을 때
  jumpTo(orderIndex) {
    if (orderIndex < 0 || orderIndex >= this.order.length) return null;
    this.pos = orderIndex;
    return this.current;
  }

  jumpToKey(key) {
    return this.jumpTo(this.order.indexOf(key));
  }

  // ───── 대기열 편집 (S12) ─────

  // 다음에 재생: 지금 곡 바로 뒤에 (셔플 중이면 섞인 순서에서도 바로 다음)
  playNext(ids) {
    if (!ids.length) return;
    if (!this.items.length) return void this.setQueue(ids, 0);
    const added = ids.map((id) => ({ key: this.nextKey++, id }));
    const itemIdx = this.items.findIndex((it) => it.key === this.currentKey);
    this.items.splice(itemIdx + 1, 0, ...added);
    this.order.splice(this.pos + 1, 0, ...added.map((it) => it.key));
    this.reindex();
  }

  // 재생 대기열에 추가: 맨 끝에
  addToEnd(ids) {
    if (!ids.length) return;
    if (!this.items.length) return void this.setQueue(ids, 0);
    const added = ids.map((id) => ({ key: this.nextKey++, id }));
    this.items.push(...added);
    this.order.push(...added.map((it) => it.key));
    this.reindex();
  }

  // 재생 순서 화면에서 끌어서 순서 바꾸기 (S7)
  move(from, to) {
    const n = this.order.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    const cur = this.currentKey;
    const [k] = this.order.splice(from, 1);
    this.order.splice(to, 0, k);
    this.pos = this.order.indexOf(cur);
    if (!this.shuffle) this.items = this.order.map((key) => this.map.get(key)); // 셔플이 꺼져 있으면 원래 순서도 같이
  }

  // 지우기. 지금 곡을 지우면 다음 곡이 지금 곡이 된다
  removeKey(key) {
    const oi = this.order.indexOf(key);
    if (oi < 0) return { currentChanged: false };
    const wasCurrent = oi === this.pos;
    this.order.splice(oi, 1);
    this.items = this.items.filter((it) => it.key !== key);
    if (oi < this.pos) this.pos--;
    if (!this.order.length) this.pos = -1;
    else if (this.pos >= this.order.length) this.pos = this.order.length - 1;
    this.reindex();
    return { currentChanged: wasCurrent };
  }

  // 라이브러리에서 사라진 곡들 정리
  removeIds(idSet) {
    let currentChanged = false;
    for (const it of [...this.items]) if (idSet.has(it.id)) currentChanged = this.removeKey(it.key).currentChanged || currentChanged;
    return { currentChanged };
  }

  replaceId(oldId, newId) {
    for (const it of this.items) if (it.id === oldId) it.id = newId;
  }

  clear() {
    this.items = [];
    this.order = [];
    this.pos = -1;
    this.source = null;
    this.reindex();
  }

  // ───── 저장·복원 (S10: 다시 켜도 섞인 순서와 위치 유지) ─────

  toJSON() {
    return {
      v: 1,
      items: this.items.map((it) => [it.key, it.id]),
      order: this.order.slice(),
      pos: this.pos,
      shuffle: this.shuffle,
      repeat: this.repeat,
      nextKey: this.nextKey,
      rngState: this.rngState,
      source: this.source,
    };
  }

  load(s) {
    if (!s || !Array.isArray(s.items)) return;
    this.items = s.items
      .filter((x) => Array.isArray(x) && Number.isInteger(x[0]) && typeof x[1] === 'string')
      .map(([key, id]) => ({ key, id }));
    this.reindex();
    // 저장된 순서가 깨져 있으면 고쳐서 쓴다
    const seen = new Set();
    const order = (Array.isArray(s.order) ? s.order : []).filter((k) => this.map.has(k) && !seen.has(k) && seen.add(k));
    for (const it of this.items) if (!seen.has(it.key)) order.push(it.key);
    this.shuffle = !!s.shuffle;
    this.order = this.shuffle ? order : this.items.map((it) => it.key);
    this.pos = this.order.length ? clamp(Number.isInteger(s.pos) ? s.pos : 0, 0, this.order.length - 1) : -1;
    if (!this.shuffle && Number.isInteger(s.pos) && s.order?.[s.pos] !== undefined) {
      const k = s.order[s.pos];
      if (this.map.has(k)) this.pos = this.order.indexOf(k);
    }
    this.setRepeat(s.repeat);
    const maxKey = this.items.reduce((m, it) => Math.max(m, it.key), 0);
    this.nextKey = Math.max(Number(s.nextKey) || 1, maxKey + 1);
    if (Number.isInteger(s.rngState)) this.rngState = s.rngState >>> 0;
    this.source = s.source ?? null;
  }

  // ───── 내부 ─────

  reindex() {
    this.map = new Map(this.items.map((it) => [it.key, it]));
  }

  // mulberry32: 시드가 있는 난수 (테스트 재현·재시작 후에도 이어지는 난수열)
  random() {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Fisher–Yates: 모든 순서가 같은 확률, 한 바퀴 동안 중복 없음 (S1)
  shuffleKeys(keys) {
    const a = keys.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
