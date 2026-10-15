// 专注时间详情 —— PRD FR-R4（任务名 + 时长 + 相对周期最大值的进度条）

import type { TaskDuration } from '@/types';
import { formatMinutes } from '@/lib/date';

export function DurationList({ items, showTask }: { items: TaskDuration[]; showTask: boolean }) {
  if (items.length === 0) return <div className="empty">该周期暂无专注记录</div>;
  const max = Math.max(1, ...items.map((i) => i.minutes));

  return (
    <div>
      {items.map((it, i) => (
        <div key={`${it.task_id ?? 'none'}-${i}`} style={{ marginBottom: 10 }}>
          <div className="dur-row" style={{ padding: 0 }}>
            <span className="dur-name">
              {showTask ? it.title : `任务 ${i + 1}`}
            </span>
            <span className="dur-val">{formatMinutes(it.minutes)}</span>
          </div>
          <div className="bar"><i style={{ width: `${(it.minutes / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
