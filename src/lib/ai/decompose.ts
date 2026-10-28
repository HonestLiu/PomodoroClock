// 功能二：AI 任务拆解（docs/05-modules/ai.md）
// 目标 → 结构化输出**平铺的一层任务清单**（每项含 est_min + 验收标准）。
// 平台任务列表以平铺方式展示、不支持父子嵌套，因此不做多层树（避免上级/子任务视觉混杂）。
// 目标本身作为本次拆解所属的独立清单名（见 aiChatStore.adoptTree）。adopt 才落库。
// 降级：LLM 挂了 → 按连接词（和/以及/、/，/,/；）做确定性细分，仍可用。

import type { Settings, TaskList, TaskPriority } from '@/types';
import { runStructuredLLM, timeContext, aiConfig, isAiConfigured, type AiEngine } from './providers';
import { calibPromptLine, type CalibFactor } from './calib';

const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low', 'none'];

export interface DecomNode {
  id: string;                    // 树内临时 id（adopt 时映射为真实 task id）
  title: string;
  est_min: number | null;
  acceptance_criteria: string;   // 单句可验收；空 = 低置信
  notes?: string;                // 备注（AI 补充，可空）
  tags?: string[];               // 标签（AI 补充，可空）
  priority?: TaskPriority;       // 优先级（缺省 none）
  children: DecomNode[];         // 预留（当前恒为空数组：拆解输出平铺）
  depends_on: string[];
  low_conf: boolean;             // est 或验收缺失
}

export interface DecomposeOutcome {
  status: 'ok' | 'validation' | 'timeout' | 'error' | 'unconfigured' | 'no-goal';
  root: DecomNode | null;        // 根 = 目标；children = 平铺子任务
  critical_path: string;         // 可选的一句话整体提示（可为空）
  /** AI 给出的简短清单名（新建独立清单用）；不用原始提问句 */
  listName: string;
  degraded: boolean;             // true = LLM 未参与（确定性细分 / 单点）
  message?: string;              // i18n key
  hint?: string;                 // 可行动短句
}

interface RawTask {
  title?: unknown; est_min?: unknown; acceptance_criteria?: unknown;
  notes?: unknown; tags?: unknown; priority?: unknown;
}
/** LLM 返回的最外层包装：平铺任务数组 + 简短清单名 */
interface RawWrap { tasks?: unknown; critical_path_hint?: unknown; list_name?: unknown; }

const SHAPE = { tasks: 'array' } as const;

function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean).slice(0, 4);
}
function cleanPriority(raw: unknown): TaskPriority {
  return (PRIORITIES as string[]).includes(raw as string) ? (raw as TaskPriority) : 'none';
}

/** 把 LLM 的平铺任务数组固化为受控列表（无嵌套；est/验收缺失 = 低置信）。 */
function buildFlat(tasks: unknown, goalTitle: string): DecomNode {
  const arr = Array.isArray(tasks) ? tasks : [];
  const children: DecomNode[] = arr.map((raw, i) => {
    const r = (raw ?? {}) as RawTask;
    const estOk = typeof r.est_min === 'number';
    const acc = typeof r.acceptance_criteria === 'string' ? (r.acceptance_criteria as string).trim() : '';
    const rawTitle = typeof r.title === 'string' && (r.title as string).trim() ? (r.title as string).trim() : '';
    return {
      id: `d${i}`,
      title: rawTitle,
      est_min: estOk ? (r.est_min as number) : null,
      acceptance_criteria: acc,
      notes: typeof r.notes === 'string' ? (r.notes as string).trim() : '',
      tags: cleanTags(r.tags),
      priority: cleanPriority(r.priority),
      children: [],
      depends_on: [],
      low_conf: !estOk || !acc,
    };
  }).filter((n) => n.title);
  return {
    id: 'root', title: goalTitle, est_min: null, acceptance_criteria: '',
    notes: '', tags: [], priority: 'none', children, depends_on: [], low_conf: false,
  };
}

/** 降级时的清单名：去除引号并把原目标截短，仍避免用整句。 */
function fallbackListName(goal: string): string {
  const g = goal.trim().replace(/[「」"']/g, '').replace(/[，,、。;；]+/g, ' ').trim().slice(0, 12);
  return g || 'AI 拆解';
}

/** 确定性细分（LLM 挂了）：按连接词把目标切成并列子任务，est/验收留空（低置信）。 */
function fallbackDecompose(goal: string, rootId: string): DecomNode {
  const parts = goal.split(/以及|[和、，,；;|]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { id: rootId, title: goal, est_min: null, acceptance_criteria: '', notes: '', tags: [], priority: 'none', children: [], depends_on: [], low_conf: true };
  }
  return {
    id: rootId, title: goal, est_min: null, acceptance_criteria: '', notes: '', tags: [], priority: 'none',
    children: parts.map((p, i) => ({
      id: `d${i}`, title: p, est_min: null, acceptance_criteria: '', notes: '', tags: [], priority: 'none',
      children: [], depends_on: [], low_conf: true,
    })),
    depends_on: [], low_conf: true,
  };
}

export async function decomposeGoal(dep: {
  goal: string;
  settings: Settings;
  lists: TaskList[];
  calib: CalibFactor[];
  engine?: AiEngine;
  fake?: (goal: string) => unknown;
}): Promise<DecomposeOutcome> {
  const goal = dep.goal.trim();
  if (!goal) return { status: 'no-goal', root: null, critical_path: '', listName: 'AI 拆解', degraded: false, message: 'empty' };

  const cfg = aiConfig(dep.settings);
  const engine = dep.engine ?? 'auto';
  if (!isAiConfigured(cfg) && engine !== 'fake') {
    return { status: 'unconfigured', root: null, critical_path: '', listName: 'AI 拆解', degraded: false };
  }

  const listNames = dep.lists.map((l) => l.name).filter(Boolean).join('、') || '（无自定义清单）';
  const system = [
    '你是任务拆解专家。把一个目标拆成若干**平铺的、可独立执行**的子任务（最多 12 条），并充实每条任务的可编辑字段。',
    '规则：',
    '- 不要建父子层级，不要在一个任务下再挂子任务（平台以平铺列表展示，多层树会显示混乱）。所有拆解出来的都是同一层、可独立完成的子任务。',
    '- 首行给一个简短**清单名 list_name**（2～8 字），抽象概括该目标，作为后续新建独立清单的名称；不要照抄整句提问（例如目标句「做一套智能家居控制面板」→ list_name "智能家居"）。',
    '- 每条任务都要有：',
    '  · title（一行可执行）',
    '  · est_min（预计耗费的分钟数，可参考估时校准 factor 放大/缩小）',
    '  · acceptance_criteria（一句可验证的验收标准）',
    '  · notes（一句补充说明或背景备注，可空）',
    '  · tags（1～3 个简短标签的数组，方便分类筛选，可空）',
    '  · priority（high/medium/low/none，按重要/紧迫程度判断）',
    '- 宁少勿多：数量小于等于 12，拆到可直接动手即可，不必过细。',
    `- 清单名可从「${listNames}」中选择，其他留任务名即可。`,
    '只输出纯 JSON：{ "list_name":"简短清单名", "tasks":[{"title":"…","est_min":60,"acceptance_criteria":"可验证标准","notes":"备注","tags":["标签"],"priority":"high"}], "critical_path_hint":"一句整体提示（可空）" }',
  ].join('\n');

  const user = [
    timeContext(),
    calibPromptLine(dep.calib) && `\n${calibPromptLine(dep.calib)}`,
    '\n请拆解这个目标：',
    `「${goal}」`,
  ].filter(Boolean).join('\n');

  const res = await runStructuredLLM<RawWrap>(
    cfg, engine, { system, user }, SHAPE,
    {
      fakeData: () => dep.fake?.(goal) ?? {
        list_name: '智能家居',
        critical_path_hint: '先做 A，再做 B',
        tasks: [
          { title: '子任务 A', est_min: 200, acceptance_criteria: 'A 达标', notes: '准备电源与网关', tags: ['硬件'], priority: 'high' },
          { title: '子任务 B', est_min: 200, acceptance_criteria: 'B 达标', notes: '', tags: ['软件'], priority: 'medium' },
        ],
      },
    },
  );

  if (res.status !== 'ok') {
    const degradedRoot = fallbackDecompose(goal, 'r');   // 降级仍可用
    return {
      status: 'ok', root: degradedRoot, critical_path: '', listName: fallbackListName(goal), degraded: true,
      message: res.status === 'validation' ? 'err.ai.json' : res.status === 'error' ? res.message : '',
      hint: res.status === 'validation' ? res.errors.join('；')
        : res.status === 'error' ? (res.hint ?? '') : '',
    };
  }

  const critical_path = typeof res.data.critical_path_hint === 'string' ? res.data.critical_path_hint : '';
  const listName = typeof res.data.list_name === 'string' && res.data.list_name.trim()
    ? (res.data.list_name as string).trim().slice(0, 20)
    : fallbackListName(goal);
  const root = buildFlat(res.data.tasks, goal);
  // 若没拆出子任务：退化为单点 / 确定性细分。
  if (!root.children.length) {
    return { status: 'ok', root: fallbackDecompose(goal, 'r'), critical_path: '', listName, degraded: true };
  }
  return { status: 'ok', root, critical_path, listName, degraded: false };
}