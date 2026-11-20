// 일정 요약 이미지 (Phase 4): 메신저에 보내기 좋은 한 장짜리 PNG.
// 여행명 · 날짜 · 일차별 대표 장소 · 동선 그림만 담는다. 메모·예약번호·가계부·체크리스트는 넣지 않는다 (개인정보).
// 동선은 지도 타일 없이 일정 좌표로 그린다 (오프라인 SVG 미니맵과 같은 투영) — 인터넷이 없어도, 다크 테마에서도 만든다.
// summaryModel·projectRoutes·fitText는 순수 함수(테스트 대상), drawSummary는 캔버스에 그린다.
import { dayRoute, safeFileName } from './model.js';
import { t, dayName, shortDate, weekday } from './i18n.js';
import { shareSummary } from './share.js';

export const SUMMARY_W = 1080;

/** 이미지에 들어갈 내용만 뽑는다. 장소 이름 외의 사용자 입력(메모·주소·링크·예약번호·지출)은 넣지 않는다. */
export function summaryModel(trip, { colors = ['#D94E34'], maxDays = 10, perDay = 3 } = {}) {
  const { title, line } = shareSummary(trip);
  const days = trip.days.map((d, i) => {
    const names = d.items.map((it) => String(it.name ?? '').trim()).filter(Boolean);
    return {
      label: dayName(i),
      date: d.date ? `${shortDate(d.date)} (${weekday(d.date)})` : '',
      places: names.slice(0, perDay),
      more: Math.max(0, names.length - perDay),
      color: colors[i % colors.length],
    };
  });
  const routes = trip.days
    .map((d, i) => ({
      color: colors[i % colors.length],
      pts: dayRoute(trip, i).map((p) => ({ lat: p.lat, lng: p.lng, stay: (trip.stays ?? []).includes(p) })),
    }))
    .filter((r) => r.pts.length);
  return {
    title,
    line,
    days: days.slice(0, maxDays),
    hiddenDays: Math.max(0, days.length - maxDays),
    routes,
  };
}

/**
 * 좌표 → 그림 칸 안 픽셀 (위도 보정한 등거리 투영, 가로세로 비율 유지, 가운데 정렬).
 * box = { x, y, w, h, pad } → routes와 같은 모양에 x·y를 붙여 돌려준다.
 */
export function projectRoutes(routes, { x = 0, y = 0, w, h, pad = 40 }) {
  const all = routes.flatMap((r) => r.pts);
  if (!all.length) return [];
  const lat0 = all.reduce((s, p) => s + p.lat, 0) / all.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p.lng * kx);
  const ys = all.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = x + (w - spanX * scale) / 2;
  const oy = y + (h - spanY * scale) / 2;
  return routes.map((r) => ({ ...r, pts: r.pts.map((p) => ({ ...p, x: ox + (p.lng * kx - minX) * scale, y: oy + (maxY - p.lat) * scale })) }));
}

/** 폭에 맞게 자르기 (넘치면 …). measure(text) → px. 띄어쓰기 없는 중국어·일본어도 글자 단위로 자른다. */
export function fitText(text, maxWidth, measure) {
  const s = String(text ?? '');
  if (measure(s) <= maxWidth) return s;
  const chars = [...s];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join('')}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** 두 줄까지 줄바꿈 (단어 → 안 되면 글자 단위), 넘치면 둘째 줄 끝을 …로 */
export function wrapText(text, maxWidth, measure, maxLines = 2) {
  const s = String(text ?? '');
  const tokens = s.includes(' ') ? s.split(/(\s+)/) : [...s];
  const lines = [];
  let cur = '';
  for (const tok of tokens) {
    const next = cur + tok;
    if (measure(next.trimEnd()) <= maxWidth || !cur) {
      cur = next;
      continue;
    }
    lines.push(cur.trimEnd());
    cur = tok.trimStart();
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur.trimEnd());
  const used = lines.join('').replace(/\s/g, '').length;
  if (used < s.replace(/\s/g, '').length) lines[lines.length - 1] = fitText(`${lines.at(-1)}…`, maxWidth, measure);
  return lines.map((l) => (measure(l) > maxWidth ? fitText(l, maxWidth, measure) : l));
}

/** 요약 이미지 파일 이름: xenotravel-summary-{여행명}-{날짜}.png */
export function summaryFileName(trip, now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `xenotravel-summary-${safeFileName(trip.title)}-${d}.png`;
}

export const SUMMARY_THEMES = {
  light: { bg: '#FAF9F6', card: '#FFFFFF', ink: '#18181B', sub: '#52525B', mute: '#71717A', line: '#E4E4E7', grid: '#EFEDE8', accent: '#D94E34', pinText: '#FFFFFF', stay: '#14b8a6' },
  dark: { bg: '#121214', card: '#1C1C1F', ink: '#F4F4F5', sub: '#C4C4CC', mute: '#A1A1AA', line: '#2E2E33', grid: '#232327', accent: '#F2745B', pinText: '#FFFFFF', stay: '#33C7C7' },
};

const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "PingFang SC", "Microsoft YaHei", "Hiragino Sans", "Yu Gothic", sans-serif';
const LOGO = {
  route: 'M9.5 10.5C14.5 10.5 17.5 23.5 23 23.5',
  cross: 'M11.3 21.7L19.6 13.4',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 캔버스에 요약 이미지를 그린다. 높이는 일차 수에 맞춰 정한다. → canvas
 * labels = { brand, mapNote, privacy, moreDays(n), morePlaces(n), noPlaces }
 */
export function drawSummary(canvas, model, { theme = 'light', labels }) {
  const c = SUMMARY_THEMES[theme] ?? SUMMARY_THEMES.light;
  const W = SUMMARY_W;
  const P = 64;
  const ROW = 104;
  const MAP_H = model.routes.length ? 560 : 0;
  const ctx0 = canvas.getContext('2d');
  ctx0.font = `800 58px ${FONT}`;
  const titleLines = wrapText(model.title, W - P * 2, (s) => ctx0.measureText(s).width, 2);
  const TITLE_Y = 64 + 56 + 40 + 58; // 첫 제목 줄 기준선
  const LINE_Y = TITLE_Y + (titleLines.length - 1) * 70 + 58; // 날짜 줄 기준선
  const headH = LINE_Y + 44;
  const listH = model.days.length * ROW + (model.hiddenDays ? 56 : 0);
  const H = headH + (MAP_H ? MAP_H + 40 : 0) + listH + 120;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  // 바탕
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);
  // 로고 (헤더 인라인 로고와 같은 경로 · 목적지 점은 코랄)
  ctx.save();
  ctx.translate(P, 56);
  ctx.scale(56 / 32, 56 / 32);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D(LOGO.route));
  ctx.lineCap = 'butt';
  ctx.stroke(new Path2D(LOGO.cross));
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(9.5, 23.5, 2.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(23.3, 9.7, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = c.ink;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(labels.brand, P + 72, 96);
  // 제목 · 날짜
  let y = TITLE_Y;
  ctx.font = `800 58px ${FONT}`;
  for (const l of titleLines) {
    ctx.fillText(l, P, y);
    y += 70;
  }
  ctx.fillStyle = c.sub;
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText(fitText(model.line, W - P * 2, (s) => ctx.measureText(s).width), P, LINE_Y);
  y = headH;
  // 동선 그림 (타일 없음)
  if (MAP_H) {
    const box = { x: P, y, w: W - P * 2, h: MAP_H };
    ctx.fillStyle = c.card;
    roundRect(ctx, box.x, box.y, box.w, box.h, 28);
    ctx.fill();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, box.x, box.y, box.w, box.h, 28);
    ctx.clip();
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1.5;
    for (let gx = box.x + 60; gx < box.x + box.w; gx += 60) {
      ctx.beginPath();
      ctx.moveTo(gx, box.y);
      ctx.lineTo(gx, box.y + box.h);
      ctx.stroke();
    }
    for (let gy = box.y + 60; gy < box.y + box.h; gy += 60) {
      ctx.beginPath();
      ctx.moveTo(box.x, gy);
      ctx.lineTo(box.x + box.w, gy);
      ctx.stroke();
    }
    const routes = projectRoutes(model.routes, { x: box.x, y: box.y, w: box.w - 60, h: box.h - 50, pad: 60 }); // 오른쪽 위 N, 아래 안내 글자 자리를 비운다
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of routes) {
      if (r.pts.length < 2) continue;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 7;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const drawnStays = new Set();
    for (const r of routes) {
      let n = 0;
      for (const p of r.pts) {
        if (p.stay) {
          const key = `${Math.round(p.x)},${Math.round(p.y)}`;
          if (drawnStays.has(key)) continue;
          drawnStays.add(key);
          ctx.fillStyle = c.stay;
          roundRect(ctx, p.x - 20, p.y - 20, 40, 40, 10);
          ctx.fill();
          ctx.strokeStyle = c.card;
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.fillStyle = c.pinText;
          ctx.font = `800 22px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText('H', p.x, p.y + 8);
          ctx.textAlign = 'left';
          continue;
        }
        n++;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.card;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = c.pinText;
        ctx.font = `800 22px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(n), p.x, p.y + 8);
        ctx.textAlign = 'left';
      }
    }
    // 북쪽 표시
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(box.x + box.w - 44, box.y + 34);
    ctx.lineTo(box.x + box.w - 32, box.y + 66);
    ctx.lineTo(box.x + box.w - 44, box.y + 58);
    ctx.lineTo(box.x + box.w - 56, box.y + 66);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.ink;
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', box.x + box.w - 44, box.y + 92);
    ctx.textAlign = 'left';
    ctx.restore();
    ctx.fillStyle = c.mute;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(fitText(labels.mapNote, box.w - 40, (s) => ctx.measureText(s).width), box.x + 24, box.y + box.h - 22);
    y += MAP_H + 40;
  }
  // 일차별 대표 장소
  for (const d of model.days) {
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(P + 10, y + 30, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.ink;
    ctx.font = `800 32px ${FONT}`;
    ctx.fillText(d.label, P + 34, y + 42);
    const lw = ctx.measureText(d.label).width;
    ctx.fillStyle = c.mute;
    ctx.font = `600 28px ${FONT}`;
    if (d.date) ctx.fillText(d.date, P + 34 + lw + 16, y + 42);
    ctx.fillStyle = c.sub;
    ctx.font = `500 30px ${FONT}`;
    const places = d.places.length ? `${d.places.join(' · ')}${d.more ? ` ${labels.morePlaces(d.more)}` : ''}` : labels.noPlaces;
    ctx.fillText(fitText(places, W - P * 2 - 34, (s) => ctx.measureText(s).width), P + 34, y + 84);
    y += ROW;
  }
  if (model.hiddenDays) {
    ctx.fillStyle = c.mute;
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(labels.moreDays(model.hiddenDays), P + 34, y + 30);
    y += 56;
  }
  // 바닥글 (개인정보 안내)
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(P, H - 92);
  ctx.lineTo(W - P, H - 92);
  ctx.stroke();
  ctx.fillStyle = c.mute;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(fitText(labels.privacy, W - P * 2, (s) => ctx.measureText(s).width), P, H - 50);
  return canvas;
}
