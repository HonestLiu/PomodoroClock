// 报表模态窗口 —— PRD §5.5 FR-R1…FR-R6（截图事实 S4）

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { StatCards, countCard, minutesCard } from '@/components/StatCards';
import { PomodoroHeatmap } from '@/charts/PomodoroHeatmap';
import { DonutChart } from '@/charts/DonutChart';
import { DailyCalendar } from '@/charts/DailyCalendar';
import { TrendChart } from '@/charts/TrendChart';
import { DurationList } from '@/charts/DurationList';
import { api } from '@/api';
import { useUiStore } from '@/stores/uiStore';
import { useStatsStore } from '@/stores/statsStore';
import { useDataStore } from '@/stores/dataStore';
import { dailyFocusMap, focusTrend, type Dataset } from '@/lib/derive';
import type { GridCell, ListDistribution, Period, TaskDuration } from '@/types';
import { formatMinutes, shiftPeriod, startOfWeek, toDateKey } from '@/lib/date';
import { useI18n, tStatic } from '@/i18n';

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'day', label: 'report.day' },
  { key: 'week', label: 'report.week' },
  { key: 'month', label: 'report.month' },
  { key: 'year', label: 'report.year' },
];

function periodLabel(period: Period, anchor: Date): string {
  const now = new Date();
  const sameDay = toDateKey(anchor) === toDateKey(now);
  switch (period) {
    case 'day':
      if (sameDay) return '今天';
      return `${anchor.getMonth() + 1}月${anchor.getDate()}日`;
    case 'week': {
      const s = startOfWeek(anchor);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      const isThisWeek = toDateKey(s) === toDateKey(startOfWeek(now));
      return isThisWeek ? '本周' : `${s.getMonth() + 1}月${s.getDate()}日–${e.getMonth() + 1}月${e.getDate()}日`;
    }
    case 'month':
      return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;
    case 'year':
      return `${anchor.getFullYear()}年`;
  }
}

function PeriodNav({
  period, anchor, onChange,
}: { period: Period; anchor: Date; onChange(d: Date): void }) {
  return (
    <div className="period-nav">
      <button onClick={() => onChange(shiftPeriod(period, anchor, -1))} aria-label="上一周期"><ChevronLeft size={14} /></button>
      <span className="period-label">{periodLabel(period, anchor)}</span>
      <button onClick={() => onChange(shiftPeriod(period, anchor, 1))} aria-label="下一周期"><ChevronRight size={14} /></button>
    </div>
  );
}

export function ReportModal() {
  const open = useUiStore((s) => s.reportOpen);
  const close = useUiStore((s) => s.openReport);
  const { stats, refresh, goal } = useStatsStore();
  const { tasks, lists, records, revision } = useDataStore();

  const [detailPeriod, setDetailPeriod] = useState<Period>('day');
  const [detailAnchor, setDetailAnchor] = useState(new Date());
  const [distPeriod, setDistPeriod] = useState<Period>('day');
  const [distAnchor, setDistAnchor] = useState(new Date());
  const [showTask, setShowTask] = useState(true);

  const [grid, setGrid] = useState<{ dates: string[]; cells: GridCell[] }>({ dates: [], cells: [] });
  const [durations, setDurations] = useState<{ items: TaskDuration[]; total: number }>({ items: [], total: 0 });
  const [distribution, setDistribution] = useState<{ items: ListDistribution[]; total: number }>({ items: [], total: 0 });
  const [calAnchor, setCalAnchor] = useState(new Date());
  const { t } = useI18n();

  useEffect(() => { if (open) void refresh(); }, [open, refresh, revision]);

  useEffect(() => {
    if (!open) return;
    void api.get_pomodoro_grid(14).then(setGrid);
  }, [open, revision]);

  useEffect(() => {
    if (!open) return;
    void api.get_task_durations(detailPeriod, toDateKey(detailAnchor)).then(setDurations);
  }, [open, detailPeriod, detailAnchor, revision]);

  useEffect(() => {
    if (!open) return;
    void api.get_list_distribution(distPeriod, toDateKey(distAnchor)).then(setDistribution);
  }, [open, distPeriod, distAnchor, revision]);

  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);
  const focusByDay = useMemo(() => dailyFocusMap(ds), [ds, revision]);
  const trend = useMemo(() => focusTrend(ds, 30), [ds, revision]);
  const todayFocus = useMemo(() => focusByDay.get(toDateKey(new Date())) ?? 0, [focusByDay]);

  if (!open) return null;

  const s = stats;
  const cards = [
    minutesCard('总专注时间', s?.total_focus_min ?? 0),
    minutesCard('本周专注时间', s?.week_focus_min ?? 0),
    minutesCard('今日专注时间', s?.today_focus_min ?? 0),
    countCard('总完成任务', s?.total_done_tasks ?? 0),
    countCard('本周完成任务', s?.week_done_tasks ?? 0),
    countCard('今日完成任务', s?.today_done_tasks ?? 0),
  ];

  const goalMin = goal.daily_target_min;

  return (
    <div className="overlay" onClick={() => close(false)}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t('report.title')}</h2>
          <button className="icon-btn" onClick={() => close(false)} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="modal-body">
          <StatCards cards={cards} six />

          {/* FR-R3 番茄记录图 */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <span className="panel-title">{t('report.pomodoroGrid')}</span>
              <span className="panel-sub">{t('report.gridSub')}</span>
            </div>
            <PomodoroHeatmap dates={grid.dates} cells={grid.cells} />
          </div>

          {/* 近 30 天专注趋势 */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <span className="panel-title">{t('report.trend')}</span>
              <span className="panel-sub">{t('report.trendSub')}</span>
            </div>
            <TrendChart data={trend} goalMin={goalMin} />
          </div>

          <div className="report-grid">
            {/* FR-R4 专注时间详情 */}
            <div className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">{t('report.detail')}</div>
                  <div className="panel-sub">{t('report.totalFocus', { v: formatMinutes(durations.total) })}</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={showTask} onChange={(e) => setShowTask(e.target.checked)} />
                  <span className="track" />
                  {t('report.showTask')}
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <div className="seg">
                  {PERIODS.map((p) => (
                    <button
                      key={p.key}
                      className={detailPeriod === p.key ? 'active' : ''}
                      onClick={() => setDetailPeriod(p.key)}
                    >
                      {t(p.label)}
                    </button>
                  ))}
                </div>
                <PeriodNav period={detailPeriod} anchor={detailAnchor} onChange={setDetailAnchor} />
              </div>
              <DurationList items={durations.items} showTask={showTask} />
            </div>

            {/* FR-R5 清单时间分布 */}
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">{t('report.distribution')}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <div className="seg">
                  {PERIODS.map((p) => (
                    <button
                      key={p.key}
                      className={distPeriod === p.key ? 'active' : ''}
                      onClick={() => setDistPeriod(p.key)}
                    >
                      {t(p.label)}
                    </button>
                  ))}
                </div>
                <PeriodNav period={distPeriod} anchor={distAnchor} onChange={setDistAnchor} />
              </div>
              <DonutChart items={distribution.items} total={distribution.total} />
            </div>
          </div>

          {/* FR-R6 每日专注目标 */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <div className="panel-title">{t('report.goal')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="panel-sub">{t('report.target', { v: formatMinutes(goalMin) })}</span>
                <PeriodNav
                  period="month"
                  anchor={calAnchor}
                  onChange={setCalAnchor}
                />
              </div>
            </div>
            <div className="goal-stats">
              <span>{t('report.focusDays', { n: s?.focus_days ?? 0 })}</span>
              <span>{t('report.goalDays', { n: s?.goal_days ?? 0 })}</span>
              <span>{t('report.goalRate', { n: s?.goal_rate ?? 0 })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ maxWidth: 340, flex: '1 1 300px' }}>
                <DailyCalendar
                  year={calAnchor.getFullYear()}
                  month0={calAnchor.getMonth()}
                  focusByDay={focusByDay}
                  goalMin={goalMin}
                />
              </div>
              <GoalRing value={todayFocus} target={goalMin} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/** 今日目标达成环（report.md ★3）—— 进度 = 今日专注 / 每日目标 */
function GoalRing({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const r = 46, c = 2 * Math.PI * r;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 6 }}>
      <svg width={124} height={124} viewBox="0 0 124 124">
        <circle cx={62} cy={62} r={r} fill="none" stroke="var(--accent-task)" strokeWidth={10} opacity={0.4} />
        <circle
          cx={62} cy={62} r={r} fill="none"
          stroke="var(--accent-focus)" strokeWidth={10} strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 62 62)"
          style={{ transition: 'stroke-dasharray .4s' }}
        />
        <text x={62} y={56} textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: 'var(--text-1)' }}>{pct}%</text>
        <text x={62} y={74} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--text-2)' }}>
          {formatMinutes(value)} / {target > 0 ? `${target}分钟` : '—'}
        </text>
      </svg>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{tStatic('report.goalAchieve')}</span>
    </div>
  );
}
