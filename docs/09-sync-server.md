# 09 · 同步服务器配置（PocketBase）

> 本篇对应设置页「账户 → 同步 → 同步服务器」与一键脚本 `scripts/set-sync-server.mjs`。
> 目标：让 **PocketBase 同步服务器地址**成为一个可配置、持久化在**数据库**里的运行时值，
> 便于多台设备连各自的服务器、或在部署变更时无需重新编译即可切换到新后端。

---

## 1. 生效优先级

```
settings.pb_url（本脚本 / 设置页 UI 写的值） ＞  VITE_PB_URL（编译期） ＞  内置默认
```

1. **`settings.pb_url`**（数据库 KV）：最高优先级。由本脚本或设置页「账户 → 同步 → 同步服务器」写入。
2. **`VITE_PB_URL`**（编译期环境变量）：未设置 `pb_url` 时回退到此值。
3. **内置默认**：`http://62.234.82.11:28193`（`src/lib/pb.ts` 的 `PB_FALLBACK_URL`）。

> 浏览器运行时（IndexedDB）在 `db.ts`/`idb.ts` 无法运行时改库，请改用 `VITE_PB_URL` 或在
> **设置 → 账户 → 同步 → 同步服务器** 里填。`pb_url` 为空串即表示「回到编译期默认」。

---

## 2. 运行时行为

- 值存在 `settings` 表 `pb_url` 键（SQLite）与 IndexedDB `settings`（浏览器），与其它设置一致做 KV 持久化。
- 应用启动时读取设置并调用 `syncPBServer(settings)`，把 `pb.baseUrl` 重定向到该地址。
- 应用内修改 `pb_url` 后即时生效：`App.tsx` 监听该键变化 → `syncPBServer` → `authStore.reconnectIfServerChanged()` 在服务器地址变化时自动重建 PocketBase 客户端并重连会话。
- 该值是**设备本地项**：不同设备可连不同服务器。故 `pushConfig` 同步配置时**不上传 `pb_url`**（与 `ai_api_key` 同为设备本地、不进云端）。

---

## 3. 一键脚本：`scripts/set-sync-server.mjs`

零外部依赖（Node 22.5+ 内置 `node:sqlite`），直接写入**数据库里的值**，无需打开应用。桌面应用正在运行时也可安全写入（WAL 并发安全，已设 `busy_timeout`）；为稳妥建议改库后**重启应用**以全量重连。

```bash
# 用法
node scripts/set-sync-server.mjs https://pb.example.com            # 写入新服务器地址
node scripts/set-sync-server.mjs https://pb.example.com /path/to/focus.db  # 指定库路径
PB_URL=https://... node scripts/set-sync-server.mjs                 # 或环境变量
node scripts/set-sync-server.mjs ""                                # 恢复默认（清空 pb_url）
```

可选环境变量：

| 变量    | 作用                                           |
| ------- | ---------------------------------------------- |
| `PB_DB` | 覆盖数据库文件路径（默认按平台自动定位 `focus.db`） |

默认库路径按平台自动定位（走 `tauri.conf.json` 的 `identifier`，兜底 `com.focuspomodoro.desktop`）：

| 平台    | 路径                                            |
| ------- | ----------------------------------------------- |
| macOS   | `~/Library/Application Support/<id>/focus.db`   |
| Windows | `%APPDATA%\<id>\focus.db`                       |
| Linux   | `$XDG_DATA_HOME/<id>/focus.db`（缺省 `~/.local/share/<id>/focus.db`） |

> 桌面应用首次运行会自动建库；若脚本报「找不到数据库」，先 `npm run tauri dev` 跑一次再执行。
> 地址尾部的 `/` 会被自动去掉（与应用侧 `normalizePBUrl` 同口径），空串即清除 `pb_url`。

---

## 4. 前端设置入口

- 「设置 → 账户 → 同步」顶部「同步服务器」字段（**登录与否都可见**——未登录也须能先定服务器再登录）：
  - 输入新地址 →「保存」（与当前值相同则禁用）；「恢复默认」= 清空 `pb_url`。
  - 下方「当前生效 : `pb.baseUrl`」实时显示解析后的生效值。
- API Key 与同步服务器地址均为本机项，不上传云端（`sync.ts::pushConfig` 里 `delete`）。

---

## 5. 验证

- 脚本三态已实测：写入 / 去尾部斜杠 / 空串恢复默认。
- `bash tools/check-all.sh` 全绿（含 Rust `load_settings` 对 `pb_url` 的读回，见 `src-tauri/src/db.rs` 与 `models.rs`）。
- 端到端：改库 → 重启应用 → 设置页「当前生效」与新建对齐；登录后数据同步走新服务器。