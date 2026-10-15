# 08 · 变更与缺陷记录

> 记录**已修复的缺陷**与**重要变更**，供回归与追溯。每条含：现象、根因、修复、验证、防复发。

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
