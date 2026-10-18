// 清单时间分布环形图 —— PRD FR-R5

import { useState } from 'react';
import type { ListDistribution } from '@/types';
import { formatMinutes } from '@/lib/date';
import { useI18n } from '@/i18n';

const COLORS = ['#4A7DE0', '#E85D3F', '#7BA05B', '#D9A441', '#9B7BD4', '#4FB0AE', '#C4718F'];

export function DonutChart({ items, total }: { items: ListDistribution[]; total: number }) {
  const { t } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const size = 150;
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const segments = items.map((it, i) => {
    const frac = total === 0 ? 0 : it.minutes / total;
    const seg = { it, i, dash: frac * c, offset };
    offset += frac * c;
    return seg;
  });

  return (
    <div className="donut-wrap">
      <svg
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        role="img" aria-label={`${t('donut.total')} ${total === 0 ? t('donut.zero') : formatMinutes(total)}`}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="var(--accent-task)" strokeWidth={stroke} opacity={0.4}
          />
          {segments.map((s) => (
            <circle
              key={s.i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={COLORS[s.i % COLORS.length]}
              strokeWidth={active === s.i ? stroke + 3 : stroke}
              strokeDasharray={`${s.dash} ${c - s.dash}`}
              strokeDashoffset={-s.offset}
              style={{ transition: 'stroke-width .14s', cursor: 'pointer' }}
              onMouseEnter={() => setActive(s.i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </g>
        <text
          x={size / 2} y={size / 2 - 3}
          textAnchor="middle"
          style={{ fontSize: 15, fontWeight: 600, fill: 'var(--text-1)' }}
        >
          {total === 0 ? t('donut.zero') : formatMinutes(total)}
        </text>
        <text
          x={size / 2} y={size / 2 + 14}
          textAnchor="middle"
          style={{ fontSize: 10.5, fill: 'var(--text-2)' }}
        >
          {t('donut.total')}
        </text>
      </svg>

      <div className="legend">
        {items.length === 0 && <span className="field-hint">{t('charts.noData')}</span>}
        {items.map((it, i) => (
          <div className="legend-row" key={`${it.list_id ?? 'none'}-${i}`}>
            <span className="legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="legend-name">{it.name}</span>
            <span className="legend-val">{formatMinutes(it.minutes)} · {it.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
