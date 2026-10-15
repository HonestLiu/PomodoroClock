// 顶栏占位面板 —— PRD FR-G3（规格定义：高级版 / 好友 / 成就均为占位）

import { X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useStatsStore } from '@/stores/statsStore';
import { formatMinutes } from '@/lib/date';

export function PlaceholderModal() {
  const ui = useUiStore();
  const stats = useStatsStore((s) => s.stats);

  const spec = ui.premiumOpen
    ? { title: '高级版', body: '订阅方案与支付流程未在本次复刻范围内实现。' }
    : ui.friendsOpen
      ? { title: '好友 / 社区', body: '好友列表与社区动态为规格定义的空态占位。' }
      : ui.achievementsOpen
        ? { title: '成就', body: '' }
        : null;

  if (!spec) return null;
  const close = () => ui.closeAllOverlays();

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" style={{ width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{spec.title}</h2>
          <button className="icon-btn" onClick={close}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {spec.body && <p className="field-hint" style={{ lineHeight: 1.8, margin: 0 }}>{spec.body}</p>}

          {ui.achievementsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { name: '初次专注', desc: '完成第一个番茄', done: (stats?.total_focus_min ?? 0) > 0 },
                { name: '坚持不懈', desc: '累计专注 5 小时', done: (stats?.total_focus_min ?? 0) >= 300 },
                { name: '目标达成', desc: '达成一次每日目标', done: (stats?.goal_days ?? 0) >= 1 },
                { name: '任务达人', desc: '完成 10 个任务', done: (stats?.total_done_tasks ?? 0) >= 10 },
              ].map((a) => (
                <div key={a.name} className="field" style={{ padding: '8px 0' }}>
                  <span className="field-label" style={{ width: 96, flex: '0 0 96px' }}>{a.name}</span>
                  <div className="field-body">
                    <span style={{ flex: 1 }} className="field-hint">{a.desc}</span>
                    <span style={{ color: a.done ? 'var(--accent-focus)' : 'var(--text-3)', fontSize: 12 }}>
                      {a.done ? '已达成' : '未达成'}
                    </span>
                  </div>
                </div>
              ))}
              <p className="field-hint" style={{ marginTop: 4 }}>
                累计专注 {formatMinutes(stats?.total_focus_min ?? 0)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
