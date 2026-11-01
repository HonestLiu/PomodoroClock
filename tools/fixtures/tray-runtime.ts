// 仅用于托盘回归的隔离运行时；不读取用户数据库、不播放音频、不创建原生窗口。
import { create } from 'zustand';
import { DEFAULT_SETTINGS, type FocusRecord, type TimerState } from '../../src/types';
import { on, emit } from '../../src/api/events';
import { trayZh, trayEn } from '../../src/i18n/tray';
export { on, emit };
export const fixture = {
  native: false, records: [] as FocusRecord[], settings: { ...DEFAULT_SETTINGS },
  blockRecord: null as Promise<void> | null, failRecord: false, failMenu: false,
  menus: [] as Array<{ snapshot: any; force: boolean }>,
  widgetLaunch: false, widgetResponse: null as Promise<void> | null,
};
let id = 0;
export const api = {
  take_widget_launch: async () => {
    const launch = fixture.widgetLaunch; fixture.widgetLaunch = false;
    if (fixture.widgetResponse) await fixture.widgetResponse;
    return launch;
  },
  get_user: async () => ({ id: 'user', username: 'Test' }),
  list_folders: async () => [], list_lists: async () => [], list_tasks: async () => [], list_notifications: async () => [],
  list_focus_records: async () => [...fixture.records],
  get_settings: async () => ({ ...fixture.settings }),
  set_setting: async (key: string, value: string) => { fixture.settings = { ...fixture.settings, [key]: value }; return { ...fixture.settings }; },
  set_timer_state: async (state: TimerState) => ({ ...state }),
  create_focus_record: async (args: any) => {
    if (fixture.blockRecord) await fixture.blockRecord;
    if (fixture.failRecord) throw new Error('write failed');
    const record = { id: `record-${++id}`, task_id: args.taskId ?? null, list_id: null, start_at: args.startAt,
      end_at: args.endAt, duration_min: args.durationMin, phase: 'focus', created_at: Date.now() };
    fixture.records.push(record); return record;
  },
  create_notification: async () => ({}),
  update_tray_menu: async (snapshot: any, force = false) => {
    if (fixture.failMenu) throw new Error('menu unavailable');
    fixture.menus.push({ snapshot, force });
  },
};
export const isTauri = () => fixture.native;
export const subscribe = on;
export const primeBell = () => {};
export const playBell = () => {};
export const ensureSystemPermission = async () => false;
export const systemNotify = () => {};
export const useNoiseStore = create<{ playing: boolean; setPlaying(value: boolean): void }>(set => ({
  playing: false, setPlaying: playing => set({ playing }),
}));
export const useI18nStore = create<{ lang: 'zh' | 'en'; setLang(lang: 'zh' | 'en'): void }>(set => ({ lang: 'zh', setLang: lang => set({ lang }) }));
export const tStatic = (key: string, vars?: Record<string, string | number>): string => {
  const dict = (useI18nStore.getState().lang === 'zh' ? trayZh : trayEn) as Record<string, string>;
  return (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
};
