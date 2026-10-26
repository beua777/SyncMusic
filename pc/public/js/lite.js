// 저사양 모드 (설정 → 성능): 끄기 · 켜기 · 배터리일 때만.
// 켜져 있으면 디자인에서 고른 값은 그대로 두고, 화면에 쓰는 값만 가볍게 바꾼다 (끄면 그대로 돌아옴)
import { store } from './store.js';

let battery = null; // BatteryManager (노트북에서 전원 연결 여부)
const listeners = new Set();

export const liteSetting = () => store.settings.power?.lite || 'off';
export const batteryKnown = () => !!battery;
export const onBattery = () => !!battery && !battery.charging;
export const liteActive = () => liteSetting() === 'on' || (liteSetting() === 'battery' && onBattery());

// 저사양 모드에서 실제로 쓰는 디자인 값: 화면 효과·박자 반응·화면 아래 스펙트럼·미니 스펙트럼을 끄고,
// 움직이거나 무거운 배경(무지개·무지개 단색·커버 흐리게)은 앨범 색으로, 스펙트럼은 1초에 15번만
export function liteDesign(d) {
  return {
    ...d,
    fps: 15,
    effect: 'off',
    coverBeat: 'off',
    spectrumBottom: 'off',
    spectrumMini: false,
    npBg: ['rainbow', 'cycle', 'blur'].includes(d.npBg) ? 'album' : d.npBg,
  };
}

// '배터리일 때만'인데 전원을 꽂거나 뽑으면 알려 준다 (켜졌으면 true)
export function onLiteChange(fn) {
  listeners.add(fn);
}

export async function initLite() {
  try {
    // 배터리 상태를 못 읽는 환경이면 1초 안에 포기 ('배터리일 때만'은 꺼진 것으로)
    battery = (await Promise.race([navigator.getBattery?.(), new Promise((r) => setTimeout(r, 1000))])) || null;
  } catch {
    battery = null;
  }
  battery?.addEventListener('chargingchange', () => {
    if (liteSetting() !== 'battery') return;
    for (const fn of listeners) fn(liteActive());
  });
}
