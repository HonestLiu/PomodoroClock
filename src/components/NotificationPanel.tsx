// 通知面板 —— PRD §5.7 FR-N

import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
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
                <div className="notif-time">{timeAgo(n.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
