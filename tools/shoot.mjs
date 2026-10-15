import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';

const URL = 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.task-item', { timeout: 15000 });
await page.waitForTimeout(600);

// S1 任务视图
await page.screenshot({ path: '/tmp/shots/S1-tasks.png' });

// S2 已完成视图
await page.click('button.nav-item:has-text("已完成")');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shots/S2-completed.png' });

// S5 设置
await page.click('button.nav-item:has-text("任务")');
await page.waitForTimeout(300);
await page.click('.titlebar-actions button[title="设置"]');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shots/S5-settings.png' });
await page.click('.settings-nav button:has-text("番茄钟")');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/shots/S5b-settings-pomodoro.png' });
await page.click('.modal-head .icon-btn');
await page.waitForTimeout(300);

// S4 报表
await page.click('.titlebar-actions button[title="报表"]');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shots/S4-report.png' });
await page.click('.report-modal .modal-head .icon-btn');
await page.waitForTimeout(300);

// S3 番茄钟界面
await page.click('.float-play');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shots/S3-timer.png' });

console.log('console errors:', errors.length ? errors.join('\n  ') : '(none)');
await browser.close();
