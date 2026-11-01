import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useGrowthStore } from '@/stores/growthStore';
import { useI18n } from '@/i18n';
import { useModalA11y } from '@/components/useModalA11y';
import { paymentError, paymentMoney } from '@/components/MembershipPanel';
import type { PaymentOrder, PaymentSettings } from '@/lib/growth';

export function PaymentModal() {
  const data = useGrowthStore(s => s.data);
  const order = data?.paymentOrders.find(o => o.status === 'pending');
  return data && order ? <PaymentDialog key={order.id} order={order} settings={data.paymentSettings} /> : null;
}
function PaymentDialog({ order, settings }: { order: PaymentOrder; settings: PaymentSettings }) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function finish(confirm: boolean) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      if (confirm) await useGrowthStore.getState().confirmPayment(order.id);
      else await useGrowthStore.getState().cancelPayment(order.id);
    } catch (e) { setError(t(paymentError(e))); }
    finally { busy.current = false; setPending(false); }
  }
  useModalA11y(true, () => { void finish(false); }, rootRef, '.payment-cancel');
  return <div className="overlay payment-overlay" onClick={() => void finish(false)}>
    <div className="modal payment-modal" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="payment-title" aria-describedby="payment-instructions" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h2 id="payment-title">{t(order.kind === 'membership' ? 'payment.membershipOrder' : 'payment.fundOrder')}</h2><button className="icon-btn" disabled={pending} aria-label={t('common.close')} onClick={() => void finish(false)}><X size={18} /></button></div>
      <div className="modal-body">
        <div className="payment-total"><span>{order.plan ? t(`payment.${order.plan}`) : t('growth.deposit')}</span><strong>¥{paymentMoney(order.cents)}</strong><small>{t('payment.fullCredit', { amount: paymentMoney(order.cents) })}</small></div>
        <p id="payment-instructions" className="growth-muted">{t('payment.scanHelp', { amount: paymentMoney(order.cents) })}</p>
        {settings.accountNote && <p className="payment-account">{t('payment.accountNote')}：{settings.accountNote}</p>}
        <div className="payment-qr-grid">{(['wechat', 'alipay'] as const).map(channel => <figure key={channel}>
          <figcaption>{t(`payment.${channel}`)}</figcaption><div><img src={channel === 'wechat' ? settings.wechatQr : settings.alipayQr} alt={t(`payment.${channel}`)} /></div>
        </figure>)}</div>
        <p className="growth-muted">{t('payment.selfReport')}</p>
        {error && <p role="alert" className="growth-error">{error}</p>}
        <div className="growth-actions payment-actions"><button className="btn payment-cancel" disabled={pending} onClick={() => void finish(false)}>{t('growth.cancel')}</button><button className="btn primary" disabled={pending} onClick={() => void finish(true)}>{t('payment.success')}</button></div>
      </div>
    </div>
  </div>;
}
