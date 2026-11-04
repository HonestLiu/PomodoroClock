import { useState } from 'react';
import { Check, Clock3, Play, ScrollText } from 'lucide-react';
import { useQuestStore } from '@/stores/questStore';
import { localDay, type Quest } from '@/lib/quests/model';
import { useI18n } from '@/i18n';

export function QuestCards({ quests }: { quests: Quest[] }) {
  const { data, busy, accept, complete, startFocus } = useQuestStore();
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<void>, success?: string) {
    setPending(true); setMessage('');
    try { await action(); if (success) setMessage(t(success)); }
    catch (error) { setMessage(t(String(error).replace(/^Error: /, ''))); }
    finally { setPending(false); }
  }
  return <>
    <div className="quest-cards">
      {quests.map(q => {
        const attempt = data.attempts.find(a => a.questId === q.id && a.day === localDay(Date.now()) && (a.status === 'accepted' || a.status === 'completed'));
        const accepted = attempt?.status === 'accepted' && Date.now() < attempt.expiresAt;
        const done = q.completedAt !== null;
        return <article className={`quest-card${accepted ? ' accepted' : ''}${done ? ' completed' : ''}`} key={q.id} data-quest-id={q.id}>
          <div className="quest-card-top"><span className="quest-source"><ScrollText size={14} aria-hidden />{data.goals.find(g => g.id === q.goalId)?.title}</span><span className="quest-state">{done ? t('quest.completed') : accepted ? t('quest.accepted') : ''}</span></div>
          <h3>{q.title}</h3>
          <p className="quest-criteria"><span>{t('quest.acceptance')}</span>{q.acceptance}</p>
          <div className="quest-meta"><span><Clock3 size={13} aria-hidden />{t('quest.minutes', { n: q.minutes })}</span><span>{t('quest.rewards', { xp: q.xp, coins: q.coins })}</span></div>
          <div className="quest-actions">
            {done ? <span className="quest-done"><Check size={16} aria-hidden />{t('quest.completed')}</span> : accepted ? <>
              <label className="quest-complete"><input type="checkbox" disabled={busy || pending} onChange={() => { void run(() => complete(attempt!.id), 'quest.finishedMessage'); }} />{t('quest.finish')}</label>
              <button type="button" className="btn" disabled={busy || pending} onClick={() => { void run(() => startFocus(attempt!.id)); }}><Play size={13} aria-hidden />{t('quest.focus')}</button>
            </> : <button type="button" className="btn primary" disabled={busy || pending || data.goals.find(g => g.id === q.goalId)?.paused} onClick={() => { void run(() => accept(q.id), 'quest.acceptedMessage'); }}>{t('quest.accept')}</button>}
          </div>
        </article>;
      })}
    </div>
    <p className="quest-feedback" role="status" aria-live="polite">{message}</p>
  </>;
}
