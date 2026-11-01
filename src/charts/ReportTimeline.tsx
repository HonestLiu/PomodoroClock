import { useState } from 'react';
import type { Period } from '@/types';
import type { ReportBucket } from '@/lib/report';
import { formatMinutes, formatMinutesShort, parseDateKey } from '@/lib/date';
import { useI18n } from '@/i18n';

export function ReportTimeline({ items, period, goalMin }: { items: ReportBucket[]; period: Period; goalMin: number }) {
  const { t, lang } = useI18n();
  const [active, setActive] = useState<string | null>(null);
  const target = period === 'week' || period === 'month' ? goalMin : 0;
  const max = Math.max(30, target, ...items.map(item => item.minutes));
  const ceiling = Math.ceil(max / 30) * 30;
  const peak = items.reduce<ReportBucket | null>((best, item) => item.minutes > (best?.minutes ?? 0) ? item : best, null);
  const selected = items.find(item => item.key === active) ?? peak;
  const label = (item: ReportBucket, short = false) => {
    if (period === 'day') return `${item.key.padStart(2, '0')}:00`;
    if (period === 'year') return short ? item.key : t('report2.monthNumber', { n: item.key });
    const date = parseDateKey(item.key);
    if (period === 'week') return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short' });
    return short ? String(date.getDate()) : date.toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
  };
  const labelEvery = period === 'month' ? 5 : period === 'day' ? 3 : 1;
  return <div className="rpt-timeline">
    <div className="rpt-chart-readout" aria-live="polite">{selected ? <><span>{label(selected)}</span><strong>{formatMinutes(selected.minutes)}</strong><span>{t('report2.sessionAmount', { n: selected.sessions })}</span></> : <span>{t('report2.noFocus')}</span>}</div>
    <div className="rpt-chart-plot">
      <div className="rpt-chart-axis" aria-hidden><span>{formatMinutesShort(ceiling)}</span><span>{formatMinutesShort(ceiling / 2)}</span><span>0</span></div>
      <div className="rpt-chart-field">
        <div className="rpt-chart-lines" aria-hidden><i /><i /><i /></div>
        {target > 0 && <div className="rpt-chart-goal" style={{ bottom: `${target / ceiling * 100}%` }} aria-hidden />}
        <div className="rpt-chart-bars" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="group" aria-label={t('report2.timeline')}>
          {items.map((item, index) => <button key={item.key}
            type="button" className={`rpt-chart-column${item.key === selected?.key ? ' is-selected' : ''}${item.minutes === 0 ? ' is-empty' : ''}`}
            aria-label={`${label(item)}: ${formatMinutes(item.minutes)}, ${t('report2.sessionAmount', { n: item.sessions })}`}
            onMouseEnter={() => setActive(item.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(item.key)} onBlur={() => setActive(null)}
          >
            <span className="rpt-chart-bar" style={{ height: `${Math.max(item.minutes > 0 ? 2 : .8, item.minutes / ceiling * 100)}%` }} />
            <span className="rpt-chart-x" aria-hidden>{index % labelEvery === 0 ? label(item, true) : ''}</span>
          </button>)}
        </div>
      </div>
    </div>
    <div className="rpt-chart-legend"><span><i />{t('report2.focusTime')}</span>{target > 0 && <span><i className="goal" />{t('report.target', { v: formatMinutes(target) })}</span>}<span>{t('report2.chartHint')}</span></div>
  </div>;
}
