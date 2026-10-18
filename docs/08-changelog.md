# 08 · 变更与缺陷记录

> 记录**已修复的缺陷**与**重要变更**，供回归与追溯。每条含：现象、根因、修复、验证、防复发。

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
