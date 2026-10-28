#!/usr/bin/env node
// 一键设置本机同步服务器（PocketBase）地址 —— 写的是**数据库里的值**：
// 桌面端 SQLite 数据库 `settings` 表里的 `pb_url` 键（浏览器运行时光靠脚本改不了 IndexedDB，
// 请改用 `VITE_PB_URL` 编译期变量或在「设置 → 账号 → 同步」里填）。
//
// 生效优先级：settings.pb_url（本脚本/设置 UI 写的值）＞ VITE_PB_URL（编译期）＞ 内置默认。
// 本脚本写入后，桌面应用下次启动即生效（或应用内改设置会实时重连）。
//
// 用法：
//   node scripts/set-sync-server.mjs https://pb.example.com
//   node scripts/set-sync-server.mjs https://pb.example.com /path/to/focus.db   # 指定库路径
//   PB_URL=https://... node scripts/set-sync-server.mjs                          # 或环境变量
//   node scripts/set-sync-server.mjs ""                                          # 恢复默认（清空 pb_url）
//
// 可选环境变量：
//   PB_DB    覆盖数据库文件路径（默认按平台自动定位应用数据目录下的 focus.db）
//
// 依赖 Node 22.5+ 内置 `node:sqlite`（零外部依赖）。桌面应用正在运行时可写入（WAL 并发安全，
// 已设 busy_timeout）；建议改库后重启应用以全量重连。

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 入参解析 ────────────────────────────────────────────────────────────────
const urlArg = process.argv[2];
const url = (urlArg !== undefined ? urlArg : process.env.PB_URL || '').trim();
if (process.argv[2] === undefined && !process.env.PB_URL) {
  console.error('用法: node scripts/set-sync-server.mjs <url> [dbPath]   （PB_URL 或路径可省）');
  console.error('  url 为空串 "" 表示恢复编译期默认（清空数据库里的 pb_url）');
  process.exit(2);
}

// 主键名从 tauri.conf.json 读（编译期 id），读不到用兜底。
let identifier = 'com.focuspomodoro.desktop';
const confPath = path.resolve(__dirname, '..', 'src-tauri', 'tauri.conf.json');
try { identifier = JSON.parse(readFileSync(confPath, 'utf8')).identifier || identifier; } catch {}

function defaultDbPath() {
  const home = os.homedir();
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', identifier, 'focus.db');
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || '', identifier, 'focus.db');
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(xdg, identifier, 'focus.db');
}

const dbPath = process.argv[3] || process.env.PB_DB || defaultDbPath();

// ── 归一化（与应用侧 normalizePBUrl 同口径） ────────────────────────────────
const normalized = url.replace(/\/+$/, '');   // 去尾部斜杠（空串保持空串=恢复默认）

if (!existsSync(dbPath)) {
  console.error(`✗ 找不到数据库: ${dbPath}`);
  console.error('  桌面应用首次运行会自动建库；请先 `npm run tauri dev` 跑一次再执行本脚本。');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 8000;');

// 校验 settings 表存在（应用迁移后才会有）
const hasTable = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings' LIMIT 1",
).get();
if (!hasTable) {
  console.error(`✗ ${dbPath} 里没有 settings 表（数据库尚未被应用迁移）。请先运行一次桌面应用。`);
  process.exit(1);
}

if (normalized === '') {
  db.prepare("DELETE FROM settings WHERE key='pb_url'").run();
  console.log(`✓ 已清除 pb_url，恢复编译期默认（VITE_PB_URL → 内置）。`);
} else {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('pb_url', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(normalized);
  console.log(`✓ 已把同步服务器写入数据库（settings.pb_url）：\n  ${normalized}`);
}

// 读回校验
const row = db.prepare("SELECT value FROM settings WHERE key='pb_url'").get();
db.close();
console.log(`\n库位置: ${dbPath}`);
console.log(`当前值: ${row ? row.value : '(未设置 → 应用回退到 编译期默认)'}`);
console.log('\n重启桌面应用后生效；或在应用内「设置 → 账号 → 同步 → 同步服务器」查看。');