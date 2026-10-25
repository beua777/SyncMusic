// 화면 모듈끼리 함께 쓰는 상태 (순환 import를 피하려고 따로 둔다)
export const ctx = {
  player: null,
  go: null, // (hash) => 이동
  refresh: null, // () => 지금 화면 다시 그리기
  list: { ids: [], source: null }, // 지금 화면에 보이는 곡 목록 (곡을 누르면 이 목록이 대기열이 된다)
  selection: new Set(),
  lastSelected: -1,
};
