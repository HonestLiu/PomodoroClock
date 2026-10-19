// 已完成视图 —— 全部勾选完成的任务归档（PRD §5.3）
// 按完成日期倒序分组；行内复用 TaskItem：可反勾选回待办、可编辑、可删除。
// 与「记录」视图的区别：这里归档的是**任务**，那边归档的是**番茄专注记录**。

import { useMemo } from 'react';
import { countCard, minutesCard, StatCards, type StatCardDef } from '@/components/StatCards';
import { TaskItem } from '@/components/TaskItem';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { completedTaskGroups, type Dataset } from '@/lib/derive';
import { relativeDayLabel } from '@/lib/date';
import { useI18n } from '@/i18n';

export function DoneView() {
  const { tasks, lists, records } = useDataStore();
  const stats = useStatsStore((s) => s.stats);
  const revision = useStatsStore((s) => s.revision);
  const { t } = useI18n();

  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);
  const groups = useMemo(() => completedTaskGroups(ds), [ds, revision]);

  const doneTasks = useMemo(() => tasks.filter((x) => x.completed === 1), [tasks]);
  const doneIds = useMemo(() => new Set(doneTasks.map((x) => x.id)), [doneTasks]);
  // 这些已完成任务累计的专注时长（未指定任务的记录不属于任何任务，不计入）
  const focusedMin = useMemo(
    () => records
      .filter((r) => r.task_id && doneIds.has(r.task_id))
      .reduce((a, r) => a + r.duration_min, 0),
    [records, doneIds],
  );

  const cards: StatCardDef[] = [
    countCard(t('stat.totalDone'), doneTasks.length),
    countCard(t('stat.weekDone'), stats?.week_done_tasks ?? 0),
    countCard(t('stat.todayDone'), stats?.today_done_tasks ?? 0),
    minutesCard(t('stat.focused'), focusedMin),
  ];

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.completed')}</h1>
      <StatCards cards={cards} />

      {groups.length === 0 && <div className="empty">{t('completed.empty')}</div>}

      {groups.map((g) => (
        <section key={g.dateKey}>
          <div className="group-head">
            <span>{relativeDayLabel(g.dateKey)}</span>
            <span className="group-total">{g.tasks.length}</span>
          </div>
          {g.tasks.map((task) => <TaskItem key={task.id} task={task} />)}
        </section>
      ))}
    </div>
  );
}
