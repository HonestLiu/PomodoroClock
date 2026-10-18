// 侧边栏右键菜单 —— 清单夹：编辑 / 删除（解散）；清单：编辑（图标）/ 删除。
// 删除走全局二次确认弹窗；编辑打开对应的「新建弹窗」编辑态。

import { useEffect } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useI18n } from '@/i18n';

const MENU_W = 150;
const MENU_H = 78;

export function SidebarContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const openFolderEdit = useUiStore((s) => s.openFolderEdit);
  const openListEdit = useUiStore((s) => s.openListEdit);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const { t } = useI18n();

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, close]);

  if (!menu) return null;

  const delFolder = () => {
    askConfirm({
      title: t('confirm.deleteFolderTitle'),
      message: t('confirm.deleteFolderMsg'),
      confirmText: t('common.delete'),
      danger: true,
      onConfirm: async () => { await useDataStore.getState().deleteFolder(menu.id); },
    });
    close();
  };
  const delList = () => {
    askConfirm({
      title: t('confirm.deleteListTitle'),
      message: t('confirm.deleteListMsg'),
      confirmText: t('common.delete'),
      danger: true,
      onConfirm: async () => { await useDataStore.getState().deleteList(menu.id); },
    });
    close();
  };

  // 夹到视口内，避免贴边溢出
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - MENU_W - 4));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - MENU_H - 4));

  return (
    <>
      <div className="ctx-backdrop" onClick={close} />
      <div className="ctx-menu" style={{ left, top }} role="menu">
        {menu.kind === 'folder' ? (
          <>
            <button type="button" role="menuitem" onClick={() => openFolderEdit(menu.id)}>
              <Pencil size={13} aria-hidden /> {t('menu.editFolder')}
            </button>
            <button type="button" role="menuitem" className="danger" onClick={delFolder}>
              <Trash2 size={13} aria-hidden /> {t('menu.deleteFolder')}
            </button>
          </>
        ) : (
          <>
            <button type="button" role="menuitem" onClick={() => openListEdit(menu.id)}>
              <Pencil size={13} aria-hidden /> {t('menu.editList')}
            </button>
            <button type="button" role="menuitem" className="danger" onClick={delList}>
              <Trash2 size={13} aria-hidden /> {t('menu.deleteList')}
            </button>
          </>
        )}
      </div>
    </>
  );
}
