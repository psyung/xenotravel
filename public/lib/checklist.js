// 체크리스트: 할 일 · 짐 · 쇼핑. 순수 함수만 둔다.
// trip.checks = [{ id, group: 'todo'|'pack'|'shop', text, done, price?, cur? }]
//   price: 예상 가격 (선택), cur: 'local'(현지 통화) | 'KRW'
//   가격이 있는 항목은 가계부 "예상"에 잡히고, 체크하면 가계부에 실제 지출로 기록된다 (expense.checkId로 연결).
import { uid, indexOfDate } from './model.js';
import { guessCurrency, ensureBudget, toKrw, addExpense } from './budget.js';
import { t, allVersions, getLang } from './i18n.js';
// 그룹 이름·기본 항목·추천 품목은 번역 키다. 기본 항목과 추천 품목은 넣는 순간의 언어로 저장된다 (그 뒤로는 사용자 데이터).

export const CHECK_GROUPS = {
  todo: { label: '출발 전 할 일', placeholder: '할 일 추가' },
  pack: { label: '짐 싸기', placeholder: '챙길 것 추가' },
  shop: { label: '쇼핑 리스트', placeholder: '사고 싶은 것 추가' },
};

export const DEFAULTS = {
  todo: ['여권 유효기간 확인 (6개월 이상)', '여행자 보험', 'eSIM / 포켓와이파이', '환전 · 트래블카드 준비', '숙소 주소 현지어로 캡처', '항공 온라인 체크인'],
  pack: ['여권', '충전기 · 보조배터리', '멀티 어댑터', '상비약', '세면도구'],
  shop: [],
};

/**
 * 나라별 추천 쇼핑 목록 (가게 단위). 한국 여행자들이 많이 사는 품목이다.
 * 나라마다 첫 번째 목록은 새 여행을 만들 때 쇼핑 리스트에 자동으로 들어가고, 나머지는 "담기" 버튼으로 넣는다.
 * 가격·재고·맛 종류는 매장마다 달라서 품목 이름만 넣는다. 통화 코드로 나라를 구분한다.
 */
export const SHOP_PICKS = {
  JPY: [
    {
      id: 'donki',
      title: '돈키호테 필수템',
      items: [
        '곤약젤리 (오리히로)', '휴족시간 (발 쿨링 시트)', '로이히츠보코 동전파스', '사론파스', '메구리즘 온열 안대',
        '카베진 (위장약)', '이브 진통제 (EVE A)', '류카쿠산 목캔디', '센카 퍼펙트휩 클렌징폼', '비오레 UV 아쿠아리치 선크림',
        '일본 한정 킷캣', '자가리코', '블랙썬더', '호로요이',
      ],
    },
    {
      id: 'akachan',
      title: '아카짱혼포 육아템',
      note: '아기와 함께라면',
      items: ['메리즈 · 무니 기저귀', '메이지 큐브 분유 (휴대용)', '피죤 젖병 · 젖꼭지', '아기 물티슈', '와코도 아기 과자 · 이유식', '아기 보리차', '아기 선크림', '아기 손톱깎이'],
    },
  ],
  CNY: [
    {
      id: 'rtmart',
      title: '따룬파 마트템',
      items: ['하이디라오 훠궈 소스', '라오깐마 고추기름', '웨이룽 라티아오 (매운 간식)', '대백토 밀크캔디', '왕왕 쌀과자', '볶은 땅콩', '오징어채', '칭다오 맥주', '보이차 · 우롱차'],
    },
  ],
  TWD: [
    {
      id: 'carrefour-tw',
      title: '까르푸 마트템',
      note: '2026년부터 간판이 바뀌는 중이에요',
      items: ['펑리수', '누가 크래커', '초코 퍼프볼', '타이양빙', '타로 케이크', '마찌 (찹쌀떡)', '3시15분 밀크티', '금문고량주'],
    },
  ],
  VND: [
    {
      id: 'lottemart-vn',
      title: '롯데마트 쇼핑템',
      items: ['G7 커피', '위즐 커피', '하오하오 라면', '포보 쌀국수', '친수 칠리소스', '망고 젤리', '말린 망고', '캐슈넛'],
    },
  ],
  THB: [
    {
      id: 'bigc',
      title: '빅씨 마트템',
      items: ['야돔 (코 흡입제)', '타이거밤', '타오케노이 김과자', '말린 망고', '똠얌 페이스트'],
    },
  ],
};

/** 이 여행에 맞는 추천 목록들 (없으면 빈 배열). 가계부 통화를 정했으면 그걸, 아니면 여행지 이름으로 판단한다. */
export function shopPickSets(trip) {
  return SHOP_PICKS[trip.budget?.currency ?? guessCurrency(trip.destination)] ?? [];
}

/**
 * 처음 열 때 할 일·짐 기본 항목을 채운다. 쇼핑 리스트는 비워 두고, 추천 목록은 사용자가 "담기"를 눌러야 들어간다.
 * 이미 있으면 그대로.
 */
export function ensureChecks(trip) {
  if (!Array.isArray(trip.checks)) {
    trip.checks = Object.entries(DEFAULTS).flatMap(([group, list]) => list.map((text, i) => ({ id: uid(), group, text: t(text), done: false, tpl: `${group}:${i}` })));
    trip.checksV = 2;
  }
  if (trip.checksV !== 2) undoAutoPicks(trip);
  return trip.checks;
}

/**
 * 예전 버전은 새 여행에 나라별 대표 쇼핑 목록을 자동으로 넣었다.
 * 쇼핑 리스트가 그 목록과 똑같고 하나도 체크하지 않았으면 자동으로 들어간 것이므로 뺀다.
 * 사용자가 하나라도 더하거나 지우거나 체크했으면 건드리지 않는다.
 */
function undoAutoPicks(trip) {
  trip.checksV = 2;
  const shop = trip.checks.filter((c) => c.group === 'shop');
  const auto = shopPickSets(trip)[0]?.items;
  if (!auto || shop.length !== auto.length || shop.some((c, i) => c.done || c.text !== auto[i])) return;
  trip.checks = trip.checks.filter((c) => c.group !== 'shop');
}

/**
 * 화면에 보일 항목 이름. 기본 템플릿(기본 할 일·짐, 추천 쇼핑 품목)에서 온 항목이고 글자가 템플릿 그대로면
 * 지금 언어로 보여준다. 사용자가 직접 쓴 항목·바꾼 항목은 저장된 글자 그대로 (저장 데이터는 바꾸지 않는다).
 * 표시가 없는 예전 한국어 여행도 기본 항목과 글자가 똑같으면 템플릿으로 본다.
 */
export function checkText(c) {
  let key = null;
  const [g, i] = String(c.tpl ?? '').split(':');
  if (DEFAULTS[g]?.[i]) key = DEFAULTS[g][i];
  else if (c.pick) {
    const [setId, j] = c.pick.split(':');
    key = Object.values(SHOP_PICKS).flat().find((s) => s.id === setId)?.items[j] ?? null;
  } else if (DEFAULTS[c.group]?.includes(c.text)) key = c.text;
  if (!key && c.textI18n && Object.values(c.textI18n).includes(c.text)) return c.textI18n[getLang()] ?? c.text; // 스마트 추천 항목 (고치지 않았으면 지금 언어로)
  return key && allVersions(key).includes(c.text) ? t(key) : c.text;
}

/* ───────── 스마트 체크리스트 추천 (Phase 4) ─────────
 * public/data/checklist-presets.json: { types, durations, items: [{ id, group, types, minDays, text: {ko,en,zh,ja} }] }
 * 여행 성격과 기간을 고르면 맞는 항목을 고르고, 이미 체크리스트에 있는 것(어느 언어로 넣었든, 기본 항목·추천 쇼핑 품목 포함)은 뺀다.
 * 추가는 사용자가 고른 항목만, 맨 끝에 새로 넣는다 — 기존 항목의 글자·체크 상태·가격·연결된 지출은 건드리지 않는다.
 */
const LANGS4 = ['ko', 'en', 'zh', 'ja'];
/** 비교용 글자: 전각/반각·대소문자·띄어쓰기·가운뎃점·괄호 차이를 무시한다 */
export const normalizeCheckText = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s·・,，、/()（）\[\]{}\-–—~〜.。!！?？'"“”‘’]/g, '');

/** 여행 일수 → 기간 키 (short 1~3일 · mid 4~7일 · long 8일 이상) */
export function durationKey(days) {
  const n = Number(days) || 1;
  return n <= 3 ? 'short' : n <= 7 ? 'mid' : 'long';
}

/** 지금 체크리스트에 있는 항목의 비교용 글자들 (모든 언어 판) + 이미 넣은 추천 id */
function existingKeys(trip) {
  const texts = new Set();
  const presets = new Set();
  for (const c of ensureChecks(trip)) {
    const add = (v) => v && texts.add(normalizeCheckText(v));
    add(c.text);
    add(checkText(c));
    for (const v of Object.values(c.textI18n ?? {})) add(v);
    const [g, i] = String(c.tpl ?? '').split(':');
    if (DEFAULTS[g]?.[i]) allVersions(DEFAULTS[g][i]).forEach(add);
    if (DEFAULTS[c.group]?.includes(c.text)) allVersions(c.text).forEach(add);
    if (c.preset) presets.add(c.preset);
  }
  return { texts, presets };
}

/**
 * 추천 후보. → { items: [{ id, group, text, textI18n }], skipped: [{ id, text }] }
 *   items: 새로 넣을 수 있는 것 (지금 언어 글자), skipped: 이미 있어서 뺀 것
 * type: presets.types 키, days: 여행 일수 (기간 키 대신 숫자로)
 */
export function presetCandidates(trip, presets, { type, days, lang = getLang() }) {
  const want = (presets?.items ?? []).filter((it) => it.types?.includes(type) && (Number(days) || 1) >= (it.minDays ?? 1) && CHECK_GROUPS[it.group]);
  const { texts, presets: have } = existingKeys(trip);
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (const it of want) {
    const text = it.text?.[lang] ?? it.text?.ko ?? '';
    const versions = LANGS4.map((l) => it.text?.[l]).filter(Boolean).map(normalizeCheckText);
    const dup = have.has(it.id) || versions.some((v) => texts.has(v) || seen.has(v));
    if (dup) skipped.push({ id: it.id, group: it.group, text });
    else {
      items.push({ id: it.id, group: it.group, text, textI18n: { ...it.text } });
      versions.forEach((v) => seen.add(v));
    }
  }
  return { items, skipped };
}

/**
 * 고른 추천 항목만 추가한다. 기존 항목은 읽기만 한다 (순서·글자·체크·가격·지출 연결 그대로). 넣은 항목 배열을 돌려준다.
 * 사이에 같은 항목이 생겼으면(다른 탭 등) 다시 확인해서 빼고 넣는다.
 */
export function addPresetItems(trip, presets, ids, { type, days, lang = getLang() }) {
  const pick = new Set(ids);
  const { items } = presetCandidates(trip, presets, { type, days, lang });
  const added = [];
  for (const it of items) {
    if (!pick.has(it.id)) continue;
    const c = { id: uid(), group: it.group, text: it.text, done: false, preset: it.id, textI18n: it.textI18n };
    trip.checks.push(c);
    added.push(c);
  }
  return added;
}

/** 그 목록에서 아직 쇼핑 리스트에 없는 품목 (번역 키). 다른 언어로 담았던 품목도 담은 것으로 본다. */
export function missingPicks(trip, set) {
  if (!set) return [];
  const have = new Set(ensureChecks(trip).filter((c) => c.group === 'shop').flatMap((c) => [c.text, c.pick]));
  return set.items.filter((item, i) => !have.has(`${set.id}:${i}`) && !have.has(item) && !have.has(t(item)));
}

/** 목록(id)에서 빠진 것만 쇼핑 리스트에 넣는다 (지금 언어로). 넣은 개수를 돌려준다. */
export function addPicks(trip, setId) {
  const set = shopPickSets(trip).find((x) => x.id === setId);
  const add = missingPicks(trip, set);
  for (const item of add) trip.checks.push({ id: uid(), group: 'shop', text: t(item), done: false, pick: `${set.id}:${set.items.indexOf(item)}` });
  return add.length;
}

export function addCheck(trip, group, text) {
  const t = String(text ?? '').trim();
  if (!t || !CHECK_GROUPS[group]) return null;
  const c = { id: uid(), group, text: t, done: false };
  ensureChecks(trip).push(c);
  return c;
}

/** 체크 그룹 → 가계부 분류 */
export const GROUP_CAT = { shop: 'shop', todo: 'etc', pack: 'etc' };

/** 체크 항목과 연결된 가계부 지출 (없으면 null) */
export function linkedExpense(trip, checkId) {
  return (trip.expenses ?? []).find((e) => e.checkId === checkId) ?? null;
}

/**
 * 가격이 있는 항목을 체크하면 가계부에 기록한다. 해제 후에도 결제 내역과 연결을 유지한다.
 * today: 'YYYY-MM-DD' (여행 중이면 그날, 아니면 "출발 전"으로 기록)
 * → { check, expense: 새로 적은 기록 | null }
 */
export function toggleCheck(trip, id, today = '') {
  const c = ensureChecks(trip).find((x) => x.id === id);
  if (!c) return { check: null, expense: null };
  c.done = !c.done;
  if (!c.done || !(c.price > 0) || linkedExpense(trip, c.id)) return { check: c, expense: null };
  const i = indexOfDate(trip, today);
  const day = i != null && i >= 0 && i < trip.days.length ? i : -1;
  const e = addExpense(trip, { amount: c.price, cur: c.cur, cat: GROUP_CAT[c.group] ?? 'etc', pay: 'card', day, memo: c.text });
  e.id = `check-${c.id}`;
  e.checkId = c.id;
  return { check: c, expense: e };
}

export function setGroupDone(trip, group, done, today) {
  for (const check of ensureChecks(trip)) {
    if (check.group === group && check.done !== done) toggleCheck(trip, check.id, today);
  }
}

/** 예상 가격 정하기 (0이나 빈 값이면 지운다) */
export function setPrice(trip, id, price, cur = 'local') {
  const c = ensureChecks(trip).find((x) => x.id === id);
  if (!c) return null;
  const n = Number(String(price ?? '').replace(/,/g, ''));
  if (n > 0) {
    c.price = n;
    c.cur = cur === 'KRW' ? 'KRW' : 'local';
  } else {
    delete c.price;
    delete c.cur;
  }
  return c;
}

/** 가격을 원화로 (환율이 없으면 null) */
export function priceKrw(trip, c) {
  return c.price > 0 ? toKrw(c.price, c.cur, ensureBudget(trip)) : null;
}

/**
 * 체크리스트로 잡은 예상 지출(원). 가계부 "예상"에 쓴다.
 * → { total, byGroup: {shop, todo, pack}, byCat: {shop, etc}, priced: 가격 넣은 항목 수, noRate: 환율이 없어 못 바꾼 항목 수 }
 */
export function planned(trip) {
  const out = { total: 0, byGroup: {}, byCat: {}, priced: 0, noRate: 0 };
  for (const c of trip.checks ?? []) {
    if (!(c.price > 0)) continue;
    out.priced++;
    const krw = priceKrw(trip, c);
    if (krw == null) {
      out.noRate++;
      continue;
    }
    const cat = GROUP_CAT[c.group] ?? 'etc';
    out.total += krw;
    out.byGroup[c.group] = (out.byGroup[c.group] ?? 0) + krw;
    out.byCat[cat] = (out.byCat[cat] ?? 0) + krw;
  }
  return out;
}

/** 하나 지우기. 이미 가계부에 기록된 지출은 남긴다 (실제로 쓴 돈이므로) — 연결만 끊는다. */
export function removeCheck(trip, id) {
  return removeChecks(trip, (x) => x.id === id) > 0;
}

/** 조건에 맞는 항목을 지운다. 지운 개수를 돌려준다. */
function removeChecks(trip, pick) {
  const gone = new Set(ensureChecks(trip).filter(pick).map((x) => x.id));
  trip.checks = trip.checks.filter((x) => !gone.has(x.id));
  for (const e of trip.expenses ?? []) if (gone.has(e.checkId)) delete e.checkId;
  return gone.size;
}

/** 그룹에서 체크한 것만 지우기 */
export function removeDone(trip, group) {
  return removeChecks(trip, (x) => x.group === group && x.done);
}

/** 그룹 전체 지우기 */
export function clearGroup(trip, group) {
  return removeChecks(trip, (x) => x.group === group);
}

/**
 * 일괄 삭제 확인 창에 보여 줄 선택지. 완료 수와 전체 수를 그룹의 실제 항목에서 매번 다시 센다.
 * - 완료 0개: [all]   - 완료 = 전체: [done] 하나만 (같은 동작의 버튼 두 개를 띄우지 않는다)   - 그 밖: [done, all]
 * → { done, total, options: ['done'|'all', …] }
 */
export function bulkDeleteOptions(trip, group) {
  const list = (trip.checks ?? []).filter((c) => c.group === group);
  const done = list.filter((c) => c.done).length;
  const total = list.length;
  const options = !total ? [] : !done ? ['all'] : done === total ? ['done'] : ['done', 'all'];
  return { done, total, options };
}

/**
 * 지운 체크 항목 되살리기 (실행 취소). snapshot = takeChecksSnapshot()이 돌려준 값.
 * 각 항목을 지우기 전 바로 뒤(없으면 앞)에 있던 항목 옆에 넣는다 — 연속 삭제를 어떤 순서로 되돌려도 순서가 섞이지 않는다.
 * 연결된 가계부 지출은 연결(checkId)을 되돌리고, 그사이 가계부에서 지워졌으면 지출 자체도 되살린다.
 * 이미 있는 항목(다른 탭에서 되살린 경우 등)은 건드리지 않는다. 되살린 개수를 돌려준다.
 */
export function restoreChecks(trip, snapshot) {
  const checks = ensureChecks(trip);
  trip.expenses ??= [];
  let n = 0;
  for (const { check, after, before = [] } of snapshot.items) {
    if (checks.some((c) => c.id === check.id)) continue;
    // 지우기 전 바로 뒤에 있던 항목(가장 가까운 것) 앞에 넣는다. 뒤 항목이 다 없으면 앞 항목 뒤, 그것도 없으면 맨 끝.
    let at = -1;
    for (const id of before) {
      const i = checks.findIndex((c) => c.id === id);
      if (i >= 0) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      at = checks.length;
      for (let k = after.length - 1; k >= 0; k--) {
        const i = checks.findIndex((c) => c.id === after[k]);
        if (i >= 0) {
          at = i + 1;
          break;
        }
      }
    }
    checks.splice(at, 0, structuredClone(check));
    n++;
  }
  for (const e of snapshot.expenses) {
    const cur = trip.expenses.find((x) => x.id === e.id);
    if (cur) {
      if (!cur.checkId) cur.checkId = e.checkId;
    } else trip.expenses.push(structuredClone(e));
  }
  return n;
}

/** 지우기 직전 상태 기억: 항목마다 앞(after, 가까운 것이 마지막)·뒤(before, 가까운 것이 처음) 항목 id와 연결된 지출 */
export function takeChecksSnapshot(trip, ids) {
  const want = new Set(ids);
  const checks = ensureChecks(trip);
  const items = [];
  checks.forEach((c, i) => {
    if (want.has(c.id)) items.push({ check: structuredClone(c), after: checks.slice(0, i).map((x) => x.id), before: checks.slice(i + 1).map((x) => x.id) });
  });
  const expenses = (trip.expenses ?? []).filter((e) => want.has(e.checkId)).map((e) => structuredClone(e));
  return { items, expenses };
}

/** 그룹별 {done, total} */
export function progress(trip, group) {
  const list = ensureChecks(trip).filter((c) => c.group === group);
  return { done: list.filter((c) => c.done).length, total: list.length };
}

/** 탭 배지에 보일 숫자: 남은 "출발 전 할 일" */
export function pendingTodos(trip) {
  return (trip.checks ?? []).filter((c) => c.group === 'todo' && !c.done).length;
}
