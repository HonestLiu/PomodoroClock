// PocketBase 客户端 + 账号（PRD §8.6「账户云同步为可扩展项」）
// 本地数据仍是断网时的真相来源；PB 仅作为云端对齐层，任何失败都静默降级（§8.8-5）。

import PocketBase, { LocalAuthStore } from 'pocketbase';

/** 云端地址：优先读 VITE_PB_URL，回退到内置默认（离线开发也能连上已部署实例） */
export const PB_URL: string =
  (import.meta.env.VITE_PB_URL as string | undefined)?.trim() ||
  'http://62.234.82.11:28193';

export const USERS = 'users';
export const CONFIGS = 'configs';

/** LocalAuthStore 把 token + 用户记录持久化到 localStorage，刷新/重启后仍保持登录 */
export const pb = new PocketBase(PB_URL, new LocalAuthStore());

// React 里同一请求被误判为重复会中断，关掉以避免抖动误判
pb.autoCancellation(false);

export type PbUser = {
  id: string;
  email?: string;
  name?: string;
  verified?: boolean;
  [key: string]: unknown;
};

/** 当前登录用户；未登录或 token 过期返回 null */
export function currentUser(): PbUser | null {
  if (!pb.authStore.isValid) return null;
  return (pb.authStore.record ?? null) as PbUser | null;
}

export async function pbRegister(email: string, password: string): Promise<PbUser> {
  await pb.collection(USERS).create({ email, password, passwordConfirm: password });
  // 需要邮箱验证时才发信；后端没开验证也不会报错
  await pb.collection(USERS).requestVerification(email).catch(() => undefined);
  const { record } = await pb.collection(USERS).authWithPassword(email, password);
  return record as unknown as PbUser;
}

export async function pbLogin(email: string, password: string): Promise<PbUser> {
  const { record } = await pb.collection(USERS).authWithPassword(email, password);
  return record as unknown as PbUser;
}

export function pbLogout(): void {
  pb.authStore.clear();
}

/**
 * 更新 PB 账号资料（email / password / name）。
 * email 改动 PB 可能触发确认邮件；password 必须同时带 passwordConfirm。
 */
export async function pbUpdateProfile(patch: {
  email?: string;
  password?: string;
  passwordConfirm?: string;
  name?: string;
}): Promise<PbUser> {
  const me = currentUser();
  if (!me) throw new Error('尚未登录');
  await pb.collection(USERS).update(me.id, patch);
  // 更新后刷新 authStore 里的记录，保证显示的 email 是最新值
  await pb.collection(USERS).authRefresh().catch(() => undefined);
  return pb.authStore.record as unknown as PbUser;
}

/** 启动时校验登录态；token 过期则清理并返回 null */
export async function pbRefreshAuth(): Promise<PbUser | null> {
  if (!pb.authStore.isValid) return null;
  try {
    const { record } = await pb.collection(USERS).authRefresh();
    return record as unknown as PbUser;
  } catch {
    pb.authStore.clear();
    return null;
  }
}

/** 把 SDK 抛出的错误压成可读文案；网络/服务端错误都不应冒泡阻塞本地功能 */
export function pbErrorMessage(e: unknown): string {
  if (!e) return '未知错误';
  if (typeof e === 'object' && e !== null && 'response' in e) {
    const r = (e as { response?: { message?: string; data?: Record<string, unknown> } }).response;
    if (r?.message) return r.message;
    if (r?.data) return JSON.stringify(r.data);
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 检查某个集合是否已在服务端创建（用于提示用户补齐后端配置） */
export async function collectionExists(name: string): Promise<boolean> {
  try {
    await pb.collection(name).getFullList({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}
