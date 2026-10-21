// 功能一：自然语言创建任务（docs/05-modules/ai.md）
// 输入一句话 → 结构化解析为 1..N 个任务（含父子、每字段 confidence+span、歧义 clarify）。
// 输出永远是可编辑的预览态候选；adopt 才落库。

import type { Recurrence, Settings, TaskList, TaskPriority } from '@/types';
import type { AiClarify, AiFieldKey, AiProvenance, AiTaskCandidate } from '@/types';
import { runStructuredLLM, timeContext, aiConfig, isAiConfigured, type AiEngine } from './providers';
import { calibPromptLine, type CalibFactor } from './calib';

const FIELDS: AiFieldKey[] = ['title', 'project', 'due', 'est', 'priority', 'repeat'];

/** 单个任务候选的原始形态（LLM 返回，宽松） */
interface RawTask {
  title?: unknown;
  project?: unknown;
  due?: { date?: unknown; time?: unknown; raw_text?: unknown } | null;
  est_min?: unknown;
  slot_min?: unknown;
  priority?: unknown;
  repeat?: unknown;
  depends_on?: unknown;
  subtasks?: RawTask[];
  _field_provenance?: Partial<Record<AiFieldKey, { confidence?: unknown; span?: unknown }>>;
}
interface RawParse {
  tasks?: RawTask[];
  clarify_questions?: Array<{ id?: unknown; text?: unknown; options?: unknown; default?: unknown }>;
}

const CN: Record<string, TaskPriority> = { 高: 'high', 中: 'medium', 低: 'low' };

function normPriority(v: unknown): TaskPriority {
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (['high', 'medium', 'low', 'none'].includes(s)) return s as TaskPriority;
    if (CN[v]) return CN[v];
  }
  return 'none';
}

function normRepeat(v: unknown): Recurrence {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return (['none', 'hourly', 'daily', 'weekdays', 'weekends', 'weekly'] as const).includes(s as Recurrence)
    ? (s as Recurrence) : 'none';
}

function normDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function normTime(v: unknown): string | null {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null;
}

function provOf(raw: RawTask, field: AiFieldKey): { confidence: number; span: [number, number] } {
  const p = raw._field_provenance?.[field];
  const conf = typeof p?.confidence === 'number' ? p.confidence : 0;
  const sp = p?.span;
  const span: [number, number] = Array.isArray(sp) && sp.length === 2 && sp.every((n) => typeof n === 'number')
    ? [sp[0] as number, sp[1] as number] : [0, 0];
  return { confidence: conf, span };
}

function matchList(name: string, lists: TaskList[]): TaskList | null {
  const n = String(name ?? '').trim();
  if (!n) return null;
  const hit = lists.find((l) => l.name.toLowerCase() === n.toLowerCase());
  return hit ?? null;
}

/** 打平父子：父任务 + 每个子任务（parent_id=父临时 id）。 */
function flatten(raw: RawTask[], lists: TaskList[], rawText: string): AiTaskCandidate[] {
  const out: AiTaskCandidate[] = [];
  let n = 0;
  const push = (rt: RawTask, parent: string | null): string => {
    const id = `t${++n}`;
    const prov: AiProvenance = {};
    for (const f of FIELDS) prov[f] = provOf(rt, f);
    const due = rt.due && typeof rt.due === 'object' ? rt.due : {};
    const listName = typeof rt.project === 'string' ? rt.project : '';
    out.push({
      id,
      title: typeof rt.title === 'string' ? rt.title.trim() : '',
      list_name: listName,
      list_id: matchList(listName, lists)?.id ?? null,
      due_date: normDate(due.date),
      due_time: normTime(due.time),
      est_min: typeof rt.est_min === 'number' ? rt.est_min : null,
      priority: normPriority(rt.priority),
      repeat: normRepeat(rt.repeat),
      parent_id: parent,
      raw_due: typeof due.raw_text === 'string' ? due.raw_text : '',
      prov,
      raw: rawText,
    });
    const kids = Array.isArray(rt.subtasks) ? rt.subtasks : [];
    for (const k of kids) if (k && typeof k.title === 'string') push(k, id);
    return id;
  };
  for (const rt of raw) if (rt && typeof rt.title === 'string' && rt.title.trim()) push(rt, null);
  return out;
}

export interface ParseOutcome {
  status: 'ok' | 'validation' | 'timeout' | 'error' | 'unconfigured';
  tasks: AiTaskCandidate[];
  clarifies: AiClarify[];
  /** i18n key 或既有文案；UI 用 t() 出文案 */
  message?: string;
  /** 服务端短句 / 字段错误明细（可行动，非栈） */
  hint?: string;
}

const SHAPE = { tasks: 'array' } as const;

export async function parseTasks(dep: {
  text: string;
  settings: Settings;
  lists: TaskList[];
  calib: CalibFactor[];
  engine?: AiEngine;
  fake?: (text: string) => RawParse;
  /** 澄清确认后追加的用户注记（让模型按已确认口径重算） */
  extra?: string;
}): Promise<ParseOutcome> {
  const text = dep.text.trim();
  if (!text) return { status: 'validation', tasks: [], clarifies: [], message: 'empty' };
  const cfg = aiConfig(dep.settings);
  const engine = dep.engine ?? 'auto';

  if (!isAiConfigured(cfg) && engine !== 'fake') {
    return { status: 'unconfigured', tasks: [], clarifies: [] };
  }

  const listNames = dep.lists.map((l) => l.name).filter(Boolean).join('、') || '（无自定义清单）';
  const system = [
    '你是任务解析器。把用户的一句话解析成 1..N 个任务；一句里的多个任务都要拆开，父子/并列关系都要识别（父=目标任务，子=其子任务）。',
    '只提取原文明确或强推断的字段，其余留 null；置信度低于 0.6 的字段必须留空并降低其 confidence。',
    '时间必须转换成 ISO8601 日期（YYYY-MM-DD）与时间（HH:MM，24h），保留 raw_text 让用户知道你的理解；"今天/明天/下周/尽快"按下面注明的当前时间/时区解释，不要凭模型记忆猜。',
    '"尽快""优先做"→ 只给 priority=high，不要编造 due。',
    '歧义（如"下周到底指哪个""尽快是多快""周三前"）先在 clarify_questions 里给出选项，不要在任务上硬猜死 due。',
    'est_min 是总预计耗时（分钟）；子任务也各自给 est_min。',
    `项目(project)只能从放的清单里选：${listNames}；不匹配就留项目原名字符串，不要改名。`,
    '输出必须是纯 JSON，不要 markdown 代码块以外的任何文字。格式：',
    JSON.stringify({
      tasks: [{
        title: '示例', project: '某清单或null', due: { date: '2026-01-01', time: '18:00', raw_text: '原文片段' },
        est_min: 60, priority: 'high|medium|low|none', repeat: 'none|hourly|daily|weekdays|weekends|weekly',
        subtasks: [{ title: '子任务', est_min: 30 }],
        _field_provenance: { title: { confidence: 1, span: [0, 4] }, due: { confidence: 0.9, span: [5, 10] } },
      }],
      clarify_questions: [{ id: 'q1', text: '问题', options: ['A', 'B'], default: 0 }],
    }, null, 0),
  ].join('\n');

  const user = [
    timeContext(),
    calibPromptLine(dep.calib) && `\n${calibPromptLine(dep.calib)}`,
    '\n用户的输入：',
    `「${text}」`,
    dep.extra && `\n（已由用户确认：${dep.extra}，请按此解释）`,
  ].filter(Boolean).join('\n');

  const res = await runStructuredLLM<RawParse>(
    cfg, engine,
    { system, user },
    SHAPE,
    { fakeData: () => dep.fake?.(text) ?? rawFakeParse(text) },
  );

  if (res.status !== 'ok') {
    const message = res.status === 'validation' ? 'err.ai.json'
      : res.status === 'error' ? res.message : '';
    const hint = res.status === 'validation' ? res.errors.join('；')
      : res.status === 'error' ? (res.hint ?? '') : '';
    return {
      status: res.status === 'timeout' ? 'timeout' : res.status === 'validation' ? 'validation' : 'error',
      tasks: [], clarifies: [], message, hint,
    };
  }
  const raw = res.data;
  const tasks = flatten(Array.isArray(raw.tasks) ? raw.tasks : [], dep.lists, text);
  const clarifies: AiClarify[] = (Array.isArray(raw.clarify_questions) ? raw.clarify_questions : [])
    .filter((c) => c && typeof c.text === 'string')
    .map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `q${i + 1}`,
      text: c.text as string,
      options: Array.isArray(c.options) ? c.options.map(String) : [],
      default: typeof c.default === 'number' ? c.default : undefined,
    }));
  if (!tasks.length) return { status: 'validation', tasks: [], clarifies, message: 'no-tasks' };
  return { status: 'ok', tasks, clarifies };
}

/** 内置假实现：供 verify-ai.ts / 无网络演示；不联网。 */
export function rawFakeParse(text: string): RawParse {
  const base = text;
  return {
    tasks: [
      {
        title: '完成项目登录模块',
        est_min: 400,
        priority: 'high',
        project: null,
        due: { date: null, time: null, raw_text: '' },
        subtasks: [{ title: '先完成数据库设计', est_min: 90 }],
        _field_provenance: {
          title: { confidence: 0.95, span: [0, Math.min(8, base.length)] },
          due: { confidence: 0.3, span: [0, 0] },
        },
      },
      { title: '每天留一小时开发', est_min: 60, priority: 'medium', project: null, due: { date: null, time: null, raw_text: '' } },
    ],
    clarify_questions: [],
  };
}