// 系统通知（跨运行时）—— PRD §5.7 / notify.md
// Tauri 运行时走 tauri-plugin-notification（macOS Notification Center / Windows Toast）；
// 浏览器运行时回落到 Web Notification API。失败静默降级（PRD §8.8-5）。

import { isTauri } from '@/api';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

/** 请求系统通知权限（首次成功后不再打扰） */
export async function ensureSystemPermission(): Promise<boolean> {
  try {
    if (isTauri()) {
      let granted = await isPermissionGranted();
      if (!granted) {
        const p = await requestPermission(); // 'granted' | 'denied' | 'default'
        granted = p === 'granted';
      }
      return granted;
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const r = await Notification.requestPermission();
    return r === 'granted';
  } catch {
    return false; // 静默降级
  }
}

/** 发送一条系统通知（假设已授权） */
export function systemNotify(title: string, body: string): void {
  try {
    if (isTauri()) {
      sendNotification({ title, body });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch { /* 静默降级 */ }
}
