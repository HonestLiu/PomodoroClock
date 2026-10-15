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
- **现状**：`sort_order` 已存在于 schema，但 UI 未暴露排序；P1 阶段落地。

### 设置键（settings KV）
| 键 | 类型 | 默认 | 现状 |
|---|---|---|---|
| focus_len_min / break_len_min / long_break_len_min / long_break_every | int | 25/5/15/4 | ✅ 已读入计时 |
| daily_target_min | int | 180 | ✅ 同步到 goals 表 |
| auto_start_next | bool | false | ✅ 已接状态机 |
| theme / language / noise / wallpaper | str | light/zh/waves/waves | 🔶 theme、noise、wallpaper 已读；**language 尚未实际切换** |
| noise_volume | float | 0.5 | ✅ |
| noise_on_focus / noise_on_break / notify_enabled / autostart | bool | false | 🔶 已读；autostart 系统侧未接 |

### 计时状态（timer_state 单行）
字段：`phase(idle|focus|break) · mode(pomodoro|countdown|stopwatch) · task_id · running · start_at · end_at · paused_remaining_ms`
- 恢复规则：启动时读入；若 `running` 且 `end_at` 已过：
  - focus 已于关闭期间到期 → 补写该条记录并落到休息待开始。
  - break 到期 → 落到专注待开始。
- 该规则在 `timerStore.init` 与 Rust `db::load_timer_state` 间语义一致（实际结算由前端单属主执行）。

## 演进规则（变更动线）
1. 改表结构 → 在 `db.rs::SCHEMA`（SQLite 迁移 / `CREATE TABLE IF NOT EXISTS`）与 `db/idb.ts`/`db/store`（IndexedDB）**同时**改。
2. 改口径 → `stats.rs` 与 `queries.ts` **同时**改，双校验必须过。
3. 改种子 → `seed_demo`（Rust）与 `seed.ts`（TS）**同时**改。
4. 新表需要迁移策略：`IF NOT EXISTS` 对已有库幂等；如需既有数据回填，写一次性迁移函数并在 setup 中按版本号执行。
