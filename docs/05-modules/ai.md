# 模块 · AI 能力（ai）

> 2026-10-21 规划。本模块为 app 引入 4 个 LLM 功能：**自然语言创建任务 / AI 任务拆解 / AI 每日计划 / AI 日报·周报**。
> 四条硬性立场：**AI 只建议、用户确认才落库**；**结构化 JSON 输出 + 校验重试**；**LLM 挂了功能退化为手动表单/排序/空态**；**估时越用越准（校准闭环）**。
> 实现前置（必须你拍板）：LLM 提供方 / 模型 / API 密钥与网络。本文件先把每一处设计定稿，代码按 `07-backlog` 里程碑逐个落地。

## 当前状态
- ✅ **M1 基础设施**：`lib/ai/providers.ts`（Claude `/v1/messages` + OpenAI `/v1/chat/completions` 双格式；baseUrl/apiKey/model 由设置页配置）+ `runStructuredLLM`（结构化 JSON 校验 + 失败重试 + AbortController 超时/取消）+ `timeContext`（NOW/星期/时区注入）+ `lib/ai/calib.ts`（估时校准派生计算）+ `tasks.parent_id` / `actual_minutes` 列。
- ✅ **M2 自然语言建任务（对话式 UI）**：`lib/ai/nlParse.ts` + `stores/aiChatStore.ts` + `components/AiChat.tsx`；候选任务、澄清点选、采纳/撤销全部画在**助手气泡内**（不使用模态对话框）。
- ✅ **入口（2026-10-21 用户需求）**：
  - **独立 AI 页** `pages/AiPage.tsx`（网页式对话：消息流 + 输入条贴底 + 待接入能力 chips），侧边栏入口 `nav-ai` 排在「纪念」之后（与日历/纪念同组、组前一条分割线）。
  - **其他页面只留一个 AI 按钮**（顶栏 Sparkles）→ 点开**右侧抽屉** `components/AiDrawer.tsx` 做临时 AI 操作；抽屉与 AI 页**共享同一会话**。原先嵌在任务页的输入框已移除。
- ✅ 验收：`tools/verify-ai.ts` 入 `check-all.sh`；Playwright 冒烟 9 项（入口位置 / 对话空态 / 示例 chips / 待接入说明 / 未配置降级 / 抽屉展开 / 抽屉内无对话框 / 共享会话 / 任务页无内嵌输入）。
- ✅ **M3 功能二 任务拆解**：`lib/ai/decompose.ts` + 气泡内拆解树（≤3 层、验收标准、依赖无环、勾选子树采纳落库、一键撤销）；LLM 挂了按连接词做确定性细分。
- ✅ **M4 功能三 每日计划**：`lib/ai/timebox.ts`（确定性装箱：容量=可用×0.82、同项目聚块、单块≤90、拒绝超载）+ `lib/ai/plan.ts`（must/should 过滤 → LLM triage+理由 → 装箱）；LLM 挂了降级为「按优先级→截止」排序。
- ✅ **M5 功能四 日报/周报**：`lib/ai/report.ts`（数据全部确定性聚合，五段式（完成情况/偏差/校准/风险/下阶段≤3），LLM 仅叙事+归因）；周期无数据返回空态不调 LLM。
- ⬜ **递进项（暂未做）**：`estimate_calib` 持久化闭环（目前校准为派生计算）、每日计划 adopt 落库写 due/顺序（当前只读建议）。

## 全局约束 → 落地（对应需求 1–7）

| # | 约束 | 落地 |
|---|---|---|
| 1 先预览后落库 | 一切 AI 结果进 `aiPreviewStore` 的「草稿」；填实后用户逐条确认才写 `tasks`。批量带 `batch_id` |
| 2 结构化输出 | 统一 `runStructuredLLM<T>(schema)`：JSON mode / function calling + **输出后校验**（缺字段/类型错/引用了未知依赖 id）→ 校验不过自动重试 1 次 → 仍失败进降级。**绝不解析自然语言** |
| 3 降级可用 | 每个入口有：成功 / LLM 超时 / 网络失败 / 校验失败 四态。失败态回到手动表单或「按优先级排序的普通建议」
| 4 不编造 | `confidence`<0.5 的字段留空并标低置信；截止时间漏解析=不写 `due_date`，绝不猜 |
| 5 时间注入上下文 | 每次调用 prompt 前注入 `NOW_RFC3339`、`date()`、`('周'/'星期')`、用户时区。**告警：任何时间相关的纯函数（如 `两周计划`）也要这套上下文** |
| 6 可回滚 | 批量落库记录 `batch_id`（可查）；「一键撤销本批」删除本批创建/还原本批修改 |
| 7 成本可控 | 每个功能列 token 估算与缓存（见 §成本）。读取类 prompt 缓存；长上下文按需裁剪 |

## 共享基础设施（`src/lib/ai/`）

### LLM 适配器 `providers.ts`
```ts
interface LLMAdapter {  // 可插拔：OpenAI / Anthropic / Ollama(本地) / 假实现(测试)
  complete(params: { system: string; user: string; schema: JSONSchema; signal?: AbortSignal })
    : Promise<unknown>;   // 已解析并校验为合法的对象
}
async function runStructuredLLM<T>(dep: { schema; system; user; deps /*时间上下文*/; signal }): Promise<StructuredResult<T>>
type StructuredResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'timeout' } | { status: 'error' } | { status: 'validation'; errors: string[] };
```
- 时间上下文注入点固定：`injectTimeContext(user)` 返回 `NOW / today(date + 星期) / tz`。
- 超时默认 20s（日常）～ 60s（拆解/周报），可取消（AbortController，交互层「取消」按钮透传 `signal`）。
- 校验器 `validateAgainstSchema`：对每个字段做存在性/类型/枚举校验，`[]` 数组缺省、null 合法。

### 预览态 `aiPreviewStore.ts` + `lib/ai/batch.ts`
```ts
interface PreviewItem { kind: 'create_task'|'update_task'|'create_subtask'; patch: 草稿; confidence; source_span?; deps: 依赖提示 }
interface PreviewBatch { id: string; createdAt; items: PreviewItem[]; source: 'nl_parse'|'decompose'|'daily_plan' }
// 动作：adopt(batchId, itemIds?)（落库+记回滚日志）/ discard / regenerate / notifyAppliedBatch → 可调用 undo(batchId)
```
- 落库统一走 `applyBatch(batchId, selection)`：返回 `{ taskIds }`；写入 `ai_batches` 表（§数据增量）供回滚。
- 同批「创建」回滚=删这些 task；「修改」（每日计划改 due/时间）回滚=还原快照（落库前拍 `beforeJson`）。

### 估时校准表 `lib/ai/calib.ts` + 表 `estimate_calib`
- 来源：任务完成/专注后，把「该任务本轮 `actual_minutes`（见功能四闭环） ÷ 估算分钟（`est_pomodoros×focus_len`）」作为样本写入。
- 聚合键：`list_id`（项目）× `tags[0]`（或首 tag）；无则按 list。
- 维护策略：**滑动窗口固定 20 个样本**；**少于 3 个样本不产出**（返回空，走全局默认）；**MAD 剔除异常**（|x−median|>3·MAD 丢弃）；可调 `factor`（如 1.8 表示"这项目通常要花 1.8 倍估时"）。
- 使用：功能一/二/三在估算时把 {list, tag} → factor 注入 prompt：「该项目历史平均超估 1.8×，请把预计耗时 x mn 调整为建议值」。**这是长期壁垒，务必写入三处 prompt 模板。**

### 数据模型增量（双运行时镜像，SQLite `db.rs::SCHEMA` + IndexedDB `DBShape`）
```sql
-- 批量落库日志：供「一键撤销」与审计
CREATE TABLE IF NOT EXISTS ai_batches (
  batch_id   TEXT PRIMARY KEY,
  source     TEXT NOT NULL,           -- nl_parse | decompose | daily_plan
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'applied',  -- applied | undone
  beforeJson TEXT,                    -- 被覆盖字段的旧值（快照）
  task_ids   TEXT                      -- 本批创建/影响的 task id 列表(JSON)
);
-- 估时校准样本（滑动窗口在查询时取）
CREATE TABLE IF NOT EXISTS estimate_calib (
  id          TEXT PRIMARY KEY,
  list_id     TEXT, tag TEXT,         -- 聚合键（list_id × 首 tag）
  task_id     TEXT NOT NULL,          -- 产生样本的任务
  actual_min  INTEGER NOT NULL,       -- 本轮实际专注分钟
  est_min     REAL NOT NULL,          -- 本轮估算分钟
  factor      REAL NOT NULL,          -- actual/est
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calib_key ON estimate_calib(list_id, tag);
-- tasks 增列（闭环）
ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER DEFAULT NULL;   -- 完成/累计专注分钟
```
> `tasks.actual_minutes`：任务每次完成或专注写记录时累加（`focus_records.duration_min`），供校准与报表。

---

## 功能一：自然语言创建任务

### 数据流
```
输入一句话 → runStructuredLLM(parseTasks) → 校验（多任务/字段）→ aiPreviewStore(草稿) 
→ 用户确认页（字段可编辑 + 原文高亮 + 低置信强调 + clarify 点选）→ adopt → applyBatch → tasks
```
### Prompt（system 骨架，user = 句子 + 时间上下文 + 校准表 + 允许的任务清单）
```
system: 你是任务解析器。把用户一句话拆成 1..N 个任务，父子/并列都要拆（父=目标任务，子=子任务）。
抽取字段：title, project(=list_id 或清单名), due{date,time}, est_min(总耗时), slot_min(单次投入),
priority(high/medium/low/none), subtasks[], repeat(沿用 R 规则), dependsOn[]。
规则：
- 只填原文明确或强推断的字段；其余留 null。confidence<0.6 的字段留空并标低。
- 每个非空字段带 confidence(0..1) 与 source_span(原文 start/end 索引)，供前端高亮。
- 时间统一转 ISO8601(带时区 tz)；保留 raw_text。今天/明天/下周五/尽快按注入的日历解释；含"尽快""优先"→ priority=high 暂不写 due 并给 clarify。
- 歧义（如"下周""尽快""周三前"）产出 clarify_questions[]（选项+默认），不要猜死。
- est_min 用全局默认 25×1.5 估算时注入该校准表 factor（若有）。
[时间上下文] NOW=…; today=…(星期X); tz=…
[校准表] listA:1.8× / listB:0.9×
```
### 输出 Schema（JSON）
```jsonc
{
  "tasks": [{
    "title": "完成登录模块", "project": "发布版",
    "due": {"date":"2026-10-29","time":"18:00","raw_text":"下周五前"},
    "est_min": 400, "slot_min": 60,
    "priority": "high",
    "subtasks": [{ "title": "数据库设计", "est_min": 90, "due": {"date":"2026-10-27","raw_text":"周三前"} }],
    "repeat": "none",
    "depends_on": [],
    "_field_provenance": { "title": {"confidence":1,"span":[0,18]}, "due": {"confidence":0.9,"span":[0,4]} }
  }],
  "clarify_questions": [{ "id":"q1", "text":"「下周五」最近一个周五还是下下个周五？", "options":["最近周五","下下周五"], "default":0 }]
}
```

### 交互流程
1. 概览页/任务页顶部「✨ 描述任务」输入框，聚焦即出引导气泡：「直接说『明天下午三点前把报告初稿写完』」。
2. 回车 → 进行中态（可取消）→ 解析完成进入预览面板（浅色底 + 「AI 生成」标签 + 重新生成/撤销 + 原文逐段高亮 hover 联动每个字段）。
3. 每个字段可编辑（复用 TaskEditModal 控件）；confidence<0.5 的字段加黄色强调 + 提示「低置信，建议人工核对」。
4. `clarify_questions` 弹成点选，选完局部重算（同一批，不再多花一次主解析）。
5. 「采纳所选」→ applyBatch。失败/超时 → 降级为普通添加框（手动填），并提示「AI 暂时不可用」。

### 边界与降级
- 空/纯情绪句（"累了"）→ 校验失败 → 手动表单。
- 多任务里混「父+子」：父任务生成时把 `subtasks` 直接生成为 `tasks.completed=0` 的子任务（list 同父）。
- 重复规则冲突：若 `repeat!=none` 且带 due_time → 沿用 `lib/recurrence`，AI 只出枚举，不出日推（避免它算错）。
- 估算缺失：不写 est，前端给「沿用上次同类」快捷按钮（校准表在侧）。

---

## 功能二：AI 任务拆解

### 数据流
```
目标/已有任务标题 → runStructuredLLM(decompose, 第N次 + 上下文) → 校验(层级/依赖无环) → 草稿树(未保存)
→ 前端可勾选/拖拽/改层级/合并 → 部分采纳(子树) → 「重新拆解该子树」→ 局部替换
```
### Prompt / Schema（三层树，临时 id，无环校验）
```jsonc
{
  "top": {
    "title":"智能家居控制面板","total_est_min":1800,"critical_path_hint":"网关对接 → 设备状态聚合 → 控制指令下发",
    "children":[{
       "title":"网关对接", "est_min":300, "acceptance_criteria":"能通过局域网收到网关心跳",
       "children":[{"title":"协议解析","est_min":120,"acceptance_criteria":"心跳包可被解析为结构化事件",
                    "children":[{"title":"帧头帧尾校验","est_min":45,"acceptance_criteria":"坏帧被丢弃且不阻塞"}],
                    "depends_on":["c_gw_a"]}],
       "depends_on":[]
    }]
  }
}
```
- 每次调用 head 注入 `generation=第N次` + `previous_summary`（首次为空）+ `extra_constraint`（用户后续给的）。
- 落库前做**拓扑校验（无环）+ 三层深度裁剪**；临时 id `depends_on` 在 adopt 时替换成真实 id，环+缺节点直接标 `validation_errors` → 降级为「仅落地无依赖部分」。
- `acceptance_criteria` 单句、可判断；缺失则标低置信可留空。

### 交互
- 目标为空：在任务列表「拆分这个任务」右键入口；已勾选任务 → 拆成它的 `subtasks`。
- 草稿树：勾选子树 →「采纳所选」；节点右键 →「重新拆解此子树」「在下方新建子任务」「删除」「提升层级」。最终 `applyBatch(batch_id, selected)`。

### 边界
- 3 层上限截断并提示「更深层请逐层拆解」。
- 总工期=叶子 est 之和；`critical_path_hint` 为模型给的一句话提示，可被前端按依赖重算覆盖。

---

## 功能三：AI 每日计划（重点）

### 数据流（规则优先，LLM 只做排序/triage，装箱用确定性代码）
```
输入：
  { 未完成任务(含 priority/due/est/dependsOn/project/历史延期次数),
    可用时段[{start,end} 如 20:00-23:00], 精力偏好, 近期完成记录, 硬约束(承诺项) }
→ step1 确定性过滤: 依赖未就绪的剔除; must = 有截止且<=今+2天 或 承诺项; 其余 = should pool
→ step2 LLM: 对 must+should 给出 (task, priorityRank, 建议slot预估, reason)
→ step3 确定性装箱: timebox.ts 按 容量(可用-15~20%缓冲)、同项目聚块、单块<=专注上限(默认90)、拒绝超载
→ step4 产物: { blocks:[{project, tasks:[{taskId, est_min, reason}]}], deferred:[{taskId, reason, suggest_date}] }
→ 预览 → adopt 落库(写 due/顺序/计划) → 可增量重算
```
### LLM 只负责的决策
- triage（must/should/defer）排序 + 每项一句 `reason`（"截止明天且仅剩40分钟"）——**不把时间算术交给 LLM**。
- SHELL 上下文中给出：可用时段、校准 factor、硬约束、延期次数。
### 确定性装箱 `lib/ai/timebox.ts`
- 容量：`sum(est_min of chosen) ≤ 可用分钟×0.82`（18% 缓冲）。
- 依赖：任务须在它的 `depends_on` 之后。
- 同项目聚合：跨块代价大 → 同 list 优先同块。
- 块上限：建议专注 ≤90min，>则建议拆成两段并提示。
- **超载**：must 总时长已 > 容量 → 不发篇，返回 `conflict: { overrun_min, 建议: [砍/延哪个, 或提示今天可用不足/推迟到明天] }` + 不落库。
### Inverse（可调整 + 增量重算）
- 用户拖拽换块/postpone"今天不做" → 标记后 `recomputePlan(changedTaskIdOnly)`：只对该块及其他受影响块重跑 step3，**不重新调 LLM**（保存上次 triage 结果），除非用户显式「重新生成」。

### 边界与降级
- 无可用时段 → 提示无法排程，转纯「建议今天做列表」(仅 LLM)。
- LLM 挂了 → 降级为「按 priority+due+est 的确定性排序」建议（无 reason，但能用）。
- 空 must → 直接排 should，仍留缓冲空档。

---

## 功能四：AI 日报 / 周报

### 数据流
```
真实数据聚合（SQLite 确定性计算，不靠 LLM 数数）：
  plan vs actual（tasks.completed/completed_at vs due）、start/end(focus_records)、
  延期次数(completed_at>due 计数)、估算vs实际(focus_records/est)、被打断次数(timer_state 中 abort 计数)
→ runStructuredLLM(report, {周期数据概要, 校准表}) → 五段式报告 → 落 ai_batches(只读展示，不入 tasks)
```
### 必含五段（均来自注入的聚合数据，LLM 只负责「生成叙述 + 归因」，不新造数字）
1. **完成情况**：按项目/优先级分组 + 完成率。
2. **偏差分析**：`delay_count>=2` 标记「钉子任务」+ 可能原因（LLM 给一句归因建议，标低置信）。
3. **工时校准**：输出 `{list/tag, factor, next_estimate}`；**同时把本轮样本写入 `estimate_calib`**（闭环）。
4. **风险预警**：未来 1–2 周、due 临近未完成的项 + 一句风险描述。
5. **下阶段建议**：≤3 条、具体可执行（能直接作为功能一输入）。

### 闭环（务必实现）
- 任务完成回调（`toggle_task` 置 completed=1 时）若该任务有 `focus_records` → 累加 `actual_minutes`。
- 每次报表运行后把样本写 `estimate_calib`（滑动窗口/MAD）。
- **功能一/二/三的估算 prompt 永远带 `estimate_calib` 聚合结果**（§共享）。

### 边界
- 周期无数据 → 空态「本周还没有任务」+ 手动表单入口，不调用 LLM。
- 周报提示词 token 大 → 概要用结构化片段（只喂 title/project/est/actual/delay 数组的裁剪版），配置长度上限。

---

## 交互与体验（贯通全部功能）
- 进行中态：每个 AI 动作有 spinner + 「取消」；拆解/报告用「分步展示」（step1 正在聚合→ step2 AI 分析 → step3 整理完成）。
- 视觉隔离：`.ai-panel` 浅色底 + 左上「AI 生成」标签；右上「重新生成 / 编辑 / 撤销本批」。
- 首次引导：任务页顶部一行的淡色引导气泡（一句话示例 + 「知道怎么用了」）。
- 错误文案：`ai.err.*` 走 i18n，前端永不展示原始 API 报错（只提示「AI 服务暂时不可用，可手动填写」）。

## Token / 成本预算（估算）
| 功能 | 输入 tokens | 输出 tokens | 缓存策略 |
|---|---|---|---|
| 功能一 解析 | ~800（句+schemas） | ~350/句 | 同句不缓存；`due` 相关靠注入时间，无独立性可缓存 |
| 功能二 拆解 | ~1500 | ~900/子树 | 子树生成不可缓存；top 概要可 LRU(5) |
| 功能三 计划 | ~2500 | ~1200 | triage 结果缓存到「手动重排」失效 |
| 功能四 周报 | ~4000(裁剪) | ~1200 | 同周期不重跑；跨期清 |
> 单日重度使用（解析×10 + 拆解×3 + 计划×1）≈ 输入 ~20k / 输出 ~6k tokens，可忽略不计。本地 Ollama 拉最大模型则无 API 成本。

## 验收清单（每项 P0）
- [ ] 全局：所有 AI 输出先进预览、确认才落库；批量带 batch_id 可一键撤销。
- [ ] 全局：结构化 JSON + 校验重试；LLM 失败/超时任一功能退化为手动表单 / 确定性排序 / 空态。
- [x] 时间注入：三个功能 prompt 均带 NOW/星期/tz；「下周五」类表达式本地化正确（`verify-ai.ts` 断言）。
- [x] 功能一：多任务+父子拆分、字段 confidence/source_span、低置信强调、clarify 点选、原文高亮。
- [~] 功能二：≥3 层树、acceptance_criteria、依赖无环、部分采纳、草稿树编辑 ✅；**子树重拆**未做（后续在节点右键补）。
- [~] 功能三：容量≤可用×0.82 且宁少勿多、must/should+理由、同项目聚块、超载给冲突提示不发满单 ✅；**依赖约束装箱 / 手动重排增量重算**未做。
- [~] 功能四：五段报告、钉子任务/因子/风险/≤3 建议、确定性聚合 ✅；**落 `estimate_calib` 表闭环**未做（当前派生计算）。
- [x] 校准表：滑动窗口+MAD、min 样本阈值；功能一二三估算带 factor。
- [x] 双运行时红线：新模块为纯 TS（Adapter 同源数据），不触碰 DB 边界；`check-runtime-parity` 不违例。

## 里程碑（`07-backlog` 拆条）
- **AI-M1 基础设施**：`lib/ai/providers.ts` + `runStructuredLLM` + 时间注入 + 预览态/回滚 + `ai_batches`/`estimate_calib` 表 + fake LLM 测试推进。
- **AI-M2 自然语言创建**：功能一端到端 + 预览确认页 + 引导 + 降级。
- **AI-M3 任务拆解**：功能二草稿树 + 部分采纳 + 子树重拆。
- **AI-M4 每日计划**：功能三 rule+LLM+timebox+增量重算。
- **AI-M5 日报周报 + 校准闭环**：功能四 + `actual_minutes` + 校准表写入/注入。
- 每里程碑 P0 验收全绿再前进；`verify-ai.ts` 入 `check-all.sh`。