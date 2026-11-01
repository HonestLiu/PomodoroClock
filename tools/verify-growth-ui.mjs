// 用法：APP_URL=http://127.0.0.1:5174 node tools/verify-growth-ui.mjs（Vite dev 服务）
import { strict as assert } from 'node:assert';
import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const state = () => page.evaluate(async () => (await import('/src/stores/growthStore.ts')).useGrowthStore.getState().data);
async function tab(name) { await page.locator('.growth-tabs').getByRole('button', { name, exact: true }).click(); }
async function addReward(name, price, regular) {
  await page.getByRole('button', { name: '添加奖励', exact: true }).click();
  await page.locator('input[name=name]').fill(name);
  await page.locator('input[name=member]').fill(price);
  if (regular) await page.locator('input[name=regular]').fill(regular);
  await page.getByRole('button', { name: '保存奖励', exact: true }).click();
  await page.locator('.growth-form').waitFor({ state: 'detached' });
}
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5174/');
  await page.locator('.titlebar').waitFor();
  await page.waitForTimeout(500); // 等待开发模式 StrictMode 的启动恢复完成
  if (await page.locator('.timer-close').isVisible()) await page.locator('.timer-close').click();
  await page.locator('.growth-entry').click();
  assert.equal((await state()).focusSeconds, 0);
  await page.evaluate(async () => {
    const { useGrowthStore } = await import('/src/stores/growthStore.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 128, 128);
    const qr = canvas.toDataURL('image/png');
    await useGrowthStore.getState().configurePayment({ ...useGrowthStore.getState().data.paymentSettings, wechatQr: qr, alipayQr: qr });
  });
  await tab('基金与规则');
  await page.locator('input[name=amount]').fill('10');
  await page.locator('.growth-form').getByRole('button', { name: '存入基金', exact: true }).click();
  await page.locator('.payment-modal').waitFor();
  assert.equal((await state()).fundCents, 0);
  await page.getByRole('button', { name: '付款成功', exact: true }).click();
  await page.waitForFunction(async () => (await import('/src/stores/growthStore.ts')).useGrowthStore.getState().data.fundCents === 1000);
  assert.equal((await state()).entries.length, 1);
  await tab('激励商店');
  await addReward('一杯会员咖啡', '6', '8');
  assert.equal(await page.locator('.growth-card button.primary').isDisabled(), true);
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    await api.create_focus_record({ startAt: Date.now() - 3600000, endAt: Date.now(), durationMin: 60 });
  });
  await page.waitForFunction(async () => (await import('/src/stores/growthStore.ts')).useGrowthStore.getState().data.focusSeconds === 3600);
  await page.locator('.growth-card button.primary').click();
  await page.getByRole('button', { name: '确认扣账' }).click();
  await page.waitForFunction(async () => (await import('/src/stores/growthStore.ts')).useGrowthStore.getState().data.fundCents === 400);
  assert.equal((await state()).spentCoins, 60);
  await tab('等级奖励');
  await addReward('等级小礼物', '2', null);
  // 新建默认推荐下一级，这次选择已经解锁的 Lv.2。
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('input[name=level]').fill('2');
  await page.getByRole('button', { name: '保存奖励', exact: true }).click();
  await page.locator('.growth-form').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '领取奖励', exact: true }).click();
  await page.getByRole('button', { name: '确认扣账' }).click();
  await page.waitForFunction(async () => (await import('/src/stores/growthStore.ts')).useGrowthStore.getState().data.fundCents === 200);
  assert.equal(await page.getByRole('button', { name: '领取奖励', exact: true }).isDisabled(), true);
  await page.screenshot({ path: '/tmp/growth-levels.png' });
  const beforeReload = await state();
  await page.reload();
  await page.locator('.titlebar').waitFor();
  await page.waitForTimeout(500); // 等待开发模式 StrictMode 的启动恢复完成
  if (await page.locator('.timer-close').isVisible()) await page.locator('.timer-close').click();
  assert.deepEqual(await state(), beforeReload);
  await page.locator('.growth-entry').click();
  await tab('收支明细');
  assert.equal(await page.locator('.growth-ledger > div').count(), 3);
  await page.screenshot({ path: '/tmp/growth-history.png' });
  await page.evaluate(async () => {
    (await import('/src/i18n/store.ts')).useI18nStore.getState().setLang('en');
    document.documentElement.dataset.theme = 'dark';
  });
  await tab('Reward shop');
  await page.screenshot({ path: '/tmp/growth-dark-en.png' });
  await page.setViewportSize({ width: 650, height: 760 });
  assert.equal(await page.locator('.growth-modal').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: '/tmp/growth-narrow.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.growth-modal').count(), 0);
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    const { useGrowthStore } = await import('/src/stores/growthStore.ts');
    await api.create_focus_record({ startAt: Date.now() - 3600000, endAt: Date.now(), durationMin: 60 });
    await useGrowthStore.getState().startPayment({ kind: 'deposit', cents: 400 });
    await useGrowthStore.getState().confirmPayment(useGrowthStore.getState().data.paymentOrders.find(o => o.status === 'pending').id);
    const id = useGrowthStore.getState().data.rewards.find(r => r.kind === 'shop').id;
    const outcomes = await Promise.allSettled([useGrowthStore.getState().redeem(id), useGrowthStore.getState().redeem(id)]);
    if (outcomes.filter(r => r.status === 'fulfilled').length !== 1) throw new Error('Concurrent redemption overdraft');
    const before = JSON.stringify(useGrowthStore.getState().data);
    const original = api.set_setting;
    api.set_setting = async () => { throw new Error('simulated write failure'); };
    let rejected = false;
    try { await useGrowthStore.getState().setRate(20); } catch { rejected = true; }
    finally { api.set_setting = original; }
    if (!rejected || JSON.stringify(useGrowthStore.getState().data) !== before) throw new Error('Failed write changed balance');
    await api.clear_all_data();
  });
  await page.waitForFunction(async () => (await import('/src/stores/growthStore.ts')).useGrowthStore.getState().data?.focusSeconds === 0);
  assert.equal((await state()).fundCents, 0);
  assert.equal((await state()).rewards.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS growth UI: focus earnings, shop CRUD, fund deposit, redemption, level claim, restart, history, dark/en, narrow layout, Escape, concurrent redemption, write failure, clear data');
} finally { await browser.close(); }
