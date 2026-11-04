import assert from 'node:assert/strict';
import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const style = () => page.evaluate(async () => (await (await import('/src/api/index.ts')).api.get_settings()).float_style);
async function open() {
  if (await page.locator('.timer-close').isVisible()) await page.locator('.timer-close').click();
  await page.evaluate(async () => (await import('/src/stores/uiStore.ts')).useUiStore.getState().openSettings('general'));
  await page.locator('.float-style-field').waitFor();
}
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:1420/');
  await page.locator('.titlebar').waitFor(); await open();
  assert.equal(await style(), 'card');
  assert.equal(await page.locator('input[name="float-style"]').count(), 3);
  assert.equal(await page.getByRole('radio', { name: /经典卡片/ }).isChecked(), true);
  const initialTimer = await page.evaluate(async () => (await import('/src/stores/timerStore.ts')).useTimerStore.getState().state);
  await page.getByRole('radio', { name: /经典卡片/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('radio', { name: /圆形悬浮球/ }).waitFor();
  for (let i = 0; i < 40 && await style() !== 'orb'; i++) await page.waitForTimeout(25);
  assert.equal(await style(), 'orb');
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 40 && await style() !== 'bar'; i++) await page.waitForTimeout(25);
  assert.equal(await style(), 'bar');
  assert.deepEqual(await page.evaluate(async () => (await import('/src/stores/timerStore.ts')).useTimerStore.getState().state), initialTimer, 'style change preserves idle/paused timer state');
  await page.waitForTimeout(120);
  await page.reload(); await page.locator('.titlebar').waitFor(); await open();
  assert.equal(await page.getByRole('radio', { name: /极简长条/ }).isChecked(), true, 'choice survives restart');
  await page.getByRole('radio', { name: /圆形悬浮球/ }).check();
  for (let i = 0; i < 40 && await style() !== 'orb'; i++) await page.waitForTimeout(25);
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    const original = api.set_setting;
    api.set_setting = async (key, value) => {
      if (key === 'float_style') { api.set_setting = original; throw new Error('simulated write failure'); }
      return original(key, value);
    };
  });
  await page.getByRole('radio', { name: /极简长条/ }).click();
  await page.locator('.float-style-field').getByRole('alert').waitFor();
  assert.equal(await style(), 'orb');
  assert.equal(await page.getByRole('radio', { name: /圆形悬浮球/ }).isChecked(), true, 'failed write rolls back visible choice');
  await page.getByRole('radio', { name: /经典卡片/ }).check();
  for (let i = 0; i < 40 && await style() !== 'card'; i++) await page.waitForTimeout(25);
  assert.equal(await style(), 'card', 'later changes still save after failure');
  await page.locator('.float-style-field').screenshot({ path: '/tmp/desktop-timer-style-picker-light.png', animations: 'disabled' });
  await page.evaluate(async () => {
    const { useTimerStore } = await import('/src/stores/timerStore.ts');
    useTimerStore.getState().setSettings({ ...useTimerStore.getState().settings, theme: 'dark' });
  });
  await page.locator('.float-style-field').screenshot({ path: '/tmp/desktop-timer-style-picker-dark.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS style preferences: classic default, three native radios, keyboard navigation, persistent choice, no timer reset, save failure rollback/recovery, light/dark.');
} finally { await browser.close(); }
