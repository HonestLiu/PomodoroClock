# 06 · 全量验收清单

> 状态图例：`[x]` 已通过 / `[~]` 部分 / `[ ]` 待办；标 **〔脚本〕** 的项由 `bash tools/check-all.sh` 自动覆盖，不必手工复跑。P0 全绿方可交付（沿用 CLAUDE.md §10，附加当前核验状态）。

## A. 全局框架
- [x] P0 自定义标题栏：红黄绿按钮位置/语义正确，可拖拽窗口
- [x] P0 侧边栏 7 分类 + 账号区 + 搜索框 + 创建清单，当前项高亮〔脚本：`tools/shoot.mjs` 首屏结构断言〕
- [x] P0 归档分组：「已完成」「记录」位于「任务」与自定义清单之间（分隔线分组），且不显示随使用累积的时长/角标；「已完成」= 任务归档、「记录」= 番茄归档（页面内部各自仍有完整统计）
- [x] P0 顶栏 6 图标可点，铃铛角标显示未读数
- [x] P1 悬浮番茄小窗常驻右下，可拖动、可播放/收起
- [x] P2 清单可拖拽排序 + 默认清单

## B. 任务管理
- [x] P0 添加任务回车保存；任务行显示 名称/预估番茄数/日期
- [x] P0 勾选完成 → 已完成归档；「显示已完成任务」展开/收起
- [x] P0 4 统计卡片数值与 §7.2 口径一致〔脚本：`tools/verify-data.ts`〕
- [x] P1 任务编辑弹层（名称/清单/预估番茄/日期）；删除任务
- [x] P1 更多菜单 / 右键（删除、移到清单、复制）
- [x] P1 拖拽排序（视图内重排 + 跨清单移动）——`tasks.md` ★2
- [x] P0 今天/明天/本周/已计划筛选规则正确
- [x] P0 **逾期留驻**（用户需求 2026-10-19）：逾期未完成任务留在「今天/本周」并置顶 + 红色「逾期」标志/日期，不再只沉到「任务」〔脚本：`verify-data.ts` 14 条时间视图断言 + `shoot.mjs` S1b〕
- [x] P1 **来源徽标**：自定义清单任务按到期日出现在今天/明天/本周时标注来源清单（色点+名称，点击跳回）；内置清单不打标〔脚本：`verify-data.ts` 合成数据集断言；浏览器端到端复核〕
- [x] P0 记录视图按日期分组，条目 = 任务名+时长+起止时间（原「已完成」，2026-10-19 改名「记录」）
- [x] P0 已完成视图为常驻项：按完成日期分组展示全部已完成任务，行内可反勾选/编辑/删除，空态有文案〔脚本：`tools/shoot.mjs` S2b〕

## C. 番茄钟
- [x] P0 专注/休息状态机正确流转；倒计时 MM:SS
- [x] P0 **三种计时模式**：番茄钟 / 倒计时 / 正计时——模式菜单三项且一行排开；起始值「倒计时 25:00 / 正计时 00:00」〔脚本：`tools/shoot.mjs` + `tools/verify-timer.ts`〕；倒计时到期提示「倒计时结束」且**不写** `focus_record`、不进休息；正计时「停止」写记录、**不足 1 分钟不写**并提示；正计时暂停后再停止，暂停时长不计入
- [x] P0 专注结束写 focus_record，进入休息；休息结束回专注〔脚本：`cargo test --test queries`〕
- [x] P0 任务选择框 + 右侧今日面板（专注时间/待完成/记录时间轴）
- [x] P1 白噪音可开关；全屏可切换；工具条与设置页入口都打开**统一选择弹窗**（6 项：无 + 5 音色，5 张圆形封面可解码，含音量滑杆与取消/确定）
- [x] P1 **系统通知**（tauri-plugin-notification）+ 系统/应用内通知双开关
- [x] P1 小窗：海浪背景+任务名+番茄计数+播放键
- [x] P1 关闭/重启后会话可恢复 + **恢复提示 UI**——`timer.md` ★1
- [x] P2 倒计时/正计时模式完善——`timer.md` ★3 已落地；剩「每模式独立时长」未做（现共用 `focus_len_min`）

## D. 报表
- [x] P0 6 统计卡片数值正确（红/蓝配色一致）〔脚本〕
- [x] P0 番茄记录图：时间×日期网格，今天蓝/历史灰
- [x] P0 专注时间详情：日/周/月/年切换 + 任务进度条 + 显示任务开关
- [x] P0 清单时间分布环形图 + 周期切换
- [x] P0 每日目标：目标时长、专注天数、完成目标天数、完成率、月历标记
- [x] P2 近 30 天趋势图——`charts/TrendChart.tsx`，报表内渲染（`ReportModal.tsx:139`）
- [x] P2 目标达成环——`ReportModal.tsx:223`（定义 :233-234），随今日进度实时刷新

## E. 设置
- [x] P0 设置弹窗左侧 7 项导航；默认账号页
- [x] P0 账号页 = 软件账号中心（PocketBase），单一 `.account-card` 两态：
  - [x] 登录卡：logo + 标题 + 副标题（不登录也能用全部本地功能）+ 邮箱/密码 + 主按钮 + 登录↔注册切换 + 忘记密码 + 提示行
  - [x] 账号卡：头像（云端头像，无则首字母）+ 用户名（`cloud.user.name`，空回退 email @ 前缀）+ 邮箱 + 「已登录」徽标
  - [x] 昵称：注册表单可填（可选、`maxLength=32`、placeholder 提示上限）；账号卡 `.account-edit`「编辑资料」就地展开改昵称（Enter 保存 / Esc 收起 / 失败保持展开），改完卡片与侧边栏同步、刷新持久；>32 码点（绕过 `maxLength` 粘贴 40 字）被拒并提示 `err.nicknameTooLong`；邮箱只读（`PATCH { email }` → 400 `validation_values_mismatch`）〔证据：PB 端到端昵称断言，含云端字段真读与「取消不改动」〕
  - [x] 头像：可上传/更换/移除；刷新后仍在；侧边栏同步；非 png/jpeg 或 >2 MB 被拒（`err.avatarType`/`err.avatarTooLarge`）；`.account-avatar` 为按钮 + 相机遮罩 + 无障碍标签〔证据：PB 端到端断言 `/api/files/users/` URL、`naturalWidth` 真实解码、侧边栏同步、云端 `users.avatar` 写入/清空；`tools/shoot.mjs` 暂未覆盖头像结构〕
  - [x] 同步区：状态行 / 上传 / 恢复 / 自动同步说明（未登录时不渲染）
  - [x] 改密码：就地展开，必须带当前密码；成功后自动换新 token，换失败提示重新登录（`stores/authStore.ts::changePassword`）
  - [x] 忘记密码：`users.request-password-reset`（SMTP 已配，实测 204）
  - [x] 本地数据区：说明 + 红描边删除数据（已登录多一行云端覆盖警告）；退出登录不关闭弹层
  - [x] 退出登录是会话级、可逆：只清 PB 会话，**本地任务与专注记录保留**（端到端断言「退出后任务仍 3 条、侧边栏回本地默认身份」）；不可逆清理只走「删除数据」
  - [x] 已移除**旧的本地**头像上传 / 旧的「编辑资料」整表单（昵称/邮箱/座右铭一起改） / 本地改密码 / 云同步独立区块；`tools/shoot.mjs` 断言 `.profile-avatar/.profile-edit/.profile-form`、`.cloud-card` 为 0（现头像走云端、昵称就地编辑，见上）
- [x] P0 删除数据/注销账号有二次确认，且实际清库
- [x] P1 番茄钟设置（专注/休息时长）影响实际计时
- [x] P2 语言切换即时生效（i18n）〔脚本：英文界面无中文残留〕——词表 `src/i18n/`（zh/en 键集一致，约 358 键、由脚本核对键集一致），切换在外观页语言下拉（`patch('language')` + `setLang`），启动应用 `App.tsx:45`，首启跟随系统语言
- [x] P2 深色主题全屏核对——`App.tsx` 写 `data-theme`，`styles/global.css` 深色变量；5 屏已核对 + 低对比度扫描〔脚本：`tools/shoot.mjs`〕
- [x] P2 系统通知开关——系统/应用内两个开关（通知页 `system_notify` 开关），`timerStore.ts::checkExpiry` 门控；真机弹窗待验证
- [x] P2 登录 + 云同步（PocketBase）——离线优先；冲突按 rev→updated→device 裁决；PB 不可达静默降级（`lib/sync.ts::resolveDirection`、`stores/authStore.ts`）；端到端 36/36 已实测（2026-10-18，含昵称读写与编辑资料，见 `08-changelog.md`）

## S. 搜索（附加，来自 `search.md`）
- [x] P2 快捷唤起（⌘/Ctrl+K 或 /）；即时过滤分组；↑↓ 选择、回车定位并高亮目标；Esc 关闭

## F. 技术
- [x] P0 Tauri 2 工程可构建运行（dev + release build 均通过，出 .app/.dmg）
- [x] P0 SQLite 迁移自动执行，数据持久化重启不丢
- [x] P1 计时基于时间戳，误差 ≤ 1s
- [~] P1 三平台至少两平台真机验证（macOS 通过；**Windows/Linux 待验证**）
- [x] P1 单元/行为测试：`cargo test`（16 passed）+ `tools/verify-data.ts` + `tools/verify-timer.ts`（20 项计时口径）+ Playwright 截图【脚本：`tools/check-all.sh`】
- [x] P0 **双运行时数据一致**：桌面版任务列表正确渲染（曾失效，已修复，见 `08-changelog.md`）
- [x] P0 守卫 `tools/check-runtime-parity.sh` 纳入流程〔脚本：`check-all.sh` 第 2 步〕

## G. 可访问性 / 自动化验收（2026-10-18 新增）

- [x] P2 模态：Esc 关闭、Tab 焦点循环、打开聚焦首要素、关闭还原焦点；叠层时只有最上层响应（`components/useModalA11y.ts`，接入 Settings/Report/Placeholder/ConfirmDialog/TaskEditModal）
- [x] P2 模态语义：`role="dialog"` + `aria-modal` + `aria-labelledby`
- [x] P2 菜单全键盘：`role=menu/menuitem`、↑↓ 循环、Home/End、→ 进子菜单、← 返回、Esc 关闭、Tab 关闭（`components/Menu.tsx`）
- [x] P2 拖拽的键盘等价：任务行 `Alt+↑/↓`（`pages/TaskView.tsx`）、清单行 `Alt+↑/↓`（`components/Sidebar.tsx`），结果经 `role="status" aria-live` 播报
- [x] P2 设置左导航：`role=tablist/tab/tabpanel` + 方向键切换（`SettingsModal.tsx::onNavKey`）
- [x] P2 专注全屏层 Esc 关闭：控件已消费的 Esc、输入框/下拉/滑杆内不拦截（`TimerScreen.tsx` 的 window keydown）
- [x] P2 焦点可见：`focus-visible` 覆盖 input/textarea/select/a/button/[tabindex]/[role=*]（`styles/global.css`）
- [x] P2 开关键盘可达：`.switch input` 改视觉隐藏（原 `display:none` 完全不可达）
- [x] P2 组件异常不白屏：`components/ErrorBoundary.tsx` 在 `main.tsx` 包裹根节点
- [x] P2 一键验收：`bash tools/check-all.sh --with-shots` **7 步全绿**〔脚本〕
- [x] P2 账号页结构断言〔脚本：`tools/shoot.mjs`〕：`.acct-section` 至少 2 个（账号区 + 本地数据区）、`input[type="email"]`、`input[type="password"]`、`.acct-row-actions .btn.primary`、`.acct-link`、危险按钮 `.btn.danger`；未登录不得出现 `.acct-badge` / `.acct-avatar`；旧结构 `.profile-avatar`、`.profile-edit`、`.profile-form`、`.cloud-card`、`.account-card` 必须为 0（账号页已并入设置页统一 field 栅格）
- [x] P2 白噪音弹窗结构断言〔脚本：`tools/shoot.mjs`〕：点工具条白噪音必须出现 `.noise-modal`；`.noise-item` 恰为 6（「无」+5 音色）、`.noise-thumb` 中 `<img>` 恰为 5 张且 `naturalWidth>0`（内嵌封面缺失会直接失败）、`.noise-slider` 与 `.noise-foot .btn.primary` 各 1；取消后弹窗关闭。截图 `S5c-noise-picker.png`（截图检查共 **8** 项）。
- [x] P2 计时模式菜单断言〔脚本：`tools/shoot.mjs`〕：`.timer-mode-menu button` 数量 = 3 且 top 坐标差 < 2px（被挤成换行即失败）
- [x] P2 计时模式起始值断言〔脚本：`tools/shoot.mjs`〕：切「倒计时」显示 25:00、切「正计时」显示 00:00
- [x] P2 白噪音落库语义：选音色 + 拖音量 → 确定才写 `settings.noise`/`noise_volume`；取消回滚试听；选「无」只停播、不覆盖已存音色；重开弹窗回显上次值〔手测：雨声 80% → IndexedDB `noise=rain`、`noise_volume=0.8`；设置行提示「雨声 · 80%」〕
- [x] P2 英文界面无中文残留（含专注全屏层；排除 §6.3 演示数据与语言自名）〔脚本：`tools/shoot.mjs`〕
- [x] P2 深色主题低对比度扫描（深色 `--text-3` 已提到 4.17:1）〔脚本：`tools/shoot.mjs`〕
- [~] 浅色 `--text-2 #8a8a8a`(3.45:1) / `--text-3 #b4b2ad`(2.1:1) 未达 WCAG AA——PRD 指定色，待产品决定（见 `07-backlog.md` #31）

## 验收流程建议
每阶段收尾跑一条命令即可：

```bash
bash tools/check-all.sh --with-shots   # tsc → 红线 → 种子口径 → 计时模式口径 → cargo test → build → 截图 13 检查
npx tsx tools/verify-timer.ts          # 单独跑计时口径自检（20 项）
```

- `--skip-build` 只跑类型与测试；`--with-shots` 会在 4173 无服务时自动 `vite preview`。
- **4173 服务的是 `dist/`**：改完源码必须重新 `npm run build` 再预览，否则截图看到的是旧产物（此坑已踩）。
- 脚本全绿后，再手工抽查「P0 全部 + 本阶段新增」的观感项（截图比对、交互手感），通过后更新本文档状态并打 `+1` 阶段标记。
