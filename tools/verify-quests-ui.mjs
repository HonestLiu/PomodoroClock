import assert from 'node:assert/strict';
import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const url = process.env.APP_URL ?? 'http://127.0.0.1:5174/';
const start = new Date(2026, 10, 1, 9).getTime();
const data = () => page.evaluate(async () => {
  const { api } = await import('/src/api/index.ts');
  return { game: await api.quest_load(), tasks: await api.list_tasks(), records: await api.list_focus_records() };
});
async function settle() { await page.waitForFunction(async () => !(await import('/src/stores/questStore.ts')).useQuestStore.getState().busy); }
try {
  await page.clock.install({ time: start });
  await page.clock.setFixedTime(start);
  await page.goto(url);
  await page.locator('.titlebar').waitFor();
  await page.waitForFunction(async () => (await import('/src/stores/questStore.ts')).useQuestStore.getState().ready);
  // This browser context has isolated test data; reset the demo seed only here.
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    await api.clear_all_data();
    await (await import('/src/stores/dataStore.ts')).useDataStore.getState().reload();
    await (await import('/src/stores/questStore.ts')).useQuestStore.getState().refresh();
  });
  if (await page.locator('.timer-close').isVisible()) await page.locator('.timer-close').click();
  await page.locator('.nav-quests').click();
  await page.locator('input[name=goal]').fill('ESP32 任务链');
  await page.locator('#quest-context').fill('开发板已准备，验证灯光响应。');
  await page.getByLabel('手动编排任务链').check();
  await page.locator('textarea[name=steps]').fill('编译烧录验证\n点亮 LED 验证\n按键控制验证');
  await page.getByRole('button', { name: '建立并发布', exact: true }).click();
  await page.locator('.quest-card').waitFor();
  assert.equal(await page.locator('.quest-card').count(), 1);
  assert.equal(await page.getByText('点亮 LED 验证', { exact: true }).count(), 0, 'future task hidden');
  assert.equal((await data()).tasks.length, 0);
  await page.getByRole('button', { name: '接取任务', exact: true }).click();
  await page.locator('.quest-card').getByRole('button', { name: '开始专注', exact: true }).waitFor();
  assert.equal((await data()).tasks.length, 0, 'acceptance does not create ordinary task');
  await page.locator('.quest-card').getByRole('button', { name: '开始专注', exact: true }).click();
  await page.locator('.timer-screen').waitFor();
  assert.match(await page.locator('.timer-screen').innerText(), /编译烧录验证/);
  await page.clock.setFixedTime(start + 10 * 60000);
  await page.evaluate(async () => {
    const timer = (await import('/src/stores/timerStore.ts')).useTimerStore.getState();
    await timer.finishQuestSession(timer.state.task_id);
  });
  await page.locator('.timer-close').click();
  let state = await data();
  assert.equal(state.records.length, 0, 'failed attempt focus remains staged');
  assert.ok(state.game.attempts[0].sessions[0].durationMin >= 9.9);
  await page.screenshot({ path: '/tmp/quest-board-accepted.png', fullPage: true, animations: 'disabled' });
  await page.clock.setFixedTime(start + 24 * 3600000);
  await page.evaluate(async () => (await import('/src/stores/questStore.ts')).useQuestStore.getState().refresh());
  await page.getByRole('button', { name: '接取任务', exact: true }).waitFor();
  state = await data();
  assert.equal(state.game.attempts[0].status, 'expired');
  assert.equal(state.tasks.length, 0); assert.equal(state.records.length, 0);
  await page.getByRole('button', { name: '接取任务', exact: true }).click();
  await page.locator('.quest-card').getByRole('button', { name: '开始专注', exact: true }).click();
  await page.locator('.timer-screen').waitFor();
  await page.clock.setFixedTime(start + 24 * 3600000 + 5 * 60000);
  await page.locator('.timer-close').click();
  await page.evaluate(async () => (await import('/src/stores/uiStore.ts')).useUiStore.getState().navigate({ name: 'today' }));
  await page.locator('.quest-today').waitFor();
  await page.getByLabel('完成任务', { exact: true }).check();
  await page.waitForFunction(async () => {
    const { useQuestStore } = await import('/src/stores/questStore.ts');
    const { useDataStore } = await import('/src/stores/dataStore.ts');
    return useQuestStore.getState().data.attempts.some(a => a.status === 'completed') && useDataStore.getState().tasks.some(t => t.completed === 1);
  });
  await settle();
  for (let retry = 0; retry < 100; retry++) {
    state = await data();
    if (state.tasks.length === 1 && state.game.attempts.some(a => a.status === 'completed')) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(state.tasks[0].completed, 1);
  assert.equal(state.records.length, 1);
  assert.ok(state.records[0].duration_min >= 4.9 && state.records[0].duration_min <= 5.1, 'only successful attempt counts');
  assert.equal(state.game.attempts.filter(a => a.status === 'completed').length, 1);
  const growth = await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    const { useGrowthStore } = await import('/src/stores/growthStore.ts');
    await useGrowthStore.getState().reconcile(await api.list_focus_records());
    const { coinBalance, experience } = await import('/src/lib/growth.ts');
    const s = useGrowthStore.getState().data;
    return { coins: coinBalance(s), xp: experience(s) };
  });
  assert.equal(growth.coins, 8); assert.equal(growth.xp, 100);
  const beforeReplay = state.game.revision;
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    const d = await api.quest_load();
    try { await api.quest_commit(d.revision - 1, d); throw new Error('CAS should fail'); }
    catch (e) { if (!String(e).includes('quest.conflict')) throw e; }
  });
  assert.equal((await data()).game.revision, beforeReplay);
  await page.evaluate(async () => {
    const { api } = await import('/src/api/index.ts');
    const task = (await api.list_tasks())[0];
    try { await api.toggle_task(task.id); throw new Error('archive should be locked'); }
    catch (e) { if (!String(e).includes('quest.archiveLocked')) throw e; }
  });
  await page.reload();
  await page.locator('.titlebar').waitFor();
  if (await page.locator('.timer-close').isVisible()) await page.locator('.timer-close').click();
  await page.locator('.nav-quests').click();
  assert.equal((await data()).tasks.length, 1, 'restart preserves archive');
  assert.equal((await data()).records.length, 1, 'restart does not replay focus');
  // Next publication exposes the successor only, without revealing the third task.
  await page.clock.setFixedTime(start + 48 * 3600000);
  await page.evaluate(async () => (await import('/src/stores/questStore.ts')).useQuestStore.getState().refresh());
  await page.getByRole('heading', { name: '点亮 LED 验证', exact: true }).waitFor();
  assert.equal(await page.getByText('按键控制验证', { exact: true }).count(), 0);
  await page.screenshot({ path: '/tmp/quest-board-light.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(async () => {
    const { useTimerStore } = await import('/src/stores/timerStore.ts');
    useTimerStore.getState().setSettings({ ...useTimerStore.getState().settings, theme: 'dark' });
    (await import('/src/i18n/index.ts')).useI18nStore.getState().setLang('en');
  });
  await page.getByRole('heading', { name: 'Quest board', exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/quest-board-dark-en.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 980, height: 780 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  // Exercise the actual structured planner through an intercepted provider, never a live key.
  const plan = { steps: [
    { key: 'a', title: '准备训练笔记', acceptance: '写出当前水平与验收目标', minutes: 10, requires: [] },
    { key: 'b', title: '隐藏的训练第二步', acceptance: '完成一次基础练习', minutes: 20, requires: ['a'] },
    { key: 'c', title: '隐藏的训练第三步', acceptance: '总结并验证成果', minutes: 20, requires: ['b'] },
  ] };
  let invalidPlan = false;
  await page.route('https://quest.test/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalidPlan ? { steps: [{ ...plan.steps[0], requires: ['a'] }] } : plan) } }] }) }));
  await page.evaluate(async () => {
    const { useTimerStore } = await import('/src/stores/timerStore.ts');
    useTimerStore.getState().setSettings({ ...useTimerStore.getState().settings, ai_provider: 'openai', ai_base_url: 'https://quest.test', ai_api_key: 'isolated-test-key', ai_model: 'test' });
  });
  await page.getByRole('button', { name: 'Create a goal', exact: true }).click();
  await page.locator('#quest-goal').fill('AI 规划目标');
  await page.locator('#quest-context').fill('用明确练习逐步形成可验证成果');
  await page.locator('#quest-budget').fill('30');
  await page.getByRole('button', { name: 'Plan and publish', exact: true }).click();
  await page.locator('.quest-goal').filter({ hasText: 'AI 规划目标' }).waitFor();
  assert.equal(await page.getByText('隐藏的训练第二步', { exact: true }).count(), 0);
  assert.equal((await data()).game.goals.length, 2);
  invalidPlan = true;
  await page.getByRole('button', { name: 'Create a goal', exact: true }).click();
  await page.locator('#quest-goal').fill('无效路线不落库');
  await page.getByRole('button', { name: 'Plan and publish', exact: true }).click();
  await page.getByText('The route is incomplete or has conflicting prerequisites. Each step must fit the daily budget.', { exact: true }).waitFor();
  assert.equal((await data()).game.goals.length, 2, 'invalid model dependency never partially persists');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Two tabs racing to accept the same quest must produce only one successful attempt.
  const other = await context.newPage();
  await other.clock.install({ time: start + 48 * 3600000 });
  await other.clock.setFixedTime(start + 48 * 3600000);
  await other.goto(url); await other.locator('.titlebar').waitFor();
  const questId = (await data()).game.quests.find(q => q.title === '准备训练笔记').id;
  const acceptIn = tab => tab.evaluate(async id => {
    const { useQuestStore } = await import('/src/stores/questStore.ts');
    try { await useQuestStore.getState().accept(id); return true; } catch { return false; }
  }, questId);
  const results = await Promise.all([acceptIn(page), acceptIn(other)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await data()).game.attempts.filter(a => a.questId === questId && a.status === 'accepted').length, 1);
  await other.close();
  assert.deepEqual(errors, []);
  console.log('Quest UI passed: hidden prerequisites, accept, actual focus staging, cross-day return, success-only archive, CAS, immutable archive, restart, successor, dark/English/layout, structured AI planning, invalid model output, concurrent tabs.');
} finally { await browser.close(); }
