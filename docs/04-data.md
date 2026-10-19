# 04 · 数据契约与口径

> 实体与口径的最终定义见 CLAUDE.md §6（表结构）与 §7（统计口径）。本文档补充**工程化约定**与**演进规则**。

## 实体总览
```
users 1─1 settings(部分) ; users 1─n lists 1─n tasks 1─n focus_records
focus_records ──(task_id 可空)──> tasks     notifications 独立   timer_state 单行(id=1)
```
（`lists`, `tasks`, `focus_records`, `notifications`, `goals`, `settings`, `users`, `timer_state` 八张表，SQLite 与 IndexedDB 各存一份。）

## 工程化约定

### 外键空置语义
- 删除任务 → 其 `focus_records.task_id` 置空（历史保留，归「未指定任务」）。
- 删除清单 → 其 `tasks.list_id` 置空（任务保留，归未指定清单）。

### 时间戳
- 业务时间戳一律毫秒 `INTEGER`。
- 日期键一律本地时区 `'YYYY-MM-DD'`（§7.3）。
- "今天/本周" 边界统一表达式：
  - 今天：`date('now','localtime')`
  - 本周一：`date('now','localtime','-6 days','weekday 1')`（当天即周一时不误回退一周）

### 排序契约
- 用户清单/任务默认按 `sort_order ASC, created_at ASC`。
- `sort_order` 为在同级内的序号（从 0 起，可含空隙）。
- **现状**：`sort_order` 已落地为 UI 拖拽排序（视图内重排 + 跨清单移动），写回 `sort_order`。

### 设置键（settings KV）
| 键 | 类型 | 默认 | 现状 |
|---|---|---|---|
| focus_len_min / break_len_min / long_break_len_min / long_break_every | int | 25/5/15/4 | ✅ 已读入计时 |
| daily_target_min | int | 180 | ✅ 同步到 goals 表 |
| auto_start_next | bool | false | ✅ 已接状态机 |
| theme / language / wallpaper | str | light/zh/waves | ✅ 已读入行为：`theme`→`data-theme`、`language`→词表切换、`wallpaper`→专注界面 |
| noise | str | waves | ✅ 有 UI 写入（取值 `waves`/`rain`/`wind`/`woods`/`cozy`）：入口＝外观页「选择白噪音」与白噪音弹窗，弹窗**确定**才写；选「无」不覆盖已存值（`lib/noise.ts::NOISE_KINDS`、`components/NoisePicker.tsx::confirm`） |
| noise_volume | float | 0.5 | ✅ 有 UI 写入（0–1 浮点，弹窗滑杆；确定时总是写） |
| notify_enabled / system_notify | bool | true/true | ✅ 应用内 / 系统通知两个独立门控（`timerStore.ts::checkExpiry`） |
| noise_on_focus / noise_on_break | bool | false | 🔶 **只写未读**：设置页可改，计时器尚未据此自动播放 |
| autostart | bool | false | 🔶 **只写未读**：`tauri-plugin-autostart` 未安装，无系统行为 |
| motto | str | '' | 🔶 遗留字段：编辑资料入口已随账号页重构移除，当前无 UI 写入、无消费方（`types.ts` 仍留默认值） |

> 账号资料（email/name/**password**) 与**头像**（`users.avatar`，PB 内建文件字段，无需改 schema）都不在本地库：
> 由 PocketBase `users` 承载，账号页直接读写 PB 记录；`avatar` 存的是**服务端文件名**（`原文件名前缀 + 随机串`），
> 展示时拼 `GET /api/files/users/{recordId}/{filename}`（可带 `?thumb=NxN`，见 `lib/pb.ts::pbAvatarFileUrl`）。
> 本地 `users` 表仅保留默认单用户（**无** `avatar` 列，也**无** nickname 列）；`username` 只用作本地默认身份名与老用户迁移兜底，
> 不等于云端昵称：未登录时侧边栏/设置只显示本地 `username`，登录后以云端 `name` 为准（空则回退邮箱前缀）。
> 离线/未登录时头像回退首字母或本地 `avatar_path`。
> `users.name` 是 PB 上的普通文本字段（注册可带、登录后可改），服务端上限 255 字符、客户端限 32 码点，不落本地库。
> 设置快照每用户一条 PB `configs` 记录，
> 本地对齐元数据放 `localStorage` 的 `sync.meta.<userId>` 与 `sync.device`（见 `03-architecture.md` §账户与云同步）。

### 首启与清空
- **双端同一口径**：首启先建默认用户（u_local/honestliu）+ 目标 180 + idle 计时状态（`ensure_bootstrap`），再写 §6.3 演示数据（浏览器 `db/seed.ts::buildSeed`、桌面 `db.rs::seed_demo`），并置 `settings.demo_seeded=1`。
- 播种守卫：**仅「空库 + 未播种」**才写；`is_empty` 只看 lists，单靠它会在清库后每次启动回填，故 `demo_seeded` 是唯一防重播标记（`lib.rs` setup、`idb.ts::initDB`、`db.rs::demo_seeded/mark_demo_seeded`）。
- 「删除数据」与「注销账号」等价：清空业务表 → 重建默认用户 → 置 `demo_seeded=1`，**不重播种**（`idb.ts::clearToFactory`、`commands/user.rs::clear_all_data`）。
- **「退出登录」不在此列**：会话级、可逆，只清 PB 会话，不动任何表（`api/local.ts::logout`、`commands/user.rs::logout`）；要清库必须显式点「删除数据」。

### 计时状态（timer_state 单行）
字段：`phase(idle|focus|break) · mode(pomodoro|countdown|stopwatch) · task_id · running · start_at · end_at · paused_remaining_ms`
- 恢复规则：启动时读入；若 `running` 且 `end_at` 已过：
  - focus 已于关闭期间到期 → 补写该条记录并落到休息待开始。
  - break 到期 → 落到专注待开始。
- 该规则在 `timerStore.init` 与 Rust `db::load_timer_state` 间语义一致（实际结算由前端单属主执行）。
- `mode` 三值语义：`pomodoro`（专注→休息循环、写记录）、`countdown`（递减到点即停、**不写记录**）、`stopwatch`（从 0 增长、永不到期，用户「停止」才写记录且不足 1 分钟不写）。
- `paused_remaining_ms` 随模式变化：番茄钟/倒计时「未开始」时 = 目标专注时长（故显示 25:00）；正计时「未开始」时 = 0（显示 00:00），暂停时 = 冻结的**已用时**。

## 演进规则（变更动线）
1. 改表结构 → 在 `db.rs::SCHEMA`（SQLite 迁移 / `CREATE TABLE IF NOT EXISTS`）与 `db/idb.ts`/`db/store`（IndexedDB）**同时**改。
2. 改口径 → `stats.rs` 与 `queries.ts` **同时**改，双校验必须过。
3. 改种子 → 双端同步改：`db/seed.ts::buildSeed` 与 `db.rs::seed_demo` 必须保持同一份 §6.3 数据与同一套 `demo_seeded` 守卫。
4. 新表需要迁移策略：`IF NOT EXISTS` 对已有库幂等；如需既有数据回填，写一次性迁移函数并在 setup 中按版本号执行。

> **加列（提醒事项字段 2026-10-19）**：`tasks` 新增 `due_time`/`url`/`urgent`/`repeat`/`lead_remind`/`tags`/`flag`/`priority`/`reminded_at` 共 9 列。
> `CREATE TABLE IF NOT EXISTS` 不会给**已有库**补列，故桌面端加了幂等迁移 `db.rs::migrate_task_columns`（`PRAGMA table_info` 判缺再 `ALTER`，与 `migrate_list_icon` 同模式，在 `open`/`open_in_memory` 调用）；
> IndexedDB 侧无列概念，走 `DB_VERSION` 2→3（升级即清空重播种）+ `idb.ts::normalizeTask` 兜底补默认，避免旧库缺字段崩溃。
> `tags` 在 SQLite 存 JSON 文本（`serde_json` 序列化/反序列化），在 IndexedDB 存原生数组。
> **加列必须三处同步**：`db.rs`（SCHEMA + migrate）+ `models.rs`（Task/CreateTaskArgs/UpdateTaskPatch）+ 前端 `types.ts`/`api/types.ts`/`api/local.ts`/`db/seed.ts`；漏一处就会出现「桌面端存了、浏览器端读到 undefined」。
