import { FileInput } from '@/components/controls/FileInput';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Crown } from 'lucide-react';
import { useGrowthStore } from '@/stores/growthStore';
import { useDataStore } from '@/stores/dataStore';
import { useI18n } from '@/i18n';
import { validQrImage, yuanToCents, type MembershipPlan, type PaymentSettings } from '@/lib/growth';
import '@/styles/payments.css';

export const paymentMoney = (cents: number) => (cents / 100).toFixed(2);
function syncValidity(el: EventTarget) {
  if (el instanceof HTMLInputElement && CSS.supports('selector(:user-invalid)')) {
    el.setAttribute('aria-invalid', String(el.matches(':user-invalid')));
  }
}
export function paymentError(e: unknown): string {
  const code = e instanceof Error ? e.message : '';
  return `growth.err.${['invalid', 'qr', 'pending', 'missing', 'fund'].includes(code) ? code : 'save'}`;
}

async function readQr(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('image');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('image'));
    reader.onerror = () => reject(new Error('image'));
    reader.readAsDataURL(file);
  });
  if (!validQrImage(data)) throw new Error('image');
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => img.naturalWidth > 0 && img.naturalHeight > 0 ? resolve() : reject(new Error('image'));
    img.onerror = () => reject(new Error('image'));
    img.src = data;
  });
  return data;
}

export function PaymentSettingsForm({ settings }: { settings: PaymentSettings }) {
  const { t } = useI18n();
  const [wechatQr, setWechatQr] = useState(settings.wechatQr);
  const [alipayQr, setAlipayQr] = useState(settings.alipayQr);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const versions = useRef({ wechat: 0, alipay: 0 });

  async function upload(file: File | undefined, channel: 'wechat' | 'alipay') {
    if (!file) return;
    const version = ++versions.current[channel];
    setReading(n => n + 1); setError(''); setSaved(false);
    try {
      const image = await readQr(file);
      if (version === versions.current[channel]) (channel === 'wechat' ? setWechatQr : setAlipayQr)(image);
    } catch { setError(t('payment.imageError')); }
    finally { setReading(n => n - 1); }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current || reading > 0) return;
    busy.current = true; setPending(true); setError(''); setSaved(false);
    const fields = new FormData(e.currentTarget);
    try {
      await useGrowthStore.getState().configurePayment({ wechatQr, alipayQr,
        weeklyCents: yuanToCents(String(fields.get('weekly'))), monthlyCents: yuanToCents(String(fields.get('monthly'))),
        accountNote: String(fields.get('accountNote') ?? '') });
      setSaved(true);
    } catch (e) { setError(t(paymentError(e))); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="payment-config" aria-label={t('payment.configure')}>
    <form className="growth-form" onSubmit={save} onBlur={e => syncValidity(e.target)} onInput={e => syncValidity(e.target)}>
      <fieldset disabled={pending}>
        <legend>{t('payment.configure')}</legend>
        <p className="growth-muted" id="payment-config-help">{t('payment.accountHelp')}</p>
        <label>{t('payment.accountNote')}<input name="accountNote" maxLength={200} defaultValue={settings.accountNote} aria-describedby="payment-config-help" /></label>
        <p className="growth-muted" id="payment-image-help">{t('payment.imageHelp')}</p>
        <div className="payment-upload-grid">{(['wechat', 'alipay'] as const).map(channel => {
          const image = channel === 'wechat' ? wechatQr : alipayQr;
          return <div className="payment-upload" key={channel}>
            <label>{t(`payment.${channel}`)}<FileInput type="file" name={`${channel}Qr`} accept="image/png,image/jpeg,image/webp" aria-describedby="payment-image-help" onChange={e => { void upload(e.target.files?.[0], channel); e.target.value = ''; }} /></label>
            {image && <><img src={image} alt={t(`payment.${channel}`)} /><button className="growth-link" type="button" onClick={() => { versions.current[channel]++; (channel === 'wechat' ? setWechatQr : setAlipayQr)(''); setSaved(false); }}>{t('payment.removeQr')}</button></>}
          </div>;
        })}</div>
        <label>{t('payment.weeklyPrice')}<input name="weekly" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required defaultValue={paymentMoney(settings.weeklyCents)} /></label>
        <label>{t('payment.monthlyPrice')}<input name="monthly" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required defaultValue={paymentMoney(settings.monthlyCents)} /></label>
        <button className="btn primary" type="submit" disabled={reading > 0}>{t('payment.saveConfig')}</button>
      </fieldset>
      {error && <p role="alert" className="growth-error">{error}</p>}
      {saved && <p role="status" className="growth-status">{t('payment.configSaved')}</p>}
    </form>
  </section>;
}

export function MembershipPanel() {
  const data = useGrowthStore(s => s.data);
  const { t, lang } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  async function purchase(plan: MembershipPlan) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await useGrowthStore.getState().startPayment({ kind: 'membership', plan }); }
    catch (e) { setError(t(paymentError(e))); }
    finally { busy.current = false; setPending(false); }
  }
  if (!data) return <div role="alert"><p>{t('growth.err.load')}</p><button className="btn" onClick={() => void useGrowthStore.getState().reconcile(useDataStore.getState().records)}>{t('payment.retry')}</button></div>;
  const active = data.membershipUntil > now;
  return <section className="membership-panel">
    <div className="membership-intro"><Crown size={30} aria-hidden /><h3>{t('payment.membership')}</h3><p className="growth-muted">{t('payment.membershipIntro')}</p></div>
    <div className="membership-status"><strong>{t(active ? 'payment.active' : 'payment.inactive')}</strong>
      {data.membershipUntil > 0 && <span>{t('payment.expires', { date: new Date(data.membershipUntil).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN') })}</span>}
      <span>{t('growth.fund')} ¥{paymentMoney(data.fundCents)}</span>
    </div>
    <div className="membership-plans">{(['weekly', 'monthly'] as const).map(plan => <article key={plan}>
      <h3>{t(`payment.${plan}`)}</h3><strong>¥{paymentMoney(plan === 'weekly' ? data.paymentSettings.weeklyCents : data.paymentSettings.monthlyCents)}</strong>
      <p className="growth-muted">{t(plan === 'weekly' ? 'payment.weeklyDuration' : 'payment.monthlyDuration')}</p>
      <button className="btn primary" disabled={pending} onClick={() => void purchase(plan)}>{t('payment.payAmount', { amount: paymentMoney(plan === 'weekly' ? data.paymentSettings.weeklyCents : data.paymentSettings.monthlyCents) })}</button>
    </article>)}</div>
    {error && <p role="alert" className="growth-error">{error}</p>}
    <p className="growth-muted">{t('payment.renewHelp')}</p>
  </section>;
}
