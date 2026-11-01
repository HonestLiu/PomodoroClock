// 每日专注目标月历 —— PRD FR-R6（截图事实 S4）
// 周一起始，上/下月补位灰色；今天红色数字；达成目标日红色圆圈标记；未来日期灰色。

import { useMemo } from 'react';
import { monthGrid, todayKey } from '@/lib/date';
import { useI18n } from '@/i18n';

/** 星期表头（周一起始）—— 文案走词表，英文显示 Mon…Sun */
const WEEK_KEYS = [
  'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu',
  'weekday.fri', 'weekday.sat', 'weekday.sun',
] as const;

export function DailyCalendar({
  year, month0, focusByDay, goalMin, range,
}: {
  year: number;
  month0: number;
  focusByDay: Map<string, number>;
  goalMin: number;
  range?: { from: string; to: string };
}) {
  const cells = useMemo(() => monthGrid(year, month0), [year, month0]);
  const today = todayKey();
  const { t } = useI18n();

  return (
    <>
      <div className="cal-head" aria-hidden>
        {WEEK_KEYS.map((k) => <span key={k}>{t(k)}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((c) => {
          const minutes = focusByDay.get(c.key) ?? 0;
          const met = goalMin > 0 && minutes >= goalMin;
          const isToday = c.key === today;
          const isFuture = c.key > today;
          const outsideRange = range && (c.key < range.from || c.key > range.to);
          const cls = [
            'cal-cell',
            !c.inMonth ? 'out' : '',
            isToday ? 'today' : '',
            isFuture && c.inMonth ? 'future' : '',
            met ? 'goal-met' : '',
            outsideRange ? 'outside-range' : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={c.key}
              className={cls}
              title={outsideRange ? t('report2.outsideRange', { date: c.key }) : minutes > 0 ? t('cal.cellTip', { date: c.key, min: minutes }) : c.key}
            >
              {c.date.getDate()}
            </div>
          );
        })}
      </div>
    </>
  );
}
