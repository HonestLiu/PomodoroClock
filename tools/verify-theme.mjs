// Exercise actual theme/boot code without changing the user's macOS appearance.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
const code = (await build({ entryPoints: ['src/lib/theme.ts'], bundle: true, write: false, format: 'cjs', platform: 'node' })).outputFiles[0].text;
const boot = await readFile('public/themeboot.js', 'utf8');
let checks = 0;
function runtime(dark, saved, blocked = false) {
  const listeners = new Set();
  const values = new Map(saved === undefined ? [] : [['focus.theme', saved]]);
  const root = { dataset: {} };
  const meta = { content: 'light dark' };
  const media = { matches: dark, addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn) };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports,
    window: { matchMedia: () => media }, document: { documentElement: root, querySelector: () => meta },
    localStorage: {
      getItem: key => { if (blocked) throw Error('blocked'); return values.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw Error('blocked'); values.set(key, value); },
      removeItem: key => { if (blocked) throw Error('blocked'); values.delete(key); },
    },
  });
  vm.runInContext(code, context);
  return { install: module.exports.installTheme, root, meta, listeners, values,
    boot: () => vm.runInContext(boot, context),
    system: dark => { media.matches = dark; for (const listener of listeners) listener(); } };
}
function test(label, run) { run(); checks++; console.log(`PASS ${label}`); }
test('system follows both OS changes without persisting the resolved color', () => {
  const r = runtime(true, 'light'); const off = r.install('system');
  assert.equal(r.root.dataset.theme, 'dark'); assert.equal(r.meta.content, 'light dark');
  assert.equal(r.values.has('focus.theme'), false);
  r.system(false); assert.equal(r.root.dataset.theme, 'light');
  r.system(true); assert.equal(r.root.dataset.theme, 'dark'); off(); assert.equal(r.listeners.size, 0);
});
test('manual preferences remain pinned even when the OS matches then changes again', () => {
  for (const theme of ['light', 'dark']) {
    const r = runtime(false); const off = r.install(theme);
    r.system(true); r.system(false);
    assert.equal(r.root.dataset.theme, theme); assert.equal(r.meta.content, theme);
    assert.equal(r.values.get('focus.theme'), theme); assert.equal(r.listeners.size, 0); off();
  }
});
test('switching modes and StrictMode cleanup does not accumulate OS listeners', () => {
  const r = runtime(true);
  let off = r.install('system'); off(); off = r.install('system'); assert.equal(r.listeners.size, 1);
  off(); off = r.install('light'); r.system(true); assert.equal(r.root.dataset.theme, 'light');
  off(); off = r.install('system'); assert.equal(r.root.dataset.theme, 'dark'); off();
});
test('early boot honors cached manual overrides and system defaults', () => {
  for (const [dark, saved, expected] of [[true, undefined, 'dark'], [false, undefined, 'light'], [true, 'light', 'light'], [false, 'dark', 'dark'], [true, 'invalid', 'dark']]) {
    const r = runtime(dark, saved); r.boot(); assert.equal(r.root.dataset.theme, expected);
  }
});
test('unavailable localStorage does not prevent boot or live theme changes', () => {
  const r = runtime(true, undefined, true); r.boot(); assert.equal(r.root.dataset.theme, 'dark');
  const off = r.install('system'); r.system(false); assert.equal(r.root.dataset.theme, 'light'); off();
});
console.log(`${checks} theme checks passed`);
