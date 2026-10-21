// 倒数纪念日首页（docs/05-modules/countdown.md）

import { useMemo, useState } from 'react';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { useCountdownStore } from '@/stores/countdownStore';
import { useUiStore } from '@/stores/uiStore';
import { compareCountdown, isFuture } from '@/lib/countdown';
import { todayKey } from '@/lib/date';
import { useI18n } from '@/i18n';
import type { Countdown } from '@/types';
import { CountdownCard } from '@/components/CountdownCard';
import { CountdownEditModal } from '@/modals/CountdownEditModal';
import '@/styles/countdown.css';

export function CountdownPage() {
  const { t } = useI18n();
  const items = useCountdownStore((s) => s.items);
  const ready = useCountdownStore((s) => s.ready);
  const revision = useCountdownStore((s) => s.revision);
  const askConfirm = useUiStore((s) => s.askConfirm);

  const [view, setView] = useState<'card' | 'list'>('card');
  const [editing, setEditing] = useState<Countdown | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const today = todayKey();
  // revision 参与重算：列表变化（含提醒置位）后重新排序
  void revision;

  const sorted = useMemo(
    () => [...items].sort((a, b) => compareCountdown(a, b, today)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, ready, revision],
  );
  const future = sorted.filter((c) => isFuture(c, today));
  const past = sorted.filter((c) => !isFuture(c, today));

  function requestDelete(c: Countdown) {
    askConfirm({
      title: t('cd.deleteTitle'),
      message: t('cd.deleteMsg', { title: c.title }),
      confirmText: t('common.delete'),
      danger: true,
      onConfirm: async () => { await useCountdownStore.getState().remove(c.id); },
    });
  }

  const renderItem = (c: Countdown) => (
    <CountdownCard key={c.id} c={c} view={view}
      onEdit={() => setEditing(c)} onDelete={() => requestDelete(c)} />
  );

  return (
    <div className="page countdown-page">
      <div className="page-head">
        <h1 className="page-title">{t('cd.title')}</h1>
        <div className="page-actions">
          <div className="seg" role="group" aria-label={t('cd.title')}>
            <button type="button" className={view === 'card' ? 'active' : ''} aria-pressed={view === 'card'}
              title={t('cd.viewCard')} onClick={() => setView('card')}><LayoutGrid size={15} /></button>
            <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'}
              title={t('cd.viewList')} onClick={() => setView('list')}><List size={15} /></button>
          </div>
          <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden /> {t('cd.add')}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="cd-empty">
          <p>{t('cd.empty')}</p>
          <p className="acct-hint">{t('cd.emptyHint')}</p>
          <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden /> {t('cd.add')}
          </button>
        </div>
      ) : (
        <div className={view === 'card' ? 'cd-grid' : 'cd-list'}>
          {future.length > 0 && (
            <section className="cd-section" aria-label={t('cd.future')}>
              {past.length > 0 && <h2 className="cd-section-title">{t('cd.future')}</h2>}
              {future.map(renderItem)}
            </section>
          )}
          {past.length > 0 && (
            <section className="cd-section" aria-label={t('cd.past')}>
              <h2 className="cd-section-title">{t('cd.past')}</h2>
              {past.map(renderItem)}
            </section>
          )}
        </div>
      )}

      <CountdownEditModal open={createOpen || editing !== null} editing={editing}
        onClose={() => { setCreateOpen(false); setEditing(null); }} />
    </div>
  );
}