// 「已完成」页顶部统计栏 —— 独立组件（不复用统一的任务统计卡 StatCards），
// 但视觉样式与其他页面的统计卡保持一致：标签在上、大数字在下，红=专注时长 / 蓝=任务数。

import { formatMinutes } from '@/lib/date';
import { useI18n } from '@/i18n';

export function CompletedStats({ doneTasks, records, focusMin, days }: {
  doneTasks: number;
  records: number;
  focusMin: number;
  days: number;
}) {
  const { t } = useI18n();
  const items = [
    { labelKey: 'stat.totalDone', value: String(doneTasks), tone: 'task' },
    { labelKey: 'stat.records', value: String(records), tone: 'task' },
    { labelKey: 'stat.totalFocus', value: formatMinutes(focusMin), tone: 'focus' },
    { labelKey: 'stat.focusDays', value: String(days), tone: 'focus' },
  ] as const;
  return (
    <div className="stat-row">
      {items.map((it) => (
        <div className="stat-card" key={it.labelKey}>
          <span className="stat-label">{t(it.labelKey)}</span>
          <span className={`stat-value ${it.tone}`}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}