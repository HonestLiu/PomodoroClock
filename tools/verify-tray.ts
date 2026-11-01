import { strict as assert } from 'node:assert';
import { DEFAULT_SETTINGS, type Task, type TimerState } from '../src/types';
import { buildTrayMenu, canStartTrayTask, trayLabel } from '../src/lib/trayMenu';
import { handleTrayAction, installTrayController } from '../src/lib/trayController';
import { installWidgetController } from '../src/lib/widgetController';
import { useTimerStore } from '../src/stores/timerStore';
import { useDataStore } from '../src/stores/dataStore';
import { useUiStore } from '../src/stores/uiStore';
import { fixture, emit, tStatic, useNoiseStore, useI18nStore } from './fixtures/tray-runtime';

let checks = 0;
const test = async (label: string, run: () => void | Promise<void>) => { await run(); checks++; console.log(`PASS ${label}`); };
const MIN = 60000;
const clock = 1_800_000_000_000;
const originalNow = Date.now;
Date.now = () => clock;
const idle = (): TimerState => ({ phase: 'idle', mode: 'pomodoro', task_id: null, running: false, start_at: null, end_at: null, paused_remaining_ms: 25 * MIN });
const task = (id: string, title = id) => ({ id, title, completed: 0, due_date: null, due_time: null, sort_order: 0, created_at: 1 } as Task);
const running = (mode: TimerState['mode'] = 'pomodoro'): TimerState => ({ ...idle(), phase: 'focus', mode, running: true, start_at: clock - 5 * MIN, end_at: mode === 'stopwatch' ? null : clock + 20 * MIN, paused_remaining_ms: null });
const model = (state: TimerState, settling = false) => buildTrayMenu({ state, settings: DEFAULT_SETTINGS, now: clock, settling,
  taskTitle: 'Read', candidates: [task('a'), task('b')], todayMinutes: 80, todaySessions: 3, floatVisible: true, noisePlaying: false }, tStatic);
const drain = () => new Promise(resolve => setTimeout(resolve, 0));
async function reset(state: TimerState) {
  await drain(); fixture.records.length = 0; fixture.blockRecord = null; fixture.failRecord = false;
  useTimerStore.setState({ state, settings: { ...DEFAULT_SETTINGS }, screenOpen: false, settling: false, rustRemaining: null, now: clock });
  useDataStore.setState({ tasks: [task('a'), task('b')], records: [] });
  useUiStore.getState().closeAllOverlays();
}
try {
  await test('空闲：显示配置时长，可选择任务，不允许结束空会话', () => { const m = model(idle()); assert.equal(m.toggle, '开始专注 25分钟'); assert.equal(m.finishEnabled, false); assert.equal(m.taskMenuEnabled, true); });
  await test('专注运行：暂停/结束，禁止更换任务覆盖会话', () => { const m = model(running()); assert.equal(m.toggle, '暂停专注'); assert.equal(m.finish, '结束本次专注并保存'); assert.equal(m.finishEnabled, true); assert.equal(m.taskMenuEnabled, false); assert.match(m.status, /20:00/); });
  await test('暂停与待开始区分', () => { assert.equal(model({ ...running(), running: false, paused_remaining_ms: 20 * MIN }).toggle, '继续专注'); assert.equal(model({ ...idle(), phase: 'focus' }).toggle, '开始专注 25分钟'); });
  await test('休息操作明确、待开始休息仍可跳过进入专注', () => { const m = model({ ...idle(), phase: 'break', paused_remaining_ms: 5 * MIN }); assert.equal(m.toggle, '开始休息 5分钟'); assert.equal(m.finish, '结束休息并开始专注'); assert.equal(m.finishEnabled, true); });
  await test('倒计时不承诺保存专注记录', () => assert.equal(model(running('countdown')).finish, '结束倒计时'));
  await test('结算期间禁止冲突操作', () => { const m = model(running(), true); assert.equal(m.controlsEnabled, false); assert.equal(m.finishEnabled, false); assert.equal(canStartTrayTask(idle(), true), false); });
  await test('今日概况及开关状态准确', () => { const m = model(idle()); assert.match(m.today, /1小时20分钟/); assert.match(m.today, /3 次/); assert.equal(m.floatChecked, true); assert.equal(m.noiseChecked, false); });
  await test('长文本/换行/emoji 截断', () => { assert.equal(trayLabel('A\n B\tC'), 'A B C'); assert.equal(Array.from(trayLabel('🍅'.repeat(60))).length, 28); assert.equal(trayLabel('🍅'.repeat(60)).endsWith('…'), true); });
  await test('菜单语言跟随界面', () => { useI18nStore.getState().setLang('en'); assert.equal(model(running()).toggle, 'Pause focus'); useI18nStore.getState().setLang('zh'); });
  await reset(idle());
  await test('后台开始/暂停不展开专注面板', async () => { await handleTrayAction('tray-toggle'); assert.equal(useTimerStore.getState().state.running, true); assert.equal(useTimerStore.getState().screenOpen, false); await handleTrayAction('tray-toggle'); assert.equal(useTimerStore.getState().state.running, false); });
  await reset(idle());
  await test('选择真实待办后直接专注，过期菜单动作不能覆盖运行会话', async () => { await handleTrayAction('tray-task:a'); assert.equal(useTimerStore.getState().state.task_id, 'a'); assert.equal(useTimerStore.getState().state.running, true); await handleTrayAction('tray-task:b'); assert.equal(useTimerStore.getState().state.task_id, 'a'); assert.equal(useTimerStore.getState().screenOpen, false); });
  await reset(idle());
  await test('已删除或已完成的任务不可从旧菜单启动', async () => { await handleTrayAction('tray-task:missing'); useDataStore.setState({ tasks: [{ ...task('a'), completed: 1 }] }); await handleTrayAction('tray-task:a'); assert.equal(useTimerStore.getState().state.running, false); });
  await reset(running());
  await test('中途结束保存实际专注，不伪造满番茄', async () => { await handleTrayAction('tray-finish'); assert.equal(fixture.records.length, 1); assert.equal(fixture.records[0].duration_min, 5); assert.equal(useTimerStore.getState().state.phase, 'break'); assert.equal(useTimerStore.getState().state.running, false); });
  await reset({ ...running(), running: false, start_at: clock - 10 * MIN, end_at: clock + 15 * MIN, paused_remaining_ms: 20 * MIN });
  await test('暂停后结束专注不把暂停时间计入', async () => { await handleTrayAction('tray-finish'); assert.equal(fixture.records[0].duration_min, 5); });
  await reset({ ...running('stopwatch'), running: false, start_at: clock - 10 * MIN, paused_remaining_ms: 5 * MIN });
  await test('暂停正计时也能保存冻结的实际时长', async () => { await handleTrayAction('tray-finish'); assert.equal(fixture.records.length, 1); assert.equal(fixture.records[0].duration_min, 5); assert.equal(useTimerStore.getState().state.phase, 'idle'); });
  await reset(running('countdown'));
  await test('倒计时结束不写专注记录', async () => { await handleTrayAction('tray-finish'); assert.equal(fixture.records.length, 0); assert.equal(useTimerStore.getState().state.running, false); });
  await reset({ ...idle(), phase: 'break', paused_remaining_ms: 5 * MIN });
  await test('提前结束休息立即开始下一次专注，不产生休息记录', async () => { await handleTrayAction('tray-finish'); assert.equal(useTimerStore.getState().state.phase, 'focus'); assert.equal(useTimerStore.getState().state.running, true); assert.equal(fixture.records.length, 0); assert.equal(useTimerStore.getState().screenOpen, false); });
  await reset(running());
  await test('结算慢时快速重复点击/重置/换任务不会重复记账', async () => {
    let release!: () => void; fixture.blockRecord = new Promise<void>(resolve => { release = resolve; });
    const first = handleTrayAction('tray-finish');
    assert.equal(useTimerStore.getState().settling, true);
    useTimerStore.getState().reset(); useTimerStore.getState().setTask('b');
    await handleTrayAction('tray-finish'); assert.equal(useTimerStore.getState().state.task_id, null);
    release(); await first; assert.equal(fixture.records.length, 1); assert.equal(useTimerStore.getState().settling, false);
  });
  await reset(running('stopwatch'));
  await test('保存失败保留会话并释放锁，可重试', async () => { fixture.failRecord = true; await assert.rejects(handleTrayAction('tray-finish')); assert.equal(useTimerStore.getState().settling, false); assert.equal(useTimerStore.getState().state.phase, 'focus'); fixture.failRecord = false; await handleTrayAction('tray-finish'); assert.equal(fixture.records.length, 1); });
  await reset({ ...running(), start_at: clock - 25 * MIN, end_at: clock });
  await test('自动结束后不会卡在正在结算', async () => { await useTimerStore.getState().checkExpiry(); assert.equal(useTimerStore.getState().settling, false); assert.equal(fixture.records.length, 1); assert.equal(fixture.records[0].duration_min, 25); });
  await reset(idle());
  await test('导航能切出专注屏，显示目标页面', async () => { useTimerStore.getState().openScreen(true); await handleTrayAction('tray-report'); assert.equal(useTimerStore.getState().screenOpen, false); assert.equal(useUiStore.getState().reportOpen, true); await handleTrayAction('tray-today'); assert.equal(useUiStore.getState().route.name, 'today'); assert.equal(useUiStore.getState().reportOpen, false); });
  await test('浮窗与白噪音开关独立于计时', async () => { useUiStore.getState().setFloatVisible(true); await handleTrayAction('tray-float'); assert.equal(useUiStore.getState().floatVisible, false); await handleTrayAction('tray-noise'); assert.equal(useNoiseStore.getState().playing, true); });
  fixture.native = true;
  await reset(idle()); fixture.menus.length = 0;
  const uninstall = installTrayController(); await drain();
  await test('原生快照首次初始化，毫秒 tick 不重复发送', async () => { assert.equal(fixture.menus.length, 1); useTimerStore.setState({ now: clock + 250 }); await drain(); assert.equal(fixture.menus.length, 1); });
  await test('任务更新/语言变化实时同步菜单', async () => { useDataStore.setState({ tasks: [task('renamed', 'New title')] }); await drain(); assert.equal(fixture.menus.at(-1)?.snapshot.tasks[0].title, 'New title'); useI18nStore.getState().setLang('en'); await drain(); assert.equal(fixture.menus.at(-1)?.snapshot.quitLabel, 'Quit app'); });
  await test('原生勾选动作后强制校正，状态来自 store', async () => { emit('tray://menu', 'tray-noise'); await drain(); await drain(); assert.equal(fixture.menus.at(-1)?.force, true); assert.equal(fixture.menus.at(-1)?.snapshot.noiseChecked, false); });
  uninstall();
  await test('小组件冷启动请求在界面就绪后打开专注面板', async () => {
    useTimerStore.getState().openScreen(false); useUiStore.getState().openReport(true);
    fixture.widgetLaunch = true;
    const off = installWidgetController(); await drain();
    assert.equal(useTimerStore.getState().screenOpen, true); assert.equal(useUiStore.getState().reportOpen, false);
    off();
  });
  await test('小组件实时点击保留计时状态且消费请求一次', async () => {
    useTimerStore.getState().openScreen(false);
    const state = useTimerStore.getState().state;
    const off = installWidgetController(); await drain();
    fixture.widgetLaunch = true; emit('widget://open'); await drain();
    assert.equal(useTimerStore.getState().screenOpen, true); assert.equal(useTimerStore.getState().state, state);
    useTimerStore.getState().openScreen(false); emit('widget://open'); await drain();
    assert.equal(useTimerStore.getState().screenOpen, false); off();
  });
  await test('组件重新挂载不会丢失异步返回的启动请求', async () => {
    let release!: () => void;
    fixture.widgetLaunch = true; fixture.widgetResponse = new Promise<void>(resolve => { release = resolve; });
    const old = installWidgetController(); old();
    const next = installWidgetController(); release(); await drain();
    assert.equal(useTimerStore.getState().screenOpen, true); next(); fixture.widgetResponse = null;
  });
  fixture.native = false;
  console.log(`${checks} tray checks passed`);
} finally { Date.now = originalNow; }
