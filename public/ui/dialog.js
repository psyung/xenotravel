import { t } from '../lib/i18n.js';

let boundAsk, confirmDialog;
export { boundAsk as ask };
export { confirmDialog as askDialog };

export function init(ctx) {
  const {
    $, esc,
  } = ctx;

  /* ───────── 확인 창 ─────────
   * ask({ title, body | html, actions: [{ value, label, primary, danger }], cancel }) → 고른 value | null(취소)
   * 고를 때까지 다른 화면은 그대로 둔다 (입력 중인 값도 지우지 않는다). 닫으면 원래 자리로 포커스를 돌려준다.
   */
  const askDialog = $('#askDialog');
  let askResolve = null;
  function ask({ title, body = '', html = '', actions, cancel = t('취소'), focusCancel = false }) {
    if (askResolve) askResolve(null);
    const back = document.activeElement;
    $('#askTitle').textContent = title;
    if (html) $('#askBody').innerHTML = html;
    else $('#askBody').textContent = body;
    $('#askActions').innerHTML = [
      cancel ? `<button type="submit" value="" class="btn ghost">${esc(cancel)}</button>` : '',
      ...actions.map((a) => `<button type="submit" value="${esc(a.value)}" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}">${esc(a.label)}</button>`),
    ].join('');
    askDialog.dataset.cancelable = cancel ? '1' : '';
    askDialog.returnValue = '';
    askDialog.showModal();
    ($(focusCancel ? '#askActions .ghost' : '#askActions .primary', askDialog) ?? $('#askActions button:last-child', askDialog))?.focus();
    return new Promise((resolve) => {
      askResolve = (v) => {
        askResolve = null;
        if (askDialog.open) askDialog.close();
        if (back?.isConnected) back.focus({ preventScroll: true });
        resolve(v);
      };
    });
  }
  askDialog.addEventListener('cancel', (e) => {
    if (!askDialog.dataset.cancelable) e.preventDefault(); // 꼭 골라야 하는 창 (저장 충돌)
  });
  askDialog.addEventListener('close', () => askResolve?.(askDialog.returnValue || null));

  boundAsk = ask;
  confirmDialog = askDialog;
}

/** 모달 열기: 닫으면 연 자리로 포커스를 돌려준다 */
export function showDialog(dlg) {
  const back = document.activeElement;
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (back?.isConnected && !document.querySelector('dialog[open]')) back.focus({ preventScroll: true });
  }, { once: true });
}

/* ───────── 모달: 바깥(배경) 클릭으로 닫기 ─────────
 * 누르기 시작한 곳과 뗀 곳이 모두 모달 박스 밖일 때만 닫는다.
 * (입력칸에서 글자를 드래그하다 밖에서 놓는 경우는 닫지 않음)
 */
export function closeOnBackdrop(dlg, canClose = () => true) {
  const outside = (e) => {
    if (e.target !== dlg) return false; // 모달 안쪽 요소를 누른 경우
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener('pointerdown', (e) => (downOutside = outside(e)));
  dlg.addEventListener('click', (e) => {
    if (downOutside && outside(e) && canClose()) dlg.close();
    downOutside = false;
  });
}
