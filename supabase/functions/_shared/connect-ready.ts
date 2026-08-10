/**
 * QuickGigs — Stripe Connect Express readiness helpers.
 * Ready = charges_enabled && payouts_enabled (platform can transfer to the account).
 */
export type ConnectReadyResult = {
  ready: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

export function connectAccountReady(account: {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
} | null | undefined): ConnectReadyResult {
  const charges_enabled = !!(account && account.charges_enabled);
  const payouts_enabled = !!(account && account.payouts_enabled);
  const details_submitted = !!(account && account.details_submitted);
  return {
    ready: charges_enabled && payouts_enabled,
    charges_enabled,
    payouts_enabled,
    details_submitted,
  };
}

/** transfer_group tag for escrow → release matching */
export function taskTransferGroup(taskId: string): string {
  const id = String(taskId || '').trim();
  return id ? `task_${id}` : 'task_unknown';
}
