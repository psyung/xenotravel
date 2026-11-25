import * as M from '../lib/model.js';
import { t, shortDate, dayName, num, weekday, locale } from '../lib/i18n.js';
import * as B from '../lib/budget.js';
import { enhanceTimes, normalizeTime, destroyTimes } from '../lib/timefield.js';
import { refreshDates, enhanceDates } from '../lib/datepicker.js';
import { HANGUL, searchPlacesKo, searchPlaces, reversePlace } from '../lib/geo.js';
import { stayRangeWithin, overlappingStays, splitStayAround } from '../lib/stays.js';
import { checkDay } from '../lib/route-check.js';
import { legPlan, setSegment, segKey, spanMinutes, SEG_ICONS, TIMED_MODES } from '../lib/segments.js';
import { enhanceSelect, focusSelect } from '../lib/select.js';
import { groupPlaces, removePlaceGroup } from '../lib/place-groups.js';
import * as D from '../lib/dayops.js';

let boundOpenStays, boundResumeStayFromMap, boundBm, boundCostTagHtml, boundCurrentRoutePlan, boundDayOptionAttrs, boundListName, boundMoveToList, boundOpenChipMenu, boundOpenItem, boundRenderDays, boundTargetLabel, boundOpenDayOrder, boundOpenPlaceOps;
export { boundOpenStays as openStays };
export { boundResumeStayFromMap as resumeStayFromMap };
export { boundBm as bm };
export { boundCostTagHtml as costTagHtml };
export { boundCurrentRoutePlan as currentRoutePlan };
export { boundDayOptionAttrs as dayOptionAttrs };
export { boundListName as listName };
export { boundOpenItem as openItem };
export { boundRenderDays as renderDays };
export { boundTargetLabel as targetLabel };

export function initStays(ctx) {
  const {
    $, esc, ui, showDialog, map, showTab, closeOnBackdrop, prefs, narrowMq, savePrefs, applyView, showMapPanel, setPicking, ask,
    commit, pushUndo, saved, askDialog, extendTripFor, TODAY,
  } = ctx;

  function firstUncoveredNight() {
    return M.uncoveredStayNights(ctx.trip)[0] ?? 0;
  }

  const stayDialog = $('#stayDialog');
  const stayForm = $('#stayForm');
  const stayFields = stayForm.elements;
  let stayEditId = null;
  let stayLocation = null;

  let staySearch = null;

  function setStayLocation(place) {
    stayLocation = place;
    $('#stayLocation').textContent = place
      ? place.address || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
      : t('숙소 위치를 골라 주세요');
    if (place?.name && !stayFields.name.value.trim()) stayFields.name.value = place.name;
  }

  function renderStayList() {
    $('#stayList').hidden = !ctx.trip.stays.length;
    $('#stayList').innerHTML = [...ctx.trip.stays].sort((a, b) => a.startIndex - b.startIndex).map((stay) => {
      const { checkIn, checkOut } = M.stayDates(ctx.trip, stay);
      const meta = [
        checkIn ? [shortDate(checkIn), stay.checkInTime, '–', shortDate(checkOut), stay.checkOutTime].filter(Boolean).join(' ') : dayName(stay.startIndex),
        t('{n}박', { n: stay.nights }),
      ].join(' · ');
      return `<li>
      <button type="button" class="t-open" data-stay-edit="${esc(stay.id)}" aria-pressed="${stay.id === stayEditId}">
        <strong>${esc(stay.name)}</strong><span class="t-meta">${esc(meta)}</span>
      </button>
      <button type="button" class="icon danger" data-stay-remove="${esc(stay.id)}" aria-label="${esc(t('{name} 삭제', { name: stay.name }))}">✕</button>
    </li>`;
    }).join('');
  }

  function stayFormError(message = '') {
    $('#stayError').textContent = message;
    $('#stayError').hidden = !message;
  }

  function clearStaySearch() {
    staySearch?.abort();
    staySearch = null;
    $('#staySearchResults').replaceChildren();
  }

  function openStays({ id = null, place = null, start = firstUncoveredNight(), draft = null } = {}) {
    if (!ctx.trip || ui.readonly) return;
    const stay = id ? M.findStay(ctx.trip, id) : null;
    if (id && !stay) return;
    const checkIn = M.dateAtIndex(ctx.trip, start);
    const nights = Math.min(place ? 1 : M.DEFAULT_NIGHTS, ctx.trip.days.length - start);
    const dates = stay ? M.stayDates(ctx.trip, stay) : { checkIn, checkOut: checkIn ? M.addDays(checkIn, nights) : '' };
    const values = draft ?? { ...(stay ?? place ?? {}), ...dates };
    stayEditId = stay?.id ?? null;
    stayForm.reset();
    clearStaySearch();
    $('#stayLocationQuery').value = '';
    $('#stayFormTitle').textContent = stay ? t('숙소 수정') : t('숙소 추가');
    const paid = draft?.paid ?? Boolean(stay && B.placeExpense(ctx.trip, stay.id));
    for (const field of ['name', 'checkIn', 'checkOut', 'bookingRef', 'phone', 'price', 'memo', 'cur', 'url']) {
      stayFields[field].value = values[field] ?? (field === 'cur' ? 'local' : '');
    }
    stayFields.paid.checked = paid;
    for (const field of ['checkInTime', 'checkOutTime']) {
      const input = stayFields[field];
      const time = values[field] ?? '';
      input.value = time;
      if (time) input._flatpickr?.setDate(time, false);
      else input._flatpickr?.clear(false);
    }
    stayFields.checkIn.dataset.dpSoftMin = M.dateAtIndex(ctx.trip, 0);
    stayFields.checkOut.dataset.dpSoftMax = M.dateAtIndex(ctx.trip, ctx.trip.days.length);
    enhanceTimes(stayForm);
    refreshDates();
    setStayLocation(place ?? stay);
    stayFormError();
    renderStayList();
    if (!stayDialog.open) showDialog(stayDialog);
    stayFields.name.focus();
  }

  async function searchStayLocation() {
    const query = $('#stayLocationQuery').value.trim() || stayFields.name.value.trim();
    if (!query) return $('#stayLocationQuery').focus();
    clearStaySearch();
    const request = new AbortController();
    staySearch = request;
    const results = $('#staySearchResults');
    results.textContent = t('검색 중…');
    const near = { ...(ctx.trip.center ?? map.getCenter()), zoom: map.getZoom() };
    try {
      const search = HANGUL.test(query) ? searchPlacesKo : searchPlaces;
      const places = await search(query, near, request.signal);
      if (staySearch !== request || !stayDialog.open) return;
      results.replaceChildren(...places.map((place) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.textContent = [place.name, place.address].filter(Boolean).join(' · ');
        button.addEventListener('click', () => {
          setStayLocation(place);
          clearStaySearch();
          $('#stayLocationQuery').focus();
        });
        return button;
      }));
      if (!places.length) results.textContent = t('검색 결과가 없어요. 영어나 현지어로도 검색해 보세요.');
    } catch {
      if (staySearch === request && stayDialog.open) results.textContent = t('위치를 검색하지 못했어요');
    }
  }

  function resumeStayFromMap(draft, latlng) {
    if (ctx.trip?.id !== draft.tripId || ui.readonly) return;
    showTab('plan');
    const place = latlng ? { lat: latlng.lat, lng: latlng.lng, name: t('선택한 위치') } : draft.place;
    openStays({ id: draft.id, place, draft: draft.values });
    if (latlng) reversePlace(place.lat, place.lng).then((result) => {
      if (result && stayDialog.open && stayLocation === place) setStayLocation({ ...place, name: result.name, address: result.address });
    }).catch(() => {});
  }

  $('#staysBtn').addEventListener('click', () => openStays());
  $('#stayShortcut').addEventListener('click', () => openStays({ start: Math.max(0, ctx.trip.days.findIndex((day) => day.id === ui.target)) }));
  $('#stayNew').addEventListener('click', () => openStays());
  $('#stayClose').addEventListener('click', () => stayDialog.close());
  stayDialog.addEventListener('close', () => {
    if (!stayDialog.open) clearStaySearch();
  });
  closeOnBackdrop(stayDialog);
  $('#staySearchBtn').addEventListener('click', searchStayLocation);
  $('#stayLocationQuery').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchStayLocation();
    }
  });
  $('#stayPickBtn').addEventListener('click', () => {
    ctx.stayMapDraft = {
      tripId: ctx.trip.id, id: stayEditId, place: stayLocation,
      values: { ...Object.fromEntries(new FormData(stayForm)), paid: stayFields.paid.checked },
    };
    stayDialog.close();
    showMapPanel();
    if (stayLocation) {
      ui.keepView = true;
      map.setView([stayLocation.lat, stayLocation.lng], Math.max(map.getZoom(), 14));
    }
    setPicking(true);
  });

  $('#stayList').addEventListener('click', async (e) => {
    const { stayEdit, stayRemove } = e.target.closest('button')?.dataset ?? {};
    if (stayEdit) return openStays({ id: stayEdit });
    const stay = stayRemove && M.findStay(ctx.trip, stayRemove);
    if (!stay || ui.readonly) return;
    const tripId = ctx.trip.id;
    const choice = await ask({
      title: t('숙소 "{name}"({n}박)을 삭제할까요?', { name: stay.name, n: stay.nights }),
      body: B.placeExpense(ctx.trip, stay.id) ? t('연결된 지출은 가계부에 남아요') : '',
      actions: [{ value: 'delete', label: t('삭제'), danger: true }],
    });
    if (choice !== 'delete' || ctx.trip?.id !== tripId || ui.readonly || !stayDialog.open) return;
    const index = ctx.trip.stays.findIndex((entry) => entry.id === stay.id);
    if (index < 0) return;
    const [removed] = ctx.trip.stays.splice(index, 1);
    const dates = M.stayDates(ctx.trip, removed);
    const result = commit();
    if (stayEditId === stay.id) openStays();
    else renderStayList();
    stayDialog.close();
    if (result.ok) pushUndo(t('"{name}"을(를) 삭제했어요', { name: stay.name }), () => {
      if (ctx.trip?.id !== tripId || ui.readonly || M.findStay(ctx.trip, removed.id)) return;
      const range = stayRangeWithin(ctx.trip, dates.checkIn, dates.checkOut);
      ctx.trip.stays.splice(index, 0, { ...removed, ...range });
      saved(commit(), t('되돌렸어요'));
    });
  });

  stayForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ui.readonly || askDialog.open) return;
    const form = new FormData(stayForm);
    const name = form.get('name').trim();
    const checkIn = form.get('checkIn');
    const checkOut = form.get('checkOut');
    const checkInTime = normalizeTime(form.get('checkInTime'));
    const checkOutTime = normalizeTime(form.get('checkOutTime'));
    const price = form.get('price') === '' ? null : Number(form.get('price'));
    const paid = stayFields.paid.checked;
    if (!name) {
      stayFields.name.focus();
      return stayFormError(t('숙소 이름을 입력해 주세요'));
    }
    if (!stayLocation) return stayFormError(t('숙소 위치를 골라 주세요'));
    if (!M.parseDate(checkIn) || !M.parseDate(checkOut) || checkIn >= checkOut) return stayFormError(t('체크아웃은 체크인 다음 날부터 가능해요'));
    if (checkInTime == null || checkOutTime == null) return stayFormError(t('시간은 20:45처럼 적어 주세요'));
    if (price != null && (!Number.isFinite(price) || price > B.MAX_AMOUNT)) return stayFormError(t('금액이 너무 커요. {max} 이하로 입력해 주세요', { max: num(B.MAX_AMOUNT) }));
    if (paid && !(price > 0)) return stayFormError(t('결제 금액을 입력해 주세요'));
    stayFormError();

    const id = stayEditId;
    const current = ctx.trip;
    const signature = () => JSON.stringify([ctx.trip.startDate, ctx.trip.endDate, ctx.trip.stays]);
    const before = signature();
    const unchanged = () => ctx.trip === current && !ui.readonly && stayDialog.open && stayEditId === id && before === signature();
    const period = await extendTripFor(checkIn, checkOut, { checkout: true });
    if (period === false || !unchanged()) return;
    let requested = stayRangeWithin(ctx.trip, checkIn, checkOut);
    if (period) {
      const basis = ctx.trip.startDate ? ctx.trip : { days: [{ date: period.start }] };
      const startIndex = M.indexOfDate(basis, checkIn);
      requested = { startIndex, nights: M.indexOfDate(basis, checkOut) - startIndex };
    }
    if (!requested) return stayFormError(t('여행 기간 안에 겹치는 숙박일이 없어요'));
    const conflicts = overlappingStays(ctx.trip.stays, requested, id);
    let choice = null;
    if (conflicts.length) {
      choice = await ask({
        title: t('숙소 날짜가 겹쳐요'),
        body: [conflicts.map((stay) => {
          const dates = M.stayDates(ctx.trip, stay);
          return [stay.name, [shortDate(dates.checkIn), shortDate(dates.checkOut)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ');
        }).join(', '), t('새 숙소를 겹치는 밤에 배정하고 기존 숙소의 나머지 밤을 남겨요')].join('\n'),
        actions: [
          { value: 'replace', label: t('교체'), danger: true },
          { value: 'split', label: t('나눠서 저장'), primary: true },
        ],
      });
      if (!choice || !unchanged()) return;
    }
    if (period) M.setTripDates(ctx.trip, period.start, period.end, { keepDates: true });
    const range = stayRangeWithin(ctx.trip, checkIn, checkOut);
    const conflictIds = new Set(conflicts.map((stay) => stay.id));
    if (choice) ctx.trip.stays = ctx.trip.stays.flatMap((stay) =>
      conflictIds.has(stay.id) ? (choice === 'split' ? splitStayAround(stay, range) : []) : [stay]);
    const dates = M.stayDates(ctx.trip, range);
    const place = {
      lat: stayLocation.lat, lng: stayLocation.lng, address: stayLocation.address ?? '',
      name, url: form.get('url').trim(), memo: form.get('memo').trim(),
      bookingRef: form.get('bookingRef').trim(), phone: form.get('phone').trim(), price, cur: form.get('cur'),
      checkInTime: dates.checkIn === checkIn ? checkInTime : '',
      checkOutTime: dates.checkOut === checkOut ? checkOutTime : '',
    };
    const existing = M.findStay(ctx.trip, id);
    const wasPaid = existing && B.placeExpense(ctx.trip, id);
    if (existing && name !== existing.name) delete existing.nameI18n;
    const stay = existing ? Object.assign(existing, place, range) : M.addStay(ctx.trip, place, range.startIndex, range.nights);
    if (paid && (!wasPaid || wasPaid.amount !== price || wasPaid.cur !== stay.cur)) B.payPlace(ctx.trip, stay.id, { today: TODAY });
    else if (!paid && wasPaid) B.unpayPlace(ctx.trip, stay.id);
    ui.routePlan = ui.routeUndo = null;
    stayDialog.close();
    saved(commit(), t('{name} 저장했어요', { name: stay.name }));
  });

  boundOpenStays = openStays;
  boundResumeStayFromMap = resumeStayFromMap;
}

export function init(ctx) {
  const {
    ui, esc, prefs, href, directionsHtml, catIcon, TODAY, dayFlights, dayColor, saved, commit, $, narrowMq,
    INBOX_COLOR, locateMapPlace, ask, pushUndo, flightRowsHtml, toast, renderMap, wxChipHtml, wxHintHtml,
    nearbyContext, currentCity, resetNearby, allLists, renderDayTabs, trendSectionHtml, $$, addTrend, curView,
    showTab, renderTarget, loadNearby, addPlace, trendCollection, trendsOpen, savePrefs, paintWeather, copyText,
    openFlights, debounce, markEdited, persistSoon, renderRetrospective,
  } = ctx;

  const listName = (id) => {
    const i = ctx.trip.days.findIndex((d) => d.id === id);
    return i === -1 ? t('장소 보관함') : dayName(i);
  };

  function targetLabel() {
    return listName(ui.target);
  }

  function stayRowHtml(stay, dayIndex, pos, flags, leg = null) {
    const key = `${stay.id}|${dayIndex}|${pos}`;
    const open = ui.openStay === key;
    const tag = pos === 'start' && flags.checkOut ? t('체크아웃') : pos === 'end' && flags.checkIn ? t('체크인') : '';
    const editor = open ? detailHtml(stay, { stay: true }) : '';
    return `<div class="tl-row stay">${legHtml(leg)}<div class="tl-time"></div><div class="tl-box">
    <div class="stay-row ${pos}${open ? ' open' : ''}" data-stay="${stay.id}" data-key="${key}">
      <button class="stay-main" data-action="stay-toggle"${ui.readonly ? ` aria-expanded="${open}"` : ' aria-haspopup="dialog"'}>
        <span class="stay-pos">${esc(pos === 'start' ? t('출발') : t('귀가'))}</span>
        <span class="stay-name">${esc(stay.name)}</span>${tag ? `<span class="stay-tag">${esc(tag)}</span>` : ''}
      </button>
      <button class="icon" data-action="stay-locate" title="${esc(t('지도에서 보기'))}" aria-label="${esc(t('{name} 지도에서 보기', { name: stay.name }))}">◎</button>
    </div>${editor}</div></div>`;
  }

  /** 앞 장소에서 여기까지: "도보 약 12분 · 850m  길찾기" (직선거리 기준 어림값) */
  function travelEstimate(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h && m ? t('예상 이동 약 {h}시간 {m}분', { h, m })
      : h ? t('예상 이동 약 {h}시간', { h }) : t('예상 이동 약 {m}분', { m });
  }

  // 영어 번역의 "walking"·"transit"은 문장 안에 쓰는 소문자라, 수단 이름으로 쓸 때는 첫 글자를 대문자로
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const SEG_LABELS = () => ({
    walking: cap(t('도보')), transit: cap(t('대중교통')), driving: t('택시'), rail: t('고속철·기차'), flight: t('비행기'), custom: t('직접 입력'),
  });
  /** 짧은 소요 시간: "12분" · "1시간 5분" (approx면 "약 12분") */
  function durationText(minutes, approx) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const text = h && m ? t('{h}시간 {m}분', { h, m }) : h ? t('{h}시간', { h }) : t('{m}분', { m });
    return approx ? t('약 {time}', { time: text }) : text;
  }

  /**
   * 앞 지점에서 여기까지 이동 구간 (J-10·J-16).
   * [🚇 대중교통 약 12분] 직선 3.4km [길찾기] — 수단 버튼을 누르면 이 구간만 수단을 바꾼다.
   * 30km 이상인데 수단을 정하지 않았으면 시간 대신 "장거리 · 수단 미정", 양끝이 역이면 [고속철일까요?].
   */
  function legHtml(leg) {
    if (!leg) return '';
    const plan = legPlan(ctx.trip, leg.from, leg.to, leg.km, leg.dayMode);
    const roadMode = ['walking', 'transit', 'driving'].includes(plan.mode) ? plan.mode : 'transit';
    const link = M.tripDirectionsLinks(ctx.trip, leg.to, leg.from, prefs.directionsApp, roadMode)[0];
    const distance = t('직선 {km}', { km: M.formatKm(leg.km) });
    const seg = plan.seg;
    const extra = seg && (seg.trainNo || seg.dep) ? [seg.trainNo, seg.dep && seg.arr ? `${seg.dep}–${seg.arr}` : seg.dep].filter(Boolean).join(' ') : '';
    const what = plan.long ? t('장거리 · 수단 미정')
      : `${SEG_LABELS()[plan.mode]} ${durationText(plan.minutes, !TIMED_MODES.has(plan.mode))}${plan.buffer ? ` + ${t('여유 {m}분', { m: plan.buffer })}` : ''}`;
    const icon = plan.long ? '' : `<span class="leg-ic" aria-hidden="true">${SEG_ICONS[plan.mode]}</span>`;
    const ids = `data-from="${esc(leg.from.id)}" data-to="${esc(leg.to.id)}" data-km="${leg.km}" data-day-mode="${esc(leg.dayMode || '')}"`;
    const modeEl = ui.readonly
      ? `<span class="leg-mode">${icon}<span class="leg-how">${esc(what)}</span></span>`
      : `<button type="button" class="leg-mode${plan.source === 'user' ? ' set' : ''}" data-action="seg-edit" ${ids} title="${esc(t('이 구간 이동 수단 바꾸기'))}" aria-label="${esc(`${what} · ${t('이 구간 이동 수단 바꾸기')}`)}">${icon}<span class="leg-how">${esc(what)}</span></button>`;
    const rail = plan.long && plan.station && !ui.readonly
      ? `<button type="button" class="leg-rail" data-action="seg-edit" data-mode="rail" ${ids}>${esc(t('고속철일까요?'))}</button>` : '';
    return `<div class="leg${plan.long ? ' long' : ''} m-${plan.mode || 'none'}">${modeEl}<span class="leg-dist">${esc(distance)}${extra ? ` · ${esc(extra)}` : ''}</span>${rail}<a class="leg-go" href="${href(link.url)}" target="_blank" rel="noopener" title="${esc(link.label)}">${esc(t('길찾기'))}</a></div>`;
  }

  /** 구간 수단 고르기 (확인 창 하나): 도보 / 대중교통 / 택시 / 고속철·기차 / 비행기 / 직접 입력 + 여유 시간 */
  async function editSegment(btn) {
    const { from: fromId, to: toId, km, dayMode, mode: suggested } = btn.dataset;
    const find = (id) => M.findStay(ctx.trip, id) ?? M.findItem(ctx.trip, id)?.item;
    const from = find(fromId);
    const to = find(toId);
    if (!from || !to) return;
    const current = legPlan(ctx.trip, from, to, Number(km), dayMode);
    const seg = current.seg ?? {};
    const mode = suggested || (current.long ? 'rail' : current.mode);
    const labels = SEG_LABELS();
    const html = `<div class="seg-form">
      <p class="seg-route">${esc(from.name)} → ${esc(to.name)} · ${esc(t('직선 {km}', { km: M.formatKm(Number(km)) }))}</p>
      <div class="seg-modes" role="radiogroup" aria-label="${esc(t('이동 수단'))}">${Object.entries(labels).map(([value, label]) => `<label class="seg-mode"><input type="radio" name="segMode" value="${value}"${value === mode ? ' checked' : ''}><span>${SEG_ICONS[value]} ${esc(label)}</span></label>`).join('')}</div>
      <div class="seg-timed" data-seg-for="rail flight custom">
        <label class="seg-field" data-seg-for="rail flight"><span>${esc(t('열차·편 번호 (선택)'))}</span><input name="segNo" maxlength="20" autocomplete="off" placeholder="G7512" value="${esc(seg.trainNo ?? '')}"></label>
        <div class="seg-times" data-seg-for="rail flight">
          <label class="seg-field"><span>${esc(t('출발 시각'))}</span><input name="segDep" data-time-field inputmode="numeric" value="${esc(seg.dep ?? '')}"></label>
          <label class="seg-field"><span>${esc(t('도착 시각'))}</span><input name="segArr" data-time-field inputmode="numeric" value="${esc(seg.arr ?? '')}"></label>
        </div>
        <label class="seg-field"><span>${esc(t('걸리는 시간 (분)'))}</span><input name="segMin" type="number" min="0" max="10080" step="1" inputmode="numeric" value="${seg.minutes ?? ''}"></label>
        <p class="seg-note" data-seg-for="rail flight">${esc(t('출발·도착 시각을 넣으면 걸리는 시간은 자동으로 계산해요'))}</p>
      </div>
      <details class="seg-buffer"${seg.buffer ? ' open' : ''}><summary>${esc(t('역까지 이동·대기 여유 시간'))}</summary>
        <label class="seg-field"><span>${esc(t('여유 (분)'))}</span><input name="segBuffer" type="number" min="0" max="600" step="5" inputmode="numeric" value="${seg.buffer ?? ''}"></label>
      </details>
    </div>`;
    const body = $('#askBody');
    const sync = () => {
      const m = $('input[name="segMode"]:checked', body)?.value;
      for (const el of $$('[data-seg-for]', body)) el.hidden = !el.dataset.segFor.split(' ').includes(m);
      const span = spanMinutes($('input[name="segDep"]', body)?.value, $('input[name="segArr"]', body)?.value);
      if (span != null && (m === 'rail' || m === 'flight')) $('input[name="segMin"]', body).value = span;
    };
    const pending = ask({
      title: t('이동 수단'), html,
      actions: [
        ...(current.source === 'user' ? [{ value: 'auto', label: t('자동으로 되돌리기') }] : []),
        { value: 'save', label: t('저장'), primary: true },
      ],
    });
    body.addEventListener('change', sync);
    body.addEventListener('input', sync);
    enhanceTimes(body);
    sync();
    const choice = await pending;
    body.removeEventListener('change', sync);
    body.removeEventListener('input', sync);
    if (!choice) return;
    const before = ctx.trip.segments?.[segKey(from, to)] ?? null;
    if (choice === 'auto') setSegment(ctx.trip, from, to, null);
    else {
      const raw = {
        mode: $('input[name="segMode"]:checked', body)?.value, trainNo: $('input[name="segNo"]', body)?.value,
        dep: $('input[name="segDep"]', body)?.value, arr: $('input[name="segArr"]', body)?.value,
        minutes: $('input[name="segMin"]', body)?.value, buffer: $('input[name="segBuffer"]', body)?.value,
      };
      if (TIMED_MODES.has(raw.mode) && raw.minutes === '' && spanMinutes(raw.dep, raw.arr) == null) {
        toast(t('걸리는 시간이나 출발·도착 시각을 넣어 주세요'), 3200);
        return;
      }
      setSegment(ctx.trip, from, to, raw);
    }
    commit();
    pushUndo(t('{from} → {to} 이동 수단을 바꿨어요', { from: from.name, to: to.name }), () => {
      setSegment(ctx.trip, from, to, before);
      commit();
    });
  }


  function hoursEditorHtml(it) {
    // 7 January 2024 was a Sunday.
    const days = Array.from({ length: 7 }, (_, n) => `<label><input type="checkbox" data-closed-day="${n}"${it.closedWeekdays?.includes(n) ? ' checked' : ''}> ${esc(weekday(`2024-01-${String(n + 7).padStart(2, '0')}`))}</label>`);
    return `<fieldset class="place-hours"><legend>${esc(t('휴무 요일'))}</legend><div class="closed-days">${days.join('')}</div></fieldset>
    <fieldset class="place-hours"><legend>${esc(t('영업시간'))}</legend><div class="hours-inputs">
      <label>${esc(t('영업 시작'))}<input type="time" data-hours="opensAt" value="${esc(it.opensAt ?? '')}"></label>
      <label>${esc(t('영업 종료'))}<input type="time" data-hours="closesAt" value="${esc(it.closesAt ?? '')}"></label>
    </div></fieldset>`;
  }

  /** 보기 전용(공유받은 일정)에서 편집 창 대신 보여주는 상세 */
  function detailHtml(x, { stay = false } = {}) {
    const url = M.safeUrl(x.url);
    const range = stay ? M.stayDates(ctx.trip, x) : null;
    const dateTimeLabel = (date, time) => [M.formatDate(date), time].filter(Boolean).join(' ');
    return `<div class="editor detail">
      ${stay ? `<p><b>${esc(t('{n}박', { n: x.nights }))}</b>${range.checkIn ? ` · ${esc(dateTimeLabel(range.checkIn, x.checkInTime))} ~ ${esc(dateTimeLabel(range.checkOut, x.checkOutTime))}` : ''}</p>` : ''}
      ${stay && x.bookingRef ? `<p>${esc(t('예약번호 {ref}', { ref: x.bookingRef }))}</p>` : ''}
      ${stay && x.phone ? `<p>${esc(t('전화번호'))} · ${esc(x.phone)}</p>` : ''}
      ${x.memo ? `<p class="memo-text">${esc(x.memo)}</p>` : ''}
      ${url ? `<p><a href="${href(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>` : ''}
      ${x.address ? `<p class="addr">${esc(x.address)}</p>` : ''}
      ${directionsHtml(x, stay ? { from: null } : {})}
      <div class="editor-actions"><a href="${href(M.googleMapsUrl(x))}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a></div>
    </div>`;
  }

  /* ───────── 장소 비용 ─────────
   * 예정 비용("¥1,200")은 카드 이름 옆에, 결제하면 "결제 ₩10,800"으로 바뀐다. 결제·취소는 편집 창과 오늘 카드에서.
   */
  /** 원화(krw)로 저장된 금액을 이 여행의 기준 통화로 보여 준다 (C1) */
  const bm = (krw) => B.baseMoney(krw, ctx.trip?.budget);
  const tripCurrency = () => ctx.trip.budget?.currency ?? B.guessCurrency(ctx.trip.destination, ctx.trip.country);
  function costTagHtml(it) {
    const paid = ctx.trip.expenses?.length ? B.placeExpense(ctx.trip, it.id) : null;
    if (paid) return `<span class="cost-tag paid" title="${esc(t('가계부에 기록됨'))}">${esc(t('결제 {amount}', { amount: paid.krw == null ? B.moneyCode(paid.amount, ctx.trip.budget.currency) : bm(paid.krw) }))}</span>`;
    if (!(it.cost?.price > 0)) return '';
    const code = it.cost.cur === 'KRW' ? 'KRW' : tripCurrency();
    return `<span class="cost-tag" title="${esc(t('예정 비용'))}">${esc(B.moneyCode(it.cost.price, code))}</span>`;
  }
  const nameHtml = (it) =>
    `<span class="nm">${esc(it.name)}</span>${catIcon(it)}${it.pinned ? `<span class="pin-tag" title="${esc(t('동선 정리할 때 이 자리 그대로'))}">${esc(t('고정'))}</span>` : ''}${costTagHtml(it)}`;

  function costEditorHtml(it) {
    const b = ctx.trip.budget ?? { currency: tripCurrency() };
    const local = b.currency !== 'KRW';
    const paid = B.placeExpense(ctx.trip, it.id);
    const cur = it.cost?.cur ?? 'local';
    return `<div class="cost-row">
      <label>${esc(t('예상 비용'))}<span class="cost-in"><input data-cost="price" inputmode="decimal" value="${it.cost?.price ?? ''}" placeholder="${esc(t('입장료·식사 등'))}">${
          local
            ? `<select data-cost="cur" aria-label="${esc(t('통화'))}"><option value="local"${cur === 'local' ? ' selected' : ''}>${esc(B.CURRENCIES[b.currency]?.symbol ?? '')} ${esc(b.currency)}</option><option value="KRW"${cur === 'KRW' ? ' selected' : ''}>₩ KRW</option></select>`
            : ''
        }</span></label>
      ${
          paid
            ? `<span class="paid-note">${esc(t('가계부에 {amount} 기록됨', { amount: paid.krw == null ? B.moneyCode(paid.amount, b.currency) : bm(paid.krw) }))} <button type="button" data-action="unpay">${esc(t('결제 취소'))}</button></span>`
            : `<button type="button" class="pay-btn" data-action="pay">${esc(t('결제 완료로 기록'))}</button>`
        }
    </div>`;
  }

  let editorMore = null;

  function itemHtml(it, i, isDay, leg = null, listItems = null, overlap = '') {
    const open = ui.openItem === it.id;
    const sub = esc(it.memo || it.address); // 접힌 카드는 메모를 2줄까지만 (CSS line-clamp). 시간은 타임라인 왼쪽에 따로 보인다
    const pos = listItems ? listItems.indexOf(it) : i;
    const canUp = pos > 0;
    const canDown = listItems ? pos < listItems.length - 1 : false;
    const dayPos = isDay ? ctx.trip.days.findIndex((d) => d.items.includes(it)) : -1;
    return `<li class="item${open ? ' open' : ''}${it.visited ? ' visited' : ''}" data-id="${it.id}">
    ${legHtml(leg)}
    <div class="tl-time">${esc(it.time)}</div>
    <div class="tl-box">
    <div class="item-row">
      <span class="drag" title="${esc(t('끌어서 순서·날짜 바꾸기'))}" aria-hidden="true">⋮⋮</span>
      <span class="num"${it.visited ? ` title="${esc(t('다녀왔어요'))}"` : ''} aria-hidden="true">${it.visited ? '✓' : isDay ? i + 1 : '•'}</span>
      <button class="item-main" data-action="toggle" aria-expanded="${open}">
        <span class="sr-only">${isDay ? esc(t('{n}번째', { n: i + 1 })) : ''}${it.visited ? ` · ${esc(t('다녀왔어요'))}` : ''}</span>
        <span class="item-name">${nameHtml(it)}</span>
        <span class="item-sub">${sub}</span>
      </button>
      ${isDay || ctx.trip.days.length ? `<button class="icon" data-action="place-ops" title="${esc(t('다른 일차로 이동·복제'))}" aria-label="${esc(t('{name} 다른 일차로 이동·복제', { name: it.name }))}" aria-haspopup="dialog">⇄</button>` : ''}
      <button class="icon" data-action="locate" title="${esc(t('지도에서 보기'))}" aria-label="${esc(t('{name} 지도에서 보기', { name: it.name }))}">◎</button>
      ${open ? `<button class="icon collapse" data-action="toggle" title="${esc(t('접기'))}" aria-label="${esc(t('접기'))}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>` : ''}
    </div>
    ${overlap ? timeWarnHtml(overlap, dayFlightIdOf(it)) : ''}
    ${
        open && ui.readonly
          ? detailHtml(it)
          : open
          ? `<div class="editor">
      <label>${esc(t('시간'))}<input type="time" data-field="time" value="${esc(it.time)}"></label>
      ${dayPos >= 0 && ctx.trip.days[dayPos].date && ctx.trip.days[dayPos].date <= TODAY ? `<label class="pin-toggle retro-visit"><input type="checkbox" data-visited${it.visited ? ' checked' : ''}> ${esc(t('다녀왔어요'))}</label>` : ''}
      <label>${esc(t('메모'))}<textarea data-field="memo" placeholder="${esc(t('영업시간, 예약번호, 꼭 먹을 것…'))}">${esc(it.memo)}</textarea></label>
      ${it.address ? `<p class="addr">${esc(it.address)}</p>` : ''}
      ${directionsHtml(it)}
      <div class="editor-actions">
        <a href="${href(M.googleMapsUrl(it))}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a>
      </div>
      <details class="editor-more"${editorMore === it.id ? ' open' : ''}>
        <summary>${esc(t('더보기'))}</summary>
        <div class="editor-more-fields">
          <label>${esc(t('이름'))}<input data-field="name" value="${esc(it.name)}"></label>
          <div class="cat-pick" role="group" aria-label="${esc(t('종류'))}">${Object.entries(M.CATEGORIES)
              .map(([k, c]) => `<button type="button" data-action="set-cat" data-cat="${k}" aria-pressed="${it.category === k}" class="${it.category === k ? 'on' : ''}" style="--c:${c.color}">${esc(t(c.label))}</button>`)
              .join('')}</div>
          <label>${esc(t('링크'))}<input type="url" data-field="url" value="${esc(it.url)}" placeholder="${esc(t('예약 페이지, 블로그 등'))}"></label>
          ${hoursEditorHtml(it)}
          ${isDay ? costEditorHtml(it) : ''}
          ${isDay ? `<label class="pin-toggle"><input type="checkbox" data-pin${it.pinned ? ' checked' : ''}> ${esc(t('동선 정리할 때 이 순서 그대로 두기'))} <small>(${esc(t('시간을 정한 곳은 늘 그대로'))})</small></label>` : ''}
          <div class="order-row" role="group" aria-label="${esc(t('순서 바꾸기'))}">
            <span>${esc(t('순서'))}</span>
            <button type="button" data-action="item-up"${canUp ? '' : ' disabled'} aria-label="${esc(t('{name} 한 칸 위로', { name: it.name }))}">↑ ${esc(t('위로'))}</button>
            <button type="button" data-action="item-down"${canDown ? '' : ' disabled'} aria-label="${esc(t('{name} 한 칸 아래로', { name: it.name }))}">↓ ${esc(t('아래로'))}</button>
            ${isDay ? `<button type="button" data-action="item-prev-day"${dayPos > 0 ? '' : ' disabled'} aria-label="${esc(t('{name} 전날로 옮기기', { name: it.name }))}">← ${esc(t('전날'))}</button>
            <button type="button" data-action="item-next-day"${dayPos >= 0 && dayPos < ctx.trip.days.length - 1 ? '' : ' disabled'} aria-label="${esc(t('{name} 다음 날로 옮기기', { name: it.name }))}">${esc(t('다음 날'))} →</button>` : ''}
          </div>
          <label>${esc(t('다른 날로 옮기기'))}<select class="move-to" data-ui-select>${moveOptions(listIdOf(it.id), t('옮길 날 고르기'))}</select></label>
          <div class="editor-actions">
            <span class="ea-buttons"><button data-action="place-move" aria-haspopup="dialog">${esc(t('다른 일차로 이동'))}</button> <button data-action="place-copy" aria-haspopup="dialog">${esc(t('다른 일차로 복제'))}</button> <button data-action="duplicate">${esc(t('같은 날 복제'))}</button> <button data-action="delete" class="danger">${esc(t('삭제'))}</button></span>
          </div>
        </div>
      </details>
    </div>`
          : ''
      }
    </div>
  </li>`;
  }

  /**
   * 시간 겹침 배지 (B7). 원인에 따라 다르게 안내한다.
   *   order  → "시간 겹침 확인" + 이후 일정 30분씩 밀기
   *   flight → "항공편 시간 확인" + 항공편 보기 / 일정 시간 수정 (밀면 귀국편과 더 멀어질 수 있어 밀기 버튼은 없다)
   */
  function timeWarnHtml(kind, flightId) {
    if (kind === 'flight') {
      return `<div class="time-warn flight" role="note"><span class="tw-badge">${esc(t('항공편 시간 확인'))}</span>${
        ui.readonly ? '' : `${flightId ? `<button type="button" data-action="flight-edit" data-flight="${esc(flightId)}">${esc(t('항공편 시간 보기'))}</button>` : ''}<button type="button" data-action="edit-time">${esc(t('일정 시간 수정'))}</button>`
      }<small>${esc(t('항공편 도착 전이나 출발 후로 잡혀 있어요'))}</small></div>`;
    }
    return `<div class="time-warn" role="note"><span class="tw-badge">${esc(t('시간 겹침 확인'))}</span>${
      ui.readonly ? '' : `<button type="button" data-action="push-30" title="${esc(t('이 장소부터 시간을 정한 일정을 30분씩 늦춰요'))}">${esc(t('이후 일정 30분씩 밀기'))}</button>`
    }</div>`;
  }
  /** 그 장소가 있는 날의 항공편 (출발편 우선) id */
  function dayFlightIdOf(it) {
    const i = ctx.trip.days.findIndex((d) => d.items.includes(it));
    if (i < 0) return '';
    return (dayFlights(i, 'bottom')[0] ?? dayFlights(i, 'top')[0])?.flight.id ?? '';
  }
  /** 그날 시간이 꼬인 장소 id. 그날 비행기 도착 시각보다 이르거나, 귀국 비행기 출발 이후인 장소도 포함 */
  function dayTimeConflicts(dayIndex) {
    return M.timeConflictKinds(ctx.trip.days[dayIndex]?.items, M.flightTimeBounds(M.flightsForDay(ctx.trip, dayIndex)));
  }

  function listIdOf(itemId) {
    return M.findItem(ctx.trip, itemId)?.listId ?? null;
  }

  /** "보낼 날" 선택지. 지금 있는 목록은 뺀다. */
  /**
   * P1-2: 공용 Select의 일차 항목 표시 — "● Day 3 · 11/25 (수) · 2곳", 오늘이면 배지
   * <option>에 data-color · data-label · data-sub · data-badge를 붙인다 (기본 select로 보여도 글자는 그대로)
   */
  function dayOptionAttrs(i) {
    const d = ctx.trip.days[i];
    const sub = [d.date ? `${shortDate(d.date)} (${weekday(d.date)})` : '', t('{n}곳', { n: d.items.length })].filter(Boolean).join(' · ');
    return ` data-color="${dayColor(i)}" data-label="${esc(dayName(i))}" data-sub="${esc(sub)}"${d.date === TODAY ? ` data-badge="${esc(t('오늘'))}"` : ''}`;
  }

  function moveOptions(currentListId, placeholder) {
    const days = ctx.trip.days
      .map((d, i) => (d.id === currentListId ? '' : `<option value="${d.id}"${dayOptionAttrs(i)}>${esc(M.dayTitle(d, i))}</option>`))
      .join('');
    const inbox = currentListId === M.INBOX ? '' : `<option value="${M.INBOX}">${esc(t('장소 보관함'))}</option>`;
    return `<option value="">${esc(placeholder)}</option>${days}${inbox}`;
  }

  function moveToList(itemId, listId) {
    const found = M.findItem(ctx.trip, itemId);
    if (!found || !listId || !M.moveItem(ctx.trip, itemId, listId, Infinity)) return;
    ui.openItem = null;
    saved(commit(), t('"{name}" → {list}(으)로 옮겼어요', { name: found.item.name, list: listName(listId) }));
  }


  function renderDock() {
    const dock = $('#inboxDock');
    const items = ctx.trip.inbox;
    dock.hidden = ui.readonly && !items.length; // 공유받은 일정: 빈 보관함은 보여줄 게 없다
    dock.classList.toggle('is-empty', !items.length);
    // P1-5: 모바일은 접힌 한 줄("장소 보관함 5")이 기본. 직접 펼치거나 접었으면 그대로
    // I-6: 보드는 접힌 한 줄로 시작 (칸 높이는 보관함 높이만큼 줄어 겹치지 않는다)
    const open = prefs.dockOpen ?? !(narrowMq.matches || curView() === 'board');
    // 이름만 있는 칩: 누르면 액션 시트(보낼 날·지도에서 보기·삭제), 길게 눌러(터치) 끌면 일차로 옮긴다
    const chips = items
      .map(
        (it) => `<li class="item dock-card dock-chip" data-id="${it.id}" style="--c:${INBOX_COLOR}">
        <button type="button" class="chip-btn" data-action="chip-menu" title="${esc(it.name)}" aria-label="${esc(ui.readonly ? t('{name} 지도에서 보기', { name: it.name }) : t('{name} — 보낼 날·지도·삭제', { name: it.name }))}"><span class="nm">${esc(it.name)}</span></button>
      </li>`,
      )
      .join('');
    dock.innerHTML = `<div class="dock-head">
      <button class="dock-toggle" data-action="dock-toggle" aria-expanded="${open}">
        <span class="dot" style="--c:${INBOX_COLOR}"></span><strong>${esc(t('장소 보관함'))}</strong>
        <span class="count">${esc(t('{n}곳', { n: items.length }))}</span><span class="chev">${esc(open ? t('접기 ▾') : t('펼치기 ▴'))}</span>
      </button>
    </div>
    ${
        open
          ? `<ol class="items dock-items dock-chips" data-list="${M.INBOX}" data-empty="${esc(t('여기로 끌어오거나, 추가할 곳을 장소 보관함으로 고르세요'))}">${chips}</ol>`
          : ''
      }`;
  }

  /** P1-5: 보관함 칩을 누르면 — 보낼 날 / 지도에서 보기 / 삭제 */
  async function openChipMenu(id) {
    const found = M.findItem(ctx.trip, id);
    if (!found) return;
    if (ui.readonly) return locateMapPlace(found.item); // 공유받은 일정: 지도에서 보기만
    const choice = await ask({
      title: found.item.name,
      html: `<label class="chip-send">${esc(t('보낼 날'))}<select id="chipMoveTo" class="inp" data-ui-select>${moveOptions(M.INBOX, t('보낼 날 →'))}</select></label>`,
      actions: [
        { value: 'delete', label: t('삭제'), danger: true },
        { value: 'locate', label: t('지도에서 보기') },
        { value: 'send', label: t('보내기'), primary: true },
      ],
    });
    const target = $('#chipMoveTo')?.value;
    if (choice === 'send' && target) moveToList(id, target);
    else if (choice === 'locate') locateMapPlace(found.item);
    else if (choice === 'delete') {
      const index = found.index;
      const copy = structuredClone(found.item);
      const tripId = ctx.trip.id;
      M.removeItem(ctx.trip, id);
      if (commit().ok) {
        pushUndo(t('"{name}"을(를) 삭제했어요', { name: copy.name }), () => {
          if (ctx.trip?.id !== tripId || ui.readonly || M.findItem(ctx.trip, copy.id)) return;
          ctx.trip.inbox.splice(Math.min(index, ctx.trip.inbox.length), 0, copy);
          saved(commit(), t('되돌렸어요'));
        });
      }
    }
  }

  /** 하루 타임라인 본문: 항공(출발) → 출발 숙소 → 장소들 → 귀가 숙소 → 항공(귀국) */
  function dayBodyHtml(l) {
    const st = M.dayStays(ctx.trip, l.dayIndex);
    // 구간 거리: route[k-1] → route[k]. 출발 숙소가 있으면 장소 j는 route[j+1].
    const route = M.dayRoute(ctx.trip, l.dayIndex);
    const off = st.start ? 1 : 0;
    const legTo = (k) => {
      const leg = k > 0 && route[k] ? M.routeLeg(route[k - 1], route[k]) : null;
      return leg && { ...leg, from: route[k - 1], to: route[k], dayMode: dayTravelMode(l.dayIndex) };
    };
    const overlaps = dayTimeConflicts(l.dayIndex);
    const flightsTop = flightRowsHtml(l.dayIndex, 'top');
    const flightsBottom = flightRowsHtml(l.dayIndex, 'bottom');
    // 시간이 하나도 없는 날은 왼쪽 시간 칸을 접는다 (모바일에서 여백이 넓어 보이던 것)
    const noTimes = !l.items.some((it) => it.time) && !/class="tl-time">[^<]/.test(flightsTop + flightsBottom);
    return `<div class="timeline${noTimes ? ' no-times' : ''}" style="--c:${l.color}">
      ${flightsTop}
      ${st.start ? stayRowHtml(st.start, l.dayIndex, 'start', st) : ''}
      <ol class="items" data-list="${l.id}" data-empty="${esc(ui.readonly ? t('아직 정한 곳이 없어요') : t('장소를 검색하거나 여기로 끌어오세요'))}">${l.items.map((it, j) => itemHtml(it, j, true, legTo(off + j), l.items, overlaps.get(it.id) ?? '')).join('')}</ol>
      ${st.end ? stayRowHtml(st.end, l.dayIndex, 'end', st, legTo(route.length - 1)) : ''}
      ${flightsBottom}
    </div>`;
  }

  function dayToolsHtml(l) {
    const points = M.dayRoute(ctx.trip, l.dayIndex);
    const next = points.slice(1).find((point) => M.routeLeg(points[0], point));
    const primary = next && M.tripDirectionsLinks(ctx.trip, next, points[0], prefs.directionsApp, dayTravelMode(l.dayIndex) || undefined)[0];
    // 그날 전체(숙소 → 장소들 → 숙소)를 경유지로 넣은 구글맵 길찾기. 구간별 길찾기(고덕·네이버 등)는 각 이동 구간에 그대로 있다.
    // 경유지가 구글맵 한도(9곳)를 넘으면 첫 구간만 연다.
    const fullRoute = M.routeDirectionsUrl(points);
    const url = fullRoute || primary?.url;
    const label = fullRoute ? t('길찾기') : t('첫 구간 길찾기');
    const title = fullRoute ? t('이 날 동선 전체를 경유지로 넣어 구글맵에서 열어요') : primary?.label ?? '';
    const link = url ? `<a class="route-link" href="${href(url)}" target="_blank" rel="noopener" title="${esc(title)}">${esc(label)}</a>` : '';
    const copy = `<button data-action="day-copy" data-day="${l.dayIndex}" title="${esc(t('이 날 일정을 카톡에 붙일 글로 복사해요'))}">${esc(t('카톡용 복사'))}</button>`;
    if (ui.readonly) return link + copy;
    // I-6/J-17: 자주 쓰는 [길찾기] [동선 정리]만 밖에 두고 나머지는 ⋯ 메뉴 하나로 (목록·보드 같은 구성).
    // 동선 정리는 늘 같은 자리에 있고, 쓸 수 없을 때는 흐리게 두고 이유를 알려 준다.
    const movable = l.items.filter((it) => !it.time && !it.pinned).length;
    const routeOff = movable < 2 ? t('시간을 정하지 않은 장소가 2곳 이상이면 쓸 수 있어요') : '';
    const routeBtn = `<button data-action="route-opt" data-list="${l.id}"${routeOff ? ` aria-disabled="true" aria-label="${esc(`${t('동선 정리')} · ${routeOff}`)}"` : ''} title="${esc(routeOff || t('숙소 기준으로 덜 돌아가는 순서를 찾아요. 시간을 정한 장소는 그대로 둬요'))}">${esc(t('동선 정리'))}</button>`;
    const more = `${copy}${M.nightStay(ctx.trip, l.dayIndex) ? '' : `<button data-action="stay-here" data-day="${l.dayIndex}" title="${esc(t('이 날부터 묵을 숙소 추가'))}">${esc(t('+ 숙소'))}</button>`}${
      l.items.length > 1 ? `<button data-action="sort-time" data-list="${l.id}">${esc(t('시간순'))}</button>` : ''}${
      ctx.trip.days.length > 1 ? `<button data-action="day-order" aria-haspopup="dialog" title="${esc(t('여러 날의 장소 묶음 순서를 한 번에 바꿔요 (날짜·숙소·항공편은 그대로)'))}">${esc(t('일자 순서'))}</button>` : ''
    }${
      ctx.trip.days.length > 1
        ? `<span class="swap-wrap"><span class="swap-label" aria-hidden="true">${esc(t('다른 날과 바꾸기'))}</span><select class="day-swap" data-day="${l.dayIndex}" aria-label="${esc(t('이 날 장소를 다른 날과 통째로 바꾸기'))}" title="${esc(t('이 날 장소를 다른 날과 통째로 바꿔요 (날짜·숙소·항공편은 그대로)'))}"><option value="">${esc(t('다른 날과 바꾸기'))}</option>${ctx.trip.days
            .map((d, i) => (i === l.dayIndex ? '' : `<option value="${i}">${esc(dayName(i))}${d.date ? ` · ${esc(M.formatDate(d.date))}` : ''}</option>`))
            .join('')}</select></span>`
        : ''
    }`;
    return `${link}${routeBtn}<details class="day-more"><summary title="${esc(t('더 보기'))}" aria-label="${esc(t('{day} 메뉴 더 보기', { day: dayName(l.dayIndex) }))}">⋯</summary><div class="menu-pop day-more-pop">${more}</div></details>`;
  }

  /* ───────── 동선 자동 정리 ─────────
   * 버튼 → 제안 계산(미리 보기) → 카드 안에서 순서를 직접 고칠 수 있다(끌기 · ↑↓) → 적용을 눌러야 일정이 바뀐다.
   * 고치는 동안은 카드 안의 임시 순서일 뿐이고, 취소·닫기는 원래 순서와 저장 상태를 그대로 둔다.
   * 그사이 그날 장소가 바뀌면 제안은 버리고 알려 준다.
   */
  const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
  const dayIds = (dayIndex) => ctx.trip.days[dayIndex]?.items.map((it) => it.id) ?? [];

  function currentRoutePlan() {
    const p = ui.routePlan;
    if (p && (ctx.trip.days[p.dayIndex]?.id !== p.listId || !sameIds(dayIds(p.dayIndex), p.current))) {
      ui.routePlan = null;
      setTimeout(() => toast(t('일정이 바뀌어서 동선 정리 제안을 닫았어요. 다시 눌러 계산해 주세요'), 3500), 0);
    }
    return ui.routePlan;
  }

  function currentRouteUndo() {
    const u = ui.routeUndo;
    if (u && (ctx.trip.days[u.dayIndex]?.id !== u.listId || !sameIds(dayIds(u.dayIndex), u.applied))) ui.routeUndo = null;
    return ui.routeUndo;
  }

  /** 제안 순서의 장소들 */
  const planItems = (p) => {
    const byId = new Map(ctx.trip.days[p.dayIndex].items.map((it) => [it.id, it]));
    return p.ids.map((id) => byId.get(id));
  };
  /** 기존 제안과 같은 규칙(출발 숙소 → 장소들 → 귀가 숙소 직선거리 합)으로 거리 계산 */
  function planKm(p) {
    const { start, end } = M.dayStays(ctx.trip, p.dayIndex);
    return M.pathKm([start, ...planItems(p), end]);
  }

  function proposeRoute(listId) {
    const dayIndex = ctx.trip.days.findIndex((d) => d.id === listId);
    const r = M.optimizeDay(ctx.trip, dayIndex);
    if (!r) return;
    if (!r.changed) {
      ui.routePlan = null;
      toast(r.fixed ? t('시간을 정했거나 고정한 곳을 그대로 두면 지금 순서가 가장 짧아요') : t('지금 순서가 이미 가장 짧아요'));
      return;
    }
    ui.routePlan = { listId, dayIndex, current: dayIds(dayIndex), ids: r.items.map((it) => it.id), beforeKm: r.beforeKm, afterKm: r.afterKm, fixed: r.fixed };
    ui.routeUndo = null;
    ui.focusList = listId;
    ui.day = dayIndex;
    renderDays();
    renderMap({ fit: true });
    $(`#day-${dayIndex} .route-plan`)?.focus({ preventScroll: true });
  }

  /** 제안 카드 안에서 순서 바꾸기 (임시 상태). 바뀔 때마다 순번·거리·지도 미리 보기를 바로 다시 그린다. */
  function updatePlanOrder(ids, { focus } = {}) {
    const p = currentRoutePlan();
    if (!p) return;
    p.ids = ids;
    p.afterKm = planKm(p);
    renderDays();
    renderMap();
    if (focus) {
      const row = $(`.route-plan [data-rp="${CSS.escape(focus.id)}"]`);
      const btn = row?.querySelector(`[data-dir="${focus.dir}"]`);
      (btn && !btn.disabled ? btn : row?.querySelector('[data-dir]:not(:disabled)') ?? row)?.focus({ preventScroll: true });
      const it = planItems(p).find((x) => x.id === focus.id);
      const n = p.ids.indexOf(focus.id) + 1;
      $('#rpStatus').textContent = t('{name}: {n}번째 · 예상 {km}', { name: it?.name ?? '', n, km: M.formatKm(p.afterKm) });
    }
  }

  function moveInPlan(id, dir) {
    const p = currentRoutePlan();
    if (!p) return;
    const order = planItems(p);
    const next = M.routeStep(order, p.ids.indexOf(id), dir);
    if (next) updatePlanOrder(next.map((it) => it.id), { focus: { id, dir } });
  }

  function applyRoute() {
    const p = currentRoutePlan();
    if (!p) return;
    if (!M.applyDayOrder(ctx.trip, p.dayIndex, p.ids)) {
      ui.routePlan = null;
      return toast(t('그사이 장소가 바뀌어서 다시 계산해 주세요'));
    }
    const unchanged = sameIds(p.ids, p.current);
    ui.routeUndo = unchanged ? null : { listId: p.listId, dayIndex: p.dayIndex, prev: p.current, applied: p.ids, savedKm: p.beforeKm - p.afterKm };
    ui.routePlan = null;
    saved(commit(), unchanged ? t('순서는 그대로예요') : '');
  }

  function undoRoute() {
    const u = currentRouteUndo();
    if (!u) return;
    M.applyDayOrder(ctx.trip, u.dayIndex, u.prev);
    ui.routeUndo = null;
    saved(commit(), t('원래 순서로 되돌렸어요'));
  }

  function kmChange(diff) {
    if (diff > 0.01) return t('이동 거리가 {km} 줄어요', { km: M.formatKm(diff) });
    if (diff < -0.01) return t('이동 거리가 {km} 늘어요', { km: M.formatKm(-diff) });
    return t('이동 거리는 지금과 같아요');
  }

  function routePlanHtml(l) {
    const plan = currentRoutePlan();
    if (plan?.listId === l.id) {
      const order = planItems(plan);
      const rows = order
        .map((it, i) => {
          const fixed = M.isFixedInRoute(it);
          const moved = plan.current[i] !== it.id;
          const up = M.routeStepTarget(order, i, -1) !== -1;
          const down = M.routeStepTarget(order, i, 1) !== -1;
          return `<li class="rp-row${fixed ? ' fixed' : moved ? ' moved' : ''}" data-rp="${esc(it.id)}"${fixed ? '' : ' tabindex="-1"'}>
          ${fixed ? '<span class="rp-drag off" aria-hidden="true"></span>' : `<span class="rp-drag" aria-hidden="true" title="${esc(t('끌어서 순서 바꾸기'))}">⋮⋮</span>`}
          <span class="rp-num">${i + 1}</span><span class="rp-name">${esc(it.name)}</span>${
              it.time ? `<span class="rp-tag">${esc(t('{time} 고정', { time: it.time }))}</span>` : it.pinned ? `<span class="rp-tag">${esc(t('자리 고정'))}</span>` : ''
            }
          ${fixed ? '' : `<span class="rp-move">
            <button type="button" data-action="rp-move" data-dir="-1"${up ? '' : ' disabled'} aria-label="${esc(t('{name} 위로 이동', { name: it.name }))}">↑</button>
            <button type="button" data-action="rp-move" data-dir="1"${down ? '' : ' disabled'} aria-label="${esc(t('{name} 아래로 이동', { name: it.name }))}">↓</button>
          </span>`}
        </li>`;
        })
        .join('');
      return `<div class="route-plan" role="region" tabindex="-1" aria-label="${esc(t('동선 정리 제안'))}">
        <div class="rp-head">
          <strong>${esc(t('동선 정리 제안'))}</strong>
          <span class="rp-km">${M.formatKm(plan.beforeKm)} → <b>${M.formatKm(plan.afterKm)}</b></span>
        </div>
        <p class="rp-sub">${esc(kmChange(plan.beforeKm - plan.afterKm))}. ${esc(t('숙소 기준 직선거리로 계산했어요'))}${plan.fixed ? ` · ${esc(t('시간을 정했거나 고정한 {n}곳은 그대로 둬요', { n: plan.fixed }))}` : ''}. ${esc(t('끌거나 ↑↓로 순서를 직접 고칠 수 있어요.'))}</p>
        <ol class="rp-list">${rows}</ol>
        <p id="rpStatus" class="sr-only" role="status"></p>
        <div class="rp-actions">
          <button class="btn" data-action="route-cancel">${esc(t('취소'))}</button>
          <button class="btn primary" data-action="route-apply">${esc(t('이 순서로 바꾸기'))}</button>
        </div>
      </div>`;
    }
    const undo = currentRouteUndo();
    if (undo?.listId === l.id) {
      return `<div class="route-done"><span>${esc(t('동선을 바꿨어요 · {change}', { change: kmChange(undo.savedKm) }))}</span><button data-action="route-undo">${esc(t('되돌리기'))}</button></div>`;
    }
    return '';
  }

  /** 하루 카드: 머리(날짜·장소 이름·요약) + 타임라인. 목록형은 위아래로, 보드형은 칸으로 늘어놓는다. */
  const dayTravelMode = (index) => {
    const mode = ctx.trip.days[index].travelMode;
    return ['walking', 'transit', 'driving'].includes(mode) ? mode : '';
  };

  function dayWarningHtml(warnings, items) {
    const labels = {
      order: t('시간 겹침 확인'), flight: t('항공편 시간 확인'), movement: t('예상 이동 3시간 초과'),
      count: t('장소 8곳 이상'), closed: t('휴무 요일에 방문'), hours: t('영업시간 밖 방문'),
    };
    return warnings.map(({ id, kind }) => {
      const name = items.find((item) => item.id === id)?.name;
      const level = kind === 'order' || kind === 'flight' ? 'error' : 'caution';
      return `<button type="button" class="chip day-warning ${level}" data-action="day-warning" data-place="${esc(id)}" aria-label="${esc([labels[kind], name].join(' · '))}">${esc(labels[kind])}</button>`;
    }).join('');
  }

  function dayTravelSelect(index) {
    const modes = { '': t('자동'), walking: t('도보'), transit: t('대중교통'), driving: t('택시') };
    const selected = dayTravelMode(index);
    return `<select class="day-travel-select" data-ui-select data-day-travel="${index}" aria-label="${esc(t('예상 이동 수단'))}">${Object.entries(modes)
      .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  }

  function dayCardHtml(l) {
    const sum = M.daySummary(ctx.trip, l.dayIndex);
    const check = checkDay(ctx.trip, l.dayIndex, dayTravelMode(l.dayIndex));
    const night = M.nightStay(ctx.trip, l.dayIndex);
    const date = M.formatDate(ctx.trip.days[l.dayIndex].date);
    const dayId = ctx.trip.days[l.dayIndex].id;
    const longChip = check.longLegs ? t('장거리 {n}구간(수단 미정)', { n: check.longLegs }) : '';
    const moveChip = check.minutes && longChip ? `${travelEstimate(check.minutes)} + ${longChip}` : check.minutes ? travelEstimate(check.minutes) : longChip;
    const chips = [
      sum.places ? `<span class="chip">${esc(t('{n}곳', { n: sum.places }))}</span>` : '',
      moveChip ? `<span class="chip${check.longLegs ? ' long' : ''}">${esc(moveChip)}</span>` : '',
      sum.km >= 0.05 && !ui.readonly ? dayTravelSelect(l.dayIndex) : '',
      sum.from ? `<span class="chip">${esc(sum.from)}${sum.to !== sum.from ? ` – ${esc(sum.to)}` : ''}</span>` : '',
    ].join('');
    const infoOpen = ui.dayInfoOpen?.has(dayId);
    const info = [
      `<span class="wx-slot" data-wx="${dayId}">${wxChipHtml(ui.weather.data[dayId], dayId)}</span>`,
      sum.km >= 0.05 ? `<span class="chip">${esc(t('이동 {km}', { km: M.formatKm(sum.km) }))}</span>` : '',
      check.firstKm != null ? `<span class="chip">${esc(t('숙소에서 첫 장소까지 {km}', { km: M.formatKm(check.firstKm) }))}</span>` : '',
      // J-16: 수단별 합계 (두 가지 이상일 때만)
      Object.keys(check.byMode).length > 1 ? `<span class="chip modes">${esc(Object.entries(check.byMode).map(([mode, min]) => `${SEG_LABELS()[mode]} ${durationText(min, false)}`).join(' · '))}</span>` : '',
    ].join('');
    const infoBtn = `<button type="button" class="chip info-toggle" data-action="day-info" data-day-id="${dayId}" aria-expanded="${Boolean(infoOpen)}" aria-controls="dinfo-${dayId}" title="${esc(t('예보·총 거리·숙소에서 첫 장소까지'))}" aria-label="${esc(t('{day} 자세한 정보', { day: dayName(l.dayIndex) }))}">ⓘ</button>`;
    const stayChip = night ? `<span class="chip stay" title="${esc(`${t('오늘 밤 숙소')} · ${night.name}`)}"><span class="chip-text">${esc(t('오늘 밤 숙소'))} · ${esc(night.name)}</span></span>` : '';
    return `<section id="day-${l.dayIndex}" class="day daycard card${ui.focusList === l.id ? ' is-focus' : ''}" style="--c:${l.color}" aria-label="${esc(M.dayTitle(ctx.trip.days[l.dayIndex], l.dayIndex))}">
      <div class="dc-head">
        <button class="dc-title-btn" data-action="focus" data-list="${l.id}" title="${esc(t('지도에서 이 날만 보기'))}">
          <span class="dc-meta"><span class="dot"></span>${esc(dayName(l.dayIndex))}${date ? `<small>${esc(date)}</small>` : ''}</span>
          <span class="dc-title${sum.title ? '' : ' empty'}"${sum.title ? ` title="${esc(sum.title)}"` : ''}>${sum.title ? esc(sum.title) : esc(t('아직 비어 있는 날'))}</span>
        </button>
        <div class="day-tools">${dayToolsHtml(l)}</div>
      </div>
      <div class="chips day-chips${infoOpen ? ' info-open' : ''}">${chips}${infoBtn}<span class="chips-more" id="dinfo-${dayId}">${info}</span>${stayChip}</div>
      ${check.warnings.length ? `<div class="chips day-warnings">${dayWarningHtml(check.warnings, l.items)}</div>` : ''}
      <div class="wx-hint-slot" data-wx-hint="${dayId}">${wxHintHtml(ui.weather.data[dayId], dayId)}</div>
      ${ui.readonly ? '' : routePlanHtml(l)}
      ${dayBodyHtml(l)}
    </section>`;
  }

  function renderDays() {
    if (ctx.nearby && (ctx.nearby.context !== nearbyContext() || currentCity() || ui.readonly)) resetNearby();
    ui.sortables.forEach((s) => s.destroy());
    ui.sortables = [];
    const daysEl = $('#days');
    editorMore = $('.editor-more[open]', daysEl)?.closest('.item')?.dataset.id ?? null;
    const lists = allLists()
      .filter((l) => l.isDay)
      .map((l, i) => ({ ...l, dayIndex: i, title: M.dayTitle(ctx.trip.days[i], i) }));
    ui.day = Math.max(0, Math.min(ui.day ?? 0, lists.length - 1));
    renderDock();
    renderDayTabs();
    destroyTimes(daysEl); // P1-1: 다시 그리기 전에 시간 선택기(flatpickr)를 정리한다
    // J-20: 추천 데이터가 있는 도시는 맨 앞, "준비 중" 안내는 맨 끝(보드에서는 맨 오른쪽)
    const trendsHtml = ui.readonly ? '' : trendSectionHtml();
    const pending = Boolean(trendsHtml) && !currentCity();
    daysEl.innerHTML = (pending ? '' : trendsHtml) + lists.map(dayCardHtml).join('') + (pending ? trendsHtml : '');
    enhanceDates(daysEl);
    enhanceTimes(daysEl); // P1-1: 장소 시간도 같은 TimeField

    for (const ol of [...$$('ol.items', daysEl), ...$$('ol.items', $('#inboxDock'))]) {
      ui.sortables.push(
        new Sortable(ol, {
          group: 'plan',
          disabled: Boolean(ui.readonly),
          handle: ol.classList.contains('dock-chips') ? '.chip-btn' : '.drag', // P1-5: 칩은 칩 자체를 끈다 (터치는 길게 눌러서)
          animation: 150,
          ghostClass: 'ghost-item',
          emptyInsertThreshold: 24,
          // P1-4: 터치는 길게 눌러야 끌기 시작 (스크롤과 겹치지 않게)
          delay: 250,
          delayOnTouchOnly: true,
          touchStartThreshold: 6,
          onEnd: (e) => {
            if (!M.moveItem(ctx.trip, e.item.dataset.id, e.to.dataset.list, e.newIndex)) return;
            // 시간이 있는 장소를 옮기면 새 자리의 앞뒤 시간에 맞춘다 (보관함으로 옮길 때는 그대로)
            const day = ctx.trip.days.find((d) => d.id === e.to.dataset.list);
            const index = day ? day.items.findIndex((it) => it.id === e.item.dataset.id) : -1;
            const fit = index >= 0 ? M.fitMovedTime(day.items, index) : null;
            if (!commit().ok || !fit) return;
            const item = day.items[index];
            pushUndo(fit.to ? t('{name} 시간을 {from} → {to}로 바꿨어요', { name: item.name, from: fit.from, to: fit.to })
              : t('{name}의 {from} 시간이 새 자리와 맞지 않아 비웠어요', { name: item.name, from: fit.from }), () => {
              item.time = fit.from;
              commit();
            });
          },
        }),
      );
    }

    // 동선 정리 제안 카드: 끌어서 순서 바꾸기 (고정 장소는 제자리)
    const rp = $('.rp-list', daysEl);
    if (rp) {
      ui.sortables.push(
        new Sortable(rp, {
          handle: '.rp-drag:not(.off)',
          filter: '.fixed',
          preventOnFilter: false,
          animation: 150,
          ghostClass: 'ghost-item',
          onEnd: (e) => {
            const p = currentRoutePlan();
            if (!p || e.oldIndex === e.newIndex) return;
            const byId = new Map(planItems(p).map((it) => [it.id, it]));
            const dragged = $$('[data-rp]', rp).map((li) => byId.get(li.dataset.rp));
            updatePlanOrder(M.routeReorder(planItems(p), dragged).map((it) => it.id), { focus: { id: e.item.dataset.rp, dir: 0 } });
          },
        }),
      );
    }

    // 트렌드 카드: 복사해서 끌어가기만 가능 (트렌드 목록 자체는 바뀌지 않음)
    const trendList = $('.trend-list', daysEl);
    if (trendList) {
      ui.sortables.push(
        new Sortable(trendList, {
          group: { name: 'plan', pull: 'clone', put: false },
          sort: false,
          animation: 150,
          // P1-4: 터치에서는 길게 눌러야(250ms) 끌기 시작 — 좌우로 밀면 늘 가로 스크롤
          delay: 250,
          delayOnTouchOnly: true,
          touchStartThreshold: 6,
          filter: 'a, button',
          preventOnFilter: false,
          onEnd: (e) => {
            if (e.to === e.from) return;
            const listId = e.to.dataset.list;
            e.item.remove(); // 끌려간 카드 DOM은 버리고 일정 항목으로 새로 그린다
            addTrend(e.item.dataset.trend, listId, e.newIndex);
          },
        }),
      );
    }
  }

  function openItem(id, { scroll = false } = {}) {
    const dayIdx = ctx.trip.days.findIndex((d) => d.id === listIdOf(id));
    if (dayIdx !== -1 && dayIdx !== ui.day && curView() !== 'board') {
      ui.day = dayIdx;
      ui.focusList = ctx.trip.days[dayIdx].id;
      renderMap();
    }
    ui.openItem = id;
    ui.openStay = null;
    renderDays();
    if (scroll) {
      showTab('plan');
      const el = $(`.item[data-id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.classList.add('flash');
    }
  }

  /* ───────── 펼친 장소 카드: 바깥을 탭하면 접기 ─────────
   * 지도·팝업·대화상자·날짜 선택 창은 제외하고, 8px 넘게 움직인 터치(스크롤)는 탭으로 보지 않는다.
   */
  // 보관함과 select는 제외: 카드를 접으며 일정을 다시 그리면 열리던 "보낼 날" 드롭다운이 새 요소로 바뀌어 닫힌다
  const OUTSIDE_SAFE = '#map, .mapwrap, .leaflet-container, .leaflet-popup, dialog, .dp-pop, .menu, .tripsw, .toast, #toast, .ctx, .inbox-dock, select, option';
  let cardTap = null;
  document.addEventListener('pointerdown', (e) => {
    cardTap = (ui.openItem || ui.openStay) && e.isPrimary ? { x: e.clientX, y: e.clientY, target: e.target, scrollY } : null;
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (cardTap && Math.hypot(e.clientX - cardTap.x, e.clientY - cardTap.y) >= 8) cardTap = null;
  }, true);
  document.addEventListener('pointercancel', () => (cardTap = null), true);
  // 손가락을 뗄 때 좌표가 제자리로 돌아와도, 그사이 화면이 스크롤됐다면 드래그다 (관성 스크롤 포함)
  addEventListener('scroll', () => (cardTap = null), { capture: true, passive: true });
  document.addEventListener('pointerup', (e) => {
    const tap = cardTap;
    cardTap = null;
    if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 8 || Math.abs(scrollY - tap.scrollY) >= 8) return;
    const target = tap.target;
    if (!(target instanceof Element) || !document.contains(target)) return;
    if (target.closest(OUTSIDE_SAFE)) return;
    const card = ui.openItem
      ? $(`.item[data-id="${CSS.escape(ui.openItem)}"]`)
      : $(`.stay-row[data-key="${CSS.escape(ui.openStay)}"]`)?.closest('.tl-row');
    if (!card || card.contains(target)) return;
    // 입력 중인 칸이 카드 안에 있으면 (키보드가 떠 있는 상태 등) 닫지 않는다
    const active = document.activeElement;
    if (active && card.contains(active) && active.matches('select, input[type="time"], input.time-field, input[type="date"]') && target === document.documentElement) return;
    const item = ui.openItem;
    const stay = ui.openStay;
    // 다른 카드 열기 등 클릭 처리가 먼저 끝나게 한 박자 늦게 접는다
    setTimeout(() => {
      if (ui.openItem !== item || ui.openStay !== stay) return;
      ui.openItem = null;
      ui.openStay = null;
      renderDays();
    });
  }, true);

  /* ───────── 일정 목록 이벤트 ───────── */
  $('#days').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('.item')?.dataset.id;
    const action = btn.dataset.action;
    btn.closest('.day-more')?.removeAttribute('open'); // ⋯ 메뉴 안의 항목을 누르면 메뉴를 닫는다
    if (action === 'route-opt' && btn.getAttribute('aria-disabled') === 'true') {
      toast(btn.title);
      return;
    }
    if (action === 'seg-edit') {
      if (!ui.readonly) void editSegment(btn);
      return;
    }
    if (action === 'day-info') {
      ui.dayInfoOpen ??= new Set();
      const dayId = btn.dataset.dayId;
      const open = !ui.dayInfoOpen.has(dayId);
      open ? ui.dayInfoOpen.add(dayId) : ui.dayInfoOpen.delete(dayId);
      btn.setAttribute('aria-expanded', String(open));
      btn.closest('.day-chips')?.classList.toggle('info-open', open);
      return;
    }
    if (action === 'day-warning') {
      ui.openItem = btn.dataset.place;
      ui.openStay = null;
      renderDays();
      const target = $(`.item[data-id="${CSS.escape(ui.openItem)}"] .item-main`);
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    } else if (action === 'toggle') {
      ui.openItem = ui.openItem === id ? null : id;
      ui.openStay = null;
      renderDays();
      $(`.item[data-id="${CSS.escape(id)}"] .item-main`)?.focus({ preventScroll: true });
    } else if (action === 'locate') {
      const found = M.findItem(ctx.trip, id);
      if (!found) return;
      locateMapPlace(found.item);
    } else if (action === 'edit-time') {
      ui.openItem = id;
      ui.openStay = null;
      renderDays();
      $(`.item[data-id="${CSS.escape(id)}"] [data-field="time"]`)?.focus();
    } else if (action === 'push-30') {
      const found = M.findItem(ctx.trip, id);
      if (!found || ui.readonly) return;
      const n = M.shiftTimesFrom(found.list, found.index, 30);
      saved(commit(), n ? t('{n}곳의 시간을 30분씩 늦췄어요', { n }) : t('더 늦출 수 있는 시간이 없어요'));
      $(`.item[data-id="${CSS.escape(id)}"] [data-action="push-30"]`)?.focus({ preventScroll: true });
    } else if (action === 'delete') {
      const found = M.findItem(ctx.trip, id);
      if (found && confirm(t('"{name}"을(를) 삭제할까요?', { name: found.item.name }))) {
        M.removeItem(ctx.trip, id);
        ui.openItem = null;
        commit();
      }
    } else if (action === 'item-prev-day' || action === 'item-next-day') {
      // 하루 앞뒤로 원탭 이동 (그날 맨 끝에 넣는다)
      const found = M.findItem(ctx.trip, id);
      const di = ctx.trip.days.findIndex((d) => d.id === found?.listId);
      const to = ctx.trip.days[di + (action === 'item-prev-day' ? -1 : 1)];
      if (!found || !to) return;
      M.moveItem(ctx.trip, id, to.id, Infinity);
      ui.openItem = id;
      const r = commit();
      ($(`.item[data-id="${CSS.escape(id)}"] [data-action="${action}"]:not(:disabled)`) ?? $(`.item[data-id="${CSS.escape(id)}"] .item-main`))?.focus({ preventScroll: true });
      saved(r, t('"{name}" → {list}(으)로 옮겼어요', { name: found.item.name, list: listName(to.id) }));
    } else if (action === 'item-up' || action === 'item-down') {
      // 끌지 않고 순서 바꾸기 (키보드·터치)
      const found = M.findItem(ctx.trip, id);
      if (!found) return;
      const to = found.index + (action === 'item-up' ? -1 : 1);
      if (to < 0 || to >= found.list.length) return;
      M.moveItem(ctx.trip, id, found.listId, to);
      commit();
      const again = $(`.item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`);
      (again && !again.disabled ? again : $(`.item[data-id="${CSS.escape(id)}"] .order-row button:not(:disabled)`))?.focus({ preventScroll: true });
      toast(t('{name}: {n}번째', { name: found.item.name, n: to + 1 }));
    } else if (action === 'focus') {
      const listId = btn.dataset.list;
      ui.focusList = ui.focusList === listId ? null : listId;
      const di = ctx.trip.days.findIndex((d) => d.id === listId);
      if (di !== -1) ui.day = di;
      ui.target = listId;
      renderTarget();
      renderDays();
      renderMap({ fit: true });
    } else if (action === 'trend-scroll') {
      const list = $('.trend-list');
      const card = list?.querySelector('.trend-card');
      if (list && card) list.scrollBy({ left: Number(btn.dataset.dir) * (card.offsetWidth + 8), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } else if (action === 'trend-search') {
      const q = $('#search');
      q.scrollIntoView({ block: 'center', behavior: 'smooth' });
      q.focus({ preventScroll: true });
    } else if (action === 'nearby-load') {
      void loadNearby();
    } else if (action === 'nearby-add') {
      const index = Number(btn.closest('.trend-card')?.dataset.index);
      if (!ui.readonly && ctx.nearby?.context === nearbyContext()) addPlace(ctx.nearby.places?.[index]);
    } else if (action === 'trend-collection') {
      if (btn.dataset.collection === trendCollection() && trendsOpen()) return;
      ui.trendCollection = btn.dataset.collection;
      if (!trendsOpen()) {
        prefs.trendsUser = true;
        savePrefs();
      }
      renderDays();
      renderMap();
      $(`#trend-tab-${ui.trendCollection}`)?.focus({ preventScroll: true });
    } else if (action === 'trend-toggle') {
      prefs.trendsUser = !trendsOpen();
      savePrefs();
      renderDays();
      renderMap();
    } else if (action === 'add-trend') {
      addTrend(btn.closest('.trend-card')?.dataset.trend);
    } else if (action === 'sort-time') {
      M.sortByTime(M.getList(ctx.trip, btn.dataset.list));
      commit();
    } else if (action === 'pay' || action === 'unpay') {
      const found = M.findItem(ctx.trip, id);
      if (!found) return;
      if (action === 'unpay') {
        B.unpayPlace(ctx.trip, id);
        return void saved(commit(), t('결제 기록을 지웠어요'));
      }
      // 칸에 적은 금액으로 기록 (예정 비용이 비어 있으면 그 금액을 예정 비용으로도 둔다)
      const row = btn.closest('.cost-row');
      const amount = $('[data-cost="price"]', row)?.value;
      const cur = $('[data-cost="cur"]', row)?.value ?? 'local';
      const problem = B.amountProblem(amount);
      if (problem) {
        $('[data-cost="price"]', row)?.focus();
        return toast(problem, 3200);
      }
      if (!found.item.cost) B.setPlaceCost(found.item, amount, cur);
      B.ensureBudget(ctx.trip);
      const r = B.payPlace(ctx.trip, id, { amount, cur, today: TODAY });
      if (!r) return;
      saved(commit(), r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: bm(r.expense.krw) }));
    } else if (action === 'wx-ref') {
      ui.wxRefOpen ??= new Set();
      const dayId = btn.dataset.dayId;
      ui.wxRefOpen.has(dayId) ? ui.wxRefOpen.delete(dayId) : ui.wxRefOpen.add(dayId);
      paintWeather();
    } else if (action === 'day-copy') {
      copyText(M.dayShareText(ctx.trip, Number(btn.dataset.day)), t('그날 일정을 복사했어요. 카톡에 붙여넣으세요'));
    } else if (action === 'route-opt') {
      proposeRoute(btn.dataset.list);
    } else if (action === 'rp-move') {
      moveInPlan(btn.closest('[data-rp]').dataset.rp, Number(btn.dataset.dir));
    } else if (action === 'route-apply') {
      applyRoute();
    } else if (action === 'route-cancel') {
      const listId = ui.routePlan?.listId;
      ui.routePlan = null;
      renderDays();
      renderMap();
      $(`[data-action="route-opt"][data-list="${CSS.escape(listId ?? '')}"]`)?.focus({ preventScroll: true });
    } else if (action === 'route-undo') {
      undoRoute();
    } else if (action === 'place-ops' || action === 'place-move' || action === 'place-copy') {
      boundOpenPlaceOps(id, action === 'place-copy' ? 'copy' : 'move');
    } else if (action === 'day-order') {
      boundOpenDayOrder();
    } else if (action === 'duplicate') {
      const copy = M.duplicateItem(ctx.trip, id);
      if (!copy) return;
      ui.openItem = null;
      const r = commit();
      $(`.item[data-id="${CSS.escape(copy.id)}"]`)?.classList.add('flash');
      saved(r, t('"{name}"을(를) 복제했어요. 끌어서 다른 날로 옮길 수 있어요', { name: copy.name }));
    } else if (action === 'set-cat') {
      const found = M.findItem(ctx.trip, id);
      if (!found) return;
      found.item.category = found.item.category === btn.dataset.cat ? '' : btn.dataset.cat;
      commit();
    } else if (action === 'flight-edit') {
      if (!ui.readonly) openFlights(btn.dataset.flight);
    } else if (action === 'stay-toggle') {
      const row = btn.closest('.stay-row');
      if (!ui.readonly) return boundOpenStays({ id: row.dataset.stay });
      const key = row.dataset.key;
      ui.openStay = ui.openStay === key ? null : key;
      ui.openItem = null;
      renderDays();
    } else if (action === 'stay-locate') {
      const s = M.findStay(ctx.trip, btn.closest('.stay-row').dataset.stay);
      if (!s) return;
      locateMapPlace(s);
    } else if (action === 'stay-here') {
      boundOpenStays({ start: Number(btn.dataset.day) });
    }
  });

  $('#days').addEventListener('change', (e) => {
    if (!e.target.hasAttribute('data-visited') || ui.readonly) return;
    const found = M.findItem(ctx.trip, e.target.closest('.item')?.dataset.id);
    if (!found) return;
    found.item.visited = e.target.checked;
    commit();
    $(`.item[data-id="${CSS.escape(found.item.id)}"] [data-visited]`)?.focus({ preventScroll: true });
  });

  const refreshMapSoon = debounce(() => renderMap(), 300);
  $('#days').addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    const id = e.target.closest('.item')?.dataset.id;
    const found = id && M.findItem(ctx.trip, id);
    if (!field || !found) return;
    // P1-1: 시간 칸은 입력 중인 글자를 저장하지 않는다 — TimeField가 'HH:MM'(또는 빈 값)으로 확정할 때만
    if (field === 'time' && e.target.classList.contains('time-field') && !/^(\d{2}:\d{2})?$/.test(e.target.value)) return;
    found.item[field] = field === 'name' ? e.target.value || t('이름 없는 장소') : e.target.value;
    markEdited();
    M.touch(ctx.trip);
    persistSoon();
    const li = e.target.closest('.item');
    const it = found.item;
    $('.item-name', li).innerHTML = nameHtml(it);
    $('.item-sub', li).textContent = li.classList.contains('dock-card') ? it.memo.split('\n')[0] || it.address : it.memo || it.address;
    const timeEl = $('.tl-time', li);
    if (timeEl) timeEl.textContent = it.time;
    if (it.time) li.closest('.timeline')?.classList.remove('no-times'); // 시간을 넣으면 시간 칸을 다시 연다
    if (field === 'memo' || field === 'name') renderRetrospective();
    refreshMapSoon();
  });

  // 시간을 확정하면 그날 시간 겹침을 다시 계산한다 (입력 칸 포커스는 유지)
  $('#days').addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'time' && !e.target.dataset.hours) return;
    const id = e.target.closest('.item')?.dataset.id;
    const field = e.target;
    setTimeout(() => {
      if (!ctx.trip || ui.openItem !== id) return;
      const li = field.closest('.item');
      const focus = document.activeElement;
      // Tab으로 같은 장소의 다른 칸으로 옮겼으면 그 칸을 떠날 때 다시 그린다 (포커스를 빼앗지 않게)
      if (li && focus !== field && li.contains(focus)) {
        const later = (ev) => {
          if (li.contains(ev.relatedTarget)) return;
          li.removeEventListener('focusout', later);
          setTimeout(() => ctx.trip && ui.openItem === id && renderDays());
        };
        li.addEventListener('focusout', later);
        return;
      }
      const keep = focus === field;
      renderDays();
      const selector = field.dataset.hours ? `[data-hours="${field.dataset.hours}"]` : '[data-field="time"]';
      if (keep) $(`.item[data-id="${CSS.escape(id)}"] ${selector}`)?.focus({ preventScroll: true });
    });
  });

  // 순서 고정
  $('#days').addEventListener('change', (e) => {
    if (!e.target.matches('[data-pin]')) return;
    const found = M.findItem(ctx.trip, e.target.closest('.item')?.dataset.id);
    if (!found) return;
    if (e.target.checked) found.item.pinned = true;
    else delete found.item.pinned;
    commit();
  });
  $('#days').addEventListener('change', (e) => {
    if (ui.readonly) return;
    const field = e.target;
    if (field.matches('[data-day-travel]')) {
      const index = Number(field.dataset.dayTravel);
      const day = ctx.trip.days[index];
      if (field.value) day.travelMode = field.value;
      else delete day.travelMode;
      commit();
      const select = $(`[data-day-travel="${index}"]`);
      enhanceSelect(select);
      focusSelect(select);
      return;
    }
    if (!field.matches('[data-hours], [data-closed-day]')) return;
    const li = field.closest('.item');
    const found = M.findItem(ctx.trip, li.dataset.id);
    if (!found) return;
    if (field.dataset.hours) {
      const time = normalizeTime(field.value);
      if (time == null) return;
      found.item[field.dataset.hours] = time;
      markEdited();
      persistSoon();
    } else {
      found.item.closedWeekdays = $$('[data-closed-day]:checked', li).map((input) => Number(input.dataset.closedDay));
      const weekday = field.dataset.closedDay;
      commit();
      $(`.item[data-id="${CSS.escape(found.item.id)}"] [data-closed-day="${weekday}"]`)?.focus({ preventScroll: true });
    }
  });

  // 다른 날과 통째로 바꾸기 (다시 바꾸면 돌아간다)
  $('#days').addEventListener('change', (e) => {
    if (!e.target.matches('.day-swap') || e.target.value === '') return;
    const a = Number(e.target.dataset.day);
    const b = Number(e.target.value);
    if (!M.swapDays(ctx.trip, a, b)) return;
    ui.routePlan = ui.routeUndo = null;
    saved(commit(), t('{a} ↔ {b} 장소를 바꿨어요. 한 번 더 바꾸면 돌아가요', { a: dayName(a), b: dayName(b) }), 3000);
  });

  // 장소 예상 비용: 칸을 벗어나거나 통화를 바꾸면 저장 (가계부 "예상"에 바로 잡힌다)
  $('#days').addEventListener('change', (e) => {
    const key = e.target.dataset.cost;
    const li = key && e.target.closest('.item');
    const found = li && M.findItem(ctx.trip, li.dataset.id);
    if (!found) return;
    const row = e.target.closest('.cost-row');
    const price = $('[data-cost="price"]', row).value;
    const problem = price.trim() ? B.amountProblem(price) : null;
    if (problem) {
      toast(problem, 3200);
      return;
    }
    B.setPlaceCost(found.item, price, $('[data-cost="cur"]', row)?.value ?? 'local');
    commit();
  });

  boundBm = bm;
  boundCostTagHtml = costTagHtml;
  boundCurrentRoutePlan = currentRoutePlan;
  boundDayOptionAttrs = dayOptionAttrs;
  boundListName = listName;
  /* I-6: 하루 ⋯ 메뉴 — 칸 안 스크롤에 잘리지 않게 화면 기준(fixed)으로 띄우고, 바깥 누르기·Esc·스크롤에 닫는다 */
  const daysRoot = $('#days');
  function closeDayMenus(except) {
    for (const d of $$('.day-more[open]', daysRoot)) if (d !== except) d.removeAttribute('open');
  }
  daysRoot.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList?.contains('day-more') || !d.open) return;
    closeDayMenus(d);
    const pop = d.querySelector('.day-more-pop');
    const r = d.querySelector('summary').getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.style.left = '0px';
    pop.style.top = '0px';
    requestAnimationFrame(() => {
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
      const below = r.bottom + 4;
      const top = below + h > innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : below;
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      pop.style.visibility = '';
    });
  }, true);
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.day-more')) closeDayMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $('.day-more[open]', daysRoot);
    if (!open) return;
    open.removeAttribute('open');
    open.querySelector('summary')?.focus();
  });
  addEventListener('scroll', () => closeDayMenus(), { passive: true, capture: true });

  // 보관함 높이 → --dock-h (보드 칸 높이를 그만큼 줄인다)
  const dockEl = $('#inboxDock');
  new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${Math.round(dockEl.offsetHeight || 0)}px`)).observe(dockEl);

  boundMoveToList = moveToList;
  boundOpenChipMenu = openChipMenu;
  boundOpenItem = openItem;
  boundRenderDays = renderDays;
  boundTargetLabel = targetLabel;
}

export function initDock(ctx) {
  const {
    $, prefs, narrowMq, savePrefs, locateMapPlace, commit,
  } = ctx;

  /* ───────── 장소 보관함 (아래 고정 영역) / 날짜 옮기기 ───────── */
  $('#inboxDock').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('.item')?.dataset.id;
    if (btn.dataset.action === 'chip-menu') {
      boundOpenChipMenu(id);
    } else if (btn.dataset.action === 'dock-toggle') {
      prefs.dockOpen = btn.getAttribute('aria-expanded') !== 'true'; // 지금 보이는 상태의 반대로 (기본값은 화면·보기 방식마다 다르다)
      savePrefs();
      boundRenderDays();
      $('#inboxDock .dock-toggle')?.focus();
    } else if (btn.dataset.action === 'locate') {
      const found = M.findItem(ctx.trip, id);
      if (!found) return;
      locateMapPlace(found.item);
    } else if (/^place-(ops|move|copy)$/.test(btn.dataset.action)) {
      boundOpenPlaceOps(id, btn.dataset.action === 'place-copy' ? 'copy' : 'move');
    } else if (btn.dataset.action === 'delete') {
      const found = M.findItem(ctx.trip, id);
      if (found && confirm(t('"{name}"을(를) 삭제할까요?', { name: found.item.name }))) {
        M.removeItem(ctx.trip, id);
        commit();
      }
    }
  });
  for (const el of [$('#inboxDock'), $('#days')]) {
    el.addEventListener('change', (e) => {
      if (!e.target.matches('.move-to') || !e.target.value) return;
      boundMoveToList(e.target.closest('.item')?.dataset.id, e.target.value);
    });
  }
}

export function initDialogs(ctx) {
  const {
    $, esc, ui, showDialog, selectDay, showTab, prefs, savePrefs, renderMap, locateMapPlace, ask, commit, pushUndo,
    saved, closeOnBackdrop, toast,
  } = ctx;

  /* ───────── Phase 4: 다른 일차로 이동·복제 · 일자 순서 바꾸기 ─────────
   * 확정 전에 대상 일차의 항공편·숙소와 시간 충돌을 미리 보여 준다(D.placementPreview / D.dayOrderPreview).
   * 실행하면 작업마다 되돌리기를 실행 취소 스택에 쌓는다 — 5초 안에 연달아 한 작업을 하나씩 거꾸로 되돌린다.
   */

  const placeGroupsDialog = $('#placeGroupsDialog');

  function renderPlaceGroups() {
    const rows = groupPlaces(ctx.trip, $('#placeGroupsSort').value, locale());
    $('#placeGroupsList').innerHTML = rows.length ? rows.map(({ place, entries }) => {
      const visits = new Map();
      for (const entry of entries) {
        if (!visits.has(entry.listId)) visits.set(entry.listId, entry);
      }
      return `<article class="p3-row">
      <h3>${esc(place.name)}</h3><small>${esc(t('{n}회 등장', { n: entries.length }))}</small>
      <div class="p3-actions">${[...visits.values()].map(({ item, listId }) =>
          `<button type="button" class="btn place-visit" data-group-open="${esc(item.id)}">${esc(listId === M.INBOX ? t('보관함') : boundListName(listId))}</button>`).join('')}</div>
      <div class="p3-actions">
        <button type="button" class="btn" data-group-map="${esc(place.id)}">${esc(t('지도에서 보기'))}</button>
        ${ui.readonly ? '' : `<button type="button" class="btn danger" data-group-delete="${esc(place.id)}">${esc(t('모든 일정에서 삭제'))}</button>`}
      </div>
    </article>`;
    }).join('') : `<p>${esc(t('등록된 장소가 없어요'))}</p>`;
  }

  for (const el of [$('#placeGroupsBtn'), $('#heroStats')]) el.addEventListener('click', (e) => {
    if (!ctx.trip || !e.target.closest('[data-open-place-groups]')) return;
    renderPlaceGroups();
    showDialog(placeGroupsDialog);
  });
  $('#placeGroupsSort').addEventListener('change', renderPlaceGroups);
  placeGroupsDialog.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-close-place-groups')) return placeGroupsDialog.close();
    const { groupOpen, groupMap, groupDelete } = button.dataset;
    const found = (groupOpen || groupMap) && M.findItem(ctx.trip, groupOpen || groupMap);
    if (found) {
      placeGroupsDialog.close();
      const index = ctx.trip.days.findIndex((day) => day.id === found.listId);
      if (index >= 0) selectDay(index, { scroll: false });
      if (groupOpen) {
        if (index >= 0) {
          boundOpenItem(found.item.id, { scroll: true });
        } else {
          showTab('plan');
          prefs.dockOpen = true;
          savePrefs();
          boundRenderDays();
          const chip = $(`#inboxDock [data-id="${CSS.escape(found.item.id)}"] button`);
          chip?.scrollIntoView({ block: 'nearest' });
          chip?.focus({ preventScroll: true });
          boundOpenChipMenu(found.item.id);
        }
      } else {
        if (index < 0) {
          ui.focusList = null;
          renderMap();
        }
        locateMapPlace(found.item);
      }
      return;
    }
    if (!groupDelete || ui.readonly) return;
    const group = groupPlaces(ctx.trip).find(({ place }) => place.id === groupDelete);
    if (!group) return;
    const ids = new Set(group.entries.map(({ item }) => item.id));
    const tripId = ctx.trip.id;
    const keepExpenses = ctx.trip.expenses?.some((expense) => ids.has(expense.placeId));
    const choice = await ask({
      title: t('{n}개 일정에서 삭제할까요?', { n: group.entries.length }),
      body: [group.place.name, keepExpenses ? t('연결된 지출은 가계부에 남아요') : ''].filter(Boolean).join(' · '),
      actions: [{ value: 'delete', label: t('삭제'), danger: true }],
    });
    if (choice !== 'delete' || ctx.trip?.id !== tripId || ui.readonly) return;
    const restore = removePlaceGroup(ctx.trip, ids);
    if (ids.has(ui.openItem)) ui.openItem = null;
    ui.routePlan = ui.routeUndo = null;
    const result = commit();
    placeGroupsDialog.close();
    if (result.ok) pushUndo(t('"{name}"을(를) 삭제했어요', { name: group.place.name }), () => {
      if (ctx.trip?.id !== tripId || ui.readonly) return;
      restore(ctx.trip);
      saved(commit(), t('되돌렸어요'));
    });
  });
  closeOnBackdrop(placeGroupsDialog);

  const dayOpsDialog = $('#dayOpsDialog');
  ui.ops = null; // { kind: 'place', itemId, mode, to } | { kind: 'order', order }
  const dayLabelOf = (i) => `${dayName(i)}${ctx.trip.days[i]?.date ? ` · ${M.formatDate(ctx.trip.days[i].date)}` : ''}`;
  const conflictName = (kind) => (kind === 'flight' ? t('항공편 시간 확인') : t('시간 겹침'));

  function openPlaceOps(itemId, mode = 'move') {
    const found = M.findItem(ctx.trip, itemId);
    if (!found || ui.readonly) return;
    const from = ctx.trip.days.findIndex((d) => d.id === found.listId);
    // 이동은 인접 일차, 복제는 같은 장소가 없는 일차에서 시작한다.
    const to = from < 0 ? 0 : from + 1 < ctx.trip.days.length ? from + 1 : Math.max(0, from - 1);
    ui.ops = { kind: 'place', itemId, mode, to, copy: D.defaultCopyDays(ctx.trip, itemId, to), sig: daySig() };
    renderDayOps();
    showDialog(dayOpsDialog);
    $('#dayOpsBody input[name="opsDay"]:checked')?.focus();
  }

  function openDayOrder() {
    if (ui.readonly || ctx.trip.days.length < 2) return;
    ui.ops = { kind: 'order', order: ctx.trip.days.map((_, i) => i), sig: daySig() };
    renderDayOps();
    showDialog(dayOpsDialog);
    $('#dayOpsBody .do-move')?.focus();
  }

  function flightsLine(p) {
    if (!p.flights.length) return `<li class="ok">${esc(t('항공편 없음'))}</li>`;
    return p.flights
      .map((f) => {
        const what = f.role === 'arrive' ? t('{time} 도착', { time: f.time }) : f.role === 'depart' ? t('{time} 출발', { time: f.time }) : t('{time} 출발', { time: f.time });
        return `<li><svg class="ic" aria-hidden="true"><use href="#i-ticket"/></svg> ${esc(M.flightKind(f.kind))} · ${esc(f.label)} · <b>${esc(what)}</b></li>`;
      })
      .join('');
  }
  function staysLine(st) {
    const name = (s) => (s ? s.name : t('미정'));
    if (!st.start && !st.end) return `<li>${esc(t('숙소 미정'))}</li>`;
    return `<li><svg class="ic" aria-hidden="true"><use href="#i-home"/></svg> ${esc(t('출발 {a} → 귀가 {b}', { a: name(st.start), b: name(st.end) }))}</li>`;
  }

  function placeOpsHtml(op) {
    const found = M.findItem(ctx.trip, op.itemId);
    if (!found) return '';
    const from = ctx.trip.days.findIndex((d) => d.id === found.listId);
    const copying = op.mode === 'copy';
    const choices = copying ? D.copyDayChoices(ctx.trip, op.itemId) : [];
    const days = ctx.trip.days
      .map((d, i) => {
        const same = i === from;
        const disabled = same;
        const duplicate = choices[i]?.duplicate && !same;
        const hasFlight = D.dayBounds(ctx.trip, i).flights.length;
        return `<label class="do-day${disabled ? ' off' : ''}"><input type="${copying ? 'checkbox' : 'radio'}" name="opsDay" value="${i}"${(copying ? op.copy.has(i) : i === op.to) ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="do-day-name">${esc(dayName(i))}${d.date ? ` · ${esc(shortDate(d.date))}` : ''}</span>
        <small>${esc(t('{n}곳', { n: d.items.length }))}${hasFlight ? ` · ${esc(t('항공편'))}` : ''}${same ? ` · ${esc(t('지금 날'))}` : ''}${duplicate ? ` · ${esc(t('이미 있음'))}` : ''}</small></label>`;
      })
      .join('');
    const preview = (copying ? [...op.copy].sort((a, b) => a - b) : [op.to])
      .map((day) => placeOpsPreview(op, found, day)).join('');
    return `<div class="pin-seg do-mode" role="group" aria-label="${esc(t('이동 또는 복제'))}">
      <button type="button" data-ops-mode="move" aria-pressed="${op.mode === 'move'}" class="${op.mode === 'move' ? 'active' : ''}">${esc(t('이동'))}</button>
      <button type="button" data-ops-mode="copy" aria-pressed="${op.mode === 'copy'}" class="${op.mode === 'copy' ? 'active' : ''}">${esc(t('복제'))}</button>
    </div>
    <p class="fine do-what"><b>${esc(found.item.name)}</b>${from >= 0 ? ` · ${esc(t('지금 {day}', { day: dayName(from) }))}` : ` · ${esc(t('장소 보관함'))}`}</p>
    ${copying ? `<div class="p3-actions"><button type="button" class="btn" data-ops="all">${esc(t('전체 선택'))}</button>
      <button type="button" class="btn" data-ops="none">${esc(t('전체 해제'))}</button>
      <span role="status">${esc(t('{n}개 선택', { n: op.copy.size }))}</span></div>` : ''}
    <fieldset class="do-days"><legend>${esc(op.mode === 'move' ? t('옮길 날') : t('복제할 날'))}</legend>${days}</fieldset>
    ${preview}`;
  }

  function placeOpsPreview(op, found, day) {
    const p = D.placementPreview(ctx.trip, op.itemId, day, op.mode);
    const conflicts = p.ok ? p.conflicts : [];
    return p.ok
      ? `<section class="do-preview" aria-live="polite">
        <h3>${esc(t('{day} 미리보기', { day: dayLabelOf(day) }))}</h3>
        <p class="do-pos">${esc(found.item.time ? t('{time} 기준 시간순으로 {n}번째에 들어가요', { time: found.item.time, n: p.index + 1 }) : t('시간이 없어 맨 끝({n}번째)에 들어가요', { n: p.index + 1 }))}</p>
        <ul class="do-facts">${flightsLine(p)}${staysLine(p.stays)}</ul>
        ${
            conflicts.length
              ? `<ul class="do-conflicts">${conflicts
                  .map((c) => `<li class="${c.kind}${c.isTarget ? ' me' : ''}"><span class="tw-badge">${esc(conflictName(c.kind))}</span> ${esc(c.isTarget ? t('{name} (옮길 장소)', { name: c.name }) : c.name)}</li>`)
                  .join('')}</ul>
              <p class="do-warn" role="status">${esc(p.added ? t('확정하면 시간 충돌이 {n}건 새로 생겨요. 그래도 진행할 수 있고, 5초 안에 되돌릴 수 있어요.', { n: p.added }) : t('이미 있던 시간 충돌이에요. 새로 생기는 충돌은 없어요.'))}</p>`
              : `<p class="do-ok" role="status">✓ ${esc(t('항공편·기존 일정과 시간 충돌이 없어요'))}</p>`
          }
      </section>`
      : '';
  }

  function orderOpsHtml(op) {
    const p = D.dayOrderPreview(ctx.trip, op.order);
    const n = op.order.length;
    const rows = p.days
      .map((d, i) => {
        const moved = d.from !== d.to;
        return `<li class="do-row${moved ? ' moved' : ''}" data-from="${d.from}">
        <span class="do-slot">${esc(dayLabelOf(i))}</span>
        <span class="drag do-drag" aria-hidden="true">⋮⋮</span>
        <span class="do-block"><b>${esc(d.firstName || t('장소 없음'))}</b><small>${esc(d.count > 1 ? t('외 {n}곳', { n: d.count - 1 }) : d.count ? '' : '')}${moved ? ` · ${esc(t('원래 {day}', { day: dayName(d.from) }))}` : ''}</small>
          ${d.conflicts.length ? `<span class="do-row-warn">${d.conflicts.map((c) => `<span class="tw-badge ${c.kind}" title="${esc(c.name)}">${esc(conflictName(c.kind))}</span>`).join('')}</span>` : ''}</span>
        <span class="do-arrows">
          <button type="button" class="do-move" data-dir="-1" data-i="${i}"${i ? '' : ' disabled'} aria-label="${esc(t('{day} 장소 묶음을 하루 앞으로', { day: dayName(i) }))}">↑</button>
          <button type="button" class="do-move" data-dir="1" data-i="${i}"${i < n - 1 ? '' : ' disabled'} aria-label="${esc(t('{day} 장소 묶음을 하루 뒤로', { day: dayName(i) }))}">↓</button>
        </span>
      </li>`;
      })
      .join('');
    return `<p class="fine">${esc(t('날짜·숙소·항공편은 그대로 두고 각 날의 장소 묶음 순서를 바꿔요. 끌거나 ↑↓ 버튼으로 옮기세요.'))}</p>
    <ol class="do-order" aria-label="${esc(t('일자 순서'))}">${rows}</ol>
    <p class="${p.added ? 'do-warn' : 'do-ok'}" role="status" aria-live="polite">${esc(
        !p.changed ? t('순서를 바꾸면 여기서 충돌을 미리 알려 줘요') : p.added ? t('확정하면 항공편·시간 충돌이 {n}건 새로 생겨요. 그래도 진행할 수 있고, 5초 안에 되돌릴 수 있어요.', { n: p.added }) : `✓ ${t('새로 생기는 항공편·시간 충돌이 없어요')}`,
      )}</p>`;
  }

  let orderSortable = null;
  function renderDayOps({ focus } = {}) {
    const op = ui.ops;
    if (!op || !ctx.trip) return;
    orderSortable?.destroy();
    orderSortable = null;
    if (op.kind === 'place') {
      const found = M.findItem(ctx.trip, op.itemId);
      if (!found) return void dayOpsDialog.close();
      $('#dayOpsTitle').textContent = op.mode === 'move' ? t('다른 일차로 이동') : t('다른 일차로 복제');
      $('#dayOpsBody').innerHTML = placeOpsHtml(op);
      const ok = op.mode === 'move' ? Boolean(ctx.trip.days[op.to] && ctx.trip.days[op.to].id !== found.listId) : op.copy.size > 0;
      $('#dayOpsActions').innerHTML = `<button type="button" class="btn ghost" data-ops="cancel">${esc(t('취소'))}</button><button type="button" class="btn primary" data-ops="apply"${ok ? '' : ' disabled'}>${esc(op.mode === 'move' ? t('{day}(으)로 이동', { day: dayName(op.to) }) : t('{n}개 날에 복제', { n: op.copy.size }))}</button>`;
    } else {
      $('#dayOpsTitle').textContent = t('일자 순서 바꾸기');
      $('#dayOpsBody').innerHTML = orderOpsHtml(op);
      const changed = op.order.some((x, i) => x !== i);
      $('#dayOpsActions').innerHTML = `<button type="button" class="btn ghost" data-ops="cancel">${esc(t('취소'))}</button>${changed ? `<button type="button" class="btn" data-ops="reset">${esc(t('처음대로'))}</button>` : ''}<button type="button" class="btn primary" data-ops="apply"${changed ? '' : ' disabled'}>${esc(t('이 순서로 바꾸기'))}</button>`;
      // 끌어서 순서 바꾸기 (마우스·터치 모두 SortableJS). 날짜 칸(.do-slot)은 그대로 두고 장소 묶음만 옮긴 것으로 계산한다
      orderSortable = new Sortable($('#dayOpsBody .do-order'), {
        handle: '.do-drag',
        animation: 150,
        ghostClass: 'ghost-item',
        delay: 120,
        delayOnTouchOnly: true,
        onEnd: (e) => {
          if (e.oldIndex === e.newIndex) return;
          const next = [...op.order];
          const [x] = next.splice(e.oldIndex, 1);
          next.splice(e.newIndex, 0, x);
          op.order = next;
          renderDayOps();
        },
      });
    }
    if (focus) $(focus, dayOpsDialog)?.focus();
  }

  /** 대화상자를 연 뒤 일정(날짜·장소 배치)이 바뀌었는지 보는 표식 — 다른 탭 저장 등 */
  const daySig = () => JSON.stringify([
    ctx.trip.days.map((d) => [d.id, d.date, d.items.map((x) => [x.id, x.time, x.name, x.lat, x.lng, x.url])]),
    ctx.trip.inbox.map((x) => [x.id, x.time, x.name, x.lat, x.lng, x.url]),
    // 항공편·숙소도 미리보기 계산과 화면(편명·공항·숙소 이름)에 쓴다 (GPT 3차 #7, 4차 #4)
    (ctx.trip.flights ?? []).map((f) => [f.id, f.kind, f.departAt, f.arriveAt, f.flightNo, f.from, f.to]),
    (ctx.trip.stays ?? []).map((s) => [s.id, s.startIndex, s.nights, s.name]),
  ]);
  function applyDayOps() {
    const op = ui.ops;
    if (!op || ui.readonly) return;
    // 미리보기를 본 뒤 일정이 바뀌었으면 그대로 적용하지 않고 새 미리보기를 보여 준다 (GPT 2차 #8)
    if (op.sig !== daySig()) {
      op.sig = daySig();
      if (op.kind === 'order' && !D.isPermutation(op.order, ctx.trip.days.length)) op.order = ctx.trip.days.map((_, i) => i);
      if (op.kind === 'place') {
        if (!ctx.trip.days[op.to]) op.to = 0;
        op.copy = D.defaultCopyDays(ctx.trip, op.itemId, op.to);
      }
      renderDayOps({ focus: '[data-ops="apply"]' });
      toast(t('그사이 일정이 바뀌어 미리보기를 새로 고쳤어요. 확인하고 다시 눌러 주세요'), 4000);
      return;
    }
    const tripId = ctx.trip.id;
    if (op.kind === 'place') {
      const found = M.findItem(ctx.trip, op.itemId);
      if (!found) return;
      const name = found.item.name;
      const res = op.mode === 'move' ? D.moveToDay(ctx.trip, op.itemId, op.to) : D.copyToDays(ctx.trip, op.itemId, op.copy);
      if (!res) return;
      ui.openItem = null;
      ui.routePlan = ui.routeUndo = null;
      dayOpsDialog.close();
      if (!commit().ok) return;
      for (const item of res.items ?? [res.item]) $(`.item[data-id="${CSS.escape(item.id)}"]`)?.classList.add('flash');
      const msg = op.mode === 'move' ? t('"{name}" → {day}(으)로 옮겼어요', { name, day: dayName(op.to) }) : t('"{name}"을(를) {n}개 날에 복제했어요', { name, n: res.items.length });
      pushUndo(msg, () => {
        if (ctx.trip?.id !== tripId || ui.readonly) return;
        if (res.undo(ctx.trip)) saved(commit(), t('되돌렸어요'));
      });
    } else {
      const res = D.reorderDays(ctx.trip, op.order);
      if (!res) return;
      ui.routePlan = ui.routeUndo = null;
      dayOpsDialog.close();
      if (!commit().ok) return;
      pushUndo(t('일자 순서를 바꿨어요'), () => {
        if (ctx.trip?.id !== tripId || ui.readonly) return;
        if (res.undo(ctx.trip)) saved(commit(), t('되돌렸어요'));
      });
    }
  }

  dayOpsDialog.addEventListener('click', (e) => {
    const op = ui.ops;
    if (!op) return;
    const mode = e.target.closest('[data-ops-mode]')?.dataset.opsMode;
    if (mode && op.kind === 'place') {
      op.mode = mode;
      const from = ctx.trip.days.findIndex((d) => d.id === M.findItem(ctx.trip, op.itemId)?.listId);
      if (mode === 'move' && op.to === from) op.to = from + 1 < ctx.trip.days.length ? from + 1 : Math.max(0, from - 1);
      return renderDayOps({ focus: `[data-ops-mode="${mode}"]` });
    }
    const mv = e.target.closest('.do-move');
    if (mv && op.kind === 'order') {
      const i = Number(mv.dataset.i);
      const dir = Number(mv.dataset.dir);
      op.order = D.moveInOrder(op.order, i, dir);
      const j = i + dir;
      renderDayOps();
      // 옮긴 묶음의 같은 방향 버튼으로 포커스 (끝에 닿으면 반대 버튼)
      ($(`.do-move[data-i="${j}"][data-dir="${dir}"]:not(:disabled)`, dayOpsDialog) ?? $(`.do-move[data-i="${j}"]:not(:disabled)`, dayOpsDialog))?.focus();
      return;
    }
    const act = e.target.closest('[data-ops]')?.dataset.ops;
    if (act === 'all' || act === 'none') {
      op.copy = new Set(act === 'all' ? D.copyDayChoices(ctx.trip, op.itemId).filter((day) => !day.disabled).map((day) => day.index) : []);
      renderDayOps({ focus: `[data-ops="${act}"]` });
    } else if (act === 'cancel') dayOpsDialog.close();
    else if (act === 'reset' && op.kind === 'order') {
      op.order = ctx.trip.days.map((_, i) => i);
      renderDayOps({ focus: '.do-move' });
    } else if (act === 'apply') applyDayOps();
  });
  dayOpsDialog.addEventListener('change', (e) => {
    if (e.target.name !== 'opsDay' || ui.ops?.kind !== 'place') return;
    const day = Number(e.target.value);
    if (ui.ops.mode === 'copy') {
      if (e.target.checked) ui.ops.copy.add(day);
      else ui.ops.copy.delete(day);
    } else ui.ops.to = day;
    renderDayOps({ focus: `input[name="opsDay"][value="${day}"]` });
  });
  dayOpsDialog.addEventListener('close', () => {
    orderSortable?.destroy();
    orderSortable = null;
    ui.ops = null;
  });
  closeOnBackdrop(dayOpsDialog);

  boundOpenDayOrder = openDayOrder;
  boundOpenPlaceOps = openPlaceOps;
}
