// 通知面板 —— PRD §5.7 FR-N

import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n, type TFunc } from '@/i18n';

/** 相对时间：文案由调用方传入的 t() 提供，避免在模块级硬编码中文 */
function timeAgo(ts: number, t: TFunc): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('time.hourAgo', { n: h });
  return t('time.dayAgo', { n: Math.floor(h / 24) });
}

export function NotificationPanel() {
  const open = useUiStore((s) => s.notifOpen);
  const close = useUiStore((s) => s.openNotif);
  const { notifications, markRead, markAllRead } = useDataStore();
  const { t } = useI18n();

  if (!open) return null;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 155 }} onClick={() => close(false)} />
      <div className="notif-panel">
        <div className="notif-head">
          <span>{t('notif.title')}</span>
          <button onClick={() => void markAllRead()}>{t('notif.allRead')}</button>
        </div>
        <div className="notif-list">
          {notifications.length === 0 && <div className="empty">{t('notif.none')}</div>}
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`notif-row${n.read === 0 ? ' unread' : ''}`}
              onClick={() => { if (n.read === 0) void markRead(n.id); }}
            >
              <span className="notif-dot" style={{ opacity: n.read ? 0 : 1 }} />
              <div className="notif-body">
                <div className="notif-title">{n.title}</div>
                <div className="notif-text">{n.body}</div>
                <div className="notif-time">{timeAgo(n.created_at, t)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
