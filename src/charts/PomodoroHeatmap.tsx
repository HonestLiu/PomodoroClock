// 番茄记录图 —— PRD FR-R3（截图事实 S4）
// X 轴 = 当日时刻（0:00–22:00，每 2 小时刻度）；Y 轴 = 日期（近 14 天，倒序）
// 颜色：今天蓝色、历史日期灰色。
// PRD §8.1 指定 ECharts 5；当前离线构建中该依赖不可得，改以 SVG 网格实现同一视觉与数据映射。

import { useMemo, useState } from 'react';
import type { GridCell } from '@/types';
import { relativeDayLabel } from '@/lib/date';
import { useI18n } from '@/i18n';

const CELL_W = 26;
const CELL_H = 15;
const GAP = 2;
const LEFT = 58;
const TOP = 18;
const HOURS = 24;

export function PomodoroHeatmap({ dates, cells }: { dates: string[]; cells: GridCell[] }) {
  const { t } = useI18n();
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const todayKey = dates[0];

  const byKey = useMemo(() => {
    const m = new Map<string, GridCell>();
    for (const c of cells) m.set(`${c.date}#${c.hour}`, c);
    return m;
  }, [cells]);

  const maxMin = useMemo(() => Math.max(1, ...cells.map((c) => c.minutes)), [cells]);

  const width = LEFT + HOURS * (CELL_W + GAP);
  const height = TOP + dates.length * (CELL_H + GAP) + 8;

  return (
    <div className="heatmap">
      <svg
        viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`${t('heatmap.aria')} · ${dates.length}×${HOURS}`}
      >
        {/* X 轴刻度：每 2 小时 */}
        {Array.from({ length: HOURS / 2 }, (_, i) => i * 2).map((h) => (
          <text key={h} className="heat-label" x={LEFT + h * (CELL_W + GAP)} y={11}>
            {h}:00
          </text>
        ))}

        {dates.map((d, row) => {
          const isToday = d === todayKey;
          const y = TOP + row * (CELL_H + GAP);
          return (
            <g key={d}>
              <text
                className={`heat-label${isToday ? ' today' : ''}`}
                x={0}
                y={y + CELL_H - 3}
              >
                {relativeDayLabel(d)}
              </text>
              {Array.from({ length: HOURS }, (_, h) => {
                const cell = byKey.get(`${d}#${h}`);
                const x = LEFT + h * (CELL_W + GAP);
                if (!cell) {
                  return (
                    <rect
                      key={h} x={x} y={y} width={CELL_W} height={CELL_H} rx={2.5}
                      fill="var(--accent-task)" opacity={isToday ? 0.35 : 0.5}
                    />
                  );
                }
                const intensity = 0.35 + 0.65 * (cell.minutes / maxMin);
                return (
                  <rect
                    key={h} x={x} y={y} width={CELL_W} height={CELL_H} rx={2.5}
                    fill={isToday ? 'var(--accent-blue)' : 'var(--accent-task)'}
                    opacity={isToday ? intensity : intensity * 0.9}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      const r = (e.target as SVGRectElement).getBoundingClientRect();
                      setTip({
                        x: r.left + r.width / 2,
                        y: r.top - 6,
                        text: t('heatmap.cellTip', {
                          date: relativeDayLabel(d), h, min: cell.minutes, n: cell.count,
                        }),
                      });
                    }}
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)' }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
