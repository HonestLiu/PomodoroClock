// 番茄钟专注界面 —— PRD §5.4 FR-P2（截图事实 S3）
// 全屏实景背景 / 左上任务选择框 / 中央超大倒计时 / 右侧今日面板 / 底部操作区与工具条

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2, Minimize2, Pause, Play, SkipForward, Square, Timer as TimerIcon, Volume2, VolumeX, X,
} from 'lucide-react';
import wallpaper from '@/assets/wallpapers/waves.svg';
import { useTimerStore } from '@/stores/timerStore';

const CUSTOM_PREFIX = 'custom:';

function resolveWallpaper(raw: string): string {
  if (raw.startsWith(CUSTOM_PREFIX)) return raw.slice(CUSTOM_PREFIX.length);
  return wallpaper;
}
import { useDataStore } from '@/stores/dataStore';
import { todayPendingTasks, todayRecords, todayPomodoroCount, todayDueTasks, type Dataset } from '@/lib/derive';
import { formatClock, formatHM, formatMinutes } from '@/lib/date';
import { stopNoise } from '@/lib/noise';
import { useNoiseStore } from '@/stores/noiseStore';
import { useUiStore } from '@/stores/uiStore';
import { isTauri } from '@/api';
import { useI18n } from '@/i18n';
import type { TimerMode } from '@/types';

const MODE_KEYS: Record<TimerMode, string> = {
  pomodoro: 'timer.mode.pomodoro',
  countdown: 'timer.mode.countdown',
  stopwatch: 'timer.mode.stopwatch',
};

export function TimerScreen() {
  const {
    state, settings, screenOpen, openScreen, toggleRun, skip, setTask, setMode,
    displayMs, durationFor, wasRestored, clearRestored, feedback, setFeedback, stop,
  } = useTimerStore();
  const { tasks, lists, records: allRecords, revision } = useDataStore();

  const [fullscreen, setFullscreen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  // 白噪音状态来自全局 store（工具条 / 设置页 / 选择弹窗共用同一份）
  const noisePlaying = useNoiseStore((s) => s.playing);
  const { t } = useI18n();
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const [newTask, setNewTask] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // 白噪音的启停由全局 store 管（NoisePicker），这里只兜底：应用卸载时停止（PRD FR-P4）
  useEffect(() => () => stopNoise(), []);

  const ds: Dataset = useMemo(
    () => ({ tasks, lists, records: allRecords }),
    [tasks, lists, allRecords],
  );
  // 番茄钟任务选择/面板只展示今日到期的未完成任务
  const todayTasks = useMemo(() => todayDueTasks(ds), [ds, revision]);
  // 阶段结束反馈：展示 2.5s 后自动清除（须位于 `if (!screenOpen) return null` 之前，保证 hook 顺序一致）
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(t);
  }, [feedback, setFeedback]);

  // Esc 关闭全屏专注层（平台惯例）：控件已消费的 Esc（defaultPrevented）以及
  // 输入框/下拉/音量滑杆内的 Esc 不拦截，避免打断输入与调节
  useEffect(() => {
    if (!screenOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      openScreen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screenOpen, openScreen]);

  const pending = useMemo(() => todayPendingTasks(ds), [ds, revision]);
  const records = useMemo(() => todayRecords(ds), [ds, revision]);
  const todayTotal = useMemo(
    () => records.reduce((a, r) => a + r.duration_min, 0),
    [records],
  );

  if (!screenOpen) return null;

  const ms = displayMs();
  const fallback = durationFor(state.phase === 'idle' ? 'focus' : state.phase);
  // 倒计时剩余 10 秒开始闪烁提醒（正计时是「已用时长」，没有临近结束的概念，不能套用）
  const warn = state.mode !== 'stopwatch' && state.phase === 'focus' && state.running && ms <= 10_000 && ms > 0;
  const progress = fallback > 0 ? Math.min(1, Math.max(0, 1 - ms / fallback)) : 0;

  const currentTask = tasks.find((t) => t.id === state.task_id);
  const taskName = currentTask?.title ?? t('timer.untitled');
  const est = currentTask?.est_pomodoros ?? 0;

  const ctaLabel = state.phase === 'break'
    ? (state.running ? t('timer.cta.pause') : t('timer.cta.startBreak'))
    : state.phase === 'focus'
      ? (state.running ? t('timer.cta.pause') : t('timer.cta.resume'))
      : t('timer.cta.start');

  async function toggleFullscreen() {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      const isFs = await w.isFullscreen();
      await w.setFullscreen(!isFs);
      setFullscreen(!isFs);
    } else {
      const el = rootRef.current;
      if (!document.fullscreenElement) { await el?.requestFullscreen?.(); setFullscreen(true); }
      else { await document.exitFullscreen?.(); setFullscreen(false); }
    }
  }

  function onCta() {
    toggleRun();
  }

  function commitNewTask() {
    const v = newTask.trim();
    if (!v) return;
    const found = tasks.find((t) => t.title === v);
    setNewTask('');
    if (found) setTask(found.id);
  }

  // 今日记录时间轴：按 06:00–24:00 映射
  const TL_START = 6, TL_END = 24;
  const span = (TL_END - TL_START) * 60;

  const taskSelector = (
    <div className="timer-task">
      <TimerIcon size={15} style={{ opacity: 0.8 }} />
      <select
        value={state.task_id ?? ''}
        onChange={(e) => setTask(e.target.value || null)}
        style={{ display: todayTasks.length ? 'block' : 'none' }}
      >
        <option value="">{t('timer.untitled')}</option>
        {todayTasks.map((t) => (
          <option key={t.id} value={t.id}>{t.title}</option>
        ))}
      </select>
      <input
        value={newTask}
        placeholder={taskName}
        onChange={(e) => setNewTask(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitNewTask(); }}
        style={{ display: todayTasks.length ? 'none' : 'block' }}
      />
      {est > 0 && <span className="est">{est.toFixed(1).replace(/\.0$/, '')}</span>}
    </div>
  );

  return (
    <div className={`timer-screen${isMac ? ' macos' : ''}`} ref={rootRef}>
      {/* url() 必须加引号：Vite 内联的 SVG data URI 内含单引号（xmlns='...'），
          未加引号的 url(...) 是非法 CSS，整条 background-image 会被解析器丢弃（背景全丢） */}
      <div className="timer-bg" style={{ backgroundImage: `url("${resolveWallpaper(settings.wallpaper)}")` }} />

      {wasRestored && (
        <div className="timer-recover">
          <span>{t('timer.recover', { detail: state.phase === 'focus' || state.phase === 'idle' ? t('timer.recover.focus') : t('timer.recover.break') })}</span>
          <button onClick={skip}>{t('timer.recover.continue')}</button>
          <button className="timer-recover-close" onClick={clearRestored}>{t('timer.recover.ok')}</button>
        </div>
      )}

      <div className="timer-top">
        {taskSelector}
        <button className="timer-close" onClick={() => openScreen(false)} title={t('timer.collapse')}><X size={16} /></button>
      </div>

      {feedback && (
        <div className="timer-feedback">{feedback}</div>
      )}

      <div className="timer-main">
        <div className="timer-center">
          <span className="timer-phase">
            {state.phase === 'break' ? t('timer.phase.break') : state.phase === 'idle' ? t('timer.phase.idle') : t('timer.phase.focus')}
            {' · '}{t(MODE_KEYS[state.mode])}
          </span>
          <span className={`timer-count tabular${warn ? ' warn' : ''}`}>{formatClock(ms)}</span>
          <span className="timer-sub">
            {state.mode === 'stopwatch' ? t('timer.elapsed') : t('timer.remaining')} · {t('timer.thisRound', { n: todayPomodoroCount(ds) })}
          </span>
        </div>

        <aside className="timer-side">
          <div>
            <h4>{t('timer.todayFocus')}</h4>
            <div className="big">{formatMinutes(todayTotal)}</div>
          </div>

          <div className="timer-side-sec">
            <h4>{t('timer.today')}</h4>
            <div style={{ overflowY: 'auto', maxHeight: 150, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {pending.length === 0 && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{t('timer.noTasks')}</span>}
              {pending.map((t) => (
                <button
                  key={t.id}
                  className={`today-task${state.task_id === t.id ? ' active' : ''}`}
                  onClick={() => setTask(t.id)}
                >
                  <span className="t">{t.title}</span>
                  {t.est_pomodoros > 0 && <span className="e">{t.est_pomodoros.toFixed(1).replace(/\.0$/, '')}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="timer-side-sec">
            <h4>{t('timer.todayRecords')}</h4>
            <div className="timeline">
              <div className="timeline-axis">
                {[6, 12, 18, 24].map((h) => (
                  <span className="timeline-tick" key={h}>
                    {String(h).padStart(2, '0')}:00<i />
                  </span>
                ))}
              </div>
              <div className="timeline-bars">
                {records.map((r) => {
                  const s = new Date(r.start_at);
                  const e = new Date(r.end_at);
                  const startMin = (s.getHours() + s.getMinutes() / 60 - TL_START) * 60;
                  const endMin = (e.getHours() + e.getMinutes() / 60 - TL_START) * 60;
                  const left = Math.max(0, (startMin / span) * 100);
                  const width = Math.max(1.5, ((Math.min(span, endMin) - Math.max(0, startMin)) / span) * 100);
                  return (
                    <span
                      key={r.id}
                      className="timeline-bar"
                      style={{ left: `${left}%`, width: `${width}%`, top: 0, bottom: 0 }}
                      title={`${formatHM(r.start_at)}–${formatHM(r.end_at)} · ${t('record.duration', { n: r.duration_min })}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="timer-bottom">
        {/* 正计时（stopwatch）运行中：主按钮改为「停止」→ 写 focus_record 并结束；其余模式保持 开始/暂停 */}
        {state.mode === 'stopwatch' && state.running ? (
          <button className="timer-cta" onClick={stop}>
            <Square size={11} fill="currentColor" strokeWidth={0} />
            {t('timer.cta.stop')}
          </button>
        ) : (
          <button className="timer-cta" onClick={onCta}>
            {state.running ? <Pause size={15} /> : <Play size={15} />}
            {ctaLabel}
          </button>
        )}

        <div className="timer-tools">
          <button className="timer-tool" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {t('timer.fullscreen')}
          </button>

          <div style={{ position: 'relative' }}>
            <button className="timer-tool" onClick={() => setModeOpen(!modeOpen)}>
              <TimerIcon size={13} /> {t(MODE_KEYS[state.mode])}
            </button>
            {modeOpen && (
              <div className="timer-mode-menu" role="menu">
                {(Object.keys(MODE_KEYS) as TimerMode[]).map((m) => (
                  <button
                    key={m}
                    className={state.mode === m ? 'active' : ''}
                    onClick={() => { setMode(m); setModeOpen(false); }}
                  >
                    {t(MODE_KEYS[m])}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className={`timer-tool${noisePlaying ? ' on' : ''}`}
            aria-haspopup="dialog"
            onClick={() => useUiStore.getState().openNoise(true)}
          >
            {noisePlaying ? <Volume2 size={13} /> : <VolumeX size={13} />} {t('timer.noise')}
          </button>

          <button className="timer-tool" onClick={skip}>
            <SkipForward size={13} /> {t('timer.skip')}
          </button>
        </div>
      </div>

      {/* 进度条（顶部细线） */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, height: 2, zIndex: 3,
          width: `${progress * 100}%`, background: 'rgba(255,255,255,.85)',
          transition: 'width .3s linear',
        }}
      />
    </div>
  );
}
