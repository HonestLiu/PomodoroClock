import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** 专注页任务选择：不依赖系统 picker，键盘焦点留在展开的选项中。 */
export function FocusTaskPicker({ value, label, disabled, options, onChange }: {
  value: string; label: string; disabled: boolean;
  options: { value: string; label: string }[];
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const selected = root.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?? root.current?.querySelector<HTMLElement>('[role="option"]');
    selected?.focus();
    selected?.scrollIntoView({ block: 'nearest' });
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return (
    <div className="focus-task-picker" ref={root} onBlur={e => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
    }}>
      <button type="button" ref={trigger} className="focus-task-trigger"
        disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? id : undefined} title={label}
        onClick={() => setOpen(!open)} onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); }
        }}>
        <span>{label}</span><ChevronDown size={14} aria-hidden className={open ? 'expanded' : ''} />
      </button>
      {open && <div id={id} className="focus-task-options" role="listbox" aria-label={label}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
          if (e.key === 'Tab') { setOpen(false); trigger.current?.focus(); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
            : Math.max(0, Math.min(items.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)));
          items[next]?.focus(); items[next]?.scrollIntoView({ block: 'nearest' });
        }}>
        {options.map(option => <button type="button" key={option.value} role="option"
          aria-selected={option.value === value} tabIndex={-1} title={option.label}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onChange(option.value); close(); }}>
          <span>{option.label}</span><Check size={14} aria-hidden />
        </button>)}
      </div>}
    </div>
  );
}
