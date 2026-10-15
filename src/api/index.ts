// 桥接层入口 —— PRD §8.2。
//
// 运行在 Tauri 中时转发到 Rust 命令；在浏览器/dev 下使用 IndexedDB 适配器。
// 两者实现同一 §8.4 命令面，业务层无感知。

import { localApi } from './local';
import { tauriApi, tauriListen } from './tauri';
import type { Api, AppEvent } from './types';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export const api: Api = isTauri() ? tauriApi : localApi;

export function subscribe(event: AppEvent, handler: (payload: unknown) => void): () => void {
  // 本地总线始终挂载：Tauri 适配器在变更后也会在此广播 data://changed，
  // 从而保证两种运行时下 UI 刷新路径完全一致。
  const offLocal = localOn(event, handler);
  if (!isTauri()) return offLocal;
  const offTauri = tauriListen(event, handler);
  return () => { offLocal(); offTauri(); };
}

// 延迟引入避免循环依赖
import { on as localOn } from './events';

export type { Api, AppEvent } from './types';
export { emit, on } from './events';
