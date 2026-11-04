import { DateTimeInput } from '@/components/controls/DateTimeInput';
import { Select } from '@/components/controls/Select';
// 倒数纪念日 创建/编辑弹窗（docs/05-modules/countdown.md）

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Countdown, CountdownKind, CountdownRepeat } from '@/types';
import type { CreateCountdownArgs } from '@/api/types';
import { useCountdownStore } from '@/stores/countdownStore';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';

const KINDS: CountdownKind[] = ['days_left', 'days_elapsed', 'yearly'];
const REPEATS: CountdownRepeat[] = ['once', 'yearly', 'monthly', 'custom_days'];
const ICONS = ['🎂', '🎉', '💍', '❤️', '⭐', '🔥', '📅', '⏰', '🚀', '🌸'];
const COLORS = ['', '#E85D3F', '#4A7DE0', '#7BA05B', '#D9A441', '#9B7BD4', '#5A9E8E', '#E589A8'];

interface Props {
  open: boolean;
  editing: Countdown | null;
  onClose(): void;
}

export function CountdownEditModal({ open, editing, onClose }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<CountdownKind>('days_left');
  const [repeat, setRepeat] = useState<CountdownRepeat>('once');
  const [intervalDays, setIntervalDays] = useState('30');
  const [note, setNote] = useState('');
  const [color, setColor] = useState('');
  const [icon, setIcon] = useState('');
  const [pinned, setPinned] = useState(false);
  const [remindEnabled, setRemindEnabled] = useState(false);
  const [remindDays, setRemindDays] = useState(0);
  const [err, setErr] = useState('');

  useModalA11y(open, onClose, rootRef, 'input');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (editing) {
      setTitle(editing.title); setDate(editing.date); setKind(editing.kind);
      setRepeat(editing.repeat);
      setIntervalDays(String(editing.interval_days ?? 30));
      setNote(editing.note); setColor(editing.color); setIcon(editing.icon);
      setPinned(editing.pinned === 1);
      setRemindEnabled(editing.remind_enabled === 1);
      setRemindDays(editing.remind_days);
    } else {
      setTitle(''); setDate(''); setKind('days_left'); setRepeat('once');
      setIntervalDays('30'); setNote(''); setColor(''); setIcon('');
      setPinned(false); setRemindEnabled(false); setRemindDays(0);
    }
  }, [open, editing]);

  if (!open) return null;

  const canSave = title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function confirm() {
    if (!canSave) { setErr(t('err.badFormat')); return; }
    const args: CreateCountdownArgs = {
      title: title.trim(),
      date,
      kind,
      repeat,
      intervalDays: repeat === 'custom_days' ? Math.max(1, Number(intervalDays) || 30) : null,
      note: note.trim(),
      color,
      icon,
      pinned: pinned ? 1 : 0,
      remindEnabled: remindEnabled ? 1 : 0,
      remindDays,
    };
    try {
      if (editing) await useCountdownStore.getState().update(editing.id, args);
      else await useCountdownStore.getState().create(args);
      onClose();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div ref={rootRef} className="modal cd-modal" role="dialog" aria-modal="true"
        aria-label={editing ? t('cd.edit') : t('cd.add')}
        style={{ width: 'min(620px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? t('cd.edit') : t('cd.add')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field">
            <span className="field-label">{t('cd.field.title')} *</span>
            <div className="field-body">
              <input className="text-input" autoFocus value={title} aria-label={t('cd.field.title')}
                placeholder={t('cd.field.title')}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void confirm(); }} />
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.date')} *</span>
            <div className="field-body">
              <DateTimeInput className="text-input" type="date" value={date} max="9999-12-31"
                aria-label={t('cd.field.date')} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.kind')}</span>
            <div className="field-body">
              <Select className="text-input" value={kind} aria-label={t('cd.field.kind')}
                onChange={(e) => setKind(e.target.value as CountdownKind)}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`cd.kind.${k}`)}</option>)}
              </Select>
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.repeat')}</span>
            <div className="field-body">
              <Select className="text-input" value={repeat} aria-label={t('cd.field.repeat')}
                onChange={(e) => setRepeat(e.target.value as CountdownRepeat)}>
                {REPEATS.map((r) => <option key={r} value={r}>{t(`cd.repeat.${r}`)}</option>)}
              </Select>
              {repeat === 'custom_days' && (
                <input className="text-input" type="number" min={1} max={3650} style={{ flex: '0 0 96px' }}
                  value={intervalDays} aria-label={t('cd.field.interval')}
                  onChange={(e) => setIntervalDays(e.target.value)} />
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.note')}</span>
            <div className="field-body">
              <input className="text-input" value={note} aria-label={t('cd.field.note')}
                onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.icon')}</span>
            <div className="field-body cd-icons">
              <button type="button" className={`cd-ic${icon === '' ? ' active' : ''}`}
                onClick={() => setIcon('')} aria-pressed={icon === ''}>—</button>
              {ICONS.map((g) => (
                <button key={g} type="button" className={`cd-ic${icon === g ? ' active' : ''}`}
                  onClick={() => setIcon(g)} aria-pressed={icon === g}>{g}</button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.color')}</span>
            <div className="field-body cd-colors">
              <button type="button" className={`cd-ic colorpick${color === '' ? ' active' : ''}`}
                onClick={() => setColor('')} aria-label={t('cd.field.color')} aria-pressed={color === ''}>—</button>
              {COLORS.filter(Boolean).map((c) => (
                <button key={c} type="button" className={`colorpick${color === c ? ' active' : ''}`}
                  style={{ background: c }} onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c} />
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('cd.field.remind')}</span>
            <div className="field-body">
              <label className="switch">
                <input type="checkbox" checked={remindEnabled} aria-label={t('cd.field.remind')}
                  onChange={(e) => setRemindEnabled(e.target.checked)} />
                <span className="track" />
              </label>
              <Select className="text-input" value={remindDays} disabled={!remindEnabled}
                aria-label={t('cd.field.remindDays')}
                onChange={(e) => setRemindDays(Number(e.target.value))}>
                <option value={0}>{t('cd.remind.0')}</option>
                <option value={1}>{t('cd.remind.1')}</option>
                <option value={3}>{t('cd.remind.3')}</option>
                <option value={7}>{t('cd.remind.7')}</option>
              </Select>
            </div>
          </div>

          <p className="acct-hint">{t('cd.remindStartlater')}</p>

          <div className="field">
            <span className="field-label">{t('cd.field.pinned')}</span>
            <div className="field-body">
              <label className="switch">
                <input type="checkbox" checked={pinned} aria-label={t('cd.field.pinned')}
                  onChange={(e) => setPinned(e.target.checked)} />
                <span className="track" />
              </label>
            </div>
          </div>

          {err && <p className="form-error" role="alert">{err}</p>}

          {/* 与 TaskEditModal 同款操作条：右对齐、8px 间距 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn primary" disabled={!canSave} onClick={() => void confirm()}>
              {t('cd.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}