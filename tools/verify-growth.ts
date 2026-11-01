import { strict as assert } from 'node:assert';
import { cancelPaymentOrder, configurePayment, confirmPaymentOrder, createPaymentOrder, extendMembership, validQrImage, adjustFund, coinBalance, coinCost, currentLevel, experience, initialGrowth, levelThreshold, redeemProblem, redeemReward, saveReward, settleFocus, yuanToCents, type Reward } from '../src/lib/growth';
import type { FocusRecord } from '../src/types';
let checks = 0;
function test(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
const record = (id: string, seconds: number, phase = 'focus'): FocusRecord => ({
  id, task_id: null, list_id: null, start_at: 10_000, end_at: 10_000 + seconds * 1000,
  duration_min: seconds / 60, phase, created_at: 100_000,
});
const reward: Reward = { id: 'coffee', name: '咖啡', note: '', memberCents: 125, regularCents: 200, kind: 'shop', level: 2 };
const initial = initialGrowth([record('demo', 1500)], 1_000);
let s = settleFocus(initial, [record('demo', 1500), record('a', 25), record('b', 35), record('break', 300, 'break')]);
test('历史种子排除、休息排除、小段秒数累计', () => { assert.equal(coinBalance(s), 1); assert.equal(experience(s), 10); });
test('重复归档幂等', () => assert.equal(settleFocus(s, [record('a', 25)]), s));
test('删除历史不撤回收益', () => assert.equal(settleFocus(s, []), s));
test('非法时长排除', () => { const x = settleFocus(s, [record('nan', NaN), record('neg', -60)]); assert.equal(x.focusSeconds, s.focusSeconds); });
test('按实际时间限制四舍五入奖励', () => { const x = settleFocus(initial, [{ ...record('rounded', 35), duration_min: 1 }]); assert.equal(x.focusSeconds, 35); });
test('会员价按分向上换算金币，不用普通价', () => assert.equal(coinCost(s, reward), 13));
test('精确金额与非法金额', () => { assert.equal(yuanToCents('0.29'), 29); for (const v of ['NaN', '-1', '0', '1.001', 'Infinity', '1e2', '']) assert.throws(() => yuanToCents(v)); });
test('金币不足不能兑换', () => { s = saveReward(s, reward); assert.equal(redeemProblem(s, reward), 'coins'); assert.throws(() => redeemReward(s, reward.id, 'tx0'), /coins/); });
s = settleFocus(s, [record('focus', 720)]);
test('基金不足不能兑换', () => assert.equal(redeemProblem(s, reward), 'fund'));
s = adjustFund(s, 1000, 'deposit');
s = redeemReward(s, reward.id, 'tx1');
test('兑换同时扣金币与会员基金，快照保留会员价格', () => { assert.equal(coinBalance(s), 0); assert.equal(s.fundCents, 875); assert.equal(s.entries.at(-1)?.cents, -125); assert.equal(s.entries.at(-1)?.coins, -13); });
test('余额刚好可消费，连续兑换不会透支', () => assert.throws(() => redeemReward(s, reward.id, 'tx2'), /coins/));
test('基金不能取成负数', () => assert.throws(() => adjustFund(s, -876, 'withdraw'), /fund/));
test('价格和等级输入校验', () => { assert.throws(() => saveReward(s, { ...reward, memberCents: 300 })); assert.throws(() => saveReward(s, { ...reward, memberCents: NaN })); assert.throws(() => saveReward(s, { ...reward, name: '  ' })); });
const levelReward: Reward = { ...reward, id: 'lv2', kind: 'level', level: 2 };
s = saveReward(s, levelReward);
test('未达到等级不可领取', () => assert.equal(redeemProblem(s, levelReward), 'locked'));
s = settleFocus(s, [record('long', 2820)]); // 累计 3600 秒，600 XP
const xpBefore = experience(s);
test('等级边界', () => { assert.equal(xpBefore, 600); assert.equal(currentLevel(s), 2); assert.equal(levelThreshold(3), 1800); assert.equal(currentLevel({ ...s, focusSeconds: 3599 }), 1); });
s = redeemReward(s, levelReward.id, 'lvtx');
test('等级奖励只扣基金，保留金币与经验', () => { assert.equal(coinBalance(s), 47); assert.equal(experience(s), xpBefore); assert.equal(s.fundCents, 750); });
test('等级只能领取一次，删除重建不能绕过', () => { assert.throws(() => redeemReward(s, levelReward.id, 'lvtx2'), /claimed/); assert.throws(() => saveReward({ ...s, rewards: [] }, { ...levelReward, id: 'new' }), /claimed/); });
test('同等级不能配置多个奖励', () => { const base = saveReward(initial, levelReward); assert.throws(() => saveReward(base, { ...levelReward, id: 'second' }), /duplicate/); });
test('估值变更不改历史流水', () => { const next = { ...s, coinsPerYuan: 20 }; assert.equal(coinCost(next, reward), 25); assert.equal(next.entries.find(e => e.id === 'tx1')?.coins, -13); });
test('重启 JSON 往返不重复入账', () => { const restored = JSON.parse(JSON.stringify(s)); assert.deepEqual(settleFocus(restored, [record('long', 2820)]), s); });

const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1kAAAAASUVORK5CYII=';
let payment = initialGrowth([], 1000);
test('缺少收款码不能创建支付订单', () => assert.throws(() => createPaymentOrder(payment, 'noqr', { kind: 'membership', plan: 'weekly' }), /qr/));
payment = configurePayment(payment, { ...payment.paymentSettings, wechatQr: qr, alipayQr: qr });
test('只接收本地静态二维码图片', () => { assert.equal(validQrImage(qr), true); assert.equal(validQrImage('https://example.com/qr.png'), false); assert.equal(validQrImage('data:image/svg+xml;base64,PHN2Zz4='), false); });
payment = createPaymentOrder(payment, 'week', { kind: 'membership', plan: 'weekly' }, 2000);
test('支付展开尚不入账、不激活会员', () => { assert.equal(payment.fundCents, 0); assert.equal(payment.membershipUntil, 0); assert.equal(payment.entries.length, 0); });
test('待支付时不允许更换收款码或叠加订单', () => { assert.throws(() => configurePayment(payment, payment.paymentSettings), /pending/); assert.throws(() => createPaymentOrder(payment, 'other', { kind: 'deposit', cents: 100 }), /pending/); });
payment = confirmPaymentOrder(payment, 'week', 3000);
test('自觉确认周会员：全额入基金与七天有效期', () => { assert.equal(payment.fundCents, 600); assert.equal(payment.membershipUntil, new Date(3000).setDate(new Date(3000).getDate() + 7)); assert.equal(payment.entries[0].plan, 'weekly'); });
test('同一订单重复确认幂等', () => assert.equal(confirmPaymentOrder(payment, 'week', 4000), payment));
const oldExpiry = payment.membershipUntil;
payment = createPaymentOrder(payment, 'renew', { kind: 'membership', plan: 'weekly' }, 4000);
payment = confirmPaymentOrder(payment, 'renew', 4000);
test('有效期内续费从到期日顺延、全额累计基金', () => { assert.equal(payment.membershipUntil, extendMembership(oldExpiry, 'weekly')); assert.equal(payment.fundCents, 1200); });
payment = createPaymentOrder(payment, 'cancel', { kind: 'deposit', cents: 123 }, 5000);
payment = cancelPaymentOrder(payment, 'cancel');
test('取消支付不改变余额、不能确认已取消订单', () => { assert.equal(payment.fundCents, 1200); assert.throws(() => confirmPaymentOrder(payment, 'cancel'), /missing/); });
payment = createPaymentOrder(payment, 'topup', { kind: 'deposit', cents: 129 }, 6000);
const expiryBeforeTopup = payment.membershipUntil;
payment = confirmPaymentOrder(payment, 'topup', 7000);
test('基金扫码充值精确入账，不改变会员期限', () => { assert.equal(payment.fundCents, 1329); assert.equal(payment.membershipUntil, expiryBeforeTopup); });
test('月末与闰年续费不跳过二月', () => {
  assert.equal(new Date(extendMembership(new Date(2027, 0, 31, 12).getTime(), 'monthly')).getDate(), 28);
  const leap = new Date(extendMembership(new Date(2028, 0, 31, 12).getTime(), 'monthly'));
  assert.equal(leap.getMonth(), 1); assert.equal(leap.getDate(), 29); assert.equal(leap.getHours(), 12);
});
const afterExpiry = payment.membershipUntil + 24 * 3600000;
payment = createPaymentOrder(payment, 'expired', { kind: 'membership', plan: 'monthly' }, afterExpiry);
payment = confirmPaymentOrder(payment, 'expired', afterExpiry);
test('到期后购买从确认时刻开始，不回填过期时间', () => assert.equal(payment.membershipUntil, extendMembership(afterExpiry, 'monthly')));
test('付款金额取订单快照、不随配置变化', () => {
  let x = createPaymentOrder(payment, 'snapshot', { kind: 'membership', plan: 'monthly' });
  x = { ...x, paymentSettings: { ...x.paymentSettings, monthlyCents: 9900 } };
  const next = confirmPaymentOrder(x, 'snapshot');
  assert.equal(next.fundCents - x.fundCents, 1800);
});
test('付款订单重启后仍能确认且只入账一次', () => {
  const x = createPaymentOrder(payment, 'restart', { kind: 'deposit', cents: 25 });
  const next = confirmPaymentOrder(JSON.parse(JSON.stringify(x)), 'restart');
  assert.equal(next.fundCents - payment.fundCents, 25);
  assert.equal(confirmPaymentOrder(next, 'restart'), next);
});
console.log(`${checks} growth checks passed`);
