// 功能三：确定性装箱（docs/05-modules/ai.md）
// 每日计划里 LLM 只排序/triage + 给理由；真正把任务装进时间块的是这套纯函数：
//   容量 = 可用分钟 × 0.82（18% 缓冲）；同项目聚块；单块 ≤ 专注上限；拒绝超载。
// 离线可用、可测、可推演 —— 绝不把时间算术交给 LLM。

export interface PlanEntry {
  id: string;
  title: string;
  list_name: string | null;
  est_min: number | null;        // 预计分钟；null/0 → 默认 25
  priority: string;              // 'none'|'low'|'medium'|'high'
  due_date: string | null;       // 'YYYY-MM-DD'
  reason?: string;               // LLM 给的一句话理由
}

export interface PlanItem {
  id: string;
  title: string;
  list_name: string | null;
  est_min: number;
  reason: string;
}

export interface PlanBlock {
  project: string;               // 清单名（同项目聚块）
  items: PlanItem[];
}

export interface ConflictInfo {
  overrun_min: number;           // 超出容量的必须项总时长
  note: string;                  // i18n 提示（前端再包一层说明）
}

export interface FitResult {
  blocks: PlanBlock[];
  deferred: PlanItem[];          // 容量不足被推迟
  used_min: number;
  capacity_min: number;
  conflict: ConflictInfo | null;
}

/** 默认每日可用专注分钟（8 小时工作窗；再 ×0.82 为装箱容量）。 */
export const DEFAULT_AVAILABLE_MIN = 480;
/** 单块专注上限（超出建议拆两段）。 */
export const FOCUS_BLOCK_MIN = 90;

function blockMin(b: PlanBlock): number {
  return b.items.reduce((s, i) => s + i.est_min, 0);
}

/**
 * 确定性装箱。
 * entries 须已按「优先级 ↑ 再按截止日 ↑」排好序（plan.ts 负责）；本函数只做
 * 容量约束 + 同项目聚块 + 单块上限，不重新排序。
 */
export function fitBlocks(entries: PlanEntry[], availableMin: number, focusCapMin = FOCUS_BLOCK_MIN): FitResult {
  const capacity = Math.max(0, Math.round(availableMin * 0.82));
  const sized: PlanItem[] = entries.map((e) => {
    const est = e.est_min && e.est_min > 0 ? Math.round(e.est_min) : 25;
    return { id: e.id, title: e.title, list_name: e.list_name, est_min: est, reason: e.reason ?? '' };
  });

  const blocks: PlanBlock[] = [];
  const deferred: PlanItem[] = [];
  let used = 0;
  let cur: PlanBlock | null = null;

  for (const it of sized) {
    if (used + it.est_min > capacity) { deferred.push(it); continue; }
    cur = cur
      ? (cur.project === it.list_name && blockMin(cur) + it.est_min <= focusCapMin ? cur : null)
      : null;
    if (!cur) { cur = { project: it.list_name ?? '', items: [] }; blocks.push(cur); }
    cur.items.push(it);
    used += it.est_min;
  }

  return { blocks, deferred, used_min: used, capacity_min: capacity, conflict: null };
}