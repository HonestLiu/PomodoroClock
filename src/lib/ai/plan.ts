// 功能三：AI 每日计划（docs/05-modules/ai.md）
// 规则优先、LLM 只做排序/triage + 给理由；装箱用确定性 timebox.ts。
//   ① 确定性过滤：must = 有截止且 ≤ 今+2 天；其余进 should 池。
//   ② LLM：对 must+should 给出建议执行顺序 + 每项一句 reason（不把时间算术交给 LLM）。
//   ③ 确定性装箱：容量 = 可用 × 0.82；同项目聚块；单块 ≤ 90；超载给冲突提示、不硬塞。
// 降级：LLM 未配置/失败 → 按 优先级→截止 的确定性排序（无 reason，degraded=true）。

import type { FocusRecord, Settings, Task, TaskList } from '@/types';
import { runStructuredLLM, timeContext, aiConfig, isAiConfigured, type AiEngine } from './providers';
import { calibPromptLine, type CalibFactor } from './calib';
import { fitBlocks, DEFAULT_AVAILABLE_MIN, type PlanBlock, type PlanEntry } from './timebox';
import { addDays, toDateKey } from '@/lib/date';

export interface PlanDeferred { id: string; title: string; est_min: number; reason: string; }
export interface PlanConflict { overrun_min: number; }

export interface PlanOutcome {
  status: 'ok' | 'validation' | 'timeout' | 'error' | 'unconfigured' | 'empty';
  dateKey: string;               // 计划针对的本地日期
  blocks: PlanBlock[];
  deferred: PlanDeferred[];
  conflict: PlanConflict | null;
  degraded: boolean;             // true = 确定性排序（LLM 没参与）
  used_min: number;
  capacity_min: number;
  message?: string;              // i18n key（如 'planner.empty'）
  hint?: string;                 // 可行动短句
}

const PRIO_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };
const MUST_WINDOW_DAYS = 2;      // 有截止且今+N 天内 → must

/** 确定性排序：高优先级在前，同级按截止早在前，同截止按项目收拢。 */
function sortDeterministic(entries: PlanEntry[], todayKey: string): PlanEntry[] {
  return [...entries].sort((a, b) => {
    const pa = PRIO_RANK[a.priority] ?? 0;
    const pb = PRIO_RANK[b.priority] ?? 0;
    if (pa !== pb) return pb - pa;
    const da = a.due_date && a.due_date >= todayKey ? a.due_date : '9999-99-99';
    const db = b.due_date && b.due_date >= todayKey ? b.due_date : '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return String(a.list_name ?? '').localeCompare(String(b.list_name ?? ''));
  });
}

interface RawPlanItem { id?: unknown; reason?: unknown; }
const SHAPE = { plan: 'array' } as const;

export async function buildDailyPlan(dep: {
  tasks: Task[];
  records: FocusRecord[];
  lists: TaskList[];
  settings: Settings;
  calib: CalibFactor[];
  engine?: AiEngine;
  fake?: (ids: string[]) => unknown;
  dateRef?: Date;
  availableMin?: number;
}): Promise<PlanOutcome> {
  const dateRef = dep.dateRef ?? new Date();
  const dateKey = toDateKey(dateRef);
  const focusLen = dep.settings.focus_len_min || 25;

  const listNameFor = (id: string | null): string | null =>
    dep.lists.find((l) => l.id === id)?.name ?? null;

  const incomplete = dep.tasks.filter((t) => !t.completed);
  if (!incomplete.length) {
    return { status: 'empty', dateKey, blocks: [], deferred: [], conflict: null, degraded: false, used_min: 0, capacity_min: 0, message: 'planner.empty' };
  }

  const mustBorder = toDateKey(addDays(dateRef, MUST_WINDOW_DAYS));
  const entries: PlanEntry[] = incomplete.map((t) => ({
    id: t.id,
    title: t.title,
    list_name: listNameFor(t.list_id),
    est_min: t.est_pomodoros && t.est_pomodoros > 0 ? Math.round(t.est_pomodoros * focusLen) : null,
    priority: t.priority,
    due_date: t.due_date,
  }));
  const mustSet = new Set(entries.filter((e) => e.due_date && e.due_date <= mustBorder).map((e) => e.id));

  // ① 确定性过滤
  const must = entries.filter((e) => mustSet.has(e.id));
  const shouldPool = entries.filter((e) => !mustSet.has(e.id));

  // ② LLM triage（可选增强）：给顺序 + reason；失败/未配置 → 确定性排序降级。
  const cfg = aiConfig(dep.settings);
  const engine = dep.engine ?? 'auto';
  const useLLM = isAiConfigured(cfg) || engine === 'fake';
  let degraded = !useLLM;

  if (useLLM) {
    const lines = entries
      .map((e) => `${e.id}|${e.title}|清单:${e.list_name ?? '无'}|优先级:${e.priority}|截止:${e.due_date ?? '无'}|估分:${e.est_min ?? '无'}`)
      .join('\n');
    const system = [
      '你是每日计划助手。你只负责把任务排成建议执行顺序并各给一句理由，绝不计算时间、绝不编造截止。',
      '输出纯 JSON：{ "plan": [ { "id": "<任务id>", "reason": "一句话理由" } ] }，数组顺序=建议执行顺序。',
      `今天=${dateKey}，可用专注 ${dep.availableMin ?? DEFAULT_AVAILABLE_MIN} 分钟（含 18% 缓冲）。`,
      '原则：截止近的先做；高优先级插前；同一项目尽量连着做；理由 ≤ 30 字。',
    ].join('\n');
    const user = [
      timeContext(),
      calibPromptLine(dep.calib) && `\n${calibPromptLine(dep.calib)}`,
      '\n待排任务：',
      lines,
    ].filter(Boolean).join('\n');

    const res = await runStructuredLLM<{ plan?: RawPlanItem[] }>(
      cfg, engine, { system, user }, SHAPE,
      { fakeData: () => dep.fake?.(entries.map((e) => e.id)) ?? { plan: entries.map((e, i) => ({ id: e.id, reason: `理由 ${i + 1}` })) } },
    );
    if (res.status === 'ok' && Array.isArray(res.data.plan)) {
      const byId = new Map(entries.map((e) => [e.id, e]));
      const ordered: PlanEntry[] = [];
      for (const r of res.data.plan) {
        const id = String(r?.id ?? '');
        const en = byId.get(id);
        if (!en || ordered.some((x) => x.id === id)) continue;
        ordered.push({ ...en, reason: typeof r?.reason === 'string' ? r.reason : '' });
      }
      for (const e of entries) if (!ordered.some((x) => x.id === e.id)) ordered.push(e); // 补遗漏
      if (ordered.length) return finalize(ordered, dep.availableMin, mustSet, dateKey);
    }
    // LLM 返回不合法 → 静默降级为确定性排序
    degraded = true;
    if (res.status === 'error') { /* fallthrough */ }
  }

  const ordered = sortDeterministic([...must, ...shouldPool], dateKey);
  const out = finalize(ordered, dep.availableMin, mustSet, dateKey);
  return { ...out, degraded };
}

// interface RawPlanBlockMin removed

function finalize(
  ordered: PlanEntry[],
  availableMin: number | undefined,
  mustSet: Set<string>,
  dateKey: string,
): PlanOutcome {
  const fit = fitBlocks(ordered, availableMin ?? DEFAULT_AVAILABLE_MIN);
  // 必须项被推迟 → 超载冲突（宁少勿多，不硬塞）
  const mustDeferred = fit.deferred.filter((d) => mustSet.has(d.id));
  const conflict = mustDeferred.length
    ? { overrun_min: mustDeferred.reduce((s, d) => s + d.est_min, 0) }
    : null;
  return {
    status: 'ok',
    dateKey,
    blocks: fit.blocks,
    deferred: fit.deferred.map((d) => ({ id: d.id, title: d.title, est_min: d.est_min, reason: d.reason })),
    conflict,
    degraded: false,
    used_min: fit.used_min,
    capacity_min: fit.capacity_min,
  };
}