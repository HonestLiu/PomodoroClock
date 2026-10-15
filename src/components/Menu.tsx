// 轻量上下文菜单（⋆ 复用：任务更多菜单 / 右键菜单 / 通用下拉）
// 定位到 (x,y)，点外 / Esc 关闭；子项可携带子菜单。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: pos.left, top: pos.top, width, zIndex }}
      onMouseDown={(e) => e.stopPropagation()}
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
  return (
    <div className="menu-row-wrap" onMouseEnter={() => setOpenSub(hasSub ? item.key : null)}>
      <button
        className="menu-row"
        disabled={item.disabled}
        onClick={() => {
          if (!hasSub) item.onSelect?.();
        }}
        onContextMenu={(e) => { e.preventDefault(); }}
      >
        {item.icon && <span className="menu-ico">{item.icon}</span>}
        <span className="menu-label" style={item.danger ? { color: 'var(--accent-focus)' } : undefined}>
          {item.label}
        </span>
        {hasSub && <span className="menu-arrow">▸</span>}
      </button>
      {openSub === item.key && hasSub && (
        <div className="menu menu-sub">
          {item.children!.map((sub) => (
            <button
              key={sub.key}
              className="menu-row"
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
