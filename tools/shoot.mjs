// 截图验收：S1–S5 + 深色主题 + 英文界面，并做若干自动检查。
//
// 为什么要重写（旧版的问题）：
//   1. 旧版用中文文案做选择器（`:has-text("已完成")`、`button[title="设置"]`），
//      i18n 一旦生效或在 en 环境下就全部失效；现在改用结构（class + 序号）。
//   2. 旧版只截浅色中文，看不出深色主题漏色与英文断行。
//   3. 旧版等 `.task-item` 超时只抛异常，不区分「渲染崩了」和「数据是空的」。
//
// 用法：先 `npm run build && npx vite preview --port 4173`，再 `node tools/shoot.mjs`。
// 产物：$SHOT_DIR（默认 /tmp/shots）/ 下多张 png。有问题时退出码非 0 并打印汇总。

import { chromium } from '/Users/lc/Develop/MyPageHome/node_modules/playwright/index.mjs';

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR ?? '/tmp/shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 侧边栏导航序号（Sidebar.tsx::NAV_MAIN + NAV_ARCHIVE）：
//   主分类 今天/明天/本周/已计划/任务（带时长+角标）
//   分隔线 → 归档区 已完成/记录（纯导航，无时长无角标）→ 分隔线 → 自定义清单
// completed=已完成任务归档；records=专注（番茄）记录归档 —— 两个视图各自截图
const NAV = { today: 0, tomorrow: 1, week: 2, scheduled: 3, tasks: 4, completed: 5, records: 6 };
// 顶栏图标序号（TitleBar.tsx 渲染顺序：高级版/好友/通知/成就/报表/设置）
const TB = { premium: 0, friends: 1, notify: 2, achievements: 3, report: 4, settings: 5 };
// 设置左侧导航序号（SettingsModal.tsx TABS 顺序）
const TAB = { account: 0, premium: 1, general: 2, pomodoro: 3, lists: 4, appearance: 5, about: 6 };

const problems = [];
const notes = [];
const fail = (m) => { problems.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 820 },
  deviceScaleFactor: 2,
  locale: 'zh-CN', // 固定语言环境：detectLang() 在无头浏览器里默认会取到 en-US
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const nav = (i) => page.locator('.nav-item').nth(i);
const tb = (i) => page.locator('.titlebar-actions .icon-btn').nth(i);
const settingsTab = (i) => page.locator('.settings-nav button').nth(i);

async function openSettings() {
  if (!(await page.locator('.settings-modal').count())) {
    await tb(TB.settings).click();
    await page.waitForSelector('.settings-modal', { timeout: 5000 });
  }
  await page.waitForTimeout(250);
}
async function closeModal() {
  const btn = page.locator('.modal-head .icon-btn').last();
  if (await btn.count()) await btn.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

try {
  console.log('→ 加载 ' + URL);
  await page.goto(URL, { waitUntil: 'networkidle' });

  // 首屏：区分「渲染崩了」与「数据是空的」
  try {
    await page.waitForSelector('.task-item', { timeout: 15000 });
    ok('首屏任务列表已渲染');
  } catch {
    const empty = await page.locator('.empty, .empty-state, .task-empty').count();
    const body = (await page.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' ');
    fail(`首屏没有 .task-item（空态元素 ${empty} 个）——首启种子数据可能没写入。body 片段：${body}`);
  }
  await page.waitForTimeout(600);
  await shot('S1-tasks');

  // 「今天」视图：种子任务到期日=昨天（复刻 S1 截图），按逾期留驻规则应全部留在今天，
  // 逾期置顶 + 红色「逾期」标志；它们在内置「任务」清单，故不显示来源徽标。
  await nav(NAV.today).click();
  await page.waitForTimeout(400);
  await shot('S1b-today');
  const todayRows = await page.locator('.task-item').evaluateAll((els) => els.map((e) => ({
    overdueChip: !!e.querySelector('.task-overdue'),
    redDue: e.querySelector('.task-due')?.classList.contains('overdue') ?? false,
    source: !!e.querySelector('.task-source'),
  })));
  if (todayRows.length === 0) fail('今天视图为空：逾期任务没有留驻（tasksForCategory 口径回归）');
  else if (todayRows.some((r) => !r.overdueChip || !r.redDue)) {
    fail(`今天视图存在未标逾期的行（应全部为逾期留驻）：${JSON.stringify(todayRows)}`);
  } else if (todayRows.some((r) => r.source)) {
    fail('内置「任务」清单的任务不应显示来源徽标');
  } else ok(`今天视图逾期留驻（${todayRows.length} 行，全部带红色逾期标志、无来源徽标）`);

  // 侧边栏归档区结构（用户需求 2026-10-19）：
  // 「已完成/记录」位于「任务」之下、自定义清单之上，且**不渲染**时长与角标
  // （这两个值只随时间单调增长，展示噪音大于信息量）；主分类仍带两段数字。
  const navStruct = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.nav .nav-item')];
    const metaCount = (el) => el.querySelectorAll('.nav-time, .nav-count').length;
    return {
      total: items.length,
      mainMeta: [0, 1, 2, 3, 4].map((i) => metaCount(items[i])),
      archiveMeta: [5, 6].map((i) => metaCount(items[i])),
      archiveClass: [5, 6].map((i) => items[i].classList.contains('nav-archive')),
      dividers: document.querySelectorAll('.nav .nav-divider').length,
    };
  });
  if (navStruct.total !== 7) fail(`侧边栏导航应为 7 项，实际 ${navStruct.total}`);
  if (navStruct.mainMeta.some((n) => n !== 2)) fail(`主分类 5 项应各有「时长+角标」，实际 ${JSON.stringify(navStruct.mainMeta)}`);
  else if (navStruct.archiveMeta.some((n) => n !== 0)) fail(`归档 2 项不应有时长/角标，实际 ${JSON.stringify(navStruct.archiveMeta)}`);
  else if (navStruct.archiveClass.some((x) => !x)) fail('归档项缺少 .nav-archive 类');
  else if (navStruct.dividers < 1) fail('归档区上方缺少分隔线（.nav-divider）');
  else ok(`侧边栏分组正确（主分类 5 项带数字；归档 2 项纯文本；分隔线 ${navStruct.dividers} 条）`);

  // 当前高亮的侧边栏序号（只断言结构与序号，不碰任何文案：文案走 i18n，两种语言都要成立）
  const activeNavIndex = () => page.locator('.nav-item')
    .evaluateAll((els) => els.findIndex((e) => e.classList.contains('active')));

  // S2 记录（专注归档：按结束日期分组，组内为专注记录条目）
  await nav(NAV.records).click();
  await page.waitForTimeout(500);
  await shot('S2-records');
  const recIdx = await activeNavIndex();
  const recGroups = await page.locator('.group-head').count();
  const recItems = await page.locator('.record-item').count();
  if (recIdx !== NAV.records) fail(`记录视图：高亮在第 ${recIdx} 项，应为第 ${NAV.records} 项（侧边栏序号与 shoot.mjs::NAV 失配）`);
  else if (recGroups === 0 || recItems === 0) fail(`记录视图无分组/条目（.group-head ${recGroups}、.record-item ${recItems}）`);
  else ok(`记录视图按日期分组（.group-head ${recGroups}、记录条目 ${recItems}）`);
  notes.push(`S2 记录视图分组数：${recGroups}`);

  // S2b 已完成（任务归档：按完成日期分组，行内是可交互的任务条目）
  await nav(NAV.completed).click();
  await page.waitForTimeout(500);
  await shot('S2b-tasks-done');
  const doneIdx = await activeNavIndex();
  const doneItems = await page.locator('.task-item').count();
  const doneGroups = await page.locator('.group-head').count();
  const strayRecords = await page.locator('.record-item').count();
  if (doneIdx !== NAV.completed) fail(`已完成视图：高亮在第 ${doneIdx} 项，应为第 ${NAV.completed} 项`);
  else if (strayRecords) fail(`已完成视图混入了专注记录条目（.record-item ${strayRecords} 个）——两个视图串了`);
  else if (doneItems && !doneGroups) fail(`已完成视图有任务行（${doneItems}）但缺少日期分组头`);
  else if (!doneItems && !(await page.locator('.empty').count())) fail('已完成视图为空时必须有 .empty 空态文案');
  else ok(`已完成视图结构正确（分组 ${doneGroups}、任务行 ${doneItems}、无 .record-item）`);
  notes.push(`S2b 已完成视图：分组 ${doneGroups}、任务行 ${doneItems}`);

  // S5 设置（默认账号页）
  await nav(NAV.tasks).click();
  await page.waitForTimeout(250);
  await openSettings();
  await shot('S5-settings');

  // 账号页结构自检：账号页 = 软件账号（PocketBase），沿用设置页统一的 field 栅格。
  // 只断言结构与控件类型，不断言任何具体文案（文案走 i18n，两种语言都要成立）。
  const acct = await page.evaluate(() => {
    const pane = document.querySelector('.settings-pane');
    if (!pane) return { err: 'pane 未渲染' };
    const q = (s) => pane.querySelectorAll(s).length;
    return {
      sections: q('.acct-section'),
      email: q('input[type="email"]'),
      pwd: q('input[type="password"]'),
      submit: q('.acct-row-actions .btn.primary'),
      switchLink: q('.acct-link'),
      danger: q('.btn.danger'),
      // 未登录不该出现「已登录」徽标 / 头像按钮
      badge: q('.acct-badge'),
      avatar: q('.acct-avatar'),
      // 旧的双层结构（本地假档案 + 云同步小尾巴）与旧卡片版都必须彻底消失
      legacy: q('.profile-avatar, .profile-edit, .profile-form, .cloud-card, .account-card'),
    };
  });
  const acctProblems = [];
  if (acct.err) acctProblems.push(acct.err);
  if (acct.sections < 2) acctProblems.push(`账号页区块不足（.acct-section ${acct.sections} 个，至少应有「账号」与「本地数据」）`);
  if (!acct.email) acctProblems.push('缺少邮箱输入框');
  if (!acct.pwd) acctProblems.push('缺少密码输入框');
  if (!acct.submit) acctProblems.push('缺少登录/注册主按钮');
  if (!acct.switchLink) acctProblems.push('缺少「去注册 / 忘记密码」文字入口');
  if (!acct.danger) acctProblems.push('缺少删除数据按钮（.btn.danger）');
  if (acct.badge) acctProblems.push('未登录时不应出现「已登录」徽标');
  if (acct.avatar) acctProblems.push('未登录时不应出现头像上传按钮');
  if (acct.legacy) acctProblems.push(`旧的本地假档案/云同步区块或旧卡片结构仍存在（${acct.legacy} 个节点）`);
  if (acctProblems.length) fail(`账号页结构不符：${acctProblems.join('；')}`);
  else ok('账号页结构正确（账号区 + 邮箱/密码/登录 + 本地数据区，旧假档案已移除）');

  // 白噪音选择弹窗（从外观页点开：结构 + 内嵌封面解码自检）
  await settingsTab(TAB.appearance).click();
  await page.waitForTimeout(250);
  await page.locator('.settings-pane button:has-text("选择白噪音")').click();
  await page.waitForSelector('.noise-modal', { timeout: 5000 });
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('.noise-thumb')].filter((e) => e.tagName === 'IMG')
        .every((i) => i.complete && i.naturalWidth > 0),
      null, { timeout: 5000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);   // 等弹层动画结束再截图
  const noise = await page.evaluate(() => {
    const thumbs = [...document.querySelectorAll('.noise-thumb')].filter((e) => e.tagName === 'IMG');
    return {
      modal: document.querySelectorAll('.noise-modal').length,
      items: document.querySelectorAll('.noise-item').length,
      imgs: thumbs.length,
      broken: thumbs.filter((i) => !i.complete || i.naturalWidth === 0).length,
      slider: document.querySelectorAll('.noise-slider').length,
      confirm: document.querySelectorAll('.noise-foot .btn.primary').length,
    };
  });
  const noiseProblems = [];
  if (!noise.modal) noiseProblems.push('未弹出 .noise-modal');
  if (noise.items !== 6) noiseProblems.push(`音色项应为 6（无 + 5 种），实际 ${noise.items}`);
  if (noise.imgs !== 5) noiseProblems.push(`封面缩略图应为 5 张，实际 ${noise.imgs}`);
  if (noise.broken) noiseProblems.push(`${noise.broken} 张封面未解码（内嵌封面缺失？跑 tools/extract-noise-covers.sh）`);
  if (!noise.slider) noiseProblems.push('缺少音量滑杆');
  if (!noise.confirm) noiseProblems.push('缺少确定按钮');
  if (noiseProblems.length) fail(`白噪音弹窗结构不符：${noiseProblems.join('；')}`);
  else ok('白噪音弹窗结构正确（6 项 + 5 张内嵌封面可解码 + 音量滑杆 + 取消/确定）');
  await shot('S5c-noise-picker');
  await page.locator('.noise-foot .btn').first().click();   // 取消
  await page.waitForSelector('.noise-modal', { state: 'detached' });

  // S5b 番茄钟设置页
  await settingsTab(TAB.pomodoro).click();
  await page.waitForTimeout(300);
  await shot('S5b-settings-pomodoro');

  // S4 报表
  await closeModal();
  await tb(TB.report).click();
  await page.waitForSelector('.report-modal', { timeout: 5000 });
  await page.waitForTimeout(900);
  await shot('S4-report');
  await closeModal();

  // S3 专注界面 + 壁纸自检
  await page.locator('.float-play').click();
  await page.waitForTimeout(900);
  await shot('S3-timer');
  const bg = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, inline: el.getAttribute('style') };
    };
    return {
      floatWin: pick('.float-win'),
      timerBg: pick('.timer-bg'),
      timerScreen: pick('.timer-screen'),
    };
  });
  if (bg.floatWin && bg.floatWin.image === 'none') {
    fail(`悬浮窗壁纸未生效：.float-win background-image = none（inline style: ${bg.floatWin.inline}）`);
  } else if (bg.floatWin) ok('悬浮窗壁纸已生效');
  // 壁纸挂在 .timer-bg 上（TimerScreen 里 .timer-screen 是容器，背景在子层）
  const timerBgImage = bg.timerBg?.image ?? bg.timerScreen?.image;
  if (timerBgImage === 'none' || timerBgImage == null) {
    fail(`专注界面壁纸未生效：.timer-bg background-image = ${timerBgImage ?? '(元素不存在)'}`);
  } else ok('专注界面壁纸已生效');

  // 计时模式自检：菜单三项一行排开，且「倒计时」起始 25:00、「正计时」起始 00:00。
  // 只断言数字与项数（文案走 i18n，两种语言都要成立）；切完复位到番茄钟。
  const modeMenu = page.locator('.timer-mode-menu');
  await page.locator('.timer-tool').filter({ hasText: /番茄钟|Pomodoro/ }).first().click();
  await page.waitForSelector('.timer-mode-menu', { timeout: 5000 });
  const modeItems = await modeMenu.locator('button').count();
  // 三项必须横向排开（竖排会把中文挤成单字）
  const modeBoxes = await modeMenu.locator('button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().top));
  const sameRow = modeBoxes.length > 0 && Math.max(...modeBoxes) - Math.min(...modeBoxes) < 2;
  if (modeItems !== 3) fail(`计时模式菜单应有 3 项（番茄钟/倒计时/正计时），实际 ${modeItems}`);
  else if (!sameRow) fail('计时模式菜单被挤成换行，应一行排开（检查 .timer-mode-menu 的 white-space）');
  else ok('计时模式菜单 3 项且一行排开');

  const readClock = async () => (await page.locator('.timer-count').innerText()).trim();
  await modeMenu.locator('button').nth(1).click();          // 倒计时
  await page.waitForTimeout(200);
  const cdClock = await readClock();
  await page.locator('.timer-tool').filter({ hasText: /倒计时|Countdown/ }).first().click();
  await page.waitForSelector('.timer-mode-menu');
  await modeMenu.locator('button').nth(2).click();          // 正计时
  await page.waitForTimeout(200);
  const swClock = await readClock();
  await page.locator('.timer-tool').filter({ hasText: /正计时|Stopwatch/ }).first().click();
  await page.waitForSelector('.timer-mode-menu');
  await modeMenu.locator('button').nth(0).click();          // 复位番茄钟
  await page.waitForTimeout(200);
  if (cdClock !== '25:00') fail(`倒计时未开始时应为 25:00，实际 ${cdClock}`);
  else if (swClock !== '00:00') fail(`正计时未开始时应为 00:00，实际 ${swClock}`);
  else ok('计时模式起始值正确（倒计时 25:00 / 正计时 00:00）');

  // 退出专注界面：优先点右上角「收起」，退化到 Esc。
  // 注意 .timer-screen 是整窗覆盖层，只要它还开着，后面所有点击都会被它拦截。
  const timerClose = page.locator('.timer-close');
  if (await timerClose.count()) await timerClose.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('.timer-screen').count()) {
    // Esc 关不掉（当前实现的已知行为），记录但不阻断：用「收起」兜底
    notes.push('专注界面在按 Esc 后仍然存在（当前只有右上角「收起」能关）');
    if (await timerClose.count()) { await timerClose.click(); await page.waitForTimeout(300); }
  }
  if (await page.locator('.timer-screen').count()) throw new Error('无法关闭专注界面，后续检查会全被拦截');

  // ── 深色主题 ──────────────────────────────────────────────
  await openSettings();
  await settingsTab(TAB.appearance).click();
  await page.waitForTimeout(300);
  const themeSelect = page.locator('.settings-pane select:has(option[value="dark"])');
  if (!(await themeSelect.count())) {
    fail('外观页找不到主题下拉框，无法验证深色主题');
  } else {
    await themeSelect.selectOption('dark');
    await page.waitForTimeout(500);
    await shot('S5-dark-settings');
    await closeModal();
    await page.waitForTimeout(400);
    await shot('S1-dark-tasks');
    await tb(TB.report).click();
    await page.waitForSelector('.report-modal', { timeout: 5000 });
    await page.waitForTimeout(900);
    await shot('S4-dark-report');
    await closeModal();

    // 深色可读性粗检：前景/背景对比度 < 2.2 的可疑文本
    const lowContrast = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const opaqueBg = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          const a = bg.startsWith('rgba') ? Number(bg.split(',')[3]) : 1;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && a > 0.9) return parse(bg);
          n = n.parentElement;
        }
        return [28, 28, 30];
      };
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.childElementCount) continue;
        const text = (el.textContent ?? '').trim();
        if (!text) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.5) continue;
        const fg = parse(s.color);
        if (fg.length < 3) continue;
        const l1 = lum(fg), l2 = lum(opaqueBg(el));
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (ratio < 2.2) out.push(`「${text.slice(0, 20)}」${ratio.toFixed(2)}`);
      }
      return [...new Set(out)].slice(0, 15);
    });
    if (lowContrast.length) notes.push(`深色下对比度 <2.2 的文本：${lowContrast.join('、')}`);
    else ok('深色主题未发现极低对比度文本（<2.2）');

    // 恢复浅色
    await openSettings();
    await settingsTab(TAB.appearance).click();
    await page.waitForTimeout(250);
    await page.locator('.settings-pane select:has(option[value="light"])').selectOption('light');
    await closeModal();
  }

  // 扫描容器内叶子文本里的中文（英文界面残留检查复用）
  const cjkIn = (sel) => page.evaluate((s) => {
    const root = document.querySelector(s);
    if (!root) return ['(容器不存在:' + s + ')'];
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.childElementCount) continue;
      const t = (el.textContent ?? '').trim();
      if (/[\u4e00-\u9fa5]/.test(t)) out.push(t.slice(0, 20));
    }
    return [...new Set(out)].slice(0, 25);
  }, sel);
  // 允许出现的非 i18n 中文：①PRD §6.3 演示数据（任务/清单名，是数据不是 UI 文案）
  // ②语言下拉里的「简体中文」（按惯例各语言用自身文字显示）
  const ALLOW = new Set(['任务', '数学真题', '408真题', '单词', '简体中文']);

  // ── 英文界面：中文残留 ────────────────────────────────────
  await openSettings();
  await settingsTab(TAB.general).click();
  await page.waitForTimeout(300);
  const langSelect = page.locator('.settings-pane select:has(option[value="en"])').first();
  if (!(await langSelect.count())) {
    fail('通用页找不到语言下拉框');
  } else {
    await langSelect.selectOption('en');
    await page.waitForTimeout(500);
    await closeModal();
    await page.waitForTimeout(400);
    await shot('S1-en-tasks');
    await tb(TB.report).click();
    await page.waitForSelector('.report-modal', { timeout: 5000 });
    await page.waitForTimeout(800);
    await shot('S4-en-report');
    await closeModal();
    await openSettings();
    await page.waitForTimeout(300);
    await shot('S5-en-settings');

    const cjk = await cjkIn('body');
    const real = cjk.filter((t) => !ALLOW.has(t));
    if (real.length) fail(`英文界面仍残留中文 ${real.length} 处：${real.join(' / ')}`);
    else ok('英文界面无中文残留（首屏+设置，已排除演示数据与语言名）');

    // 专注界面（全屏层，之前的扫描范围不包含它）
    await page.locator('.float-expand').click();
    await page.waitForSelector('.timer-screen', { timeout: 5000 });
    await page.waitForTimeout(600);
    await shot('S3-en-timer');
    const cjkTimer = (await cjkIn('.timer-screen')).filter((t) => !ALLOW.has(t));
    if (cjkTimer.length) fail(`英文专注界面残留中文 ${cjkTimer.length} 处：${cjkTimer.join(' / ')}`);
    else ok('英文专注界面无中文残留');
    await page.locator('.timer-close').click().catch(() => {});
    await page.waitForTimeout(300);

    // 恢复中文
    await settingsTab(TAB.general).click();
    await page.waitForTimeout(250);
    await page.locator('.settings-pane select:has(option[value="zh"])').first().selectOption('zh');
    await closeModal();
  }
} catch (e) {
  fail('脚本中断：' + e.message);
} finally {
  await browser.close();
}

console.log('\n──────── 汇总 ────────');
if (consoleErrors.length) fail(`console 错误 ${consoleErrors.length} 条:\n  ` + consoleErrors.slice(0, 8).join('\n  '));
else ok('console 无错误');
notes.forEach((n) => console.log('  · ' + n));
console.log(`截图目录：${OUT}`);
if (problems.length) {
  console.log(`\n❌ 共 ${problems.length} 个问题`);
  process.exit(1);
}
console.log('\n✅ 全部检查通过');
