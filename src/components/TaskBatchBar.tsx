import { DateTimeInput } from '@/components/controls/DateTimeInput';
import { Select } from '@/components/controls/Select';
// 任务多选批量操作条（docs/05-modules/tasks.md）—— 跨任务/清单/已完成视图复用。
// 触发：TaskItem 上 Cmd/Ctrl 点选任务，selectedTaskIds 非空时本条出现。
// 动作：完成切换 / 移到清单 / 批量设置（优先级·重复·紧急·旗标·日期·预估）/ 删除（二次确认）/ 清除选择。
// Esc 或「清除选择」结束多选。

import { useEffect, useState } from 'react';
import { Check, FolderPlus, Settings2, Trash2, X } from 'lucide-react';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';
import { Menu, type MenuItem } from './Menu';
import type { Recurrence, TaskPriority } from '@/types';

const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high'];
const REPEATS: Recurrence[] = ['none', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly'];

export function TaskBatchBar() {
  const { t } = useI18n();
  const selectedTaskIds = useUiStore((s) => s.selectedTaskIds);
  const clearTaskSelect = useUiStore((s) => s.clearTaskSelect);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const lists = useDataStore((s) => s.lists);
  const batchPatch = useDataStore((s) => s.batchPatch);
  const batchDelete = useDataStore((s) => s.batchDelete);
  const batchToggle = useDataStore((s) => s.batchToggle);

  const [panel, setPanel] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Esc 结束多选（hooks 必须在任何提前 return 之前，保持渲染间 hook 数量一致）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); clearTaskSelect(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearTaskSelect]);

  const n = selectedTaskIds.length;
  if (n === 0) return null;

  const setAll = (patch: Parameters<typeof batchPatch>[1]) => {
    void batchPatch(selectedTaskIds, patch);
  };

  function confirmDelete() {
    askConfirm({
      title: t('batch.delete'),
      message: t('batch.deleteMsg', { n }),
      confirmText: t('common.delete'),
      danger: true,
      onConfirm: () => { void batchDelete(selectedTaskIds); clearTaskSelect(); },
    });
  }

  function openMoveMenu() {
    const el = document.activeElement as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    setMenu({ x: r ? r.left : 120, y: r ? r.bottom + 4 : 120 });
  }
  const moveItems: Array<MenuItem & { value?: string }> = lists.map((l) => ({ key: l.id, label: l.name, value: l.id }));
  moveItems.push({ key: '_none', label: t('task.noneList'), value: '__none__' });
  const moveEntries: MenuItem[] = [{
    key: 'move',
    label: t('batch.moveTo'),
    icon: <FolderPlus size={13} />,
    children: moveItems,
    onSelect: (value) => {
      setAll({ list_id: value === '__none__' ? null : value });
      setMenu(null);
    },
  }];

  return (
    <div className="batch-bar">
      {/* 主排：状态 + 动作 */}
      <div className="batch-bar-top">
        <span className="batch-count">{t('batch.selected', { n })}</span>

        <button type="button" className="btn" onClick={() => void batchToggle(selectedTaskIds)}
          title={t('batch.toggleDone')}><Check size={13} /> {t('batch.toggleDone')}</button>

        <button type="button" className="btn" onClick={openMoveMenu}
          title={t('batch.moveTo')}><FolderPlus size={13} /> {t('batch.moveTo')}</button>

        <button type="button" className={`btn${panel ? ' batch-set--on' : ''}`} onClick={() => setPanel(!panel)}
          title={t('batch.set')}><Settings2 size={13} /> {t('batch.set')}</button>

        <button type="button" className="btn batch-del" onClick={confirmDelete}
          title={t('batch.delete')}><Trash2 size={13} /> {t('batch.delete')}</button>

        <span className="batch-spacer" />
        <button type="button" className="icon-btn" title={t('batch.clear')} aria-label={t('batch.clear')}
          onClick={clearTaskSelect}><X size={15} /></button>
      </div>

      {/* 批量设置面板：应用到所有选中项 */}
      {panel && (
        <div className="batch-panel">
          <label className="batch-field">
            <span>{t('batch.priority')}</span>
            <Select className="text-input" defaultValue="" onChange={(e) => { if (e.target.value) setAll({ priority: e.target.value as TaskPriority }); e.target.value = ''; }}>
              <option value="">…</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(`ai.priority.${p}`)}</option>)}
            </Select>
          </label>
          <label className="batch-field">
            <span>{t('batch.repeat')}</span>
            <Select className="text-input" defaultValue="" onChange={(e) => { if (e.target.value) setAll({ repeat: e.target.value as Recurrence }); e.target.value = ''; }}>
              <option value="">…</option>
              {REPEATS.map((r) => <option key={r} value={r}>{t(`task.repeat.${r}`)}</option>)}
            </Select>
          </label>
          <div className="batch-field">
            <span>{t('batch.urgent')}</span>
            <span className="batch-toggle">
              <button type="button" className="chip" onClick={() => setAll({ urgent: 1 })}>{t('batch.on')}</button>
              <button type="button" className="chip" onClick={() => setAll({ urgent: 0 })}>{t('batch.off')}</button>
            </span>
          </div>
          <div className="batch-field">
            <span>{t('batch.flag')}</span>
            <span className="batch-toggle">
              <button type="button" className="chip" onClick={() => setAll({ flag: 1 })}>{t('batch.on')}</button>
              <button type="button" className="chip" onClick={() => setAll({ flag: 0 })}>{t('batch.off')}</button>
            </span>
          </div>
          <label className="batch-field">
            <span>{t('batch.due')}</span>
            <DateTimeInput className="text-input" type="date" onChange={(e) => setAll({ due_date: e.target.value || null })} />
          </label>
          <label className="batch-field">
            <span>{t('batch.est')}</span>
            <input className="num-input" type="number" min={0} step={0.1}
              onChange={(e) => setAll({ est_pomodoros: e.target.value === '' ? 0 : Number(e.target.value) })} />
          </label>
        </div>
      )}

      {menu && (
        <Menu
          x={menu.x} y={menu.y} items={moveEntries}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}