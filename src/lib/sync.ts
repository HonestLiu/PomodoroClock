// 云端配置同步 —— 每个用户一条 configs 记录（data = Settings JSON）
// 冲突裁决：rev（主）→ updated（PB 自动时间戳，次）→ device（确定性决胜）。
// 三步都是**纯函数**，便于单测；两侧都收敛到同一结果。

import { pb, CONFIGS, currentUser, pbErrorMessage } from './pb';
import { tStatic } from '@/i18n';
import { api } from '@/api';
import { DEFAULT_SETTINGS, type Settings } from '@/types';

/** 云端记录的形状（对应 configs 集合字段） */
export interface ConfigRecord {
  id: string;
  user: string;
  data: Partial<Settings>;
  rev: number;
  device?: string;
  created: string;
  updated: string;
}

/** 裁决所需的三元组；本地这份存在 localStorage（不入库，避免写放大） */
export interface SyncMeta {
  rev: number;
  updated: string;
  device: string;
}

const DEVICE_KEY = 'sync.device';
const metaKey = (userId: string) => `sync.meta.${userId}`;

// ── 设备标识 ──────────────────────────────────────────────────────────

let cachedDevice: string | null = null;

export function deviceId(): string {
  if (cachedDevice) return cachedDevice;
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    cachedDevice = id;
  } catch {
    cachedDevice = `dev-${Date.now()}`;
  }
  return cachedDevice;
}

// ── 本地 meta ─────────────────────────────────────────────────────────

export function readMeta(userId: string): SyncMeta | null {
  try {
    const raw = localStorage.getItem(metaKey(userId));
    if (!raw) return null;
    const m = JSON.parse(raw) as SyncMeta;
    return typeof m?.rev === 'number' ? { rev: m.rev, updated: m.updated ?? '', device: m.device ?? '' } : null;
  } catch {
    return null;
  }
}

export function writeMeta(userId: string, meta: SyncMeta): void {
  try {
    localStorage.setItem(metaKey(userId), JSON.stringify(meta));
  } catch { /* 隐私模式：忽略，下次会重新对齐 */ }
}

// ── 冲突裁决（纯函数） ────────────────────────────────────────────────

export type Direction = 'push' | 'pull' | 'none';

/**
 * 三步裁决，双方独立调用都会得到同一答案（保证收敛）：
 *  1) rev 大者胜
 *  2) rev 相同比服务端时间戳 updated
 *  3) 仍相同比 device 字典序（确定性决胜）
 */
export function resolveDirection(local: SyncMeta | null, remote: SyncMeta | null): Direction {
  if (!remote) return 'push';          // 云端无记录：把本地推上去
  if (!remote.updated && remote.rev === 0) return 'push';
  if (!local) return 'pull';           // 本地无 meta：首次拉取
  if (remote.rev > local.rev) return 'pull';
  if (remote.rev < local.rev) return 'push';
  if (remote.updated !== local.updated) return remote.updated > local.updated ? 'pull' : 'push';
  // 三元组完全一致（同一次写入）说明两边已对齐；此时再机械 push 会与实时订阅互相触发写放大。
  const rd = remote.device ?? '';
  const ld = local.device ?? '';
  if (!rd || !ld || rd === ld) return 'none';
  return rd > ld ? 'pull' : 'push';
}

// ── 读写云端 ──────────────────────────────────────────────────────────

function remoteMeta(r: ConfigRecord): SyncMeta {
  return { rev: r.rev ?? 0, updated: r.updated ?? '', device: r.device ?? '' };
}

/** 拉取自己的云端记录；不存在返回 null（服务端规则已按 user 过滤） */
export async function fetchRemote(): Promise<ConfigRecord | null> {
  const me = currentUser();
  if (!me) return null;
  try {
    return await pb.collection(CONFIGS).getFirstListItem(`user = "${me.id}"`) as unknown as ConfigRecord;
  } catch {
    return null; // 404 = 还没有记录；其余错误按「无云端数据」降级
  }
}

/** 本地 -> 云端：读本地 Settings，按 rev 自增后 upsert */
export async function pushConfig(): Promise<SyncMeta> {
  const me = currentUser();
  if (!me) throw new Error(tStatic('err.notSignedIn'));
  const settings = await api.get_settings();
  const remote = await fetchRemote();
  const device = deviceId();
  const payload: Partial<Settings> = { ...settings };
  // API Key 只留本机：配置同步（configs.data）不上传它，避免泄露到云端
  delete payload.ai_api_key;
  // 同步服务器地址也是本机设置（不同设备可能连不同服务器），不当共享配置上传
  delete payload.pb_url;
  // 自定义专注背景列表为本地大体积 dataURI，塞进 configs.data 会撑爆云端记录，不共享
  delete payload.wallpapers;
  delete payload.growth_data; // 奖励账本只保存在本机，不能由配置同步覆盖余额

  let saved: ConfigRecord;
  if (remote) {
    saved = await pb.collection(CONFIGS).update(remote.id, {
      data: payload,
      rev: (remote.rev ?? 0) + 1,
      device,
    }) as unknown as ConfigRecord;
  } else {
    saved = await pb.collection(CONFIGS).create({
      user: me.id,
      data: payload,
      rev: 1,
      device,
    }) as unknown as ConfigRecord;
  }

  const meta = remoteMeta(saved);
  writeMeta(me.id, meta);
  return meta;
}

/**
 * 云端 -> 本地：把远端 Settings 写入本地（走 api 层，两个运行时一致）。
 * 只写「远端确实带了」的白名单键：远端缺的键保留本地当前值，
 * 这样部分配置（例如老版本只同步了主题）不会把其余设置冲成默认值。
 */
export async function applyRemote(rec: ConfigRecord): Promise<void> {
  const data = rec.data ?? {};
  const known = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const writes: Array<Promise<unknown>> = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'growth_data') continue;
    if (!(k in known)) continue;
    // 跳过空值与非标量：String(undefined) 会写出 "undefined" 污染本地设置
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' || typeof v === 'function') continue;
    writes.push(api.set_setting(k, String(v)));
  }
  await Promise.all(writes);
  const me = currentUser();
  if (me) writeMeta(me.id, remoteMeta(rec));
}

/** 拉取并按裁决结果决定是否应用；返回实际动作 */
export async function pullConfig(): Promise<Direction> {
  const me = currentUser();
  if (!me) return 'none';
  const remote = await fetchRemote();
  const direction = resolveDirection(readMeta(me.id), remote ? remoteMeta(remote) : null);
  // applyRemote 只写远端出现的键，缺键自然保留本地值；无需先做合并，
  // 否则会把本地所有键重新写一遍，触发无意义的设置变更与推送。
  if (direction === 'pull' && remote) await applyRemote(remote);
  return direction;
}

// ── 实时订阅 ──────────────────────────────────────────────────────────

/** 订阅自己的 configs 记录变化；返回取消订阅函数。连接失败静默降级。 */
export function subscribeConfig(
  onRemote: (rec: ConfigRecord) => void,
  onError?: (msg: string) => void,
): () => void {
  let unsub: (() => void) | null = null;
  let dead = false;

  (async () => {
    try {
      const fn = await pb.collection(CONFIGS).subscribe('*', (e) => {
        if (dead || e.action === 'delete') return;
        const rec = e.record as unknown as ConfigRecord;
        // 只处理自己的记录（服务端规则本已挡住别人，这里再过滤一层避免误应用）
        if (rec.user !== currentUser()?.id) return;
        onRemote(rec);
      });
      unsub = () => { void fn(); };
    } catch (e) {
      onError?.(pbErrorMessage(e)); // 订阅失败不影响本地功能
    }
  })();

  return () => {
    dead = true;
    unsub?.();
  };
}
