import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/api';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useQuestStore, questTitle } from '@/stores/questStore';
import { useI18nStore } from '@/i18n';
import { normalizeFloatStyle, type OrbAction, type OrbSnapshot } from './orb';
import { resolveCustomWallpaper } from '@/lib/wallpaper';
import wavesThumb from '@/assets/wallpapers/waves-thumb.svg';
import { todayPomodoroCount } from '@/lib/derive';

/** Only the main webview owns the timer and audio. The desktop orb is a read-only remote. */
export function installOrbController(): () => void {
  if (!isTauri()) return () => {};
  let stopped = false;
  let previous = '';
  let lastVisible: boolean | null = null;
  let lastStyle = '';
  let lastWallpaper: string | null = null;
  let wallpaperKey = '';
  let wallpaperList = '';
  let resolvedWallpaper = wavesThumb;
  let queued = false;
  let sending = false;
  let reportError = false;
  async function sync() {
    if (stopped || sending) return;
    sending = true;
    try {
      while (queued && !stopped) {
        queued = false;
        const timer = useTimerStore.getState();
        const ui = useUiStore.getState();
        const phase = timer.state.phase === 'idle' ? 'focus' : timer.state.phase;
        const style = normalizeFloatStyle(timer.settings.float_style);
        if (wallpaperKey !== timer.settings.wallpaper || wallpaperList !== timer.settings.wallpapers) {
          wallpaperKey = timer.settings.wallpaper; wallpaperList = timer.settings.wallpapers;
          resolvedWallpaper = resolveCustomWallpaper(wallpaperKey, wallpaperList) ?? wavesThumb;
        }
        const wallpaper = resolvedWallpaper;
        const data = useDataStore.getState();
        const snapshot: OrbSnapshot = {
          style,
          todayCount: todayPomodoroCount({ tasks: data.tasks, lists: data.lists, records: data.records }, timer.state.task_id ?? undefined),
          ...(wallpaper !== lastWallpaper ? { wallpaper } : {}),
          state: timer.state,
          settings: { focus_len_min: timer.settings.focus_len_min, break_len_min: timer.settings.break_len_min, long_break_len_min: timer.settings.long_break_len_min, long_break_every: timer.settings.long_break_every },
          phaseDurationMs: timer.durationFor(phase),
          now: Date.now(),
          title: questTitle(timer.state.task_id) ?? useDataStore.getState().tasks.find(t => t.id === timer.state.task_id)?.title ?? '',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          lang: useI18nStore.getState().lang,
          settling: timer.settling,
        };
        const signature = JSON.stringify({ ...snapshot, now: Math.floor(snapshot.now / 1000) });
        if (signature !== previous) { await invoke('orb_publish', { snapshot }); previous = signature; lastWallpaper = wallpaper; }
        if (lastVisible !== ui.floatVisible || lastStyle !== style) {
          await invoke('orb_set_visible', { visible: ui.floatVisible, style }); lastVisible = ui.floatVisible; lastStyle = style;
        }
      }
    } catch (error) {
      if (!reportError) { console.warn('Desktop timer unavailable', error); reportError = true; }
    } finally { sending = false; }
  }
  const schedule = () => { queued = true; void sync(); };
  const offs = [useTimerStore.subscribe(schedule), useUiStore.subscribe(schedule), useDataStore.subscribe(schedule), useQuestStore.subscribe(schedule), useI18nStore.subscribe(schedule)];
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let offAction: (() => void) | undefined;
  void listen<OrbAction>('orb://action', event => {
    if (stopped) return;
    const timer = useTimerStore.getState();
    if (event.payload === 'toggle') {
      const screen = timer.screenOpen;
      timer.toggleRun();
      useTimerStore.getState().openScreen(screen);
    } else if (event.payload === 'open') timer.openScreen(true);
    else if (event.payload === 'hide') useUiStore.getState().setFloatVisible(false);
    schedule();
  }).then(off => { if (stopped) off(); else { offAction = off; schedule(); } });
  const handle = setInterval(schedule, 1000);
  return () => { stopped = true; clearInterval(handle); offs.forEach(off => off()); offAction?.(); observer.disconnect(); };
}
