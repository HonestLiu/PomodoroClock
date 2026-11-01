// 悬浮番茄小窗 —— PRD FR-G4（截图事实 S1/S2）
// 收起态：海浪缩略背景 + 当前任务名 + 本日番茄计数 + 播放按钮；可拖动、可关闭。
// 与全屏专注界面共用同一 timerStore 来源，关闭小窗不终止计时（PRD §8.8-2）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, X, Maximize2 } from 'lucide-react';
import thumb from '@/assets/wallpapers/waves-thumb.svg';
import { useTimerStore } from '@/stores/timerStore';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';
import { todayPomodoroCount } from '@/lib/derive';
import { formatClock } from '@/lib/date';
import { resolveCustomWallpaper } from '@/lib/wallpaper';

const POS_KEY = 'floatwin.pos';

function resolveThumb(raw: string, wallpapersJson: string): string {
  return resolveCustomWallpaper(raw, wallpapersJson) ?? thumb;
}

export function FloatWindow() {
  const { state, toggleRun, displayMs, openScreen, now, settings } = useTimerStore();
  const { tasks, lists, records } = useDataStore();
  const visible = useUiStore((s) => s.floatVisible);
  const setVisible = useUiStore((s) => s.setFloatVisible);
  const { t } = useI18n();

  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 22, bottom: 22 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) setPos(JSON.parse(raw));
    } catch { /* 忽略不可用的 localStorage */ }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const w = 200, h = 118;
    const left = Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - w);
    const top = Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - h);
    setPos({ right: window.innerWidth - left - w, bottom: window.innerHeight - top - h });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* noop */ }
  }, [pos]);

  if (!visible) return null;

  const taskName = state.task_id
    ? (tasks.find((t) => t.id === state.task_id)?.title ?? t('task.unspecified'))
    : t('task.unspecified');

  const count = todayPomodoroCount({ tasks, lists, records }, state.task_id ?? undefined);
  const running = state.running;
  const ms = displayMs();
  const showClock = state.phase !== 'idle';

  return (
    <div
      ref={ref}
      className="float-win"
      style={{ backgroundImage: `url("${resolveThumb(settings.wallpaper, settings.wallpapers)}")`, right: pos.right, bottom: pos.bottom }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="float-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="float-task" style={{ flex: 1 }}>{taskName}</span>
        </div>

        <div className="float-bottom">
          <span className="float-count">
            {showClock ? formatClock(ms) : count}
            <small>{showClock ? (state.phase === 'focus' ? t('float.focusing') : t('float.breaking')) : t('float.todayCount')}</small>
          </span>
          <button
            className="float-play"
            title={running ? t('timer.cta.pause') : t('timer.cta.start')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { openScreen(true); toggleRun(); }}
          >
            {running ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 1 }} />}
          </button>
        </div>
      </div>

      <button
        className="float-expand"
        title={t('float.expand')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => openScreen(true)}
      >
        <Maximize2 size={11} />
      </button>

      <button
        className="float-close"
        title={t('float.close')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setVisible(false)}
      >
        <X size={12} />
      </button>
      {/* now 参与渲染以保证计时每秒刷新 */}
      <span hidden>{now}</span>
    </div>
  );
}
