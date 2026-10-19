// 记录视图 —— 专注（番茄）归档，PRD §5.3 FR-C1/C2（原「已完成」视图）
// 按记录结束日期倒序分组；组内每条 = 一次专注记录（任务名 / 时长 / 起止时间）
// 与「已完成」视图的区别：这里归档的是**番茄专注**，那边归档的是**勾选完成的任务**。

import { useMemo } from 'react';
import { RecordsStats } from '@/components/RecordsStats';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { completedGroups, taskTitle, type Dataset } from '@/lib/derive';
import { formatHM, formatMinutes, relativeDayLabel } from '@/lib/date';
import { useI18n } from '@/i18n';

export function RecordsView() {
  const { tasks, lists, records } = useDataStore();
  const stats = useStatsStore((s) => s.stats);
  const revision = useStatsStore((s) => s.revision);

  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);

  const { t } = useI18n();
  const groups = useMemo(() => completedGroups(ds), [ds, revision]);
  const recordStats = {
    records: records.length,
    focusMin: stats?.total_focus_min ?? 0,
    weekMin: stats?.week_focus_min ?? 0,
    days: stats?.focus_days ?? 0,
  };

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.records')}</h1>
      <RecordsStats {...recordStats} />

      {groups.length === 0 && <div className="empty">{t('records.empty')}</div>}

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
