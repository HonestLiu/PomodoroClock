# 03 · 技术架构（双运行时）

## 分层总览（沿用 CLAUDE.md §8.2）

```
UI 层        src/ · components · pages · modals · charts
状态层       src/stores/         Zustand
桥接层       src/api/            §8.4 命令面（typed）
            ┌─ tauri.ts          invoke → Rust
            └─ local.ts          IndexedDB 直接实现
跨层服务     src/lib/            pb.ts / sync.ts（云同步）· systemNotify.ts（系统通知）
Rust 核心    src-tauri/src       commands/* · db.rs · timer_engine.rs
存储        SQLite(focus.db) / IndexedDB / 设置 KV / 音频资产 / PocketBase(可选云端)
```

## 双运行时 —— 必须保持同步

前端经 `src/api/index.ts` 依据 `window.__TAURI_INTERNALS__` 分派：
- **Tauri 运行时**：命令转发到 Rust（`commands/*.rs`），数据在 **SQLite**，计时权威时钟由 Rust `timer_engine` 每 250ms 广播 `timer://tick`。
- **浏览器运行时**：`local.ts` 直接操作 **IndexedDB**，计时用本地 250ms 脉冲。

**一致性红线（改数据/统计时必读）**：
1. **同一命令面**：只允许通过 `src/api` 的命令访问数据，UI 不得直连存储。
2. **同一统计口径**：`commands/stats.rs`（SQL）与 `db/queries.ts`（TS）必须逐项等价。
3. **双端同一种子数据**：浏览器 `db/seed.ts::buildSeed` 与桌面 `db.rs::seed_demo` 写同一份 PRD §6.3 演示数据；两端各先建默认用户/目标/计时状态（`ensure_bootstrap`），再在「空库且未播种」时播种，并写 `settings.demo_seeded='1'` 防重播（`lib.rs` setup、`idb.ts::initDB`）。「删除数据 / 注销」= 清空业务表 + 重建默认用户 + 置 `demo_seeded=1`，重启不会回填（**退出登录不属此类**：会话级、不动数据）。改种子必须双端同步，否则桌面会出现"少数据/像 bug"的误判。
4. **UI 不得直连存储**：`src/components|pages|modals|charts` **禁止** import `@/db/queries` 或 `@/db/idb`
   （它们只服务 `local.ts` 适配器内部）。UI 一律用 `src/lib/derive.ts` 的纯函数 + store 数据。
   *违反后果*：Tauri 运行时 IndexedDB 从未初始化，界面恒为空（2026-10-14 实际发生过，见 `08-changelog.md`）。
   守卫：`./tools/check-runtime-parity.sh`（违反即非零退出）。
5. **改任何一处 → 跑一键校验**：`bash tools/check-all.sh`（等价于 `cargo test --test queries` + `tools/verify-data.ts` + `tools/check-runtime-parity.sh` + `tsc` + `vite build`）；
   需要观感回归时加 `--with-shots`（自动起 `vite preview` 并跑 `tools/shoot.mjs` 的 7 项检查）。单独跑某项时见 `README.md` §验证。
6. **两种运行时都要验**：新功能必须在**浏览器**与**Tauri 桌面**各验一次。
   桌面无显示环境时，可用"webview 内探针写 SQLite + 直接读库"的方式断言真实渲染（见 `08-changelog.md` 的验证手法）。

## 关键机制

| 机制 | 实现 | 位置 |
|---|---|---|
| 计时可靠 | 绝对时间戳 `remaining = end_at - now`，禁止 setInterval 累加；暂停写 `paused_remaining_ms` | `timer/engine.ts` / `timer_engine.rs` |
| 单属主归档 | `focus_record` 只在 `timerStore.checkExpiry` 写入，Rust 不重复结算 | `stores/timerStore.ts` |
| 变更广播 | 数据写后发 `data://changed`，报表/侧边栏/角标实时重算（真实时聚合，不缓存） | `api/events.ts` |
| 事件订阅 | `subscribe(event, handler)` 统一本地总线 +（Tauri 下）原生 listen | `api/index.ts` |
| 危险操作 | 删除/注销二次确认，后端仍校验来源 | `modals/ConfirmDialog.tsx` |

## 账户与云同步（PocketBase，PRD 之外新增）

PRD §8.6/`01-vision.md` 把云同步列为非目标；当前实现作为**可选云端对齐层**提前落地，不改本地真相源地位。

- **离线优先**：`local.ts`/SQLite 仍是唯一真相源；云端只做设置项的镜像与收敛。所有云端调用 try/catch，
  失败静默降级为「云端不可用，已使用本地数据」，绝不清空/阻塞本地（`stores/authStore.ts`）。
- **集合**：`users`（PocketBase 内建）+ `configs`（每用户一条设置快照，含 `rev`/`updated`/`device`）。
- **地址**：`VITE_PB_URL` 优先，缺省回退 `http://62.234.82.11:28193`（`lib/pb.ts::PB_URL`，`.env.local` 预留）；
  `src/vite-env.d.ts` 声明该变量。
- **冲突裁决**（`lib/sync.ts::resolveDirection`，纯函数保证双方收敛）：远端无 → push；本地无 → pull；
  `rev` 大者胜；`rev` 相同比 `updated`（字符串比较）；仍同比 `device` 字典序。
- **写入范围**：`applyRemote` 只写 `DEFAULT_SETTINGS` 已有键（白名单），不引入未知设置项。
- **订阅**：`subscribeConfig` 只处理当前用户自己的记录，失败不影响本地。
- **本地元数据**：`localStorage` 的 `sync.meta.<userId>`（rev/updated/device）与 `sync.device`（设备 id）。
- **账号页即账号中心**：设置 → 账号就是软件账号（PocketBase），不再有「本地假档案」与独立云同步区块。同一个 `.account-card` 两态：未登录为登录/注册卡（`AccountPane` 的登录态分支），已登录为账号卡 + 头像 + 同步区 + 改密码 + 退出。已移除的是**旧的本地头像上传/编辑资料/本地改密码**；现头像改为云端账号头像（见下条，`SettingsModal.tsx::AccountPane`）。
- **头像**：用 PocketBase `users` 内建 **文件字段 `avatar`**（无需改 schema），不落本地库。写入：`PATCH /api/collections/users/records/{id}`、`multipart/form-data` 单文件键 `avatar`、带用户 token（`lib/pb.ts::pbUploadAvatar`）；删除：同一 PATCH 传 `avatar: ''` 即清空并删文件（`pbDeleteAvatar`）。读取：`GET /api/files/users/{recordId}/{filename}`，缩略图 `?thumb=NxN`（`pbAvatarFileUrl`）；**这两个 GET 不带 Authorization 也返回 200**——文件公开可读，`<img>` 可直接引用，隐私影响见 `07-backlog.md` #36。双限：客户端仅 `image/png`/`image/jpeg` 且 ≤2 MB（`stores/authStore.ts` 的 `AVATAR_TYPES`/`AVATAR_MAX_BYTES`，超限提示 `err.avatarType`/`err.avatarTooLarge`），服务端 PB 文件上限实测 **5 MiB**（6.45 MB → 400 `validation_file_size_limit`）；上传/删除失败只写同步提示（`err.avatarFailed`），不阻塞本地。渲染顺序：账号卡用 `pbAvatarFileUrl(user, 96)`、侧边栏 `72`，**云端 avatar → 本地 `avatar_path` → 首字母**；未登录只有 logo，无头像入口。
- **昵称**：PocketBase `users` 的**普通文本字段 `name`**（无需改 schema），不落本地库。注册可带（`lib/pb.ts::pbRegister`：`name` trim 后非空才塞进创建体，不传则完全不出现该字段）；登录后就地改，`PATCH /api/collections/users/records/{id} { name }` → `lib/pb.ts::pbUpdateName`（客户端先 `trim()`）。服务端上限 **255 字符**（255→200；256→400 `validation_max_text_constraint`、`params.max=255`，顶层 `message` 却是笼统的 `Failed to update record.`，前端靠 `pbErrorMessage` 取字段级文案）；**服务端不 trim**，故客户端统一 trim。客户端门槛**刻意更严：32 字符**（`stores/authStore.ts::updateNickname`，按码点 `[...name].length` 计、emoji 不重复算；`NICKNAME_MAX_CHARS=32`；超限 `err.nicknameTooLong`）。空昵称允许，UI 回退邮箱 `@` 前缀（`SettingsModal.tsx::AccountPane` 的 `name` 回退链：`users.name` → email 前缀 → `account.untitled`）。**邮箱不可改**：`PATCH { email }` 直接 400（`validation_values_mismatch`，PB 要求走 email-change + 验证流程），UI 里邮箱只读并显示「邮箱暂不支持在此修改」（`account.emailLocked`）。**老用户一次性回填**：登录后若云端 `name` 为空，用本地默认用户 `username` 兜底写入一次，`localStorage['nickname_backfill:<userId>']` 只尝试一次、成功后静默（不弹「资料已更新」），避免用户主动清空昵称又被回填（`App.tsx` 登录副作用）。
- **改密码**：`pbUpdateProfile` 必须同时带 `oldPassword` + `passwordConfirm`（PB `users` 集合强制校验当前密码，缺 `oldPassword` 返回 400 `validation_required`）；改成功后 PB **作废该用户所有既有 token**（实测旧 token `auth-refresh` → 401），因此 `stores/authStore.ts::changePassword` 必须当场用新密码 `authWithPassword` 换新 token，否则刷新/重启即掉线；换 token 失败则清会话并提示 `sync.pwdChangedRelogin`。
- **忘记密码**：`lib/pb.ts::pbRequestPasswordReset` → `users.request-password-reset`；该实例 SMTP 已配置（实测 204）。前端只提示已发送，不判断邮箱是否存在。
- **退出登录 = 会话级、可逆**：只清前端 PB 会话（`stores/authStore.ts::logout`：PB token + LocalAuthStore），**不碰任何本地表**——`api/local.ts::logout` 仅 `await ready()`，`commands/user.rs::logout` 无参直接 `Ok(())`，`api/tauri.ts` 也不再包 `mutate('all', …)`（否则退出会广播 `data://changed` 触发一次无意义的全量重载）。设置弹层不关闭，原地切回登录卡并提示。**与「删除数据」分工**：PRD FR-S2 的「注销账号 → 登出并清理」是不可逆动作，现由「删除数据」承担（`clear_all_data`：清空业务表 → 重建默认用户 → 置 `demo_seeded='1'`）；账号页重构后「退出」是低频可逆操作（换账号/临时登出），绝不清库——否则点一次退出就丢掉全部任务与专注记录。
- **configs 关系约束**：`configs.user` 是关系字段，**删用户前必须先删其 configs 记录**，否则 `DELETE users` 返回 400；`users` 的 listRule 不公开，匿名无法枚举用户（测试残留账号只能按已知 id 删）。
- **触发**：设置变更 `scheduleSyncPush` 防抖 1200ms 后推送；启动时 `useAuthStore.init()`（`App.tsx:48`）。

## 白噪音选择弹窗（2026-10，来源：用户设计稿）

用户指名的 UI 改造：原来白噪音有两个零碎入口（计时页工具条的内嵌小浮层、设置→外观的 `<select>` 下拉），现统一为**一个选择弹窗**，外观按用户提供的设计稿实现（标题 + 音量滑杆 + 圆形封面列表 + 取消/确定）。**样式不在 PRD 规定范围内**，是用户追加的设计要求。

- **单一入口实现**：`components/NoisePicker.tsx` 是全局单例，由 `App.tsx` 挂载；打开状态在 `stores/uiStore.ts` 的 `noiseOpen` + `openNoise(v)`（已并入 `closeAllOverlays`）。计时页工具条「白噪音」与设置→外观「选择白噪音」都只调 `openNoise(true)`，不再各自维护浮层。
- **层级**：`.noise-overlay { z-index: 400 }`，必须高于全屏专注层（200）、通知（160）、搜索（180）——否则在专注页点「白噪音」会被壁纸层盖住（已截图验证在壁纸上正常显示）。
- **播放状态收敛为全局唯一真相源**：`stores/noiseStore.ts`（原状态散在 `TimerScreen` 的局部 `useState`），`{ kind, volume, playing }` + `select/setVolume/setPlaying/hydrate/restore`。这是「弹窗里选了一个、工具条还显示旧的」不再复发的结构原因；工具条图标与 `.on` 高亮直接跟随 `noiseStore.playing`。
- **封面取自音频文件自身**：`src/assets/noise/covers/*.jpg` 是 5 个 mp3 的 **ID3 内嵌封面（APIC / attached_pic）**，360×360、7–14 KB，不是另找的设计资源；`tools/extract-noise-covers.sh` 用 ffmpeg/ffprobe 重抠（`-an -c:v copy`，无内嵌封面则跳过并告警），换音频后重跑即可。`lib/noise.ts::NOISE_COVERS` 与 `NOISE_AUDIO` 一一对应——注意 `rain` 的音频本来就是 `forest.mp3`，封面也用 forest 的内嵌图，避免图音错配。
- **交互语义**：点某一项**即刻试听**（在用户手势内启停，规避 WebView 自动播放限制）；拖音量时若还没选音色，会自动试听当前高亮项；**取消回滚**试听（音色与音量都恢复到打开前），**确定**才落库。落库规则：`noise_volume` 总是写，`noise` 只在选了具体音色时写——选「无」不覆盖已存音色（「专注时播放」仍按上次音色自动起）。打开时高亮 = 正在播放 ? 当前音色 : 「无」。「无」= 不播放，**不是清空音色**。

## 可访问性（a11y，2026-10 补齐）

- **模态**：`components/useModalA11y.ts` 提供栈式 Esc（仅最上层响应）、Tab 焦点循环、打开时聚焦首要素、关闭后还原焦点；Settings/Report/Placeholder/ConfirmDialog/TaskEditModal 均已接入，并带 `role="dialog" aria-modal aria-labelledby`。
- **菜单**：`components/Menu.tsx` 全键盘——`role=menu/menuitem`、↑↓ 循环、Home/End、→ 进子菜单、← 返回、Esc/Tab 关闭。
- **拖拽的键盘等价**：任务行 `Alt+↑/↓`（`pages/TaskView.tsx`）、清单行 `Alt+↑/↓`（`components/Sidebar.tsx`），结果经 `role="status" aria-live` 播报；行上有 `a11y.reorderHint` 提示。
- **设置导航**：`role=tablist/tab/tabpanel` + 方向键切换（`SettingsModal.tsx` 的 `onNavKey`）。
- **全局**：`focus-visible` 覆盖 `select/a/[tabindex]/[role=*]`；开关输入改视觉隐藏（原 `display:none` 键盘不可达）；`.sr-only` 供屏幕阅读器播报（`styles/global.css`）。
- **容错**：`components/ErrorBoundary.tsx` 在 `main.tsx` 包裹根节点，组件抛错显示兜底而非整页白屏。

## 跨平台窗口
- macOS：`titleBarStyle: Overlay` + `hiddenTitle`，保留系统红黄绿。
- Windows/Linux：`tauri.windows.conf.json` / `tauri.linux.conf.json` 覆盖为 `decorations:false`，自绘红黄绿按钮（`components/TitleBar.tsx`）。

## 工程化约定
- **样式资源用 data URI 时必须写 `url("…")`（带引号）**：Vite 内联 SVG 会保留 `xmlns='http://…'` 的单引号，未加引号的 `url(...)` 会被 CSS 整条丢弃且**无报错**（曾致专注页/悬浮窗壁纸静默失效，见 `TimerScreen.tsx`、`FloatWindow.tsx` 的 `backgroundImage`）。
- **验收入口**：`bash tools/check-all.sh [--with-shots|--skip-build]`；注意 4173 预览服务的是 `dist/`，改源码后必须先 `vite build`（`--with-shots` 会自动复用/启动 preview）。
- 新增命令：`types.ts` 加签名 → Rust 加 `#[tauri::command]` → `local.ts` + `tauri.ts` 双实现 → `lib.rs` 注册 → 变更命令包 `broadcastDataChanged`。
- 新增表/字段：`db.rs::SCHEMA` 迁移 + `db/` TS 表定义 + 两端首启种子（`buildSeed`/`seed_demo` 同步）+ 双校验。
