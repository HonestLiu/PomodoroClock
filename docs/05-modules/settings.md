# 模块 · 设置（settings）

## 目标
完整、可信的设置体系：账号、外观（深色/背景）、番茄钟、通知、语言、清单、关于——每项都真实生效。

## 当前状态
- ✅ 7 导航弹窗；**账号页 = 软件账号页（PocketBase）**，同一 `.account-card` 两态：
  - 未登录 = 登录/注册卡：logo + 标题 + 副标题（「不登录也能用全部本地功能」）+ 邮箱/密码（注册态多确认密码）+ 主按钮 + 登录↔注册切换 + 忘记密码 + 提示行。
  - 已登录 = 账号卡：头像（云端头像，无则首字母）+ 用户名（`cloud.user.name`，空则回退 email 的 @ 前缀）+ 邮箱 + 「已登录」绿点徽标 + 同步区（状态行/上传/恢复/自动同步说明）+ 就地改密码 + 退出登录。
  - 两态共用卡外「本地数据」区（删除数据；已登录时多一行「删除后本地配置恢复默认，并可能自动上传覆盖云端」）。
  - 已移除：**旧的本地**头像上传、旧的「编辑资料」整表单（昵称/邮箱/座右铭一起改）、本地改密码表单、云同步独立小区块（`SettingsModal.tsx::AccountPane`，账号 tab 直接渲染它）；现头像为云端账号头像、昵称可就地改、邮箱只读（见下）。
- ✅ i18n 中/英切换即时生效（外观页语言下拉：`patch('language')` + `useI18nStore.setLang`）；深色主题写 `data-theme` 并全屏可用。
- ✅ 外观页白噪音行＝「选择白噪音」按钮 + 当前值提示（`音色 · 音量%`）——点开的是全局选择弹窗（见 `03-architecture.md` §白噪音选择弹窗），不再是下拉框；「专注时播放/休息时播放」两个开关仍在。
- ✅ 通知两开关（应用内 / 系统）、番茄钟时长与自动下一轮真实生效。
- ✅ 通用页「启动页」下拉（`startup_page`）：默认 `timer`＝启动即展开专注界面；可选今天/明天/本周/已计划/任务/已完成/记录/日历，启动时 `App.tsx` 先 `initTimer({ openScreen: false })` 载入设置再分流导航，选页面时不再弹专注界面。TS `Settings.startup_page` 与 Rust `Settings.startup_page`/`load_settings` 双侧锁步（`04-data.md`）。
- ✅ `autostart` 开机自启已接线：`tauri-plugin-autostart`（`Cargo.toml` + `capabilities` `autostart:default`）+ `lib/autostart.ts`；设置通用页开关 → enable/disable 写系统自启，`App.tsx` 启动时以库内 value 对齐系统。macOS LaunchAgent / Windows Run / Linux autostart。
- 🔶 高级版为规格占位（静态三档价格卡，订阅流程未实现）。

## 规则
- 所有「开关/选择」即时持久化到 `settings` KV 并立即影响行为；**付费仍为延迟**，云同步已落地（见下条）。
- **账号即 PB 账号**：登录/注册、改密码、忘记密码都直连 PocketBase，本地不存副本；PB 不可达时静默降级，本地功能不受影响。
  - 改密码必须带当前密码（PB `users` 集合强制 `oldPassword`，缺则 400 `validation_required`）；改成功后 PB **作废该用户全部既有 token**，`authStore.changePassword` 会立刻用新密码重新 `authWithPassword` 换 token，换失败则清会话并提示「请用新密码重新登录」（`lib/pb.ts::pbUpdateProfile`、`stores/authStore.ts::changePassword`）。
  - 忘记密码走 `users.request-password-reset`（`lib/pb.ts::pbRequestPasswordReset`），该实例 SMTP 已配置，实测返回 204；前端只提示「已发送」，不据此判断邮箱是否存在。
  - **头像**（仅已登录）：点账号卡头像（`.account-avatar` 实为按钮，hover/focus/上传中显示相机遮罩）选图上传，`移除头像` 清空；写 PB `users.avatar` 文件字段（`lib/pb.ts::pbUploadAvatar`/`pbDeleteAvatar`），不落本地。限 `image/png`/`image/jpeg` 且 ≤2 MB（`stores/authStore.ts::uploadAvatar` 前置校验，超限提示 `err.avatarType`/`err.avatarTooLarge`），服务端 PB 另有 5 MiB 上限；成功后 `authStore.user` 更新并持久化——刷新仍在，侧边栏头像同步（云端 avatar → 本地 `avatar_path` → 首字母）。
  - **昵称 / 编辑资料**（仅已登录）：账号卡用户名右侧 `.account-edit`「编辑资料」（`aria-expanded`）展开就地 `.account-profile-form`——昵称输入（`maxLength=32`）+ 灰字「邮箱暂不支持在此修改」+ 保存/取消；Enter 保存、Esc 收起，**保存失败保持展开**（`SettingsModal.tsx::saveProfile`/`closeProfile`）。写 PB `users.name`（`lib/pb.ts::pbUpdateName`，客户端 trim；>32 码点本地拒绝 `err.nicknameTooLong`，服务端上限 255）；成功后卡片与侧边栏即时同步、提示「资料已更新」（`account.profileSaved`）。注册表单同字段可选填（`lib/pb.ts::pbRegister` 仅在非空时带 `name`）。**邮箱只读**：`PATCH { email }` 会被 PB 以 `validation_values_mismatch` 拒绝，故 UI 不提供入口。老用户首次登录若云端 `name` 为空，会用本地 `username` 回填一次并静默（`App.tsx`，`nickname_backfill:<userId>` 只试一次）。
  - 退出登录是**会话级、可逆**操作：只清 PB 会话（token + LocalAuthStore），**不碰任何本地表**（`api/local.ts::logout` 仅 `await ready()`；`commands/user.rs::logout` 无参 `Ok(())`；`api/tauri.ts` 不再包 `mutate('all', …)` 广播），任务与专注记录全部保留；**不关闭设置弹层**，原地切回登录卡并提示。PRD FR-S2 的「注销账号 → 登出并清理」**已废弃该口径**——不可逆清理改由「删除数据」（`clear_all_data`）单独承担。
- **深色主题（★）**：`theme` 切换即时写入 `documentElement.dataset.theme`；逐屏（侧边栏/任务/报表/设置/专注界面）核对对比度与图片适配（局画面固定浅色或加深遮罩）。
- **i18n（★）**：新增 `src/i18n/`（`zh.ts` / `en.ts` 词表 + `t()` 读取 + `useI18n`）。关键 UI 文案走词表；`language` 切换即时更新；首次跟随系统（`navigator.language`）；持久化到 `settings.language`。**范围**：先覆盖主界面/设置/报表/常用错误文案；番茄钟界面走页文案。
- ✅ 开机自启（P2）：`tauri-plugin-autostart` 已接线（`lib/autostart.ts` + 设置开关 + 启动对齐），macOS/Windows/Linux 写系统自启。

- **可访问性**：左侧导航 `role=tablist/tab/tabpanel` + 方向键（`SettingsModal.tsx::onNavKey`）；模态 Esc/Tab 焦点陷阱见 `components/useModalA11y.ts`；开关输入视觉隐藏保证键盘可达（`styles/global.css` 的 `.switch input`）。

## 待办增量
- ★1 ✅ i18n 骨架 + zh/en 词表 + 切换（设置通用页真实生效）。
- ★2 ✅ 深色主题全屏核对与微调。
- ★3 ✅ 通知设置拆分：「应用内通知」「系统通知」两个开关。
- ★4 关于页补版本号动态、开源许可文本。
- ★5（P2）✅ 开机自启插件接线（`tauri-plugin-autostart` + `lib/autostart.ts` + 设置开关 + 启动对齐）。

## 数据影响
- `settings` KV 新增：`system_notify`(bool, 默认 true)、`startup_page`(string, 默认 `'timer'`，见通用页「启动页」)。语言/主题已在。
- 新增 `src/i18n/*`（纯前端，无 Rust 侧）。
- 账号资料（email/name/password）与头像（PB 文件字段 `users.avatar`）由 PocketBase `users` 承载，本地 `users` 表仅保留默认单用户、无 `avatar`/nickname 列（`username` 仅作本地默认身份与迁移兜底）；设置快照每用户一条 PB `configs`（见 `03-architecture.md` §账户与云同步）。
- 「删除数据」清空业务表并重建默认用户；「退出登录」只清 PB 会话，`settings`/`tasks`/`focus_records` 一行不动（`api/local.ts::logout`、`commands/user.rs::logout`）。
- `noise` / `noise_volume` 由白噪音弹窗写入：`noise_volume` 每次确定都写，`noise` 只在选了具体音色时写（选「无」保留原值）；试听只在内存里，取消即回滚（`components/NoisePicker.tsx`、`stores/noiseStore.ts`）。
- 昵称同样存云端 `users.name`：**删除本地数据不影响昵称**；换账号即换昵称；未登录无编辑入口。
- 头像存云端：**删除本地数据不影响头像**；换账号即换头像（按 PB 记录），未登录无头像入口。

## 验收
- [x] 账号页两态（登录卡 / 账号卡）结构完整；改密码、忘记密码真实可用；退出登录后本地任务与专注记录保留；注册可填昵称、编辑资料可改昵称并同步卡片/侧边栏（PB 端到端 36/36，见 `08-changelog.md`）。
- [x] 头像可上传/更换/移除；刷新后仍在；侧边栏同步；非 png/jpeg 或 >2 MB 被拒并给出可操作提示。
- [x] 昵称：注册可填；编辑资料就地改、Enter 保存/Esc 收起、失败保持展开；>32 码点被拒并提示；空昵称回退邮箱前缀；刷新后持久。
- [x] 语言切换即时、覆盖主流程；持久化。
- [x] 深色主题在 5 屏与专注界面无死区。
- [x] 通知两个开关真实生效。
- 关联：`06-acceptance.md` E 组、`modals/SettingsModal.tsx`。
