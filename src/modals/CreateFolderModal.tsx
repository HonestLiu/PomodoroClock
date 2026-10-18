// 新建清单夹弹窗 —— 名称 + 颜色（驱动夹图标与导引线）+ 勾选要纳入的清单 + 行内新建清单。
// 结构对齐产品设计稿：标题 / 名称输入 / 色板 / 清单选择（⊕未选 · ✓已选）/ 取消·确定。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Plus, PlusCircle } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { api } from '@/api';
import { FOLDER_COLORS, DEFAULT_FOLDER_COLOR, resolveListIconColor } from '@/lib/listIcon';
import { ALL_TASKS_LIST_ID, type TaskList } from '@/types';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';

export function CreateFolderModal() {
  const open = useUiStore((s) => s.folderCreateOpen);
  const setOpen = useUiStore((s) => s.openFolderCreate);
  const editId = useUiStore((s) => s.folderEditId);
  const { lists } = useDataStore();
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_FOLDER_COLOR);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newNames, setNewNames] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const close = () => setOpen(false);
  useModalA11y(open, close, rootRef, 'input');

  // 打开时重置草稿；可选清单 = 自定义清单（排除内置「任务」清单）
  const candidates = useMemo(() => lists.filter((l) => l.id !== ALL_TASKS_LIST_ID), [lists]);
  // 编辑态：回填该夹的名称与颜色
  useEffect(() => {
    if (!open) return;
    if (editId) {
      const f = useDataStore.getState().folders.find((x) => x.id === editId);
      if (f) {
        setName(f.name);
        setColor(f.color || DEFAULT_FOLDER_COLOR);
        // 回填该夹现有成员为已勾选
        setSelected(new Set(
          useDataStore.getState().lists.filter((l) => l.folder_id === editId).map((l) => l.id),
        ));
        setNewNames([]);
        setAdding(false);
        setNewName('');
        return;
      }
    }
    setName('');
    setColor(DEFAULT_FOLDER_COLOR);
    setSelected(new Set());
    setNewNames([]);
    setAdding(false);
    setNewName('');
  }, [open, editId]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const addInline = () => {
    const v = newName.trim();
    if (!v) { setAdding(false); return; }
    setNewNames((p) => [...p, v]);
    setNewName('');
    setAdding(false);
  };

  const canConfirm = name.trim().length > 0;

  async function confirm() {
    if (!canConfirm) return;
    if (editId) {
      await api.update_folder(editId, name.trim(), color);
      // 行内新建的清单：默认图标，建好即归入本夹
      for (const nn of newNames) {
        const l: TaskList = await api.create_list({ name: nn });
        await api.set_list_folder(l.id, editId);
      }
      // 成员增删：只动「原本在本夹」或「本次勾选」的清单，避免误动其它夹的清单
      for (const c of useDataStore.getState().lists) {
        if (c.id === ALL_TASKS_LIST_ID) continue;
        const inThis = c.folder_id === editId;
        const want = selected.has(c.id);
        if (want && !inThis) await api.set_list_folder(c.id, editId);
        else if (!want && inThis) await api.set_list_folder(c.id, null);
      }
    } else {
      const folder = await api.create_folder({ name: name.trim(), color });
      // 行内新建的清单：默认图标，建好即归入夹
      for (const nn of newNames) {
        const l: TaskList = await api.create_list({ name: nn });
        await api.set_list_folder(l.id, folder.id);
      }
      // 勾选的既有清单：归入夹
      for (const id of selected) {
        await api.set_list_folder(id, folder.id);
      }
    }
    await useDataStore.getState().reload();
    close();
  }

  const title = editId ? t('folder.editTitle') : t('folder.createTitle');

  return (
    <div className="overlay" onClick={close}>
      <div
        ref={rootRef}
        className="modal folder-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folder-modal-title">{title}</div>

        <input
          className="text-input folder-name"
          autoFocus
          value={name}
          aria-label={t('folder.name')}
          placeholder={t('folder.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) void confirm(); }}
        />

        <div className="folder-colors" role="group" aria-label={t('folder.color')}>
          {FOLDER_COLORS.map((c) => (
            <button
              key={c} type="button"
              className={`folder-color${color === c ? ' active' : ''}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
            >
              {color === c && <Check size={12} aria-hidden />}
            </button>
          ))}
        </div>

        {/* 成员清单选择：新建/编辑都显示（编辑态回填现有成员，可增删） */}
        <div className="folder-lists">
          {candidates.map((l) => {
              const on = selected.has(l.id);
              return (
                <div key={l.id} className="folder-list-row">
                  {l.icon_type === 'font' && l.icon_glyph
                    ? <span className="list-glyph" style={{ color: resolveListIconColor(l) }}>{l.icon_glyph}</span>
                    : <span className="list-dot" style={{ background: resolveListIconColor(l) }} />}
                  <span className="folder-list-name">{l.name}</span>
                  <button
                    type="button"
                    className={`folder-list-toggle${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={l.name}
                    onClick={() => toggle(l.id)}
                  >
                    {on ? <CheckCircle2 size={20} aria-hidden /> : <PlusCircle size={20} aria-hidden />}
                  </button>
                </div>
              );
            })}

            {newNames.map((nn, i) => (
              <div key={`new-${i}`} className="folder-list-row">
                <span className="list-dot" style={{ background: DEFAULT_FOLDER_COLOR }} />
                <span className="folder-list-name">{nn}</span>
                <button type="button" className="folder-list-toggle on" aria-pressed disabled>
                  <CheckCircle2 size={20} aria-hidden />
                </button>
              </div>
            ))}

            {adding ? (
              <input
                className="text-input folder-new-input"
                autoFocus
                value={newName}
                aria-label={t('folder.addList')}
                placeholder={t('folder.addListPlaceholder')}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addInline();
                  if (e.key === 'Escape') { setAdding(false); setNewName(''); }
                }}
                onBlur={addInline}
              />
            ) : (
              <button type="button" className="folder-add-list" onClick={() => setAdding(true)}>
                <Plus size={14} style={{ color: 'var(--accent-focus)' }} aria-hidden />
                <span>{t('folder.addList')}</span>
              </button>
            )}
          </div>

        <div className="folder-modal-actions">
          <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
          <button
            type="button" className="btn primary"
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
