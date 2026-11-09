import { initialQuests, questArchives, validateQuestTransition, type QuestData } from '@/lib/quests/model';
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
  quest_data?: QuestData;
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
let clearing = false;
let mutationGeneration = 0;
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
    const store = tx.objectStore(STORE);
    const req = store.get(KEY);
    req.onsuccess = () => {
      const latest = req.result as DBShape | undefined;
      // An ordinary save from another tab must not roll back quest state or its immutable archives.
      if (!clearing && latest?.quest_data) {
        if (latest.quest_data.revision > (value.quest_data?.revision ?? 0)) value.quest_data = latest.quest_data;
        // Preserve settled rows even when an asynchronous reader carries the same ledger revision.
        for (const task of latest.tasks.filter(t => t.id.startsWith('quest_archive_'))) if (!value.tasks.some(t => t.id === task.id)) value.tasks.push(task);
        for (const record of latest.focus_records.filter(r => r.id.startsWith('quest_focus_'))) if (!value.focus_records.some(r => r.id === record.id)) value.focus_records.push(record);
      }
      store.put(value, KEY);
    };
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
  mutationGeneration++;
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
    clearing = false;
  } catch {
    memoryOnly = true;
  }
}

/** 清空业务数据：保留/重建默认用户，写入 demo_seeded 标记避免下次启动重新播种 */
function clearToFactory(): void {
  clearing = true;
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


/** CAS plus ordinary archives use a single durable IndexedDB transaction; no schema/version reset. */
export async function loadQuestData(): Promise<QuestData> {
  await initDB();
  await flush();
  if (idb && !memoryOnly) {
    const latest = await idbGet(idb);
    if (latest?.quest_data && latest.quest_data.revision >= (data.quest_data?.revision ?? 0)) {
      data.quest_data = latest.quest_data;
      for (const task of latest.tasks.filter(t => t.id.startsWith('quest_archive_'))) if (!data.tasks.some(t => t.id === task.id)) data.tasks.push(normalizeTask(task));
      for (const record of latest.focus_records.filter(r => r.id.startsWith('quest_focus_'))) if (!data.focus_records.some(r => r.id === record.id)) data.focus_records.push(record);
    }
  }
  return structuredClone(data.quest_data ?? initialQuests());
}
export async function commitQuestData(expectedRevision: number, next: QuestData): Promise<QuestData> {
  await initDB();
  await flush();
  const apply = (snapshot: DBShape): DBShape => {
    const before = snapshot.quest_data ?? initialQuests();
    if (before.revision !== expectedRevision) throw new Error('quest.conflict');
    validateQuestTransition(before, next, Date.now());
    const archives = questArchives(before, next);
    const out = structuredClone(snapshot);
    out.quest_data = structuredClone(next);
    out.tasks.push(...archives.tasks);
    out.focus_records.push(...archives.records);
    return out;
  };
  if (!idb || memoryOnly) throw new Error('quest.storageUnavailable');
  const baseline = structuredClone(data);
  const generation = mutationGeneration;
  await new Promise<void>((resolve, reject) => {
    const tx = idb!.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let committed: DBShape;
    const req = store.get(KEY);
    req.onsuccess = () => {
      try { committed = apply(req.result as DBShape); store.put(committed, KEY); }
      catch (error) { tx.abort(); reject(error); }
    };
    tx.oncomplete = () => {
      if (generation !== mutationGeneration) {
        // Ordinary edits made while the transaction was pending must survive its completion.
        for (const key of Object.keys(baseline) as (keyof DBShape)[]) {
          if (key !== 'quest_data' && JSON.stringify(data[key]) !== JSON.stringify(baseline[key])) {
            (committed as unknown as Record<string, unknown>)[key] = structuredClone(data[key]);
          }
        }
        const archives = questArchives(baseline.quest_data ?? initialQuests(), next);
        for (const task of archives.tasks) if (!committed.tasks.some(t => t.id === task.id)) committed.tasks.push(task);
        for (const record of archives.records) if (!committed.focus_records.some(r => r.id === record.id)) committed.focus_records.push(record);
        scheduleSave();
      }
      data = committed;
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error('quest.saveFailed'));
    tx.onabort = () => reject(tx.error ?? new Error('quest.saveFailed'));
  });
  return structuredClone(next);
}

export async function applyRemoteQuestData(next: QuestData): Promise<void> {
  await initDB();
  if (next.version !== 1 || !Array.isArray(next.goals) || !Array.isArray(next.quests) || !Array.isArray(next.attempts)
    || next.goals.length > 100 || next.quests.length > 3000 || next.attempts.length > 10000) throw new Error('quest.invalidPlan');
  mutate(d => { d.quest_data = structuredClone(next); });
  await flush();
}
