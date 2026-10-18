# 模块 · 通知（notify）

## 目标
专注完成/休息结束/任务到期的**应用内 + 系统级**提醒，可选、可关、可标记已读。

## 当前状态
- ✅ 应用内通知表（`notifications`）、顶栏铃铛角标（未读数）、通知面板（已读/全部已读/时间）。
- ✅ 专注/休息结束写入一条应用内通知；浏览器运行时已发浏览器 Notification。
- ✅ 系统级通知走 tauri-plugin-notification（已接线 + 权限申请 + system_notify 开关）。

## 规则
- 触发：`focus_done` / `break_done` / `task_remind`（可选开关 `notify_enabled`）。
- 行为：写入应用内 `notifications`（始终）；系统通知（macOS Notification Center / Windows Toast）**在 Tauri 运行时**通过插件发送（替换/补充浏览器 Notification）。
- 首次请求系统通知权限；未授权则静默降级到应用内（§8.8-5 优雅降级）。

## 待办增量
- ★1 ✅ 系统通知接线：Tauri 用 `@tauri-apps/plugin-notification`，浏览器回落到 Web Notification。
- ★2 ✅ 权限获取 + 两个独立开关：`notify_enabled` 关 → 两者都不发；`system_notify` 单独控制系统通道。
- ★3 任务到期提醒（可选）：每日/到期日提醒生成 `task_remind`。

## 数据影响
- 复用 `notifications` 表；新增 `system_notify` 命令（Rust）或复用现有通道。JS 侧新增 `@tauri-apps/plugin-notification` 依赖（随 npm 安装，非 vendored 遗留）。

## 验收
- [x] 番茄完成在桌面触发真实系统通知——代码/插件/权限层已接，**真机弹窗仍待验证**。
- [x] 设置关闭后不再发任一通道；再次打开恢复（`timerStore.ts:323` 门控）。
- [x] 权限被拒时静默降级、应用内仍在（`ensureSystemPermission` 失败不抛）。
- 关联：`06-acceptance.md` E 组（通知）、`src/api/` 双适配器。
