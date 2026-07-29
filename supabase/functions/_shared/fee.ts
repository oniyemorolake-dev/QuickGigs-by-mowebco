/**
 * QuickGigs — platform fee math (server). Keep in sync with /feeBreakdown.js
 *
 * one-off 25% | recurring 10% | one-off subscriber 20% | recurring subscriber 8%
 */
export const FEE = {
  oneoff: 0.25,
  recurring: 0.10,
  oneoff_sub: 0.20,
  recurring_sub: 0.08,
} as const;

export function feeRate(opts: { isRecurring?: boolean; isSubscriber?: boolean } = {}): number {
  const isRecurring = !!opts.isRecurring;
  const isSubscriber = !!opts.isSubscriber;
  if (isRecurring) return isSubscriber ? FEE.recurring_sub : FEE.recurring;
  return isSubscriber ? FEE.oneoff_sub : FEE.oneoff;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function feeBreakdown(
  amount: number,
  opts: { isRecurring?: boolean; isSubscriber?: boolean } = {},
) {
  const total = round2(amount);
  const safeTotal = !isFinite(total) || total < 0 ? 0 : total;
  const rate = feeRate(opts);
  const fee = round2(safeTotal * rate);
  const payout = round2(safeTotal - fee);
  const ratePct = Math.round(rate * 100);
  return { total: safeTotal, fee, payout, rate, ratePct, percent: ratePct };
}

export function periodTotal(hourlyRate: number, hours: number): number {
  return round2((Number(hourlyRate) || 0) * (Number(hours) || 0));
}
