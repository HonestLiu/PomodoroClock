import assert from 'node:assert/strict';
import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 300, height: 240 }, locale: 'zh-CN' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  const callbacks = new Map(), listeners = new Map(); let seq = 0;
  let snapshot = { style: 'orb', state: { phase: 'focus', mode: 'pomodoro', task_id: null, running: true, start_at: Date.now() - 300000, end_at: Date.now() + 1200000, paused_remaining_ms: null }, settings: { focus_len_min: 25, break_len_min: 5, long_break_len_min: 15, long_break_every: 4 }, phaseDurationMs: 1500000, now: Date.now(), title: '完成今天的一件事', theme: 'light', lang: 'zh', settling: false };
  window.isTauri = true; window.orbCalls = [];
  window.setOrbSnapshot = patch => { snapshot = { ...snapshot, ...patch }; for (const [id, event] of listeners) if (event === 'orb://state') callbacks.get(id)({ payload: snapshot }); };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_, id) => listeners.delete(id) };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'desktop-orb' }, currentWebview: { label: 'desktop-orb' } },
    transformCallback: callback => { const id = ++seq; callbacks.set(id, callback); return id; },
    invoke: async (command, args) => {
      window.orbCalls.push({ command, args });
      if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler; }
      if (command === 'orb_snapshot') return snapshot;
      if (command === 'orb_action') {
        if (args.action === 'toggle') window.setOrbSnapshot({ state: { ...snapshot.state, running: !snapshot.state.running, paused_remaining_ms: 1200000 } });
        else window.setOrbSnapshot({});
      }
    },
  };
});
try {
  await page.goto((process.env.APP_URL ?? 'http://127.0.0.1:1420') + '/orb.html');
  await page.getByRole('button', { name: '暂停计时' }).waitFor();
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.orb-clock').innerText(), '20:00');
  const progress = await page.locator('progress').getAttribute('value'); assert.ok(Number(progress) >= 0.19 && Number(progress) < 0.22);
  await page.locator('.orb-shell').screenshot({ path: '/tmp/desktop-orb-light.png', omitBackground: true, animations: 'disabled' });
  await page.getByRole('button', { name: '暂停计时' }).click();
  await page.getByRole('button', { name: '开始计时' }).waitFor();
  assert.equal(await page.locator('.orb-label').innerText(), '已暂停');
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.orb-clock').innerText(), '20:00', 'pause freezes display');
  await page.locator('.orb-ball').hover();
  await page.getByRole('button', { name: '打开专注界面' }).click();
  await page.evaluate(() => window.setOrbSnapshot({ theme: 'dark', lang: 'en' }));
  await page.getByRole('button', { name: 'Start timer' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('.orb-shell').screenshot({ path: '/tmp/desktop-orb-dark.png', omitBackground: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Hide desktop timer' }).click();
  const calls = await page.evaluate(() => window.orbCalls);
  assert.ok(calls.some(c => c.command === 'orb_action' && c.args.action === 'toggle'));
  assert.ok(calls.some(c => c.command === 'orb_action' && c.args.action === 'open'));
  assert.ok(calls.some(c => c.command === 'orb_action' && c.args.action === 'hide'));
  assert.equal(calls.some(c => /record|settings|get_user|quest|set_timer/.test(c.command)), false, 'orb never owns persistence, records, or timer mutation');
  await page.mouse.move(50, 40); await page.mouse.down(); await page.mouse.move(70, 55); await page.mouse.up();
  assert.ok((await page.evaluate(() => window.orbCalls)).some(c => c.command === 'plugin:window|start_dragging'));
  const stateBeforeStyles = await page.evaluate(() => window.orbCalls.filter(c => c.command === 'orb_action').length);
  for (const style of ['card', 'orb', 'bar']) {
    await page.evaluate(style => window.setOrbSnapshot({ style }), style);
    await page.locator(`[data-style="${style}"]`).waitFor();
    const frame = await page.locator('.orb-shell').boundingBox();
    assert.equal(frame.width, { card: 216, orb: 148, bar: 124 }[style]);
    assert.equal(frame.height, { card: 134, orb: 168, bar: 44 }[style]);
    assert.equal(await page.locator('.orb-clock').innerText(), '20:00', 'style switches preserve timer');
    if (style === 'card') {
      assert.match(await page.locator('.orb-ball').evaluate(el => getComputedStyle(el).backgroundImage), /url\(/);
      assert.equal(await page.locator('.orb-card-task').innerText(), '完成今天的一件事');
    }
    if (style === 'bar') {
      const face = await page.locator('.orb-ball').boundingBox();
      assert.equal(face.width, 112); assert.equal(face.height, 32);
      assert.equal(await page.locator('.orb-tools').isVisible(), false);
      assert.equal(await page.locator('.orb-label').isVisible(), false);
    }
    await page.locator('.orb-shell').screenshot({ path: `/tmp/desktop-timer-${style}.png`, omitBackground: true, animations: 'disabled' });
  }
  assert.equal(await page.evaluate(() => window.orbCalls.filter(c => c.command === 'orb_action').length), stateBeforeStyles, 'changing styles never controls or resets the timer');
  await page.evaluate(() => window.setOrbSnapshot({ style: 'card', wallpaper: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22green%22/%3E%3C/svg%3E' }));
  await page.evaluate(() => window.setOrbSnapshot({ style: 'bar' }));
  await page.evaluate(() => window.setOrbSnapshot({ style: 'card' }));
  assert.deepEqual(errors, []);
  console.log('PASS desktop orb UI: transparent entry, progress, timer remote controls, frozen pause, theme/language, drag, no timer owner or business writes; three styles and compact native frame contracts.');
} finally { await browser.close(); }
