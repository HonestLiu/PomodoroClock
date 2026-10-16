// 已完成视图 —— PRD §5.3 FR-C1/C2（截图事实 S2）
// 按完成日期倒序分组；组内每条 = 一次专注记录（任务名 / 时长 / 起止时间）

import { useMemo } from 'react';
import { StatCards, countCard, minutesCard } from '@/components/StatCards';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useTimerStore } from '@/stores/timerStore';
import { completedGroups, taskTitle, type Dataset } from '@/lib/derive';
import { formatHM, formatMinutes, relativeDayLabel } from '@/lib/date';
import { useI18n } from '@/i18n';

export function CompletedView() {
  const { tasks, lists, records } = useDataStore();
  const stats = useStatsStore((s) => s.stats);
  const revision = useStatsStore((s) => s.revision);
  const focusLenMin = useTimerStore((s) => s.settings.focus_len_min);

  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);

  const { t, dict } = useI18n();
  const groups = useMemo(() => completedGroups(ds), [ds, revision]);
  const cards = useMemo(() => {
    const pending = tasks.filter((t) => t.completed === 0).length;
    // 预计时间 = 已完成任务的预估番茄数 × 专注时长（PRD FR-T2 口径）
    const estMin = tasks
      .filter((t) => t.completed === 1)
      .reduce((a, t) => a + t.est_pomodoros * focusLenMin, 0);
    return [
      minutesCard(t('stat.estTime'), estMin),
      countCard(t('stat.pending'), pending),
      minutesCard(t('stat.focused'), stats?.total_focus_min ?? 0),
      countCard(t('stat.completed'), stats?.today_done_tasks ?? 0),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dict, revision, tasks, stats, focusLenMin]);

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.completed')}</h1>
      <StatCards cards={cards} />

      {groups.length === 0 && <div className="empty">{t('report.noneThisPeriod')}</div>}

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
                <span className="record-dur">{r.duration_min}分钟</span>
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
