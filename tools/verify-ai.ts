// AI 能力口径校验 —— docs/05-modules/ai.md（M1 基础设施 + 功能一）
// 全程不联网：用 fake 引擎跑通「时间注入 → 结构化解析 → 校验分支 → 父子打平 → 降级 → 估时校准」。

import { timeContext, validateObject, aiConfig, isAiConfigured, runStructuredLLM } from '@/lib/ai/providers';
import { parseTasks } from '@/lib/ai/nlParse';
import { calibrationSummary, factorFor, calibPromptLine } from '@/lib/ai/calib';
import { DEFAULT_SETTINGS, type Settings, type Task, type FocusRecord, type TaskList } from '@/types';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}
function ok(label: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const lists: TaskList[] = [{
  id: 'l1', name: '发布版', sort_order: 0, is_smart: 0,
  icon_type: 'dot', icon_color: '', icon_glyph: '', folder_id: null, created_at: 1, updated_at: 1,
}];

console.log('--- 时间上下文注入（约束 5） ---');
const tc = timeContext(new Date('2026-10-21T15:40:00+08:00'));
ok('含 date=YYYY-MM-DD', /date=2026-10-21/.test(tc));
ok('含 weekday=Wed', /weekday=Wed/.test(tc));
ok('含 timezone=', /timezone=[+-]\d{2}:\d{2}/.test(tc));

console.log('\n--- 结构化输出校验 + 分支（约束 2/3） ---');
check('缺 tasks 被拒', validateObject({ foo: 1 }, { tasks: 'array' }).length > 0, true);
check('tasks 类型错被拒', validateObject({ tasks: {} }, { tasks: 'array' }), ['tasks 类型应为 array，实际 object']);
check('合法通过', validateObject({ tasks: [] }, { tasks: 'array' }), []);
check('fake 返回坏体 → validation', (await runStructuredLLM(
  settings(), 'fake', { system: 's', user: 'u' }, { tasks: 'array' },
  { fakeData: () => ({ wrong: 1 }) })).status, 'validation');
check('fake 返回好体 → ok', (await runStructuredLLM(
  settings(), 'fake', { system: 's', user: 'u' }, { tasks: 'array' },
  { fakeData: () => ({ tasks: [] }) })).status, 'ok');

console.log('\n--- provider 配置（Claude / OpenAI 双格式） ---');
check('默认未配置', isAiConfigured(aiConfig(settings())), false);
check('claude 可识别', isAiConfigured(aiConfig(settings({ ai_provider: 'claude', ai_api_key: 'k' }))), true);
check('openai 可识别', isAiConfigured(aiConfig(settings({ ai_provider: 'openai', ai_api_key: 'k' }))), true);
check('apiKey 默认空（只本地存）', DEFAULT_SETTINGS.ai_api_key, '');

console.log('\n--- 功能一：NL 解析（fake 全链路） ---');
const sentence = '下周五前完成项目的登录模块，每天晚上留一个小时开发，周三前先完成数据库设计。';
const out = await parseTasks({ text: sentence, settings: settings(), lists, calib: [], engine: 'fake' });
check('解析状态', out.status, 'ok');
ok('产出 ≥2 条（含父子）', out.tasks.length >= 2);
ok('父子打平：存在 parent_id', out.tasks.some((t) => t.parent_id != null));
ok('每条带整句原文', out.tasks.every((t) => t.raw === sentence));
ok('provenance 保留 confidence', out.tasks.every((t) => Object.keys(t.prov).length > 0));

check('选服务商但无 Key → 仍 unconfigured（引导去配置）',
  (await parseTasks({ text: sentence, settings: settings({ ai_provider: 'openai' }), lists, calib: [] })).status, 'unconfigured');
check('未配置 → unconfigured（降级，约束 3）',
  (await parseTasks({ text: sentence, settings: settings(), lists, calib: [] })).status, 'unconfigured');
check('返回体缺 tasks → validation',
  (await parseTasks({ text: sentence, settings: settings(), lists, calib: [], engine: 'fake',
    fake: () => ({ wrong: true }) })).status, 'validation');

const clar = await parseTasks({
  text: '尽快完成上线', settings: settings(), lists, calib: [], engine: 'fake',
  fake: () => ({
    tasks: [{ title: '完成上线', _field_provenance: { title: { confidence: 0.9, span: [0, 4] } } }],
    clarify_questions: [{ id: 'q1', text: '「尽快」是本周还是下周？', options: ['本周', '下周'], default: 0 }],
  }),
});
check('歧义产出澄清问题', clar.clarifies.map((c) => c.id), ['q1']);
check('未编造 due（约束 4）', clar.tasks.every((t) => t.due_date === null), true);

const low = await parseTasks({
  text: '周三前做完', settings: settings(), lists, calib: [], engine: 'fake',
  fake: () => ({
    tasks: [{ title: '做完', due: { date: 'not-a-date', raw_text: '周三前' },
      _field_provenance: { title: { confidence: 0.9, span: [0, 3] }, due: { confidence: 0.3, span: [0, 4] } } }],
  }),
});
check('坏日期不落 due_date', low.tasks[0].due_date, null);
check('保留 due 原文供高亮', low.tasks[0].raw_due, '周三前');
check('低置信可见', low.tasks[0].prov.due?.confidence, 0.3);

check('澄清确认透传后仍成功', (await parseTasks({
  text: '尽快完成上线', settings: settings(), lists, calib: [], engine: 'fake',
  extra: '尽快 → 本周', fake: () => ({ tasks: [{ title: '完成上线' }] }),
})).status, 'ok');

console.log('\n--- 估时校准（供功能一/二/三注入） ---');
const mk = (id: string, list_id: string, est: number): Task => ({
  id, list_id, title: id, notes: '', est_pomodoros: est, due_date: null, due_time: null, url: '',
  urgent: 0, repeat: 'none', lead_remind: 'none', tags: [], flag: 0, priority: 'none',
  reminded_at: null, completed: 1, completed_at: 1, sort_order: 0, created_at: 1, updated_at: 1,
  actual_minutes: null, parent_id: null,
});
const rec = (task_id: string, min: number, at: number): FocusRecord => ({
  id: `r${at}`, task_id, list_id: null, start_at: at, end_at: at + min * 60000,
  duration_min: min, phase: 'focus', created_at: at,
});
// est_pomodoros 是番茄数：1 番茄 × 25 分钟 = 25 分钟估算；实际 50 分钟 → factor 2
const t5 = [1, 2, 3, 4, 5].map((n) => mk(`t${n}`, 'l1', 1));
const r5 = [1, 2, 3, 4, 5].map((n) => rec(`t${n}`, n === 4 ? 500 : 50, n * 86400000));
const calib = calibrationSummary(t5, r5, 25);
check('有样本才产出', calib.length, 1);
check('MAD 剔除离群 → factor 2', calib[0].factor, 2);
check('样本计数', calib[0].samples, 5);
check('按 (list,tag) 取因子', factorFor(calib, 'l1', null), 2);
check('无历史 → 1.0', factorFor(calib, 'nope', null), 1);
ok('注入 prompt 含 factor 行', calibPromptLine(calib).includes('2×'));
check('样本<3 不产出', calibrationSummary([mk('s1', 'l9', 1)], [rec('s1', 50, 1)], 25), []);

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);