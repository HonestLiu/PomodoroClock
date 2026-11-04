// 模态可访问性 —— Esc 关闭 / 焦点陷阱 / 打开时移入焦点 / 关闭后还原焦点。
// 多个模态叠层时只有最上层响应 Esc 与 Tab 循环（栈按挂载顺序维护）。

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const stack: HTMLElement[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.classList.contains('app-control-native') && (el.offsetParent !== null || el === document.activeElement),
  );
}

export function useModalA11y(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement | null>,
  /** 打开时优先聚焦的选择器，缺省为容器内首个可聚焦元素 */
  initialSelector?: string,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const selectorRef = useRef(initialSelector);
  selectorRef.current = initialSelector;

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const prev = document.activeElement as HTMLElement | null;

    if (root) stack.push(root);
    const raf = requestAnimationFrame(() => {
      if (!root) return;
      // A quickly opened child picker has already established its own focus.
      if (root.contains(document.activeElement) && (document.activeElement as HTMLElement | null)?.closest('[data-app-picker]')) return;
      const sel = selectorRef.current;
      const target = (sel ? root.querySelector<HTMLElement>(sel) : null) ?? focusables(root)[0] ?? root;
      target.focus?.();
    });

    function onKeyDown(e: KeyboardEvent) {
      if (!root) return;
      // 只有最上层模态处理键盘，避免嵌套弹层一次关闭多层
      if (stack[stack.length - 1] !== root) return;
      // 内嵌自绘选择面板先消费 Esc；第二次 Esc 再关闭父弹窗。
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.closest('[data-app-picker]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      const i = stack.indexOf(root!);
      if (i >= 0) stack.splice(i, 1);
      // 还原焦点（元素可能已随模态卸载，focus 调用会被忽略）
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, [open, rootRef]);
}
