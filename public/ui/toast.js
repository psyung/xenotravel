import { t } from '../lib/i18n.js';

let boundClearToast, boundPushUndo, boundToast;
export { boundClearToast as clearToast };
export { boundPushUndo as pushUndo };
export { boundToast as toast };

export function init(ctx) {
  const {
    $, undoStack,
  } = ctx;

  /* 토스트: 사라지면 글자도 지운다 (다른 화면의 접근성 트리·읽기 순서에 지난 안내가 남지 않게) */
  let toastTimer;
  function clearToast() {
    clearTimeout(toastTimer);
    const el = $('#toast');
    el.classList.remove('show', 'has-action');
    el.textContent = '';
  }

  function toast(text, ms = 2200, action = null) {
    if (!text) return;
    // 실행 취소가 아직 유효하면 일반 알림이 버튼을 지우지 않게 함께 둔다 (5초 안 되돌리기 보장)
    if (!action && undoStack.size()) {
      const n = undoStack.size();
      action = { label: n > 1 ? t('실행 취소 ({n})', { n }) : t('실행 취소'), run: () => {
        undoStack.undo();
        if (undoStack.size()) showUndoToast(t('되돌렸어요'));
      } };
      ms = Math.max(ms, undoStack.left());
    }
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('has-action', Boolean(action));
    const hide = () => {
      clearTimeout(toastTimer);
      el.classList.remove('show', 'has-action');
      toastTimer = setTimeout(() => (el.textContent = ''), 250);
    };
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-act';
      b.textContent = action.label;
      b.addEventListener('click', () => {
        hide();
        action.run();
      }, { once: true });
      el.append(' ', b);
      // 바로 닫을 수 있게 ✕ (백업 권유처럼 오래 떠 있는 알림)
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'toast-close';
      x.textContent = '×';
      x.setAttribute('aria-label', t('닫기'));
      x.addEventListener('click', hide, { once: true });
      el.append(x);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, ms);
  }

  /*
   * 실행 취소 스택 (5초): 연달아 지우거나 옮겨도 앞선 작업의 복구 데이터가 덮어쓰이지 않는다.
   * 토스트에는 가장 최근 작업과 남은 되돌리기 개수를 보여 주고, 누를 때마다 하나씩 거꾸로 되돌린다.
   */
  function pushUndo(text, run) {
    undoStack.push({ text, run, scope: ctx.trip?.id });
    showUndoToast();
  }
  function showUndoToast(prefix = '') {
    const top = undoStack.peek();
    if (!top) return;
    const n = undoStack.size();
    toast(prefix ? `${prefix} · ${top.text}` : top.text, undoStack.left(), {
      label: n > 1 ? t('실행 취소 ({n})', { n }) : t('실행 취소'),
      run: () => {
        const done = undoStack.undo();
        if (!done) return;
        if (undoStack.size()) showUndoToast(t('되돌렸어요'));
      },
    });
  }

  boundClearToast = clearToast;
  boundPushUndo = pushUndo;
  boundToast = toast;
}
