// 已完成视图 —— PRD §5.3 FR-C1/C2（截图事实 S2）
// 按完成日期倒序分组；组内每条 = 一次专注记录（任务名 / 时长 / 起止时间）

import { useMemo } from 'react';
import { CompletedStats } from '@/components/CompletedStats';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { completedGroups, taskTitle, type Dataset } from '@/lib/derive';
import { formatHM, formatMinutes, relativeDayLabel } from '@/lib/date';
import { useI18n } from '@/i18n';

export function CompletedView() {
  const { tasks, lists, records } = useDataStore();
  const stats = useStatsStore((s) => s.stats);
  const revision = useStatsStore((s) => s.revision);

  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);

  const { t } = useI18n();
  const groups = useMemo(() => completedGroups(ds), [ds, revision]);
  // 「已完成」专用统计栏（不复用统一任务统计卡）
  const completedStats = {
    doneTasks: tasks.filter((t) => t.completed === 1).length,
    records: records.length,
    focusMin: stats?.total_focus_min ?? 0,
    days: stats?.focus_days ?? 0,
  };

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.completed')}</h1>
      <CompletedStats {...completedStats} />

      {groups.length === 0 && <div className="empty">{t('completed.empty')}</div>}

      {groups.map((g) => {
        const total = g.records.reduce((a, r) => a + r.duration_min, 0);
        return (
          <section key={g.dateKey}>
            <div className="group-head">
              <span>{relativeDayLabel(g.dateKey)}</span>
              <span className="group-total">
                {g.records.length} · {formatMinutes(total)}
              </span>
            </div>
            {g.records.map((r) => (
              <div className="record-item" key={r.id}>
                <span className="record-title">{taskTitle(ds, r.task_id)}</span>
                <span className="record-dur">{t('record.duration', { n: r.duration_min })}</span>
                <span className="record-range">
                  {formatHM(r.start_at)} – {formatHM(r.end_at)}
                </span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
