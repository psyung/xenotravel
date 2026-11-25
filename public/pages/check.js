import * as B from '../lib/budget.js';
import * as C from '../lib/checklist.js';
import { t, k, getLang } from '../lib/i18n.js';

let drawPage, showPresets;
export { drawPage as renderChecks };

export function init(ctx) {
  const { $, $$, esc, TODAY, prefs, store, persistSoon, commit, saved, askDialog, ask, render, bm, go, toast, pushUndo, keepDrafts } = ctx;

  /* ───────── 체크리스트 ─────────
   * 체크 = 할 일 완료(쇼핑은 샀음). 예상 가격이 있는 항목을 체크하면 그 금액으로 가계부에 실제 결제가 기록된다.
   * 실제로 낸 돈이 다르면 '결제' 칩에서 고친다 (예상 가격은 그대로). 체크를 풀 때는 그 지출을 지울지 남길지 묻는다.
   */
  /** 나라별 추천 쇼핑 목록 담기 버튼 (아직 안 담은 품목이 있는 목록만) */
  function picksHtml() {
    if (ctx.ui.readonly) return '';
    return C.shopPickSets(ctx.trip)
      .map((set) => {
        const n = C.missingPicks(ctx.trip, set).length;
        if (!n) return '';
        return `<button class="picks-btn" data-c="picks" data-set="${esc(set.id)}">${esc(t('{title} {n}개 담기', { title: t(set.title), n }))}<small>${esc(t(set.note || k('한국 여행자들이 많이 사는 품목이에요')))}</small></button>`;
      })
      .join('');
  }

  ctx.ui.editPrice = null; // 가격을 고치는 중인 체크 항목 id
  ctx.ui.editPaid = null; // 실제 결제 금액을 고치는 중인 체크 항목 id
  ctx.ui.priceCur = 'local';

  /** 체크 항목 가격 표시: "¥1,000 JPY" (원화로 적었으면 "₩25,000") */
  function priceLabel(c) {
    if (!(c.price > 0)) return '';
    const budget = B.ensureBudget(ctx.trip);
    return c.cur === 'KRW' || budget.currency === 'KRW' ? B.won(c.price) : B.moneyCode(c.price, budget.currency);
  }
  const expenseLabel = (e) => (e.cur === 'KRW' ? B.won(e.amount) : B.moneyCode(e.amount, ctx.trip.budget.currency));

  function checkRowHtml(c) {
    const budget = B.ensureBudget(ctx.trip);
    const local = budget.currency !== 'KRW';
    const paid = c.done ? C.linkedExpense(ctx.trip, c.id) : null;
    let price;
    if (ctx.ui.editPrice === c.id || ctx.ui.editPaid === c.id) {
      const paidMode = ctx.ui.editPaid === c.id;
      const cur = paidMode ? (paid?.cur === 'KRW' ? 'KRW' : 'local') : local ? ctx.ui.priceCur : 'KRW';
      const sym = cur === 'KRW' ? '₩' : B.CURRENCIES[budget.currency].symbol.trim();
      price = `<form class="price-form" data-id="${c.id}" data-mode="${paidMode ? 'paid' : 'price'}">
        ${local && !paidMode ? `<button type="button" class="cur-mini" data-c="pcur" aria-label="${esc(t('통화 바꾸기: 지금 {cur}', { cur: cur === 'KRW' ? 'KRW' : budget.currency }))}">${esc(sym)}</button>` : `<span class="cur-mini" aria-hidden="true">${esc(sym)}</span>`}
        <input name="amt" data-draft="price-${c.id}" inputmode="decimal" autocomplete="off" aria-label="${esc(paidMode ? t('{name} 실제 결제 금액', { name: C.checkText(c) }) : t('{name} 예상 가격', { name: C.checkText(c) }))}" placeholder="${esc(paidMode ? t('실제 결제') : t('예상 가격'))}" value="${paidMode ? paid?.amount ?? '' : c.price > 0 ? c.price : ''}">
        <button class="ok">${esc(t('확인'))}</button>
      </form>`;
    } else {
      price = `<button class="price-chip${c.price > 0 ? ' set' : ''}" data-c="price" data-id="${c.id}" title="${esc(t('예상 가격 (가계부 예상에 잡혀요)'))}" aria-label="${esc(c.price > 0 ? t('{name} 예상 가격 {amount} 고치기', { name: C.checkText(c), amount: priceLabel(c) }) : t('{name} 예상 가격 넣기', { name: C.checkText(c) }))}">${c.price > 0 ? `${esc(t('예상'))} ${esc(priceLabel(c))}` : esc(t('+ 가격'))}</button>`;
      if (paid) price += `<button class="price-chip paid" data-c="paid" data-id="${c.id}" title="${esc(t('가계부에 기록된 실제 결제 금액이에요. 눌러서 고쳐요'))}" aria-label="${esc(t('{name} 실제 결제 {amount} 고치기', { name: C.checkText(c), amount: expenseLabel(paid) }))}">${esc(t('결제'))} ${esc(expenseLabel(paid))}</button>`;
    }
    return `<li class="${c.done ? 'done' : ''}${ctx.ui.editPrice === c.id || ctx.ui.editPaid === c.id ? ' editing' : ''}">
      <label><input type="checkbox" data-c="toggle" data-id="${c.id}"${c.done ? ' checked' : ''}><span>${esc(C.checkText(c))}</span></label>
      ${price}
      <button class="icon" data-c="del" data-id="${c.id}" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: C.checkText(c) }))}">✕</button>
    </li>`;
  }

  const checkViews = new Map();
  const checkShortLabels = () => ({ todo: t('출발 전 체크'), pack: t('짐 싸기'), shop: t('쇼핑') });
  /** 400px 이하에서 쓰는 더 짧은 탭 이름 (네 언어 모두 한 줄에 들어가게) */
  const CHECK_TINY = {
    ko: { todo: '출발 전', pack: '짐 싸기', shop: '쇼핑' },
    en: { todo: 'Pre-trip', pack: 'Packing', shop: 'Shopping' },
    zh: { todo: '出发前', pack: '行李打包', shop: '购物' },
    ja: { todo: '出発前', pack: '荷造り', shop: '買い物' },
  };

  function checkView(id = ctx.trip.id) {
    if (!checkViews.has(id)) checkViews.set(id, { group: 'todo', drafts: {} });
    return checkViews.get(id);
  }

  function renderChecks() {
    const before = JSON.stringify([ctx.trip.checksV, ctx.trip.checks?.length]);
    C.ensureChecks(ctx.trip);
    // 처음 만들었거나 예전 자동 쇼핑 목록을 정리했으면 저장
    if (!ctx.ui.readonly && before !== JSON.stringify([ctx.trip.checksV, ctx.trip.checks.length])) {
      store.trips[ctx.trip.id] = ctx.trip;
      persistSoon();
    }
    const el = $('#page-check');
    if (el.dataset.trip === ctx.trip.id) keepDrafts(el, () => drawChecks(el));
    else {
      if (el.dataset.trip) {
        const previous = checkView(el.dataset.trip);
        previous.drafts = Object.fromEntries($$('[data-draft]', el).map((input) => [input.dataset.draft, input.value]));
        previous.editor = { editPrice: ctx.ui.editPrice, editPaid: ctx.ui.editPaid, priceCur: ctx.ui.priceCur };
      }
      const view = checkView();
      ctx.ui.editPrice = view.editor?.editPrice ?? null;
      ctx.ui.editPaid = view.editor?.editPaid ?? null;
      ctx.ui.priceCur = view.editor?.priceCur;
      el.dataset.trip = ctx.trip.id;
      drawChecks(el);
      for (const input of $$('[data-draft]', el)) input.value = view.drafts[input.dataset.draft] ?? input.value;
    }
    if (ctx.ui.editPrice || ctx.ui.editPaid) {
      const input = $(`#page-check .price-form[data-id="${ctx.ui.editPrice || ctx.ui.editPaid}"] input`);
      if (document.activeElement !== input) {
        input?.focus();
        input?.select();
      }
    }
  }

  function drawChecks(el) {
    const plan = C.planned(ctx.trip);
    const active = checkView().group;
    const groups = Object.entries(C.CHECK_GROUPS);
    const shortLabels = checkShortLabels();
    const tinyLabels = CHECK_TINY[getLang()] ?? CHECK_TINY.ko;
    el.innerHTML = `<div class="wrap">
    <h1 class="page-h">${esc(t('체크리스트'))}</h1>
    <ul class="page-sub check-legend">
      <li><b>${esc(t('체크'))}</b> ${esc(t('할 일을 끝냈거나 샀다는 표시예요.'))}</li>
      <li><b>${esc(t('예상'))}</b> ${esc(t('가격을 넣으면 가계부 “예상”에 잡혀요.'))}</li>
      <li><b>${esc(t('결제'))}</b> ${esc(t('가격이 있는 항목을 체크하면 그 금액이 가계부에 실제 지출로 기록돼요. 실제로 낸 돈이 다르면 ‘결제’ 금액을 고치세요.'))}</li>
    </ul>
    ${
        plan.priced
          ? `<div class="plan-bar"><span>${esc(t('체크리스트 예상'))} <b>${bm(plan.total)}</b>${plan.noRate ? ` <small>(${esc(t('환율이 없어 {n}개 빠짐', { n: plan.noRate }))})</small>` : ''}</span><button class="linkbtn" data-c="to-budget">${esc(t('가계부에서 보기 →'))}</button></div>`
          : ''
      }
    ${ctx.ui.readonly ? '' : `<div class="preset-cta"><button type="button" class="btn" data-c="presets" aria-haspopup="dialog">${esc(t('스마트 준비물 추천'))}</button><small>${esc(t('여행 성격과 기간에 맞춰 빠진 준비물만 골라 넣어요'))}</small></div>`}
    <div class="check-tabs" role="group" aria-label="${esc(t('체크리스트'))}">${groups.map(([g, def]) => {
        const { done, total } = C.progress(ctx.trip, g);
        return `<button data-c="tab" data-group="${g}" aria-controls="check-panel-${g}" aria-pressed="${g === active}" aria-label="${esc(`${t(def.label)} ${done}/${total}`)}" class="${total && done === total ? 'complete' : ''}"><span class="lbl-short">${esc(shortLabels[g])}</span><span class="lbl-tiny" aria-hidden="true">${esc(tinyLabels[g])}</span> <b>${done}/${total}</b></button>`;
      }).join('')}</div>
    <div class="grid3 check-grid">${groups
        .map(([g, def]) => {
          const p = C.progress(ctx.trip, g);
          const list = ctx.trip.checks.filter((c) => c.group === g);
          const sum = plan.byGroup[g] ?? 0;
          return `<section class="box" id="check-panel-${g}" data-active="${g === active}" aria-labelledby="chk-${g}">
          <header class="check-top">
            <h3 class="check-head" id="chk-${g}">${esc(t(def.label))}<span class="count">${p.done}/${p.total}</span></h3>
            <div class="bulk">
              <button data-c="toggle-group" data-group="${g}" ${p.total ? '' : 'disabled'}>${esc(p.total && p.done === p.total ? t('전체 해제') : t('전체 체크'))}</button>
              <button data-c="delete-group" data-group="${g}" ${p.total ? '' : 'disabled'}>${esc(t('삭제'))}</button>
            </div>
          </header>
          <div class="cprog" aria-hidden="true"><i style="width:${p.total ? (p.done / p.total) * 100 : 0}%"></i></div>
          <ul class="checks">${list.map(checkRowHtml).join('')}</ul>
          ${list.length ? '' : `<p class="empty-note">${esc(t('아직 항목이 없어요. 아래에서 추가하세요.'))}</p>`}
          ${sum ? `<p class="check-sum">${esc(t('예상 합계'))} <b>${bm(sum)}</b></p>` : ''}
          ${g === 'shop' ? picksHtml() : ''}
          <form class="addrow" data-group="${g}"><input name="text" data-draft="add-${g}" placeholder="${esc(t(def.placeholder))}" aria-label="${esc(t(def.placeholder))}" maxlength="80" autocomplete="off"><button>${esc(t('추가'))}</button></form>
        </section>`;
        })
        .join('')}</div>
  </div>`;
  }

  function savePrice(form) {
    const id = form.dataset.id;
    const v = form.amt.value;
    const problem = v.trim() ? B.amountProblem(v) : null;
    if (problem) {
      toast(problem, 3200);
      form.amt.focus();
      return;
    }
    if (form.dataset.mode === 'paid') {
      const e = C.linkedExpense(ctx.trip, id);
      ctx.ui.editPaid = null;
      if (e && v.trim()) B.updateExpenseAmount(ctx.trip, e.id, v);
      return void saved(commit(), e && v.trim() ? t('실제 결제 금액을 {amount}(으)로 고쳤어요', { amount: expenseLabel(e) }) : '');
    }
    const c = C.setPrice(ctx.trip, id, v, ctx.ui.priceCur);
    ctx.ui.editPrice = null;
    const r = commit();
    if (c?.price && B.toKrw(c.price, c.cur, ctx.trip.budget) == null) saved(r, t('가계부에서 환율을 정하면 원화 예상에 잡혀요'), 3200);
  }

  /**
   * P0-3·P0-4: 체크 해제로 지운 지출 되돌리기 — 지출을 되살리고 그 항목들을 다시 체크한다.
   * 그사이 다시 체크해 새 지출이 생겼으면 그 항목은 건드리지 않는다.
   */
  function uncheckUndo(checkIds, removed) {
    const tripId = ctx.trip.id;
    // 그사이 여행 날짜를 바꿔도 원래 날짜에 돌아가도록 일차 번호가 아니라 날짜를 기억한다
    const copies = removed.map((e) => ({ e: structuredClone(e), date: Number.isInteger(e.day) && e.day >= 0 ? e.date || ctx.trip.days[e.day]?.date || '' : '' }));
    return () => {
      if (ctx.trip?.id !== tripId || ctx.ui.readonly) return;
      for (const id of checkIds) {
        const c = ctx.trip.checks.find((x) => x.id === id);
        if (c && !c.done) c.done = true;
      }
      for (const { e, date } of copies) {
        if (ctx.trip.expenses.some((x) => x.id === e.id) || C.linkedExpense(ctx.trip, e.checkId)) continue;
        if (date) {
          const i = ctx.trip.days.findIndex((d) => d.date === date);
          if (i >= 0) {
            e.day = i;
            delete e.date;
          } else e.date = date; // 지금 여행 기간 밖이면 '일정 외'
        }
        ctx.trip.expenses.push(e);
      }
      saved(commit(), t('되돌렸어요'));
    };
  }

  $('#page-check').addEventListener('change', async (e) => {
    if (e.target.dataset.c !== 'toggle') return;
    const id = e.target.dataset.id;
    const c = ctx.trip.checks.find((x) => x.id === id);
    const linked = c?.done ? C.linkedExpense(ctx.trip, id) : null;
    const focus = () => $(`#page-check [data-c="toggle"][data-id="${CSS.escape(id)}"]`)?.focus();
    // P0-3: 자동 기록 그대로인 지출은 함께 지우고(실행 취소), 금액을 고친 지출이면 물어본다
    let drop = Boolean(linked);
    if (linked && C.expenseEdited(ctx.trip, c, linked)) {
      const tripId = ctx.trip.id;
      const choice = await ask({
        title: t('체크를 풀까요?'),
        body: t('결제 금액을 직접 고친 지출이 있어요: {amount}', { amount: expenseLabel(linked) }),
        actions: [
          { value: 'drop', label: t('지출도 삭제'), danger: true },
          { value: 'keep', label: t('체크만 해제'), primary: true },
        ],
      });
      if (ctx.trip?.id !== tripId || !c.done || (choice !== 'drop' && choice !== 'keep')) return void (ctx.trip && render());
      drop = choice === 'drop';
    }
    const r = C.toggleCheck(ctx.trip, id, TODAY, { dropExpense: drop });
    const res = commit();
    focus();
    if (r.expense) saved(res, `${r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: bm(r.expense.krw) })} · ${t('금액이 달랐다면 ‘결제’를 눌러 고치세요')}`, 3500);
    else if (r.removed && res.ok) pushUndo(t('체크를 풀고 가계부 지출 {amount}도 삭제했어요', { amount: expenseLabel(r.removed) }), uncheckUndo([id], [r.removed]));
    else if (linked) saved(res, t('체크를 풀었어요. 가계부 지출은 그대로 남겼어요'));
  });
  async function changeCheckGroup(group, action) {
    const id = ctx.trip.id;
    const items = () => ctx.trip.checks.filter((c) => c.group === group);
    const entries = items();
    if (!entries.length || ctx.ui.readonly || askDialog.open) return;
    const done = entries.filter((c) => c.done);
    const linked = (checks) => checks.map((c) => C.linkedExpense(ctx.trip, c.id)).filter(Boolean);
    const snapshot = () => JSON.stringify([items(), linked(items())]);
    const before = snapshot();
    const valid = () => ctx.trip?.id === id && !ctx.ui.readonly && prefs.page === 'check' && snapshot() === before;
    const restoreFocus = () => {
      const control = $(`#page-check [data-c="${action}"][data-group="${group}"]`);
      (control?.disabled ? $(`#check-panel-${group} .addrow input`) : control)?.focus({ preventScroll: true });
    };
    if (action === 'toggle-group') {
      const next = done.length !== entries.length;
      const expenses = linked(done);
      let dropExpenses = false;
      if (!next && expenses.length) {
        // P0-4: [체크 해제 + 지출 n건 삭제] [체크만 해제] [취소]. 금액을 직접 고친 지출은 지우지 않고 남긴다
        const edited = done.filter((c) => C.linkedExpense(ctx.trip, c.id) && C.expenseEdited(ctx.trip, c)).length;
        const deletable = expenses.length - edited;
        const choice = await ask({
          title: t('전체 해제'),
          body: `${t('연결된 지출 {n}건: {amounts}', { n: expenses.length, amounts: expenses.map(expenseLabel).join(', ') })}${edited ? ` ${t('직접 고친 지출 {n}건은 남겨요', { n: edited })}` : ''}`,
          actions: [
            ...(deletable ? [{ value: 'drop', label: t('체크 해제 + 지출 {n}건 삭제', { n: deletable }), primary: true }] : []),
            { value: 'keep', label: t('체크만 해제'), primary: !deletable },
          ],
        });
        if ((choice !== 'drop' && choice !== 'keep') || !valid()) return;
        dropExpenses = choice === 'drop';
      }
      const before = ctx.trip.expenses.length;
      const removed = C.setGroupDone(ctx.trip, group, next, TODAY, { dropExpenses });
      const added = ctx.trip.expenses.length - before + removed.length;
      const kept = next ? 0 : linked(done).length;
      const res = commit();
      if (removed.length && res.ok) {
        pushUndo(
          `${t('체크 해제 {n}건 · 가계부 지출 {m}건 삭제됨', { n: done.length, m: removed.length })}${kept ? ` (${t('직접 고친 지출 {n}건은 남겨요', { n: kept })})` : ''}`,
          uncheckUndo(done.map((c) => c.id), removed),
        );
      } else {
        saved(
          res,
          next
            ? added ? t('체크 {n}건 · 가계부 지출 {m}건 기록됨', { n: entries.length - done.length, m: added }) : t('{n}개를 체크했어요', { n: entries.length - done.length })
            : kept ? t('체크 해제 {n}건 (가계부 지출 {m}건은 유지됨)', { n: done.length, m: kept }) : t('{n}개를 해제했어요', { n: done.length }),
          added || kept ? 3500 : 2200,
        );
      }
      restoreFocus();
      return;
    }
    const kept = (checks) => t('기록된 실제 지출 {n}건은 가계부에 남아요', { n: linked(checks).length });
    // 완료·전체 수는 그룹의 실제 항목에서 다시 센다. 같은 수면 버튼 하나만 (중복 버튼 금지)
    const opt = C.bulkDeleteOptions(ctx.trip, group);
    const groupName = t(C.CHECK_GROUPS[group].label);
    const labels = {
      done: opt.done === opt.total ? t('전체 {n}개 삭제', { n: opt.total }) : t('완료한 {n}개 삭제', { n: opt.done }),
      all: t('전체 {n}개 삭제', { n: opt.total }),
    };
    const choice = await ask({
      title: opt.options.length === 1
        ? t('{group}: 전체 {n}개 항목을 삭제할까요?', { group: groupName, n: opt.total })
        : t('{group}: 완료 {done}개 · 전체 {total}개', { group: groupName, done: opt.done, total: opt.total }),
      body: opt.options.length === 1
        ? `${opt.done ? t('모두 완료한 항목이에요.') : t('완료한 항목 없음')} ${kept(entries)}`
        : `${t('미완료 {n}개가 남아 있어요.', { n: opt.total - opt.done })} ${kept(done)}`,
      actions: opt.options.map((v) => ({ value: v, label: labels[v], primary: v === 'done' && opt.options.length > 1, danger: v === 'all' || opt.options.length === 1 })),
    });
    if (!choice || !valid()) return;
    // 미완료 항목까지 지우는 경우에만 한 번 더 묻는다
    if (choice === 'all' && opt.done && opt.done < opt.total) {
      const confirmed = await ask({
        title: t('전체 {n}개 항목을 삭제할까요?', { n: opt.total }),
        body: `${t('미완료 {n}개도 함께 삭제돼요.', { n: opt.total - opt.done })} ${kept(entries)}`,
        actions: [{ value: 'all', label: t('전체 삭제'), danger: true }],
      });
      if (!confirmed || !valid()) return;
    }
    const all = choice === 'all' || opt.done === opt.total;
    const gone = all ? entries : done;
    const keptN = linked(gone).length;
    const undo = checksUndo(gone);
    const n = all ? C.clearGroup(ctx.trip, group) : C.removeDone(ctx.trip, group);
    const msg = all
      ? keptN ? t('{n}건 삭제됨 (가계부 지출 {m}건은 유지됨)', { n, m: keptN }) : t('{n}건 삭제됨', { n })
      : keptN ? t('체크 완료 {n}건 삭제됨 (가계부 지출 {m}건은 유지됨)', { n, m: keptN }) : t('체크 완료 {n}건 삭제됨', { n });
    if (commit().ok) pushUndo(`${msg} · ${groupName}`, undo);
    restoreFocus();
  }

  /**
   * 체크리스트 삭제 되돌리기: 지우기 직전 자리(앞 항목 기준)와 연결된 가계부 지출을 기억했다가 지운 항목만 되살린다.
   * 그사이 새로 추가하거나 고친 항목, 다른 삭제의 되돌리기 데이터는 건드리지 않는다 (실행 취소 스택에 따로 쌓인다).
   */
  function checksUndo(gone) {
    const tripId = ctx.trip.id;
    const snap = C.takeChecksSnapshot(ctx.trip, gone.map((c) => c.id));
    return () => {
      if (ctx.trip?.id !== tripId || ctx.ui.readonly) return;
      C.restoreChecks(ctx.trip, snap);
      saved(commit(), t('삭제를 되돌렸어요'));
    };
  }

  $('#page-check').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-c="picks"]');
    if (pick) {
      const set = C.shopPickSets(ctx.trip).find((x) => x.id === pick.dataset.set);
      const n = C.addPicks(ctx.trip, pick.dataset.set);
      saved(commit(), t('{title} {n}개를 쇼핑 리스트에 담았어요', { title: t(set.title), n }));
      return;
    }
    const btn = e.target.closest('[data-c]');
    if (!btn) return;
    const act = btn.dataset.c;
    const g = btn.dataset.group;
    if (act === 'tab') {
      checkView().group = g;
      for (const tab of $$('.check-tabs button')) tab.setAttribute('aria-pressed', String(tab.dataset.group === g));
      for (const panel of $$('.check-grid > section')) panel.dataset.active = String(panel.id === `check-panel-${g}`);
    } else if (act === 'del') {
      const c = ctx.trip.checks.find((x) => x.id === btn.dataset.id);
      if (!c) return;
      const kept = C.linkedExpense(ctx.trip, c.id) ? 1 : 0;
      const undo = checksUndo([c]);
      const name = C.checkText(c);
      const groupName = t(C.CHECK_GROUPS[c.group]?.label ?? '');
      C.removeCheck(ctx.trip, c.id);
      if (commit().ok) {
        const msg = kept ? t('"{text}" 삭제됨 (가계부 지출 1건은 유지됨)', { text: name }) : t('"{text}" 삭제됨', { text: name });
        pushUndo(`${msg} · ${groupName}`, undo);
      }
    } else if (act === 'price') {
      const c = ctx.trip.checks.find((x) => x.id === btn.dataset.id);
      ctx.ui.editPrice = btn.dataset.id;
      ctx.ui.editPaid = null;
      ctx.ui.priceCur = c?.cur ?? (B.ensureBudget(ctx.trip).currency === 'KRW' ? 'KRW' : 'local');
      renderChecks();
    } else if (act === 'paid') {
      ctx.ui.editPaid = btn.dataset.id;
      ctx.ui.editPrice = null;
      renderChecks();
    } else if (act === 'pcur') {
      ctx.ui.priceCur = ctx.ui.priceCur === 'KRW' ? 'local' : 'KRW';
      btn.textContent = ctx.ui.priceCur === 'KRW' ? '₩' : B.CURRENCIES[ctx.trip.budget.currency].symbol.trim();
      btn.nextElementSibling?.focus();
    } else if (act === 'presets') {
      void showPresets();
    } else if (act === 'delete-group' || act === 'toggle-group') {
      void changeCheckGroup(g, act);
    } else if (act === 'to-budget') go('budget');
  });
  $('#page-check').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target.closest('form');
    if (form.classList.contains('price-form')) return savePrice(form);
    const input = form.text;
    if (!C.addCheck(ctx.trip, form.dataset.group, input.value)) return;
    const g = form.dataset.group;
    input.value = '';
    commit();
    $(`#page-check form[data-group="${g}"] input`)?.focus();
  });
  $('#page-check').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (ctx.ui.editPrice || ctx.ui.editPaid)) {
      const id = ctx.ui.editPrice || ctx.ui.editPaid;
      ctx.ui.editPrice = ctx.ui.editPaid = null;
      renderChecks();
      $(`#page-check [data-id="${CSS.escape(id)}"].price-chip`)?.focus();
    }
  });
  // 가격 칸 밖을 누르면 입력한 값으로 저장
  $('#page-check').addEventListener('focusout', (e) => {
    const form = e.target.closest('.price-form');
    if (!form || form.contains(e.relatedTarget) || e.relatedTarget?.closest?.('.check-tabs, .pg, #tripSw, #tripsBtn')) return;
    const id = ctx.trip?.id;
    setTimeout(() => {
      if (ctx.trip?.id === id && prefs.page === 'check' && (ctx.ui.editPrice === form.dataset.id || ctx.ui.editPaid === form.dataset.id) && document.contains(form) && !askDialog.open) savePrice(form);
    }, 0);
  });

  drawPage = renderChecks;
}

export function initPresets(ctx) {
  const { $, $$, esc, commit, saved, toast, pushUndo, showDialog, closeOnBackdrop } = ctx;

  /* ───────── Phase 4: 스마트 체크리스트 추천 ─────────
   * 여행 성격(출장·휴양·쇼핑·도시 관광·아이 동반)과 기간을 고르면 data/checklist-presets.json에서 맞는 준비물을 고른다.
   * 이미 있는 항목은 자동으로 빼고 미리보기로 보여 주며, 사용자가 체크한 것만 추가한다 (기존 항목·체크·지출은 그대로).
   */
  const presetDialog = $('#presetDialog');
  let presetData = null;
  ctx.ui.preset = null; // { type, days, off: Set(뺄 id) }
  async function loadPresets() {
    presetData ??= await fetch(new URL('data/checklist-presets.json', document.baseURI)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
    return presetData;
  }
  async function openPresets() {
    if (ctx.ui.readonly || !ctx.trip) return;
    try {
      await loadPresets();
    } catch {
      return toast(t('추천 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요'), 3500);
    }
    const days = Math.max(1, ctx.trip.days.length);
    ctx.ui.preset = { type: ctx.ui.preset?.tripId === ctx.trip.id ? ctx.ui.preset.type : 'city', days, off: new Set(), tripId: ctx.trip.id };
    renderPresets();
    showDialog(presetDialog);
    $('#presetBody [name="pType"]:checked')?.focus();
  }
  const presetLabel = (map) => map?.[getLang()] ?? map?.ko ?? '';
  function renderPresets({ focus } = {}) {
    const st = ctx.ui.preset;
    if (!st || !presetData) return;
    const { items, skipped } = C.presetCandidates(ctx.trip, presetData, { type: st.type, days: st.days });
    const dur = C.durationKey(st.days);
    const groups = Object.keys(C.CHECK_GROUPS).filter((g) => items.some((it) => it.group === g));
    $('#presetBody').innerHTML = `
    <fieldset class="chipset preset-types"><legend>${esc(t('여행 성격'))}</legend>${Object.entries(presetData.types)
        .map(([k2, label]) => `<label class="${st.type === k2 ? 'on' : ''}"><input type="radio" name="pType" value="${esc(k2)}"${st.type === k2 ? ' checked' : ''}>${esc(presetLabel(label))}</label>`)
        .join('')}</fieldset>
    <fieldset class="chipset preset-days"><legend>${esc(t('기간'))} <small>${esc(t('이 여행은 {n}일이에요', { n: ctx.trip.days.length }))}</small></legend>${Object.entries(presetData.durations)
        .map(([k2, d]) => `<label class="${dur === k2 ? 'on' : ''}"><input type="radio" name="pDays" value="${d.min}"${dur === k2 ? ' checked' : ''}>${esc(presetLabel(d))}</label>`)
        .join('')}</fieldset>
    <section class="preset-preview" aria-live="polite">
      <h3>${esc(t('미리보기 · {n}개 추천', { n: items.length }))}</h3>
      ${
          items.length
            ? `<label class="pp-all"><input type="checkbox" name="pAll"> ${esc(t('전체 선택'))}</label>` + groups
                .map((g) => `<div class="pp-group"><h4><label><input type="checkbox" name="pGroup"> ${esc(t(C.CHECK_GROUPS[g].label))}</label></h4><ul>${items
                  .filter((it) => it.group === g)
                  .map((it) => `<li><label><input type="checkbox" name="pItem" value="${esc(it.id)}"${st.off.has(it.id) ? '' : ' checked'}> <span>${esc(it.text)}</span></label></li>`)
                  .join('')}</ul></div>`)
                .join('')
            : `<p class="empty-note">${esc(t('새로 넣을 추천 항목이 없어요. 이미 다 준비돼 있어요.'))}</p>`
        }
      ${skipped.length ? `<p class="fine pp-skipped">${esc(t('이미 있는 {n}개는 뺐어요: {list}', { n: skipped.length, list: skipped.map((x) => x.text).join(', ') }))}</p>` : ''}
      <p class="fine">${esc(t('기존 항목의 이름·체크·가격·가계부 연결은 바뀌지 않아요.'))}</p>
    </section>`;
    $('#presetActions [data-p="cancel"]').textContent = t('취소');
    syncPresetSelection();
    if (focus) $(focus, presetDialog)?.focus();
  }
  function syncPresetSelection() {
    const sync = (box, items) => {
      const n = items.filter((item) => item.checked).length;
      if (box) {
        box.checked = n > 0 && n === items.length;
        box.indeterminate = n > 0 && n < items.length;
      }
      return n;
    };
    for (const box of $$('[name="pGroup"]', presetDialog)) {
      sync(box, $$('[name="pItem"]', box.closest('.pp-group')));
    }
    const n = sync($('[name="pAll"]', presetDialog), $$('[name="pItem"]', presetDialog));
    const btn = $('[data-p="add"]', presetDialog);
    btn.disabled = n === 0;
    btn.textContent = t('선택한 {n}개 추가', { n });
  }
  presetDialog.addEventListener('change', (e) => {
    const st = ctx.ui.preset;
    if (!st) return;
    if (e.target.name === 'pType') {
      st.type = e.target.value;
      st.off.clear();
      renderPresets({ focus: `[name="pType"][value="${CSS.escape(st.type)}"]` });
    } else if (e.target.name === 'pDays') {
      // 고른 구간에 이 여행 일수가 들면 실제 일수로 (6일 여행이 4~7일을 다시 골라도 6일 기준, GPT 2차 #16)
      const d = Object.values(presetData.durations).find((x) => x.min === Number(e.target.value));
      const n = Math.max(1, ctx.trip.days.length);
      st.days = d && n >= d.min && n <= d.max ? n : Number(e.target.value);
      st.off.clear();
      renderPresets({ focus: `[name="pDays"][value="${st.days}"]` });
    } else if (['pAll', 'pGroup', 'pItem'].includes(e.target.name)) {
      const items = e.target.name === 'pItem' ? [e.target] :
        $$('[name="pItem"]', e.target.closest('.pp-group') ?? presetDialog);
      for (const item of items) {
        item.checked = e.target.checked;
        if (item.checked) st.off.delete(item.value);
        else st.off.add(item.value);
      }
      syncPresetSelection();
    }
  });
  presetDialog.addEventListener('click', (e) => {
    const act = e.target.closest('[data-p]')?.dataset.p;
    const st = ctx.ui.preset;
    if (act === 'cancel') presetDialog.close();
    else if (act === 'add' && st && ctx.trip?.id === st.tripId && !ctx.ui.readonly) {
      const ids = $$('[name="pItem"]:checked', presetDialog).map((x) => x.value);
      const added = C.addPresetItems(ctx.trip, presetData, ids, { type: st.type, days: st.days });
      presetDialog.close();
      if (!added.length || !commit().ok) return;
      const tripId = ctx.trip.id;
      const gone = new Set(added.map((c) => c.id));
      pushUndo(t('추천 준비물 {n}개를 추가했어요', { n: added.length }), () => {
        if (ctx.trip?.id !== tripId || ctx.ui.readonly) return;
        // 추가한 항목만 뺀다 (그사이 체크했거나 가격을 넣었으면 지출 연결은 removeCheck 규칙대로 남긴다)
        for (const id of gone) C.removeCheck(ctx.trip, id);
        saved(commit(), t('되돌렸어요'));
      });
    }
  });
  closeOnBackdrop(presetDialog);

  showPresets = openPresets;
}
