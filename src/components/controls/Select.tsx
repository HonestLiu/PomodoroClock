import { useEffect, useId, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** Native value/validation bridge with an app-rendered, keyboard accessible picker. */
export function Select({ className = '', style, children, id, onChange, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const uid = useId();
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [items, setItems] = useState<{ value: string; label: string; disabled: boolean }[]>([]);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 200 });
  const [revision, refresh] = useState(0);
  useLayoutEffect(() => {
    const select = native.current;
    if (select) setLabel(select.selectedOptions[0]?.textContent ?? '');
  });
  function show() {
    if (props.disabled) return;
    setItems(Array.from(native.current?.options ?? []).map(o => ({ value: o.value, label: o.text, disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled) })));
    setOpen(true);
  }
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 160), window.innerWidth - 16);
    const height = Math.min(panel.current.scrollHeight, 280, window.innerHeight * .5);
    setPosition({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + height + 6 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - height - 6), width });
    (panel.current.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') ?? panel.current.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
  }, [open, items]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(); };
    const move = (e: Event) => { if (!panel.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', move); window.addEventListener('scroll', move, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', move); window.removeEventListener('scroll', move, true); };
  }, [open]);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  useEffect(() => {
    const form = native.current?.form;
    const reset = () => { setOpen(false); requestAnimationFrame(() => refresh(n => n + 1)); };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, []);
  return <>
    <select {...props} id={id ? `${id}-value` : undefined} ref={native} className="app-control-native" tabIndex={-1} aria-hidden="true"
      onInvalid={e => { e.preventDefault(); trigger.current?.focus(); }}
      onChange={e => { onChange?.(e); refresh(n => n + 1); }}>{children}</select>
    <button type="button" id={id} ref={trigger} disabled={props.disabled} className={`app-select ${className}`} style={style}
      aria-label={props['aria-label'] ?? label} aria-describedby={props['aria-describedby']} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? uid : undefined}
      onClick={() => open ? close() : show()} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } }}>
      <span>{label}</span><ChevronDown size={14} aria-hidden />
    </button>
    {open && <div id={uid} ref={panel} className="app-picker app-select-menu" data-app-picker role="listbox" aria-label={props['aria-label'] ?? label} style={position}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) close(); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        if (e.key === 'Tab') { close(true); }
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = -1;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = buttons.length - 1;
        if (e.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
        if (e.key === 'ArrowUp') next = Math.max(0, current - 1);
        if (e.key.length === 1 && e.key !== ' ') next = buttons.findIndex((b, i) => i > current && b.textContent?.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));
        if (next >= 0) { e.preventDefault(); buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' }); }
      }}>
      {items.map((item, i) => <button type="button" role="option" key={`${item.value}-${i}`} disabled={item.disabled} tabIndex={-1}
        aria-selected={native.current?.value === item.value} title={item.label}
        onMouseDown={e => e.preventDefault()} onClick={() => {
          const select = native.current;
          if (select) { select.value = item.value; select.dispatchEvent(new Event('change', { bubbles: true })); refresh(revision + 1); }
          close(true);
        }}><span>{item.label}</span><Check size={14} aria-hidden /></button>)}
    </div>}
  </>;
}
