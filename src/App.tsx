// 应用外壳 —— 组装全局框架（PRD §4）与页面路由（PRD §2.3）

import { useEffect, useLayoutEffect, useState } from 'react';
import { TitleBar } from '@/components/TitleBar';
import { Sidebar } from '@/components/Sidebar';
import { SidebarContextMenu } from '@/components/SidebarContextMenu';
import { FloatWindow } from '@/components/FloatWindow';
import { NotificationPanel } from '@/components/NotificationPanel';
import { SearchOverlay } from '@/components/SearchOverlay';
import { TaskView } from '@/pages/TaskView';
import { RecordsView } from '@/pages/RecordsView';
import { DoneView } from '@/pages/DoneView';
import { CalendarPage } from '@/pages/calendar/CalendarPage';
import { CountdownPage } from '@/pages/CountdownPage';
import { AiPage } from '@/pages/AiPage';
import { ReportModal } from '@/modals/ReportModal';
import { SettingsModal } from '@/modals/SettingsModal';
import { TimerScreen } from '@/modals/TimerScreen';
import { NoisePicker } from '@/components/NoisePicker';
import { AiDrawer } from '@/components/AiDrawer';
import { TaskEditModal } from '@/modals/TaskEditModal';
import { PlaceholderModal } from '@/modals/PlaceholderModal';
import { GrowthModal } from '@/modals/GrowthModal';
import { PaymentModal } from '@/modals/PaymentModal';
import { CreateFolderModal } from '@/modals/CreateFolderModal';
import { CreateListModal } from '@/modals/CreateListModal';
import { ConfirmDialog, type ConfirmSpec } from '@/modals/ConfirmDialog';
import { useDataStore } from '@/stores/dataStore';
import { useCountdownStore } from '@/stores/countdownStore';
import { useGrowthStore } from '@/stores/growthStore';
import { useStatsStore } from '@/stores/statsStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { useNoiseStore } from '@/stores/noiseStore';
import { useAuthStore, scheduleSyncPush } from '@/stores/authStore';
import type { NoiseKind } from '@/lib/noise';
import { api, subscribe } from '@/api';
import { useI18nStore, tStatic } from '@/i18n';
import { scanTaskReminders, defaultRemindDeps } from '@/lib/remindScan';
import { scanCountdownReminders, defaultCountdownRemindDeps } from '@/lib/countdownRemind';
import { syncPBServer } from '@/lib/pb';
import { syncAutoStart } from '@/lib/autostart';
import { installTrayController } from '@/lib/trayController';
import { installWidgetController } from '@/lib/widgetController';
import { installTheme } from '@/lib/theme';

export default function App() {
  const [booted, setBooted] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const route = useUiStore((s) => s.route);
  const globalConfirm = useUiStore((s) => s.confirm);
  const clearConfirm = useUiStore((s) => s.clearConfirm);
  const theme = useTimerStore((s) => s.settings.theme);
  const settings = useTimerStore((s) => s.settings);

  const bootstrap = useDataStore((s) => s.bootstrap);
  const refreshStats = useStatsStore((s) => s.refresh);
  const initTimer = useTimerStore((s) => s.init);

  useEffect(() => {
    (async () => {
      await api.get_user();      // 确保本地库初始化（首次运行写入 §6.3 数据）
      await bootstrap();
      void useCountdownStore.getState().bootstrap(); // 倒数纪念日（独立域）
      await refreshStats();
      // 先加载设置（含启动页），再决定是否展开专注界面
      await initTimer({ openScreen: false });
      // 数据库里的同步服务器地址（settings.pb_url）优先于编译期 env/默认，启动即校正 pb 客户端
      syncPBServer(useTimerStore.getState().settings);
      // 开机自启对齐：以库内设置转为真相源，仅在系统状态不一致时改写（Tauri 下真实生效）
      void syncAutoStart(useTimerStore.getState().settings.autostart);
      const startup = useTimerStore.getState().settings.startup_page;
      // 启动页：'timer' 展开番茄钟专注界面；其余跳到对应侧边栏页面（且不覆盖该页面）
      const onTimer = startup === 'timer';
      // 白噪音音色/音量回填（不触发播放；真正播放要等用户手势）
      const bootSettings = useTimerStore.getState().settings;
      useNoiseStore.getState().hydrate(bootSettings.noise as NoiseKind, bootSettings.noise_volume);
      // 应用已存语言（settings.language）
      useI18nStore.getState().setLang(useTimerStore.getState().settings.language as 'zh' | 'en');
      if (onTimer) {
        // 待确认付款优先恢复，避免启动专注层抢走支付面板的焦点。
        if (!useGrowthStore.getState().data?.paymentOrders.some(o => o.status === 'pending')) useTimerStore.getState().openScreen(true);
      }
      else if (startup === 'calendar') useUiStore.getState().navigate({ name: 'calendar' });
      else if (startup === 'countdown') useUiStore.getState().navigate({ name: 'countdown' });
      else if (startup === 'ai') useUiStore.getState().navigate({ name: 'ai' });
      else if (startup) useUiStore.getState().navigate({ name: startup });
      setBooted(true);
      // 云同步：不阻塞启动（PB 不可达时静默降级，本地照常可用）
      void useAuthStore.getState().init();
    })();
  }, [bootstrap, refreshStats, initTimer]);

  // 主题应用（PRD FR-S3 通用设置）
  useLayoutEffect(() => {
    if (!booted) return;
    return installTheme(theme);
  }, [theme, booted]);

  // 到时提醒巡检（提醒事项字段：时间 + 提前提醒）。每 30s 扫一遍 + 启动即扫。
  // 读 getState()，不依赖 tasks/settings 变化，避免任务刷新时重建计时器。
  useEffect(() => {
    if (!booted) return;
    const run = () => {
      void scanTaskReminders(
        useDataStore.getState().tasks,
        useTimerStore.getState().settings,
        defaultRemindDeps(),
      );
      // 倒数纪念日提醒（独立域，复用同一 30s 巡检）
      void scanCountdownReminders(
        useCountdownStore.getState().items,
        useTimerStore.getState().settings,
        defaultCountdownRemindDeps(),
      );
    };
    run();
    const handle = setInterval(run, 30_000);
    return () => clearInterval(handle);
  }, [booted]);

  // 本地配置变化 -> 防抖推送云端（已登录才推；失败静默降级）
  const settingsSig = JSON.stringify(settings);
  useEffect(() => {
    if (!booted) return;   // 启动期的 settings 初始化不触发推送
    scheduleSyncPush();
  }, [settingsSig, booted]);

  // 同步服务器地址变了（设置里改 / 脚本改了 DB 值重启）-> 校正 pb 客户端并重连云端会话。
  // reconnectIfServerChanged 只在 baseUrl 实际变化时才动手，其余 settings 改动不受影响。
  const pbServerUrl = settings.pb_url;
  useEffect(() => {
    if (!booted) return;
    syncPBServer(useTimerStore.getState().settings);
    void useAuthStore.getState().reconnectIfServerChanged();
  }, [pbServerUrl, booted]);

  // 切换语言后清掉残留的同步提示：syncMessage 存的是「已渲染好的文案」，
  // 不清掉会出现「英文界面挂着中文提示」的怪现象（提示本身是瞬时状态，清掉无害）。
  const lang = useI18nStore((s) => s.lang);
  useEffect(() => {
    useAuthStore.getState().clearMessage();
  }, [lang]);

  // 云端昵称为空时，用本地昵称兜底写入一次（老用户迁移：把应用内既有昵称同步到 PocketBase）。
  // 每个账号只尝试一次（localStorage 记住），避免用户主动清空昵称后又被回填。
  const authStatus = useAuthStore((s) => s.status);
  const cloudUser = useAuthStore((s) => s.user);
  const localUserName = useDataStore((s) => s.user?.username ?? '');
  useEffect(() => {
    if (authStatus !== 'signedIn' || !cloudUser) return;
    if (cloudUser.name && cloudUser.name.trim()) return;   // 云端已有昵称，以云端为准
    const fallback = localUserName.trim();
    if (!fallback) return;
    const key = `nickname_backfill:${cloudUser.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    void (async () => {
      const ok = await useAuthStore.getState().updateNickname(fallback);
      if (ok) useAuthStore.getState().clearMessage();   // 迁移不打扰用户，不显示「资料已更新」
    })();
  }, [authStatus, cloudUser, localUserName]);

  // 原生托盘：后台计时控制、任务快捷启动与动态菜单状态。
  useEffect(() => {
    if (!booted) return;
    const offTray = installTrayController();
    const offWidgets = installWidgetController();
    return () => { offTray(); offWidgets(); };
  }, [booted]);

  // 应用菜单栏命令（menu://command；含 macOS Cmd+, 打开设置）
  useEffect(() => {
    const unsub = subscribe('menu://command', (cmd) => {
      const ui = useUiStore.getState();
      switch (cmd) {
        case 'menu-settings': ui.openSettings(); break;
        case 'menu-report': ui.openReport(true); break;
        case 'menu-new-list': ui.openListCreate(true); break;
        case 'menu-new-folder': ui.openFolderCreate(true); break;
        case 'menu-new-task': {
          ui.navigate({ name: 'tasks' });
          // 渲染后聚焦「添加任务」输入框
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              document.querySelector<HTMLInputElement>('.add-task input')?.focus();
            });
          });
          break;
        }
      }
    });
    return () => unsub?.();
  }, []);

  // 全局快捷键：空格开始/暂停（PRD §9 可访问性）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;        // 长按空格不重复 start/pause，否则会疯狂翻转
      if (e.isComposing) return;   // 输入法组合中（中文候选词）不抢按键
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      // 表单控件 / 按钮 / 链接 / 可编辑区自己消费空格与「/」：抢过来会让
      // 聚焦按钮的 Space 变成"切换计时"而不是激活按钮（PRD §9 键盘可达）。
      if (el && (el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || tag === 'BUTTON' || tag === 'A' || tag === 'OPTION')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        useTimerStore.getState().toggleRun();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUiStore.getState().openSearch(!useUiStore.getState().searchOpen);
      } else if (e.key === '/' && useUiStore.getState().searchOpen === false) {
        e.preventDefault();
        useUiStore.getState().openSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!booted) {
    return (
      <div className="app">
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-2)' }}>
          {tStatic('app.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="shell">
        <Sidebar />
        <main className="main">
          {/* 日历组件（7 视图，侧边栏入口）；记录=专注归档；已完成=任务归档；其余（含清单视图）走任务视图 */}
          {route.name === 'calendar' ? <CalendarPage />
            : route.name === 'records' ? <RecordsView />
            : route.name === 'completed' ? <DoneView />
              : route.name === 'countdown' ? <CountdownPage />
                : route.name === 'ai' ? <AiPage />
                  : <TaskView />}
        </main>
      </div>

      <FloatWindow />
      <AiDrawer />
      <NotificationPanel />
      <SearchOverlay />

      <ReportModal />
      <SettingsModal onConfirm={setConfirm} />
      <TaskEditModal onConfirm={setConfirm} />
      <PlaceholderModal />
      <GrowthModal />
      <CreateFolderModal />
      <CreateListModal />
      <SidebarContextMenu />
      <TimerScreen />
      <NoisePicker />

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
      {globalConfirm && <ConfirmDialog spec={globalConfirm} onClose={clearConfirm} />}
      <PaymentModal />
    </div>
  );
}
