// 自定义标题栏 + 顶栏图标区 —— PRD FR-G1 / FR-G3。
// macOS 使用 titleBarStyle: Overlay 保留系统红黄绿（见 src-tauri/tauri.conf.json）；
// Windows/Linux 使用 decorations:false + 本组自绘按钮。

import { Crown, Users, Bell, Trophy, BarChart3, Settings as SettingsIcon } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore, unreadCount } from '@/stores/dataStore';
import { isTauri } from '@/api';
import { useI18n } from '@/i18n';

async function windowAction(action: 'close' | 'minimize' | 'toggleMaximize') {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'close') await w.close();
  else if (action === 'minimize') await w.minimize();
  else await w.toggleMaximize();
}

export function TitleBar() {
  const ui = useUiStore();
  const notifications = useDataStore((s) => s.notifications);
  const unread = unreadCount(notifications);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const { t } = useI18n();

  return (
    <div className={`titlebar${isMac ? ' macos' : ''}`} data-tauri-drag-region>
      {/* macOS：系统红黄绿由 titleBarStyle:Overlay 保留，不需要自绘按钮 */}
      {!isMac && (
        <div className="traffic">
          <button className="close" title={t('titlebar.close')} aria-label={t('titlebar.close')} onClick={() => windowAction('close')}><span aria-hidden>✕</span></button>
          <button className="min" title={t('titlebar.minimize')} aria-label={t('titlebar.minimize')} onClick={() => windowAction('minimize')}><span aria-hidden>−</span></button>
          <button className="max" title={t('titlebar.maximize')} aria-label={t('titlebar.maximize')} onClick={() => windowAction('toggleMaximize')}><span aria-hidden>+</span></button>
        </div>
      )}

      <div className="titlebar-drag" data-tauri-drag-region />

      <div className="titlebar-actions">
        <button className="icon-btn" title={t('title.premium')} aria-label={t('title.premium')} aria-pressed={ui.premiumOpen} onClick={() => ui.openPremium(!ui.premiumOpen)}><Crown size={16} aria-hidden /></button>
        <button className="icon-btn" title={t('title.friends')} aria-label={t('title.friends')} aria-pressed={ui.friendsOpen} onClick={() => ui.openFriends(!ui.friendsOpen)}><Users size={16} aria-hidden /></button>
        <button className="icon-btn" title={t('notif.title')} aria-label={t('notif.title')} aria-expanded={ui.notifOpen} onClick={() => ui.openNotif(!ui.notifOpen)}>
          <Bell size={16} aria-hidden />
          {unread > 0 && <span className="badge" aria-hidden>{unread}</span>}
        </button>
        <button className="icon-btn" title={t('title.achievements')} aria-label={t('title.achievements')} aria-pressed={ui.achievementsOpen} onClick={() => ui.openAchievements(!ui.achievementsOpen)}><Trophy size={16} aria-hidden /></button>
        <button className={`icon-btn${ui.reportOpen ? ' active' : ''}`} title={t('report.title')} aria-label={t('report.title')} aria-expanded={ui.reportOpen} onClick={() => ui.openReport()}><BarChart3 size={16} aria-hidden /></button>
        <button className="icon-btn" title={t('settings.title')} aria-label={t('settings.title')} aria-expanded={ui.settingsOpen} onClick={() => ui.openSettings()}><SettingsIcon size={16} aria-hidden /></button>
      </div>
    </div>
  );
}
