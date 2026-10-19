// 「记录」页顶部统计栏 —— 专注归档的总量口径（番茄条数 / 总·本周时长 / 专注天数）。
// 视觉样式与统一任务统计卡保持一致：标签在上、大数字在下，红=专注时长 / 蓝=数量。
// 注意：已完成任务数不在此页统计（归「已完成」页，见 pages/DoneView.tsx）。

import { formatMinutes } from '@/lib/date';
import { useI18n } from '@/i18n';

export function RecordsStats({ records, focusMin, weekMin, days }: {
  /** 已完成番茄数（专注记录条数） */
  records: number;
  focusMin: number;
  weekMin: number;
  days: number;
}) {
  const { t } = useI18n();
  const items = [
    { labelKey: 'stat.records', value: String(records), tone: 'task' },
    { labelKey: 'stat.totalFocus', value: formatMinutes(focusMin), tone: 'focus' },
    { labelKey: 'stat.weekFocus', value: formatMinutes(weekMin), tone: 'focus' },
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
