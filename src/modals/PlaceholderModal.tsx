// 顶栏占位面板 —— PRD FR-G3（规格定义：高级版 / 好友 / 成就均为占位）

import { useRef } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useStatsStore } from '@/stores/statsStore';
import { formatMinutes } from '@/lib/date';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';

export function PlaceholderModal() {
  const ui = useUiStore();
  const stats = useStatsStore((s) => s.stats);
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => ui.closeAllOverlays();

  const spec = ui.premiumOpen
    ? { title: t('title.premium'), body: t('placeholder.premiumBody') }
    : ui.friendsOpen
      ? { title: t('title.friends'), body: t('placeholder.friendsBody') }
      : ui.achievementsOpen
        ? { title: t('title.achievements'), body: '' }
        : null;

  useModalA11y(spec !== null, close, rootRef, '.icon-btn');

  if (!spec) return null;

  const achievements = [
    { key: 'first', name: t('ach.first'), desc: t('ach.firstDesc'), done: (stats?.total_focus_min ?? 0) > 0 },
    { key: 'streak', name: t('ach.streak'), desc: t('ach.streakDesc'), done: (stats?.total_focus_min ?? 0) >= 300 },
    { key: 'goal', name: t('ach.goal'), desc: t('ach.goalDesc'), done: (stats?.goal_days ?? 0) >= 1 },
    { key: 'master', name: t('ach.master'), desc: t('ach.masterDesc'), done: (stats?.total_done_tasks ?? 0) >= 10 },
  ];

  return (
    <div className="overlay" onClick={close}>
      <div
        className="modal" ref={rootRef}
        role="dialog" aria-modal="true" aria-labelledby="placeholder-title"
        style={{ width: 'min(440px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="placeholder-title">{spec.title}</h2>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          {spec.body && <p className="field-hint" style={{ lineHeight: 1.8, margin: 0 }}>{spec.body}</p>}

          {ui.achievementsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {achievements.map((a) => (
                <div key={a.key} className="field" style={{ padding: '8px 0' }}>
                  <span className="field-label" style={{ width: 96, flex: '0 0 96px' }}>{a.name}</span>
                  <div className="field-body">
                    <span style={{ flex: 1 }} className="field-hint">{a.desc}</span>
                    <span style={{ color: a.done ? 'var(--accent-focus)' : 'var(--text-3)', fontSize: 12 }}>
                      {a.done ? t('ach.done') : t('ach.todo')}
                    </span>
                  </div>
                </div>
              ))}
              <p className="field-hint" style={{ marginTop: 4 }}>
                {t('ach.total', { v: formatMinutes(stats?.total_focus_min ?? 0) })}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
