// PocketBase 客户端 + 账号（PRD §8.6「账户云同步为可扩展项」）
// 本地数据仍是断网时的真相来源；PB 仅作为云端对齐层，任何失败都静默降级（§8.8-5）。

import PocketBase, { LocalAuthStore } from 'pocketbase';
import { tStatic } from '@/i18n';

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

export async function pbRegister(email: string, password: string, name?: string): Promise<PbUser> {
  // 昵称可选：只有非空才带 name，避免给没填昵称的新用户写空字符串
  const nickname = (name ?? '').trim();
  await pb.collection(USERS).create({
    email,
    password,
    passwordConfirm: password,
    ...(nickname ? { name: nickname } : {}),
  });
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
 * email 改动 PB 可能触发确认邮件；
 * 改密码必须同时带 oldPassword + passwordConfirm（PB 的 users 集合强制要求当前密码，实测缺 oldPassword 返回 400）。
 */
export async function pbUpdateProfile(patch: {
  email?: string;
  password?: string;
  passwordConfirm?: string;
  oldPassword?: string;
  name?: string;
}): Promise<PbUser> {
  const me = currentUser();
  if (!me) throw new Error(tStatic('err.notSignedIn'));
  await pb.collection(USERS).update(me.id, patch);
  // 更新后刷新 authStore 里的记录，保证显示的 email 是最新值。
  // 注意：改密码会让 PB 作废该用户所有既有 token（实测 auth-refresh 返回 401），
  // 所以这里失败是预期的，调用方必须在改密码后用新密码重新 authWithPassword。
  await pb.collection(USERS).authRefresh().catch(() => undefined);
  return pb.authStore.record as unknown as PbUser;
}

/** 头像文件 URL：没有用户或没有头像时返回空串；thumb 有值时走缩略图（列表/侧边栏别拉原图） */
export function pbAvatarFileUrl(user: PbUser | null, thumb?: number): string {
  const name = typeof user?.avatar === 'string' ? user.avatar.trim() : '';
  if (!user?.id || !name) return '';
  const base = `${PB_URL}/api/files/${USERS}/${encodeURIComponent(user.id)}/${encodeURIComponent(name)}`;
  return thumb ? `${base}?thumb=${thumb}x${thumb}` : base;
}

/**
 * 改昵称（users.name）：
 * - 服务端不 trim，前后空格会原样落库，所以这里必须先 trim 再发；
 * - 空字符串服务端允许（等价于清空昵称），客户端是否允许由调用方决定。
 * 邮箱不能走这条 PATCH 规则（实测改 email 返回 400），所以这里只碰 name 一个字段。
 */
export async function pbUpdateName(name: string): Promise<PbUser> {
  const me = requireUser();
  const rec = (await pb.collection(USERS).update(me.id, { name: name.trim() })) as unknown as PbUser;
  return rememberUser(rec);
}

/**
 * 上传头像：PATCH users/{id}，multipart/form-data 里只有一个文件键 `avatar`。
 * 不要手写 content-type —— 必须让浏览器自带 boundary，手写成 application/json 会被服务端拒绝。
 * 成功后把返回记录写回 authStore（LocalAuthStore 会一并持久化，刷新后头像仍在）。
 */
export async function pbUploadAvatar(file: File): Promise<PbUser> {
  const me = requireUser();
  const form = new FormData();
  form.append('avatar', file, file.name || 'avatar.png');
  const rec = (await pb.collection(USERS).update(me.id, form)) as unknown as PbUser;
  return rememberUser(rec);
}

/** 删除头像：PB 惯例是把文件字段置为空字符串，服务端会删掉文件并回传 avatar: '' */
export async function pbDeleteAvatar(): Promise<PbUser> {
  const me = requireUser();
  const rec = (await pb.collection(USERS).update(me.id, { avatar: '' })) as unknown as PbUser;
  return rememberUser(rec);
}

function requireUser(): PbUser {
  const me = currentUser();
  if (!me) throw new Error(tStatic('err.notSignedIn'));
  return me;
}

/** 用最新记录覆盖 authStore 里缓存的用户，同时保留本地已有的其它字段 */
function rememberUser(rec: PbUser): PbUser {
  const merged: PbUser = { ...(currentUser() ?? { id: rec.id }), ...rec };
  const record = merged as Parameters<typeof pb.authStore.save>[1];
  pb.authStore.save(pb.authStore.token, record);
  return merged;
}

/** 启动时校验登录态；仅 token 失效（401/403）才清会话，网络不可达时保留本地登录态 */
export async function pbRefreshAuth(): Promise<PbUser | null> {
  if (!pb.authStore.isValid) return null;
  try {
    const { record } = await pb.collection(USERS).authRefresh();
    return record as unknown as PbUser;
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    // 只有服务端明确拒绝才登出；离线/超时/5xx 保留本地会话，避免一断网就被踢
    if (status === 401 || status === 403) {
      pb.authStore.clear();
      return null;
    }
    return (pb.authStore.record ?? null) as PbUser | null;
  }
}

/**
 * 发送重置密码邮件。
 * 后端未配置 SMTP 时 PB 会返回 400/500 —— 调用方据此提示「邮件服务未配置」，
 * 不要据此判断邮箱是否存在（PB 出于安全不会暴露账号是否存在）。
 */
export async function pbRequestPasswordReset(email: string): Promise<void> {
  await pb.collection(USERS).requestPasswordReset(email.trim());
}

/** 把 SDK 抛出的错误压成可读文案；网络/服务端错误都不应冒泡阻塞本地功能（文案走词表） */
export function pbErrorMessage(e: unknown): string {
  if (!e) return tStatic('err.unknown');
  if (e instanceof TypeError) return tStatic('err.network');

  const err = e as { status?: number; message?: string; response?: { message?: string; data?: Record<string, unknown> } };
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status === 0) return tStatic('err.network');
  if (status === 401) return tStatic('err.badCreds');
  if (status === 403) return tStatic('err.forbidden');
  if (status === 404) return tStatic('err.notFound');
  if (status === 408 || status === 429) return tStatic('err.busy');
  if (status !== undefined && status >= 500) return tStatic('err.server');
  if (status === 400) {
    const data = err.response?.data;
    if (data && Object.keys(data).length > 0) return tStatic('err.badData');
    return tStatic('err.invalid');
  }

  if (err?.response?.message) return err.response.message;
  if (typeof err?.message === 'string' && err.message) return err.message;
  return tStatic('err.generic');
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
