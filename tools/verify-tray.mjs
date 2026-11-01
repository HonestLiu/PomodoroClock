// 隔离数据库、声音、系统通知与原生窗口后执行真实计时 store / 托盘 controller 回归。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/tray-runtime.ts', import.meta.url));
const file = `/tmp/pomodoro-tray-check-${process.pid}.mjs`;
const result = await build({ entryPoints: [root + 'tools/verify-tray.ts'], absWorkingDir: root, bundle: true,
  platform: 'node', format: 'esm', write: false, plugins: [{ name: 'isolated-tray-runtime', setup(builder) {
    builder.onResolve({ filter: /^@\/(api|i18n|lib\/bell|lib\/systemNotify|stores\/noiseStore)$/ }, () => ({ path: fixture }));
  } }] });
try { await writeFile(file, result.outputFiles[0].contents); await import(file); }
finally { await unlink(file); }
