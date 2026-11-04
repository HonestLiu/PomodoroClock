import type { FocusRecord, Task } from '@/types';

export interface QuestStepDraft { key: string; title: string; acceptance: string; minutes: number; requires: string[] }
export interface LifeGoal { id: string; title: string; description: string; budget: number; paused: boolean; createdAt: number }
export interface Quest { id: string; goalId: string; title: string; acceptance: string; minutes: number; requires: string[]; coins: number; xp: number; completedAt: number | null; publishedDay: string | null; nextDay: string; order: number }
export interface QuestSession { id: string; startAt: number; endAt: number; durationMin: number }
export interface QuestAttempt { id: string; questId: string; day: string; acceptedAt: number; expiresAt: number; status: 'accepted' | 'expired' | 'completed'; sessions: QuestSession[] }
export interface QuestData { version: 1; revision: number; goals: LifeGoal[]; quests: Quest[]; attempts: QuestAttempt[] }
export const initialQuests = (): QuestData => ({ version: 1, revision: 0, goals: [], quests: [], attempts: [] });
export const ATTEMPT_PREFIX = 'quest-attempt:';
export const isQuestBinding = (id: string | null): boolean => !!id?.startsWith(ATTEMPT_PREFIX);
export const isQuestArchive = (id: string): boolean => id.startsWith('quest_archive_');
export const bindingFor = (id: string): string => ATTEMPT_PREFIX + id;
export const questArchiveId = (id: string): string => 'quest_archive_' + id;
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function nextMidnight(now: number): number { const d = new Date(now); d.setHours(24, 0, 0, 0); return d.getTime(); }
export const questReward = (minutes: number) => ({ coins: Math.min(10, Math.max(1, Math.ceil(minutes / 10))), xp: Math.min(100, Math.max(10, minutes * 2)) });
export function activeAttempt(data: QuestData, binding: string | null, now: number): QuestAttempt | undefined {
  return data.attempts.find(a => bindingFor(a.id) === binding && a.status === 'accepted' && a.acceptedAt <= now && now < a.expiresAt);
}
export function validateSteps(steps: QuestStepDraft[], budget: number): void {
  if (!Number.isInteger(budget) || budget < 5 || budget > 480 || !steps.length || steps.length > 30) throw new Error('quest.invalidPlan');
  const keys = new Set(steps.map(s => s.key));
  if (keys.size !== steps.length) throw new Error('quest.invalidPlan');
  const done = new Set<string>();
  const visit = (key: string, path: Set<string>) => {
    if (done.has(key)) return;
    if (path.has(key)) throw new Error('quest.invalidPlan');
    const step = steps.find(s => s.key === key);
    if (!step || !key || !step.title.trim() || step.title.length > 160 || !step.acceptance.trim() || step.acceptance.length > 1000 || !Number.isInteger(step.minutes) || step.minutes < 5 || step.minutes > budget || !Array.isArray(step.requires)) throw new Error('quest.invalidPlan');
    const next = new Set(path); next.add(key);
    step.requires.forEach(p => visit(p, next));
    done.add(key);
  };
  steps.forEach(s => visit(s.key, new Set()));
}
export function addLifeGoal(data: QuestData, goal: LifeGoal, steps: QuestStepDraft[]): void {
  validateSteps(steps, goal.budget);
  if (!goal.title.trim() || goal.title.length > 160 || goal.description.length > 3000 || data.goals.some(g => g.id === goal.id)) throw new Error('quest.invalidPlan');
  const ids = new Map(steps.map(s => [s.key, `${goal.id}_${s.key}`]));
  data.goals.push({ ...goal });
  steps.forEach((s, order) => data.quests.push({ id: ids.get(s.key)!, goalId: goal.id, title: s.title.trim(), acceptance: s.acceptance.trim(), minutes: s.minutes, requires: s.requires.map(k => ids.get(k)!), ...questReward(s.minutes), completedAt: null, publishedDay: null, nextDay: localDay(goal.createdAt), order }));
}
/** Reconcile before every read/action. Attempts expire by their fixed timestamp, not a mutable due date. */
export function publishQuests(data: QuestData, now: number, ordinaryMinutes = 0): void {
  const day = localDay(now);
  for (const a of data.attempts) if (a.status === 'accepted' && now >= a.expiresAt) a.status = 'expired';
  for (const q of data.quests) if (q.publishedDay && q.publishedDay < day && !q.completedAt) q.publishedDay = null;
  const availableGoals = data.goals.filter(g => !g.paused);
  let globalRemaining = Math.max(0, availableGoals.reduce((n, g) => n + g.budget, 0) - ordinaryMinutes);
  for (const goal of availableGoals) {
    const today = data.quests.filter(q => q.goalId === goal.id && q.publishedDay === day);
    let remaining = Math.min(globalRemaining, goal.budget) - today.reduce((n, q) => n + q.minutes, 0);
    globalRemaining -= today.reduce((n, q) => n + q.minutes, 0);
    let count = today.length;
    const candidates = data.quests.filter(q => q.goalId === goal.id && q.completedAt === null && q.publishedDay === null && q.nextDay <= day && !data.attempts.some(a => a.questId === q.id && a.status === 'accepted') && q.requires.every(id => data.quests.some(p => p.id === id && p.completedAt !== null))).sort((a, b) => a.nextDay.localeCompare(b.nextDay) || a.order - b.order);
    for (const q of candidates) {
      if (count >= 3 || q.minutes > remaining) continue;
      q.publishedDay = day; remaining -= q.minutes; globalRemaining -= q.minutes; count++;
    }
  }
}
export function acceptQuest(data: QuestData, questId: string, attemptId: string, now: number): void {
  const q = data.quests.find(q => q.id === questId);
  if (!q || q.completedAt !== null || q.publishedDay !== localDay(now) || data.goals.find(g => g.id === q.goalId)?.paused || data.attempts.some(a => a.questId === questId && (a.status === 'accepted' || a.status === 'completed'))) throw new Error('quest.unavailable');
  if (!q.requires.every(id => data.quests.some(p => p.id === id && p.completedAt !== null))) throw new Error('quest.unavailable');
  data.attempts.push({ id: attemptId, questId, day: localDay(now), acceptedAt: now, expiresAt: nextMidnight(now), status: 'accepted', sessions: [] });
}
export function stageQuestFocus(data: QuestData, binding: string, session: QuestSession, now: number): void {
  const a = activeAttempt(data, binding, now);
  if (!a) return; // Expired sessions never fall through into ordinary records.
  if (!Number.isFinite(session.durationMin) || session.durationMin <= 0 || session.startAt < a.acceptedAt || session.endAt > now || session.endAt <= session.startAt || session.endAt > a.expiresAt) throw new Error('quest.invalidSession');
  if (a.sessions.some(s => s.id === session.id)) return;
  if (a.sessions.some(s => session.startAt < s.endAt && session.endAt > s.startAt)) throw new Error('quest.invalidSession');
  const minutes = Math.floor(Math.min(session.durationMin, (session.endAt - session.startAt) / 60000));
  if (minutes < 1) return;
  a.sessions.push({ ...session, durationMin: minutes });
}
export function completeQuest(data: QuestData, attemptId: string, now: number): void {
  const a = activeAttempt(data, bindingFor(attemptId), now);
  if (!a) throw new Error('quest.expired');
  const q = data.quests.find(q => q.id === a.questId)!;
  if (q.completedAt !== null) throw new Error('quest.unavailable');
  a.status = 'completed'; q.completedAt = now;
}
export function questBonuses(data: QuestData): { coins: number; xp: number } {
  return data.quests.filter(q => q.completedAt !== null).reduce((n, q) => ({ coins: n.coins + q.coins, xp: n.xp + q.xp }), { coins: 0, xp: 0 });
}
/** Only newly successful attempts generate ordinary rows. Stable IDs make retries harmless. */
export function questArchives(before: QuestData, after: QuestData): { tasks: Task[]; records: FocusRecord[] } {
  const tasks: Task[] = [], records: FocusRecord[] = [];
  for (const a of after.attempts.filter(a => a.status === 'completed' && !before.attempts.some(p => p.id === a.id && p.status === 'completed'))) {
    const q = after.quests.find(q => q.id === a.questId)!;
    const at = q.completedAt!;
    const id = questArchiveId(q.id);
    tasks.push({ id, list_id: null, title: q.title, notes: q.acceptance, est_pomodoros: q.minutes / 25, due_date: a.day, due_time: null, url: '', urgent: 0, repeat: 'none', lead_remind: 'none', tags: [], flag: 0, priority: 'none', reminded_at: null, completed: 1, completed_at: at, actual_minutes: a.sessions.reduce((n, s) => n + s.durationMin, 0), parent_id: null, sort_order: 0, created_at: a.acceptedAt, updated_at: at });
    a.sessions.forEach(s => records.push({ id: `quest_focus_${s.id}`, task_id: id, list_id: null, start_at: s.startAt, end_at: s.endAt, duration_min: s.durationMin, phase: 'focus', created_at: at }));
  }
  return { tasks, records };
}

/** Persistence boundary validation: client delays may cross midnight after the reducer ran. */
export function validateQuestTransition(before: QuestData, after: QuestData, now: number): void {
  const invalid = () => { throw new Error('quest.invalidPlan'); };
  if (after.version !== 1 || after.revision !== before.revision + 1 || after.goals.length > 100 || after.quests.length > 3000) invalid();
  if (new Set(after.goals.map(g => g.id)).size !== after.goals.length || new Set(after.quests.map(q => q.id)).size !== after.quests.length || new Set(after.attempts.map(a => a.id)).size !== after.attempts.length) invalid();
  for (const g of after.goals) validateSteps(after.quests.filter(q => q.goalId === g.id).map(q => ({ key: q.id, title: q.title, acceptance: q.acceptance, minutes: q.minutes, requires: q.requires })), g.budget);
  for (const q of before.quests) {
    const next = after.quests.find(p => p.id === q.id);
    if (!next || next.title !== q.title || next.acceptance !== q.acceptance || next.minutes !== q.minutes || next.goalId !== q.goalId || JSON.stringify(next.requires) !== JSON.stringify(q.requires) || (q.completedAt !== null && next.completedAt !== q.completedAt)) invalid();
  }
  for (const q of after.quests) {
    const reward = questReward(q.minutes);
    if (q.coins !== reward.coins || q.xp !== reward.xp || !after.goals.some(g => g.id === q.goalId)) invalid();
    if (q.completedAt !== null && !after.attempts.some(a => a.questId === q.id && a.status === 'completed')) invalid();
  }
  for (const a of before.attempts) if (!after.attempts.some(n => n.id === a.id)) invalid();
  for (const a of after.attempts) {
    const q = after.quests.find(q => q.id === a.questId);
    const old = before.attempts.find(p => p.id === a.id);
    if (!q || !['accepted', 'expired', 'completed'].includes(a.status) || a.expiresAt <= a.acceptedAt) invalid();
    if (a.status === 'accepted' && after.attempts.filter(p => p.questId === a.questId && p.status === 'accepted').length !== 1) invalid();
    if (a.status === 'completed' && (q!.completedAt === null || after.attempts.filter(p => p.questId === a.questId && p.status === 'completed').length !== 1)) invalid();
    if (old) {
      if (a.questId !== old.questId || a.day !== old.day || a.acceptedAt !== old.acceptedAt || a.expiresAt !== old.expiresAt || (old.status !== 'accepted' && (old.status !== a.status || JSON.stringify(old.sessions) !== JSON.stringify(a.sessions))) || !old.sessions.every(s => a.sessions.some(n => JSON.stringify(s) === JSON.stringify(n)))) invalid();
      if (a.status === 'completed' && old.status !== 'completed') {
        if (now >= a.expiresAt || now < a.acceptedAt || q!.completedAt === null || q!.completedAt! < a.acceptedAt || q!.completedAt! >= a.expiresAt || q!.completedAt! > now + 1000 || !q!.requires.every(id => before.quests.some(p => p.id === id && p.completedAt !== null))) throw new Error('quest.expired');
      }
    } else if (a.status !== 'accepted' || now >= a.expiresAt || a.acceptedAt > now + 1000 || q!.completedAt !== null || q!.publishedDay !== a.day || !q!.requires.every(id => before.quests.some(p => p.id === id && p.completedAt !== null))) invalid();
    let end = a.acceptedAt;
    for (const s of [...a.sessions].sort((a, b) => a.startAt - b.startAt)) {
      if (s.startAt < end || s.endAt <= s.startAt || s.endAt > a.expiresAt || s.endAt > now + 1000 || !Number.isInteger(s.durationMin) || s.durationMin <= 0 || s.durationMin > (s.endAt - s.startAt) / 60000 + 0.0001) invalid();
      end = s.endAt;
    }
  }
}
