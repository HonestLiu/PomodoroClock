// 近 30 天专注趋势（面积图）—— PRD report.md ★1
// 用 :root 变量取色，适配浅/深主题；无第三方图表库，纯 SVG。

import { useMemo, useState } from 'react';
import { formatShortDate, relativeDayLabel } from '@/lib/date';
import { useI18n } from '@/i18n';

export interface TrendPoint { dateKey: string; minutes: number; }

export function TrendChart({ data, goalMin = 0 }: { data: TrendPoint[]; goalMin?: number }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 150, PAD = { l: 34, r: 8, t: 12, b: 20 };

  const { maxY, pts } = useMemo(() => {
    const max = Math.max(goalMin, 25, ...data.map((d) => d.minutes));
    const yMax = Math.ceil(max / 30) * 30;
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const n = data.length;
    const p = data.map((d, i) => {
      const x = PAD.l + (i / Math.max(1, n - 1)) * innerW;
      const y = PAD.t + innerH - (d.minutes / yMax) * innerH;
      return { x, y, ...d };
    });
    return { maxY: yMax, pts: p };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, goalMin]);

  const area = pts.length
    ? `M ${pts[0].x} ${PAD.t + H - PAD.t - PAD.b} L` +
      pts.map((p) => `${p.x} ${p.y}`).join(' L') +
      ` L ${pts[pts.length - 1].x} ${PAD.t + H - PAD.t - PAD.b} Z`
    : '';
  const line = pts.length ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') : '';

  // 网格线：取 0 / 1/2 / yMax
  const gridYs = [0, maxY / 2, maxY].map((v) => PAD.t + (H - PAD.t - PAD.b) - (v / maxY) * (H - PAD.t - PAD.b));

  const total = data.reduce((a, d) => a + d.minutes, 0);
  const avg = data.length ? Math.round(total / data.length) : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label={t('trend.aria')}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridYs.map((gy, i) => {
          const label = i === 0 ? '0' : i === 1 ? String(Math.round(maxY / 2)) : String(maxY);
          return (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="var(--border)" strokeDasharray="3 4" />
              <text x={PAD.l - 6} y={gy + 3} textAnchor="end" className="heat-label">{label}</text>
            </g>
          );
        })}

        {/* 目标线 */}
        {goalMin > 0 && pts.length > 0 && maxY > 0 && (
          (() => {
            const gy = PAD.t + (H - PAD.t - PAD.b) - (goalMin / maxY) * (H - PAD.t - PAD.b);
            return (
              <line x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="var(--accent-focus)" strokeWidth={1} strokeDasharray="5 3" />
            );
          })()
        )}

        {area && <path d={area} fill="url(#trendFill)" />}
        {line && <path d={line} fill="none" stroke="var(--accent-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

        {/* 数据点 + hover */}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y} r={hover === i ? 4.5 : 2.5}
            fill="var(--accent-blue)"
            opacity={hover === i ? 1 : p.minutes > 0 ? 0.9 : 0}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* X 轴：每隔几天一个日期标签 */}
        {pts.map((p, i) => {
          const show = i === 0 || i === pts.length - 1 || (i % 6 === 0);
          if (!show) return null;
          return (
            <text key={`l${i}`} x={p.x} y={H - 4} textAnchor="middle" className="heat-label">
              {formatShortDate(p.dateKey)}
            </text>
          );
        })}
      </svg>

      <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-2)', marginTop: 4, flexWrap: 'wrap' }}>
        <span>
          {t('trend.sum', { n: data.length })}
          <b style={{ color: 'var(--accent-focus)' }}>{t('trend.total', { n: total })}</b>
        </span>
        <span>{t('trend.avg', { n: avg })}</span>
        {goalMin > 0 && (
          <span>
            <span style={{ color: 'var(--accent-focus)' }}>┄</span> {t('trend.goal', { n: goalMin })}
          </span>
        )}
        {hover !== null && pts[hover] && (
          <span>
            <b style={{ color: 'var(--text-1)' }}>{relativeDayLabel(pts[hover].dateKey)}</b>{' '}
            {t('trend.hover', { n: pts[hover].minutes })}
          </span>
        )}
      </div>
    </div>
  );
}
