// 云同步状态 —— 登录态 + 同步状态（PRD §8.6 账户云同步可扩展项）
// 所有云端调用都 try/catch 降级：同步失败绝不清空、阻塞本地数据。

import { create } from 'zustand';
import {
  pb, currentUser, pbLogin, pbLogout, pbRefreshAuth, pbRegister, pbErrorMessage, collectionExists,
  pbUpdateProfile, pbRequestPasswordReset, pbUploadAvatar, pbDeleteAvatar, pbUpdateName, CONFIGS, type PbUser,
} from '@/lib/pb';
import {
  applyRemote, pushConfig, pullConfig, readMeta, resolveDirection, subscribeConfig,
  type ConfigRecord, type SyncMeta,
} from '@/lib/sync';
import { api } from '@/api';
import { SYNC_COLLECTIONS, startDataSync, stopDataSync, syncDataNow } from '@/lib/syncData';
import { useTimerStore } from '@/stores/timerStore';
import type { Settings } from '@/types';
import { tStatic } from '@/i18n';

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
  register(email: string, password: string, name?: string): Promise<boolean>;
  logout(): void;
  pushNow(): Promise<boolean>;
  pullNow(): Promise<boolean>;
  /** 云端来了更新（由 realtime 触发），跑裁决后应用 */
  acceptRemote(rec: ConfigRecord): Promise<void>;
  /** 改密码（已登录）：必须带当前密码（PB users 集合强制 oldPassword） */
  changePassword(oldPassword: string, newPassword: string): Promise<boolean>;
  /** 上传头像：先做客户端类型/大小校验，失败只落在 syncMessage，不抛给 UI */
  uploadAvatar(file: File): Promise<boolean>;
  /** 移除头像（PB 侧把 avatar 置空字符串） */
  removeAvatar(): Promise<boolean>;
  /** 改昵称：trim 后超过 32 字符直接拒绝（服务端上限 255，客户端刻意更严） */
  updateNickname(name: string): Promise<boolean>;
  /** 发重置密码邮件（未登录可用） */
  sendResetEmail(email: string): Promise<boolean>;
  clearMessage(): void;
}

/** 本地配置发生变化时调用；已登录则防抖推送（避免每个键都打一次 HTTP） */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubRealtime: (() => void) | null = null;

/** 检查后端是否齐备；configs 集合缺失时返回引导文案（用于提示用户补配 PB） */
async function backendHint(): Promise<string> {
  try {
    if (!(await collectionExists(CONFIGS))) return tStatic('sync.missingCollection');
    // 数据同步集合（任务/清单/专注记录）由 scripts/pb-sync-setup.mjs 创建
    for (const name of Object.values(SYNC_COLLECTIONS)) {
      if (!(await collectionExists(name))) return tStatic('sync.missingSyncCollections');
    }
    // 集合是旧版脚本建的 → 没有 created/updated 系统字段，sort=updated 会 400
    try {
      await pb.collection(SYNC_COLLECTIONS.tasks).getList(1, 1, { sort: 'updated', requestKey: null });
    } catch {
      return tStatic('sync.staleSyncCollections');
    }
    return '';
  } catch {
    return tStatic('sync.backendDown');
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
      // 任务/清单/专注记录的多端同步（配置之外的数据）
      startDataSync(u.id);
    } catch {
      // 无法连接 PB / 网络异常：当未登录，本地照常工作
      set({ status: 'signedOut', user: null, syncMessage: tStatic('sync.unavailable') });
    }
  },

  async login(email, password) {
    const invalid = validateCredentials(email, password);
    if (invalid) {
      set({ syncState: 'error', syncMessage: invalid });
      return false;
    }
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
      // 登录成功即把任务/清单/专注记录也接上云端
      startDataSync(u.id);
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async register(email, password, name) {
    const invalid = validateCredentials(email, password);
    if (invalid) {
      set({ syncState: 'error', syncMessage: invalid });
      return false;
    }
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const u = await pbRegister(email, password, name);
      set({ status: 'signedIn', user: u, meta: readMeta(u.id), syncState: 'idle' });
      // 注册后立刻把本地配置推上去，避免空云端覆盖本地
      await get().pushNow();
      startDataSync(u.id);
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  logout() {
    stopDataSync();
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
      set({ syncState: 'ok', syncMessage: tStatic('sync.pushed'), lastSyncAt: Date.now(), meta });
      void syncDataNow();
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async pullNow() {
    if (!get().user) return false;
    set({ syncState: 'busy', syncMessage: '' });
    void syncDataNow();
    try {
      const dir = await pullConfig();
      const me = currentUser();
      const meta = me ? readMeta(me.id) : null;
      set({
        syncState: 'ok',
        meta,
        lastSyncAt: Date.now(),
        syncMessage: dir === 'pull' ? tStatic('sync.pulled')
          : dir === 'push' ? tStatic('sync.keepLocal') : tStatic('sync.none'),
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
      set({ syncState: 'ok', syncMessage: tStatic('sync.applied'), lastSyncAt: Date.now(), meta });
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
    }
  },

  clearMessage() { set({ syncMessage: '' }); },

  async changePassword(oldPassword, newPassword) {
    if (newPassword.length < 8) {
      set({ syncState: 'error', syncMessage: tStatic('err.pwdShort') });
      return false;
    }
    if (!oldPassword) {
      set({ syncState: 'error', syncMessage: tStatic('err.oldPwdRequired') });
      return false;
    }
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const u = await pbUpdateProfile({ oldPassword, password: newPassword, passwordConfirm: newPassword });
      // PB 在改密码后立刻作废该用户的所有既有 token（实测改完用旧 token auth-refresh 返回 401）。
      // 所以必须当场用新密码换一枚新 token，否则刷新/重启就会被当成掉线。
      const email = (u.email ?? currentUser()?.email ?? '').trim();
      try {
        const fresh = await pbLogin(email, newPassword);
        set({ user: fresh, status: 'signedIn', syncState: 'ok', syncMessage: tStatic('sync.pwdChanged') });
      } catch {
        // 换 token 失败不要谎报成功：清会话让用户用新密码重新登录
        get().logout();
        set({ syncState: 'ok', syncMessage: tStatic('sync.pwdChangedRelogin') });
      }
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async uploadAvatar(file) {
    if (!get().user) return false;
    if (!AVATAR_TYPES.includes(file.type)) {
      set({ syncState: 'error', syncMessage: tStatic('err.avatarType') });
      return false;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      set({ syncState: 'error', syncMessage: tStatic('err.avatarTooLarge') });
      return false;
    }
    set({ syncState: 'busy', syncMessage: tStatic('account.avatarUploading') });
    try {
      const u = await pbUploadAvatar(file);
      set({ user: u, syncState: 'ok', syncMessage: tStatic('account.avatarUpdated') });
      return true;
    } catch {
      // 后端细节（网络/文件类型/上限）不暴露给用户，只给可操作的提示
      set({ syncState: 'error', syncMessage: tStatic('err.avatarFailed') });
      return false;
    }
  },

  async removeAvatar() {
    if (!get().user) return false;
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const u = await pbDeleteAvatar();
      set({ user: u, syncState: 'ok', syncMessage: tStatic('account.avatarRemoved') });
      return true;
    } catch {
      set({ syncState: 'error', syncMessage: tStatic('err.avatarFailed') });
      return false;
    }
  },

  async updateNickname(name) {
    const nickname = name.trim();
    if ([...nickname].length > NICKNAME_MAX_CHARS) {
      set({ syncState: 'error', syncMessage: tStatic('err.nicknameTooLong') });
      return false;
    }
    if (!get().user) return false;
    set({ syncState: 'busy', syncMessage: '' });
    try {
      const u = await pbUpdateName(nickname);
      set({ user: u, syncState: 'ok', syncMessage: tStatic('account.profileSaved') });
      return true;
    } catch (e) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(e) });
      return false;
    }
  },

  async sendResetEmail(email) {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
      set({ syncState: 'error', syncMessage: tStatic('err.email') });
      return false;
    }
    set({ syncState: 'busy', syncMessage: '' });
    try {
      await pbRequestPasswordReset(e);
      set({ syncState: 'ok', syncMessage: tStatic('sync.resetSent') });
      return true;
    } catch (err) {
      set({ syncState: 'error', syncMessage: pbErrorMessage(err) });
      return false;
    }
  },
}));

/** 昵称：客户端上限 32 字符（按码点计，emoji 不被算成 2 个）；服务端 users.name 上限 255 */
const NICKNAME_MAX_CHARS = 32;

/** 头像：只允许 JPG/PNG，客户端先卡 2 MB（服务端 PB 默认上限另算，见文档） */
const AVATAR_TYPES = ['image/png', 'image/jpeg'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** 提交前先做本地校验，避免把必然失败的请求打到云端（PB 默认密码最短 8 位） */
function validateCredentials(email: string, password: string): string | null {
  const e = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return tStatic('err.email');
  if (password.length < 8) return tStatic('err.pwdShort');
  return null;
}

/** 收到远端记录后的裁决：与拉取共用同一套三步裁决，避免实时与轮询结论不一致 */
function resolveAfterRemote(local: SyncMeta | null, rec: ConfigRecord): 'pull' | 'none' {
  const remote: SyncMeta = { rev: rec.rev ?? 0, updated: rec.updated ?? '', device: rec.device ?? '' };
  return resolveDirection(local, remote) === 'pull' ? 'pull' : 'none';
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
