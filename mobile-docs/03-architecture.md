# 03 · Flutter 架构与工程规范

## 推荐分层

```text
lib/
  app/                 应用根、导航、主题、生命周期协调
  core/                日期/时区、错误、日志脱敏、网络状态、权限
  data/
    local/             SQLite schema、DAO、migration、事务
    remote/            PocketBase REST/Auth/Realtime 客户端
    sync/              队列、行级同步、快照同步、游标、冲突裁决
    repositories/      本地优先读写和领域接口
  domain/
    models/             共享实体与值对象
    services/           计时、统计、奖励、重复、提醒、AI 编排纯逻辑
  features/
    auth tasks timer reports growth quests countdown notifications search settings
  l10n/                中英文
test/                  unit / widget / repository / sync contract
integration_test/      真机关键路径
```

可选择 Riverpod 或等价的可注入状态方案；选择后全工程统一。具体数据库与网络依赖需在实现前核实 Flutter/Dart 当前兼容版本，避免依赖锁死在过期 API。Repository 对 UI 暴露流/状态，数据库和 HTTP DTO 不泄漏到 Widget。

## 持久化分工

本地 SQLite 保存桌面共享业务表对应数据，以及移动端待同步队列和同步元数据。安全存储保存 PocketBase auth token；普通偏好保存启动页等不敏感 UI 状态。同步元数据必须以账号 ID 隔离；退出或切账号时不误用另一账号的游标。

共享实体至少包含 `folders`、`lists`、`tasks`、`focus_records`、`settings`、`notifications`、`countdowns`、任务线数据和 `growth_data`。计时当前态可落本地专属表/状态，不进入 PocketBase 同步 payload。设备专属的音频播放、通知授权、AI 密钥、服务器地址、系统权限和本地文件路径不得混入共享数据。

所有 schema 变更必须可重复执行、保留用户数据、可从上一版本迁移。禁止以删除数据库/清空重播种作为升级策略。演示种子仅按桌面规则在新本地库写入一次；云端账号接管必须将种子识别为未确认数据，禁止自动推云覆盖。

## Repository 与状态流

```text
用户操作 → domain 用例/校验 → SQLite 事务 → repository 状态流更新 UI
                                      ↘ durable outbox → PocketBase 同步
PocketBase 更新 → schema 校验 → SQLite 事务应用 → repository 状态流更新 UI
```

- 所有本地写入事务要么完整提交要么完全回滚；需要同步的写入同事务记录 outbox/dirty 元数据。
- 写远端或应用远端都要幂等，重复 Realtime 事件、超时重试或 app 恢复不能产生重复任务/记录/奖励。
- 同步应用远端数据时抑制反向 dirty 生成；不要依赖全局布尔值跨异步任务，使用事务来源标识或明确的同步上下文。
- 报表和派生视图由 domain/query 层生成，同一组输入只定义一份口径；为日期边界、DST、闰年建立纯函数测试。
- 失败状态具备原因分类：认证过期、权限拒绝、网络失败、schema 版本不兼容、数据校验失败、服务端冲突、限流。提供重试/重新登录路径。

## 计时与生命周期

计时权威状态包含模式、阶段、运行标记、任务 ID、`start_at`/`end_at` 或冻结剩余值、暂停信息、已完成番茄数。以 UTC epoch 毫秒作为时刻，显示时转换本地时区。每次进入后台先保存状态；回前台根据绝对时间重算，不通过后台 timer 累计。

iOS 与 Android 对后台任务、精确闹钟、音频会话和通知有各自限制。核心要求是：app 被挂起或进程终止后，回到应用可恢复/正确结束状态且只归档一次。持续后台倒计时通知按平台可行机制发起；权限缺失需在界面显示，并且不能误称后台实时服务正在运行。专注音频/白噪音处理电话、耳机拔出、系统音频焦点和 app 生命周期中断。

为跨设备防重复结算，记录 ID 必须在归档之前确定并稳定持久化，奖励处理 ID 与专注记录 ID 关联；重启恢复时再次运行结算也只能命中一次。不得上传 `timer_state` 到 configs 或独立同步集合。

## PocketBase 客户端

- 与桌面使用同一个 base URL；可从用户设置或编译环境默认值初始化。URL 是设备本地项，不随账号同步。
- 仅用户 token 调用受规则保护的 `users`、`configs`、`sync_*` 集合；token 使用系统安全存储并能刷新/失效处理。
- 对头像、二维码只允许明确的图片格式、大小上限、像素解码检查；上传不记录 URL 查询中的敏感文件信息。
- Realtime 使用于快速刷新，但必须在网络切换、切账号、应用暂停/恢复时安全建立和释放；周期拉取作为恢复机制。
- 统一 HTTP 超时、取消、指数退避与抖动；4xx 校验/权限错误不能无限重试，离线/5xx 可退避重试。

## 原生接口边界

通过窄接口封装通知、音频会话、相册选图、分享/外链、精确闹钟状态、振动与系统小组件。业务规则在 Dart domain 层。平台插件只负责平台能力，不决定是否生成专注记录、奖励或同步冲突。
