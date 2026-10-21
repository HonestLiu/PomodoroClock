// 本地持久化层。
//
// PRD §8.6 规定生产形态为 SQLite（app_data_dir/focus.db）。当前构建在浏览器
// 运行时下使用 IndexedDB 承载同一套 §6.2 表结构；两者共用 src/db/queries.ts
// 的查询/统计口径，因此 §7.2 的计算结果一致。切换到 Tauri 原生后端时，仅需
// 替换 src/api 的适配器（见 src/api/index.ts）。

import type {
  Countdown, FocusRecord, Folder, Goal, Notification, Task, TaskList, TimerState, User,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { buildSeed } from './seed';

export interface DBShape {
  users: User[];
  folders: Folder[];
  lists: TaskList[];
  tasks: Task[];
  focus_records: FocusRecord[];
  goals: Goal[];
  settings: { key: string; value: string }[];
  notifications: Notification[];
  timer_state: TimerState[];
  countdowns: Countdown[];
}

const DB_NAME = 'focus_pomodoro';
// 3：tasks 引入提醒事项字段（due_time/url/urgent/repeat/lead_remind/tags/flag/priority/reminded_at）。
// 4：新增倒数纪念日独立域（countdowns 表）。
// 升级即清空重播种（既有模式），旧库不兼容。

const DB_VERSION = 4;
const STORE = 'kv';
const KEY = 'db';

export function emptyDB(): DBShape {
  return {
    users: [],
    folders: [],
    lists: [],
    tasks: [],
    focus_records: [],
    goals: [],
    settings: [],
    notifications: [],
    timer_state: [],
    countdowns: [],
  };
}

export function defaultTimerState(): TimerState {
  return {
    phase: 'idle',
    mode: 'pomodoro',
    task_id: null,
    running: false,
    start_at: null,
    end_at: null,
    paused_remaining_ms: null,
  };
}

/** 提醒事项字段的默认值（Task 补齐用） */
const taskReminderDefaults = {
  due_time: null as string | null,
  url: '',
  urgent: 0,
  repeat: 'none' as 'none',
  lead_remind: 'none' as 'none',
  tags: [] as string[],
  flag: 0,
  priority: 'none' as 'none',
  reminded_at: null as number | null,
};

/** 旧库任务补齐新字段（防缺字段崩溃）；外键空串还原为 null（与 Rust 同口径） */
function normalizeTask(t: Task): Task {
  return {
    ...taskReminderDefaults,
    ...t,
    list_id: t.list_id || null,
    parent_id: t.parent_id || null,
    actual_minutes: t.actual_minutes ?? null,
  };
}

let data: DBShape = emptyDB();
let idb: IDBDatabase | null = null;
let memoryOnly = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<void> | null = null;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // 迁移/重建：删除旧 schema 的所有 store，统一重建 kv。
      // 历史原因：早期版本曾使用不同（或缺失）的 store，若保留旧库会触发
      // "object store not found"；此处以"不兼容即重建"处理（数据为演示种子，可重播种）。
      const db = req.result;
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase): Promise<DBShape | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as DBShape | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, value: DBShape): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取本地数据；首次运行写入 §6.3 截图还原数据 */
export function initDB(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      idb = await openIDB();
      const existing = await idbGet(idb);
      if (existing && Array.isArray(existing.tasks)) {
        data = { ...emptyDB(), ...existing, tasks: existing.tasks.map(normalizeTask) };
        return;
      }
    } catch {
      // 隐私模式 / IndexedDB 不可用时退化为内存存储（PRD §8.8：优雅降级）
      memoryOnly = true;
      idb = null;
    }
    // 首次运行写入 §6.3 截图还原数据（与 db.rs 的 is_empty → seed_demo 同口径）。
    // 只有在「本地完全没有任何既有记录」时才会走到这里；用户主动「删除数据」
    // 或「重置」后写入的是带 demo_seeded 标记的空库，不会被重新播种。
    data = buildSeed();
    data.settings.push({ key: 'demo_seeded', value: '1' });
    await flush();
  })();
  return initPromise;
}

export function getDB(): DBShape {
  return data;
}

/** 修改数据并调度落盘 */
export function mutate<T>(fn: (d: DBShape) => T): T {
  const out = fn(data);
  scheduleSave();
  return out;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flush(); }, 60);
}

export async function flush(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (memoryOnly || !idb) return;
  try {
    await idbPut(idb, data);
  } catch {
    memoryOnly = true;
  }
}

/** 清空业务数据：保留/重建默认用户，写入 demo_seeded 标记避免下次启动重新播种 */
function clearToFactory(): void {
  data = buildSeed({ empty: true });
  data.settings.push({ key: 'demo_seeded', value: '1' });
  scheduleSave();
}

/** 删除数据（PRD FR-S2「删除数据」）：清空业务表并重建默认用户 */
export function wipeDB(): void {
  clearToFactory();
}

/** 全量重置为出厂（空数据，不再写入截图演示数据） */
export function resetDB(): void {
  clearToFactory();
}

export function settingsMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of data.settings) out[row.key] = row.value;
  return out;
}

export function getSettings() {
  const m = settingsMap();
  const merged = { ...DEFAULT_SETTINGS } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(m)) {
    const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
    if (def === undefined) continue;
    if (typeof def === 'number') merged[k] = Number(v);
    else if (typeof def === 'boolean') merged[k] = v === 'true';
    else merged[k] = v;
  }
  return merged as unknown as typeof DEFAULT_SETTINGS;
}

export function setSetting(key: string, value: string): void {
  mutate((d) => {
    const row = d.settings.find((s) => s.key === key);
    if (row) row.value = value;
    else d.settings.push({ key, value });
  });
}
