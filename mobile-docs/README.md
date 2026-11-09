# FocusPomodoro Flutter 移动端开发文档

> 目标读者：负责实现移动端的 Codex / 工程师。本文档是移动端工程的任务输入；桌面端当前代码和 PocketBase 配置是既有兼容面，不能因移动端而破坏。
>
> 文档依据当前仓库的 `src/`、`src-tauri/`、`docs/` 与 `scripts/pb-sync-setup.mjs` 编写。若本文与运行代码矛盾，先复核源代码，再更新本文并说明差异；不得臆造服务端字段或规则。

## 目标

用 Flutter 独立实现 iOS 与 Android 客户端，覆盖桌面版现有用户功能，并接入**同一 PocketBase 后端、账号和同步集合**。手机和桌面使用同一账号时，清单、任务、专注记录、共享设置和奖励数据最终收敛一致。应用离线可用；服务器失联不能阻断本地操作或清空本地数据。

移动端允许按触屏、小屏和操作系统能力重新组织界面，但不能删减业务功能或改变数据含义。平台专属能力（通知、后台计时、桌面悬浮球、macOS WidgetKit）须以移动端合理的原生交互实现，并在平台限制下提供清晰状态。不得声称移动系统可无限后台执行。

## 文档阅读顺序

| 顺序 | 文档 | Codex 用途 |
|---|---|---|
| 1 | [项目约定与实现指令](01-agent-instructions.md) | 开始任何实现前必读，约束范围、架构、仓库和改动方式 |
| 2 | [产品范围与桌面功能对照](02-product-parity.md) | 建页面、逐项实现功能、记录平台适配和差异 |
| 3 | [Flutter 架构与工程规范](03-architecture.md) | 目录、状态管理、路由、存储、原生边界 |
| 4 | [数据模型与 PocketBase 同步契约](04-sync-contract.md) | 登录、首次接管、同步集合、冲突、删除、离线和安全 |
| 5 | [界面与交互规格](05-ui-spec.md) | 移动端信息架构、页面和关键交互 |
| 6 | [开发阶段与交付计划](06-roadmap.md) | 按阶段提交可运行增量，控制依赖顺序 |
| 7 | [验收与测试矩阵](07-acceptance.md) | 完成定义、跨端同步验收、发布前检查 |
| 8 | [风险、决策与待核实项](08-open-issues.md) | 先核实再实施的技术边界、不得猜测项 |

## 权威桌面端参考

- 产品原始需求：[`../CLAUDE.md`](../CLAUDE.md)
- 桌面端模块说明：[`../docs/05-modules/`](../docs/05-modules/_index.md)
- 数据和统计口径：[`../docs/04-data.md`](../docs/04-data.md)
- 同步服务器和 URL 规则：[`../docs/09-sync-server.md`](../docs/09-sync-server.md)
- PocketBase 同步集合创建脚本：[`../scripts/pb-sync-setup.mjs`](../scripts/pb-sync-setup.mjs)
- 行级同步实现：[`../src/lib/syncData.ts`](../src/lib/syncData.ts)、[`../src-tauri/src/commands/sync.rs`](../src-tauri/src/commands/sync.rs)
- 配置快照实现：[`../src/lib/sync.ts`](../src/lib/sync.ts)
- 账户/API 实现：[`../src/lib/pb.ts`](../src/lib/pb.ts)、[`../src/stores/authStore.ts`](../src/stores/authStore.ts)

桌面代码是**行为参考**，不是 Flutter 可直接依赖的库。Flutter 必须独立实现并通过 API 与远端兼容。

## 必须遵守的同步事实

1. PocketBase 用户仍使用既有 `users` 集合；业务行镜像为 `sync_folders`、`sync_lists`、`sync_tasks`、`sync_records`，每用户每 `local_id` 唯一。
2. 设置/结构化快照存于 `configs`：包括共享设置、默认清单、任务线 `quest_data`、倒数日、应用内通知。奖励 `growth_data` 位于设置快照中。
3. `ai_api_key`、`pb_url`、计时运行状态 `timer_state` 是设备本地内容，不可推送到账号快照。
4. 本地数据库是离线操作源；同步失败只显示可重试状态，不能丢弃用户操作。
5. 第一次登录、换账号、空设备登录的云/本地接管必须先完成冲突确认/裁决，才允许上传；不能把演示种子或空库快照推成云端胜者。
6. 现有配置快照采用 `rev → updated → device` 确定胜者；业务行采用 `updated_at` 毫秒级 LWW，远端删除经墓碑传播。移动端实现需兼容该行为并增加重复请求安全。
7. PocketBase 实时订阅不是唯一同步保障；需要启动同步、恢复前台、网络恢复同步和兜底轮询/手动同步。

## 给 Codex 的启动方式

建议在本目录作为一个独立 Flutter 工程实现（例如 `mobile-app/`，不要把 Dart 源码混进桌面 `src/`）。开始时先阅读本文目录及上述源码，并提交一份简短的实现计划、检查当前仓库状态和 Flutter/SDK 版本；然后按 [开发阶段](06-roadmap.md) 分阶段实现。不得只搭 UI 壳或 mock 完成后宣称已接入同步。
