/**
 * QuickGigs — Stripe Connect readiness helpers.
 * Recipient / Express accounts can take transfers after hosted onboarding
 * without charges_enabled (the platform is the merchant).
 */
export type ConnectReadyResult = {
  ready: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

function capabilityActive(value: unknown): boolean {
  if (value === 'active' || value === true) return true;
  if (value && typeof value === 'object') {
    const status = (value as { status?: unknown }).status;
    return status === 'active' || status === true;
  }
  return false;
}

export function connectAccountReady(account: {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  capabilities?: { transfers?: unknown } | null;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: { stripe_transfers?: { status?: string } };
      };
    };
  } | null;
  requirements?: { currently_due?: unknown[] | null } | null;
} | null | undefined): ConnectReadyResult {
  const charges_enabled = !!(account && account.charges_enabled);
  const payouts_enabled = !!(account && account.payouts_enabled);
  const details_submitted = !!(account && account.details_submitted);
  const transfersActive = capabilityActive(account && account.capabilities && account.capabilities.transfers)
    || capabilityActive(
      account
      && account.configuration
      && account.configuration.recipient
      && account.configuration.recipient.capabilities
      && account.configuration.recipient.capabilities.stripe_balance
      && account.configuration.recipient.capabilities.stripe_balance.stripe_transfers
    );
  const due = account && account.requirements ? account.requirements.currently_due : null;
  const nothingDue = Array.isArray(due) && due.length === 0;
  return {
    ready: !!(
      (charges_enabled && payouts_enabled)
      || payouts_enabled
      || transfersActive
      || (details_submitted && (nothingDue || due == null))
    ),
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
