// Vendors node_modules from an existing pnpm project (offline, no registry).
// Recursively resolves each package's real path (through .pnpm symlinks) and
// copies it flat into the destination node_modules.
import fs from 'node:fs';
import path from 'node:path';

const SRC = '/Users/lc/Develop/ProtocolStudio/node_modules';
const DEST = '/Users/lc/Develop/PomodoroClock/node_modules';

const SEEDS = [
  'react', 'react-dom', 'zustand', 'lucide-react',
  'vite', '@vitejs/plugin-react', 'typescript',
  '@tauri-apps/api', '@tauri-apps/plugin-dialog',
  '@tauri-apps/cli', '@tauri-apps/cli-darwin-arm64',
  '@types/react', '@types/react-dom', '@types/node',
];

const done = new Set();
const missing = new Set();
const queue = [...SEEDS];

function realPkgDir(name) {
  const p = path.join(SRC, name);
  try { return fs.realpathSync(p); } catch { return null; }
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true, force: true });
}

while (queue.length) {
  const name = queue.shift();
  if (done.has(name)) continue;
  done.add(name);

  const from = realPkgDir(name);
  if (!from) { missing.add(name); continue; }

  const to = path.join(DEST, name);
  copyDir(from, to);

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(to, 'package.json'), 'utf8')); }
  catch { continue; }

  for (const dep of Object.keys(pkg.dependencies || {})) {
    if (!done.has(dep)) queue.push(dep);
  }
  // Optional deps: only pull platform-specific ones that actually resolve.
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    if (!done.has(dep) && realPkgDir(dep)) queue.push(dep);
  }
}

console.log('vendored:', done.size);
console.log('missing  :', [...missing].sort().join(', ') || '(none)');
