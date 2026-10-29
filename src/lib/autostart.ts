// 开机自启 —— PRD FR-S3「通用」页 + tauri-plugin-autostart。
// 仅 Tauri 运行时真正写系统自启（macOS LaunchAgent / Windows 注册表 Run / Linux autostart）；
// 浏览器（IndexedDB 运行时）没有系统自启概念，这里静默降级，设置本身照常持久化。

import { isTauri } from '@/api';

/** 启用(true)/停用(false)系统开机自启；非 Tauri 或出错返回 false */
export async function setAutoStart(on: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const m = await import('@tauri-apps/plugin-autostart');
    if (on) await m.enable(); else await m.disable();
    return true;
  } catch {
    return false;
  }
}

/** 查询系统当前自启状态；非 Tauri 返回 null */
export async function isAutoStart(): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    const m = await import('@tauri-apps/plugin-autostart');
    return await m.isEnabled();
  } catch {
    return null;
  }
}

/** 启动时对齐：以库内设置转为真相源，仅当系统状态与设置不一致时才改写（避免重复写系统） */
export async function syncAutoStart(want: boolean): Promise<void> {
  const current = await isAutoStart();
  if (current === null || current === want) return;
  await setAutoStart(want);
}