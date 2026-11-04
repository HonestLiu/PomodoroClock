import { create } from 'zustand';
import { api, subscribe } from '@/api';
import { useDataStore } from './dataStore';
import { useStatsStore } from './statsStore';
import { useTimerStore } from './timerStore';
import { acceptQuest, activeAttempt, addLifeGoal, bindingFor, completeQuest, initialQuests, isQuestBinding, localDay, publishQuests, stageQuestFocus, type QuestData, type QuestSession, type QuestStepDraft } from '@/lib/quests/model';

interface QuestState {
  data: QuestData;
  ready: boolean;
  busy: boolean;
  error: string;
  refresh(): Promise<void>;
  addGoal(title: string, description: string, budget: number, steps: QuestStepDraft[]): Promise<void>;
  accept(id: string): Promise<void>;
  complete(attemptId: string): Promise<void>;
  pauseGoal(id: string, paused: boolean): Promise<void>;
  stage(binding: string, session: QuestSession): Promise<void>;
  startFocus(attemptId: string): Promise<void>;
}
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run); queue = result.catch(() => {}); return result;
}
function ordinaryBudget(): number {
  const day = localDay(Date.now());
  const { tasks } = useDataStore.getState();
  const len = useTimerStore.getState().settings.focus_len_min;
  return tasks.filter(t => t.completed === 0 && t.due_date && t.due_date <= day).reduce((n, t) => n + Math.max(0, t.est_pomodoros * len), 0);
}
async function transact(change: (data: QuestData, now: number) => void): Promise<void> {
  return serial(async () => {
    useQuestStore.setState({ busy: true, error: '' });
    try {
      for (let retry = 0; retry < 4; retry++) {
        const before = await api.quest_load();
        const next = structuredClone(before);
        const now = Date.now();
        publishQuests(next, now, ordinaryBudget());
        change(next, now);
        if (JSON.stringify(before) === JSON.stringify(next)) { useQuestStore.setState({ data: next, ready: true }); return; }
        next.revision = before.revision + 1;
        try {
          const saved = await api.quest_commit(before.revision, next);
          useQuestStore.setState({ data: saved, ready: true });
          return;
        } catch (error) {
          if (String(error).includes('quest.conflict') && retry < 3) continue;
          throw error;
        }
      }
    } catch (error) {
      useQuestStore.setState({ error: String(error).replace(/^Error: /, '') });
      throw error;
    } finally { useQuestStore.setState({ busy: false }); }
  });
}
export const useQuestStore = create<QuestState>(() => ({
  data: initialQuests(), ready: false, busy: false, error: '',
  refresh: () => transact(() => {}),
  addGoal: (title, description, budget, steps) => {
    const id = crypto.randomUUID();
    return transact((data, now) => {
      addLifeGoal(data, { id, title: title.trim(), description: description.trim(), budget, paused: false, createdAt: now }, steps);
      publishQuests(data, now, ordinaryBudget());
    });
  },
  accept: id => {
    const attemptId = crypto.randomUUID();
    return transact((data, now) => acceptQuest(data, id, attemptId, now));
  },
  complete: async attemptId => {
    // Flush any currently running focus segment before atomically archiving this attempt.
    await useTimerStore.getState().finishQuestSession(bindingFor(attemptId));
    await transact((data, now) => completeQuest(data, attemptId, now));
    await useDataStore.getState().reload();
    await useStatsStore.getState().refresh();
  },
  pauseGoal: (id, paused) => transact(data => {
    const goal = data.goals.find(g => g.id === id);
    if (goal) goal.paused = paused;
    // Accepted quests remain valid for the day; pausing stops future acceptance/publication.
  }),
  stage: (binding, session) => transact((data, now) => stageQuestFocus(data, binding, session, now)),
  startFocus: async attemptId => {
    await useQuestStore.getState().refresh();
    const binding = bindingFor(attemptId);
    if (!activeAttempt(useQuestStore.getState().data, binding, Date.now())) throw new Error('quest.expired');
    const timer = useTimerStore.getState();
    if (timer.settling) throw new Error('quest.timerBusy');
    if (timer.state.task_id === binding && timer.state.phase === 'focus') {
      timer.openScreen(true); if (!timer.state.running) timer.resume(); return;
    }
    if (timer.state.running || timer.state.start_at !== null) throw new Error('quest.timerBusy');
    timer.reset(); timer.setTask(binding); timer.start();
  },
}));

/** Startup, wake and date changes share one idempotent publisher; no model calls on ticks. */
export function installQuestPublisher(): () => void {
  const run = () => { void useQuestStore.getState().refresh().catch(() => {}); };
  run();
  const handle = setInterval(run, 15_000);
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', run);
  const off = subscribe('data://changed', payload => {
    const table = (payload as { table?: string })?.table;
    if (table === 'quests' || table === 'all') run();
  });
  return () => { clearInterval(handle); off(); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', run); };
}
export function questTitle(binding: string | null): string | undefined {
  if (!isQuestBinding(binding)) return undefined;
  const data = useQuestStore.getState().data;
  const a = data.attempts.find(a => bindingFor(a.id) === binding);
  return data.quests.find(q => q.id === a?.questId)?.title;
}
