import { pickSelect } from './ui-controls.mjs';
// Run against a freshly started Vite server: node tools/verify-calendar-theme-ui.mjs
import assert from 'node:assert/strict';
import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function theme(value) {
  await page.evaluate(async theme => {
    const { useTimerStore } = await import('/src/stores/timerStore.ts');
    useTimerStore.getState().setSettings({ ...useTimerStore.getState().settings, theme });
  }, value);
}
async function styles(selector) {
  return page.locator(selector).first().evaluate(el => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, text: s.color, grid: s.backgroundImage, scheme: s.colorScheme };
  });
}
function contrast(a, b) {
  const luminance = value => {
    const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5174/');
  await page.locator('.titlebar').waitFor();
  if (await page.locator('.timer-close').isVisible()) await page.locator('.timer-close').click();
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    const { toDateKey } = await import('/src/lib/date.ts');
    const today = toDateKey(new Date());
    await api.create_task({ title: '深色日历·定时任务', dueDate: today, dueTime: '09:30' });
    await api.create_task({ title: '深色日历·全天任务', dueDate: today });
    await (await import('/src/stores/dataStore.ts')).useDataStore.getState().reload();
    (await import('/src/stores/uiStore.ts')).useUiStore.getState().navigate({ name: 'calendar' });
  });
  await page.locator('.cal-page').waitFor();
  for (const mode of ['dark', 'light']) {
    await theme(mode);
    await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
    for (const view of ['year', 'month', 'week', 'day', 'schedule', 'multiday', 'multiweek']) {
      await pickSelect(page.locator('.cal-dropdown select'), view);
      const root = await styles('.cal-page');
      assert.equal(root.bg, mode === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)', `${mode}/${view} canvas`);
      assert.ok(contrast(root.bg, root.text) >= 4.5, `${mode}/${view} text contrast`);
      const eventSelector = { month: '.cal-ev-chip', week: '.cal-event', day: '.cal-event', schedule: '.cal-sched-card', multiday: '.cal-event', multiweek: '.cal-mw-event' }[view];
      if (eventSelector) {
        const event = await styles(eventSelector);
        assert.ok(contrast(event.bg, event.text) >= 4.5, `${mode}/${view} event contrast`);
      }
      if (['week', 'day', 'multiday'].includes(view)) {
        const head = await styles('.cal-col-head');
        assert.equal(head.bg, root.bg, 'sticky header must be opaque and match canvas');
        const grid = await styles('.cal-col-body');
        assert.match(grid.grid, /repeating-linear-gradient/);
        assert.equal(grid.grid.includes('rgb(240, 240, 238)'), false, 'no fixed white-theme grid');
      }
      await page.screenshot({ path: `/tmp/calendar-${mode}-${view}.png`, fullPage: true, animations: 'disabled' });
    }
    // Readability of every category colour, independent of the current category hash.
    const palettes = await page.locator('.cal-page').evaluate(root => Array.from({ length: 7 }, (_, i) => {
      const sample = document.createElement('span'); sample.className = 'cal-ev-chip'; sample.style.background = `var(--cal-event-${i})`; root.append(sample);
      const s = getComputedStyle(sample); const pair = [s.backgroundColor, s.color]; sample.remove(); return pair;
    }));
    for (const [bg, fg] of palettes) assert.ok(contrast(bg, fg) >= 4.5, `${mode} category palette ${bg}`);
    await pickSelect(page.locator('.cal-dropdown select'), 'month');
    await page.locator('.cal-ev-chip').filter({ hasText: '深色日历·定时任务' }).first().click();
    const popover = await styles('.cal-popover');
    assert.equal(popover.bg, (await styles('.cal-page')).bg);
    assert.ok(contrast(popover.bg, popover.text) >= 4.5);
    await page.screenshot({ path: `/tmp/calendar-${mode}-popover.png`, fullPage: true, animations: 'disabled' });
    await page.locator('.cal-range').click();
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme('light');
  assert.equal((await styles('.cal-page')).bg, 'rgb(255, 255, 255)', 'manual light beats system dark');
  await theme('system');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal((await styles('.cal-page')).bg, 'rgb(28, 28, 30)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal((await styles('.cal-page')).bg, 'rgb(255, 255, 255)', 'system changes update existing calendar');
  await theme('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal((await styles('.cal-page')).bg, 'rgb(28, 28, 30)', 'manual dark beats system light');
  assert.deepEqual(errors, []);
  console.log('PASS calendar theme: 7 views × 2 schemes, event palettes, popovers, sticky headers/grid, manual overrides and live system changes.');
} finally { await browser.close(); }
