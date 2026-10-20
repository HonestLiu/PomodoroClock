// 多端数据同步引擎（清单夹 / 清单 / 任务 / 专注记录）。
//
// 与 src-tauri/src/commands/sync.rs 配对，设计要点：
// - 「哪些行要上传」由本地 SQLite 触发器写入 sync_dirty / sync_tombstones 决定，
//   前端不需要拦截每一条写命令（Rust 命令层 ~40 个入口，逐个包不现实）。
// - 冲突按行 updated_at（毫秒）做 LWW，平局取远端；被引用行缺失时只把外键置空，
//   不让整批写入失败。
// - 删除 = 本地硬删 + 墓碑；云端 deleted=true 软删，其他端拉到后同样硬删。
// - 拉取游标用 PocketBase 内置的 updated（服务端时间），避免多端时钟偏差漏行；
//   应用是幂等的，所以游标还能安全回退几秒来吸收并发写。
// - 先拉后推：远端新数据先落地，再把本地改动推上去。
//
// 集合结构由 scripts/pb-sync-setup.mjs 创建（见仓库根 README 的「数据同步」一节）。

import { invoke } from '@tauri-apps/api/core';
import { emit, isTauri, on } from '@/api';
import { currentUser, pb, pbErrorMessage } from './pb';

/** kind → PocketBase 集合名 */
export const SYNC_COLLECTIONS = {
  folders: 'sync_folders',
  lists: 'sync_lists',
  tasks: 'sync_tasks',
  records: 'sync_records',
} as const;

export type SyncKind = keyof typeof SYNC_COLLECTIONS;

interface KindSpec {
  kind: SyncKind;
  /** 参与同步的列，必须与 src-tauri/src/commands/sync.rs 的 *_COLS 一致 */
  fields: readonly string[];
  /** 父行引用列：父行在本地缺失时置空，避免外键约束打断整批写入 */
  refs?: readonly string[];
  /** 表名（用于 data://changed 广播，驱动 UI 刷新） */
  table: string;
}

/** 顺序即依赖顺序：父行在前（拉取插入/推送上传都靠它）。 */
const SPECS: readonly KindSpec[] = [
  {
    kind: 'folders',
    table: 'folders',
    fields: ['id', 'name', 'color', 'sort_order', 'created_at', 'updated_at'],
  },
  {
    kind: 'lists',
    table: 'lists',
    fields: [
      'id', 'name', 'sort_order', 'is_smart', 'icon_type', 'icon_color', 'icon_glyph',
      'folder_id', 'created_at', 'updated_at',
    ],
    refs: ['folder_id'],
  },
  {
    kind: 'tasks',
    table: 'tasks',
    fields: [
      'id', 'list_id', 'title', 'notes', 'est_pomodoros', 'due_date', 'due_time', 'url',
      'urgent', 'repeat', 'lead_remind', 'tags', 'flag', 'priority', 'reminded_at',
      'completed', 'completed_at', 'sort_order', 'created_at', 'updated_at',
    ],
    refs: ['list_id'],
  },
  {
    kind: 'records',
    table: 'focus_records',
    fields: [
      'id', 'task_id', 'list_id', 'start_at', 'end_at', 'duration_min', 'phase',
      'created_at', 'updated_at',
    ],
    refs: ['task_id', 'list_id'],
  },
];

interface DirtyBatch {
  rows: Array<Record<string, unknown>>;
  tombstones: Array<{ id: string; updated_at: number; pb_id: string | null }>;
}

interface AckEntry {
  id: string;
  remote_id: string;
  updated_at: number;
  deleted: boolean;
}

interface ApplyReport {
  applied: number;
  skipped: number;
  deleted: number;
}

const PUSH_BATCH = 80;
/** 本地改动 → 推送的防抖 */
const PUSH_DEBOUNCE_MS = 1200;
/** 远端实时事件 → 拉取的防抖（自己推送的回声也会走到这里，代价只是一次空查询） */
const PULL_DEBOUNCE_MS = 600;
/** 兜底轮询：实时订阅断开时也能收敛 */
const POLL_INTERVAL_MS = 60_000;

interface EngineState {
  userId: string;
  started: boolean;
  running: boolean;
  rerun: boolean;
  pushTimer: ReturnType<typeof setTimeout> | null;
  pullTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  offData: (() => void) | null;
  offRealtime: Array<() => void>;
  failures: number;
  lastError: string;
  /** 首次接管云端数据的准备工作（未完成前不允许推送，避免本机示例数据覆盖云端） */
  ready: Promise<void> | null;
}

const state: EngineState = {
  userId: '',
  started: false,
  running: false,
  rerun: false,
  pushTimer: null,
  pullTimer: null,
  pollTimer: null,
  offData: null,
  offRealtime: [],
  failures: 0,
  lastError: '',
  ready: null,
};

/** 最近一次同步错误的可读文案（同步区可读，空串表示正常） */
export const dataSyncError = (): string => state.lastError;



const wmKey = (uid: string, kind: SyncKind): string => `sync.wm.${uid}.${kind}`;

/** PB 日期串（`2026-10-19 04:11:35.083Z`）← JS Date */
function pbDate(d: Date): string {
  return d.toISOString().replace('T', ' ');
}

function readCursor(uid: string, kind: SyncKind): string {
  try {
    return localStorage.getItem(wmKey(uid, kind)) || '';
  } catch {
    return '';
  }
}

function writeCursor(uid: string, kind: SyncKind, value: string): void {
  try {
    localStorage.setItem(wmKey(uid, kind), value);
  } catch {
    /* 隐私模式等场景忽略：游标丢失只是多做一次全量拉取 */
  }
}

function clearCursors(uid: string): void {
  for (const spec of SPECS) {
    try {
      localStorage.removeItem(wmKey(uid, spec.kind));
    } catch {
      /* ignore */
    }
  }
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

function toPayload(
  spec: KindSpec,
  row: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { user: userId, local_id: String(row.id ?? '') };
  for (const field of spec.fields) {
    if (field === 'id') continue;
    const v = row[field];
    body[field] = v === undefined ? null : v;
  }
  body.deleted = false;
  if (isBlank(body.updated_at)) body.updated_at = Date.now();
  return body;
}

function statusOf(e: unknown): number {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
}

/** 本地 id → 云端记录 id（shadow 未命中时按 local_id 回查，兼容旧数据/换机） */
async function findRemoteId(spec: KindSpec, localId: string): Promise<string> {
  const filter = `user = "${state.userId}" && local_id = "${localId.replace(/"/g, '')}"`;
  try {
    const rec = await pb.collection(SYNC_COLLECTIONS[spec.kind]).getFirstListItem(filter, {
      requestKey: null,
    });
    return rec.id;
  } catch (e) {
    if (statusOf(e) === 404) return '';
    throw e;
  }
}

async function pushRow(
  spec: KindSpec,
  row: Record<string, unknown>,
): Promise<string | null> {
  const col = pb.collection(SYNC_COLLECTIONS[spec.kind]);
  const localId = String(row.id ?? '');
  const body = toPayload(spec, row, state.userId);
  let remoteId = typeof row.pb_id === 'string' ? row.pb_id : '';

  if (!remoteId) remoteId = await findRemoteId(spec, localId);
  if (remoteId) {
    // 云端墓碑优先：另一端已删除且版本更新 → 本机跟随删除，绝不把记录“复活”。
    const remote = await col.getOne(remoteId, { requestKey: null });
    if (remote) {
      const r = remote as Record<string, unknown>;
      const remoteDeleted = r.deleted === true;
      const remoteAt = Number(r.updated_at ?? Date.parse(String(r.updated ?? '')) ?? 0);
      const localAt = Number(row.updated_at ?? 0);
      if (remoteDeleted && remoteAt >= localAt) {
        await invoke('sync_apply', { kind: spec.kind, rows: [], deletedIds: [localId] });
        return null;
      }
    }
    try {
      const rec = await col.update(remoteId, body, { requestKey: null });
      return rec.id;
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
      // 云端记录已被删（另一端删除）→ 落到下面的 create
    }
  }
  try {
    const rec = await col.create(body, { requestKey: null });
    return rec.id;
  } catch (e) {
    // unique(user, local_id) 冲突：并发上传或本地丢了 shadow，回查后改为更新
    const found = await findRemoteId(spec, localId);
    if (found) {
      const rec = await col.update(found, body, { requestKey: null });
      return rec.id;
    }
    throw e;
  }
}

async function pushTombstone(spec: KindSpec, tomb: DirtyBatch['tombstones'][number]): Promise<boolean> {
  const remoteId = tomb.pb_id || (await findRemoteId(spec, tomb.id));
  if (!remoteId) return false; // 云端本来就没有 → 无需删除
  const col = pb.collection(SYNC_COLLECTIONS[spec.kind]);
  try {
    await col.update(
      remoteId,
      { deleted: true, updated_at: Number(tomb.updated_at) || Date.now() },
      { requestKey: null },
    );
  } catch (e) {
    if (statusOf(e) === 404) return false;
    throw e;
  }
  return true;
}

async function pushKind(spec: KindSpec): Promise<number> {
  let pushed = 0;
  for (let round = 0; round < 50; round += 1) {
    const batch = await invoke<DirtyBatch>('sync_dirty_batch', {
      kind: spec.kind,
      limit: PUSH_BATCH,
    });
    if (!batch.rows.length && !batch.tombstones.length) break;

    const acks: AckEntry[] = [];
    let failed = false;
    for (const row of batch.rows) {
      try {
        const remoteId = await pushRow(spec, row);
        if (remoteId === null) {
          // 云端墓碑更新更晚：本机已按云端删除，回执照「删除」上报即可
          acks.push({
            id: String(row.id ?? ''),
            remote_id: '',
            updated_at: Number(row.updated_at) || 0,
            deleted: true,
          });
          continue;
        }
        acks.push({
          id: String(row.id ?? ''),
          remote_id: remoteId,
          updated_at: Number(row.updated_at) || 0,
          deleted: false,
        });
        pushed += 1;
      } catch (e) {
        failed = true;
        throw e;
      }
    }
    for (const tomb of batch.tombstones) {
      try {
        await pushTombstone(spec, tomb);
        acks.push({ id: tomb.id, remote_id: '', updated_at: Number(tomb.updated_at) || 0, deleted: true });
      } catch (e) {
        failed = true;
        throw e;
      }
    }
    if (acks.length) {
      await invoke('sync_ack', { kind: spec.kind, entries: acks });
    }
    if (failed || acks.length === 0) break;
  }
  return pushed;
}

async function pullKind(spec: KindSpec): Promise<number> {
  const cursor = readCursor(state.userId, spec.kind);
  const filter = cursor
    ? `user = "${state.userId}" && updated >= "${cursor}"`
    : `user = "${state.userId}"`;
  const list = await pb.collection(SYNC_COLLECTIONS[spec.kind]).getFullList({
    filter,
    sort: 'updated',
    batch: 200,
    requestKey: null,
  });
  if (!list.length) return 0;

  const rows: Array<Record<string, unknown>> = [];
  const deletedIds: string[] = [];
  let newest = cursor;

  for (const rec of list) {
    const updated = String(rec.updated ?? '');
    if (updated && updated > newest) newest = updated;
    const localId = String((rec as Record<string, unknown>).local_id ?? '');
    if (!localId) continue;
    if ((rec as Record<string, unknown>).deleted === true) {
      deletedIds.push(localId);
      continue;
    }
    const row: Record<string, unknown> = { id: localId, pb_id: rec.id };
    for (const field of spec.fields) {
      if (field === 'id') continue;
      const v = (rec as Record<string, unknown>)[field];
      if (v !== undefined) row[field] = v;
    }
    // 老记录可能没有 updated_at（早期版本写入）→ 用服务端时间兜底
    if (!row.updated_at) row.updated_at = Date.parse(updated) || 0;
    // 服务端版本号（PB 的 updated），用于判断“这一版是否已经落地过”
    row.server_updated = Date.parse(updated) || 0;
    rows.push(row);
  }

  const report = await invoke<ApplyReport>('sync_apply', {
    kind: spec.kind,
    rows,
    deletedIds,
  });
  if (report.applied > 0 || report.deleted > 0) {
    emit('data://changed', { table: spec.table });
  }
  if (newest) {
    // 游标移到最新一条之后（+1ms）：游标区间是闭区间（updated >= 游标），
    // 若停在最新记录本身，下一轮会把它再拉一次、再 emit 一次，形成自激循环。
    const next = new Date(Date.parse(newest) + 1);
    writeCursor(state.userId, spec.kind, pbDate(Number.isNaN(next.getTime()) ? new Date() : next));
  }
  return report.applied + report.deleted;
}

/** 立即执行一轮「先拉后推」。并发调用会合并成一次补跑。 */
export async function syncDataNow(): Promise<void> {
  if (!isTauri() || !state.userId) return;
  if (state.ready) await state.ready;
  if (state.running) {
    state.rerun = true;
    return;
  }
  state.running = true;
  try {
    for (const spec of SPECS) await pullKind(spec);
    for (const spec of SPECS) await pushKind(spec);
    state.failures = 0;
    state.lastError = '';
  } catch (e) {
    state.failures += 1;
    state.lastError = pbErrorMessage(e);
    if (state.failures <= 3) console.warn('[sync] 数据同步失败：', e);
  } finally {
    state.running = false;
    if (state.rerun) {
      state.rerun = false;
      schedulePushLater(PUSH_DEBOUNCE_MS);
    }
  }
}

function schedulePushLater(delay: number): void {
  if (!state.userId) return;
  if (state.pushTimer) clearTimeout(state.pushTimer);
  state.pushTimer = setTimeout(() => {
    state.pushTimer = null;
    void syncDataNow();
  }, delay);
}

function schedulePullLater(delay: number): void {
  if (!state.userId) return;
  if (state.pullTimer) clearTimeout(state.pullTimer);
  state.pullTimer = setTimeout(() => {
    state.pullTimer = null;
    void syncDataNow();
  }, delay);
}

/** 本地写入后调用（data://changed 已自动接线，业务层一般不用手动调） */
export function scheduleSyncPush(): void {
  schedulePushLater(PUSH_DEBOUNCE_MS);
}

/** 云端这个账号是否已经有业务数据（决定本机是否要「以云端为准」）。 */
async function cloudHasRows(uid: string): Promise<boolean> {
  for (const kind of ['lists', 'tasks'] as const) {
    try {
      const page = await pb.collection(SYNC_COLLECTIONS[kind]).getList(1, 1, {
        filter: `user = "${uid}" && deleted = false`,
        requestKey: null,
      });
      if (page.totalItems > 0) return true;
    } catch {
      /* 查询失败就当云端没数据，保守起见不清本机 */
    }
  }
  return false;
}

/**
 * 本机第一次同步这个账号时：若云端已有数据，则清掉本机业务数据（多为示例数据/未登录时的临时数据），
 * 让云端成为唯一真相，避免本机较新的示例记录反向覆盖云端。已同步过的账号不受影响。
 */
async function adoptCloudIfFirstRun(uid: string): Promise<boolean> {
  const key = `sync.init.${uid}`;
  try {
    if (localStorage.getItem(key) === '1') return false;
  } catch {
    return false;
  }
  const everSynced = SPECS.some((spec) => readCursor(uid, spec.kind) !== '');
  if (everSynced) {
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
    return false;
  }
  const hasCloud = await cloudHasRows(uid);
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  if (!hasCloud) return false;
  await invoke('sync_reset_rows');
  clearCursors(uid);
  emit('data://changed', { table: 'all' });
  return true;
}

let realtimeGen = 0;

function stopRealtime(): void {
  realtimeGen += 1;
  for (const off of state.offRealtime) {
    try {
      off();
    } catch {
      /* ignore */
    }
  }
  state.offRealtime = [];
}

async function startRealtime(): Promise<void> {
  stopRealtime();
  const gen = realtimeGen;
  for (const spec of SPECS) {
    try {
      const off = await pb.collection(SYNC_COLLECTIONS[spec.kind]).subscribe('*', () => {
        schedulePullLater(PULL_DEBOUNCE_MS);
      });
      // 订阅期间引擎被停掉（登出/切号）→ 立即退订，避免泄漏
      if (gen !== realtimeGen) {
        try { off(); } catch { /* ignore */ }
        return;
      }
      state.offRealtime.push(off);
    } catch (e) {
      console.warn('[sync] 实时订阅失败：', spec.kind, e);
    }
  }
}

/** 登录后启动引擎；切换账号会自动重置状态。 */
export function startDataSync(userId: string): void {
  if (!isTauri() || !userId) return;
  const userChanged = state.userId !== userId;
  state.userId = userId;
  if (userChanged) {
    state.failures = 0;
    state.lastError = '';
  }
  if (!state.started) {
    state.started = true;
    state.offData = on('data://changed', (payload) => {
      const table = (payload as { table?: string } | null)?.table;
      if (table === 'all') {
        // 「删除本机数据」：本地清空，云端保留 → 重置游标但不立即回灌
        clearCursors(state.userId);
        return;
      }
      schedulePushLater(PUSH_DEBOUNCE_MS);
    });
  }
  void startRealtime();
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    void syncDataNow();
  }, POLL_INTERVAL_MS);
  state.ready = (async () => {
    try {
      await adoptCloudIfFirstRun(userId);
    } catch (e) {
      console.warn('[sync] 首次接管云端数据失败：', e);
    }
  })();
  void state.ready.then(() => {
    if (state.userId === userId) schedulePullLater(400);
  });
}

/** 退出登录 / 关闭同步时调用（不清本地数据）。 */
export function stopDataSync(): void {
  stopRealtime();
  if (state.offData) {
    state.offData();
    state.offData = null;
  }
  if (state.pushTimer) clearTimeout(state.pushTimer);
  if (state.pullTimer) clearTimeout(state.pullTimer);
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pushTimer = null;
  state.pullTimer = null;
  state.pollTimer = null;
  state.started = false;
  state.userId = '';
  state.running = false;
  state.rerun = false;
}

/** 当前登录用户的待同步规模（诊断用，可在控制台调用）。 */
export async function pendingCounts(): Promise<{ dirty: number; tombstones: number }> {
  if (!isTauri()) return { dirty: 0, tombstones: 0 };
  return invoke<{ dirty: number; tombstones: number }>('sync_pending_counts');
}

/** 强制与云端对账：重置游标后做一次全量拉取 + 推送（设置页「拉取云端」用）。 */
export async function forceFullSync(): Promise<void> {
  if (!state.userId) return;
  clearCursors(state.userId);
  await syncDataNow();
}

/** 是否已登录（供 UI 判断同步区是否显示实时状态） */
export function currentSyncUser(): string {
  return currentUser()?.id ?? '';
}
