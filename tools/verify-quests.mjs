// Deterministic quest lifecycle and fixtures shared with SQLite integration tests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/quests/model.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Set, Map });
const q = exports;
const start = new Date(2026, 10, 1, 9).getTime();
const steps = [
  { key: 'a', title: '编译烧录', acceptance: '看到串口输出', minutes: 25, requires: [] },
  { key: 'b', title: '点亮 LED', acceptance: '灯成功点亮', minutes: 25, requires: ['a'] },
  { key: 'c', title: '按键控制', acceptance: '按键改变灯状态', minutes: 20, requires: ['b'] },
];
const goal = { id: 'test_goal', title: 'ESP32 项目', description: '开发板已准备，每天 40 分钟', budget: 40, paused: false, createdAt: start };
assert.throws(() => q.validateSteps([{ ...steps[0], requires: ['a'] }], 40));
assert.throws(() => q.validateSteps([{ ...steps[0], requires: ['missing'] }], 40));
assert.throws(() => q.validateSteps([{ ...steps[0], minutes: 41 }], 40));
assert.throws(() => q.validateSteps([steps[0], steps[0]], 40));
let data = q.initialQuests();
q.addLifeGoal(data, goal, steps);
q.publishQuests(data, start);
assert.equal(data.quests.filter(x => x.publishedDay).length, 1, 'only ready root is visible');
assert.equal(data.quests[1].publishedDay, null);
assert.throws(() => q.acceptQuest(data, 'test_goal_b', 'bad', start));
const snapshot = structuredClone(data);
q.acceptQuest(data, 'test_goal_a', 'attempt1', start);
assert.throws(() => q.acceptQuest(data, 'test_goal_a', 'duplicate', start));
const session = { id: 'session1', startAt: start, endAt: start + 20 * 60000, durationMin: 20 };
q.stageQuestFocus(data, q.bindingFor('attempt1'), session, session.endAt);
q.stageQuestFocus(data, q.bindingFor('attempt1'), session, session.endAt);
assert.equal(data.attempts[0].sessions.length, 1, 'focus retry deduplicates');
assert.equal(q.questBonuses(data).coins, 0, 'unfinished focus and tasks grant no rewards');
assert.equal(q.questArchives(snapshot, data).tasks.length, 0, 'accepted quests never create ordinary tasks');
assert.throws(() => q.stageQuestFocus(data, q.bindingFor('attempt1'), { ...session, id: 'overlap' }, session.endAt));
const tomorrow = q.nextMidnight(start) + 9 * 3600000;
q.publishQuests(data, tomorrow);
assert.equal(data.attempts[0].status, 'expired');
assert.equal(data.quests[0].publishedDay, q.localDay(tomorrow), 'expired root reoffers');
assert.equal(data.quests[1].publishedDay, null, 'expired focus never unlocks successor');
assert.throws(() => q.completeQuest(data, 'attempt1', tomorrow));
q.acceptQuest(data, 'test_goal_a', 'attempt2', tomorrow);
const session2 = { id: 'session2', startAt: tomorrow, endAt: tomorrow + 15 * 60000, durationMin: 15 };
q.stageQuestFocus(data, q.bindingFor('attempt2'), session2, session2.endAt);
const beforeDone = structuredClone(data);
q.completeQuest(data, 'attempt2', session2.endAt);
assert.throws(() => q.completeQuest(data, 'attempt2', session2.endAt));
const archive = q.questArchives(beforeDone, data);
assert.equal(archive.tasks.length, 1);
assert.equal(archive.records.length, 1);
assert.equal(archive.records[0].duration_min, 15, 'failed previous attempt is excluded');
assert.equal(q.questBonuses(data).coins, 3);
q.publishQuests(data, session2.endAt);
assert.equal(data.quests[1].publishedDay, null, 'remaining budget is respected');
q.publishQuests(data, q.nextMidnight(tomorrow) + 1);
assert.notEqual(data.quests[1].publishedDay, null, 'success unlocks next eligible publication');
assert.equal(data.quests[2].publishedDay, null);
const noSpace = q.initialQuests(); q.addLifeGoal(noSpace, goal, steps); q.publishQuests(noSpace, start, 30);
assert.equal(noSpace.quests.filter(x => x.publishedDay).length, 0, 'ordinary work uses daily capacity');
noSpace.goals[0].paused = true; q.publishQuests(noSpace, start);
assert.equal(noSpace.quests.filter(x => x.publishedDay).length, 0, 'paused goals do not publish');

// Durable transition fixture: create -> accept -> stage -> complete.
const fixtures = [];
let fixture = q.initialQuests();
function transition(now, change) {
  const next = structuredClone(fixture); change(next); next.revision++;
  fixtures.push({ now, expected: fixture.revision, next }); fixture = next;
}
transition(start, d => { q.addLifeGoal(d, goal, steps); q.publishQuests(d, start); });
transition(start, d => q.acceptQuest(d, 'test_goal_a', 'fixture_attempt', start));
transition(session.endAt, d => q.stageQuestFocus(d, q.bindingFor('fixture_attempt'), session, session.endAt));
transition(session.endAt, d => q.completeQuest(d, 'fixture_attempt', session.endAt));
writeFileSync(new URL('./fixtures/quests.json', import.meta.url), JSON.stringify(fixtures, null, 2) + '\n');
console.log('Quest lifecycle checks passed (dependencies, budgets, expiry, retries, staging, completion, rewards).');
