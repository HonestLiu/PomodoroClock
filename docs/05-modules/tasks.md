# 模块 · 任务管理（tasks）

## 目标
任务的全生命周期：创建 → 编辑 → 专注 → 归档 → 组织（排序/移清单/删除），交互密度达到"工具"水平。

## 当前状态
- ✅ 添加（回车）、任务行（名称/预估番茄/到期日）、勾选完成归档、编辑弹层（名称/清单/预估/日期/备注）、删除、「显示已完成任务」折叠。
- ✅ 统计卡片口径、分类筛选。
- ✅ 更多菜单（⋯）/右键（删除/移到清单/复制）【P1 已完成】
- ✅ 任务拖拽排序（视图内重排 + 跨清单移动）【P1 已完成】

## 关键交互与规则

### FR-T3 任务行
```
[○] 任务名称 …………………………  [预估] [日期]
```
- 点勾选 → 完成/未完成（写 `completed_at`）。
- 点行或「编辑」→ 编辑弹层。
- **更多菜单**（★）：行尾 `⋯` 按钮，或右键任务行，弹出菜单：
  - 标记完成 / 标记未完成（取反）
  - 「移到清单 ▸」子菜单（列出全部清单；选择后 `list_id` 更新并重排）
  - 复制（同标题/同预估，新任务）
  - 删除（二次确认，显式红色）
- **拖拽排序**（★）：`[handles]` 拖拽在**当前视图内**重排 `sort_order`；拖到另一清单行上则移动并追加到该清单末尾。桌面端用指针拖拽；不要求对齐精确动画，但落点反馈必须可见。
  **键盘等价**：任务行聚焦后 `Alt+↑/↓` 上移/下移，结果经 `role="status"` 播报（`pages/TaskView.tsx`）。

### FR-T3.1 提醒事项字段体系（2026-10-19，用户需求）
任务条目字段升级为「提醒事项」式（**本期不做**：`发信息时`、`添加附件`）。

- **数据层**：`tasks` 新增 9 列 —— `due_time` / `url` / `urgent` / `repeat` / `lead_remind` / `tags` / `flag` / `priority` / `reminded_at`。
  SQLite 侧走 `db.rs::migrate_task_columns`（幂等 `PRAGMA table_info` 判缺再 `ALTER`）；IndexedDB 侧 `DB_VERSION` 2→3（升级即清空重播种，含 `normalizeTask` 兜底补默认）。`create_task`/`update_task` 双适配器全字段贯通（`tags` 存 JSON 文本，`CreateTaskArgs` camelCase、`UpdateTaskPatch` snake_case）。
- **编辑弹层**（`modals/TaskEditModal.tsx`，13 字段）：标题/备注/URL/日期/时间/紧急(switch)/重复(select 6)/提前提醒(select 4，**无时间置灰**)/清单/标签(回车或逗号添加、× 删除)/旗标(switch)/优先级(select 4)/预估番茄。
- **任务行渲染**（`components/TaskItem.tsx`）：勾选 → 旗帜(`flag`) → 优先级三色点(`priority`，低灰/中蓝/高红) → 紧急红签(`urgent`) → 标题 → 下方 chips(标签 + URL，点 URL 用系统默认浏览器开)；右侧：逾期签 / 重复图标(`repeat`) / 预估 / 到期日(含 `due_time`)。
- **纯函数**：`lib/taskRemind.ts`（`taskRemindAt`/`shouldRemind`/`leadMs`/`dueTimestamp`）、`lib/recurrence.ts`（`nextOccurrence`）。i18n 新增约 20 键，zh/en 键集保持相等。

### 重复引擎（真正重复，`lib/recurrence.ts`）
完成一个 `repeat != 'none'` 的任务时：当前轮标完成进「已完成」，再**新建**同内容、到期=下一次的任务。推进规则（本地时区，纯函数、可单测）：
| repeat | 推进 | 备注 |
|---|---|---|
| `hourly` | 有 `due_time` → +1h（时间进位跨日）；无时间 → 退化 `daily` | 仅时间明确时才是真「每小时」 |
| `daily` | +1 天 | 保留时间 |
| `weekly` | +7 天 | 跨月/跨年由 Date 自然处理 |
| `weekdays` | 下一工作日（周五→下周一，周六→下周一，周日→下周一） | |
| `weekends` | 下一个周六（周六→下周六） | |
| `none` | 不推进 | 普通任务 |
无 `due_date` 以今天为基准。反勾选只还原当前任务，不动已生成的下一轮。接入点：`dataStore.ts::toggleTask`。

### 到时提醒（原 backlog #16，`lib/taskRemind.ts` + `lib/remindScan.ts`）
- `taskRemindAt = DateTime(due_date, due_time) − lead 时长`；**无 `due_time` 不触发**（与规格「时间关闭则无到时提醒」一致；纯日期任务只靠逾期显示）。
- 巡检：`App.tsx` 挂 30s `setInterval` + 启动补查一次。命中（`shouldRemind`：未完成、到点、`reminded_at < remind_at` 或未提醒）→ 写应用内通知（type `task_remind`）→ 置 `reminded_at` 去重 → 若 `notify_enabled && system_notify` 发系统通知。改了时间/日期后 `reminded_at < remind_at` 自动重新武装。

### 时间视图的逾期留驻与来源标注（2026-10-19，用户需求）
- **问题**：今天/明天/本周里的任务一旦到期日滑过窗口，就从该清单消失、只沉在「任务」总表里，极易遗忘。
- **规则**（`tasksForCategory`，`lib/derive.ts` 与 `db/queries.ts` 双份同步）：
  - **今天** = 到期日 ≤ 今天（逾期 + 今天）；**明天** = 严格明天；**本周** = 到期日 ≤ 本周日（逾期 + 本周）。
  - 今天/本周列表**逾期置顶**（到期日升序），其后才是窗口内任务（到期日升序，再 sort_order）。
  - 逾期判定 `isOverdue(task)` = 未完成 && 到期日 < 今天 00:00；任务行显示红色「逾期」签 + 到期日变红（任何视图都显示）。
  - 「已计划」口径不变（全部有到期日，含逾期）；「任务」总表不变。
- **来源徽标**：任务始终归属其 `list_id`；自定义清单任务的到期日落入今天/明天/本周时在对应时间清单出现（筛选本就跨清单），
  行尾显示 `.task-source`（清单色点 + 名称，点击 `navigate({name:'list'})` 跳回来源清单）。内置「任务」清单（`ALL_TASKS_LIST_ID`）不打标。
  由 `TaskView` 仅在 today/tomorrow/week 三个智能视图传 `showListSource` 开启。
- **统计影响**：今天/本周卡片的「待完成/预计时间」随之包含逾期任务（逾期本就该被看见）。
- 验证：`verify-data.ts` 新增 14 条断言（种子逾期任务 + 合成数据集，含置顶顺序与来源归属）；`shoot.mjs` 新增 S1b 截图检查。

### 侧边栏两个「完成」入口（2026-10-19，用户需求）
原「已完成」项展示的是**专注（番茄）记录**，与用户预期的「已完成任务汇总」不是一回事，
故拆成两个常驻入口，`SmartKey` 相应拆键（`types.ts`）：

| 入口 | 路由键 | 页面 | 角标 | 左侧时长 |
| --- | --- | --- | --- | --- |
| **已完成** | `completed` | `pages/DoneView.tsx` | 已完成任务数 | 这些任务关联的专注时长 |
| **记录**（en: Sessions） | `records` | `pages/RecordsView.tsx`（原 CompletedView） | **已完成番茄数**（`focus_records` 条数） | 全部专注时长 |

- 顺序（`Sidebar.tsx::NAV_MAIN` + `NAV_ARCHIVE`，共 7 项，2026-10-19 用户需求）：
  主分类 今天 / 明天 / 本周 / 已计划 / 任务（带时长+角标）→ 分隔线 →
  归档 **已完成** / **记录**（`.nav-archive`，纯导航，**不渲染时长与角标**——累积值随使用无限增长，没有导航价值）
  → 有自定义清单时再补一条分隔线 → 清单夹 / 自定义清单。
- **记录视图**：按 `focus_records.end_at` 日期倒序分组，行=任务名+时长+起止（FR-C1/C2）；统计栏 `RecordsStats`（统计在页面内看，不在侧边栏）。
- **已完成视图**：`completedTaskGroups()`（`lib/derive.ts`）按 `completed_at` 日期倒序分组，行内复用 `TaskItem`
  → 可**反勾选回待办**、编辑、删除；统计栏复用 `StatCards`（总/本周/今日完成 + 已专注时间，同样只在页面内）。
- 两套口径的派生函数在 `lib/derive.ts` 与 `db/queries.ts` **各有一份**（后者供浏览器适配器 / `verify-data`），
  改一侧必须同步另一侧（`tools/check-runtime-parity.sh` 只拦 UI 直连 db，不拦这里的语义漂移）。
- `tasksForCategory` / `completedForCategory` 对 `records` 返回空集合（该视图不是任务集合），
  `computeTaskCards` 对 `records` 返回全 0（记录页不复用任务统计卡）。

### 排序规则（★，需设计）
- 排序持久化到 `tasks.sort_order`；同视图内序号连续化（重排后 `0..n-1`）。
- 拖拽后立即局部更新 DOM + 一次性批量写库（避免每步一次 IPC）。
- 说明：分类视图（今天/本周等）为动态集合，重排只作用于"当前展示顺序"；**从哪视图拖入就更新该集合内任务**；跨清单移动以 `list_id` 为准。
- 幂等：刷新后顺序保持。

## 待办增量（本阶段实现清单）
- ★1 ✅ 更多菜单组件 + 右键（含「移到清单」「复制」「删除」）（2026-10-14 已完成并回归）。
- ★2 ✅ 拖拽排序（视图内重排 + 跨清单移动），批量 `reorder_tasks` 持久化。
- ★2 拖拽排序（视图内重排 + 跨清单移动），批量持久化。
- ★3 视觉：拖拽中的半透明"幽灵"；触手可及的拖拽手柄样式。
- ★4 空态/完成态文案打磨（空列表引导语）。

## 数据影响
- `tasks.list_id` / `tasks.sort_order` 更新（批量语句）。
- 删除沿用 `ON DELETE SET NULL`（记录归「未指定任务」）。
- 复制 = 插入新行（title/est/notes 拷贝，completed=0）；**重复字段（repeat/lead/tags/flag/priority/url）也随复制带过去**。
- 新增提醒字段写入 `tasks` 9 列；到时提醒写 `reminded_at`（内部）+ `notifications` 表 type `task_remind`。
- **重复任务完成** → 写一条 `completed_at` + 插入一条新任务行（到期=下一次）。

## 验收
- [x] 行尾 ▸ 与右键弹出一致菜单；移到清单后立即刷新并按新清单展示。
- [ ] 拖拽重排后顺序持久化，刷新不变；可拖到清单行完成跨清单移动。
- [ ] 复制生成独立新任务；删除有确认且记录保留（归未指定）。
- [x] 提醒字段：编辑弹层 13 项、任务行徽标（旗帜/优先级/紧急/标签/URL/重复/到期含时间）。
- [x] 重复：完成每天/每周/工作日/周末任务 → 自动新建下一轮且到期推进（`verify-data.ts` nextOccurrence）。
- [x] 到时提醒：设 `due_time` 的任务到点发应用内+系统通知，`reminded_at` 去重；无时间不触发（`verify-data.ts` scanTaskReminders）。
- 关联：`06-acceptance.md` B 组、`tasks.ts`/`db.rs`/TS 双实现同步。
