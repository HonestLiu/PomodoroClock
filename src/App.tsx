// 应用外壳 —— 组装全局框架（PRD §4）与页面路由（PRD §2.3）

import { useEffect, useState } from 'react';
import { TitleBar } from '@/components/TitleBar';
import { Sidebar } from '@/components/Sidebar';
import { FloatWindow } from '@/components/FloatWindow';
import { NotificationPanel } from '@/components/NotificationPanel';
import { SearchOverlay } from '@/components/SearchOverlay';
import { TaskView } from '@/pages/TaskView';
import { CompletedView } from '@/pages/CompletedView';
import { ReportModal } from '@/modals/ReportModal';
import { SettingsModal } from '@/modals/SettingsModal';
import { TimerScreen } from '@/modals/TimerScreen';
import { TaskEditModal } from '@/modals/TaskEditModal';
import { PlaceholderModal } from '@/modals/PlaceholderModal';
import { ConfirmDialog, type ConfirmSpec } from '@/modals/ConfirmDialog';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore, scheduleSyncPush } from '@/stores/authStore';
import { api, on, isTauri } from '@/api';
import { useI18nStore } from '@/i18n';

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
      await refreshStats();
      await initTimer();
      // 应用已存语言（settings.language）
      useI18nStore.getState().setLang(useTimerStore.getState().settings.language as 'zh' | 'en');
      setBooted(true);
      // 云同步：不阻塞启动（PB 不可达时静默降级，本地照常可用）
      void useAuthStore.getState().init();
    })();
  }, [bootstrap, refreshStats, initTimer]);

  // 主题应用（PRD FR-S3 通用设置）
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 本地配置变化 -> 防抖推送云端（已登录才推；失败静默降级）
  const settingsSig = JSON.stringify(settings);
  useEffect(() => {
    if (!booted) return;   // 启动期的 settings 初始化不触发推送
    scheduleSyncPush();
  }, [settingsSig, booted]);

  // 菜单栏托盘菜单事件（PRD §5.4 FR-P3）
  useEffect(() => {
    if (!isTauri()) return;
    const unsub = on('tray://menu', (action) => {
      switch (action) {
        case 'tray-toggle': useTimerStore.getState().toggleRun(); break;
        case 'tray-skip': useTimerStore.getState().skip(); break;
        case 'tray-report': useUiStore.getState().openReport(true); break;
        case 'tray-settings': useUiStore.getState().openSettings(); break;
      }
    });
    return () => { unsub?.(); };
  }, []);

  // 更新托盘「开始/暂停」菜单项文字
  useEffect(() => {
    if (!isTauri()) return;
    const updateToggle = () => {
      const s = useTimerStore.getState();
      const text = s.state.phase === 'break'
        ? (s.state.running ? '暂停' : '开始休息')
        : s.state.phase === 'focus'
          ? (s.state.running ? '暂停' : '继续专注')
          : '开始专注';
      void api.update_tray_toggle(text);
    };
    updateToggle();
    const unsub = on('timer://state-changed', updateToggle);
    return () => { unsub?.(); };
  }, []);

  // 全局快捷键：空格开始/暂停（PRD §9 可访问性）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
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
          正在加载…
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
          {route.name === 'completed' ? <CompletedView /> : <TaskView />}
        </main>
      </div>

      <FloatWindow />
      <NotificationPanel />
      <SearchOverlay />

      <ReportModal />
      <SettingsModal onConfirm={setConfirm} />
      <TaskEditModal onConfirm={setConfirm} />
      <PlaceholderModal />
      <TimerScreen />

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
      {globalConfirm && <ConfirmDialog spec={globalConfirm} onClose={clearConfirm} />}
    </div>
  );
}
