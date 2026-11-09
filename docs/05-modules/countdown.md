# 模块 · 倒数纪念日（countdown）

> 2026-10-20 新增需求。本模块是**独立于任务的数据域**：纪念日不是「有一个 due_date 的任务」，不应混入任务/清单/已完成归档的统计口径（`focus_records`、`tasks.completed` 一律不含纪念日）。UI 风格复用现有 TodoList（浅白卡片、线性图标、圆角），但数据模型独立成表。

## 目标
记录重要日期（生日/纪念日/节日/截数日），直观展示「还有 N 天 / 已经 N 天 / 就是今天」，支持一次性、每年/每月重复、自定义提醒与卡片/列表双视图。

## 当前状态
- ✅ 数据层：`countdowns` 表（SQLite `db.rs::SCHEMA` 幂等建表 + `clear_all` 清空；IndexedDB `DBShape.countdowns`，`DB_VERSION` 3→4）。
- ✅ 双运行时命令面：`list_countdowns / create_countdown / update_countdown / delete_countdown / reorder_countdowns / mark_countdown_reminded`（Rust `commands/countdown.rs` + `api/local.ts` + `api/tauri.ts` 镜像）。
- ✅ 纯函数：`lib/countdown.ts`（自然日差 / 每年重复含闰年 2/29→平年 2/28 / 每月锚点步进 / 自定义间隔 / 已过周年数 / 排序 / 提醒触发日与去重）+ `lib/countdownText.ts`（文案与 i18n 解耦）。
- ✅ 页面：侧边栏「纪念」入口 + `CountdownPage`（卡片/列表双视图、置顶+剩余天数排序、未来/已过分区、空态引导）+ `CountdownEditModal`（10 字段）+ `CountdownCard`。
- ✅ 提醒：`lib/countdownRemind.ts` 接入 `App.tsx` 30s 巡检，应用内通知 `type='countdown_remind'` + 可选系统通知 + `reminded_at` 按触发日去重 + 改期/改提前天数重新武装。
- ✅ 验收：`tools/verify-countdown.ts`（43 项纯函数断言，`check-all.sh` 第 4 步）+ Rust 单测 4 项（`commands/countdown.rs::tests`）+ 浏览器 UI 冒烟 7 项全过。
- ⬜ P2 待办：首页小组件 `CountdownWidget`。

## 页面结构

| 入口 | 形态 | 说明 |
|---|---|---|
| 侧边栏新导航项「纪念」（`countdown`） | 主内容区页面 | 排在校历入口之后、自定义清单之前；纯导航，不显示时长/角标（与归档项一致） |
| 主页小组件 | 首页/任务页可选嵌入 | 显示「最近的几个纪念日 + 倒计时」，点击跳到纪念日页（规格五-1，P2 可选） |
| 创建/编辑 | 模态弹窗（复用 `.overlay`/`.modal` 风格） | 与 `TaskEditModal` / `CreateListModal` 同款 |

- 路由：`uiStore Route` 增加 `{ name: 'countdown' }`（现有 `SmartKey` 不改，避免破坏 `NAV_MAIN` 序号依赖 `tools/shoot.mjs`）。
- 渲染：`App.tsx` 路由 switch 增加 `route.name === 'countdown' ? <CountdownPage/>`。

## 数据模型（独立表，双运行时镜像）

SQLite（`db.rs::SCHEMA`，幂等 `CREATE TABLE IF NOT EXISTS`；IndexedDB 侧 `DBShape` 增 `countdowns: Countdown[]`）：

```sql
CREATE TABLE IF NOT EXISTS countdowns (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,             -- 标题，必填
  date          TEXT NOT NULL,             -- 'YYYY-MM-DD'，本地时区，必填
  kind          TEXT NOT NULL DEFAULT 'days_left', -- days_left | days_elapsed | yearly
  repeat        TEXT NOT NULL DEFAULT 'once',      -- once | yearly | monthly | custom_days
  interval_days INTEGER,                   -- repeat='custom_days' 时的间隔（自然日）
  note          TEXT DEFAULT '',           -- 备注，可选
  color         TEXT DEFAULT '',           -- 图标色（可选）
  icon          TEXT DEFAULT '',           -- emoji/字形（可选）
  pinned        INTEGER NOT NULL DEFAULT 0,
  remind_enabled INTEGER NOT NULL DEFAULT 0,
  remind_days   INTEGER DEFAULT 0,         -- 提前 N 天：0=当天，1=提前1天…
  reminded_at   INTEGER DEFAULT NULL,      -- 本周期已提醒的时间戳（去重）
  sort_order    INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_countdowns_date ON countdowns(date);
```
- **不参与** `focus_records` / `tasks` / 目录统计；`clear_all` 是否清空：与任务一致，砍掉（属业务数据，`clear_all_data` 应一并清）。
- 提醒写入现有 `notifications` 表，`type='countdown_remind'`（避免与任务提醒 `task_remind` 冲突）。
- 倒数日与应用内通知随每用户 `configs.data` 快照同步；配置冲突按账号快照的 `rev → updated → device` 规则处理。

## 日期边界规则（`lib/countdown.ts`，纯函数，可单测）

- **自然日差**：`daysBetween(a,b) = floor((Date.UTC(b.y,b.m,b.d) − Date.UTC(a.y,a.m,a.d))/86400000)`——先把本地 Y/M/D 折成 UTC 零点再差，**禁用 24h 差**（规避 DST/夏令时 ±1h）。
- **文案**（`daysText(n, kind)`，本地时区按当天零点算）：
  - `days_left`：未来 `还有 N 天`；`==0` `就是今天`；已过 `已经过去 N 天`。
  - `days_elapsed`：`已经 N 天`；`==0` `今天`。
  - `yearly`：见下。
- **今天/明天/昨天**：`==0 → 今天`；`==1` 明天；`==−1` 昨天；其余按上面数字文案。
- **yearly（每年重复）**：
  - `nextDate()`：今年该 `MM-DD`；若 `今天 > 今年该日` → 下一年该日；若恰为今年该日 → 「就是今天」。
  - `已过周年数 = 今年 − 建立时年份 + (今年该日已过 ? 0 : −1)`（周年数从存储的 year 起算）。
  - **闰年 2/29**：存储 `02-29` 时，非闰年的「本次日期」按 `02-28` 计入（生日/纪念日惯例）；下一闰年回到 02-29。`isLeapYear` 纯函数。
- **monthly / custom_days**：`nextDate()` 由 `lib/countdown.ts::advanceOnce(date, base)` 推进（每月=同一天+1月、跨月演进 ref；`custom_days`= +interval_days 自然日）。本期**只展示最近一次发生日与下一次发生日**，不做「完成—推进」循环（纪念日无「达成/归档」概念，仅持续倒计时）。
- **统一格式**：一律 `YYYY-MM-DD`；入参校验严格（`parseDateKey` 复用 `lib/date.ts`）。
- 未来日期与过去日期**分区展示**更清晰（见「展示规则」）。

## 展示规则

- **双视图**（`CountdownPage` 顶部切卡）：卡片（默认，封面=icon/首字+color）/ 列表（标题+副行）。
- 卡片元素：标题、图标/色、`还有 N 天` 大字（当周内用 `--accent-focus` 红强调）、日期、备注摘要（超行省略）、置顶 pin。
- **排序**：`pinned` 置顶 → 未来项按剩余天数升序（快的在前）→ 已过项按天数降序 → `created_at`。monthly/custom 取「下一次」参与排序。
- **已过/未来分区**：未来区在前（含「就是今天」），已过区（已过天数）在后，各自排序。
- **空状态**：引导「记下第一个重要日子」按钮 → 打开创建弹窗。
- **年度项**副行显示「第 N 个周年」+ 下一次日期。

## 交互流程

1. **创建**：侧边栏/页面「新增」→ 弹窗：标题*、日期*（原生 `type=date`）、类型下拉（倒数日/已过天数/每年重复）、重复规则（一次性/每年/每月/自定义-间隔天数）、备注、颜色+图标、置顶、提醒开关+提前N天。确认 → `api.create_countdown` → 列表刷新（走 `store.reload`，复用 `data://changed` 事件总线）。
2. **编辑**：点卡片/行 → 同弹窗回填（全部字段可改）；改 `date`/`remind_days` 后 `reminded_at` 置 NULL 重新武装（与 `taskRemindAt` 同策略）。
3. **删除**：行内删除按钮 → 全局二次确认（复用 `ConfirmDialog`，danger 红）。可选「归档」不单做（本期 `pinned=0` 收起即可，避免状态膨胀）。
4. **提醒设置**：弹窗内开关 + `select`（当天/提前1/3/7 天）。无通知权限 / `notify_enabled=false` 时在弹窗与页面提示降级（`应验成果`见下）。

## 提醒（与任务到时提醒同机制，复用 `lib/remindScan.ts` 巡检模式）

- 触发时刻：`remindAt = date − remind_days`（自然日零点）`+`（可选提醒时间，默认 00:00）。
- 巡检：`App.tsx` 现有 30s `setInterval` 追加 `scanCountdownReminders`；命中条件：`remind_enabled && 今天 >= 触发日 && (reminded_at == null || reminded_at < 触发日)`。
- 动作：写应用内通知（`notifications.type='countdown_remind'`）→ 置 `reminded_at`（写当日零点）去重 → `notify_enabled && system_notify` 发系统通知。
- 去重键：以「触发日」而非「当前时刻」——同一天只提醒一次，改回日期后 `reminded_at < 触发日` 自动重武装。

## 组件拆分

| 组件 | 职责 |
|---|---|
| `pages/CountdownPage.tsx` | 页壳：视图切换、排序、空态、挂编辑弹窗 |
| `components/CountdownCard.tsx` / `CountdownRow.tsx` | 卡片 / 列表两种条目 |
| `modals/CountdownEditModal.tsx` | 创建/编辑弹窗（全字段 + 校验） |
| `components/CountdownWidget.tsx`（P2） | 首页小组件 |
| `lib/countdown.ts` | 纯函数：自然日差、文案、nextDate、闰年、周年数、advanceOnce |
| `lib/countdownRemind.ts` | `remindAtFor` / `shouldRemind`（对齐 `taskRemind` 风格） |

## 状态管理

- `useCountdownStore`（Zustand，独立 store）：`list/loading/reload`，不塞进 `taskStore`。
- **数据经 `api`（当前运行时）**，禁止 UI 直连 `db/*`（红线 `tools/check-runtime-parity.sh` 会拦）。
- `api` 增命令：`list_countdowns` / `create_countdown` / `update_countdown` / `delete_countdown` / `reorder_countdowns`；Rust `commands/countdown.rs` + `db.rs` 表；IndexedDB 适配器同步镜像（双份数据校验红线）。
- 变更经 `broadcastDataChanged('countdowns')` → `data://changed` 驱动刷新（与任务一致）。
- 刷新后重新计算天数，**允许前端按当前日期重算，但不缓存过期合计**——排序在 store 里实时算（`lib/countdown.ts` 纯函数）。

## 错误与空状态

- 空数据：引导（见「展示规则」）。
- 校验：无标题/无日期 → 就地红字提示，禁用确认；非法日期字符串拒收。
- 权限：`Notification.requestPermission` 拒绝时，弹窗提醒行提示「通知被系统拒绝，只能应用内提醒」。
- 极值：`remind_days` 负数钳制为 0；空备注/颜色/图标合法；重复自定义间隔 `interval_days>=1`。
- 加载失败：复用 `ErrorBoundary` + 页面重试按钮。

## 验收

- [ ] P0 创建/编辑/删除（含二次确认）；空状态引导。
- [ ] P0 自然日差 / 文案 / 今天·明天·昨天（`verify-countdown.ts` 纯函数 10+ 断言）。
- [ ] P0 每年重复：凌晨跨年自动翻；**闰年 02-29 → 平年按 02-28**；周年数正确。
- [ ] P0 每月 / 自定义间隔的「下一次」计算正确（跨月/跨年）。
- [ ] P0 卡片/列表切换、置顶+剩余天数排序、已过/未来分区。
- [ ] P0 提醒：当天/提前 N 天应用内通知 + `reminded_at` 同天去重；权限降级提示；改期重武装。
- [ ] P1 dual-runtime：SQLite 与 IndexedDB 结果一致（`check-runtime-parity` 红线 + 双份数据校验）。
- [ ] P1 i18n zh/en 键集一致；深色主题。
- [ ] P2 主页小组件；月度项归档可见性。

## 工作量估计
S/M（适中―偏大）：库表+纯函数 (S) → 页面/弹窗/行 (M) → 提醒+验收 (M)。建议分两个里程碑：**M1** 数据层+纯函数+页面骨架+空态；**M2** 重复/提醒/视图/i18n/验收。参照 `docs/07-backlog.md` #38-#42。
