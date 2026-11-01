import { create } from 'zustand';
import { api } from '@/api';
import type { FocusRecord } from '@/types';
import { adjustFund, cancelPaymentOrder, configurePayment, confirmPaymentOrder, createPaymentOrder, defaultPaymentSettings, initialGrowth, positiveInteger, redeemReward, saveReward, settleFocus, validPaymentSettings, type GrowthData, type PaymentRequest, type PaymentSettings, type Reward } from '@/lib/growth';

interface GrowthState {
  data: GrowthData | null;
  error: string;
  reconcile(records: FocusRecord[]): Promise<void>;
  saveReward(reward: Reward): Promise<void>;
  removeReward(id: string): Promise<void>;
  redeem(id: string): Promise<void>;
  withdraw(cents: number): Promise<void>;
  configurePayment(settings: PaymentSettings): Promise<void>;
  startPayment(request: PaymentRequest): Promise<void>;
  confirmPayment(id: string): Promise<void>;
  cancelPayment(id: string): Promise<void>;
  setRate(rate: number): Promise<void>;
}
// 全部操作排队、写库成功后发布；连续点击/归档刷新不会覆盖另一笔交易。
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => {});
  return next;
}
async function load(): Promise<GrowthData | null> {
  const raw = (await api.get_settings()).growth_data;
  if (!raw) return null;
  const saved = JSON.parse(raw) as GrowthData;
  // 旧版账本无支付字段，补默认值并保留余额与全部历史记录。
  const s: GrowthData = { ...saved,
    membershipUntil: saved.membershipUntil === undefined ? 0 : saved.membershipUntil,
    paymentSettings: saved.paymentSettings === undefined ? defaultPaymentSettings() : saved.paymentSettings,
    paymentOrders: saved.paymentOrders === undefined ? [] : saved.paymentOrders };
  if (s.version !== 1 || !Array.isArray(s.processedIds) || !Array.isArray(s.rewards) || !Array.isArray(s.entries)
    || !Number.isFinite(s.startedAt) || !s.processedIds.every(id => typeof id === 'string')
    || !Number.isSafeInteger(s.focusSeconds) || s.focusSeconds < 0 || !Number.isSafeInteger(s.fundCents) || s.fundCents < 0
    || !Number.isSafeInteger(s.spentCoins) || s.spentCoins < 0 || s.spentCoins > Math.floor(s.focusSeconds / 60)
    || !positiveInteger(s.coinsPerYuan, 10000)
    || !s.rewards.every(r => r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.note === 'string'
      && positiveInteger(r.memberCents) && (r.regularCents === null || (positiveInteger(r.regularCents) && r.regularCents >= r.memberCents))
      && ['shop', 'level'].includes(r.kind) && positiveInteger(r.level, 1000))
    || !s.entries.every(e => e && typeof e.id === 'string' && typeof e.name === 'string' && Number.isFinite(e.at)
      && Number.isSafeInteger(e.cents) && Number.isSafeInteger(e.coins) && ['deposit', 'withdraw', 'shop', 'level', 'membership'].includes(e.kind)
      && (e.kind !== 'level' || positiveInteger(e.level ?? 0, 1000)))
    || s.entries.reduce((n, e) => n + e.cents, 0) !== s.fundCents
    || s.entries.reduce((n, e) => n - e.coins, 0) !== s.spentCoins
    || !Number.isSafeInteger(s.membershipUntil) || s.membershipUntil < 0 || !validPaymentSettings(s.paymentSettings)
    || !Array.isArray(s.paymentOrders) || !s.paymentOrders.every(o => o && typeof o.id === 'string'
      && ['deposit', 'membership'].includes(o.kind) && ['pending', 'confirmed', 'cancelled'].includes(o.status)
      && positiveInteger(o.cents) && Number.isFinite(o.createdAt)
      && (o.kind === 'membership' ? o.plan === 'weekly' || o.plan === 'monthly' : o.plan === null)
      && (o.status === 'confirmed' ? Number.isFinite(o.confirmedAt) : o.confirmedAt === null))
    || new Set(s.paymentOrders.map(o => o.id)).size !== s.paymentOrders.length
    || s.paymentOrders.filter(o => o.status === 'pending').length > 1
    || s.paymentOrders.some(o => o.status === 'confirmed' && !s.entries.some(e => e.orderId === o.id && e.cents === o.cents && e.kind === o.kind))) throw new Error('corrupt');
  return s;
}
async function commit(data: GrowthData) {
  await api.set_setting('growth_data', JSON.stringify(data));
  useGrowthStore.setState({ data, error: '' });
}
function change(update: (s: GrowthData) => GrowthData): Promise<void> {
  return serial(async () => {
    const stored = await load();
    if (!stored) throw new Error('missing');
    const records = await api.list_focus_records();
    await commit(update(settleFocus(stored, records)));
  });
}
export const useGrowthStore = create<GrowthState>(() => ({
  data: null,
  error: '',
  reconcile: records => serial(async () => {
    try {
      const stored = await load();
      const next = stored ? settleFocus(stored, records) : initialGrowth(records);
      if (next !== stored) await commit(next);
      else useGrowthStore.setState({ data: next, error: '' });
    } catch {
      useGrowthStore.setState({ data: null, error: 'load' });
    }
  }),
  saveReward: reward => change(s => saveReward(s, reward)),
  removeReward: id => change(s => ({ ...s, rewards: s.rewards.filter(r => r.id !== id) })),
  redeem: id => change(s => redeemReward(s, id, crypto.randomUUID())),
  withdraw: cents => change(s => {
    if (!positiveInteger(cents)) throw new Error('invalid');
    return adjustFund(s, -cents, crypto.randomUUID());
  }),
  configurePayment: settings => change(s => configurePayment(s, settings)),
  startPayment: request => change(s => createPaymentOrder(s, crypto.randomUUID(), request)),
  confirmPayment: id => change(s => confirmPaymentOrder(s, id)),
  cancelPayment: id => change(s => cancelPaymentOrder(s, id)),
  setRate: coinsPerYuan => change(s => {
    if (!positiveInteger(coinsPerYuan, 10000)) throw new Error('invalid');
    return { ...s, coinsPerYuan };
  }),
}));
