// 统计卡片 —— PRD FR-T2（4 卡）/ FR-R2（6 卡）
// 配色（截图事实 §3.1）：专注时长类数字红色，任务数类数字蓝色。
// 说明：label 由调用方传入（已按当前语言渲染）。

import { formatMinutes } from '@/lib/date';

export interface StatCardDef {
  label: string;
  value: string;
  tone: 'focus' | 'task';
  /** 次要指标（报表 6 卡用它补充「次数 / 日均 / 完成率」等派生口径） */
  sub?: string;
}

export function StatCards({ cards, six = false }: { cards: StatCardDef[]; six?: boolean }) {
  return (
    <div className={`stat-row${six ? ' six' : ''}`}>
      {cards.map((c) => (
        <div className="stat-card" key={c.label}>
          <span className="stat-label">{c.label}</span>
          <span className={`stat-value ${c.tone}`}>{c.value}</span>
          {c.sub && <span className="stat-sub">{c.sub}</span>}
        </div>
      ))}
    </div>
  );
}

export const minutesCard = (label: string, min: number): StatCardDef =>
  ({ label, value: formatMinutes(min), tone: 'focus' });

export const countCard = (label: string, n: number): StatCardDef =>
  ({ label, value: String(n), tone: 'task' });
