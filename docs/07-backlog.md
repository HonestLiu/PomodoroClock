# 07 · 待办池（按阶段与优先级）

> 从 `02-roadmap.md` 的阶段与 `05-modules/*` 的 ★ 项汇总。`S/M/L` = 工作量（适中规模单人实现）。

## 待办条目

| # | 阶段 | 优先级 | 条目 | 模块 | 规模 | 依赖 |
|---|---|---|---|---|---|---|
| 1 | P1 | P1 | 任务更多菜单 + 右键（删除/移清单/复制） | tasks ★1 | M | ✅ 已完成 |
| 2 | P1 | P1 | 拖拽排序（视图内重排 + 跨清单移动） | tasks ★2 | L | ✅ 已完成 |
| 3 | P1 | P1 | 系统通知接线（tauri 插件 + 权限 + 开关） | notify ★1/★2 | M | ✅ 已完成（待真机验证） |
| 4 | P1 | P2 | 搜索回车定位 + 目标高亮 + 快捷打开 | search ★1/★2/★3 | S | ✅ 已完成 |
| 5 | P1 | P1 | 清单拖拽排序 + 默认清单 | lists ★1/★2 | S/M | ✅ 已完成 |
| 6 | P1 | P1 | 会话恢复提示 UI | timer ★1 | S | ✅ 已完成 |
| 7 | P2 | P2 | 倒计时/正计时模式完善（时长设定/停止归档，模式可选但沿用专注时长） | timer ★3 | M | — |
| 8 | P2 | P1 | i18n 骨架 + zh/en + 切换 | settings ★1 | L | ✅ 已完成 |
| 9 | P2 | P2 | 深色主题全屏核对 | settings ★2 | S | ✅ 已完成 |
| 10 | P2 | P2 | 通知设置拆分（应用内/系统） | settings ★3 | S | ✅ 已完成 |
| 11 | P2 | P2 | 专注结束/休息结束反馈文案 | timer ★2 | S | ✅ 已完成 |
| 12 | P2 | P2 | 近 30 天专注趋势图 | report ★1 | M | ✅ 已完成 |
| 13 | P2 | P2 | 目标达成环 | report ★3 | S | ✅ 已完成 |
| 14 | P2 | P2 | 导出/导入 JSON | 数据 | M | — |
| 15 | P2 | P2 | 开机自启接线(`tauri-plugin-autostart`；设置项 `autostart` 已在但无行为) | settings ★5 | S | install 依赖 |
| 16 | P2 | P2 | 任务到期提醒(`task_remind`) | notify ★3 | M | #3 |
| 17 | P3 | — | 规模期/任务级统计、周报 | report ★2 | L | #12 |
| 18 | P3 | — | 成就系统实质化（当前成就页只有 4 条实时进度，无解锁持久化） | growth | L | — |
| 19 | P4 | — | Windows/Linux 真机验证、多设备同步压测、mobile（单设备云同步已落地） | growth | XL | 长期 |
| 20 | P2 | P3 | 白噪音按模式（`noise_on_focus/break` 已存设置、未接入播放） | settings/timer | S | — |
| 21 | P2 | P3 | 关于页版本号动态 + 开源许可文本 | settings ★4 | S | — |
| 22 | P2 | P3 | 应用内帮助 / 各页空态文案 | 全局 | S | — |
| 23 | P2 | P2 | 正计时模式无「结束并记录」入口：正计时专注永不写 `focus_record`（有数据丢失后果，故与 #7 单列） | timer ★3 | S | 工具条结构按 PRD S3 固定，加按钮会破坏截图还原 |
| 24 | P2 | P3 | 壁纸/资源 data URI 必须 `url("…")` 带引号：Vite 内联 SVG 保留 `xmlns='http://…'` 单引号，未加引号会被 CSS 整条丢弃且无报错（曾致专注页/悬浮窗壁纸静默失效） | timer / 前端约定 | S | 已在 `03-architecture.md` §工程化约定留约定 |
| 25 | P2 | — | **双引擎语义漂移（潜伏）**：`timer_engine.rs::remaining_ms` 正计时暂停返回 0（忽略 `paused_remaining_ms`），`timer/engine.ts::remainingMs` 返回冻结已用；Idle 时长取值路径也不同。当前副作用不可见（桌面 tick 广播仅显示用） | timer 双实现 | S | 改任一侧必须对照另一侧 |
| 26 | P2 | — | **无 schema 迁移版本表**：`db.rs` 只有 `PRAGMA`，靠 `CREATE TABLE IF NOT EXISTS`；未来加列/改列需手写迁移且无版本判断 | 数据层 | M | 现有库已升 DB_VERSION=2（IDB） |
| 27 | P2 | — | **删除清单不清 `focus_records.list_id`**：两端都只把 `tasks.list_id` 置 NULL（`commands/lists.rs::delete_list`、`api/local.ts::delete_list`），历史记录的 list_id 成悬空，报表落「未指定任务」 | 数据层 / 报表 | S | — |
| 28 | P2 | — | **大小写折叠不一致**：SQLite `lower()` 只折 ASCII，JS `toLowerCase()` 折 Unicode（`commands/tasks.rs::list_tasks_impl` 用 `lower(title) LIKE`）→ 非 ASCII 拉丁字母搜索两端可能不一致（中文不受影响） | 数据层 | S | — |
| 29 | P2 | — | **Rust 错误为中文文案而非 i18n key**：`error.rs` 直接返回中文短句，英文界面报错仍是中文；建议 `AppError` 带 code、前端映射 `error.*` | 双端约定 / i18n | M | `error.rs` 注释已留此方向 |
| 30 | P2 | — | **PocketBase 端到端已实测（2026-10-18，36/36）**：注册（含可选昵称）→configs 记录（rev=1）→手动上传 rev 2→改密码（旧密码校验）→新密码登录 200→刷新仍登录→**头像上传/移除（`naturalWidth` 真实解码、侧边栏同步、云端 `avatar` 写入与清空）**→**昵称：编辑资料改昵称后卡片/侧边栏同步、云端字段回读、取消不改动、超长被拒、刷新持久**→退出回登录卡且**本地任务仍 3 条、侧边栏回本地默认身份**→新密码重登，全链路通过。剩余：多设备并发与断网降级仅代码路径核对，压测归 #19 | 云同步 | S | 环境地址 `62.234.82.11:28193` 现已可达 |
| 31 | P2 | — | **浅色次要文字未达 AA**：`--text-3 #b4b2ad`(2.1:1)、`--text-2 #8a8a8a`(3.45:1) 为 PRD 指定色，未调整；深色已提到 4.17:1。需产品决定是否改色 | 设计 / a11y | S | — |
| 32 | P3 | — | **音频占包体 99%**：5 段环境音各约 1.93 MB（`dist` 9.7 MB / 目标 ≤20 MB）；可压缩比特率或改懒加载 | 构建 | M | — |
| 33 | P2 | — | **PB `configs.user` 关系约束**：删用户前必须先删其 `configs` 记录，否则 `DELETE users` 返回 400。若将来做「注销云端账号」，必须先清 configs 再删 user，顺序写反会残留且报错 | 云同步 | S | 端到端实测发现 |
| 34 | P3 | — | **`users` listRule 不公开**：匿名无法枚举用户，测试残留账号只能按已知 id 删；自动化测试若需清理账号，须在测试内记录 id，不能靠邮箱查列表 | 云同步 / 测试 | S | — |
| 35 | P2 | — | **退出登录曾清空本地库（已修复 2026-10-18）**：旧 `api/local.ts::logout` 做 `resetDB()`+广播、`commands/user.rs::logout` 做 `clear_all`+重播种，导致「只想换账号」丢光任务与专注记录（实测退出后侧边栏任务 0）。现为会话级可逆：只清 PB 会话、不动任何表；不可逆清理归 `clear_all_data` | 云同步 / 数据层 | S | ✅ 已修复；回归由端到端 36/36 覆盖 |
| 37 | P3 | — | **邮箱修改未做**：账号页邮箱只读。PB 禁止直接 `PATCH { email }`（实测 400 `validation_values_mismatch`），要走 `request-email-change` → 新邮箱收确认信 → `confirm-email-change` 的完整验证流程，且需该实例 SMTP 可达。当前定位「邮箱=账号标识、改邮箱≈换账号」，故不做；若要支持，需补 UI 双步流程 + 邮箱被占用的冲突提示 | 产品决策 / 云同步 | M | 与 #34（listRule 不公开）叠加时，改邮箱失败只能靠 PB 错误码区分 |
| 36 | P3 | — | **头像文件 URL 公开可读**：`GET /api/files/users/{recordId}/{filename}` 不带 Authorization 也返回 200（PB 文件字段默认行为），知道 recordId + 文件名即可访问。当前可接受（头像本就展示用）；若要求私有，需在 PB 侧改 file 字段保护/走代理签名 URL，代价是 `<img>` 不能直连 | 云同步 / 隐私 | M | 端到端实测确认 |

## 现状备注（2026-10-18 核验）
- **#1–#6 属实**：任务更多菜单/右键（`TaskView.tsx`）、拖拽排序（`sort_order` 写回）、系统通知（`lib/systemNotify.ts` + `Cargo.toml` notification 插件 + `timerStore.ts:323` 门控，真机弹窗待验）、搜索回车定位（`SearchOverlay.tsx:38-59`）、清单拖拽+默认清单、会话恢复提示（`timerStore` 恢复后 `wasRestored`）。#14 导出/导入未实现（仅 `api/local.ts:399` 测试注释）；#15 未装插件（`Cargo.toml` 无 autostart）。
- **占位页按规格保留**：高级版/好友/成就均为 `PlaceholderModal.tsx`（注释指向 PRD FR-G3）；高级版 tab 有 ¥18/月、¥168/年、¥398 静态卡，文案明确"订阅流程未实现"；成就页用 `stats` 实时算 4 条进度（初次专注/坚持不懈/目标达成/任务达人），但**无解锁持久化**。故 #18 仍成立，且不应在验收里按"功能缺失"扣分。
- **首启数据双端一致**：两端都先 `ensure_bootstrap`（默认用户/目标/计时状态），再写同一份 §6.3 演示数据（`db/seed.ts::buildSeed` / `db.rs::seed_demo`）并置 `demo_seeded=1`；仅「空库 + 未播种」才播种。「删除数据」「注销账号」都回到空业务表 + 默认用户 + 已播种标记，不重播种。详见 `04-data.md` §首启与清空。
- **账号页已重构为软件账号中心**：设置 → 账号即 PocketBase 账号（登录/注册、改密码、忘记密码、同步区、退出登录），旧的「编辑资料」整表单/本地改密码/云同步独立小区块已删（`SettingsModal.tsx::AccountPane`），昵称改为就地编辑、邮箱只读；头像以「云端账号头像」回归（PB `users.avatar` 文件字段，见 `03-architecture.md` §账户与云同步、风险见 #36）。端到端已实测 36/36（见 #30）；改密码后 PB 会作废全部旧 token，`changePassword` 已当场换新 token；**退出登录不清本地数据**（见 #35）。
- **云同步已落地**（单设备）：PocketBase `users`/`configs`、离线优先、rev→updated→device 裁决、不可达静默降级（`03-architecture.md` §账户与云同步）。剩多设备并发压测归 #19；后端关系与权限约束归 #33/#34。

## 阶段执行顺序（推荐）
**P1 已全部完成**（#1 → #5 → #2 → #6 → #3 → #4，见 `08-changelog.md`）。
> **每一子项落地即跑：`tsc` → 本地两套适配器行为测试 → 截图 → 更新 `06-acceptance.md`。**

**第二阶段（P2，剩余）**：#14 → #23 → #27 → #29 → #20 → #22 → #16 → #15 → #7（#8–#13 已完成）；潜伏风险 #25/#26/#28/#30/#31 视排期，性能项 #32 归 P3。
**第三阶段（P3）**：#17 → #18
**远期（P4）**：#19

## 质量闸门（每个 # 完成后）
1. `npm run typecheck` 通过（`tsc --noEmit`）
1b. `./tools/check-runtime-parity.sh` 通过（UI 未直连本地存储）
2. 若涉及数据/统计 → `tools/verify-data.ts` + `cargo test --test queries` 双过（跑法见 `README.md` §验证）
3. **双运行时验证**：浏览器（Playwright 行为测试）+ Tauri 桌面（必要时用探针断言 DOM）各验一次
4. 桌面行为回归：若涉及计时/任务 → `tools/shoot.mjs`（先 `vite preview --port 4173`）抽查
5. 更新 `06-acceptance.md` 对应项为 `[x]`，并在 `02-roadmap.md` 状态表标注
