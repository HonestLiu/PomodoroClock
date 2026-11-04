// 自定义标题栏 + 顶栏图标区 —— PRD FR-G1 / FR-G3。
// macOS 使用 titleBarStyle: Overlay 保留系统红黄绿（见 src-tauri/tauri.conf.json）；
// Windows/Linux 使用 decorations:false + 本组自绘按钮。

import { Crown, Bell, Trophy, BarChart3, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore, unreadCount } from '@/stores/dataStore';
import { isTauri } from '@/api';
import { useI18n } from '@/i18n';
import { useGrowthStore } from '@/stores/growthStore';
import { coinBalance, currentLevel } from '@/lib/growth';

async function windowAction(action: 'close' | 'minimize' | 'toggleMaximize') {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'close') await w.close();
  else if (action === 'minimize') await w.minimize();
  else await w.toggleMaximize();
}

/** 番茄图标：用户提供的 SVG（iconfont，1024 视框、填充式路径），随顶栏 currentColor 着色 */
function TomatoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 1024 1024" fill="currentColor"
      aria-hidden focusable="false"
    >
      <path d="M512 934.912C251.904 934.912 56.32 747.52 56.32 499.712c0-132.096 57.344-223.232 171.008-270.336 20.48-8.192 39.936-12.288 63.488-14.336 11.264-1.024 21.504 7.168 22.528 18.432s-7.168 21.504-18.432 22.528c-19.456 2.048-35.84 6.144-52.224 12.288-97.28 39.936-145.408 115.712-145.408 231.424 0 224.256 178.176 394.24 414.72 394.24 174.08 0 325.632-96.256 386.048-246.784 18.432-45.056 28.672-95.232 28.672-147.456 0-115.712-48.128-191.488-146.432-231.424h-1.024c-15.36-7.168-32.768-9.216-50.176-11.264-11.264-1.024-19.456-11.264-18.432-22.528 1.024-11.264 11.264-19.456 22.528-18.432 20.48 2.048 41.984 5.12 62.464 15.36C910.336 276.48 967.68 367.616 967.68 499.712c0 58.368-10.24 113.664-31.744 163.84C869.376 828.416 702.464 934.912 512 934.912z" />
      <path d="M626.688 165.888h2.048c2.048 1.024 3.072 5.12 2.048 9.216-7.168 20.48-21.504 37.888-39.936 51.2-4.096 3.072-6.144 6.144-5.12 9.216s4.096 5.12 8.192 6.144c11.264 2.048 22.528 3.072 32.768 3.072 29.696 0 56.32-7.168 76.8-21.504 2.048-1.024 3.072-2.048 5.12-2.048 1.024 0 2.048 0 3.072 1.024 2.048 2.048 1.024 5.12-1.024 8.192-25.6 32.768-66.56 50.176-111.616 50.176-20.48 0-40.96-4.096-61.44-11.264-7.168-1.024-16.384-3.072-25.6-3.072-10.24 0-19.456 2.048-26.624 5.12-19.456 7.168-39.936 11.264-59.392 11.264-45.056 0-86.016-18.432-111.616-50.176-2.048-3.072-3.072-6.144-1.024-8.192 1.024-1.024 2.048-1.024 3.072-1.024 1.024 0 3.072 0 4.096 1.024 20.48 14.336 48.128 22.528 77.824 22.528 10.24 0 21.504-1.024 32.768-3.072 4.096-1.024 8.192-3.072 8.192-6.144 1.024-3.072-1.024-7.168-5.12-10.24-18.432-13.312-32.768-30.72-39.936-52.224-1.024-4.096 0-7.168 2.048-8.192h2.048c2.048 0 4.096 1.024 5.12 3.072l1.024 1.024c20.48 27.648 61.44 47.104 107.52 47.104s87.04-18.432 107.52-46.08c2.048-5.12 5.12-6.144 7.168-6.144m0-40.96c-15.36 0-29.696 8.192-39.936 21.504-14.336 18.432-43.008 29.696-74.752 29.696-30.72 0-59.392-11.264-73.728-28.672l-1.024-1.024c-1.024-2.048-3.072-3.072-4.096-5.12-9.216-10.24-22.528-16.384-35.84-16.384-7.168 0-14.336 2.048-20.48 5.12-19.456 10.24-29.696 33.792-22.528 56.32 0 1.024 0 1.024 1.024 2.048 1.024 3.072 2.048 7.168 4.096 10.24-5.12-2.048-10.24-4.096-14.336-7.168-1.024-1.024-2.048-1.024-3.072-2.048-8.192-5.12-16.384-7.168-25.6-7.168-12.288 0-23.552 5.12-31.744 13.312-15.36 15.36-17.408 38.912-6.144 58.368 1.024 2.048 2.048 3.072 3.072 5.12 32.768 41.984 84.992 66.56 143.36 66.56 24.576 0 50.176-4.096 73.728-13.312 0 0 1.024 0 1.024-1.024 2.048-1.024 6.144-2.048 11.264-2.048 6.144 0 10.24 1.024 11.264 2.048 1.024 0 1.024 0 2.048 1.024 24.576 9.216 49.152 13.312 74.752 13.312 58.368 0 110.592-24.576 143.36-65.536 1.024-1.024 2.048-2.048 2.048-3.072 12.288-19.456 10.24-44.032-5.12-59.392-8.192-8.192-19.456-13.312-31.744-13.312-10.24 0-19.456 3.072-27.648 9.216l-1.024 1.024c-4.096 3.072-9.216 5.12-14.336 7.168 1.024-3.072 2.048-6.144 4.096-9.216v-1.024c8.192-23.552-1.024-48.128-21.504-58.368-7.168-7.168-14.336-8.192-20.48-8.192z" />
      <path d="M512 252.928c-11.264 0-20.48-9.216-20.48-20.48 0-9.216-1.024-89.088 24.576-133.12 5.12-10.24 18.432-13.312 27.648-7.168 10.24 6.144 13.312 18.432 7.168 27.648-17.408 29.696-19.456 91.136-18.432 112.64 0 11.264-8.192 20.48-20.48 20.48zM881.664 557.056H880.64c-5.12-1.024-9.216-6.144-8.192-11.264 2.048-13.312 3.072-27.648 3.072-41.984 0-31.744-4.096-58.368-11.264-81.92-2.048-5.12 1.024-11.264 6.144-13.312 5.12-2.048 11.264 1.024 13.312 6.144 8.192 25.6 13.312 54.272 13.312 88.064 0 14.336-1.024 29.696-3.072 44.032-3.072 6.144-7.168 10.24-12.288 10.24zM852.992 388.096c-3.072 0-6.144-1.024-8.192-4.096-5.12-7.168-10.24-14.336-15.36-19.456-4.096-4.096-3.072-11.264 1.024-14.336 4.096-4.096 11.264-3.072 14.336 1.024 5.12 6.144 10.24 13.312 15.36 20.48 3.072 4.096 2.048 11.264-2.048 14.336-1.024 1.024-3.072 2.048-5.12 2.048z" />
    </svg>
  );
}

export function TitleBar() {
  const ui = useUiStore();
  const notifications = useDataStore((s) => s.notifications);
  const unread = unreadCount(notifications);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const { t } = useI18n();
  const growth = useGrowthStore((s) => s.data);
  const openScreen = useTimerStore((s) => s.openScreen);

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
        {/* 专注面板始终可从应用内进入，不依赖桌面悬浮计时器。 */}
        <button
          type="button"
          className="icon-btn"
          title={t('tray.openTimer')}
          aria-label={t('tray.openTimer')}
          onClick={() => openScreen(true)}
        >
          <TomatoIcon />
        </button>
        <button className="icon-btn" title={t('title.premium')} aria-label={t('title.premium')} aria-pressed={ui.premiumOpen} onClick={() => ui.openPremium(!ui.premiumOpen)}><Crown size={16} aria-hidden /></button>
        <button className="icon-btn" title={t('notif.title')} aria-label={t('notif.title')} aria-expanded={ui.notifOpen} onClick={() => ui.openNotif(!ui.notifOpen)}>
          <Bell size={16} aria-hidden />
          {unread > 0 && <span className="badge" aria-hidden>{unread}</span>}
        </button>
        <button className="icon-btn growth-entry" title={t('growth.title')} aria-label={t('growth.title')} aria-expanded={ui.achievementsOpen} onClick={() => ui.openAchievements(!ui.achievementsOpen)}><Trophy size={16} aria-hidden />{growth && <span>Lv.{currentLevel(growth)} · {coinBalance(growth)} {t('growth.coins')}</span>}</button>
        <button className={`icon-btn${ui.reportOpen ? ' active' : ''}`} title={t('report.title')} aria-label={t('report.title')} aria-expanded={ui.reportOpen} onClick={() => ui.openReport()}><BarChart3 size={16} aria-hidden /></button>
        <button className="icon-btn" title={t('settings.title')} aria-label={t('settings.title')} aria-expanded={ui.settingsOpen} onClick={() => ui.openSettings()}><SettingsIcon size={16} aria-hidden /></button>
        {/* AI 入口（docs/05-modules/ai.md）：其他页面点开右侧 AI 抽屉；在 AI 页本身不重复出现 */}
        {ui.route.name !== 'ai' && (
          <button
            className="icon-btn ai-entry"
            title={t('nav.ai')} aria-label={t('nav.ai')}
            aria-expanded={ui.aiDrawerOpen}
            onClick={() => ui.openAiDrawer(!ui.aiDrawerOpen)}
          >
            <Sparkles size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
