// 番茄钟专注界面 —— PRD §5.4 FR-P2（截图事实 S3）
// 全屏实景背景 / 左上任务选择框 / 中央超大倒计时 / 右侧今日面板 / 底部操作区与工具条

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2, Minimize2, Pause, Play, SkipForward, Timer as TimerIcon, Volume2, VolumeX, X,
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
import { NOISE_LABELS, setNoiseVolume, startNoise, stopNoise, type NoiseKind } from '@/lib/noise';
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
    displayMs, durationFor, wasRestored, clearRestored, feedback, setFeedback,
  } = useTimerStore();
  const { tasks, lists, records: allRecords, revision } = useDataStore();

  const [fullscreen, setFullscreen] = useState(false);
  const [noiseOn, setNoiseOn] = useState(false);
  const [noiseKind, setNoiseKind] = useState<NoiseKind>('waves');
  const [volume, setVolume] = useState(0.5);
  const [modeOpen, setModeOpen] = useState(false);
  const [noiseOpen, setNoiseOpen] = useState(false);
  const { t } = useI18n();
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const [newTask, setNewTask] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // 白噪音：切换/换音色直接启停；卸载时停止（PRD FR-P4）
  useEffect(() => {
    if (!noiseOn) return;
    startNoise(noiseKind, volume);   // 音色切换时重启
  }, [noiseKind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopNoise(), []);

  function toggleNoise(checked: boolean) {
    setNoiseOn(checked);
    // 在用户手势内直接启停，规避 WebView 自动播放限制
    if (checked) startNoise(noiseKind, volume);
    else stopNoise();
  }

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

  const pending = useMemo(() => todayPendingTasks(ds), [ds, revision]);
  const records = useMemo(() => todayRecords(ds), [ds, revision]);
  const todayTotal = useMemo(
    () => records.reduce((a, r) => a + r.duration_min, 0),
    [records],
  );

  if (!screenOpen) return null;

  const ms = displayMs();
  const fallback = durationFor(state.phase === 'idle' ? 'focus' : state.phase);
  const warn = state.phase === 'focus' && state.running && ms <= 10_000 && ms > 0;
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
        <option value="">未指定任务</option>
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
      <div className="timer-bg" style={{ backgroundImage: `url(${resolveWallpaper(settings.wallpaper)})` }} />

      {wasRestored && (
        <div className="timer-recover">
          <span>{t('timer.recover', { detail: state.phase === 'focus' || state.phase === 'idle' ? t('timer.recover.focus') : t('timer.recover.break') })}</span>
          <button onClick={skip}>{t('timer.recover.continue')}</button>
          <button className="timer-recover-close" onClick={clearRestored}>{t('timer.recover.ok')}</button>
        </div>
      )}

      <div className="timer-top">
        {taskSelector}
        <button className="timer-close" onClick={() => openScreen(false)} title="收起"><X size={16} /></button>
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
            {state.mode === 'stopwatch' ? '已专注' : '剩余'} · 本轮已完成 {todayPomodoroCount(ds)} 个番茄
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
                      title={`${formatHM(r.start_at)}–${formatHM(r.end_at)} · ${r.duration_min}分钟`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="timer-bottom">
        <button className="timer-cta" onClick={onCta}>
          {state.running && state.phase === 'focus' ? <Pause size={15} /> : <Play size={15} />}
          {ctaLabel}
        </button>

        <div className="timer-tools">
          <button className="timer-tool" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {t('timer.fullscreen')}
          </button>

          <div style={{ position: 'relative' }}>
            <button className="timer-tool" onClick={() => { setModeOpen(!modeOpen); setNoiseOpen(false); }}>
              <TimerIcon size={13} /> {t(MODE_KEYS[state.mode])}
            </button>
            {modeOpen && (
              <div className="seg" style={{ position: 'absolute', bottom: 42, left: 0, background: 'rgba(255,255,255,.9)' }}>
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

          <div style={{ position: 'relative' }}>
            <button
              className={`timer-tool${noiseOn ? ' on' : ''}`}
              onClick={() => { setNoiseOpen(!noiseOpen); setModeOpen(false); }}
            >
              {noiseOn ? <Volume2 size={13} /> : <VolumeX size={13} />} {t('timer.noise')}
            </button>
            {noiseOpen && (
              <div
                style={{
                  position: 'absolute', bottom: 42, right: 0, width: 208,
                  background: 'rgba(255,255,255,.95)', borderRadius: 10, padding: 12,
                  display: 'flex', flexDirection: 'column', gap: 10, color: '#1a1a1a',
                }}
              >
                <label className="switch" style={{ color: '#1a1a1a' }}>
                  <input type="checkbox" checked={noiseOn} onChange={(e) => toggleNoise(e.target.checked)} />
                  <span className="track" />
                  {t('timer.noise')}
                </label>
                <div className="seg" style={{ background: '#f2f1ed' }}>
                  {(Object.keys(NOISE_LABELS) as NoiseKind[]).map((k) => (
                    <button
                      key={k}
                      className={noiseKind === k ? 'active' : ''}
                      onClick={() => setNoiseKind(k)}
                    >
                      {NOISE_LABELS[k]}
                    </button>
                  ))}
                </div>
                <input
                  className="vol-slider"
                  style={{ width: '100%', accentColor: '#4A7DE0' }}
                  type="range" min={0} max={1} step={0.01}
                  value={volume}
                  onChange={(e) => { const v = Number(e.target.value); setVolume(v); setNoiseVolume(v); }}
                />
              </div>
            )}
          </div>

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
