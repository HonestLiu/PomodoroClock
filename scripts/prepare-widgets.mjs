import { spawnSync } from 'node:child_process';
if (process.platform === 'darwin') {
  const result = spawnSync('bash', ['scripts/build-macos-widget.sh'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
