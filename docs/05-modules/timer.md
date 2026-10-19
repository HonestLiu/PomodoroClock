# 模块 · 番茄钟（timer）

## 目标
可靠、沉浸的专注计时：状态机正确、计时不漂移、可恢复、设置全量可配。

## 当前状态
- ✅ **三种计时模式**：番茄钟（25:00→00:00 专注 + 休息循环）、倒计时（递减到点即停）、正计时（00:00 起无限增长）；暂停/恢复/跳过、长休息、全屏、恢复横幅。
- ✅ 绝对时间戳计时 + 关闭后恢复结算、全屏、任务选择/今日面板/时间轴。
- ✅ 白噪音：工具条「白噪音」按钮直接打开**全局选择弹窗**（`components/NoisePicker.tsx`，标题 + 音量滑杆 + 5 个音色圆形封面 + 取消/确定；原内嵌小浮层已移除）。图标与 `.on` 高亮跟随 `stores/noiseStore.ts` 的 `playing`；选音色即试听、确定才落库、取消回滚。
- ✅ 番茄钟设置（时长/长休息/目标/自动下一轮）读入并影响计时。
- ✅ 会话恢复提示（恢复横幅）、结束反馈文案（`timer.feedback.focusDone/breakDone`）、自动下一轮。
- 🔶 倒计时/正计时**共用** `focus_len_min` 作时长，暂无每模式独立时长；正计时「按模式自动播放白噪音」（★4）仍未接线。

## 规则与口径
- 阶段时长：`timer/engine.ts::phaseDurationMs` —— 正计时恒返回 0；`focus=settings.focus_len_min`；`break= completed % long_break_every==0 ? long_break : break`（completed 为本轮已完番茄数）。
- **三模式语义与结算归属**（同一状态机，差别只在时长、到期判定与谁写记录）：
  | 模式 | 起始显示 | 到期 | 结算 |
  |---|---|---|---|
  | 番茄钟 `pomodoro` | focus_len（25:00） | 递减到 00:00 | 写 `focus_record` → 进休息循环（`auto_start_next` 可配） |
  | 倒计时 `countdown` | focus_len（25:00） | 递减到 00:00 **即停** | **不写记录、不进休息**：反馈「倒计时结束 ✓」、阶段回「准备开始」、广播 `timer://finished`（payload 带 `mode:'countdown'`）、通知 `countdown_done`、响铃 |
  | 正计时 `stopwatch` | 00:00 往上 | **永不到期**（`isExpired` 恒 false） | 主按钮变「停止」→ 写记录（`round((now−start_at)/60000)` 分钟）；**不足 1 分钟不写**并提示「不足 1 分钟，未记录」 |
- 切模式/重置后显示的起始值由 `timerStore.ts::idleDurationFor(mode, settings)` 决定（正计时 0、其余为专注时长）；它取代了原先散落的 `Math.round(settings.focus_len_min*60_000)`，`setMode/setSettings/reset/stop/checkExpiry` 统一走它——**否则切到正计时还会显示番茄钟的 25:00**。
- 专注结束（番茄钟）→ 若 `auto_start_next` 自动进入休息，否则**待开始**；写 `focus_record`（实际起止、`duration_min`）。倒计时/正计时结束后 phase 回 `idle`，不停在「待继续」态。
- 跳过不写记录；`stop()` 只对正计时有意义（其余模式等价于 `reset()`）。
- 白噪音弹窗可从专注页弹出（`.noise-overlay` z-index 400 > 专注层 200）；弹窗内试听不落库，`确定` 才写 `settings.noise/noise_volume`，选「无」只停止播放、不覆盖已存音色。
- 退出全屏专注层：`Esc` 或右上「收起」；控件已消费的 Esc（`defaultPrevented`）与输入框/下拉/滑块内的 Esc 不拦截（`TimerScreen.tsx` 的 window keydown 监听）。
- 恢复：启动时读 `timer_state`；关闭期间结束的补结算（见 `04-data.md`）。

## 待办增量
- ★1 ✅ 恢复提示：启动检测到上一会话时，专注界面显示恢复横幅，可「继续下一阶段」或「知道了」关闭。
- ★2 ✅ **结束反馈**：专注/休息结束在 CTA 上方短暂显示文案，并配合系统通知（见 `notify.md`）。
- ★3 ✅ **三模式语义落地**（2026-10-18）：倒计时到点即停、正计时「停止」写记录、`idleDurationFor` 统一起始值、暂停冻结已用时（不含暂停时长）。剩「每模式独立时长」未做（现共用 `focus_len_min`）。
- ★3b ✅ 模式菜单入口改为 `.timer-mode-menu`（原复用 `.seg`，在工具条窄宽度下被挤成竖排单字并压住主按钮）：`bottom:44px`、`@media (min-height:700px)` 抬到 `104px`、`white-space:nowrap` + `flex` 保证三项一行。
- ★4 白噪音按模式保存（专注流/休息流各自记忆上次选择）。

## 数据影响
- 复用 `timer_state`；`mode` 写三值之一。仅前端状态（反馈文案、草稿态）不落库。
- `paused_remaining_ms` 的双重含义：番茄钟/倒计时「未开始」时 = 目标专注时长（决定显示 25:00）；正计时「未开始」时 = 0（显示 00:00），暂停时 = 已冻结的**已用时**。Rust `timer_engine.rs::remaining_ms` 与前端 `engine.ts::remainingMs/displayMs` 已按此对齐。

## 验收
- [ ] 计时误差 ≤1s（跨休眠恢复）；重启后状态正确。
- [x] 恢复提示出现且行为正确；结束反馈可见。
- [x] 三模式语义：倒计时到点提示「倒计时结束」且**不写** `focus_record`、不进休息；正计时「停止」写记录、不足 1 分钟提示「不足 1 分钟，未记录」；正计时暂停后再停止，暂停时长不计入（纯函数自检 `npx tsx tools/verify-timer.ts` 20/20）。
- [x] 模式菜单三项一行、起始值「倒计时 25:00 / 正计时 00:00」（`tools/shoot.mjs` 断言）。
- 关联：`06-acceptance.md` C 组、`timer/engine.ts` + `timer_engine.rs` 双实现。
