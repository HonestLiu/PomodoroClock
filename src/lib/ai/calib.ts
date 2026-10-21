// AI 估时校准（docs/05-modules/ai.md 功能四闭环 + 全局约束）
// M1/M2 实现为「派生计算」：直接从 tasks.est_pomodoros × focus_records 聚合出偏差因子，
// 双端一致、无需额外表（estimate_calib 表为 M5 的持久化样本预留）。
// 策略：按 项目(list_id) × 首个 tag 分组；滑动窗口最近 20 样本；MAD 剔除异常；样本<3 不产出。

import type { FocusRecord, Task } from '@/types';

export interface CalibFactor {
  listId: string | null;
  tag: string | null;
  factor: number;   // actual/est 的中位数（稳健）；>1 = 平时易低估耗时
  samples: number;
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** MAD（中位数绝对偏差），用于剔除离群样本；全等时返回 0（不剔除）。 */
function madFrom(a: number[], med: number): number {
  return median(a.map((x) => Math.abs(x - med)));
}

export function calibrationSummary(tasks: Task[], records: FocusRecord[], focusLenMin: number): CalibFactor[] {
  // 每个任务的实际专注分钟
  const actualByTask = new Map<string, number>();
  for (const r of records) {
    if (!r.task_id) continue;
    actualByTask.set(r.task_id, (actualByTask.get(r.task_id) ?? 0) + r.duration_min);
  }
  // 取样样本（有估算、有实际、按时间排）
  const samples: Array<{ key: string; listId: string | null; tag: string | null; factor: number; at: number }> = [];
  for (const t of tasks) {
    const actual = actualByTask.get(t.id);
    const estMin = t.est_pomodoros * focusLenMin;
    if (!actual || estMin <= 0) continue;
    const at = records
      .filter((r) => r.task_id === t.id)
      .reduce((m, r) => Math.max(m, r.start_at), 0);
    samples.push({ key: `${t.list_id ?? ''}::${t.tags?.[0] ?? ''}`, listId: t.list_id, tag: t.tags?.[0] ?? null, factor: actual / estMin, at });
  }
  samples.sort((a, b) => a.at - b.at); // 时间升序，便于滑动窗口取最近

  const byKey = new Map<string, typeof samples>();
  for (const s of samples) {
    const arr = byKey.get(s.key) ?? [];
    arr.push(s);
    byKey.set(s.key, arr);
  }

  const out: CalibFactor[] = [];
  for (const [, arr] of byKey) {
    const windowed = arr.slice(-20);                 // 滑动窗口：最近 20
    const factors = windowed.map((s) => s.factor);
    if (factors.length < 3) continue;                // 最少样本阈值
    const med = median(factors);
    const mad = madFrom(factors, med);
    const kept = mad > 0 ? factors.filter((f) => Math.abs(f - med) <= 3 * mad) : factors;
    const final = median(kept);
    out.push({
      listId: arr[arr.length - 1].listId,
      tag: arr[arr.length - 1].tag,
      factor: Math.round(final * 10) / 10,
      samples: factors.length,
    });
  }
  return out;
}

/** 取某个 (项目,标签) 的因子；没有则 1.0（无历史，走全局默认）。 */
export function factorFor(calib: CalibFactor[], listId: string | null, tag: string | null): number {
  return calib.find((c) => c.listId === listId && (c.tag ?? null) === (tag ?? null))?.factor
    ?? calib.find((c) => c.listId === listId && !c.tag)?.factor ?? 1.0;
}

/** 注入 prompt 的一行：该清单历史平均超估 ≈ factor。 */
export function calibPromptLine(calib: CalibFactor[]): string {
  if (!calib.length) return '';
  const rows = calib
    .map((c) => `${c.tag ? `标签「${c.tag}」` : '「任务」'}:${c.factor}×（${c.samples} 个样本）`)
    .join('；');
  return `[估时校准] 以下项目的实际耗时/估算耗时历史系数（factor>1 表示平时会低估、建议按 factor 放大估时）：${rows}`;
}