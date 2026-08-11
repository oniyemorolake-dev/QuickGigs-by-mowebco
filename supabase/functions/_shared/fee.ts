/**
 * QuickGigs — platform fee math (server). Keep in sync with /feeBreakdown.js + qg-config.js
 *
 * Model: poster funds agreed task amount into escrow (no fee on top).
 * Tasker pays platform fee deducted from payout.
 *
 * Rate: PLATFORM_FEE_PERCENT env (default 15) — matches QG_CONFIG.taskerFeePercent.
 * Future: POSTER_FEE_PERCENT env (default 0) — not charged yet.
 */
export function getTaskerFeePercent(): number {
  const envPct = Number(Deno.env.get('PLATFORM_FEE_PERCENT') || '');
  if (isFinite(envPct) && envPct >= 0) return envPct;
  return 15;
}

/** Future poster-side fee % — reserved; create-checkout still charges task amount only. */
export function getPosterFeePercent(): number {
  const envPct = Number(Deno.env.get('POSTER_FEE_PERCENT') || '');
  if (isFinite(envPct) && envPct >= 0) return envPct;
  return 0;
}

/** @deprecated Prefer getTaskerFeePercent — kept for older imports */
export const FEE = {
  get oneoff() {
    return getTaskerFeePercent() / 100;
  },
  get recurring() {
    return getTaskerFeePercent() / 100;
  },
  get oneoff_sub() {
    return getTaskerFeePercent() / 100;
  },
  get recurring_sub() {
    return getTaskerFeePercent() / 100;
  },
};

export function feeRate(_opts: { isRecurring?: boolean; isSubscriber?: boolean } = {}): number {
  return getTaskerFeePercent() / 100;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function feeBreakdown(
  amount: number,
  _opts: { isRecurring?: boolean; isSubscriber?: boolean } = {},
) {
  const total = round2(amount);
  const safeTotal = !isFinite(total) || total < 0 ? 0 : total;
  const taskerPct = getTaskerFeePercent();
  const rate = taskerPct / 100;
  const fee = round2(safeTotal * rate);
  const payout = round2(safeTotal - fee);
  const posterPct = getPosterFeePercent();
  const posterFee = round2(safeTotal * (posterPct / 100));
  const posterPays = round2(safeTotal + posterFee);
  const ratePct = Math.round(taskerPct);
  return {
    total: safeTotal,
    fee,
    payout,
    rate,
    ratePct,
    percent: ratePct,
    posterFee,
    posterPays,
    taskerFeePercent: taskerPct,
    posterFeePercent: posterPct,
  };
}

/** Escrow split using configured tasker fee (amount − fee → tasker). */
export function escrowSplit15(amount: number) {
  return feeBreakdown(amount);
}

export function periodTotal(hourlyRate: number, hours: number): number {
  return round2((Number(hourlyRate) || 0) * (Number(hours) || 0));
}
