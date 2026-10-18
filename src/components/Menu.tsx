// 轻量上下文菜单（⋆ 复用：任务更多菜单 / 右键菜单 / 通用下拉）
// 定位到 (x,y)，点外 / Esc 关闭；子项可携带子菜单。
// 键盘：打开即聚焦首项，↑↓ 在项间移动，→ 展开子菜单、← 收起，Esc / Tab 关闭并把焦点还给触发元素。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** 子菜单项 */
  children?: Array<MenuItem & { value?: string }>;
  onSelect?(payload?: string): void;
}

interface MenuProps {
  /** 锚点坐标（client 坐标） */
  x: number;
  y: number;
  items: MenuItem[];
  width?: number;
  onClose(): void;
  zIndex?: number;
}

export function Menu({ x, y, items, width = 208, onClose, zIndex = 400 }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<string | null>(null);

  // 视口内收拢，避免溢出
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 8),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开时聚焦第一项，关闭时把焦点还给触发按钮（右键菜单来自鼠标时 activeElement 可能为 body）
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
    first?.focus();
    return () => {
      if (prev && prev !== document.body && document.contains(prev)) prev.focus();
    };
  }, []);

  useEffect(() => {
    const onDown = () => onClose();
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const focusables = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    [],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    const list = focusables();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (openSub) { setOpenSub(null); } else { onClose(); }
      return;
    }
    if (e.key === 'Tab') { onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list.length) return;
      const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next].focus();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const row = document.activeElement as HTMLElement | null;
      const wrap = row?.closest('.menu-row-wrap');
      const key = wrap?.getAttribute('data-menu-key');
      if (e.key === 'ArrowRight' && key && wrap?.querySelector('.menu-sub')) {
        e.preventDefault();
        setOpenSub(key);
        wrap.querySelector<HTMLElement>('.menu-sub [role="menuitem"]')?.focus();
      } else if (e.key === 'ArrowLeft' && openSub) {
        e.preventDefault();
        setOpenSub(null);
      }
    }
  }

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos.left, top: pos.top, width, zIndex }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <MenuRow key={item.key} item={item} openSub={openSub} setOpenSub={setOpenSub} />
      ))}
    </div>
  );
}

function MenuRow({
  item, openSub, setOpenSub,
}: { item: MenuItem; openSub: string | null; setOpenSub(k: string | null): void }) {
  const hasSub = !!item.children?.length;
  const expanded = openSub === item.key && hasSub;
  return (
    <div
      className="menu-row-wrap"
      data-menu-key={item.key}
      onMouseEnter={() => setOpenSub(hasSub ? item.key : null)}
    >
      <button
        className="menu-row"
        role="menuitem"
        type="button"
        tabIndex={-1}
        disabled={item.disabled}
        aria-haspopup={hasSub ? 'menu' : undefined}
        aria-expanded={hasSub ? expanded : undefined}
        onClick={() => {
          if (!hasSub) item.onSelect?.();
          else setOpenSub(item.key);
        }}
        onContextMenu={(e) => { e.preventDefault(); }}
      >
        {item.icon && <span className="menu-ico" aria-hidden>{item.icon}</span>}
        <span className="menu-label" style={item.danger ? { color: 'var(--accent-focus)' } : undefined}>
          {item.label}
        </span>
        {hasSub && <span className="menu-arrow" aria-hidden>▸</span>}
      </button>
      {expanded && (
        <div className="menu menu-sub" role="menu" aria-label={typeof item.label === 'string' ? item.label : undefined}>
          {item.children!.map((sub) => (
            <button
              key={sub.key}
              className="menu-row"
              role="menuitem"
              type="button"
              tabIndex={-1}
              disabled={sub.disabled}
              onClick={() => { item.onSelect?.(sub.value); }}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
