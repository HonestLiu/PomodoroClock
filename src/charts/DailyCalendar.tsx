// 每日专注目标月历 —— PRD FR-R6（截图事实 S4）
// 周一起始，上/下月补位灰色；今天红色数字；达成目标日红色圆圈标记；未来日期灰色。

import { useMemo } from 'react';
import { monthGrid, todayKey } from '@/lib/date';

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export function DailyCalendar({
  year, month0, focusByDay, goalMin,
}: {
  year: number;
  month0: number;
  focusByDay: Map<string, number>;
  goalMin: number;
}) {
  const cells = useMemo(() => monthGrid(year, month0), [year, month0]);
  const today = todayKey();

  return (
    <>
      <div className="cal-head">
        {WEEK_LABELS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((c) => {
          const minutes = focusByDay.get(c.key) ?? 0;
          const met = goalMin > 0 && minutes >= goalMin;
          const isToday = c.key === today;
          const isFuture = c.key > today;
          const cls = [
            'cal-cell',
            !c.inMonth ? 'out' : '',
            isToday ? 'today' : '',
            isFuture && c.inMonth ? 'future' : '',
            met ? 'goal-met' : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={c.key}
              className={cls}
              title={minutes > 0 ? `${c.key} · ${minutes}分钟` : c.key}
            >
              {c.date.getDate()}
            </div>
          );
        })}
      </div>
    </>
  );
}
