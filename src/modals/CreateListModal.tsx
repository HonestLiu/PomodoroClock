// 新建清单弹窗 —— 与「新建清单夹」同款弹窗样式。
// 标题 / 名称输入 / 图标类型（圆点·图标）/ 字形色板 + 自由输入 / 单色色板 / 取消·确定。

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { api } from '@/api';
import {
  DEFAULT_LIST_ICON_COLOR, LIST_ICON_COLORS, LIST_ICON_GLYPHS, defaultListIcon,
} from '@/lib/listIcon';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';
import type { ListIconType } from '@/types';

export function CreateListModal() {
  const open = useUiStore((s) => s.listCreateOpen);
  const setOpen = useUiStore((s) => s.openListCreate);
  const editId = useUiStore((s) => s.listEditId);
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [iconType, setIconType] = useState<ListIconType>('dot');
  const [iconColor, setIconColor] = useState(DEFAULT_LIST_ICON_COLOR);
  const [iconGlyph, setIconGlyph] = useState('');

  const close = () => setOpen(false);
  useModalA11y(open, close, rootRef, 'input');

  // 新建：重置为默认；编辑：回填该清单现有名称与图标
  useEffect(() => {
    if (!open) return;
    if (editId) {
      const l = useDataStore.getState().lists.find((x) => x.id === editId);
      if (l) {
        setName(l.name);
        setIconType(l.icon_type);
        setIconColor(l.icon_color || DEFAULT_LIST_ICON_COLOR);
        setIconGlyph(l.icon_glyph);
        return;
      }
    }
    const d = defaultListIcon();
    setName('');
    setIconType(d.icon_type);
    setIconColor(d.icon_color);
    setIconGlyph('');
  }, [open, editId]);

  if (!open) return null;

  const canConfirm = name.trim().length > 0;

  async function confirm() {
    const v = name.trim();
    if (!v) return;
    if (editId) {
      await api.rename_list(editId, v);
      await api.set_list_icon(editId, iconType, iconColor, iconGlyph.trim());
    } else {
      await api.create_list({ name: v, iconType, iconColor, iconGlyph });
    }
    await useDataStore.getState().reload();
    close();
  }

  const title = editId ? t('list.edit') : t('list.new');

  return (
    <div className="overlay" onClick={close}>
      <div
        ref={rootRef}
        className="modal list-modal"
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
          aria-label={t('list.placeholder')}
          placeholder={t('list.placeholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) void confirm(); }}
        />

        <div className="list-config">
          <div className="list-create-row">
            <span className="list-create-label">{t('list.icon.type')}</span>
            <div className="seg" role="group" aria-label={t('list.icon.type')}>
              <button
                type="button" className={iconType === 'dot' ? 'active' : ''}
                aria-pressed={iconType === 'dot'}
                onClick={() => setIconType('dot')}
              >
                {t('list.icon.dot')}
              </button>
              <button
                type="button" className={iconType === 'font' ? 'active' : ''}
                aria-pressed={iconType === 'font'}
                onClick={() => setIconType('font')}
              >
                {t('list.icon.font')}
              </button>
            </div>
          </div>

          {iconType === 'font' && (
            <div className="list-create-row">
              <span className="list-create-label">{t('list.icon.glyph')}</span>
              <div className="glyph-palette">
                {LIST_ICON_GLYPHS.map((g) => (
                  <button
                    type="button" key={g}
                    className={iconGlyph === g ? 'active' : ''}
                    style={{ color: iconColor }}
                    onClick={() => setIconGlyph(g)}
                  >
                    {g}
                  </button>
                ))}
                <input
                  className="glyph-custom" maxLength={2}
                  aria-label={t('list.icon.glyph')}
                  value={iconGlyph}
                  onChange={(e) => setIconGlyph(e.target.value.slice(-1))}
                />
              </div>
            </div>
          )}

          <div className="list-create-row">
            <span className="list-create-label">{t('list.icon.color')}</span>
            <div className="color-palette" role="group" aria-label={t('list.icon.color')}>
              {LIST_ICON_COLORS.map((c) => (
                <button
                  type="button" key={c}
                  className={`color-swatch${iconColor === c ? ' active' : ''}`}
                  style={{ background: c }}
                  aria-label={c}
                  aria-pressed={iconColor === c}
                  onClick={() => setIconColor(c)}
                >
                  {iconColor === c && <Check size={12} aria-hidden />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="folder-modal-actions">
          <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
          <button
            type="button" className="btn primary"
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {t('list.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
