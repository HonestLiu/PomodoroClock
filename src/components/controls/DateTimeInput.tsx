import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useI18nStore } from '@/i18n';

const calendarDate = (year: number, month: number, day: number) => { const date = new Date(0); date.setHours(12, 0, 0, 0); date.setFullYear(year, month, day); return date; };
const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad(m + 1)}-${pad(d)}`;

export function DateTimeInput({ className = '', style, type = 'date', onChange, id, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const lang = useI18nStore(s => s.lang);
  const zh = lang === 'zh';
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(props.value ?? props.defaultValue ?? ''));
  const [cursor, setCursor] = useState(() => new Date());
  const [clock, setClock] = useState('12:00');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => { if (props.value !== undefined) setValue(String(props.value)); }, [props.value]);
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => { setOpen(false); requestAnimationFrame(() => setValue(input.current?.value ?? '')); };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, []);
  function show() {
    const current = input.current?.value ?? '';
    const date = current && type === 'date' ? new Date(`${current}T12:00:00`) : new Date();
    setCursor(Number.isNaN(date.getTime()) ? new Date() : date);
    setClock(type === 'time' && current ? current : '12:00');
    setOpen(true);
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  function commit(next: string) {
    const node = input.current;
    if (node) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, next);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      setValue(node.value);
    }
    close();
  }
  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect(); const p = panel.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8)), top: r.bottom + p.height + 6 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - p.height - 6) });
    (panel.current.querySelector<HTMLElement>('[aria-pressed="true"], [aria-selected="true"]') ?? panel.current.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    panel.current.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    const move = (e: Event) => { if (!panel.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', move); window.addEventListener('scroll', move, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', move); window.removeEventListener('scroll', move, true); };
  }, [open]);
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const days = calendarDate(y, m + 1, 0).getDate(), offset = calendarDate(y, m, 1).getDay();
  const allowed = (date: string) => (!props.min || date >= String(props.min)) && (!props.max || date <= String(props.max));
  const label = props['aria-label'] ?? (type === 'date' ? (zh ? '日期' : 'Date') : (zh ? '时间' : 'Time'));
  return <>
    <input {...props} ref={input} type={type} id={id ? `${id}-value` : undefined} className="app-control-native" tabIndex={-1} aria-hidden="true"
      onInvalid={e => { e.preventDefault(); trigger.current?.focus(); show(); }}
      onChange={e => { onChange?.(e); setValue(e.target.value); }} />
    <button type="button" id={id} ref={trigger} disabled={props.disabled} className={`app-date-trigger ${className}`} style={style}
      aria-label={label} aria-describedby={props['aria-describedby']} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => open ? close() : show()}>
      <span className={value ? '' : 'app-control-placeholder'}>{value || (type === 'date' ? 'YYYY-MM-DD' : 'HH:mm')}</span>
      {type === 'date' ? <CalendarDays size={14} aria-hidden /> : <Clock size={14} aria-hidden />}
    </button>
    {open && <div ref={panel} className="app-picker app-date-menu" data-app-picker role="dialog" aria-label={label} style={pos}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (type === 'time' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          const list = (e.target as HTMLElement).closest('[role="listbox"]');
          if (list) {
            const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
            const i = buttons.indexOf(e.target as HTMLButtonElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
            e.preventDefault(); buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' });
          }
        }
        if (type === 'date' && (e.target as HTMLElement).matches('.app-calendar-day') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.app-calendar-day'));
          const i = buttons.indexOf(e.target as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : i + ({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key] ?? 0);
          e.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
        }
      }}>
      {type === 'date' ? <>
        <div className="app-calendar-head">
          <button type="button" aria-label={zh ? '上个月' : 'Previous month'} disabled={y === 1 && m === 0} onClick={() => setCursor(calendarDate(y, m - 1, 1))}><ChevronLeft size={16} /></button>
          <input type="number" min={1} max={9999} aria-label={zh ? '年份' : 'Year'} value={y} onChange={e => { const year = Number(e.target.value); if (year >= 1 && year <= 9999) { const date = new Date(cursor); date.setFullYear(year); setCursor(date); } }} />
          <span>{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { month: 'short' }).format(cursor)}</span>
          <button type="button" aria-label={zh ? '下个月' : 'Next month'} disabled={y === 9999 && m === 11} onClick={() => setCursor(calendarDate(y, m + 1, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="app-calendar-grid">
          {(zh ? ['日','一','二','三','四','五','六'] : ['Su','Mo','Tu','We','Th','Fr','Sa']).map(day => <span key={day}>{day}</span>)}
          {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const date = key(y, m, i + 1);
            return <button type="button" className="app-calendar-day" key={date} aria-label={date} aria-pressed={date === value} disabled={!allowed(date)} onClick={() => commit(date)}>{i + 1}</button>;
          })}
        </div>
      </> : <div className="app-time-columns">
        {[24,60].map((count, column) => <div key={column} role="listbox" aria-label={column === 0 ? (zh ? '小时' : 'Hour') : (zh ? '分钟' : 'Minute')}>
          {Array.from({ length: count }, (_, i) => <button type="button" key={i} role="option" aria-selected={Number(clock.split(':')[column]) === i} onClick={() => {
            const parts = clock.split(':'); parts[column] = pad(i); setClock(parts.join(':'));
          }}>{pad(i)}</button>)}
        </div>)}
      </div>}
      <div className="app-picker-footer">
        {!props.required && <button type="button" onClick={() => commit('')}>{zh ? '清除' : 'Clear'}</button>}
        {type === 'date' ? <button type="button" disabled={!allowed(key(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))} onClick={() => { const date = new Date(); commit(key(date.getFullYear(), date.getMonth(), date.getDate())); }}>{zh ? '今天' : 'Today'}</button>
          : <button type="button" disabled={!allowed(clock)} onClick={() => commit(clock)}>{zh ? '确定' : 'Done'}</button>}
      </div>
    </div>}
  </>;
}
