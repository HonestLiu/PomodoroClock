import { useRef, useState, type FormEvent } from 'react';
import { Coins, Gift, Wallet, X, Trophy, Plus } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useGrowthStore } from '@/stores/growthStore';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useModalA11y } from '@/components/useModalA11y';
import { useI18n } from '@/i18n';
import { coinBalance, coinCost, currentLevel, earnedCoins, experience, levelThreshold, redeemProblem, yuanToCents, type Reward } from '@/lib/growth';
import '@/styles/growth.css';

type Tab = 'shop' | 'levels' | 'budget' | 'history';
const money = (cents: number) => (cents / 100).toFixed(2);
const syncValidity = (el: HTMLInputElement) => {
  if (CSS.supports('selector(:user-invalid)')) el.setAttribute('aria-invalid', String(el.matches(':user-invalid')));
};

export function GrowthModal() {
  const open = useUiStore(s => s.achievementsOpen);
  const close = () => useUiStore.getState().openAchievements(false);
  const store = useGrowthStore();
  const { data } = store;
  const stats = useStatsStore(s => s.stats);
  const { t, lang } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<Tab>('shop');
  const [editor, setEditor] = useState<Reward | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useModalA11y(open, close, rootRef, '.growth-close');

  async function run(action: () => Promise<void>, successKey = 'growth.done'): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true); setMessage(''); setError('');
    try {
      await action(); setMessage(successKey ? t(successKey) : ''); return true;
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(t(`growth.err.${['invalid', 'coins', 'fund', 'locked', 'claimed', 'duplicate', 'missing', 'qr', 'pending'].includes(code) ? code : 'save'}`));
      return false;
    } finally { busy.current = false; setPending(false); }
  }
  const pickTab = (value: Tab) => { setTab(value); setEditor(null); setSelected(null); setError(''); setMessage(''); };
  if (!open) return null;
  const level = data ? currentLevel(data) : 1;
  const xp = data ? experience(data) : 0;
  const nextXp = levelThreshold(level + 1);
  const progress = xp - levelThreshold(level);
  const goal = nextXp - levelThreshold(level);
  const rewardKind = tab === 'levels' ? 'level' : 'shop';
  const rewards = data?.rewards.filter(r => r.kind === rewardKind) ?? [];
  const selectedReward = data?.rewards.find(r => r.id === selected);

  async function submitReward(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor) return;
    const f = new FormData(e.currentTarget);
    const saved = await run(async () => {
      await store.saveReward({ ...editor, name: String(f.get('name') ?? ''), note: String(f.get('note') ?? ''),
        memberCents: yuanToCents(String(f.get('member'))),
        regularCents: f.get('regular') ? yuanToCents(String(f.get('regular'))) : null,
        level: editor.kind === 'level' ? Number(f.get('level')) : 2 });
    });
    if (saved) setEditor(null);
  }
  async function submitFund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fields = new FormData(form);
    const direction = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'withdraw' ? -1 : 1;
    if (await run(async () => {
      const cents = yuanToCents(String(fields.get('amount')));
      if (direction < 0) await store.withdraw(cents);
      else await store.startPayment({ kind: 'deposit', cents });
    }, direction < 0 ? 'growth.done' : '')) form.reset();
  }

  return (
    <div className="overlay" onClick={close}>
      <div className="modal growth-modal" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="growth-title" onClick={e => e.stopPropagation()}
        onBlur={e => { if (e.target instanceof HTMLInputElement) syncValidity(e.target); }}
        onInput={e => { if (e.target instanceof HTMLInputElement) syncValidity(e.target); }}>
        <div className="modal-head">
          <div><h2 id="growth-title">{t('growth.title')}</h2><p className="growth-muted">{t('growth.intro')}</p></div>
          <button className="icon-btn growth-close" onClick={close} aria-label={t('common.close')}><X size={18} /></button>
        </div>
        <div className="modal-body growth-body">
          {!data ? <div role="alert"><p>{t('growth.err.load')}</p><button className="btn" onClick={() => void store.reconcile(useDataStore.getState().records)}>{t('growth.title')}</button></div> : <>
            <div className="growth-summary">
              <div><Coins size={20} aria-hidden /><span>{t('growth.coins')}</span><strong>{coinBalance(data)}</strong><small>{t('growth.value', { value: money(Math.floor(coinBalance(data) * 100 / data.coinsPerYuan)) })}</small></div>
              <div><Trophy size={20} aria-hidden /><span>{t('growth.xp')}</span><strong>Lv.{level} <small>{xp} XP</small></strong><progress value={progress} max={goal} aria-label={t('growth.next', { level: level + 1, xp: nextXp - xp })} /><small>{t('growth.next', { level: level + 1, xp: nextXp - xp })}</small></div>
              <div><Wallet size={20} aria-hidden /><span>{t('growth.fund')}</span><strong>¥{money(data.fundCents)}</strong><button className="growth-link" onClick={() => pickTab('budget')}>{t('growth.deposit')} →</button></div>
            </div>
            <nav className="growth-tabs" aria-label={t('growth.title')}>
              {(['shop', 'levels', 'budget', 'history'] as Tab[]).map(key => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => pickTab(key)}>{t(`growth.${key}`)}</button>)}
            </nav>
            <div role="status" className="growth-status">{message}</div>
            {error && <p role="alert" className="growth-error">{error}</p>}
            {(tab === 'shop' || tab === 'levels') && <>
              <div className="growth-section-head"><h3>{t(`growth.${tab}`)}</h3><button className="btn" disabled={pending} onClick={() => {
                setSelected(null); setError(''); setEditor({ id: crypto.randomUUID(), name: '', note: '', memberCents: 0, regularCents: null, kind: rewardKind, level: Math.max(2, level + 1) });
              }}><Plus size={14} aria-hidden /> {t('growth.add')}</button></div>
              {editor && <form key={editor.id} className="growth-form" onSubmit={submitReward}>
                <fieldset disabled={pending}>
                  <legend>{t(editor.name ? 'growth.edit' : 'growth.add')}</legend>
                  <label>{t('growth.name')}<input autoFocus name="name" required maxLength={80} defaultValue={editor.name} /></label>
                  <p id="growth-price-hint" className="growth-muted">{t('growth.priceHint')}</p>
                  <label>{t('growth.member')}<input name="member" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required aria-describedby="growth-price-hint" defaultValue={editor.memberCents ? money(editor.memberCents) : ''} /></label>
                  <label>{t('growth.regular')}<input name="regular" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" aria-describedby="growth-price-hint" defaultValue={editor.regularCents === null ? '' : money(editor.regularCents)} /></label>
                  {editor.kind === 'level' && <label>{t('growth.target')}<input name="level" type="number" min="2" max="1000" step="1" required defaultValue={editor.level} /></label>}
                  <label>{t('growth.note')}<textarea name="note" maxLength={500} rows={2} defaultValue={editor.note} /></label>
                  <div className="growth-actions"><button className="btn" type="button" onClick={() => setEditor(null)}>{t('growth.cancel')}</button><button className="btn primary" type="submit">{t('growth.save')}</button></div>
                </fieldset>
              </form>}
              {selectedReward && <div className="growth-confirm">
                <p>{t('growth.confirmText', { name: selectedReward.name, coins: coinCost(data, selectedReward), price: money(selectedReward.memberCents) })}</p>
                <p className="growth-muted">{t('growth.fundHint')}</p>
                <div className="growth-actions"><button autoFocus className="btn" disabled={pending} onClick={() => setSelected(null)}>{t('growth.cancel')}</button><button className="btn primary" disabled={pending} onClick={async () => { if (await run(() => store.redeem(selectedReward.id))) setSelected(null); }}>{t('growth.confirm')}</button></div>
              </div>}
              {rewards.length === 0 && !editor && <div className="growth-empty"><Gift size={30} aria-hidden /><p>{t('growth.empty')}</p></div>}
              <div className="growth-rewards">{rewards.sort((a, b) => a.level - b.level).map(r => {
                const problem = redeemProblem(data, r);
                const claimed = problem === 'claimed';
                const cost = coinCost(data, r);
                return <article className="growth-card" key={r.id}>
                  <div className="growth-section-head"><Gift size={22} aria-hidden /><div className="growth-actions">
                    <button className="growth-link" disabled={pending || claimed} onClick={() => { setEditor(r); setSelected(null); }}>{t('growth.edit')}</button>
                    <button className="growth-link" disabled={pending} onClick={() => void run(async () => { await store.removeReward(r.id); if (editor?.id === r.id) setEditor(null); if (selected === r.id) setSelected(null); })}>{t('growth.delete')}</button>
                  </div></div>
                  <h3>{r.name}</h3>{r.note && <p className="growth-note">{r.note}</p>}
                  <p>{t('growth.price', { price: money(r.memberCents) })}</p>
                  {r.regularCents !== null && <p className="growth-muted">{t('growth.saving', { price: money(r.regularCents), saving: money(r.regularCents - r.memberCents) })}</p>}
                  <strong>{t(r.kind === 'shop' ? 'growth.cost' : 'growth.levelCost', { coins: cost, price: money(r.memberCents), level: r.level })}</strong>
                  <p className="growth-muted">{r.kind === 'shop' ? t('growth.estimate', { minutes: cost, rate: data.coinsPerYuan }) : t('growth.levelEstimate', { xp: levelThreshold(r.level), minutes: levelThreshold(r.level) / 10 })}</p>
                  {problem && <p className="growth-muted">{t(`growth.err.${problem}`)}</p>}
                  <button className="btn primary" disabled={pending || !!problem} onClick={() => { setSelected(r.id); setEditor(null); setError(''); }}>{t(r.kind === 'level' ? 'growth.claim' : 'growth.redeem')}</button>
                </article>;
              })}</div>
              {tab === 'levels' && <details className="growth-rules"><summary>{t('title.achievements')}</summary>
                {[
                  { key: 'first', done: (stats?.total_focus_min ?? 0) > 0 },
                  { key: 'streak', done: (stats?.total_focus_min ?? 0) >= 300 },
                  { key: 'goal', done: (stats?.goal_days ?? 0) >= 1 },
                  { key: 'master', done: (stats?.total_done_tasks ?? 0) >= 10 },
                ].map(a => <p key={a.key}>{t(`ach.${a.key}`)} · {t(`ach.${a.key}Desc`)} · {t(a.done ? 'ach.done' : 'ach.todo')}</p>)}
              </details>}
            </>}
            {tab === 'budget' && <div className="growth-budget">
              <button className="growth-link" onClick={() => useUiStore.getState().openPremium(true)}>{t('payment.membership')} →</button>
              <form className="growth-form" onSubmit={submitFund}>
                <fieldset disabled={pending}><legend>{t('growth.fund')}</legend>
                  <p id="growth-fund-hint" className="growth-muted">{t('growth.fundHint')}</p>
                  <label>{t('growth.amount')}<input name="amount" type="number" inputMode="decimal" required min="0.01" max="1000000" step="0.01" aria-describedby="growth-fund-hint" /></label>
                  <div className="growth-actions"><button className="btn" type="submit" name="direction" value="withdraw">{t('growth.withdraw')}</button><button className="btn primary" type="submit" name="direction" value="deposit">{t('growth.deposit')}</button></div>
                </fieldset>
              </form>
            </div>}
            {tab === 'history' && <>
              <p>{t('growth.earned', { coins: earnedCoins(data), xp, spent: data.spentCoins })}</p>
              {data.entries.length === 0 ? <p className="growth-empty">{t('growth.noHistory')}</p> : <div className="growth-ledger">{[...data.entries].reverse().map(entry => <div key={entry.id}>
                <div><strong>{entry.name || (entry.kind === 'membership' ? t('payment.membershipCredit', { plan: t(`payment.${entry.plan}`) }) : t(entry.kind === 'deposit' ? 'growth.deposit' : 'growth.withdraw'))}</strong><small>{new Date(entry.at).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN')}{entry.level ? ` · Lv.${entry.level}` : ''}{entry.orderId ? ` · ${entry.orderId}` : ''}</small></div>
                <div><strong>{entry.cents > 0 ? '+' : '−'}¥{money(Math.abs(entry.cents))}</strong>{entry.coins < 0 && <small>{entry.coins} {t('growth.coins')}</small>}</div>
              </div>)}</div>}
            </>}
            <details className="growth-rules"><summary>{t('growth.rules')}</summary><p>{t('growth.rulesText')}</p><p>{t('growth.local')}</p></details>
          </>}
        </div>
      </div>
    </div>
  );
}
