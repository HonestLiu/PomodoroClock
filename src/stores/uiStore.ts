// UI 状态：页面路由（PRD §2.3 路由表）、模态层、悬浮窗、主题。
// 说明：PRD §8.1 指定 react-router-dom v6（内存路由）。当前离线构建中该依赖不可得，
// 因此以等价的内存路由状态实现同一路由表语义（见 README「与 PRD 的差异」）。

import { create } from 'zustand';
import type { SmartKey } from '@/types';

export type Route =
  | { name: SmartKey }
  | { name: 'list'; id: string }
  | { name: 'calendar' };

export type SettingsTab = 'account' | 'premium' | 'general' | 'pomodoro' | 'lists' | 'appearance' | 'about';

/** 全局二次确认请求（由 App 消费，渲染 ConfirmDialog） */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm(): void | Promise<void>;
}

interface UiState {
  route: Route;
  reportOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  searchOpen: boolean;
  notifOpen: boolean;
  premiumOpen: boolean;
  friendsOpen: boolean;
  achievementsOpen: boolean;
  /** 白噪音选择弹窗（计时页工具条与设置页共用） */
  noiseOpen: boolean;
  /** 新建清单夹弹窗 */
  folderCreateOpen: boolean;
  /** 新建清单弹窗 */
  listCreateOpen: boolean;
  /** 侧边栏右键菜单（编辑/删除） */
  contextMenu: { x: number; y: number; kind: 'folder' | 'list'; id: string } | null;
  /** 编辑态：打开新建弹窗时带上要编辑的 id（null=新建） */
  listEditId: string | null;
  folderEditId: string | null;
  floatVisible: boolean;
  editingTaskId: string | null;
  showCompleted: Record<string, boolean>;
  /** 搜索定位后的待高亮任务（消费一次后清除，search.md ★1） */
  highlight: string | null;
  /** 拖拽中的任务 id（tasks.md ★2，跨视图/移至清单） */
  draggingTaskId: string | null;

  navigate(route: Route): void;
  openReport(v?: boolean): void;
  openSettings(tab?: SettingsTab): void;
  setSettingsTab(tab: SettingsTab): void;
  openSearch(v: boolean): void;
  openNotif(v: boolean): void;
  openPremium(v: boolean): void;
  openFriends(v: boolean): void;
  openAchievements(v: boolean): void;
  openNoise(v: boolean): void;
  openFolderCreate(v: boolean): void;
  openListCreate(v: boolean): void;
  openFolderEdit(id: string): void;
  openListEdit(id: string): void;
  openContextMenu(m: { x: number; y: number; kind: 'folder' | 'list'; id: string }): void;
  closeContextMenu(): void;
  setFloatVisible(v: boolean): void;
  setEditingTask(id: string | null): void;
  toggleShowCompleted(key: string): void;
  closeAllOverlays(): void;

  confirm: ConfirmRequest | null;
  askConfirm(req: ConfirmRequest): void;
  clearConfirm(): void;

  triggerHighlight(taskId: string): void;
  clearHighlight(): void;

  setDraggingTask(id: string | null): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  route: { name: 'tasks' },
  reportOpen: false,
  settingsOpen: false,
  settingsTab: 'account',
  searchOpen: false,
  notifOpen: false,
  premiumOpen: false,
  friendsOpen: false,
  achievementsOpen: false,
  noiseOpen: false,
  folderCreateOpen: false,
  listCreateOpen: false,
  contextMenu: null,
  listEditId: null,
  folderEditId: null,
  floatVisible: true,
  editingTaskId: null,
  showCompleted: {},
  confirm: null,
  highlight: null,
  draggingTaskId: null,

  navigate: (route) => set({ route, searchOpen: false }),
  openReport: (v = true) => set({ reportOpen: v }),
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  openSearch: (v) => set({ searchOpen: v }),
  openNotif: (v) => set({ notifOpen: v, premiumOpen: false, friendsOpen: false, achievementsOpen: false }),
  openPremium: (v) => set({ premiumOpen: v, notifOpen: false, friendsOpen: false, achievementsOpen: false }),
  openFriends: (v) => set({ friendsOpen: v, notifOpen: false, premiumOpen: false, achievementsOpen: false }),
  openAchievements: (v) => set({ achievementsOpen: v, notifOpen: false, premiumOpen: false, friendsOpen: false }),
  openNoise: (v) => set({ noiseOpen: v, notifOpen: false, premiumOpen: false, friendsOpen: false, achievementsOpen: false }),
  openFolderCreate: (v) => set({ folderCreateOpen: v, folderEditId: null }),
  openListCreate: (v) => set({ listCreateOpen: v, listEditId: null }),
  openFolderEdit: (id) => set({ folderCreateOpen: true, folderEditId: id, contextMenu: null }),
  openListEdit: (id) => set({ listCreateOpen: true, listEditId: id, contextMenu: null }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  setFloatVisible: (floatVisible) => set({ floatVisible }),
  setEditingTask: (editingTaskId) => set({ editingTaskId }),
  toggleShowCompleted: (key) =>
    set((s) => ({ showCompleted: { ...s.showCompleted, [key]: !s.showCompleted[key] } })),
  closeAllOverlays: () =>
    set({ reportOpen: false, settingsOpen: false, searchOpen: false, notifOpen: false, premiumOpen: false, friendsOpen: false, achievementsOpen: false, noiseOpen: false, folderCreateOpen: false, listCreateOpen: false, contextMenu: null, listEditId: null, folderEditId: null }),
  askConfirm: (confirm) => set({ confirm }),
  clearConfirm: () => set({ confirm: null }),
  triggerHighlight: (highlight) => set({ highlight }),
  clearHighlight: () => set({ highlight: null }),
  setDraggingTask: (draggingTaskId) => set({ draggingTaskId }),
}));
