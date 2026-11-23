import * as M from '../lib/model.js';
import * as B from '../lib/budget.js';
import * as C from '../lib/checklist.js';
import * as S from '../lib/settle.js';
import { focusSelect } from '../lib/select.js';
import { t, k, num, dayName, shortDate } from '../lib/i18n.js';

let drawPage, requestRate;
export { drawPage as renderBudget, requestRate as fetchRate };

export function init(ctx) {
  const { $, $$, esc, TODAY, prefs, commit, saved, bm, go, toast, keepDrafts, copyText } = ctx;

  /* ───────── 가계부 ─────────
   * 금액은 현지 통화(또는 원화)로 적고, 적는 순간의 환율로 원화도 같이 저장한다 (나중에 환율이 바뀌어도 그대로).
   * 돈 기록은 공유 링크에 넣지 않는다 (decodeShare가 일정만 꺼낸다).
   */
  /** 기준 통화 최소 단위 정수(정산·합계) 표시 */
  const bu = (units) => B.formatUnits(units, B.shownBaseCode(ctx.trip?.budget));
  /** 정산: 지출마다 기록 시점 환율로 기준 통화 단위를 구해 정수로 나눈다 (1/N 반올림 오차 보정) */
  const settleNow = () => S.settlement(ctx.trip, { unitsOf: (e) => B.expenseBaseUnits(e, ctx.trip.budget) });

  const RATE_API = 'https://open.er-api.com/v6/latest/KRW'; // 키 없이 쓰는 무료 환율 (하루 1회 갱신)
  ctx.ui.bf = null; // 가계부 입력 상태 { cur, cat, pay, day }

  function budgetForm() {
    if (!ctx.ui.bf || ctx.ui.bf.trip !== ctx.trip.id) {
      const i = M.indexOfDate(ctx.trip, TODAY);
      ctx.ui.bf = { trip: ctx.trip.id, cur: 'local', cat: 'food', pay: ctx.trip.country === 'cn' ? 'easypay' : 'card', day: i != null && i >= 0 && i < ctx.trip.days.length ? i : -1 };
    }
    if (ctx.ui.bf.day >= ctx.trip.days.length) ctx.ui.bf.day = -1;
    return ctx.ui.bf;
  }

  function barRows(map, defs, max) {
    const rows = Object.entries(defs)
      .map(([k, d]) => ({ k, d, v: map[k] ?? 0 }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v);
    if (!rows.length) return `<p class="empty-note">${esc(t('기록이 생기면 보여요'))}</p>`;
    return `<div class="bars">${rows
      .map((r) => `<div class="bar-row"><span class="lbl">${esc(t(r.d.label))}</span><span class="bar" aria-hidden="true"><i style="width:${(r.v / max) * 100}%"></i></span><span class="v">${bm(r.v)}</span></div>`)
      .join('')}</div>`;
  }

  /** 분류별 계획 대비: 쓴 돈 막대 위에 예상 금액 눈금 */
  function planRows(spent, planned) {
    const keys = Object.keys(B.EXPENSE_CATS).filter((k) => spent[k] || planned[k]);
    const max = Math.max(1, ...keys.map((k) => Math.max(spent[k] ?? 0, planned[k] ?? 0)));
    return `<div class="bars">${keys
      .map((k) => {
        const sp = spent[k] ?? 0;
        const pl = planned[k] ?? 0;
        const over = pl && sp > pl;
        return `<div class="bar-row plan-row"><span class="lbl">${esc(t(B.EXPENSE_CATS[k].label))}</span>
        <span class="bar${over ? ' over' : ''}" aria-hidden="true"><i style="width:${(sp / max) * 100}%"></i>${pl ? `<em style="left:${(pl / max) * 100}%"></em>` : ''}</span>
        <span class="v">${bm(sp)}<small>${pl ? ` / ${bm(pl)}` : ''}</small></span></div>`;
      })
      .join('')}</div><p class="fine">${esc(t('막대는 쓴 돈, 세로 눈금은 장소·체크리스트 예상이에요.'))}</p>`;
  }

  /** 예산 칸: 예산 없음 · 남음 · 딱 맞게 다 씀 · 초과 (문구와 색이 상태와 같게) */
  function budgetTileHtml(b, s) {
    // 기준 통화 최소 단위로 계산: 쓴 돈은 기록마다 남긴 환율로 (목록 합 = 합계)
    const state = B.budgetState(s.totalU, s.spentU);
    const pct = s.totalU ? Math.min(999, Math.round((s.spentU / s.totalU) * 100)) : 0;
    const left = s.totalU - s.spentU;
    const tile = {
      unset: { cls: 'neutral', label: t('남은 예산'), value: '—', note: t('예산을 넣으면 계산해요') },
      within: { cls: 'ok', label: t('남은 예산'), value: bu(left), note: t('{p}% 사용', { p: pct }) },
      reached: { cls: 'warn', label: t('예산 도달'), value: bu(0), note: t('예산을 다 썼어요 (100%)') },
      over: { cls: 'hot', label: t('예산 초과'), value: bu(-left), note: t('{p}% 사용', { p: pct }) },
    }[state];
    return `<div class="kpi ${tile.cls}" data-state="${state}"><span>${esc(tile.label)}</span><b>${tile.value}</b><small>${esc(tile.note)}</small></div>`;
  }

  function currencyOptions(selected) {
    return Object.entries(B.CURRENCIES)
      .map(([k, c]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${k} ${esc(t(c.name))}</option>`)
      .join('');
  }

  function renderBudget() {
    const el = $('#page-budget');
    keepDrafts(el, () => drawBudget(el));
    updateKrwPreview();
  }

  function drawBudget(el) {
    const b = B.ensureBudget(ctx.trip);
    const f = budgetForm();
    const cur = B.CURRENCIES[b.currency];
    const local = b.currency !== 'KRW';
    const useLocal = local && f.cur === 'local';
    const s = B.summarize(ctx.trip);
    const code = B.shownBaseCode(b);
    s.spentU = B.spentUnits(ctx.trip);
    s.totalU = code === 'KRW' ? b.total : B.toUnits(B.toBase(b.total, b), code);
    const plan = B.combinePlans(C.planned(ctx.trip), B.placePlanned(ctx.trip));
    const hasOut = s.byDay.out != null || ctx.trip.expenses.some((e) => B.expenseDay(ctx.trip, e) === 'out');
    // P0-5: 막대는 카드 폭 안에서 줄이고 라벨은 간격을 두고, 30일 이상은 주 단위로 묶는다
    const bars = B.dayBars(ctx.trip, s.byDay, { hasOut });
    const barMax = Math.max(1, ...bars.bars.map((x) => x.value));
    const recs = [...ctx.trip.expenses].reverse();
    if (ctx.ui.payFilter && !ctx.trip.expenses.some((e) => e.pay === ctx.ui.payFilter)) ctx.ui.payFilter = null;
    const shown = ctx.ui.payFilter ? recs.filter((e) => e.pay === ctx.ui.payFilter) : recs;
    const dayLabel = (k) => (k === -1 ? t('출발 전') : k === 'out' ? t('일정 외') : dayName(k));
    const dayShort = (k) => (k === -1 ? t('전') : k === 'out' ? t('외') : `D${k + 1}`);
    const confirmCur = B.needsCurrency(ctx.trip);
    el.innerHTML = `<div class="wrap">
    <h1 class="page-h">${esc(t('예산 · 가계부'))}</h1>
    <p class="page-sub">${esc(t('금액만 넣고 기록하면 돼요. 현지 돈으로 적으면 그때 환율로 원화도 같이 저장돼요.'))}</p>
    ${
        confirmCur && !ctx.ui.readonly
          ? `<div class="cur-confirm" role="group" aria-labelledby="curConfirmTitle">
            <b id="curConfirmTitle">${esc(t('현지 통화를 확인해 주세요'))}</b>
            <p>${esc(t('여행지 "{dest}"만으로는 어느 나라 돈을 쓰는지 알 수 없어요. 첫 기록 전에 통화를 골라 주세요. 지금은 임시로 {code}예요.', { dest: ctx.trip.destination || t('여행'), code: b.currency }))}</p>
            <div class="cur-confirm-row"><select id="bConfirmCur" data-ui-select aria-label="${esc(t('현지 통화'))}">${currencyOptions(b.currency)}</select>
            <button class="btn primary" data-b="cur-ok">${esc(t('이 통화로 쓰기'))}</button></div>
          </div>`
          : ''
      }
    <div class="grid3 kpis kpis4">
      <label class="kpi"><span>${esc(t('1인 예산 ({code})', { code: shownBase(b) }))}</span><input id="bTotal" inputmode="decimal" value="${b.total ? budgetInputValue(b) : ''}" placeholder="${esc(shownBase(b) === 'KRW' ? t('예: 800,000') : t('예: 600'))}"></label>
      <button class="kpi plan${b.total && plan.total > b.total ? ' hot' : ''}" data-b="to-check" title="${esc(t('장소의 예상 비용과 체크리스트 가격이 여기에 잡혀요'))}">
        <span>${esc(t('예상 (장소·체크리스트)'))}</span><b>${plan.priced ? bm(plan.total) : '—'}</b>
        <small>${plan.priced ? (b.total && plan.total > b.total ? esc(t('예산보다 {diff} 많아요', { diff: bm(plan.total - b.total) })) : `${esc(t('{n}개 항목', { n: plan.priced }))}${plan.noRate ? ` · ${esc(t('환율 미정 {n}개', { n: plan.noRate }))}` : ''}`) : esc(t('장소나 체크리스트에 가격 넣기 →'))}</small>
      </button>
      <div class="kpi"><span>${esc(t('쓴 돈'))}</span><b>${bu(s.spentU)}</b><small>${esc(t('{n}건', { n: ctx.trip.expenses.length }))}${s.pending.count ? ` · <span class="pend">${esc(t('환율 미정 {n}건 ({amount})', { n: s.pending.count, amount: B.moneyCode(s.pending.amount, b.currency) }))}</span>` : ''}</small></div>
      ${budgetTileHtml(b, s)}
    </div>
    ${currencyTotalsHtml(b, s)}

    <div class="box" style="margin-top:14px">
      <div class="amount-row">
        ${local ? `<button class="cur-btn" data-b="cur" aria-label="${esc(t('통화 바꾸기: 지금 {cur}', { cur: useLocal ? b.currency : 'KRW' }))}" title="${esc(t('원화/{name} 바꾸기', { name: t(cur.name) }))}">${useLocal ? esc(B.currencySymbol(b.currency)) : '₩'}</button>` : '<span class="cur-btn" style="display:grid;place-items:center" aria-hidden="true">₩</span>'}
        <input id="bAmount" data-draft="amount" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="${esc(t('금액'))}" aria-describedby="bError bKrw">
        <span id="bKrw" class="krw" aria-live="polite"></span>
        <button class="btn primary" data-b="add">${esc(t('기록'))}</button>
      </div>
      <div class="rate-row">
        <select id="bCurrency" class="inp" data-ui-select aria-label="${esc(t('현지 통화'))}">${currencyOptions(b.currency)}</select>
        ${
            local
              ? `<span>${cur.unit === 1 ? '1' : cur.unit} ${esc(t(cur.name))} =</span>
               <input id="bRate" inputmode="decimal" value="${b.krwPerUnit ? +(b.krwPerUnit * cur.unit).toFixed(2) : ''}" placeholder="${esc(t('환율'))}" aria-label="${esc(t('환율 (원)'))}"> <span>${esc(t('원'))}</span>
               <button class="pill" data-b="rate">${esc(t('오늘 환율 받기'))}</button>
               <span>${b.rateAt ? `${esc(b.rateSource === 'auto' ? t('자동') : t('직접 입력'))} · ${esc(shortDate(b.rateAt.slice(0, 10)))}` : b.krwPerUnit ? '' : `<span class="pend">${esc(t('환율 미정'))}</span>`}</span>`
              : ''
          }
      </div>
      ${baseRowHtml(b)}
      ${ctx.ui.rateError ? `<p class="form-error" role="alert">${esc(t('환율을 받아오지 못했어요. 인터넷 연결을 확인하고 다시 받거나, 환율을 직접 입력해 주세요. 그동안 적은 지출은 현지 돈으로 저장되고 원화는 “환율 미정”으로 표시돼요.'))} <button class="linkbtn" data-b="rate">${esc(t('다시 시도'))}</button></p>` : ''}
      <div class="chipset" role="group" aria-label="${esc(t('분류'))}">${Object.entries(B.EXPENSE_CATS)
          .map(([k, c]) => `<button class="${f.cat === k ? 'on' : ''}" aria-pressed="${f.cat === k}" data-b="cat" data-v="${k}">${esc(t(c.label))}</button>`)
          .join('')}</div>
      <div class="chipset" role="group" aria-label="${esc(t('결제 수단'))}">${Object.entries(B.PAYMENTS)
          .map(([k, c]) => `<button class="${f.pay === k ? 'on' : ''}" aria-pressed="${f.pay === k}" data-b="pay" data-v="${k}">${esc(t(c.label))}</button>`)
          .join('')}</div>
      <div class="memo-row">
        <input id="bMemo" data-draft="memo" placeholder="${esc(t('메모 (선택) · 예: 이치란 라멘'))}" aria-label="${esc(t('메모'))}" maxlength="80">
        <select id="bDay" class="inp" data-ui-select aria-label="${esc(t('언제'))}">${[-1, ...ctx.trip.days.map((_, i) => i)]
            .map((k) => `<option value="${k}"${k === f.day ? ' selected' : ''}>${esc(dayLabel(k))}</option>`)
            .join('')}</select>
      </div>
      ${shareFormHtml(f)}
      <p id="bError" class="form-error" role="alert" hidden></p>
    </div>

    ${settleBoxHtml()}

    <div class="grid2" style="margin-top:14px">
      <div class="box"><h3>${esc(plan.priced ? t('계획 대비') : t('분류별'))}</h3>${plan.priced ? planRows(s.byCat, plan.byCat) : barRows(s.byCat, B.EXPENSE_CATS, Math.max(1, ...Object.values(s.byCat)))}</div>
      <div class="box">
        <h3>${esc(t('날짜별'))}</h3>
        <div class="daybars${bars.bars.length > 16 ? ' dense' : ''}" role="list">${bars.bars
            .map((x) => {
              const full = x.kind === 'week' ? `${dayName(x.from)}–${dayName(x.to)}` : dayLabel(x.key);
              const short = x.kind === 'week' ? t('{n}주차', { n: Number(x.key.slice(1)) + 1 }) : dayShort(x.key);
              return `<div role="listitem" title="${esc(full)} ${bm(x.value)}" aria-label="${esc(full)} ${bm(x.value)}"><i style="height:${(x.value / barMax) * 100}%"></i><span${x.label ? '' : ' aria-hidden="true" class="off"'}>${esc(short)}</span></div>`;
            })
            .join('')}</div>
        ${hasOut ? `<p class="fine">${esc(t('‘일정 외’는 여행 기간을 줄여 사라진 날의 지출이에요. 원래 날짜로 남아 있고 합계에 들어가요.'))}</p>` : ''}
        <h3 style="margin-top:16px">${esc(t('결제 수단'))}</h3>${barRows(s.byPay, B.PAYMENTS, Math.max(1, ...Object.values(s.byPay)))}
      </div>
    </div>

    <div class="box" style="margin-top:14px">
      <h3>${esc(t('기록'))} <button class="link" data-b="csv"${recs.length ? '' : ' hidden'}>${esc(t('CSV로 받기'))}</button></h3>
      ${payFilterHtml()}
      ${
          shown.length
            ? `<ul class="rec-list">${shown
                .map((e) => {
                  if (ctx.ui.editExpense === e.id && !ctx.ui.readonly) return expenseEditHtml(e);
                  const c = B.EXPENSE_CATS[e.cat] ?? B.EXPENSE_CATS.etc;
                  const pay = B.PAYMENTS[e.pay] ?? B.PAYMENTS.card;
                  // 적은 통화가 지금 보여 주는 기준 통화와 다르면 원래 금액과 그때 적용한 환율을 함께
                  const origCode = e.ccy ?? (e.cur === 'KRW' ? 'KRW' : b.currency);
                  const orig = origCode === shownBase(b) ? '' : origCode === 'KRW' ? B.won(e.amount) : B.moneyCode(e.amount, origCode);
                  const rate = origCode !== 'KRW' && e.rate > 0 ? expenseRateLabel(origCode, e.rate) : '';
                  const units = B.expenseBaseUnits(e, b);
                  const link = e.checkId ? t('체크리스트') : e.placeId ? t('장소') : '';
                  const who = payerLabel(e);
                  return `<li>
                  <span class="rec-main"><b>${esc(e.memo || t(c.label))}</b><small>${esc(B.expenseDayLabel(ctx.trip, e))} · ${esc(t(c.label))} · <span class="pay-tag" data-pay="${esc(e.pay)}">${esc(t(pay.label))}</span>${link ? ` · <span class="src-tag">${e.checkId ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : '<svg class="ic" aria-hidden="true"><use href="#i-pin"/></svg>'}${esc(link)}</span>` : ''}${who ? ` · ${esc(who)}` : ''}</small></span>
                  <span class="rec-amt">${units == null ? `<span class="pend">${esc(t('환율 미정'))}</span>` : bu(units)}${orig ? `<small>${esc(orig)}${rate ? ` · ${esc(rate)}` : ''}</small>` : ''}</span>
                  <span class="rec-acts"><button class="icon" data-b="edit" data-id="${e.id}" title="${esc(t('수정'))}" aria-label="${esc(t('{name} 수정', { name: e.memo || t(c.label) }))}">✎</button><button class="icon" data-b="del" data-id="${e.id}" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: e.memo || t(c.label) }))}">✕</button></span></li>`;
                })
                .join('')}</ul>`
            : recs.length
              ? `<p class="empty-note">${esc(t('이 결제수단으로 적은 지출이 없어요'))}</p>`
              : `<p class="empty-note">${esc(t('아직 기록된 지출이 없어요. 첫 지출을 추가해 보세요.'))}</p>`
        }
    </div>
    <p class="fine">${esc(t('가계부는 이 브라우저에만 저장되고 공유 링크에는 들어가지 않아요. 백업 파일에는 포함돼요. 자동 환율: ExchangeRate-API (하루 1번 갱신).'))}</p>
  </div>`;
  }

  /** 기록 시점 환율 표시: "100엔 = 912원" (그 기록에 남긴 환율이라 지금 환율을 바꿔도 그대로) */
  function expenseRateLabel(code, rate) {
    const c = B.CURRENCIES[code];
    if (!c) return '';
    return t('적용 환율 {unit}{name} = {krw}원', { unit: c.unit === 1 ? '1' : c.unit, name: t(c.name), krw: num(+(rate * c.unit).toFixed(2), { maximumFractionDigits: 2 }) });
  }

  /** 결제수단 필터 칩: 수단별 건수·합계(기준 통화). 누르면 그 수단 기록만, 다시 누르면 전체 */
  ctx.ui.payFilter = null;
  function payFilterHtml() {
    if (!ctx.trip.expenses.length) return '';
    const by = B.byPayment(ctx.trip);
    const all = B.spentUnits(ctx.trip);
    const chip = (key, label, units, n) => `<button type="button" class="${(ctx.ui.payFilter ?? '') === key ? 'on' : ''}" aria-pressed="${(ctx.ui.payFilter ?? '') === key}" data-b="pay-filter" data-v="${key}"><span>${esc(label)}</span> <b>${bu(units)}</b> <small>${esc(t('{n}건', { n }))}</small></button>`;
    const chips = [chip('', t('전체'), all, ctx.trip.expenses.length), ...Object.entries(B.PAYMENTS).filter(([k]) => by[k]).map(([k, p]) => chip(k, t(p.label), by[k].units, by[k].count))];
    const cur = ctx.ui.payFilter && by[ctx.ui.payFilter];
    return `<div class="chipset pay-filter" role="group" aria-label="${esc(t('결제수단별 보기'))}">${chips.join('')}</div>${cur ? `<p class="pay-sum" role="status">${esc(t('{pay} 합계', { pay: t(B.PAYMENTS[ctx.ui.payFilter].label) }))} <b>${bu(cur.units)}</b> · ${esc(t('{n}건', { n: cur.count }))}</p>` : ''}`;
  }

  /* ───────── 기준 통화 (C1) ───────── */
  /** 지금 실제로 보여 주는 기준 통화 (환율을 모르면 원화) */
  const shownBase = (b) => (B.krwPerBase(b) ? B.baseCode(b) : 'KRW');
  function budgetInputValue(b) {
    const v = B.toBase(b.total, b);
    return v == null ? num(b.total) : num(v, { maximumFractionDigits: B.fractionDigits(shownBase(b)) });
  }
  function baseRowHtml(b) {
    const code = B.baseCode(b);
    const rate = B.krwPerBase(b);
    const note = code === 'KRW'
      ? ''
      : rate
        ? `<span class="fine">${B.CURRENCIES[code].unit} ${esc(code)} = ${B.won(rate * B.CURRENCIES[code].unit)}</span>`
        : `<span class="pend">${esc(t('기준 통화 환율 미정 · 원화로 표시 중'))}</span> ${ctx.ui.readonly ? '' : `<button class="pill" data-b="rate">${esc(t('환율 받기'))}</button>`}`;
    return `<div class="base-row"><label><span>${esc(t('기준 통화'))}</span><select id="bBase" class="inp" data-ui-select aria-label="${esc(t('기준 통화'))}">${currencyOptions(code)}</select></label>${note}<small class="fine">${esc(t('합계·예산·정산을 이 통화로 보여 줘요'))}</small></div>`;
  }

  /* ───────── 통화별 합계 · 동행자 정산 ───────── */
  function currencyTotalsHtml(b, s) {
    if (!ctx.trip.expenses.length || b.currency === 'KRW') return '';
    const c = B.currencyTotals(ctx.trip);
    const parts = [
      c.localCount ? `${B.moneyCode(c.local, b.currency)} <small>(${esc(t('{n}건', { n: c.localCount }))})</small>` : '',
      c.krwCount ? `${B.won(c.krw)} <small>(${esc(t('{n}건', { n: c.krwCount }))})</small>` : '',
      ...Object.entries(c.other).map(([code, o]) => `${B.moneyCode(o.amount, code)} <small>(${esc(t('{n}건', { n: o.count }))})</small>`),
    ].filter(Boolean);
    return `<p class="cur-totals"><span>${esc(t('통화별 합계'))}</span> ${parts.join(' <i aria-hidden="true">+</i> ')} <span class="eq">= ${esc(t('{code} 환산', { code: shownBase(b) }))} <b>${bu(B.spentUnits(ctx.trip))}</b>${s.pending.count ? ` <span class="pend">${esc(t('환율 미정 {n}건 제외', { n: s.pending.count }))}</span>` : ''}</span></p>`;
  }

  /** 지출 입력: 동행이 2명 이상이면 낸 사람과 나눠 낼 사람을 고른다 */
  function shareFormHtml(f) {
    const list = S.members(ctx.trip);
    if (list.length < 2) return '';
    if (!list.some((m) => m.id === f.payer)) f.payer = list[0].id;
    const split = new Set(f.split ?? list.map((m) => m.id));
    return `<div class="share-row">
      <label class="payer"><span>${esc(t('낸 사람'))}</span><select id="bPayer" class="inp" data-ui-select>${list.map((m) => `<option value="${esc(m.id)}"${m.id === f.payer ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <div class="chipset split" role="group" aria-label="${esc(t('나눠 낼 사람'))}"><span class="split-lbl">${esc(t('나눠 낼 사람'))}</span>${list
          .map((m) => `<button class="${split.has(m.id) ? 'on' : ''}" aria-pressed="${split.has(m.id)}" data-b="split" data-v="${esc(m.id)}">${esc(m.name)}</button>`)
          .join('')}</div>
    </div>`;
  }
  function shareEditHtml(e) {
    const list = S.members(ctx.trip);
    if (list.length < 2) return '';
    const split = new Set(S.splitOf(ctx.trip, e));
    return `<div class="exp-row share-edit">
      <label><span>${esc(t('낸 사람'))}</span><select name="payer"><option value="">${esc(t('정하지 않음'))}</option>${list.map((m) => `<option value="${esc(m.id)}"${m.id === e.payer ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <fieldset class="split-edit"><legend>${esc(t('나눠 낼 사람'))}</legend>${list
          .map((m) => `<label><input type="checkbox" name="split" value="${esc(m.id)}"${split.has(m.id) ? ' checked' : ''}> ${esc(m.name)}</label>`)
          .join('')}</fieldset>
    </div>`;
  }
  function payerLabel(e) {
    if (S.members(ctx.trip).length < 2) return '';
    const m = S.members(ctx.trip).find((x) => x.id === e.payer);
    if (!m) return t('결제자 미정');
    const split = S.splitOf(ctx.trip, e);
    return split.length === S.members(ctx.trip).length ? t('{name} 결제', { name: m.name }) : t('{name} 결제 · {n}명 분담', { name: m.name, n: split.length });
  }

  function settleBoxHtml() {
    const list = S.members(ctx.trip);
    const st = settleNow();
    const chips = list
      .map((m) => `<li><span>${esc(m.name)}</span>${ctx.ui.readonly ? '' : `<button type="button" class="icon" data-b="member-del" data-id="${esc(m.id)}" aria-label="${esc(t('{name} 빼기', { name: m.name }))}">✕</button>`}</li>`)
      .join('');
    const body = st
      ? `<table class="settle-table"><thead><tr><th>${esc(t('이름'))}</th><th>${esc(t('낸 돈'))}</th><th>${esc(t('부담'))}</th><th>${esc(t('차액'))}</th></tr></thead><tbody>${st.people
          .map((p) => `<tr><td>${esc(p.name)}</td><td>${bu(p.paid)}</td><td>${bu(p.share)}</td><td class="${p.net > 0 ? 'plus' : p.net < 0 ? 'minus' : ''}">${p.net > 0 ? '+' : p.net < 0 ? '−' : ''}${bu(Math.abs(p.net))}</td></tr>`)
          .join('')}</tbody><tfoot><tr><th>${esc(t('합계'))}</th><td>${bu(st.total)}</td><td>${bu(st.people.reduce((n, p) => n + p.share, 0))}</td><td></td></tr></tfoot></table>
      ${st.counted ? `<p class="fine">${esc(t('결제 수단'))} · ${Object.entries(B.PAYMENTS)
        .filter(([key]) => Object.hasOwn(st.byPay, key))
        .map(([key, pay]) => `${esc(t(pay.label))} ${bu(st.byPay[key])}`).join(' · ')}</p>` : ''}
      <h4>${esc(t('보낼 돈'))} <small>${esc(t('최소 {n}번 송금', { n: st.transfers.length }))}</small></h4>
      ${st.transfers.length ? `<ul class="transfers">${st.transfers.map((x) => `<li><b>${esc(x.from)}</b> → <b>${esc(x.to)}</b><span>${bu(x.amount)}</span></li>`).join('')}</ul>` : `<p class="empty-note">${esc(t('주고받을 돈이 없어요'))}</p>`}
      ${st.noPayer || st.noRate ? `<p class="fine">${[st.noPayer ? t('결제자를 정하지 않은 지출 {n}건은 빠졌어요', { n: st.noPayer }) : '', st.noRate ? t('환율 미정 지출 {n}건은 빠졌어요', { n: st.noRate }) : ''].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      <button type="button" class="btn" data-b="settle-copy">${esc(t('정산 결과 복사'))}</button>`
      : `<p class="empty-note">${esc(t('동행자를 2명 이상 넣으면 지출마다 낸 사람과 나눠 낼 사람을 고르고, 누가 누구에게 얼마를 보내면 되는지 계산해요.'))}</p>`;
    return `<details class="box settle"${list.length >= 2 ? ' open' : ''} style="margin-top:14px">
      <summary><h3>${esc(t('동행자 · 정산하기'))}</h3>${st ? `<span class="count">${esc(t('{n}명', { n: list.length }))}</span>` : ''}</summary>
      <ul class="members">${chips}</ul>
      ${ctx.ui.readonly ? '' : `<form id="memberForm" class="addrow"><input id="memberName" data-draft="member" maxlength="20" autocomplete="off" placeholder="${esc(list.length ? t('동행자 이름') : t('먼저 내 이름(예: 나)'))}" aria-label="${esc(t('동행자 이름'))}"><button type="submit">${esc(t('추가'))}</button></form>`}
      ${body}
    </details>`;
  }
  function addMemberFromInput() {
    const input = $('#memberName');
    if (!input || ctx.ui.readonly) return;
    const name = input.value.trim();
    if (!name) return input.focus();
    const m = S.addMember(ctx.trip, name);
    if (!m) {
      toast(S.members(ctx.trip).length >= S.MAX_MEMBERS ? t('동행자는 {n}명까지 넣을 수 있어요', { n: S.MAX_MEMBERS }) : t('같은 이름이 이미 있어요'));
      return input.focus();
    }
    input.value = '';
    saved(commit(), t('{name}을(를) 동행자로 넣었어요', { name: m.name }));
    $('#memberName')?.focus();
  }

  /** 저장한 지출 고치기 (행 안에서) */
  function expenseEditHtml(e) {
    const b = ctx.trip.budget;
    // 이 기록을 적은 통화로 보여 준다 (현지 통화를 나중에 바꿨어도 그때 통화 그대로, GPT 2차 #6)
    const recCode = e.cur !== 'KRW' ? e.ccy ?? b.currency : b.currency;
    const local = recCode !== 'KRW';
    const dk = B.expenseDay(ctx.trip, e);
    const days = [-1, ...ctx.trip.days.map((_, i) => i)];
    const opt = (v, label, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    return `<li class="rec-edit"><form class="exp-form" data-exp="${e.id}" aria-label="${esc(t('지출 수정'))}">
      <div class="exp-row">
        <label class="exp-amt"><span>${esc(t('금액'))}</span><input name="amount" data-draft="exp-amount-${e.id}" inputmode="decimal" value="${e.amount}" autocomplete="off"></label>
        ${local ? `<label><span>${esc(t('통화'))}</span><select name="cur" data-ui-select>${opt('local', `${B.currencySymbol(recCode)} ${recCode}`, e.cur !== 'KRW')}${opt('KRW', '₩ KRW', e.cur === 'KRW')}</select></label>` : ''}
      </div>
      <label><span>${esc(t('메모'))}</span><input name="memo" data-draft="exp-memo-${e.id}" value="${esc(e.memo)}" maxlength="80"></label>
      <div class="exp-row">
        <label><span>${esc(t('언제'))}</span><select name="day" data-ui-select>${dk === 'out' ? opt('out', B.expenseDayLabel(ctx.trip, e), true) : ''}${days.map((d) => opt(d, d < 0 ? t('출발 전') : dayName(d), d === dk)).join('')}</select></label>
        <label><span>${esc(t('분류'))}</span><select name="cat" data-ui-select>${Object.entries(B.EXPENSE_CATS).map(([key, c]) => opt(key, t(c.label), key === e.cat)).join('')}</select></label>
        <label><span>${esc(t('결제 수단'))}</span><select name="pay" data-ui-select>${Object.entries(B.PAYMENTS).map(([key, c]) => opt(key, t(c.label), key === e.pay)).join('')}</select></label>
      </div>
      ${shareEditHtml(e)}
      <p class="exp-krw" role="status">${esc(expensePreviewText(e, e.amount, e.cur))}</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="exp-actions"><button type="button" class="btn ghost" data-b="edit-cancel">${esc(t('취소'))}</button><button class="btn primary">${esc(t('저장'))}</button></div>
    </form></li>`;
  }

  /** 고치는 중: 원화가 어떻게 계산될지 미리 보여준다 */
  function expensePreviewText(e, amount, cur) {
    const same = B.parseAmount(amount) === e.amount && cur === e.cur;
    if (same) return e.krw == null ? t('원화: 환율 미정') : t('원화 {krw} (기록 당시 그대로)', { krw: B.won(e.krw) });
    const p = B.expenseKrwPreview(ctx.trip, e, { amount, cur });
    if (!p) return '';
    if (p.source === 'krw') return t('원화 {krw}', { krw: B.won(p.krw) });
    if (p.source === 'none') return t('원화: 환율 미정 (환율을 정하면 채워져요)');
    const code = B.editCurrency(ctx.trip, e, cur); // 이 기록의 통화 (현지 통화를 나중에 바꿨어도, GPT 4차 #2)
    const unit = B.CURRENCIES[code].unit;
    const rate = `${unit} ${t(B.CURRENCIES[code].name)} = ${num(p.rate * unit, { maximumFractionDigits: 2 })} KRW`;
    return t(p.source === 'recorded' ? k('원화 {krw} · 기록 당시 환율 {rate}') : k('원화 {krw} · 지금 환율 {rate}'), { krw: B.won(p.krw), rate });
  }

  function updateKrwPreview() {
    const out = $('#bKrw');
    if (!out || !ctx.trip) return;
    const raw = $('#bAmount')?.value ?? '';
    const amt = B.parseAmount(raw);
    const b = ctx.trip.budget;
    const local = b.currency !== 'KRW' && ctx.ui.bf.cur === 'local';
    if (!(amt > 0) || !local) return void (out.textContent = '');
    const krw = B.toKrw(amt, 'local', b);
    out.textContent = krw != null ? `≈ ${B.won(krw)}` : t('환율 미정 · 원화는 나중에 채워져요');
  }

  let rateRequest = 0;
  async function fetchRate({ quiet = false } = {}) {
    const b = ctx.trip.budget;
    const base = B.baseCode(b);
    const local = b.currency;
    const needBase = base !== 'KRW' && base !== b.currency;
    if (b.currency === 'KRW' && !needBase) return;
    const forTrip = ctx.trip;
    const seq = ++rateRequest; // 가장 최근 요청의 결과만 성공·실패를 알린다 (GPT 4차 #7, 5차 #7)
    try {
      const r = await fetch(RATE_API, { signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      if (ctx.trip !== forTrip || seq !== rateRequest) return;
      // 기준 환율과 현지 환율은 따로 판단: 그사이 기준 통화만 바뀌었으면 기준 환율은 버리고 현지 환율은 그대로 반영한다
      const baseStill = B.baseCode(b) === base;
      if (b.currency !== local) return; // 현지 통화까지 바뀌었으면 이 응답은 버린다
      if (needBase && !baseStill && b.currency === 'KRW') return; // 원화 여행: 버릴 기준 환율뿐이라 알리지도 않는다
      if (needBase && baseStill) {
        const bp = data?.rates?.[base];
        if (bp > 0) {
          // 응답이 오는 사이 기준 통화를 또 바꿨으면(USD → EUR) 늦게 온 USD 환율로 EUR 환율을 덮지 않는다 (GPT 3차 #10)
          b.baseKrwPerUnit = 1 / bp;
          b.baseRateCode = base; // 요청할 때의 기준 통화 (그사이 기준 통화를 바꿨으면 krwPerBase가 쓰지 않는다)
          b.baseRateAt = new Date().toISOString();
        } else if (b.currency === 'KRW') throw new Error('no rate');
      }
      if (b.currency === 'KRW') {
        ctx.ui.rateError = false;
        saved(commit({ auto: quiet }), quiet ? '' : t('기준 통화 환율을 받았어요: 1 {code} = {krw}', { code: base, krw: B.won(b.baseKrwPerUnit) }));
        return;
      }
      const per = data?.rates?.[b.currency];
      if (!(per > 0)) throw new Error('no rate');
      b.krwPerUnit = 1 / per;
      b.rateSource = 'auto';
      b.rateAt = new Date().toISOString();
      ctx.ui.rateError = false;
      const filled = B.fillPendingKrw(ctx.trip);
      const res = commit({ auto: quiet && !filled });
      if (filled) saved(res, t('환율을 받아서 환율 미정이던 {n}건을 원화로 계산했어요', { n: filled }), 3200);
      else if (!quiet) saved(res, t('환율을 받았어요: {rate}', { rate: B.rateLabel(b) }));
    } catch {
      if (ctx.trip !== forTrip || seq !== rateRequest) return; // 그사이 새 요청이 있었으면 옛 요청의 실패는 알리지 않는다
      ctx.ui.rateError = !quiet || ctx.ui.rateError;
      if (!quiet && prefs.page === 'budget') renderBudget();
    }
  }

  function addExpenseFromForm() {
    const b = ctx.trip.budget;
    const err = $('#bError');
    if (B.needsCurrency(ctx.trip)) {
      err.textContent = t('먼저 위에서 현지 통화를 확인해 주세요');
      err.hidden = false;
      focusSelect($('#bConfirmCur'));
      return;
    }
    const data = { amount: $('#bAmount').value, cur: ctx.ui.bf.cur === 'local' && b.currency !== 'KRW' ? 'local' : 'KRW', cat: ctx.ui.bf.cat, pay: ctx.ui.bf.pay, day: ctx.ui.bf.day, memo: $('#bMemo').value };
    const problem = B.expenseProblem(data, b);
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      $('#bAmount').setAttribute('aria-invalid', 'true');
      $('#bAmount').focus();
      return;
    }
    const e = B.addExpense(ctx.trip, data);
    if (S.members(ctx.trip).length >= 2) S.setExpenseShare(ctx.trip, e, { payer: ctx.ui.bf.payer, split: ctx.ui.bf.split ?? undefined });
    const r = commit();
    if (!r.ok) return; // 저장하지 못함: 위 안내를 본다 (입력한 지출은 화면에 남아 있다)
    $('#bAmount').value = '';
    $('#bMemo').value = '';
    updateKrwPreview();
    toast(e.krw == null ? t('{amount} 기록했어요. 원화는 환율을 받으면 계산해요', { amount: B.moneyCode(e.amount, b.currency) }) : t('{amount} 기록했어요', { amount: bm(e.krw) }), e.krw == null ? 3200 : 2200);
    $('#bAmount')?.focus();
  }

  $('#page-budget').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-b]');
    if (!btn || !ctx.trip) return;
    const f = budgetForm();
    const act = btn.dataset.b;
    if (act === 'cat' || act === 'pay') {
      f[act] = btn.dataset.v;
      $$(`[data-b="${act}"]`, $('#page-budget')).forEach((x) => {
        x.classList.toggle('on', x === btn);
        x.setAttribute('aria-pressed', String(x === btn));
      });
    } else if (act === 'pay-filter') {
      ctx.ui.payFilter = btn.dataset.v || null;
      renderBudget();
      $(`#page-budget [data-b="pay-filter"][data-v="${CSS.escape(btn.dataset.v)}"]`)?.focus();
    } else if (act === 'cur') {
      f.cur = f.cur === 'local' ? 'KRW' : 'local';
      renderBudget();
      $('#page-budget [data-b="cur"]')?.focus();
    } else if (act === 'cur-ok') {
      B.confirmCurrency(ctx.trip, $('#bConfirmCur').value);
      saved(commit(), t('현지 통화를 {code}(으)로 정했어요', { code: ctx.trip.budget.currency }));
      if (ctx.trip.budget.currency !== 'KRW' && !(ctx.trip.budget.krwPerUnit > 0)) fetchRate({ quiet: true });
      $('#bAmount')?.focus();
    } else if (act === 'add') addExpenseFromForm();
    else if (act === 'rate') fetchRate();
    else if (act === 'edit') {
      ctx.ui.editExpense = btn.dataset.id;
      renderBudget();
      $(`#page-budget .exp-form[data-exp="${CSS.escape(btn.dataset.id)}"] input[name="amount"]`)?.focus();
    } else if (act === 'split') {
      const all = S.members(ctx.trip).map((m) => m.id);
      const cur = new Set(f.split ?? all);
      if (cur.has(btn.dataset.v)) {
        if (cur.size > 1) cur.delete(btn.dataset.v); // 적어도 한 명은 남긴다
      } else cur.add(btn.dataset.v);
      f.split = cur.size === all.length ? null : [...cur];
      renderBudget();
      $(`#page-budget [data-b="split"][data-v="${CSS.escape(btn.dataset.v)}"]`)?.focus();
    } else if (act === 'member-del') {
      const m = S.members(ctx.trip).find((x) => x.id === btn.dataset.id);
      const used = ctx.trip.expenses.filter((x) => x.payer === btn.dataset.id).length;
      if (!m || (used && !confirm(t('{name}이(가) 결제한 지출 {n}건의 결제자가 비워져요. 뺄까요?', { name: m.name, n: used })))) return;
      S.removeMember(ctx.trip, m.id);
      if (f.payer === m.id) f.payer = null;
      if (f.split) f.split = f.split.filter((x) => x !== m.id);
      saved(commit(), t('{name}을(를) 동행자에서 뺐어요', { name: m.name }));
      $('#memberName')?.focus();
    } else if (act === 'settle-copy') {
      const st = settleNow();
      if (st) copyText(S.settlementText(ctx.trip, st, bu), t('정산 결과를 복사했어요. 메신저에 붙여넣으세요'));
    } else if (act === 'edit-cancel') {
      const id = ctx.ui.editExpense;
      ctx.ui.editExpense = null;
      renderBudget();
      $(`#page-budget [data-b="edit"][data-id="${CSS.escape(id)}"]`)?.focus();
    }
    else if (act === 'to-check') go('check');
    else if (act === 'del') {
      const ex = ctx.trip.expenses.find((x) => x.id === btn.dataset.id);
      const linked = ex?.checkId && ctx.trip.checks?.find((c) => c.id === ex.checkId);
      if (confirm(linked ? t('이 기록을 지울까요? 체크리스트의 "{text}" 체크도 풀려요.', { text: linked.text }) : t('이 기록을 지울까요?'))) {
        B.removeExpense(ctx.trip, btn.dataset.id);
        if (linked) linked.done = false; // 체크리스트와 맞춘다
        commit();
      }
    } else if (act === 'csv') {
      const blob = new Blob([B.expensesCsv(ctx.trip)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${M.safeFileName(ctx.trip.title)}-${t('가계부')}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });
  $('#page-budget').addEventListener('submit', (ev) => {
    if (ev.target.id === 'memberForm') {
      ev.preventDefault();
      return addMemberFromInput();
    }
    const form = ev.target.closest('.exp-form');
    if (!form) return;
    ev.preventDefault();
    const id = form.dataset.exp;
    const data = Object.fromEntries(new FormData(form));
    const problem = B.amountProblem(data.amount);
    const err = $('.form-error', form);
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      form.amount.setAttribute('aria-invalid', 'true');
      form.amount.focus();
      return;
    }
    const e = B.updateExpense(ctx.trip, id, data);
    if (!e) return;
    if (form.payer) S.setExpenseShare(ctx.trip, e, { payer: form.payer.value, split: [...form.querySelectorAll('input[name="split"]:checked')].map((x) => x.value) });
    const linked = e.checkId && ctx.trip.checks?.find((c) => c.id === e.checkId);
    ctx.ui.editExpense = null;
    const r = commit();
    if (!r.ok) ctx.ui.editExpense = id; // 저장 실패: 고치던 칸을 그대로 열어 둔다 (위 안내 참고)
    else {
      toast(t('지출을 고쳤어요'));
      $(`#page-budget [data-b="edit"][data-id="${CSS.escape(id)}"]`)?.focus();
    }
    void linked;
  });
  $('#page-budget').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ctx.ui.editExpense) {
      const id = ctx.ui.editExpense;
      ctx.ui.editExpense = null;
      renderBudget();
      $(`#page-budget [data-b="edit"][data-id="${CSS.escape(id)}"]`)?.focus();
    }
  });
  $('#page-budget').addEventListener('input', (e) => {
    const form = e.target.closest('.exp-form');
    if (form) {
      const ex = ctx.trip.expenses.find((x) => x.id === form.dataset.exp);
      const amt = form.amount.value;
      const problem = amt.trim() ? B.amountProblem(amt) : B.amountProblem('');
      const err = $('.form-error', form);
      err.hidden = !problem;
      err.textContent = problem ?? '';
      $('.exp-krw', form).textContent = problem ? '' : expensePreviewText(ex, amt, form.cur?.value ?? ex.cur);
      return;
    }
    if (e.target.id === 'bAmount') {
      updateKrwPreview();
      const v = e.target.value;
      const problem = v.trim() ? B.amountProblem(v) : null;
      const err = $('#bError');
      err.hidden = !problem;
      err.textContent = problem ?? '';
      if (problem) e.target.setAttribute('aria-invalid', 'true');
      else e.target.removeAttribute('aria-invalid');
    }
  });
  $('#page-budget').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'bAmount' || e.target.id === 'bMemo')) {
      e.preventDefault();
      addExpenseFromForm();
    }
  });
  $('#page-budget').addEventListener('change', (e) => {
    const form = e.target.closest('.exp-form');
    if (form) {
      const ex = ctx.trip.expenses.find((x) => x.id === form.dataset.exp);
      if (!B.amountProblem(form.amount.value)) $('.exp-krw', form).textContent = expensePreviewText(ex, form.amount.value, form.cur?.value ?? ex.cur);
      return;
    }
    const b = ctx.trip.budget;
    if (e.target.id === 'bTotal') {
      const v = B.parseAmount(e.target.value);
      if (v != null && !(v >= 0 && v <= B.MAX_AMOUNT)) {
        toast(t('예산은 0 이상 {max} 이하 숫자로 넣어 주세요', { max: num(B.MAX_AMOUNT) }), 3200);
        e.target.value = b.total ? budgetInputValue(b) : '';
        return;
      }
      b.total = Math.max(0, B.fromBase(v || 0, b)); // 저장은 원화
      commit();
    } else if (e.target.id === 'bRate') {
      const v = B.parseAmount(e.target.value);
      if (v != null && !(v > 0)) {
        toast(t('환율은 0보다 큰 숫자로 넣어 주세요'), 3200);
        return renderBudget();
      }
      b.krwPerUnit = v > 0 ? v / B.CURRENCIES[b.currency].unit : 0;
      b.rateSource = 'manual';
      b.rateAt = new Date().toISOString();
      ctx.ui.rateError = false;
      const filled = B.fillPendingKrw(ctx.trip);
      saved(commit(), filled ? t('환율 미정이던 {n}건을 원화로 계산했어요', { n: filled }) : '');
    } else if (e.target.id === 'bCurrency') {
      B.confirmCurrency(ctx.trip, e.target.value);
      commit();
      fetchRate({ quiet: true });
    } else if (e.target.id === 'bDay') {
      budgetForm().day = Number(e.target.value);
    } else if (e.target.id === 'bBase') {
      if (!B.setBase(ctx.trip, e.target.value)) return;
      const b2 = ctx.trip.budget;
      saved(commit(), t('기준 통화를 {code}(으)로 바꿨어요', { code: B.baseCode(b2) }));
      if (!B.krwPerBase(b2)) fetchRate({ quiet: true });
      focusSelect($('#bBase'));
    } else if (e.target.id === 'bPayer') {
      budgetForm().payer = e.target.value;
    }
  });

  drawPage = renderBudget;
  requestRate = fetchRate;
}
