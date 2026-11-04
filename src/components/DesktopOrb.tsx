import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, Pause, Play, X } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { floatWindowSize, normalizeFloatStyle, orbProgress, orbTime, type OrbAction, type OrbSnapshot } from '@/lib/orb';
import { formatClock } from '@/lib/date';
import wavesThumb from '@/assets/wallpapers/waves-thumb.svg';
import '@/styles/orb.css';

const words = {
  zh: { unspecified: '未指定任务', today: '今日番茄', focus: '专注', break: '休息', idle: '准备开始', paused: '已暂停', stopwatch: '正计时', toggle: '开始计时', pause: '暂停计时', open: '打开专注界面', hide: '隐藏悬浮球', waiting: '连接中', progress: '本轮进度', drag: '拖动移动，双击打开专注界面', unavailable: '主窗口暂未响应', saving: '正在结算' },
  en: { unspecified: 'Untitled task', today: 'today', focus: 'Focus', break: 'Break', idle: 'Ready', paused: 'Paused', stopwatch: 'Elapsed', toggle: 'Start timer', pause: 'Pause timer', open: 'Open focus', hide: 'Hide desktop timer', waiting: 'Connecting', progress: 'Session progress', drag: 'Drag to move. Double-click to open focus.', unavailable: 'Main window is not responding', saving: 'Saving' },
};
export default function DesktopOrb() {
  const [snapshot, setSnapshot] = useState<OrbSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lastReceived = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const native = isTauri();
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    let offMoved: (() => void) | undefined;
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const receive = (value: OrbSnapshot | null) => {
      if (!value || disposed) return;
      lastReceived.current = Date.now();
      setSnapshot(previous => ({ ...value, wallpaper: value.wallpaper ?? previous?.wallpaper })); setNow(value.now); setError(false);
      pending.current = false; setBusy(false);
      if (timer.current) clearTimeout(timer.current);
      document.documentElement.dataset.theme = value.theme;
      document.documentElement.lang = value.lang === 'zh' ? 'zh-CN' : 'en';
    };
    if (native) {
      void listen<OrbSnapshot>('orb://state', event => receive(event.payload)).then(unlisten => {
        if (disposed) unlisten();
        else { off = unlisten; void invoke<OrbSnapshot | null>('orb_snapshot').then(receive).catch(() => setError(true)); }
      });
      void getCurrentWindow().onMoved(() => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => { void invoke('orb_save_position').catch(() => {}); }, 400);
      }).then(unlisten => { if (disposed) unlisten(); else offMoved = unlisten; });
    } else {
      // Standalone design preview; never initializes or writes an application timer.
      receive({ style: normalizeFloatStyle(new URLSearchParams(location.search).get('style')), state: { phase: 'focus', mode: 'pomodoro', task_id: null, running: true, start_at: Date.now() - 5 * 60_000, end_at: Date.now() + 20 * 60_000, paused_remaining_ms: null }, settings: { focus_len_min: 25, break_len_min: 5, long_break_len_min: 15, long_break_every: 4 }, phaseDurationMs: 25 * 60_000, now: Date.now(), title: '专注当下', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', lang: navigator.language.startsWith('en') ? 'en' : 'zh', settling: false });
    }
    const interval = setInterval(() => {
      setNow(value => value + 250);
      if (native && Date.now() - lastReceived.current > 10_000) setError(true);
    }, 250);
    return () => { disposed = true; off?.(); offMoved?.(); clearInterval(interval); clearTimeout(moveTimer); if (timer.current) clearTimeout(timer.current); };
  }, [native]);

  const text = words[snapshot?.lang ?? 'zh'];
  async function action(action: OrbAction) {
    if (pending.current) return;
    if (!native) return;
    pending.current = true; setBusy(true);
    timer.current = setTimeout(() => { pending.current = false; setBusy(false); setError(true); }, 4000);
    try { await invoke('orb_action', { action }); }
    catch { pending.current = false; setBusy(false); setError(true); }
  }
  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    pointer.current = { x: event.clientX, y: event.clientY };
  }
  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (!pointer.current || !(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) < 4) return;
    pointer.current = null;
    if (native) void getCurrentWindow().startDragging().catch(() => setError(true));
  }
  const ms = snapshot ? orbTime(snapshot, now) : 0;
  const progress = snapshot ? orbProgress(snapshot, now) : 0;
  const style = normalizeFloatStyle(snapshot?.style);
  const [width, height] = floatWindowSize(style);
  const phase = snapshot?.state.phase ?? 'idle';
  const running = !!snapshot?.state.running;
  const label = error ? text.unavailable : !snapshot ? text.waiting : snapshot.settling ? text.saving : phase === 'idle' ? text.idle : !running ? text.paused : phase === 'break' ? text.break : snapshot.state.mode === 'stopwatch' ? text.stopwatch : text.focus;
  return <main className={`orb-shell ${style} ${phase}${error ? ' disconnected' : ''}`} data-style={style} style={{ width, height }} aria-label={text.drag}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); void action('hide'); } }}>

    <div className="orb-ball" tabIndex={style === 'bar' ? 0 : undefined}
      style={style === 'card' ? { backgroundImage: `url(${JSON.stringify(snapshot?.wallpaper || wavesThumb)})` } : undefined}
      onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) void action('open'); }} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) void action('open'); }} title={snapshot?.title ? `${snapshot.title}\n${text.drag}` : text.drag}>
      {style === 'card' && <span className="orb-card-task">{snapshot?.title || text.unspecified}</span>}
      <div className="orb-ring" style={{ '--orb-progress': `${progress * 100}%` } as React.CSSProperties} aria-hidden />
      <progress className="orb-sr-only" value={progress} max={1} aria-label={text.progress} />
      <span className="orb-label"><i aria-hidden />{label}</span>
      <span className={`orb-clock${formatClock(ms).length > 5 ? ' long' : ''}`} aria-live="off">{style === 'card' && phase === 'idle' ? (snapshot?.todayCount ?? 0) : snapshot ? formatClock(ms) : '—:—'}</span>
      {style === 'card' && <small className="orb-card-caption">{phase === 'idle' ? text.today : label}</small>}
      <button type="button" className="orb-toggle" disabled={!snapshot || snapshot.settling || error || busy} aria-label={running ? text.pause : text.toggle} title={running ? text.pause : text.toggle} onClick={() => { void action('toggle'); }}>
        {running ? <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden />}
      </button>
    </div>
    <nav className="orb-tools" aria-label={snapshot?.title || text.drag}>
      <button type="button" aria-label={text.open} title={text.open} disabled={busy} onClick={() => { void action('open'); }}><ArrowUpRight size={14} aria-hidden /></button>
      <button type="button" aria-label={text.hide} title={text.hide} disabled={busy} onClick={() => { void action('hide'); }}><X size={13} aria-hidden /></button>
    </nav>
  </main>;
}
