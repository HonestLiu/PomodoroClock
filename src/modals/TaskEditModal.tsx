// 任务编辑弹层 —— PRD FR-T3（名称 / 清单 / 预估番茄数 / 日期 / 备注）

import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import type { ConfirmSpec } from './ConfirmDialog';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';

export function TaskEditModal({ onConfirm }: { onConfirm(spec: ConfirmSpec): void }) {
  const editingTaskId = useUiStore((s) => s.editingTaskId);
  const setEditingTask = useUiStore((s) => s.setEditingTask);
  const { tasks, lists, updateTask, deleteTask } = useDataStore();
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  const task = tasks.find((t) => t.id === editingTaskId) ?? null;
  const [title, setTitle] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [est, setEst] = useState('0');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  useModalA11y(task !== null, () => setEditingTask(null), rootRef, 'input.text-input');

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setListId(task.list_id);
    setEst(String(task.est_pomodoros));
    setDue(task.due_date ?? '');
    setNotes(task.notes);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  async function save() {
    const patch = {
      title: title.trim() || task!.title,
      list_id: listId,
      est_pomodoros: Number(est) || 0,
      due_date: due || null,
      notes,
    };
    setEditingTask(null);
    await updateTask(task!.id, patch);
  }

  return (
    <div className="overlay" onClick={() => setEditingTask(null)}>
      <div
        className="modal" ref={rootRef}
        role="dialog" aria-modal="true" aria-labelledby="task-edit-title"
        style={{ width: 'min(520px, 92vw)' }}
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
            <span className="field-label">{t('task.list')}</span>
            <div className="field-body">
              <select
                className="text-input"
                aria-label={t('task.list')}
                value={listId ?? ''}
                onChange={(e) => setListId(e.target.value || null)}
              >
                <option value="">{t('common.none')}</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
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
          <div className="field">
            <span className="field-label">{t('task.due')}</span>
            <div className="field-body">
              <input
                className="text-input" type="date" value={due} aria-label={t('task.due')}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('task.notes')}</span>
            <div className="field-body">
              <textarea
                className="text-input" style={{ height: 68, padding: 8, resize: 'vertical' }}
                aria-label={t('task.notes')}
                value={notes} onChange={(e) => setNotes(e.target.value)}
              />
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
