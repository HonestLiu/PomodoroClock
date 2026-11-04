import { DateTimeInput } from '@/components/controls/DateTimeInput';
import { Select } from '@/components/controls/Select';
// 任务编辑弹层 —— 提醒事项字段体系（PRD FR-T3）
// 字段：标题 / 备注 / URL / 日期 / 时间 / 紧急 / 重复 / 提前提醒 / 列表 / 标签 / 旗标 / 优先级 / 预估番茄数
// 「发信息时」「添加附件」本期不做（用户拍板，不进数据模型）。

import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import type { ConfirmSpec } from './ConfirmDialog';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';
import type { LeadRemind, Recurrence, TaskPriority } from '@/types';

const REPEATS: Recurrence[] = ['none', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly'];
const LEADS: LeadRemind[] = ['none', '1d', '2d', '1w'];
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high'];

export function TaskEditModal({ onConfirm }: { onConfirm(spec: ConfirmSpec): void }) {
  const editingTaskId = useUiStore((s) => s.editingTaskId);
  const setEditingTask = useUiStore((s) => s.setEditingTask);
  const { tasks, lists, updateTask, deleteTask } = useDataStore();
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  const task = tasks.find((t) => t.id === editingTaskId) ?? null;
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  const [due, setDue] = useState('');
  const [time, setTime] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [repeat, setRepeat] = useState<Recurrence>('none');
  const [lead, setLead] = useState<LeadRemind>('none');
  const [listId, setListId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [flag, setFlag] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [est, setEst] = useState('0');
  useModalA11y(task !== null, () => setEditingTask(null), rootRef, 'input.text-input');

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes);
    setUrl(task.url ?? '');
    setDue(task.due_date ?? '');
    setTime(task.due_time ?? '');
    setUrgent(task.urgent === 1);
    setRepeat(task.repeat ?? 'none');
    setLead(task.lead_remind ?? 'none');
    setListId(task.list_id);
    setTags(Array.isArray(task.tags) ? task.tags : []);
    setFlag(task.flag === 1);
    setPriority(task.priority ?? 'none');
    setEst(String(task.est_pomodoros));
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  function addTag() {
    const raw = tagInput.trim();
    if (!raw) return;
    const parts = raw.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    setTags((prev) => [...new Set([...prev, ...parts])]);
    setTagInput('');
  }

  async function save() {
    const patch = {
      title: title.trim() || task!.title,
      notes,
      url: url.trim(),
      due_date: due || null,
      due_time: time || null,
      urgent: urgent ? 1 : 0,
      repeat,
      lead_remind: lead,
      list_id: listId,
      tags,
      flag: flag ? 1 : 0,
      priority,
      est_pomodoros: Number(est) || 0,
    };
    setEditingTask(null);
    await updateTask(task!.id, patch);
  }

  return (
    <div className="overlay" onClick={() => setEditingTask(null)}>
      <div
        className="modal" ref={rootRef}
        role="dialog" aria-modal="true" aria-labelledby="task-edit-title"
        style={{ width: 'min(540px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="task-edit-title">{t('task.edit')}</h2>
          <button className="icon-btn" onClick={() => setEditingTask(null)} aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <span className="field-label">{t('task.name')}</span>
            <div className="field-body">
              <input
                className="text-input" value={title} aria-label={t('task.name')}
                onChange={(e) => setTitle(e.target.value)} autoFocus
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.notes')}</span>
            <div className="field-body">
              <textarea
                className="text-input" style={{ height: 56, padding: 8, resize: 'vertical' }}
                aria-label={t('task.notes')}
                value={notes} onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.url')}</span>
            <div className="field-body">
              <input
                className="text-input" type="text" value={url} placeholder="https://…"
                aria-label={t('task.url')}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.due')}</span>
            <div className="field-body">
              <DateTimeInput
                className="text-input" type="date" value={due} aria-label={t('task.due')}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.time')}</span>
            <div className="field-body">
              <DateTimeInput
                className="text-input" type="time" value={time} aria-label={t('task.time')}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.urgent')}</span>
            <div className="field-body">
              <label className="switch">
                <input type="checkbox" checked={urgent} aria-label={t('task.urgent')} onChange={(e) => setUrgent(e.target.checked)} />
                <span className="track" />
              </label>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.repeat')}</span>
            <div className="field-body">
              <Select
                className="text-input" aria-label={t('task.repeat')}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Recurrence)}
              >
                {REPEATS.map((r) => <option key={r} value={r}>{t(`task.repeat.${r}`)}</option>)}
              </Select>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.lead')}</span>
            <div className="field-body">
              <Select
                className="text-input" aria-label={t('task.lead')}
                disabled={!time}
                value={lead}
                onChange={(e) => setLead(e.target.value as LeadRemind)}
              >
                {LEADS.map((l) => <option key={l} value={l}>{t(`task.lead.${l}`)}</option>)}
              </Select>
              {!time && <span className="field-hint">{t('task.leadHint')}</span>}
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.list')}</span>
            <div className="field-body">
              <Select
                className="text-input" aria-label={t('task.list')}
                value={listId ?? ''}
                onChange={(e) => setListId(e.target.value || null)}
              >
                <option value="">{t('common.none')}</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.tags')}</span>
            <div className="field-body" style={{ flexWrap: 'wrap' }}>
              {tags.map((tag, i) => (
                <span key={tag} className="tag-chip">
                  {tag}
                  <button
                    type="button" className="tag-remove" aria-label={t('task.tags')}
                    onClick={() => setTags((prev) => prev.filter((_, j) => j !== i))}
                  >×</button>
                </span>
              ))}
              <input
                className="text-input" style={{ flex: 1, minWidth: 140 }} value={tagInput}
                placeholder={t('task.tagsPlaceholder')}
                aria-label={t('task.tags')}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                }}
                onBlur={addTag}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.flag')}</span>
            <div className="field-body">
              <label className="switch">
                <input type="checkbox" checked={flag} aria-label={t('task.flag')} onChange={(e) => setFlag(e.target.checked)} />
                <span className="track" />
              </label>
              <span className="field-hint">{t('task.flagHint')}</span>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.priority')}</span>
            <div className="field-body">
              <Select
                className="text-input" aria-label={t('task.priority')}
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{t(`task.priority.${p}`)}</option>)}
              </Select>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.est')}</span>
            <div className="field-body">
              <input
                className="num-input" type="number" step="0.1" min="0"
                aria-label={t('task.est')}
                value={est} onChange={(e) => setEst(e.target.value)}
              />
              <span className="field-hint">{t('task.estHint')}</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button
              className="btn danger"
              onClick={() => onConfirm({
                title: t('task.delete'),
                message: t('task.deleteMsg', { title: task!.title }),
                confirmText: t('common.delete'),
                danger: true,
                onConfirm: async () => { setEditingTask(null); await deleteTask(task!.id); },
              })}
            >
              <Trash2 size={14} aria-hidden /> {t('task.delete')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setEditingTask(null)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={() => void save()}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}