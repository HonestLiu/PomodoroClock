// 云同步状态 —— 登录态 + 同步状态（PRD §8.6 账户云同步可扩展项）
// 所有云端调用都 try/catch 降级：同步失败绝不清空、阻塞本地数据。

import { create } from 'zustand';
import {
  currentUser, pbLogin, pbLogout, pbRefreshAuth, pbRegister, pbErrorMessage, collectionExists,
  CONFIGS, type PbUser,
} from '@/lib/pb';
import {
  applyRemote, pushConfig, pullConfig, readMeta, subscribeConfig,
  type ConfigRecord, type SyncMeta,
} from '@/lib/sync';
import { api } from '@/api';
import { useTimerStore } from '@/stores/timerStore';
import type { Settings } from '@/types';

export type AuthStatus = 'unknown' | 'signedOut' | 'signedIn';
export type SyncState = 'idle' | 'busy' | 'ok' | 'error';

interface AuthState {
  status: AuthStatus;
  user: PbUser | null;
  syncState: SyncState;
  syncMessage: string;
  lastSyncAt: number | null;
  meta: SyncMeta | null;

  /** 启动流程：校验登录态 -> 拉取云端 -> 订阅实时 */
  init(): Promise<void>;
  login(email: string, password: string): Promise<boolean>;
  register(email: string, password: string): Promise<boolean>;
  logout(): void;
  pushNow(): Promise<boolean>;
  pullNow(): Promise<boolean>;
  /** 云端来了更新（由 realtime 触发），跑裁决后应用 */
  acceptRemote(rec: ConfigRecord): Promise<void>;
  clearMessage(): void;
}

/** 本地配置发生变化时调用；已登录则防抖推送（避免每个键都打一次 HTTP） */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubRealtime: (() => void) | null = null;

/** 检查后端是否齐备；configs 集合缺失时返回引导文案（用于提示用户补配 PB） */
async function backendHint(): Promise<string> {
  try {
    const ok = await collectionExists(CONFIGS);
    if (!ok) return '云端缺少 configs 集合，配置同步暂不可用；请按指引在 PocketBase 后台创建（见说明）。';
    return '';
  } catch {
    return '云端不可用；登录与本地功能正常，配置同步暂不可用。';
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  syncState: 'idle',
  syncMessage: '',
  lastSyncAt: null,
  meta: null,

  async init() {
    try {
      const u = await pbRefreshAuth();
      if (!u) {
        set({ status: 'signedOut', user: null, meta: null });
        return;
      }
      set({ status: 'signedIn', user: u, meta: readMeta(u.id) });

      // 登录后：先拉取，再订阅实时
      await get().pullNow();
      // 后端缺集合时给出明确提示（configs 未建 -> 配置同步暂不可用）
      const hint = await backendHint();
      if (hint) set({ syncMessage: hint });
      unsubRealtime?.();
      unsubRealtime = subscribeConfig(
        (rec) => { void get().acceptRemote(rec); },
        (msg) => set({ syncState: 'error', syncMessage: msg }),
      );
    } catch {
      // 无法连接 PB / 网络异常：当未登录，本地照常工作
      set({ status: 'signedOut', user: null, syncMessage: '云端不可用，已使用本地数据' });
    }
  },

  async login(email, password) {
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const u = await pbLogin(email, password);
      set({ status: 'signedIn', user: u, meta: readMeta(u.id), syncState: 'idle' });
      await get().pullNow();
      const hint = await backendHint();
      if (hint) set({ syncMessage: hint });
      unsubRealtime?.();
      unsubRealtime = subscribeConfig(
        (rec) => { void get().acceptRemote(rec); },
        (msg) => set({ syncState: 'error', syncMessage: msg }),
      );
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async register(email, password) {
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const u = await pbRegister(email, password);
      set({ status: 'signedIn', user: u, meta: readMeta(u.id), syncState: 'idle' });
      // 注册后立刻把本地配置推上去，避免空云端覆盖本地
      await get().pushNow();
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  logout() {
    unsubRealtime?.();
    unsubRealtime = null;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    pbLogout();
    set({ status: 'signedOut', user: null, meta: null, syncState: 'idle', syncMessage: '' });
  },

  async pushNow() {
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const meta = await pushConfig();
      set({ syncState: 'ok', syncMessage: '已推送到云端', lastSyncAt: Date.now(), meta });
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async pullNow() {
    if (!get().user) return false;
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const dir = await pullConfig();
      const me = currentUser();
      const meta = me ? readMeta(me.id) : null;
      set({
        syncState: 'ok',
        meta,
        lastSyncAt: Date.now(),
        syncMessage: dir === 'pull' ? '已从云端更新' : dir === 'push' ? '云端较旧，保持本地' : '无需更新',
      });
      if (dir === 'pull') await refreshSettings();
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async acceptRemote(rec) {
    try {
      const me = currentUser();
      const direction = resolveAfterRemote(me ? readMeta(me.id) : null, rec);
      if (direction !== 'pull') return;   // 本地更新：不覆盖，稍后由防抖推送反向同步
      await applyRemote(rec);
      await refreshSettings();
      const meta = me ? readMeta(me.id) : null;
      set({ syncState: 'ok', syncMessage: '已同步云端更新', lastSyncAt: Date.now(), meta });
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
    }
  },

  clearMessage() { set({ syncMessage: '' }); },
}));

/** 收到远端记录后的裁决（复用 resolveDirection） */
function resolveAfterRemote(local: SyncMeta | null, rec: ConfigRecord): 'pull' | 'none' {
  const remote: SyncMeta = { rev: rec.rev ?? 0, updated: rec.updated ?? '', device: rec.device ?? '' };
  // 本地 meta 缺失时，若远端有内容就拉取
  if (!local) return 'pull';
  if (remote.rev > local.rev) return 'pull';
  if (remote.rev === local.rev && remote.updated !== local.updated) return 'none';
  return 'none';
}

/** 云端拉取后刷新本地 settings 到各 store（timer / data） */
async function refreshSettings(): Promise<void> {
  try {
    const settings: Settings = await api.get_settings();
    // 让 timerStore / 报表 / 主题即时反映新配置
    useTimerStore.getState().setSettings(settings);
    // goals 表与 settings.daily_target_min 保持一致（报表日历口径依赖 goals）
    await api.set_goal(settings.daily_target_min).catch(() => undefined);
  } catch { /* 刷新失败不影响已落地的数据 */ }
}

/** 本地 settings 变化 -> 防抖推送（需已登录） */
export function scheduleSyncPush(): void {
  const { status, syncState } = useAuthStore.getState();
  if (status !== 'signedIn') return;
  if (syncState === 'busy') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void useAuthStore.getState().pushNow();
  }, 1200);
}
