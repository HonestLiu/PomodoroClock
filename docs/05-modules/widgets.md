# 模块 · macOS 系统小组件

## 功能与外观

- macOS 14+ 的 WidgetKit 扩展，可由系统放置到桌面或通知中心。
- 小号：当前计时、任务、今日专注和目标进度条。
- 中号：计时、今日目标圆环和下一项待办。
- 大号：计时、今日分钟/次数、目标进度、最多三项待办与近七天趋势。
- 系统圆角、原生字体和深浅色适配；专注使用番茄红，休息使用蓝色。点击任意尺寸打开应用的专注面板，保持原计时状态。
- 组件展示数据，不直接完成任务或结算专注；金币/基金仍只由应用的既有流程处理。

## 数据和刷新

- `src-tauri/src/widgets.rs` 从 SQLite 投影计时、目标、今日/七日已保存的专注记录，以及今日/逾期/未安排的待办。排除休息、非法时长与未来记录。
- Rust 每两秒检查数据，只在投影变化时原子写入 App Group 的 `focus-widget.json` 并请求 WidgetKit 更新；不复制数据库、账户密钥、会员账本或支付二维码。
- 宿主 Swift 桥接和组件使用同一个 App Group：`group.com.focuspomodoro.desktop`。共享目录不可用时不绕过权限写入其他路径，应用日志提示检查签名。
- WidgetKit 根据系统预算安排刷新，不能保证状态变化立即显示。倒计时/正计时由系统日期文本显示，不进行每秒跨进程刷新。
- 时间线在阶段结束和午夜提供新条目；到期显示「本轮已结束」，不会由组件擅自开启下一阶段或记账。跨午夜清零今日指标，后续应用运行时同步新数据。
- 应用关闭后组件保留最近同步的任务与统计，计时使用绝对时间。首次无数据或数据损坏时显示打开应用同步的引导。
- `focuspomodoro://timer` 通过 macOS URL 事件打开专注面板；冷启动请求保留到前端完成启动后消费。

## 构建与添加

需要完整 Xcode 与 macOS SDK。无需额外 npm/Swift 依赖。

```sh
npm run tauri build -- --bundles app
```

Tauri 的构建前钩子在 macOS 使用 `macos/FocusWidgets.xcodeproj` 的标准 WidgetBundle 扩展目标编译 arm64/x86_64 通用扩展。Xcode 负责处理系统所需的扩展构建元数据，`tauri.macos.conf.json` 将其嵌入 `FocusPomodoro.app/Contents/PlugIns/FocusWidgets.appex`；其他平台跳过扩展构建。

安装新版 `.app` 到「应用程序」并启动一次后，在桌面右键「编辑小组件」，或打开通知中心后点击「编辑小组件」，搜索 **FocusPomodoro / 专注时光** 并选择小、中、大号。

### 签名

`npm run tauri build` 通过 `scripts/tauri.mjs` 读取 Git 忽略的 `macos/signing.local`，使用同一签名环境生成宿主与组件配置、构建并验证产物。证书和私钥仍由系统钥匙串保存，本地文件仅保存证书引用、团队 ID 和可选共享组名。环境变量优先于本地配置，供 CI 或临时切换团队使用。

普通 macOS 打包缺少配置时会停止，不再自动退回无法同步数据的 ad-hoc 包。明确指定 `--no-sign` / `--no-bundle` 的检查构建仍可使用；开发模式、帮助、版本、其他平台或非 macOS 目标直接透传给 Tauri CLI。

实机已确认：当前机器上的 ad-hoc 包虽然能显示组件，但写共享快照被系统策略拒绝，组件保持空态。需要数据同步时使用下面的团队签名构建流程，不能把默认开发包当作已验证的同步版本。

正式分发必须用同一 Apple Developer 团队签名宿主与扩展，并注册上述 App Group、为组件 bundle ID `com.focuspomodoro.desktop.widgets` 配置相应授权。将 `APPLE_SIGNING_IDENTITY` 传给构建流程；扩展需要的 provisioning profile 可通过 `WIDGET_PROVISIONING_PROFILE` 指定。宿主的 profile/公证按 Tauri 发布流程配置。不要把凭据提交到仓库。

支持使用 macOS 的团队前缀 App Group，构建脚本生成一致的宿主/扩展 Info.plist 与 entitlements；Swift 从各自包内的 `FocusWidgetAppGroup` 读取相同标识，避免编译时常量与签名错配。

新机器首次配置时，复制 `macos/signing.example.json` 为 `macos/signing.local`，填写系统钥匙串中有效证书的名称或 SHA-1，以及实际团队 ID。之后直接执行 `npm run tauri build`，无需每次 export 参数。旧的 `build-signed-macos.sh` 仍作为兼容入口转交同一流程。

默认生成 `${APPLE_TEAM_ID}.com.focuspomodoro.shared`；也可显式设置 `FOCUS_WIDGET_APP_GROUP` 使用已配置的其他组。团队标识必须取证书实际的 TeamIdentifier，不能凭证书显示名称后缀推断。生成的签名配置只保存在忽略提交的 `macos/build/`。

命令参数保留：例如 `npm run tauri build -- --debug --bundles app`；构建完成后自动验证对应 release/debug/目标架构目录内的应用。构建只生成安装包，不修改 `/Applications` 中正在使用的版本。安装更新应先退出应用，再运行安全安装脚本并传入新包路径。

### 2026-10-31 安装后不可见排查

实机发现原先手工 `swiftc + Info.plist` 产物虽然通过编译和签名结构检查，并被 PlugInKit 注册，但加载 descriptor 时在 ExtensionFoundation 的 `_EXRunningExtension._shared` 内崩溃，导致系统组件库没有条目。当前改用标准 Xcode 扩展目标和 WidgetBundle 入口，不能用 `pluginkit -m` 有条目就宣称组件可用。

同次日志还发现 ad-hoc 包没有 TeamIdentifier，被系统拒绝向原 App Group 写快照；必须分别验证扩展启动和共享目录写入。诊断脚本为 `bash scripts/diagnose-macos-widgets.sh [应用路径]`，读取包签名、共享组、Xcode 元数据与注册信息，不重置系统缓存或删除已有桌面组件。

### 签名后“应用程序无法打开”

直接安装的 macOS 包使用证书 CodeDirectory 中的 TeamIdentifier 校验团队前缀 App Group。不要主动声明 `com.apple.developer.team-identifier`：这属于需要匹配 provisioning profile 的受限 entitlement，签名结构校验不能代替系统启动授权校验。生成脚本已移除此项，验证脚本会拦截无 profile 却声明该权限的包。

安装必须把整个应用包替换为新副本，不能覆盖原可执行文件；系统会缓存代码签名信息。修复安装器先校验全新目录，再重命名交换，保留旧包，避免复用原可执行文件 inode。

已安装受影响包时，在保留正确 `APPLE_SIGNING_IDENTITY` / `APPLE_TEAM_ID` 的终端运行 `bash scripts/repair-macos-widget-launch.sh`。它只复制、重新签名并替换应用包，不触碰业务数据；完成后仍需从应用程序实际启动并验证组件同步。

## 验证与范围

```sh
bash scripts/verify-macos-widgets.sh
node tools/verify-tray.mjs
bash scripts/preview-macos-widgets.sh
node --test tools/verify-tauri-cli.mjs
```

- Swift 模型检查：编码解码、暂停、到期、正计时、跨日、目标上限与空态。
- Rust 内存库测试：统计过滤、七日补零、任务排序/边界、目标读取、清库与敏感数据隔离；包含在一键验收中。
- 前端隔离检查：冷启动、实时点击、重新挂载期间的异步请求，不读用户数据。
- 原生离屏预览输出到 `macos/build/previews/`，使用与扩展相同的 SwiftUI 视图。
- 已验证原生布局、双架构编译、应用包嵌入和签名结构；桌面/通知中心实际添加、系统刷新与正式分发签名仍需在安装后验收。
- 团队签名构建及安装脚本调用 `verify-widget-signing.py`，同时检查证书团队、宿主/组件的共享组和签名授权，拒绝临时签名或元数据错配。结构验证通过后仍需确认真实快照写入、组件读取与界面更新。
