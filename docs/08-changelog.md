# 08 · 变更与缺陷记录

> 记录**已修复的缺陷**与**重要变更**，供回归与追溯。每条含：现象、根因、修复、验证、防复发。

---

## 2026-10-20 · 日历交互与布局修复（10 项 UI 打磨）

### 需求
日历首版交付后的 10 项界面/交互修复：① 事件点击补「跳任务编辑 + 完成勾选」；② 接管日历右键（不出原生菜单，出软件菜单）；③ 周视图 00:00 刻度被表头遮挡；④ 周视图今日蓝圆样式优化；⑤ 今日列比其他列凸出、要求等高；⑥ 日视图重新设计（含 00:00 遮挡）；⑦ 日程视图「周二」与节点圆圈粘连；⑧ 多日视图 00:00 遮挡；⑨ 多日视图今日列凸出；⑩ 去掉橙色「立即升级」按钮。

### 根因与修复
- **③⑥⑧ 00:00 被遮挡 + 下午网格消失**：两处根因叠加。其一，时间轴刻度从容器顶 0 起算，而列内「表头 + 全天条」占 78px（日视图 110px），首刻度落在表头背后。其二，`.cal-cols`/`.cal-col` 未给 `min-height: max-content`，flex 拉伸把列框压到视口高度（653px）而正文仍是 1056px，向下溢出，粘性表头（不透明白底）盖住 13:00 之后的网格线与列分隔线 —— 表现为「过 12 点只剩分割线」。修复：表头/全天条/正文高度统一收进 CSS 变量 `--tl-head-h`/`--tl-strip-h`/`--tl-body-h`（日视图 84px 覆盖），时间轴用 `height: calc(var(--tl-head-block) + var(--tl-body-h))` 显式撑满，刻度 top 用 `calc(var(--tl-head-block) + h × HOUR_PX)` 偏移，删掉原先 JS 硬编码的 `HEAD_H/STRIP_H` 与 `.cal-axis-spacer`；`.cal-cols`/`.cal-col` 加 `min-height: max-content`，各视图滚动容器补 `min-height: 0` 保证内部滚动。
- **⑤⑨ 今日列凸出**：`.cal-col-head` 原为 `padding` 撑高，今日 30px 蓝圆使该列比别列高 ~12px，各列正文起点错位。修复：列头改 `height: 52px` 固定盒 + flex 居中，今日圆点缩为 26px 且在盒内；多周视图 `.cal-mw-daynum` 固定 `22px` 行高（今日圆点在同行高盒内）。各列总高、正文起点全部一致。
- **④ 今日圆点样式**：星期文字今日变蓝加粗，日期 26px 蓝底白字圆 + 柔和投影（`rgba(74,125,224,.32)`），替代原 30px 生硬圆。
- **⑥ 日视图重设计**：单列时表头改为横幅式 `.cal-day-banner`——44px 大日期圆（今日蓝底白字）+ 右侧「星期 / 月份」两行元信息，固定 84px 高。
- **⑦ 日程视图粘连**：`.cal-schedule` 左内边距 96→120px，`.cal-sched-date` 宽 72→80px，日期文字右缘停在 -40px、节点圆圈在 -27px 起，留 13px 间距。
- **① 跳编辑 + 完成勾选**：事件详情弹层每行加「完成勾选圆钮」（`toggleTask`，完成后标题划线）与「编辑铅笔」（`setEditingTask` 直接打开既有 `TaskEditModal`）。
- **② 右键接管**：`CalendarPage` 根容器 `onContextMenu` 一律 `preventDefault`；自建 `CalendarContextMenu`（复用全局 `.ctx-menu` 样式）——事件上右键出「编辑任务 / 标记为已完成(或未完成) / 删除任务（走全局二次确认）」，空白处（含各视图日期格）右键出「添加日程」（在该格日期建任务并开编辑弹层）。月/周/日/日程/多日/多周全部接线，`stopPropagation` 防止事件右键冒泡成空白菜单。
- **⑩ 升级按钮**：删除胶囊工具栏内 `.cal-upgrade` 按钮及样式，i18n 移除 `calendar.upgrade`（zh/en 同步，键集仍一致）。

### 验证
- `npx tsc --noEmit` 干净；`bash tools/check-all.sh` 7/7 全绿（含 `verify-calendar.ts` 41 条纯函数断言）。
- Playwright DOM 断言 37 项全过：升级按钮消失、弹层勾选/编辑可用且编辑跳 `TaskEditModal`、右键菜单三操作 + 空白新建、周/日/多日 00:00 位于表头块之下、周/多日各列表头与总高一致且正文起点对齐、今日圆 26px 在盒内、日视图横幅 84px + 大日期圆 44px、日程日期与节点 gap=13px、多周日期行等高 22px，**另含下午回归（正文仍 1056px、网格线背景存在、各列等高）与启动页两态（日历/番茄钟）**。
- 截图核对（周/日/日程/多周/右键菜单 + 下午区域）：00:00 清晰可见、10:00–23:00 网格与列分隔线完整、各列齐平、菜单项正确。

## 2026-10-20 · 启动页可配置

### 需求
默认启动直接展开番茄钟专注界面；希望可配置为侧边栏任一页，在设置里切换。

### 实现
- **数据**：`Settings` 新增 `startup_page: StartupPage`（`'timer' | SmartKey | 'calendar'`，默认 `'timer'`），TS 类型 + `DEFAULT_SETTINGS`、Rust `Settings` struct/`Default` + `load_settings` 匹配臂同步补齐（双运行时锁步，云同步白名单随 `DEFAULT_SETTINGS` 自动纳入）。
- **UI**：设置 → 通用 新增「启动页」下拉（番茄钟展开视图 / 今天 / 明天 / 本周 / 已计划 / 任务 / 已完成 / 记录 / 日历），走既有 `patch('startup_page', …)`；i18n zh/en 各 3 键（`general.startupPage` / `startupPageHint` / `startup.timer`）。
- **启动行为**：`App.tsx` 改为 `initTimer({ openScreen: false })` 先加载设置，再按 `startup_page` 分流——`'timer'` 显式 `openScreen(true)`（与原行为一致），否则 `navigate` 到对应路由且不覆盖专注界面。`timerStore.init` 接受可选 `{ openScreen }`，缺省语义不变（恢复既有会话仍自动展开）。

### 验证
- `npx tsc --noEmit` / `cargo test`（17 项）/ `bash tools/check-all.sh` 7/7 全绿。
- Playwright：经设置页真实下拉切到「日历」→ 重载后停在日历且不弹专注界面；切回「番茄钟」→ 重载后展开专注界面（两项均入 DOM 断言套件）。

## 2026-10-20 · 日历组件（7 视图：年/月/周/日/日程/多日/多周）

### 需求
新增日历组件，侧边栏留入口；7 种视图（年/月/周/日/日程/多日/多周）流畅切换；白底浅灰网格、马卡龙低饱和事件色块、底部黑色胶囊工具栏（含橙色「立即升级」）、右下角星光快捷按钮、时间网格视图带红色当前时间线与重叠平分列宽。

### 实现
- **模型层** `src/lib/calendar.ts`（纯函数，零 React 依赖）：
  - 事件来源=**任务派生**（有 `due_date` 即进日历；有 `due_time` → 60 分钟时段块，无时间 → 全天条），不新建事件存储；颜色按 `list_id` 稳定哈希取马卡龙色。
  - `layoutTimeColumn`：链式重叠分簇（簇结束取**簇内最大结束时间**，非最后入簇事件）→ 贪心列分配 → 按**实际并发列数**平分列宽错开；过短事件保底 15min 可点高度；输入乱序结果确定。
  - `shift`/`weekDates`/`multiDayDates`/`multiWeekDates`/`rangeLabel`/`monthName`/`weekdayName` 均走 `lib/date` 的本地语言下发（中英自动切换），周一起始。
- **视图层** `src/pages/calendar/`：`CalendarPage`（外壳：顶栏区间标题+`+`添加+视图下拉+翻页+今天；底部胶囊 7 视图切换+升级按钮；右下星光 FAB 切日程视图；事件详情弹层）+ `YearView`（3×4 月卡、微型日期网格、有事件日浅紫填充、点月→月视图/点日→周视图）+ `MonthView`（7 列、非本月置灰、选中蓝圆、色块+`+N 更多`→日视图）+ `TimelineGrid`（周/日/多日共享：左 00:00–23:59 时间轴、全天条区、绝对定位事件块+左侧深色边框、今天列红色当前时间线）+ `ScheduleView`（垂直时间线列表：日期+时间+空心节点+竖线+圆角卡片）+ `MultiWeekView`（2 周 14 天、事件短条平铺）。样式 `src/styles/calendar.css`。
- **接线**：`uiStore.Route` 新增 `{ name:'calendar' }`（独立路由，不污染 `SmartKey`）；`App.tsx` 分流；`Sidebar.tsx` 日历入口（**刻意排在归档项之后**，保持 `.nav-item` 序号不变，`tools/shoot.mjs` 按序号定位）；`TaskView` 对 calendar 路由兜底为 `tasks`。
- **交互**：`+` 创建带默认标题（`create_task` 拒绝空标题）的任务并立即打开既有 `TaskEditModal` 改名；事件点击弹详情；`+N 更多` 弹当日事件列表。
- **i18n**：zh/en 各新增 17 键（`nav.calendar` + `calendar.*`），含 `calendar.more` 带 `{n}` 占位；视图内不残留硬编码中文（星期、更多、全天、空态全部走词表）。

### 验证
- `tools/verify-calendar.ts`（**并入 `tools/check-all.sh`**，第 7 步）：41 条纯函数断言——任务→事件映射（全天/时段/时长/紧急透传）、shift 六视图区间、周一起始与网格对齐、**重叠布局**（不重叠满宽/两件 50% 错开/链式 3 件 2 列/长事件主导簇宽/乱序确定性/保底高度）、区间标题 zh 文案、取色稳定性、时间线像素。
- 浏览器 DOM 断言（Playwright，临时脚本已删）：7 视图切换后结构正确（年 12 月卡、月 35/42 格裁行合法、周 7 列 24 刻度 1 条当前时间线、日 1 列、多日 4 列、多周 14 格+7 表头）、胶囊 7 按钮+升级+FAB+下拉 7 选项、点击事件/全天条出弹层、`+` 打开编辑弹层；钻取交互（月→日、年月卡→周）正确；无控制台错误。
- 英文界面：切 en 后日历 UI 文案无中文残留（事件标题属用户数据，不计）。
- `bash tools/check-all.sh` → **7/7 全绿**（原 6 项 + 日历模型层）。

### 防复发
- 日历**只读派生**任务数据；要加事件字段先改 `tasks` 模型 + `tasksToEvents`，再补 `verify-calendar.ts` 断言。
- 视图内一切用户可见文案必须走 `calendar.*` 词表键（中英键集由 parity 检查把关）；星期/月份名走 `lib/date` 的 `getDateLocale()`，勿硬编码。
- 侧边栏插入口时保持 `.nav-item` 顺序（`shoot.mjs` NAV 常量依赖序号），新入口一律追加在归档区之后。
- 重叠布局改动必须跑 `verify-calendar.ts` 的链式重叠/乱序两组断言（曾踩过「簇结束只看最后入簇事件」的坑）。

---

## 2026-10-20 · 番茄钟长时运行崩溃（SIGABRT）：WKURLSchemeTask 后台线程响应改主线程

### 现象
开启番茄钟倒计时运行约 30 分钟后，应用直接崩溃退出。macOS Crash Report（EXC_CRASH / SIGABRT），`panic = "abort"` 生效（release 无回溯）。崩溃线程 14 `tokio-rt-worker`，栈：`abort → panic 处理 → <Rust 响应逻辑> → -[WKURLSchemeTaskImpl didFinish]`；线程 13 卡在 `WTF::callOnMainRunLoopAndWait(getExceptionTypeFromMainRunLoop)`；主线程阻塞在向 WebContent 进程同步发 IPC。终止原因 `abort() called`。

### 根因
Tauri 2 / wry 0.57.0 的**自定义协议响应不在主线程**：
- 前端每一次 `invoke`（倒计时期间每秒多次：每秒 tray 标题 + 每 250ms tick 驱动状态）都经 `ipc://` POST → 在 **tokio worker** 上执行命令并回调 `responder`。
- wry `url_scheme_handler.rs` 的 responder 直接在当前线程执行 `task.didReceiveResponse/didReceiveData/didFinish`（`WKURLSchemeTask` 的 `did*` 方法**必须**在主线程）。
- Tauri 的 `tauri://localhost` 资源协议同样 `async_runtime::spawn` 后在 tokio 上响应（`tauri-2.12.3/src/protocol/tauri.rs`）。
- WebKit 的 `getExceptionTypeFromMainRunLoop` 在非主线程调用时会**同步跳主线程**。当主线程恰好也正在向 WebContent 同步发消息（`IPC::Connection::sendMessage`，需等 WebContent 网络应答）时，后台线程的同步跳等待主线程、主线程的同步等又依赖网络——与另一条同样阻塞的 worker 形成**嵌套等待 → WebKit 断言 → abort**。崩溃通常发生在倒计时高并发 IPC 期间而非同刻单个调用错误（小请求多/快时无感，长会话必然触发）。

### 修复（本地 vendor 补丁，非上游）
- `[patch.crates-io] wry = { path = "vendor/wry" }`，vendor 一份 **wry 0.57.0**。
- `vendor/wry/src/wkwebview/class/url_scheme_handler.rs`：新增 `run_on_main_thread`，把 `didReceiveResponse/didReceiveData/didFinish`（连同任务有效性校验）整体 `dispatch2::Queue::main().exec_async` 到**主队列**异步执行（串行、保序、不阻塞 worker）。404 路径同样处理。新增 `[target.'cfg(target_vendor="apple")'.dependencies.dispatch2]`（版本 0.3，锁文件已含 0.3.1）。
- 附带性能优化 `commands/tray.rs::set_tray_phase`：同阶段图标去重（`TrayState.last_phase`），避免倒计时期间每秒重建菜单栏图标（AppKit/LaunchServices 开销与崩溃现场主线程占用同源）。
- Cargo.lock 无需额外引入：`dispatch2` 本为 wry 传递依赖，补丁 manifest 直接沿用。

### 验证
- `cargo build`（debug）通过；wry 补丁与 `set_tray_phase` 签名变更均编译通过。
- 需真机回归：macOS 跑 ≥40 分钟倒计时，确认不再 SIGABRT；`tray` 图标红/蓝切换正常。浏览器端不受影响（补丁仅 Tauri/wry 运行时）。

### 防复发
- **升级 wry 前必须重看本补丁**：上游 dev 分支（截至 2026-10）`url_scheme_handler.rs` 仍无主线程派发，未修复。升级时 diff `vendor/wry` 与上游，确认 `run_on_main_thread` 用法可移植后更新 manifest 注释。
- 任何新增「谈完才发事件」的 Tauri 命令（尤其高频、由后台 task 完成）都要确认最终响应是否会触发 `WKURLSchemeTask did*` 且不在主线程——除非自建自定义 scheme，否则一律走 wry 主线程派发。
- 勿把 `panic` 改回 unwind 当作修复：崩溃根因是跨线程嵌套等待，不是 panic 内容。

---

## 2026-10-19 · 任务条目升级为「提醒事项」字段体系（重复引擎 + 到时提醒）

### 用户需求
把任务条目标齐苹果「提醒事项」的字段组成：标题、备注+URL、日期、时间（到时应用通知）、紧急、重复（**真正重复**）、提前提醒（无/1天/2天/1周）、列表、标签、旗标、优先级。经确认 **本期不做**「发信息时」与「添加附件」（均不进数据模型）。

### 实现
- **数据层**：`tasks` 新增 9 列 `due_time`/`url`/`urgent`/`repeat`/`lead_remind`/`tags`/`flag`/`priority`/`reminded_at`。
  - SQLite：`db.rs::migrate_task_columns` 幂等加列（`PRAGMA table_info` 判缺再 `ALTER`），`TASK_COLS`/`row_to_task`/`INSERT`/`UPDATE` 全字段贯通，`tags` 存 JSON 文本（`serde_json`）。
  - IndexedDB：`DB_VERSION` 2→3（升级即清空重播种），`idb.ts::normalizeTask` 兜底补默认，避免旧库缺字段崩溃。
  - `models.rs`：`Task` 加 9 字段；`CreateTaskArgs`（camelCase）+ `Default`；`UpdateTaskPatch`（snake_case，`due_time` 用 `double_option` 支持显式 null）。
  - `api/types.ts`、`api/local.ts::create_task`、`db/seed.ts::mkTask` 同步。
- **编辑弹层** `TaskEditModal.tsx` 重建为 13 字段，复用 `.field`/`.switch`/`select` 栅格；标签 chips 回车/逗号添加、× 删除；**无时间时提前提醒置灰**。
- **任务行渲染** `TaskItem.tsx`：旗帜(`flag`)、优先级三色点、紧急红签、标签 chips、URL 链接（`window.open` 系统默认浏览器）、重复图标、到期含 `due_time`。`isOverdue` 扩展：带时间按「到期时刻 < 现在」判。
- **重复引擎**（真正重复）`lib/recurrence.ts`：`nextOccurrence` 纯函数。完成 `repeat != 'none'` 的任务时当前轮进已完成 + **新建**下一轮（`dataStore.toggleTask`）。规则：hourly 有时间 +1h（跨日进位）/无时间退化 daily；daily +1；weekly +7；weekdays 下一工作日（周五→周一）；weekends 下一个周六。反勾选只还原当前轮。复制任务也带上全部提醒字段。
- **到时提醒**（原 backlog #16）`lib/taskRemind.ts` + `lib/remindScan.ts`：`taskRemindAt = DateTime(due_date, due_time) − lead`；**无 `due_time` 不触发**（与规格一致）。`App.tsx` 挂 30s 巡检 + 启动补查，命中写应用内通知（type `task_remind`）+ 系统通知，并置 `reminded_at` 去重；改时间后 `reminded_at < remind_at` 自动重新武装。
- **i18n**：新增约 20 键（字段标签/重复 6 项/提前 4 项/优先级 4 项/提示/通知文案），zh/en 键集保持相等。

### 验证
- `cargo test --test queries`：**17 passed**（含新增 `reminder_fields_round_trip`，覆盖 tags JSON 往返、`due_time=null` 写 NULL、`reminded_at` 写入、未改字段保持）。
- `tools/verify-data.ts` 新增 21 条纯函数断言：`nextOccurrence` 10 条（daily/weekly/hourly 时间进位/hourly 退化/weekdays 跨周五/weekends 周六→下周六/none/无日期）、`leadMs`、`dueTimestamp`、`taskRemindAt` 提前跨天、`shouldRemind` 未到点/已完成/去重/改时间重新武装；`scanTaskReminders` 注入 deps 断言（扫描1 只触发到点任务、写 1 条通知、置 `reminded_at`；扫描2 已去重不再触发）。
- 浏览器端到端（临时脚本，已删）：编辑弹层 13 项齐全 + 重复/提前/优先级选项数 + 无时间置灰；填全字段保存 → 任务行旗帜/优先级点/紧急签/标签2 chips/URL/重复图标/到期含 09:30 全部渲染；完成「每天」重复任务 → 数量不变且下一轮到期 11-20→11-21；到时提醒写通知 + `reminded_at` 去重。
- `bash tools/check-all.sh --with-shots` → **7/7 全绿**（截图断言 13 → **16 项**，新增「编辑弹层字段齐全」：字段数 ≥13、switch=2、重复 6/提前 4/优先级 4、无时间置灰）。

### 防复发
- `tasks` 表列改动必须三处同步：`db.rs`（SCHEMA + `migrate_task_columns`）、`models.rs`（Task/Create/Update）、`api/types.ts` + `api/local.ts` + `db/seed.ts`；漏一处就会出现「桌面端存了、浏览器端读到 undefined」。
- 「重复」「到时提醒」均为纯函数（`lib/recurrence.ts` / `lib/taskRemind.ts`），改规则先补 `verify-data.ts` 断言再改实现。
- 到时提醒去重靠 `reminded_at`；改 `taskRemindAt`/`leadMs` 公式时必须同步 `shouldRemind` 的 `<`/`<=` 比较，否则会重复弹或永不弹。

---

## 2026-10-19 · 时间视图逾期留驻 + 自定义清单来源徽标

### 用户需求
1. 今天/明天/本周里的任务过期后会掉进「任务」总表，容易遗忘 → **仍留在对应时间清单**，加逾期标志。
2. 自定义清单里的任务到期日落在今天/明天/本周时，自动归入这些时间清单，并**标注来源清单**。

### 实现
- `tasksForCategory`（`lib/derive.ts` + `db/queries.ts` 双份同步）：今天 = 到期日 ≤ 今天（逾期+今天）；明天 = 严格明天；本周 = 到期日 ≤ 本周日（逾期+本周，今天 ⊂ 本周）。
- 今天/本周排序改为**逾期置顶**（到期日升序 → 窗口内到期日升序 → sort_order/created）。
- 新增 `isOverdue(task)`；`TaskItem` 渲染红色「逾期」签（`task.overdue` i18n，逾期/Overdue）+ 到期日红色加粗，任何视图都显示。
- `TaskItem` 新增 `showListSource` 开关（TaskView 仅在 today/tomorrow/week 传入）：自定义清单（非 `ALL_TASKS_LIST_ID`）任务显示 `.task-source` 徽标（清单色点+名称，点击跳回来源清单）。
- i18n 新增 `task.overdue`、`task.fromList`（zh/en 键集 362=362）。

### 验证
- `verify-data.ts` 新增 14 条断言：种子 3 任务（到期日=昨天）今天=3/明天=0/本周=3、逾期置顶、`isOverdue` 边界（无日期/已完成不逾期）；合成 6 任务数据集覆盖四个时间视图与来源归属。
- `shoot.mjs` 新增 `S1b-today` 截图与断言（3 行全部红色逾期标志、内置清单无来源徽标），截图断言 13 → **14 项**。
- 浏览器端到端（临时脚本，已删）：合成「逾期 3 天 / 今天 / 明天 / 本周」4 个自定义清单任务 → 今天含逾期+今天、明天仅明天、本周含全部，逾期签与来源徽标齐全，点徽标跳到「探针清单」。

---

## 2026-10-19 · 侧边栏「已完成」拆为「已完成（任务）」+「记录（番茄）」，归档项移入任务下方且去掉累积数字

### 用户需求
> 「已完成」页显示的貌似是已完成的番茄，不是我所想的已完成任务汇总；把当前「已完成」侧边栏项
> 改成已完成番茄数项（名字自取、别用「已完成」、尽量简短），再新增一个「已完成」常驻项显示所有已完成任务。

原「已完成」视图的数据源是 `focus_records`（S2 截图事实就是专注记录），确实不是任务归档——两者语义不同，拆开而非改一个。

### 实现
- **键拆分**：`SmartKey` 增加 `'records'`（`types.ts`）。`completed` 的语义收窄为「勾选完成的任务」，`records` = 专注归档。
- **侧边栏分组**（`Sidebar.tsx::NAV_MAIN` + `NAV_ARCHIVE`）：7 项，顺序为
  主分类 今天/明天/本周/已计划/任务 → `.nav-divider` → 归档 **已完成**/**记录**（`.nav-archive`）→ 有自定义清单时再一条 `.nav-divider` → 清单夹/自定义清单。
  图标 `CheckCircle2` / `History`；`DOT_COLORS` 给已完成 `#5A9E8E`、记录 `#8A8A8A`。
- **归档项不显示累积数字**（用户需求）：两项的 `.nav-time` / `.nav-count` **一律不渲染**——已专注时长与任务/番茄数只随使用单调增长，
  久用后变成巨大数字，没有导航价值；完整统计收进页面内（`DoneView` 的 4 张统计卡、`RecordsView` 的 `RecordsStats`）。
  （中途曾让两行都显示时长+角标，同日按用户反馈去掉，最终形态以本条为准。）
- **口径函数仍保留**（`lib/derive.ts` / `db/queries.ts` 同步，供页面统计与 `verify-data` 校验）：
  `categoryTaskCount('records')` = `focus_records.length`（已完成番茄数）、`categoryTaskCount('completed')` = 已完成任务数、
  `categoryFocusMinutes('records')` = 全部专注时长——只是侧边栏不再消费它们。
- **路由**（`App.tsx`）：`records` → `RecordsView`，`completed` → `DoneView`，其余（含清单）→ `TaskView`。
- **页面**：`pages/CompletedView.tsx` → `pages/RecordsView.tsx`、`components/CompletedStats.tsx` → `components/RecordsStats.tsx`（`git mv` 保历史）；
  新增 `pages/DoneView.tsx`（`completedTaskGroups()` 按 `completed_at` 倒序分组 + `TaskItem` 行内反勾选/编辑/删除 + `StatCards` 四卡）。
- **派生防御**：`tasksForCategory` / `completedForCategory` 对 `records` 返回空集合，`computeTaskCards` 对 `records` 返回全 0（记录页不用任务统计卡）。
- **i18n**：新增 `nav.records`（记录 / Sessions）、`records.empty`（还没有专注记录 / No focus sessions yet），zh/en 键集仍相等。

### 缺陷修复
- **自定义清单「已专注时间」恒等于总专注时间（用户反馈）**：清单视图把 key 压成 `'tasks'` 且 `isTasksSmart=false`，
  `computeTaskCards` 没有清单入参，已专注时间落到 `tasksForCategory(ds,'tasks')`（**全部未完成任务**）分支 → 任何清单都显示全局总时长；
  预计时间也误用「今日到期」口径（清单待办无到期日时恒为 0）。修：函数签名加 `listId`（`lib/derive.ts::computeTaskCards`），
  清单视图的待办集合取 `tasksInList(ds, listId)`、已专注时间按**该清单全部任务（含已完成）的记录**汇总（与侧边栏 `listAggregate` 同口径）、
  已完成数按清单过滤；`TaskView.tsx` 传入 `listId`。`verify-data.ts` 新增 10 条回归断言（内置清单 529/自定义清单 30 + 预计时间/待办/已完成 + 智能「任务」不被污染），
  浏览器端到端（临时脚本）复核：空清单 0 分钟 → 注入本清单记录后 30 分钟、侧边栏 30m、全局视图仍 9小时29分钟。
  - 注：历史 `focus_records.list_id` 冗余列**不参与**此统计（统计按 task_id → 当前任务清单归属，任务移清单后历史时长跟随任务，与 `listAggregate` 一致）；
    报表环形图仍用冗余 `list_id`（按归档时清单）——两套口径都已存在，未在本次改动范围内统一。

**验收脚本的日期相关假失败（本轮跑测暴露）**
- **`verify-data.ts` 用 `toISOString()` 取「今天」**：那是 UTC，本地 00:00–08:00（UTC+8）之间取到昨天的键，`今天组条数` 必错 → 改 `toDateKey(new Date())`（`lib/date` 本地时区）。
- **「本周」期望值硬编码 `8小时59分钟`**：种子按「今天/-1/-2」生成，**今天是周一或周二**时更早的种子日落到上一周，本周合法地小于总时长（本轮正撞上周一 10-19，故周一时必红）。
  → 改为在测试内**独立**算一遍周一窗口（`(dow+6)%7` 回推），断言 `本周 == 窗口内记录之和`，另断言「本周==总」仅在非跨周日成立。
- **`src-tauri/tests/queries.rs::stats_match_screenshot_spec` 同一根因**：`assert_eq!(week_focus_min, 539, "本周 = 总")` 在周一周二必失败 → 测试内用另一套 SQL 写法（`strftime('%w')` 回推）独立重述同一口径，`cargo test` 回到 16/16。

### 验证
- `bash tools/check-all.sh --with-shots` → **7/7 全绿**：tsc / 运行时红线 / 种子口径（含新增 6 条「已完成·记录」口径断言）/ `verify-timer` 20/20 / `cargo test` **16 passed** / build / 截图 **13 项断言**。
- `tools/shoot.mjs`：`NAV` 序号更新为最终 7 项分组（tasks=4、completed=5、records=6）；
  新增首屏「侧边栏分组」结构断言（主分类 5 项各有 2 个 meta 元素、归档 2 项 0 个、带 `.nav-archive` 类、分隔线 ≥1）；
  新增 `S2-records`（记录视图，`.group-head` 3 + `.record-item` 22）与 `S2b-tasks-done`（已完成视图，空态 + 无 `.record-item`）；
  断言只看**结构与高亮序号**、不碰任何文案（英文界面对照也要成立），截图断言 9 → **13 项**。

### 防复发
- 「已完成」一词在本仓已出现两种口径：**任务归档**（`tasks.completed`）与**番茄归档**（`focus_records`）。
  新增视图/统计前先确认数据源；改任一侧的 `derive.ts` 必须同步 `db/queries.ts`（浏览器适配器 + `verify-data` 走后者）。
- 验收断言里凡涉及「今天 / 本周」，一律用本地时区工具（`toDateKey` / 独立周一窗口），**禁止 `toISOString()` 与硬编码跨周恒等值**。

---

## 2026-10-18 · 专注界面三种计时模式（倒计时 / 正计时）+ 验收工具增强

### 能力补齐（用户需求）
用户要求专注界面同时提供「25:00→00:00 的倒计时」与「00:00 到无限大的正计时」，第三模式沿用原有番茄钟。三种模式**共用同一状态机**（`phase` + 绝对时间戳），差别只在时长、到期判定与结算归属。

- **番茄钟 `pomodoro`**：行为未变 —— 25 分钟专注 → 写 `focus_record` → 进休息循环（`auto_start_next` 可配）。
- **倒计时 `countdown`**：从 `focus_len_min` 递减到 00:00 **即停**：反馈「倒计时结束 ✓」、phase 回 `idle`（「准备开始」）、广播 `timer://finished`（payload 带 `mode:'countdown'`，托盘/侧栏据此区分）、系统通知 `countdown_done`、响铃；**不写 `focus_record`、不进入休息循环**。
- **正计时 `stopwatch`**：从 00:00 往上、`isExpired` 恒 false（永不到期）；运行中主按钮变「停止」→ `timerStore.ts::stop()` 写记录（时长 = `round((now−start_at)/60000)`）；**不足 1 分钟不写**并提示「不足 1 分钟，未记录」（`finalizeFocus` 改返回 `boolean`）。暂停冻结已用时（`paused_remaining_ms`），恢复时 `start_at = now − 已用时`，**暂停时长不计入专注时长**。

### 缺陷修复
- **切模式后起始值错误**：`setMode` 把 idle 的 `paused_remaining_ms` 一律设成 `focus_len_min`，而 `engine.ts::displayMs` 只在该值为 null 时才回退 fallback → 切到正计时仍显示 25:00。修：新增 `timerStore.ts::idleDurationFor(mode, settings)`（正计时 0、其余 = 专注时长），`setMode/setSettings/reset/stop/checkExpiry` 全部改用它，不再硬编码 `Math.round(settings.focus_len_min*60_000)`；`displayMs` 的 idle 分支改为**一律**回退 fallback。
- **模式菜单压住主按钮**：原复用 `.seg` 分段控件，在工具条窄宽度下被挤成竖排单字并覆盖主按钮。修：专用 `.timer-mode-menu`（`position:absolute; bottom:44px`、矮屏 `@media (min-height:700px)` 抬到 `104px`、`white-space:nowrap` + `display:flex`、`z-index:5`、白底 + 阴影，`button.active` 用 `--accent-focus`）。
- **「剩余 10 秒」闪烁在正计时出现**：`TimerScreen.tsx` 的 `warn` 加 `state.mode !== 'stopwatch'` 守卫；`.timer-sub` 在正计时显示 `timer.elapsed`（已专注），其余显示 `timer.remaining`。
- **双引擎漂移一项对齐**：`src-tauri/src/timer_engine.rs::remaining_ms` 的正计时分支改为 `(running, start_at) ⇒ now-start_at`，否则回 `paused_remaining_ms`（原先暂停直接返回 0，菜单栏倒计时会归零，与前端 `displayMs` 不一致）→ `07-backlog.md` #25 该条勾掉，其余漂移项保留。
- **i18n**：新增 `timer.feedback.tooShort`；键集 zh/en 一致（**脚本核对键集相等、无缺/无重复**；本轮新增 1 键）。

### 工程化
- **新增 `tools/verify-timer.ts`**（纯函数自检，20 条断言）：三模式未开始时显示值、倒计时 `end_at` 与递减、到点才判到期、正计时 `end_at === null` 且永不到期、正计时暂停冻结 + 恢复不含暂停时长、倒计时暂停冻结剩余 + 恢复顺延、休息时长（5 分钟 / 每 4 个番茄 30 分钟长休息）、stopwatch 无阶段时长。跑法 `npx tsx tools/verify-timer.ts` → **20/20**。
- **`tools/check-all.sh` 增加第 4 步**「计时模式口径（verify-timer.ts）」，现共 **7 步**：tsc → 一致性红线 → 种子口径 → 计时模式口径 → cargo test → 生产构建 → 截图验收。
- **`tools/shoot.mjs` 9 项断言**（原 7 + 白噪音 + 本轮 2 项）：新增「计时模式菜单 3 项且一行排开（`.timer-mode-menu button` = 3、top 坐标差 < 2px）」「计时模式起始值正确（倒计时 25:00 / 正计时 00:00）」；账号页断言同步为当前结构（`.acct-section >= 2`、`.acct-row-actions .btn.primary`、`.acct-link`、`.btn.danger`，旧 `.account-card` 等必须为 0）。

### 验证
- `bash tools/check-all.sh --with-shots` → **7/7 全绿**（截图 9 项断言全绿、console 无错误）。
- `npx tsx tools/verify-timer.ts` → **20/20**。
- 浏览器临时脚本（未入仓）实测 **11/11**：倒计时到期提示且不写 `focus_record`、主按钮回「开始专注」、阶段回「准备开始」；正计时往上走、运行中主按钮「停止」、不足 1 分钟不写记录并提示。

### 防复发
- 三模式语义只在 `timer/engine.ts`（纯函数）与 `timerStore.ts::checkExpiry/stop/finalizeFocus` 三处分叉；改任一处必须同步 `tools/verify-timer.ts` 与 `timer_engine.rs`。

---

## 2026-10-18 · 账号页重构为「软件账号中心」+ 真实改密码/重置密码 + PB 端到端实测

### 重要变更
- **账号页 = 软件账号页（PocketBase）**：删掉「本地假档案 + 云同步小尾巴」结构。账号 tab 直接渲染 `SettingsModal.tsx::AccountPane`，同一个 `.account-card` 两态——未登录为登录/注册卡（logo + 标题 + 副标题「不登录也能用全部本地功能」+ 邮箱/密码，注册态多确认密码 + 主按钮 + 登录↔注册切换 + 忘记密码 + 提示行）；已登录为账号卡（头像（云端 `users.avatar`，无则首字母）+ 用户名（`cloud.user.name`，空回退 email @ 前缀）+ 邮箱 + 「已登录」绿点 + 同步区（状态行/上传/恢复/自动同步说明）+ 就地改密码 + 退出登录）。两态共用卡外 `.account-local-data` 本地数据区（红描边删除；已登录多一行「删除后本地配置恢复默认，并可能自动上传覆盖云端」）。
- **移除**：**旧的本地**头像上传、旧的「编辑资料」整表单（昵称/邮箱/座右铭一起改，昵称后以就地表单回归、邮箱仍只读）、本地改密码表单（原 `PasswordForm`）、`account.secProfile/secSecurity/accountMgmt/cloudOptional` 四个小标题、云同步独立小区块；对应 `.profile-*` / `.login-*` / `.cloud-*` / `.avatar-lg` 样式删除，新增约 25 条 `.account-*`（`.account-name/.account-email` 作用域限定在 `.account-card` 内）。头像后以「云端账号头像」回归，见下条。
- **真实改密码**：`pbUpdateProfile` 支持 `oldPassword`；`authStore.changePassword` 走 PB `users.update`。PB **强制 `oldPassword`**（只带 `password+passwordConfirm` 返回 400 `validation_required`，带上则 200）。
- **token 失效修复**：PB 在改密码后作废该用户全部既有 token（实测旧 token `auth-refresh` → 401）。`changePassword` 成功后立刻用新密码 `authWithPassword` 换新 token，否则刷新/重启掉线；换 token 失败则清会话并提示 `sync.pwdChangedRelogin`（「请用新密码重新登录」），不谎报成功。
- **忘记密码**：`lib/pb.ts::pbRequestPasswordReset` → `users.request-password-reset`（实测 **204**，该实例 SMTP 已配置）；前端只提示已发送，不暴露账号是否存在。
- **头像上传/更换/移除（云端账号头像）**：复用 PB `users` 内建**文件字段 `avatar`**，无需改 schema。上传 `PATCH /api/collections/users/records/{id}` + `multipart/form-data`（单文件键 `avatar`，带用户 token），实测 200、返回 `avatar="favicon_mmzx7s793y.png"`（服务端命名 = 原文件名前缀 + 随机串）；删除传 `avatar: ''` 实测 200 且清空；读取 `GET /api/files/users/{recordId}/{filename}` 与 `?thumb=100x100` 均 200，且**不带 Authorization 也 200**——文件公开可读、`<img>` 可直接引用（隐私影响入 `07-backlog.md` #36）。**双限**：客户端仅 `image/png`/`image/jpeg` 且 ≤2 MB（`stores/authStore.ts::uploadAvatar`，超限 `err.avatarType`/`err.avatarTooLarge`），服务端 PB 文件上限实测 **5 MiB**（6.45 MB PNG → 400 `validation_file_size_limit`，message「the maximum allowed file size is 5242880 bytes」）。UI：`.account-avatar` 由 `div` 改为 `<button>`（有头像 `<img src=pbAvatarFileUrl(user,96)>`，否则首字母），叠加 `.account-avatar-edit` 遮罩（相机图标/「上传中…」）、隐藏 file input（`accept="image/png,image/jpeg"`）、`.account-avatar-hint`、`.account-avatar-remove`；focus-visible 有 2px 焦点环，上传中文案 9px 防裁切。侧边栏渲染顺序改为**云端 avatar（72px）→ 本地 `avatar_path` → 首字母**。头像与账号资料都存云端 `users`、不落本地；未登录时无头像按钮（登录卡只有 logo）。
- **昵称（`users.name`）读写 + 「编辑资料」**：`users.name` 是普通文本字段，无需改 schema。注册可带（`lib/pb.ts::pbRegister` 仅 trim 后非空才塞 `name`，不传则完全不带该字段；实测 200 原样保存）；登录后 `PATCH /api/collections/users/records/{id} { name }` → `pbUpdateName`，`auth-refresh` 回读为新值。**服务端上限 255**（256 → 400 `validation_max_text_constraint`、`params.max=255`，而顶层 `message` 只是笼统的「Failed to update record.」，故前端取字段级文案）；**服务端不 trim**（前后空格原样保存），客户端先 trim。**客户端门槛刻意更严 32 码点**（`stores/authStore.ts::NICKNAME_MAX_CHARS`/`updateNickname`，`[...name].length` 计、emoji 不重复算；超限 `err.nicknameTooLong`）。空昵称允许，展示回退 email `@` 前缀（`SettingsModal.tsx::AccountPane`）。UI：账号卡用户名外包 `.account-name-row` + 右侧 `.account-edit`「编辑资料」（`aria-expanded`），点开就地 `.account-profile-form`（昵称输入 `maxLength=32` + `.account-email-locked` 灰字 + 保存/取消，Enter 保存、Esc 收起、**失败保持展开**）；注册表单同字段可选填。**邮箱不可改**：`PATCH { email }` → 400 `validation_values_mismatch`，UI 只读并说明「邮箱暂不支持在此修改」（`account.emailLocked`）。**老用户一次性回填**：登录后云端 `name` 为空则用本地 `username` 兜底写入一次，`localStorage['nickname_backfill:<userId>']` 只试一次、成功后静默 `clearMessage()`（避免用户主动清空昵称又被回填）。
- **退出登录是会话级、可逆**：不关闭设置弹层，原地切回登录卡并提示；只清 PB 会话（token + LocalAuthStore），**不碰任何本地表**。
- **退出登录不再清空本地库（行为修正，两运行时 + 移除无用广播）**：旧实现里 `api/local.ts::logout` 会 `resetDB()` + flush + `broadcastDataChanged('all')`，桌面 `commands/user.rs::logout` 会 `clear_all` + `ensure_bootstrap` + `mark_demo_seeded`——**点一次「退出登录」，本地任务与专注记录全没了**（实测退出后侧边栏任务数变 0），而账号页重构后「退出」是低频可逆操作（换账号/临时登出）。现两运行时一致改为不碰任何表：浏览器侧只 `await ready()`，Rust 侧 `logout()` 改无参直接 `Ok(())`，并移除 `api/tauri.ts` 里无意义的 `mutate('all', …)`（否则退出会广播 `data://changed` 触发全量重载）；不可逆清理只归「删除数据」（`clear_all_data`，PRD FR-S2 的「注销并清理」由它承担）。
- **i18n**：zh/en 键集一致（约 **322** 键，由脚本核对键集一致、无缺/无重复/无空值；数量会随后续文案增删变动），新增 `account.title/subtitle/signedIn/signOut/switchToRegister/switchToLogin/localData/deleteDataHint/deleteDataCloudWarn`、`account.avatarChange/avatarRemove/avatarHint/avatarUploading/avatarUpdated/avatarRemoved`、`account.editProfile/nickname/nicknameHint/emailLocked/profileSaved`、`sync.section/newPwd/passwordConfirm/pwdMismatch/autoHint/oldPwd/forgot/changePwd/pwdChangedRelogin`、`err.oldPwdRequired/avatarType/avatarTooLarge/avatarFailed/nicknameTooLong`、`account.signedOut` 等。
- **截图验收**：`tools/shoot.mjs` 账号页检查改为结构断言——要求 `.account-card` + `.account-form`（含 `input[type=email]`、`input[type=password]`、提交按钮）+ `.account-local-data` 与危险按钮；旧结构 `.profile-avatar/.profile-edit/.profile-form/.cloud-card` 必须为 0；未登录时不得出现 `.account-sync`。（DOM 里提交按钮另有 `.account-submit` 类、端到端脚本点它；shoot 断言用的是 `.account-form button`，两者都存在、只是选择器不同。头像结构与「刷新后仍在」目前由 PB 端到端覆盖，`shoot.mjs` 尚未加 `.account-avatar` 断言。）

### 端到端实测（真实 PocketBase `http://62.234.82.11:28193`，36/36）
注册 → 云端自动生成 `configs`（rev=1，device 为 `crypto.randomUUID`）→ 手动上传 rev 1→2 → 云端 `data` 为 Settings 对象、`updated` 为 PB 时间戳 → 改密码（旧密码校验）→ 新密码 `auth-with-password` 200 → 刷新页面仍登录（LocalAuthStore + 换新 token）→ **头像**：账号卡头像 `<img>` 指向 `/api/files/users/` 且 `naturalWidth` 真实解码、侧边栏同步、云端 `users.avatar` 字段已写入 → **移除头像**后回退首字母、云端字段清空 → **昵称**：注册表单含昵称输入、注册时昵称写入云端（PB 字段回读）、卡片与侧边栏同时显示 → 再次「编辑资料」改昵称后卡片/侧边栏同步且云端更新确认、取消不改动、超长（40 字绕过 `maxLength`）被拒并提示且表单保持展开、未污染现有昵称、**刷新后昵称持久化** → 退出后设置弹层保持打开并回登录卡、本地 token 清空、**本地任务仍为 3 条**、**侧边栏回到本地默认身份**（`honestliu`）→ 新密码重新登录成功。头像、昵称与「退出不清库」三组断言为回归保护。计数口径：26 → 36 为**净增 10 条**（新增 12 条昵称断言、替换 2 条旧的「侧边栏/账号卡显示邮箱前缀」断言——注册即带昵称后这两条改为「显示注册昵称」）。

### 防复发 / 残余风险
- `configs.user` 是关系字段：**删用户前必须先删其 configs 记录**，否则 `DELETE users` 返回 400（`07-backlog.md` #33）。
- `users` 的 listRule 不公开：匿名无法枚举用户，测试残留账号只能按已知 id 删（#34）。
- 多设备并发与断网降级仍只做代码路径核对，压测归 #19。

---

## 2026-10-18 · 白噪音统一为选择弹窗（用户设计稿）

### 能力补齐
- **三处入口收敛为一个弹窗**：原先白噪音散在计时页工具条的内嵌小浮层（开关 + 分段按钮 + 滑杆）与设置→外观的 `<select>` 下拉，两处各存一份状态。现新增全局单例 `components/NoisePicker.tsx`（`App.tsx` 挂载），开关状态并入 `stores/uiStore.ts` 的 `noiseOpen`/`openNoise`（同时关闭其它弹层，已入 `closeAllOverlays`）；计时页「白噪音」与外观页「选择白噪音」都只调 `openNoise(true)`。**样式来自用户提供的设计稿截图、超出 PRD 规定范围**（标题 + 音量滑杆 + 圆形封面列表 + 取消/确定）。
- **层级**：`.noise-overlay { z-index: 400 }`（`styles/global.css`）压过全屏专注层 200 / 通知 160 / 搜索 180，否则在专注页点了会被壁纸层盖住；已在壁纸上截图验证。
- **播放状态收敛为全局唯一真相源**：新增 `stores/noiseStore.ts`（`{kind, volume, playing}` + `select/setVolume/setPlaying/hydrate/restore`），删除 `TimerScreen.tsx` 的局部 noise 状态与内嵌浮层；工具条图标与 `.on` 高亮改为跟随 `noiseStore.playing`，消除「弹窗里选了一个、工具条还显示旧的」类不同步。
- **交互语义**：点某项**即刻试听**（用户手势内启停，规避 WebView 自动播放限制）；拖音量时若未选音色会自动试听当前高亮项；**取消回滚**（音色与音量都恢复打开前，`restore(snapshot)`）、**确定才落库**。落库：`noise_volume` 总写，`noise` 仅在选了具体音色时写——选「无」不覆盖已存音色（「专注时播放」仍按上次音色自动起）。打开时高亮 = 正在播放 ? 当前音色 : 「无」。「无」= 不播放，不是清空音色。
- **封面取自音频自身**：新增 `src/assets/noise/covers/{waves,breeze,forest,woods,cozy}.jpg`（360×360、7–14 KB），全部从对应 mp3 的 **ID3 内嵌封面（APIC/attached_pic）** 提取，不是另找的设计资源；`tools/extract-noise-covers.sh` 用 ffmpeg/ffprobe 重抠（`-an -c:v copy`，无内嵌封面则跳过告警），换音频后重跑。`lib/noise.ts::NOISE_COVERS` 与 `NOISE_AUDIO` 一一对应，其中 `rain` 音色的音频本就是 `forest.mp3`、封面同用 forest 图，避免图音错配；展示顺序 `NOISE_KINDS = waves/rain/wind/woods/cozy`。
- **i18n**：新增 `noise.title/none/volume/pick`；**键数 322 → 326**（zh/en 各 326，脚本核对无缺失/多余/空值）。英文界面 `White noise / None / Waves / Rain / Breeze / Forest / Cosy / Volume / Cancel / Confirm` 零中文残留。
- **验收**：`bash tools/check-all.sh --with-shots` 6/6；截图检查 **7 → 8 项**，新增「白噪音弹窗结构」（`.noise-modal`、`.noise-item` 恰 6、5 张封面 `naturalWidth>0`、滑杆、确定），新截图 `S5c-noise-picker.png`；手测雨声 + 80% → `noise=rain`、`noise_volume=0.8`，设置行提示「雨声 · 80%」，重开回显一致。

### 防复发 / 残余风险
- 封面与音频强绑定：换 mp3 而不重跑 `tools/extract-noise-covers.sh` 会缺图——但 `tools/shoot.mjs` 会因封面未解码直接失败，属「有自动化护栏的约定」，不单列风险。

---

## 2026-10-18 · 数据层/计时核心批量修复 + 可访问性 + 一键验收

### 缺陷修复
- **桌面端更新任务丢字段**：`UpdateTaskPatch` 曾用 camelCase 反序列化，而前端 `api/types.ts` 传 snake_case（`list_id/due_date/est_pomodoros/sort_order`）→ 字段被静默丢弃、显式 `null` 被当缺省。现改为蛇形主字段 + 驼峰别名 + `double_option`（`src-tauri/src/models.rs::UpdateTaskPatch`）。
- **首启种子双端回归**：浏览器曾写空库、桌面 `seed_demo`/`is_empty` 为死代码。现两端统一「空库且未播种 → 写 PRD §6.3 演示数据 + 置 `settings.demo_seeded='1'`」：TS 在 `db/idb.ts::initDB/clearToFactory`，Rust 在 `lib.rs` setup + `db.rs::is_empty/demo_seeded/mark_demo_seeded/seed_demo`；删除数据/注销也置标记（`commands/user.rs::logout/clear_all_data`）。
- **清单视图默认夹带已完成**：`list_tasks` 传 listId 且未显式传 completed 时补 `completed = 0`（`commands/tasks.rs::list_tasks_impl`、`api/local.ts::list_tasks`）。
- **搜索把 `%`/`_` 当通配符**：转义并 `ESCAPE '\\'`（`commands/tasks.rs::list_tasks_impl`）。
- **无清单任务 `sort_order` 算错**：只统计 `list_id IS NULL` 分组，与浏览器侧口径对齐（`commands/tasks.rs::create_task_impl`）。
- **番茄网格按整条记录落格**：改为按分钟摊到小时格（`commands/stats.rs`）。
- **报表并列时长顺序不稳**：加 `MIN(start_at)` tie-break（`commands/stats.rs` 两处 ORDER BY）。
- **桌面 `set_goal` 未取整**：补 `round` 后夹紧，与 `Math.max(0, Math.round(...))` 对齐（`commands/stats.rs`）。
- **错误信息泄露内部细节**：前端只见友好中文短句，SQL/IO 原文仅入日志（`src-tauri/src/error.rs`）。
- **浏览器 `list_tasks` 搜索吃掉 listId/completed、排序缺 tie-break、记录缺 `end<start` 校验**：`api/local.ts::list_tasks/create_focus_record` 修复。
- **云同步写放大/假值**：`resolveDirection` 三方全等返回 `none`；删掉名不副实的 `recWithLocalDefaults`；`applyRemote` 不再写字符串 `"undefined"`；`pbRefreshAuth` 仅 401/403 清 token（原断网即登出）；登录前本地校验邮箱/密码≥8（`lib/sync.ts`、`lib/pb.ts`、`stores/authStore.ts`）。
- **正计时暂停被计入专注**：暂停冻结 `paused_remaining_ms`，恢复时把已用时折算回 `start_at`（`timer/engine.ts::remainingMs/startState`）。
- **并发写出重复 `focus_record`**：`checkExpiry` 加单属主锁 `expiryBusy`；`init` 幂等（StrictMode 双跑）；`skip/reset/setMode` 补 `timer://state-changed`（`stores/timerStore.ts`）。
- **空格键误触发**：长按重复、输入法组合中、焦点在 BUTTON/A/SELECT 时早退（`App.tsx` 全局 keydown）。
- **全屏专注层无法退出**：新增 Esc 关闭（控件已消费的 Esc、输入框/下拉/滑杆内不拦截，`TimerScreen.tsx` 的 window keydown）。
- **壁纸静默失效**：data URI 必须写 `url("…")` 带引号（`TimerScreen.tsx`、`FloatWindow.tsx` 的 `backgroundImage`）。
- **组件抛错整页白屏**：新增 `components/ErrorBoundary.tsx` 并在 `main.tsx` 包裹根节点。

### 能力补齐
- **i18n 扫尾**：`zh.ts`/`en.ts` 新增约 130 键；`lib/date.ts` 增 `DateLocale/setDateLocale/getDateLocale/formatPeriodTitle/formatShortDate`（en 走 `Today/10/13/Oct 2026`）；`lib/noise.ts` 噪音名随语言；`lib/derive.ts::taskTitle` 走 `tStatic`；`api/local.ts` 的中文 throw、`db/queries.ts` 的「未指定任务」、托盘菜单/加载文案、专注页文案全部走词表。英文界面（含专注全屏层/报表/设置/深色）无中文残留（`tools/shoot.mjs` 自动扫描，排除 §6.3 演示数据与语言自名）。
- **可访问性**：新增 `components/useModalA11y.ts`（栈式 Esc + Tab 循环 + 初始焦点 + 卸载还原焦点，接入 Settings/Report/Placeholder/ConfirmDialog/TaskEditModal 并补 `role="dialog" aria-modal aria-labelledby`）；`Menu.tsx` 全键盘（`role=menu/menuitem`、↑↓/Home/End/→/←/Esc）；拖拽的键盘替代（任务行 Alt+↑/↓、清单行 Alt+↑/↓ + `role="status"` 播报）；设置导航 `role=tablist/tab/tabpanel` + 方向键；`focus-visible` 扩到 select/a/[tabindex]/[role=*]；开关从 `display:none` 改视觉隐藏（键盘可达）；新增 `.sr-only`。
- **深色主题**：新增 shadow 令牌；`--text-3` 深色由 `#6e6e73`(2.82:1) 提到 `#8a8a91`(4.17:1)；补滚动条/遮罩(0.28→0.52)/未读通知/开关滑块/chart-tip/输入框/`::selection`/`prefers-reduced-motion`（`styles/global.css`）。

### 工程化
- **一键验收** `tools/check-all.sh`：tsc → `check-runtime-parity.sh` → `verify-data.ts` → `cargo test --test queries` → `vite build` → 可选 `shoot.mjs`；支持 `--with-shots`/`--skip-build`，彩色 PASS/FAIL，失败退出码非 0。
- **截图验收** `tools/shoot.mjs` 重写：结构选择器（不再依赖中英文文案）+ 7 项自动检查（后增至 8 项，2026-10-18 加白噪音弹窗；首屏渲染、账号页断言、悬浮窗/专注页壁纸非 `none`、深色低对比度扫描、英文界面中文残留、console/pageerror）。账号页断言后于同日账号页重构升级为 `.account-*` 结构断言（见上方条目）。
- **验收脚本语言确定性**：`tools/verify-data.ts` 显式 `setDateLocale('zh')`——它断言的是 PRD §7.2 中文口径，而 `i18n/store` 在 Node 下会按 `navigator.language`（通常 en-US）把 `formatMinutes` 切成 `8h 59m` 造成 6 项假失败；`tools/shoot.mjs` 同理固定 `locale:'zh-CN'`，英文检查另起一次 `selectOption('en')`。
- **英文专注层纳入扫描**：`tools/shoot.mjs` 追加「英文专注界面无中文残留」检查（`.timer-screen` 全屏层原先不在扫描范围内）。

### 验证
- `bash tools/check-all.sh --with-shots` → **6 项全绿**：tsc / 红线 / 种子口径 / `cargo test` 16 passed / build / 截图 7 检查 + console 无错误。
- 构建体积：`index-*.js 397.99 kB (gzip 122.17)`、`css 33.38 kB (gzip 6.80)`、window chunk 13.49 kB、5 段环境音各约 1.93 MB；`dist` 合计 9.7 MB（目标 ≤20 MB，音频占 99%，见 `07-backlog.md` #32）。
- 视觉：S1–S5 与 PRD 截图一致；「任务页预计时间 0 分钟」为**规格正确**（今日到期未完成 × 预计番茄 × 25min，种子任务到期日是昨天），不是缺陷。

---

## 2026-10（补记）· 账户登录 + PocketBase 云同步落地

> 本条为**文档补记**（代码已存在，非本次改动），用于记录 PRD 非目标项的实际落地边界。

- **定位**：可选「云端对齐层」，本地 SQLite/IndexedDB 仍是断网时唯一真相源；所有云端调用 try/catch，失败静默降级为「云端不可用，已使用本地数据」，不清空/阻塞本地（`src/stores/authStore.ts`）。
- **后端**：PocketBase，集合 `users`（内建）+ `configs`（每用户一条设置快照）；地址 `VITE_PB_URL`，缺省回退 `http://62.234.82.11:28193`（`src/lib/pb.ts::PB_URL`）。
- **冲突裁决**：`src/lib/sync.ts::resolveDirection` 纯函数——远端无→push、本地无→pull、`rev` 大者胜、`rev` 同则比 `updated`、仍同则 `device` 字典序；`applyRemote` 只写 `DEFAULT_SETTINGS` 白名单键。
- **入口与触发**：设置 → 账号页（现已重构为账号中心，见顶部条目）；设置变更防抖 1200ms 推送；启动 `useAuthStore.init()`（`App.tsx:48`）。
- **本地元数据**：`localStorage` 的 `sync.meta.<userId>` 与 `sync.device`。
- **验证缺口**：~~PB 端到端未实测~~ → 2026-10-18 已实测 36/36（含改密码/换 token/头像上传与移除/昵称编辑/退出登录不清库；见顶部条目与 `07-backlog.md` #30）；多设备并发压测待补（#19）。

---

## 2026-10-15 · P2 首批

- **#13 目标达成环**：报表「每日专注目标」面板加 SVG 达成度环（今日专注/目标百分比），复用主题令牌。
- **#12 近 30 天专注趋势**：`src/charts/TrendChart.tsx` 面积图（按日聚合 + 与目标对比），数据来自 store（`derive.focusTrend`）。
- **#11 计时结束反馈**：专注/休息完成时在计时界面弹 2.5s 提示（`.timer-feedback`），由 `timerStore` 驱动。
- **#9 深色主题全屏核对**：Playwright 校验 `data-theme=dark` 后各令牌（--bg-card #2a2a2e / 侧边栏 / 正文 / 报表面板）正确生效。
- **#8 i18n（中/英）**：新 `src/i18n/`（`zh.ts`/`en.ts` 词表 + `store.ts` + `useI18n/t` hook）；`settings.language` 持久化并即时切换；已覆盖框架/任务/计时/设置导航/报表 chrome/通知/搜索/编辑弹层。首次运行跟随 `navigator.language`。
  - **钩子顺序教训**：`const { t } = useI18n()` 必须位于任何使用 `t` 的 `useMemo` **之前**（TDZ 崩溃）；设计 i18n 的 `useMemo` 需把 `dict` 加入依赖，否则语言切换后卡片等不重算。
- **修复：IndexedDB 旧库破坏初始化（0 任务显示）**：起因早期版本变更存储结构但 `DB_VERSION` 未升（保持 1），旧库缺 `kv` store → `transaction('kv')` 抛 "object store not found"，初始化中断。修复：`DB_VERSION→2` + `onupgradeneeded` 删除旧 store 重建 `kv`（不兼容即重建，演示数据可重播种）。

---

## 2026-10-14 · 修复：桌面版任务列表恒为空（回车不出现列表项）

**现象（用户报告）**
在 Tauri 桌面版中输入任务并回车，列表不出现任何条目；观感上"连 ToDo List 都没有"。

**定位过程**
1. 直接读 `~/Library/Application Support/com.focuspomodoro.desktop/focus.db`：
   `tasks` 表已有 **11 行**，其中 8 行是用户输入的原文（`测试` / `ce` / `Cc` / `cdc` / `ds` / `cdscs`…）。
   → **写入路径完全正常**，是"写进去了但界面不显示"。
2. 检查数据读取：`src/components|pages|modals` 共 **7 个文件** import `@/db/queries`，
   而 `db/queries.ts` 的数据源是 `getDB()` —— **IndexedDB**（浏览器适配器的存储）。
3. `initDB()` 只被 `src/api/local.ts` 调用；Tauri 运行时走 Rust/SQLite，**IndexedDB 从未初始化**，
   因此 `getDB()` 恒为 `emptyDB()`，所有派生查询恒返回空。

**根因**
架构缺陷：UI 直接调用"本地存储版"查询模块，绕过了运行时抽象层。
浏览器运行时（IndexedDB 即数据源）恰好正确，掩盖了问题；Tauri 运行时必然为空。
——即 `docs/03-architecture.md` 所警示的一致性红线被违反。

**修复**
1. 新增 `src/lib/derive.ts`：**纯函数**派生查询，数据由调用方传入（`Dataset = {tasks, lists, records}`）。
2. `dataStore` 增加 `records`（`api.list_focus_records()`），变更后**全量重载**（`reload()`）。
3. 7 个 UI 文件全部改用 `src/lib/derive.ts` + store 数据；`db/queries.ts` 仅保留给 `local.ts`（适配器内部实现）。

**验证（真实 Tauri 运行时，非浏览器）**
在 webview 内注入探针，把 store 与 **DOM 实测值**写入 SQLite 后直接读取：
| 探针 | 值 | 结论 |
|---|---|---|
| `_st_store_tasks` | 12 | store 自 Rust/SQLite 载入成功 |
| `_st_dom_before` | 12 | **DOM 实际渲染 12 项**（修复前为 0） |
| `_st_dom_after_add` | 14 | 新建任务后 DOM 立即增长（StrictMode 双跑 +2） |
| `_st_store_records` | 22 | 专注记录亦已载入 |

浏览器运行时回归：11/11 行为测试通过。

**防复发**
- 新增守卫脚本 `tools/check-runtime-parity.sh`：禁止 `src/components|pages|modals|charts` 直接 import `@/db/queries` 或 `@/db/idb`，违反即失败。
- 已纳入 `docs/07-backlog.md` 的质量闸门。
- 新增 Rust 写入链路与序列化边界测试（`create_task` / `toggle` / `delete` / camelCase 反序列化）。

**遗留**
用户此前输入的那 8 条任务仍在库中（属用户数据，未擅自删除），修复后重新打开应用即可见。

---

## 2026-10-15 · P1 第二批：交互打磨

- **#3 系统通知接线**：新增 `src/lib/systemNotify.ts`（跨运行时），Tauri 走 `tauri-plugin-notification`（2.6.0，macOS 通知中心），浏览器回落 Web Notification；设置拆分为「应用内通知 / 系统通知」两个开关（新增 `system_notify` 设置，TS+Rust 双实现）。
- **#6 会话恢复提示**：启动检测到未完成/已结算会话时，专注界面顶部显示恢复横幅，可「继续下一阶段」或「知道了」。
- **#4 搜索增强**：⌘/Ctrl+K 或 `/` 唤起；即时过滤分组；↑↓ 选择、回车定位并高亮目标任务（非受控 Flash 1.5s 自动清除）。
- **#2 任务拖拽排序**：任务行可拖拽排序（同行 `sort_order` 批量 `reorder_tasks`）；拖到侧边栏清单行即可**跨清单移动**（含「移入」提示）。浏览器 9/9、Rust 10/10、发布版探针通过（恢复横幅渲染、system_notify 生效）。

> 系统通知的实际弹窗无法在本无显示环境中验证，需真机确认 macOS Notification Center 表现。

- 任务行「⋯」更多菜单 + **右键菜单**：标记完成 / 编辑 / 移到清单（子菜单）/ 复制 / 删除（二次确认）。
- 侧边栏**清单拖拽排序**（持久化 `lists.sort_order`）+ **默认清单**（设置页标记，`create_task` 优先生效）。
- 新增命令：`reorder_lists` / `get_default_list` / `set_default_list`（Rust + TS 双实现）。
- 新增全局二次确认机制（`uiStore.askConfirm`）。
