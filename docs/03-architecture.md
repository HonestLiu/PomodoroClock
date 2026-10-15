# 03 · 技术架构（双运行时）

## 分层总览（沿用 CLAUDE.md §8.2）

```
UI 层        src/ · components · pages · modals · charts
状态层       src/stores/         Zustand
桥接层       src/api/            §8.4 命令面（typed）
            ┌─ tauri.ts          invoke → Rust
            └─ local.ts          IndexedDB 直接实现
Rust 核心    src-tauri/src       commands/* · db.rs · timer_engine.rs
存储        SQLite(focus.db) / IndexedDB / 设置 KV / 音频资产
```

## 双运行时 —— 必须保持同步

前端经 `src/api/index.ts` 依据 `window.__TAURI_INTERNALS__` 分派：
- **Tauri 运行时**：命令转发到 Rust（`commands/*.rs`），数据在 **SQLite**，计时权威时钟由 Rust `timer_engine` 每 250ms 广播 `timer://tick`。
- **浏览器运行时**：`local.ts` 直接操作 **IndexedDB**，计时用本地 250ms 脉冲。

**一致性红线（改数据/统计时必读）**：
1. **同一命令面**：只允许通过 `src/api` 的命令访问数据，UI 不得直连存储。
2. **同一统计口径**：`commands/stats.rs`（SQL）与 `db/queries.ts`（TS）必须逐项等价。
3. **同一种子数据**：`db.rs::seed_demo`（SQLite）与 `db/seed.ts`（IndexedDB）的 §6.3 数字必须一致。
4. **UI 不得直连存储**：`src/components|pages|modals|charts` **禁止** import `@/db/queries` 或 `@/db/idb`
   （它们只服务 `local.ts` 适配器内部）。UI 一律用 `src/lib/derive.ts` 的纯函数 + store 数据。
   *违反后果*：Tauri 运行时 IndexedDB 从未初始化，界面恒为空（2026-10-14 实际发生过，见 `08-changelog.md`）。
   守卫：`./tools/check-runtime-parity.sh`（违反即非零退出）。
5. **改任何一处 → 跑两份校验**：
   - `cargo test --test queries`（Rust）
   - `tools/verify-data.ts`（TS，node bundle 后跑）
   - `./tools/check-runtime-parity.sh`（UI 未直连存储）
   - 必要时回归 `tools/shoot.mjs` 截屏比对。
6. **两种运行时都要验**：新功能必须在**浏览器**与**Tauri 桌面**各验一次。
   桌面无显示环境时，可用"webview 内探针写 SQLite + 直接读库"的方式断言真实渲染（见 `08-changelog.md` 的验证手法）。

## 关键机制

| 机制 | 实现 | 位置 |
|---|---|---|
| 计时可靠 | 绝对时间戳 `remaining = end_at - now`，禁止 setInterval 累加；暂停写 `paused_remaining_ms` | `timer/engine.ts` / `timer_engine.rs` |
| 单属主归档 | `focus_record` 只在 `timerStore.checkExpiry` 写入，Rust 不重复结算 | `stores/timerStore.ts` |
| 变更广播 | 数据写后发 `data://changed`，报表/侧边栏/角标实时重算（真实时聚合，不缓存） | `api/events.ts` |
| 事件订阅 | `subscribe(event, handler)` 统一本地总线 +（Tauri 下）原生 listen | `api/index.ts` |
| 危险操作 | 删除/注销二次确认，后端仍校验来源 | `modals/ConfirmDialog.tsx` |

## 跨平台窗口
- macOS：`titleBarStyle: Overlay` + `hiddenTitle`，保留系统红黄绿。
- Windows/Linux：`tauri.windows.conf.json` / `tauri.linux.conf.json` 覆盖为 `decorations:false`，自绘红黄绿按钮（`components/TitleBar.tsx`）。

## 工程化约定
- 新增命令：`types.ts` 加签名 → Rust 加 `#[tauri::command]` → `local.ts` + `tauri.ts` 双实现 → `lib.rs` 注册 → 变更命令包 `broadcastDataChanged`。
- 新增表/字段：`db.rs::SCHEMA` 迁移 + `db/` TS 表定义 + 双种子同步 + 双校验。
