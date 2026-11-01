import type { FocusRecord } from '@/types';

export interface Reward {
  id: string;
  name: string;
  note: string;
  memberCents: number;
  regularCents: number | null;
  kind: 'shop' | 'level';
  level: number;
}
export interface GrowthEntry {
  id: string;
  at: number;
  kind: 'deposit' | 'withdraw' | 'shop' | 'level' | 'membership';
  name: string;
  cents: number;
  coins: number;
  level?: number;
  orderId?: string;
  plan?: MembershipPlan;
}
export type MembershipPlan = 'weekly' | 'monthly';
export interface PaymentSettings {
  wechatQr: string;
  alipayQr: string;
  weeklyCents: number;
  monthlyCents: number;
  accountNote: string;
}
export interface PaymentOrder {
  id: string;
  kind: 'membership' | 'deposit';
  plan: MembershipPlan | null;
  cents: number;
  createdAt: number;
  confirmedAt: number | null;
  status: 'pending' | 'confirmed' | 'cancelled';
}
export type PaymentRequest = { kind: 'membership'; plan: MembershipPlan } | { kind: 'deposit'; cents: number };
export const defaultPaymentSettings = (): PaymentSettings => ({
  wechatQr: '', alipayQr: '', weeklyCents: 600, monthlyCents: 1800, accountNote: '',
});
export interface GrowthData {
  version: 1;
  startedAt: number;
  processedIds: string[];
  focusSeconds: number;
  spentCoins: number;
  fundCents: number;
  coinsPerYuan: number;
  rewards: Reward[];
  entries: GrowthEntry[];
  membershipUntil: number;
  paymentSettings: PaymentSettings;
  paymentOrders: PaymentOrder[];
}
export type GrowthError = 'invalid' | 'coins' | 'fund' | 'locked' | 'claimed' | 'duplicate' | 'missing' | 'qr' | 'pending';
export function fail(code: GrowthError): never { throw new Error(code); }
export function initialGrowth(records: FocusRecord[], now = Date.now()): GrowthData {
  return { version: 1, startedAt: now, processedIds: records.map(r => r.id), focusSeconds: 0,
    spentCoins: 0, fundCents: 0, coinsPerYuan: 10, rewards: [], entries: [],
    membershipUntil: 0, paymentSettings: defaultPaymentSettings(), paymentOrders: [] };
}
export function positiveInteger(n: number, max = 100_000_000): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= max;
}
export function yuanToCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return fail('invalid');
  const cents = Math.round(Number(value) * 100);
  if (!positiveInteger(cents)) return fail('invalid');
  return cents;
}
export const earnedCoins = (s: GrowthData) => Math.floor(s.focusSeconds / 60);
export const experience = (s: GrowthData) => Math.floor(s.focusSeconds / 6);
export const coinBalance = (s: GrowthData) => earnedCoins(s) - s.spentCoins;
// Lv.1=0 XP, Lv.2=600 XP, Lv.3=1800 XP；每级比上一级多需 600 XP。
export const levelThreshold = (level: number) => 300 * level * (level - 1);
export const currentLevel = (s: GrowthData) => Math.floor((1 + Math.sqrt(1 + experience(s) / 75)) / 2);
export const coinCost = (s: GrowthData, r: Reward) => r.kind === 'level' ? 0 : Math.ceil(r.memberCents * s.coinsPerYuan / 100);

/** 累计秒数后取整；一条归档只入账一次，删除历史记录不会扣回已赚金币。 */
export function settleFocus(s: GrowthData, records: FocusRecord[]): GrowthData {
  const seen = new Set(s.processedIds);
  let seconds = 0;
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.phase !== 'focus' || r.end_at < s.startedAt || !Number.isFinite(r.duration_min)
      || !Number.isFinite(r.end_at - r.start_at) || r.duration_min <= 0) continue;
    // 限制为记录的有效时长，暂停时间不计入；避免分钟四舍五入多发。
    seconds += Math.max(0, Math.floor(Math.min(r.duration_min * 60, (r.end_at - r.start_at) / 1000)));
  }
  return seen.size === s.processedIds.length ? s : { ...s, processedIds: [...seen], focusSeconds: s.focusSeconds + seconds };
}
export function saveReward(s: GrowthData, r: Reward): GrowthData {
  if (!r.id || !r.name.trim() || r.name.trim().length > 80 || r.note.length > 500
    || !positiveInteger(r.memberCents) || (r.regularCents !== null && (!positiveInteger(r.regularCents) || r.regularCents < r.memberCents))
    || !['shop', 'level'].includes(r.kind) || !positiveInteger(r.level, 1000) || (r.kind === 'level' && r.level < 2)) fail('invalid');
  if (r.kind === 'level' && s.entries.some(e => e.kind === 'level' && e.level === r.level)) fail('claimed');
  if (r.kind === 'level' && s.rewards.some(x => x.id !== r.id && x.kind === 'level' && x.level === r.level)) fail('duplicate');
  return { ...s, rewards: [...s.rewards.filter(x => x.id !== r.id), { ...r, name: r.name.trim(), note: r.note.trim() }] };
}
export function redeemProblem(s: GrowthData, r: Reward): GrowthError | null {
  if (r.kind === 'level' && s.entries.some(e => e.kind === 'level' && e.level === r.level)) return 'claimed';
  if (r.kind === 'level' && currentLevel(s) < r.level) return 'locked';
  if (coinBalance(s) < coinCost(s, r)) return 'coins';
  if (s.fundCents < r.memberCents) return 'fund';
  return null;
}
export function redeemReward(s: GrowthData, id: string, entryId: string, now = Date.now()): GrowthData {
  const r = s.rewards.find(r => r.id === id);
  if (!r) return fail('missing');
  const problem = redeemProblem(s, r);
  if (problem) return fail(problem);
  const coins = coinCost(s, r);
  return { ...s, spentCoins: s.spentCoins + coins, fundCents: s.fundCents - r.memberCents,
    entries: [...s.entries, { id: entryId, at: now, kind: r.kind, name: r.name, cents: -r.memberCents, coins: coins ? -coins : 0,
      ...(r.kind === 'level' ? { level: r.level } : {}) }] };
}
export function adjustFund(s: GrowthData, cents: number, id: string, now = Date.now()): GrowthData {
  if (!positiveInteger(Math.abs(cents)) || !Number.isSafeInteger(s.fundCents + cents)) fail('invalid');
  if (s.fundCents + cents < 0) fail('fund');
  return { ...s, fundCents: s.fundCents + cents, entries: [...s.entries,
    { id, at: now, kind: cents > 0 ? 'deposit' : 'withdraw', name: '', cents, coins: 0 }] };
}

/** 收款码只接收本地静态图片，避免远程内容变化或可执行 SVG。 */
export function validQrImage(value: string): boolean {
  return typeof value === 'string' && value.length <= 2_800_000
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
export function validPaymentSettings(p: PaymentSettings): boolean {
  return !!p && (p.wechatQr === '' || validQrImage(p.wechatQr))
    && (p.alipayQr === '' || validQrImage(p.alipayQr)) && positiveInteger(p.weeklyCents)
    && positiveInteger(p.monthlyCents) && typeof p.accountNote === 'string' && p.accountNote.length <= 200;
}
export function configurePayment(s: GrowthData, settings: PaymentSettings): GrowthData {
  if (!validPaymentSettings(settings)) fail('invalid');
  if (s.paymentOrders.some(o => o.status === 'pending')) fail('pending');
  return { ...s, paymentSettings: { ...settings, accountNote: settings.accountNote.trim() } };
}
export function createPaymentOrder(s: GrowthData, id: string, request: PaymentRequest, now = Date.now()): GrowthData {
  if (!id || s.paymentOrders.some(o => o.id === id)) fail('invalid');
  if (s.paymentOrders.some(o => o.status === 'pending')) fail('pending');
  if (!validQrImage(s.paymentSettings.wechatQr) || !validQrImage(s.paymentSettings.alipayQr)) fail('qr');
  if (request.kind === 'membership' && !['weekly', 'monthly'].includes(request.plan)) fail('invalid');
  const cents = request.kind === 'deposit' ? request.cents : request.plan === 'weekly' ? s.paymentSettings.weeklyCents : s.paymentSettings.monthlyCents;
  if (!positiveInteger(cents)) fail('invalid');
  return { ...s, paymentOrders: [...s.paymentOrders, { id, kind: request.kind, plan: request.kind === 'membership' ? request.plan : null,
    cents, createdAt: now, confirmedAt: null, status: 'pending' }] };
}
export function extendMembership(from: number, plan: MembershipPlan): number {
  const date = new Date(from);
  if (plan === 'weekly') date.setDate(date.getDate() + 7);
  else {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, end));
  }
  return date.getTime();
}
/** 用户自报付款成功即全额入账，不查询支付平台；订单 ID 保证重复确认幂等。 */
export function confirmPaymentOrder(s: GrowthData, id: string, now = Date.now()): GrowthData {
  const order = s.paymentOrders.find(o => o.id === id);
  if (!order || order.status === 'cancelled') fail('missing');
  if (order.status === 'confirmed') return s;
  if (!Number.isSafeInteger(s.fundCents + order.cents)) fail('invalid');
  return { ...s, fundCents: s.fundCents + order.cents,
    membershipUntil: order.kind === 'membership' && order.plan ? extendMembership(Math.max(now, s.membershipUntil), order.plan) : s.membershipUntil,
    paymentOrders: s.paymentOrders.map(o => o.id === id ? { ...o, status: 'confirmed', confirmedAt: now } : o),
    entries: [...s.entries, { id: `payment:${id}`, orderId: id, kind: order.kind, name: '', cents: order.cents, coins: 0, at: now,
      ...(order.plan ? { plan: order.plan } : {}) }] };
}
export function cancelPaymentOrder(s: GrowthData, id: string): GrowthData {
  return { ...s, paymentOrders: s.paymentOrders.map(o => o.id === id && o.status === 'pending' ? { ...o, status: 'cancelled' } : o) };
}
