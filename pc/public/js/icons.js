// 직접 그린 아이콘 (24×24, 선 굵기는 CSS의 svg.i)
const P = {
  play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.1-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6.3" y="5" width="3.8" height="14" rx="1.3" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.8" height="14" rx="1.3" fill="currentColor" stroke="none"/>',
  next: '<path d="M5.5 6.3v11.4a.9.9 0 0 0 1.4.74l8.1-5.7a.9.9 0 0 0 0-1.48L6.9 5.56a.9.9 0 0 0-1.4.74z" fill="currentColor" stroke="none"/><rect x="16.4" y="5.5" width="2.5" height="13" rx="1.25" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18.5 6.3v11.4a.9.9 0 0 1-1.4.74L9 12.74a.9.9 0 0 1 0-1.48l8.1-5.7a.9.9 0 0 1 1.4.74z" fill="currentColor" stroke="none"/><rect x="5.1" y="5.5" width="2.5" height="13" rx="1.25" fill="currentColor" stroke="none"/>',
  shuffle:
    '<path d="M3 7h3c1.7 0 3.2.85 4.1 2.25l3.8 5.5C14.8 16.15 16.3 17 18 17h2.5"/><path d="M3 17h3c1.2 0 2.3-.45 3.1-1.25"/><path d="M14 8.25C14.8 7.45 15.9 7 17.1 7h3.4"/><path d="M18.2 4.2 21 7l-2.8 2.8"/><path d="M18.2 14.2 21 17l-2.8 2.8"/>',
  shuffleOff:
    '<path d="M3 7h3c1.7 0 3.2.85 4.1 2.25l3.8 5.5C14.8 16.15 16.3 17 18 17h2.5"/><path d="M3 17h3c1.2 0 2.3-.45 3.1-1.25"/><path d="M14 8.25C14.8 7.45 15.9 7 17.1 7h3.4"/><path d="M18.2 4.2 21 7l-2.8 2.8"/><path d="M18.2 14.2 21 17l-2.8 2.8"/><path d="M4 3.5 20 20.5"/>',
  repeat:
    '<path d="M17 2.8 20 5.8l-3 3"/><path d="M4 11.2v-.4a5 5 0 0 1 5-5h11"/><path d="M7 21.2l-3-3 3-3"/><path d="M20 12.8v.4a5 5 0 0 1-5 5H4"/>',
  repeatOne:
    '<path d="M17 2.8 20 5.8l-3 3"/><path d="M4 11.2v-.4a5 5 0 0 1 5-5h11"/><path d="M7 21.2l-3-3 3-3"/><path d="M20 12.8v.4a5 5 0 0 1-5 5H4"/><path d="M11 10.2 12.6 9v6"/>',
  // 삼성 뮤직의 '반복 안 함'(A가 화살표 위에) 모양
  repeatOff: '<path d="M3.5 18h15"/><path d="M15.5 15l3 3-3 3"/><path d="M7.5 12 11 3.5l3.5 8.5"/><path d="M8.8 9h4.4"/>',
  heart: '<path d="M12 20.2s-7.6-4.6-7.6-10.4A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.6 2.5c0 5.8-7.6 10.4-7.6 10.4z"/>',
  heartFill: '<path d="M12 20.2s-7.6-4.6-7.6-10.4A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.6 2.5c0 5.8-7.6 10.4-7.6 10.4z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  queue: '<path d="M4 6h11M4 11h11M4 16h6"/><path d="M18.5 9.5v8.2"/><circle cx="16.3" cy="17.8" r="2.2"/><path d="M18.5 9.5l2.5 1"/>',
  lyrics: '<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-7.5l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z"/><path d="M8 9h8M8 12h5"/>',
  search: '<circle cx="11" cy="11" r="6.6"/><path d="M20 20l-4.3-4.3"/>',
  more: '<circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  back: '<path d="M19.5 12h-15"/><path d="M10.5 6l-6 6 6 6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  drag: '<path d="M5 8.5h14M5 12h14M5 15.5h14"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.7l2.1 2.2h7.2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3.5 17V7.5a2 2 0 0 1 2-2h3.7l2.1 2.2h6.2a2 2 0 0 1 2 2v1"/><path d="M3.5 17l2.2-5.6a1.5 1.5 0 0 1 1.4-.9h13.1a1 1 0 0 1 .9 1.4L19 17.8a1.5 1.5 0 0 1-1.4 1.2H5.5a2 2 0 0 1-2-2z"/>',
  album: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.4"/>',
  artist: '<circle cx="12" cy="8.4" r="3.9"/><path d="M4.4 20.2a7.6 7.6 0 0 1 15.2 0"/>',
  note: '<path d="M9 17.5V6.6l10-2.1v10.8"/><circle cx="6.6" cy="17.5" r="2.5"/><circle cx="16.6" cy="15.3" r="2.5"/>',
  settings: '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2.2"/><circle cx="9" cy="16.5" r="2.2"/>',
  phone: '<rect x="6.8" y="2.8" width="10.4" height="18.4" rx="2.6"/><path d="M10.8 18.1h2.4"/>',
  sync: '<path d="M19.8 10.5A8 8 0 0 0 5.5 7.4L4 9"/><path d="M4 4.6V9h4.4"/><path d="M4.2 13.5a8 8 0 0 0 14.3 3.1L20 15"/><path d="M20 19.4V15h-4.4"/>',
  volume: '<path d="M4 9.6v4.8h3.4L12 18.5v-13L7.4 9.6z"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  volumeOff: '<path d="M4 9.6v4.8h3.4L12 18.5v-13L7.4 9.6z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  moon: '<path d="M19.8 14.6A8.2 8.2 0 1 1 9.4 4.2a6.6 6.6 0 0 0 10.4 10.4z"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l3 2"/>',
  bars: '<path d="M5.5 19.5v-7M10 19.5v-13M14.5 19.5v-9M19 19.5v-5"/>',
  history: '<path d="M3.8 12.2a8.4 8.4 0 1 0 2.5-6.1"/><path d="M3.4 4.4v4.2h4.2"/><path d="M12 8v4.2l2.8 1.6"/>',
  import: '<path d="M12 4v10.5"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  export: '<path d="M12 15V4.5"/><path d="M7.5 9 12 4.5 16.5 9"/><path d="M5 19.5h14"/>',
  edit: '<path d="M4.5 19.5h4l10.3-10.3a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4.5 15.5z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M6.8 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4l.9-12"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  sort: '<path d="M7 4.5v15M4 16.5l3 3 3-3"/><path d="M13.5 7h6.5M13.5 12h4.5M13.5 17h2.5"/>',
  playNext: '<path d="M4 6h10M4 11h10M4 16h5"/><path d="M14 13.5v6l5-3z" fill="currentColor"/>',
  addQueue: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M18 13v7M14.5 16.5h7"/>',
  power: '<path d="M12 3.5v8"/><path d="M7 6.5a7 7 0 1 0 10 0"/>',
  desktop: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="1" fill="currentColor" stroke="none"/>',
  wifi: '<path d="M3 9a13 13 0 0 1 18 0"/><path d="M6.2 12.4a8.5 8.5 0 0 1 11.6 0"/><path d="M9.3 15.7a4 4 0 0 1 5.4 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
  palette:
    '<path d="M12 3.6a8.4 8.4 0 1 0 0 16.8c1.1 0 1.8-.7 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7h2a4.3 4.3 0 0 0 4.3-4.3c0-3.7-3.9-6.7-8.9-6.7z"/><circle cx="7.6" cy="11.3" r="1.25" fill="currentColor" stroke="none"/><circle cx="10.3" cy="7.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="15" cy="7.7" r="1.25" fill="currentColor" stroke="none"/>',
  vizMirror: '<path d="M5 10v4M9.5 6v12M14 8.5v7M18.5 10.5v3"/>',
  vizWave: '<path d="M3 14.5c2 0 2.6-6.5 4.8-6.5s2.9 9 5.2 9 2.7-6 4.9-6c1.4 0 2 1.4 3.1 1.4"/>',
  vizCircle:
    '<circle cx="12" cy="12" r="4"/><path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M5.9 18.1l1.6-1.6M16.5 7.5l1.6-1.6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const ICONS = P;
