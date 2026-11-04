import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Flag, Plus, ScrollText } from 'lucide-react';
import { useQuestStore } from '@/stores/questStore';
import { useTimerStore } from '@/stores/timerStore';
import { useI18n } from '@/i18n';
import { localDay, type QuestStepDraft } from '@/lib/quests/model';
import { planLifeGoal } from '@/lib/quests/planner';
import { QuestCards } from '@/components/QuestCards';
import '@/styles/quests.css';

export function QuestBoard() {
  const { data, ready, busy, error, addGoal, pauseGoal, refresh } = useQuestStore();
  const { t } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const day = localDay(Date.now());
  const quests = data.quests.filter(q => q.publishedDay === day && (!data.goals.find(g => g.id === q.goalId)?.paused || data.attempts.some(a => a.questId === q.id && a.day === day)));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (planning) return;
    const values = new FormData(event.currentTarget);
    const title = String(values.get('goal') ?? '').trim();
    const description = String(values.get('context') ?? '').trim();
    const budget = Number(values.get('budget'));
    setPlanning(true); setMessage('');
    const ctrl = new AbortController(); controller.current = ctrl;
    try {
      let steps: QuestStepDraft[];
      if (manual) {
        steps = String(values.get('steps') ?? '').split('\n').map(s => s.trim()).filter(Boolean).map((title, i) => ({ key: `s${i}`, title, acceptance: title, minutes: Math.min(budget, 25), requires: i ? [`s${i - 1}`] : [] }));
      } else steps = await planLifeGoal(title, description, budget, useTimerStore.getState().settings, ctrl.signal);
      if (ctrl.signal.aborted) return;
      await addGoal(title, description, budget, steps);
      if (ctrl.signal.aborted) return;
      setFormOpen(false); setMessage(t('quest.created'));
    } catch (error) { if (!ctrl.signal.aborted) setMessage(t(String(error).replace(/^Error: /, ''))); }
    finally { if (controller.current === ctrl) { controller.current = null; setPlanning(false); } }
  }
  const showForm = formOpen || data.goals.length === 0;
  return <div className="content quest-board">
    <header className="quest-header"><div><h1 className="page-title">{t('quest.board')}</h1><p>{t('quest.tagline')}</p></div><button type="button" className="btn" onClick={() => setFormOpen(!formOpen)} aria-expanded={showForm} aria-controls="quest-goal-form"><Plus size={15} aria-hidden />{t('quest.newGoal')}</button></header>
    <div className="quest-board-note"><ScrollText size={20} aria-hidden /><p>{t('quest.rules')}</p></div>
    {showForm && <form id="quest-goal-form" className="quest-goal-form" method="post" onSubmit={e => { void submit(e); }} aria-busy={planning}>
      <h2><Flag size={18} aria-hidden />{t('quest.newGoal')}</h2>
      <label htmlFor="quest-goal">{t('quest.goalTitle')}</label><input id="quest-goal" name="goal" required maxLength={160} placeholder={t('quest.goalPlaceholder')} disabled={planning} />
      <label htmlFor="quest-context">{t('quest.context')}</label><textarea id="quest-context" name="context" maxLength={3000} rows={3} placeholder={t('quest.contextPlaceholder')} disabled={planning} />
      <label htmlFor="quest-budget">{t('quest.budget')}</label><input id="quest-budget" name="budget" type="number" min={5} max={480} step={1} defaultValue={40} required disabled={planning} />
      <label className="quest-mode"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} disabled={planning} />{t('quest.manual')}</label>
      {manual && <><label htmlFor="quest-steps">{t('quest.steps')}</label><textarea id="quest-steps" name="steps" required maxLength={5000} rows={4} placeholder={t('quest.stepsPlaceholder')} aria-describedby="quest-manual-help" disabled={planning} /><p id="quest-manual-help">{t('quest.manualHelp')}</p></>}
      <div className="quest-form-actions"><button type="submit" className="btn primary" disabled={planning || busy}>{t(planning ? 'quest.planning' : manual ? 'quest.createManual' : 'quest.generate')}</button>
        {(planning || formOpen) && <button type="button" className="btn" onClick={() => { controller.current?.abort(); setFormOpen(false); }}>{t('quest.cancel')}</button>}</div>
    </form>}
    <p className="quest-feedback" role="status" aria-live="polite">{message || (error ? t(error) : '')}</p>
    {data.goals.length > 0 && <section className="quest-goals" aria-label={t('quest.yourGoals')}>
      {data.goals.map(goal => <article className="quest-goal" key={goal.id}><div><h2>{goal.title}{goal.paused && <small>{t('quest.paused')}</small>}</h2><p>{t('quest.budgetLabel', { n: goal.budget })} · {t('quest.progress', { n: data.quests.filter(q => q.goalId === goal.id && q.completedAt !== null).length })}</p></div><button className="btn" type="button" disabled={busy} onClick={() => { void pauseGoal(goal.id, !goal.paused).catch(() => {}); }}>{t(goal.paused ? 'quest.resume' : 'quest.pause')}</button></article>)}
    </section>}
    <section aria-labelledby="quest-available"><div className="quest-section-head"><h2 id="quest-available">{t('quest.available')}</h2><button type="button" className="btn" disabled={busy} onClick={() => { void refresh().catch(() => {}); }}>{t('quest.retry')}</button></div>
      {quests.length ? <QuestCards quests={quests} /> : ready && <div className="quest-empty"><ScrollText size={32} aria-hidden /><h3>{t(data.goals.length ? 'quest.empty' : 'quest.noGoals')}</h3><p>{t(data.goals.length ? 'quest.emptyHint' : 'quest.noGoalsHint')}</p></div>}
    </section><p className="quest-expiry">{t('quest.expiry')}</p>
  </div>;
}
