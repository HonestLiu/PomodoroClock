import fs from 'node:fs';
import path from 'node:path';
const NM = '/Users/lc/Develop/PomodoroClock/node_modules';
const BIN = path.join(NM, '.bin');
fs.mkdirSync(BIN, { recursive: true });

function walk(dir, depth = 0) {
  if (depth > 2) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.bin' || e.name === '.cache') continue;
    const full = path.join(dir, e.name);
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('@')) { walk(full, depth + 1); continue; }
    const pj = path.join(full, 'package.json');
    if (!fs.existsSync(pj)) continue;
    let pkg; try { pkg = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
    if (!pkg.bin) continue;
    const entries = typeof pkg.bin === 'string' ? { [pkg.name.split('/').pop()]: pkg.bin } : pkg.bin;
    for (const [name, rel] of Object.entries(entries)) {
      const target = path.join(full, rel);
      if (!fs.existsSync(target)) continue;
      const link = path.join(BIN, name);
      try { fs.rmSync(link, { force: true }); } catch {}
      fs.symlinkSync(path.relative(BIN, target), link);
      fs.chmodSync(target, 0o755);
    }
  }
}
walk(NM);
console.log('bins:', fs.readdirSync(BIN).join(' '));
