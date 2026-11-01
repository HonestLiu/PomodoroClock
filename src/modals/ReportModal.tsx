// 专注报表：统一日期范围，概览 / 时间分布 / 任务与目标。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Clock3, Flame, Target, X } from 'lucide-react';
import { DonutChart } from '@/charts/DonutChart';
import { DailyCalendar } from '@/charts/DailyCalendar';
import { DurationList } from '@/charts/DurationList';
import { PomodoroHeatmap } from '@/charts/PomodoroHeatmap';
import { ReportTimeline } from '@/charts/ReportTimeline';
import { useUiStore } from '@/stores/uiStore';
import { useStatsStore } from '@/stores/statsStore';
import { useDataStore } from '@/stores/dataStore';
import { isOverdue, reportInsights, taskOverview, upcomingTasks } from '@/lib/derive';
import { buildReport, moveReportPeriod, reportDate } from '@/lib/report';
import { formatDueDate, formatMinutes, formatPeriodTitle, periodRange, todayKey, toDateKey } from '@/lib/date';
import type { Period } from '@/types';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';
import '@/styles/report.css';

const PERIODS: Period[] = ['day', 'week', 'month', 'year'];
const VIEWS = ['overview', 'distribution', 'goals'] as const;
type ReportView = typeof VIEWS[number];
const WEEKDAYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];

function ReportPanel({ title, sub, action, children, className = '' }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`rpt-panel ${className}`} aria-label={title}><div className="rpt-panel-head"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>{action}</div>{children}</section>;
}

export function ReportModal() {
  const open = useUiStore(s => s.reportOpen);
  const close = () => useUiStore.getState().openReport(false);
  const { tasks, lists, records } = useDataStore();
  const { goal, stats } = useStatsStore();
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<ReportView>('overview');
  const [showTask, setShowTask] = useState(true);
  const [heatOpen, setHeatOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, close, modalRef, '.rpt-close');
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [open]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); setHeatOpen(false); }, [view, period, anchor]);
  const ds = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);
  const summary = useMemo(() => buildReport(ds, period, anchor, goal.daily_target_min, now), [ds, period, anchor, goal.daily_target_min, now]);
  const overview = useMemo(() => taskOverview(ds), [ds]);
  const lifetime = useMemo(() => reportInsights(ds), [ds]);
  const upcoming = useMemo(() => upcomingTasks(ds, 5), [ds]);
  const durations = summary.taskDurations.map(item => ({ ...item, title: item.title ?? t(item.task_id ? 'report2.deletedTask' : 'task.unspecified') }));
  const distribution = summary.distribution.map(item => ({ ...item, name: item.name ?? t(item.list_id ? 'report2.deletedList' : 'report2.noList') }));
  const isCurrent = summary.from === periodRange(period, now)[0];
  const hasNext = summary.from < periodRange(period, now)[0];
  const peakHour = summary.hours.reduce<typeof summary.hours[number] | null>((best, bucket) => bucket.minutes > (best?.minutes ?? 0) ? bucket : best, null);
  const dailyGoal = goal.daily_target_min;
  const completed = tasks.filter(task => task.completed === 1 && task.completed_at !== null && task.completed_at >= summary.from && task.completed_at <= Math.min(summary.to, now.getTime()))
    .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
  function viewKey(e: React.KeyboardEvent<HTMLButtonElement>, current: ReportView) {
    const index = VIEWS.indexOf(current);
    const next = e.key === 'ArrowRight' ? (index + 1) % VIEWS.length : e.key === 'ArrowLeft' ? (index + VIEWS.length - 1) % VIEWS.length : e.key === 'Home' ? 0 : e.key === 'End' ? VIEWS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); setView(VIEWS[next]); document.getElementById(`report-tab-${VIEWS[next]}`)?.focus();
  }
  if (!open) return null;
  return <div className="overlay rpt-overlay" onClick={close}>
    <div className="modal report-modal rpt-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={e => e.stopPropagation()}>
      <header className="rpt-header">
        <div className="rpt-heading"><span className="rpt-mark" aria-hidden><BarChart3 size={22} /></span><div><h2 id="report-title">{t('report2.title')}</h2><p>{t('report2.subtitle')}</p></div></div>
        <button className="icon-btn rpt-close" onClick={close} aria-label={t('common.close')}><X size={19} aria-hidden /></button>
      </header>
      <div className="rpt-toolbar">
        <fieldset className="rpt-periods"><legend className="sr-only">{t('report2.period')}</legend>{PERIODS.map(key => <label key={key}><input type="radio" name="report-period" value={key} checked={period === key} onChange={() => setPeriod(key)} /><span>{t(`report.${key}`)}</span></label>)}</fieldset>
        <div className="rpt-range"><button className="rpt-arrow" aria-label={t('report.prev')} onClick={() => setAnchor(moveReportPeriod(period, anchor, -1))}><ChevronLeft size={17} aria-hidden /></button><span aria-live="polite">{formatPeriodTitle(period, anchor)}</span><button className="rpt-arrow" disabled={!hasNext} aria-label={t('report.next')} onClick={() => setAnchor(moveReportPeriod(period, anchor, 1))}><ChevronRight size={17} aria-hidden /></button></div>
        <div className="rpt-date-actions"><label className="rpt-date"><CalendarDays size={14} aria-hidden /><input type="date" value={toDateKey(anchor)} max={todayKey()} aria-label={t('report2.chooseDate')} onChange={e => { if (e.target.value) setAnchor(reportDate(e.target.value)); }} /></label><button className="rpt-reset" disabled={isCurrent} onClick={() => setAnchor(new Date())}>{t('report2.current')}</button></div>
      </div>
      <nav className="rpt-tabs" role="tablist" aria-label={t('report2.views')}>{VIEWS.map(key => <button id={`report-tab-${key}`} key={key} role="tab" aria-selected={view === key} aria-controls="report-view" tabIndex={view === key ? 0 : -1} onClick={() => setView(key)} onKeyDown={e => viewKey(e, key)}>{t(`report2.${key}`)}</button>)}</nav>
      <div className="rpt-body" ref={bodyRef} id="report-view" role="tabpanel" aria-labelledby={`report-tab-${view}`} tabIndex={0}>
        {view === 'overview' && <>
          <div className="rpt-overview-layout">
            <ReportPanel className="rpt-focus-panel" title={t('report2.periodFocus')} action={<span className="rpt-subtle">{t('report2.periodScope')}</span>}>
              <div className="rpt-focus-total"><strong>{formatMinutes(summary.totalMin)}</strong><span>{t('report2.dailyAverage', { value: formatMinutes(summary.dailyAverage) })}</span></div>
              <dl className="rpt-metrics">
                <div><dt><Clock3 size={14} aria-hidden />{t('report.sessionCount')}</dt><dd>{summary.sessions}<small>{t('report2.times')}</small></dd></div>
                <div><dt><CheckCheck size={14} aria-hidden />{t('report2.completed')}</dt><dd>{summary.completedTasks}<small>{t('report2.tasksUnit')}</small></dd></div>
                <div><dt><Flame size={14} aria-hidden />{t('report2.activeDays')}</dt><dd>{summary.activeDays}<small>{t('report2.daysUnit')}</small></dd></div>
              </dl>
              <ReportTimeline key={`${period}-${summary.from}`} items={summary.series} period={period} goalMin={dailyGoal} />
            </ReportPanel>
            <aside className="rpt-goal-aside">
              <ReportPanel title={t('report2.goalProgress')} className="rpt-goal-panel" action={<Target size={17} aria-hidden />}>
                <GoalRing percent={summary.goalRate} disabled={dailyGoal <= 0} />
                <p className="rpt-goal-detail">{t('report2.goalDaysDetail', { met: summary.goalDays, active: summary.activeDays })}</p>
                <div className="rpt-aside-rows"><div><span>{t('report2.dailyTarget')}</span><strong>{dailyGoal > 0 ? formatMinutes(dailyGoal) : t('report2.noGoal')}</strong></div><div><span>{t('report.avgSession')}</span><strong>{formatMinutes(summary.averageSession)}</strong></div><div><span>{t('report.longestSession')}</span><strong>{formatMinutes(summary.longestSession)}</strong></div></div>
              </ReportPanel>
            </aside>
          </div>
          <div className="rpt-insights" aria-label={t('report2.periodInsights')}>
            <Insight title={t('report.bestDay')} value={summary.bestDay ? formatMinutes(summary.bestDay.minutes) : '—'} note={summary.bestDay ? formatDueDate(summary.bestDay.key) : t('report2.noFocus')} />
            <Insight title={t('report.peakHour')} value={peakHour ? `${peakHour.key.padStart(2, '0')}:00` : '—'} note={peakHour ? formatMinutes(peakHour.minutes) : t('report2.noFocus')} />
            <Insight title={t('report2.periodStreak')} value={t('report.streakDays', { n: summary.longestStreak })} note={t('report2.streakHint')} />
          </div>
          {summary.sessions === 0 && <div className="rpt-empty-note"><Clock3 size={18} aria-hidden /><div><strong>{t('report2.noFocus')}</strong><p>{t('report2.noFocusHint')}</p></div></div>}
          <div className="rpt-lifetime"><span>{t('report2.lifetime')}</span><span>{t('stat.totalFocus')} <b>{formatMinutes(stats?.total_focus_min ?? lifetime.totalMin)}</b></span><span>{t('stat.totalDone')} <b>{stats?.total_done_tasks ?? overview.done}</b></span><span>{t('report.streak')} <b>{t('report.streakDays', { n: lifetime.currentStreak })}</b></span></div>
        </>}
        {view === 'distribution' && <>
          <div className="rpt-section-summary"><span>{t('report.totalFocus', { v: formatMinutes(summary.totalMin) })}</span><span>{t('report2.sessionAmount', { n: summary.sessions })}</span></div>
          <div className="rpt-two-column">
            <ReportPanel title={t('report.distribution')} sub={t('report2.periodScope')}><DonutChart items={distribution} total={summary.totalMin} /></ReportPanel>
            <ReportPanel title={t('report.detail')} sub={t('report2.taskAttribution')} action={<label className="rpt-checkbox"><input type="checkbox" checked={showTask} onChange={e => setShowTask(e.target.checked)} />{t('report.showTask')}</label>}><div className="rpt-duration-scroll"><DurationList items={durations} showTask={showTask} /></div></ReportPanel>
          </div>
          <div className="rpt-two-column rpt-distributions">
            <ReportPanel title={t('report.byHour')} sub={t('report2.hourAttribution')}><MiniDistribution items={summary.hours.map(item => ({ ...item, label: `${item.key.padStart(2, '0')}:00` }))} every={3} /></ReportPanel>
            <ReportPanel title={t('report.byWeekday')} sub={t('report2.periodScope')}><MiniDistribution items={summary.weekdays.map((item, i) => ({ ...item, label: t(WEEKDAYS[i]) }))} /></ReportPanel>
          </div>
          <details className="rpt-heat-details" open={heatOpen} onToggle={e => setHeatOpen(e.currentTarget.open)}><summary>{t('report.pomodoroGrid')}<span>{t('report2.heatHint')}</span></summary>{heatOpen && <div className="rpt-heat-scroll"><PomodoroHeatmap dates={[...summary.days].reverse()} cells={summary.grid} /></div>}</details>
        </>}
        {view === 'goals' && <>
          <div className="rpt-two-column">
            <ReportPanel title={t('report.goal')} sub={formatPeriodTitle('month', anchor)} action={<span className="rpt-subtle">{t('report2.dailyTarget')} {formatMinutes(dailyGoal)}</span>}>
              <div className="rpt-calendar"><DailyCalendar year={anchor.getFullYear()} month0={anchor.getMonth()} focusByDay={summary.byDay} goalMin={dailyGoal} range={{ from: toDateKey(summary.from), to: toDateKey(summary.to) }} /></div>
              <p className="rpt-calendar-caption"><i />{t('report2.calendarHint')}</p>
            </ReportPanel>
            <ReportPanel title={t('report.taskOverview')} sub={t('report2.currentTasks')}>
              <div className="rpt-completion"><strong>{overview.completionRate}%</strong><span>{t('report2.taskCompletion')}</span><progress max={100} value={overview.completionRate} aria-label={t('report2.taskCompletion')} /></div>
              <div className="rpt-task-numbers">{[[t('report.pendingTasks'), overview.pending], [t('report.doneTasks'), overview.done], [t('report.overdueTasks'), overview.overdue], [t('report.dueTodayTasks'), overview.dueToday], [t('report.highPriority'), overview.highPriority], [t('report.estPomodoros'), overview.estPomodoros]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
              <div className="rpt-task-foot"><span>{t('report.invested')} {formatMinutes(overview.investedMin)}</span><span>{t('report.urgentFlagged', { u: overview.urgent, f: overview.flagged })}</span></div>
            </ReportPanel>
          </div>
          <div className="rpt-two-column">
            <ReportPanel title={t('report2.completed')} sub={t('report2.periodScope')}><div className="rpt-task-list">{completed.length ? completed.map(task => <div key={task.id}><CheckCheck size={15} aria-hidden /><span>{task.title}</span><time>{new Date(task.completed_at!).toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })}</time></div>) : <p className="rpt-empty-inline">{t('report2.noCompleted')}</p>}</div></ReportPanel>
            <ReportPanel title={t('report.upcoming')} sub={t('report2.currentTasks')}><div className="rpt-task-list">{upcoming.length ? upcoming.map(task => <div key={task.id} className={isOverdue(task) ? 'is-overdue' : ''}><span className="rpt-task-dot" /><span>{task.title}</span><time>{formatDueDate(task.due_date)}{task.due_time ? ` ${task.due_time}` : ''}</time></div>) : <p className="rpt-empty-inline">{t('report2.noUpcoming')}</p>}</div></ReportPanel>
          </div>
        </>}
        <p className="rpt-data-note">{t('report2.attribution')}</p>
      </div>
    </div>
  </div>;
}

function Insight({ title, value, note }: { title: string; value: string; note: string }) {
  return <div><span>{title}</span><strong>{value}</strong><small>{note}</small></div>;
}
function GoalRing({ percent, disabled }: { percent: number; disabled: boolean }) {
  const { t } = useI18n();
  const circumference = 2 * Math.PI * 48;
  return <div className="rpt-goal-ring"><svg width={144} height={144} viewBox="0 0 144 144" role="img" aria-label={disabled ? t('report2.noGoal') : t('report2.goalPercent', { n: percent })}><circle cx={72} cy={72} r={48} fill="none" stroke="var(--rpt-track)" strokeWidth={9} /><circle cx={72} cy={72} r={48} fill="none" stroke="var(--accent-focus)" strokeWidth={9} strokeLinecap="round" strokeOpacity={percent > 0 ? 1 : 0} strokeDasharray={`${percent / 100 * circumference} ${circumference}`} transform="rotate(-90 72 72)" /><text x={72} y={78} textAnchor="middle">{disabled ? '—' : `${percent}%`}</text></svg><span>{t('report2.activeDayRate')}</span></div>;
}
function MiniDistribution({ items, every = 1 }: { items: Array<{ key: string; label: string; minutes: number; sessions: number }>; every?: number }) {
  const { t } = useI18n();
  const max = Math.max(1, ...items.map(item => item.minutes));
  return <div className="rpt-mini-bars" role="group" aria-label={t('report.dist')}>{items.map((item, index) => <button key={item.key} className="rpt-mini-col" type="button" title={`${item.label}: ${formatMinutes(item.minutes)}`} aria-label={`${item.label}: ${formatMinutes(item.minutes)}, ${t('report2.sessionAmount', { n: item.sessions })}`}><span style={{ height: `${item.minutes ? Math.max(3, item.minutes / max * 100) : 1}%` }} /><small aria-hidden>{index % every === 0 ? item.label : ''}</small></button>)}</div>;
}
