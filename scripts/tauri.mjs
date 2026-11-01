import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { macBuildContext, planTauri } from './tauri-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, env) {
  const child = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.signal) process.kill(process.pid, child.signal);
  if (child.status !== 0) process.exit(child.status ?? 1);
}
try {
  let local = {};
  const args = process.argv.slice(2);
  const localFile = path.join(root, 'macos/signing.local');
  if (macBuildContext(args, process.platform, process.env) && existsSync(localFile)) {
    local = JSON.parse(readFileSync(localFile, 'utf8'));
  }
  const plan = planTauri(args, { platform: process.platform, root, env: process.env, local });
  if (plan.configure) run('python3', ['scripts/configure-widget-signing.py'], plan.env);
  const cliPackage = path.join(root, 'node_modules/@tauri-apps/cli/package.json');
  const metadata = JSON.parse(readFileSync(cliPackage, 'utf8'));
  const cli = path.resolve(path.dirname(cliPackage), metadata.bin.tauri);
  run(process.execPath, [cli, ...plan.args], plan.env);
  if (plan.verify) run('python3', ['scripts/verify-widget-signing.py', plan.app], plan.env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
