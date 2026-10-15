// 应用内事件总线 —— 对应 PRD §8.5 的 Tauri 事件。
// 浏览器运行时用本地 emitter；Tauri 运行时由 listen() 桥接（见 src/api/index.ts）。

import type { AppEvent } from './types';

type Handler = (payload: unknown) => void;

const handlers = new Map<AppEvent, Set<Handler>>();

export function emit(event: AppEvent, payload?: unknown): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of set) {
    try { h(payload); } catch { /* 单个订阅者异常不影响其他订阅者 */ }
  }
}

export function on(event: AppEvent, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) { set = new Set(); handlers.set(event, set); }
  set.add(handler);
  return () => { set!.delete(handler); };
}

/** 任务/记录变更后广播，驱动报表刷新（PRD §8.8-3） */
export const broadcastDataChanged = (table: string) => emit('data://changed', { table });
