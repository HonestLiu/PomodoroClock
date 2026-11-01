// 迷你分布柱图 —— 报表「专注时段分布」（一天 24 小时 / 一周 7 天）。
// 用 flex 柱（不用 SVG）以便按像素精确控制柱高、不被 viewBox 比例拉伸；
// 取色走 :root 变量，浅/深主题自适应。峰值柱用专注红，其余用任务蓝（与统计卡口径一致）。

import { useState } from 'react';
import { formatMinutes } from '@/lib/date';
import { useI18n } from '@/i18n';

export interface BarDatum {
  label: string;
  minutes: number;
  sessions: number;
}

/** 柱区高度（px）—— 与 `.mini-bars` 的 CSS 高度对应 */
const BAR_AREA = 70;

export function BarDistribution({
  items, labelEvery = 1, aria,
}: { items: BarDatum[]; labelEvery?: number; aria: string }) {
  const { t } = useI18n();
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const max = Math.max(1, ...items.map((d) => d.minutes));
  let peak = -1;
  let peakVal = 0;
  items.forEach((d, i) => {
    if (d.minutes > peakVal) { peak = i; peakVal = d.minutes; }
  });

  return (
    <div className="mini-bars" role="img" aria-label={aria}>
      {items.map((d, i) => {
        const isPeak = i === peak && d.minutes > 0;
        const h = d.minutes > 0 ? Math.max(3, (d.minutes / max) * BAR_AREA) : 2;
        return (
          <div className="bar-col" key={i}>
            <i
              className={`bar-fill${isPeak ? ' peak' : ''}`}
              style={{ height: h, opacity: isPeak ? 1 : 0.3 + 0.6 * (d.minutes / max) }}
              onMouseEnter={(e) => {
                const r = (e.target as HTMLElement).getBoundingClientRect();
                setTip({
                  x: r.left + r.width / 2,
                  y: r.top - 6,
                  text: t('bars.tip', { label: d.label, v: formatMinutes(d.minutes), n: d.sessions }),
                });
              }}
              onMouseLeave={() => setTip(null)}
            />
            <span className="bar-x">{i % labelEvery === 0 ? d.label : ''}</span>
          </div>
        );
      })}

      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)' }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/** 该组柱子的峰值分钟（报表 caption 用「峰值 X」） */
export function peakMinutes(items: BarDatum[]): number {
  return items.reduce((m, d) => Math.max(m, d.minutes), 0);
}
