// 倒数纪念日 —— 卡片条目（docs/05-modules/countdown.md）

import { Pin, Trash2 } from 'lucide-react';
import type { Countdown } from '@/types';
import { countdownBigText, countdownSubText } from '@/lib/countdownText';
import { todayKey } from '@/lib/date';
import { useI18n } from '@/i18n';

interface Props {
  c: Countdown;
  view?: 'card' | 'list';
  onEdit(): void;
  onDelete(): void;
}

export function CountdownCard({ c, view = 'card', onEdit, onDelete }: Props) {
  const { t } = useI18n();
  const today = todayKey();
  const big = countdownBigText(c, today, (k, p) => t(k, p));
  const sub = countdownSubText(c, today, t);
  const avatar = c.icon || c.title.slice(0, 1).toUpperCase();
  const color = c.color || 'var(--accent-focus)';
  const pinned = c.pinned === 1;

  if (view === 'list') {
    return (
      <div className="cd-row" role="button" tabIndex={0}
        onClick={onEdit} onKeyDown={(e) => { if (e.key === 'Enter') onEdit(); }}>
        <span className="cd-avatar" style={{ color, borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` }}>{avatar}</span>
        <span className="cd-row-info">
          <span className="cd-row-title">{c.title}{pinned && <Pin size={12} className="cd-pin" aria-label={t('cd.field.pinned')} />}</span>
          <span className="cd-sub">{c.note ? `${c.note} · ${sub}` : sub}</span>
        </span>
        <span className={`cd-big${big === t('cd.today') ? ' today' : ''}`}>{big}</span>
        <button type="button" className="icon-btn cd-del" aria-label={t('cd.deleteTitle')}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={14} /></button>
      </div>
    );
  }

  return (
    <div className="cd-card" role="button" tabIndex={0} onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter') onEdit(); }}>
      <div className="cd-card-head">
        <span className="cd-avatar" style={{ color, borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` }}>{avatar}</span>
        <span className="cd-title">{c.title}{pinned && <Pin size={12} className="cd-pin" aria-label={t('cd.field.pinned')} />}</span>
        <span className="cd-card-actions">
          <button type="button" className="icon-btn" aria-label={t('cd.edit')} onClick={(e) => { e.stopPropagation(); onEdit(); }}>⋯</button>
          <button type="button" className="icon-btn cd-del" aria-label={t('cd.deleteTitle')} onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={14} /></button>
        </span>
      </div>
      <div className={`cd-big${big === t('cd.today') ? ' today' : ''}`}>{big}</div>
      <div className="cd-sub">{sub}</div>
      {c.note && <div className="cd-note">{c.note}</div>}
    </div>
  );
}