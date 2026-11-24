// I-3: 모바일 지도 하단 시트를 좌우로 밀어 일차 바꾸기 — 판정 규칙 (DOM 없이 테스트한다).
//  - 처음 10px 움직임에서 가로가 세로보다 크면 "일차 넘기기", 아니면 "시트 높이 조절"(머리) / 목록 스크롤(본문)
//  - 넘김: 가로 50px 이상, 또는 빠르게 튕김(0.3px/ms 이상). 못 미치면 제자리
//  - 왼쪽으로 밀면 다음 날, 오른쪽으로 밀면 전날. 첫날·마지막 날 밖으로는 반동만 (순환하지 않음)
//  - 전체 동선 상태: 왼쪽 → Day 1, 오른쪽 → 마지막 날

export const AXIS_LOCK = 10;
export const SWIPE_MIN = 50;
export const FLICK_SPEED = 0.3;
// 손가락은 정확히 수평으로 움직이지 않는다: 가로가 세로의 0.75배만 넘어도 일차 넘기기로 본다 (약 53° 안쪽, 실기기 피드백)
export const HORIZONTAL_BIAS = 0.75;

/** 처음 움직임의 방향: 아직 모르면 null, 가로 'x', 세로(대각선 포함 세로 우세) 'y' */
export function gestureAxis(dx, dy, lock = AXIS_LOCK) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < lock) return null;
  return Math.abs(dx) >= Math.abs(dy) * HORIZONTAL_BIAS ? 'x' : 'y';
}

/** 지금 일차(index, 전체 동선이면 -1)에서 dx만큼 민 쪽의 일차. 없으면(경계) null */
export function neighborDay(dx, index, count) {
  if (!count || !dx) return null;
  if (index < 0) return dx < 0 ? 0 : count - 1;
  const next = index + (dx < 0 ? 1 : -1);
  return next >= 0 && next < count ? next : null;
}

/** 손을 뗐을 때: { target: 바꿀 일차 | null, bounce: 경계라 반동만 } */
export function swipeResult({ dx, dt, index, count }) {
  const speed = Math.abs(dx) / Math.max(1, dt);
  const target = neighborDay(dx, index, count);
  if (Math.abs(dx) < SWIPE_MIN && speed < FLICK_SPEED) return { target: null, bounce: false };
  return target == null ? { target: null, bounce: true } : { target, bounce: false };
}

/** 미는 동안 내용이 따라오는 거리: 경계 쪽으로는 1/3만 (살짝 늘어나는 반동) */
export function dragOffset(dx, index, count) {
  return neighborDay(dx, index, count) == null ? dx / 3 : dx;
}

/** 시트 머리 위치 표시: 8일까지는 점(●○○), 넘으면 "2 / 20" */
export function dayIndicator(index, count) {
  if (index < 0 || !count) return { dots: null, text: '' };
  if (count > 8) return { dots: null, text: `${index + 1} / ${count}` };
  return { dots: Array.from({ length: count }, (_, i) => i === index), text: '' };
}
