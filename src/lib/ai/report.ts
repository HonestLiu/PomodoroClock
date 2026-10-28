// 功能四：AI 日报 / 周报（docs/05-modules/ai.md）
// 数据聚合全部确定性计算（SQLite/内存），LLM 只负责「叙述 + 归因」，绝不数数。
// 五段式：完成情况 / 偏差分析 / 工时校准 / 风险预警 / 下阶段建议。
// 周期无数据 → 空态，不调 LLM；LLM 挂了 → 用聚合数据生成确定性段落（degraded=true）。
// 报表为只读展示（不入 tasks），天然不需要回滚。

import type { FocusRecord, Settings, Task, TaskList } from '@/types';
import { runStructuredLLM, timeContext, aiConfig, isAiConfigured, type AiEngine } from './providers';
import { calibPromptLine, type CalibFactor } from './calib';
import { addDays, startOfDay, startOfWeek, toDateKey } from '@/lib/date';

export type ReportWhat = 'day' | 'week';

export interface ReportSection { title: string; body: string; }
export interface NailTask { title: string; delay_days: number; }
export interface RiskItem { title: string; due_date: string; days_left: number; }
export interface TopProject { name: string; minutes: number; percent: number; }

export interface ReportOutcome {
  status: 'ok' | 'validation' | 'timeout' | 'error' | 'unconfigured' | 'empty';
  what: ReportWhat;
  periodLabel: string;
  message?: string;             // i18n key（如 'report.empty'）
  // —— 确定性聚合（不靠 LLM）——
  total_min: number;
  focus_days: number;
  done_tasks: number;
  open_tasks: number;
  completion_rate: number;      // 0..100
  delay_count: number;
  nail_tasks: NailTask[];
  calib_factors: CalibFactor[];
  upcoming_risk: RiskItem[];
  top_projects: TopProject[];
  sections: ReportSection[];
  next_steps: string[];
  degraded: boolean;            // true = 纯确定性段落（LLM 没参与）
  hint?: string;
}

interface RawReport { sections?: unknown; next_steps?: unknown; }
const SHAPE = { sections: 'array' } as const;

function cn(s: unknown): string {
  return typeof s === 'string' && s.trim() ? s.trim() : '';
}

function diffDays(a: string, b: string): number {
  return Math.round((parseDateTs(a) - parseDateTs(b)) / 86400000);
}
function parseDateTs(key: string): number { return new Date(key + 'T00:00:00').getTime(); }

export async function buildReport(dep: {
  tasks: Task[];
  records: FocusRecord[];
  lists: TaskList[];
  settings: Settings;
  calib: CalibFactor[];
  engine?: AiEngine;
  fake?: (what: ReportWhat) => unknown;
  what?: ReportWhat;
  now?: Date;
}): Promise<ReportOutcome> {
  const what = dep.what ?? 'day';
  const now = dep.now ?? new Date();

  // 周期窗口
  const start = what === 'day' ? startOfDay(now).getTime() : startOfWeek(now).getTime();
  const periodLabel = what === 'day' ? toDateKey(now) : `本周（${toDateKey(startOfWeek(now))} 起）`;

  const inPeriod = dep.records.filter((r) => r.start_at >= start && r.start_at < start + 86400000 * 7);
  const total_min = inPeriod.reduce((s, r) => s + r.duration_min, 0);
  const focusDays = new Set(inPeriod.map((r) => toDateKey(new Date(r.start_at)))).size;

  // 清单名
  const listName = (listId: string | null): string => dep.lists.find((l) => l.id === listId)?.name ?? '未指定清单';
  const projectName = (taskId: string | null): string => {
    if (!taskId) return '未指定任务';
    const t = dep.tasks.find((x) => x.id === taskId);
    return listName(t?.list_id ?? null);
  };

  // 各项目时长（确定性）
  const projMin = new Map<string, number>();
  for (const r of inPeriod) projMin.set(projectName(r.task_id), (projMin.get(projectName(r.task_id)) ?? 0) + r.duration_min);
  const top_projects: TopProject[] = [...projMin.entries()]
    .map(([name, minutes]) => ({ name, minutes, percent: total_min ? Math.round((minutes / total_min) * 100) : 0 }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);

  // 周期内完成的任务 + 逾期
  const doneTasks = dep.tasks.filter((t) => t.completed && t.completed_at != null && t.completed_at >= start);
  const done_tasks = doneTasks.length;
  const todayKey = toDateKey(now);
  const nail_tasks: NailTask[] = [];
  for (const t of doneTasks) {
    if (!t.due_date) continue;
    const doneKey = toDateKey(new Date(t.completed_at!));
    const d = diffDays(doneKey, t.due_date);
    if (d > 0) nail_tasks.push({ title: t.title, delay_days: d });
  }
  nail_tasks.sort((a, b) => b.delay_days - a.delay_days);
  const delay_count = nail_tasks.length;

  const openTasks = dep.tasks.filter((t) => !t.completed);
  const open_tasks = openTasks.length;
  const completion_rate = done_tasks + open_tasks
    ? Math.round((done_tasks / (done_tasks + open_tasks)) * 100)
    : 0;

  // 未来 1 周临期未完成
  const horizon = addDays(now, 7);
  const hKey = toDateKey(horizon);
  const upcoming_risk: RiskItem[] = openTasks
    .filter((t) => t.due_date && t.due_date >= todayKey && t.due_date <= hKey)
    .map((t) => ({ title: t.title, due_date: t.due_date!, days_left: diffDays(t.due_date!, todayKey) }))
    .sort((a, b) => a.days_left - b.days_left)
    .slice(0, 8);

  // 无数据 → 空态，不调 LLM
  if (!total_min && !done_tasks && !openTasks.length) {
    return { status: 'empty', what, periodLabel, total_min, focus_days: focusDays, done_tasks, open_tasks,
      completion_rate, delay_count, nail_tasks, calib_factors: dep.calib, upcoming_risk, top_projects,
      sections: [], next_steps: [], degraded: false, message: 'report.empty' };
  }

  // 默认确定性段落（LLM 挂了也能出一份完整报告）
  const summaryLine = `周期 ${periodLabel}：专注 ${total_min} 分钟（${focusDays} 天），完成任务 ${done_tasks} 项，当前待办 ${open_tasks} 项，完成率 ${completion_rate}%。`;
  const deviationBody = delay_count
    ? `有 ${delay_count} 项延期完成：` + nail_tasks.slice(0, 5).map((n) => `「${n.title}」晚 ${n.delay_days} 天`).join('、') + '。'
    : '本周期无延期完成的任务。';
  const calibBody = dep.calib.length
    ? dep.calib.map((c) => `${c.tag ? `标签「${c.tag}」` : '「任务」'} ${c.factor}×（${c.samples} 样本）`).join('；') + '。'
    : '样本不足 3 个，暂无工时校准。';
  const riskBody = upcoming_risk.length
    ? upcoming_risk.slice(0, 5).map((r) => `「${r.title}」剩 ${r.days_left} 天`).join('、') + '。'
    : '未来一周无临期任务。';
  const defaultNext = upcoming_risk.length
    ? [`优先处理「${upcoming_risk[0].title}」（剩 ${upcoming_risk[0].days_left} 天）`]
    : total_min
      ? ['保持当前节奏，注意休息与目标复盘']
      : ['本期无专注投入，先安排一个最小番茄试试'];
  const defaultSections: ReportSection[] = [
    { title: '完成情况', body: summaryLine },
    { title: '偏差分析', body: deviationBody + ' ' + (upcoming_risk.length ? '（临期项积压）' : '') },
    { title: '工时校准', body: calibBody },
    { title: '风险预警', body: riskBody },
    { title: '下阶段建议', body: defaultNext.map((s) => `· ${s}`).join('\n') },
  ];

  // ② LLM 叙述（可选增强）
  const cfg = aiConfig(dep.settings);
  const engine = dep.engine ?? 'auto';
  const useLLM = isAiConfigured(cfg) || engine === 'fake';
  let degraded = !useLLM;
  let sections = defaultSections;
  let nextSteps = defaultNext;

  if (useLLM) {
    const riskLine = upcoming_risk.length
      ? upcoming_risk.map((r) => `「${r.title}」${r.days_left} 天后到期`).join('；') : '无';
    const nailLine = nail_tasks.length
      ? nail_tasks.map((n) => `「${n.title}」延期 ${n.delay_days} 天`).join('；') : '无';
    const projLine = top_projects.map((p) => `${p.name}:${p.minutes}分(${p.percent}%)`).join('；') || '无';
    const system = [
      '你是专注复盘助手。下面是系统已算好的真实聚合数据，你只负责把它写成叙事并归因，绝不能改动或编造任何数字。',
      `输出五段式报告，每段 title + body（body 用中文、简洁、可读）。`,
      '然后给 ≤3 条下阶段建议（具体可执行，能直接作为建任务的一句话）。',
      '输出纯 JSON：{ "sections":[{"title":"完成情况","body":"…"},…五个], "next_steps":["…",…] }',
    ].join('\n');
    const user = [
      timeContext(),
      calibPromptLine(dep.calib) && `\n${calibPromptLine(dep.calib)}`,
      `\n周期：${periodLabel}`,
      `专注：${total_min} 分钟，${focusDays} 天`,
      `任务：完成 ${done_tasks} / 待办 ${open_tasks}，完成率 ${completion_rate}%`,
      `延期完成：${delay_count} 项（${nailLine}）`,
      `项目分布：${projLine}`,
      `未来一周风险：${riskLine}`,
    ].filter(Boolean).join('\n');

    const res = await runStructuredLLM<RawReport>(cfg, engine, { system, user }, SHAPE, {
      fakeData: () => dep.fake?.(what) ?? {
        sections: defaultSections.map((s) => ({ title: s.title, body: s.body + '（AI 润色）' })),
        next_steps: defaultNext,
      },
    });
    if (res.status === 'ok' && Array.isArray(res.data.sections)) {
      const parsed = (res.data.sections as Array<{ title?: unknown; body?: unknown }>)
        .map((s) => ({ title: cn(s?.title) || '—', body: cn(s?.body) || '' }))
        .filter((s) => s.body);
      if (parsed.length) {
        // 强制五段标题，正文用模型叙述
        const bodies = new Map(parsed.map((s) => [s.title, s.body]));
        const pick = (key: string, fallback: string) => {
          for (const [t, b] of bodies) if (t.includes(key)) return b;
          return fallback;
        };
        sections = [
          { title: '完成情况', body: pick('完成', defaultSections[0].body) },
          { title: '偏差分析', body: pick('偏差', defaultSections[1].body) },
          { title: '工时校准', body: pick('校准', defaultSections[2].body) },
          { title: '风险预警', body: pick('风险', defaultSections[3].body) },
          { title: '下阶段建议', body: pick('建议', defaultSections[4].body) },
        ];
      }
      if (Array.isArray(res.data.next_steps)) {
        const ns = (res.data.next_steps as unknown[]).map(String).map((s) => s.trim()).filter(Boolean);
        if (ns.length) nextSteps = ns.slice(0, 3);
      }
    } else {
      degraded = true;   // LLM 叙述失败 → 用确定性段落
    }
  }

  return {
    status: 'ok', what, periodLabel, total_min, focus_days: focusDays, done_tasks, open_tasks, completion_rate,
    delay_count, nail_tasks, calib_factors: dep.calib, upcoming_risk, top_projects,
    sections, next_steps: nextSteps, degraded,
  };
}