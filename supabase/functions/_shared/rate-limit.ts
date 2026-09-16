// Shared per-user rate limiting for edge functions.
//
// Counting happens in Postgres (public.qg_rate_limit_hit), not in function
// memory, because edge functions are horizontally scaled — an in-process
// counter would give each concurrent instance its own budget and the limit
// would mean nothing under exactly the load it exists to handle.
//
// Fails CLOSED on an unidentified caller, and OPEN on an infrastructure error:
// a broken limiter should not take posting or messaging down with it. Every
// open-fail is logged so it shows up rather than passing silently.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type RateLimitVerdict = {
  allowed: boolean;
  hits?: number;
  limit?: number;
  retryAfter?: number;
  reason?: string;
};

/** Central limit table — one place to tune, rather than scattered constants. */
export const LIMITS = {
  post_task:          { limit: 10, windowSeconds: 3600 },
  submit_application: { limit: 30, windowSeconds: 3600 },
  send_message:       { limit: 60, windowSeconds: 300 },
  create_report:      { limit: 10, windowSeconds: 3600 },
} as const;

export type LimitedAction = keyof typeof LIMITS;

export async function checkRateLimit(
  supabase: SupabaseClient,
  uid: string,
  action: LimitedAction,
): Promise<RateLimitVerdict> {
  const cfg = LIMITS[action];
  if (!cfg) return { allowed: true };

  if (!uid || !String(uid).trim()) {
    return { allowed: false, reason: 'no_uid' };
  }

  const { data, error } = await supabase.rpc('qg_rate_limit_hit', {
    p_uid: uid,
    p_action: action,
    p_limit: cfg.limit,
    p_window_seconds: cfg.windowSeconds,
  });

  if (error) {
    // Fail open, loudly. Denying every request because the counter is
    // unreachable would turn a limiter outage into a full outage.
    console.error(`rate_limit_unavailable action=${action} uid=${uid}:`, error.message);
    return { allowed: true, reason: 'limiter_unavailable' };
  }

  const v = (data ?? {}) as Record<string, unknown>;
  return {
    allowed: v.allowed === true,
    hits: typeof v.hits === 'number' ? v.hits : undefined,
    limit: typeof v.limit === 'number' ? v.limit : undefined,
    retryAfter: typeof v.retry_after === 'number' ? v.retry_after : undefined,
    reason: typeof v.reason === 'string' ? v.reason : undefined,
  };
}

/** Standard 429 body + Retry-After, for callers that just want to bail out. */
export function rateLimitResponse(
  verdict: RateLimitVerdict,
  corsHeaders: Record<string, string>,
): Response {
  const retryAfter = verdict.retryAfter ?? 60;
  return new Response(
    JSON.stringify({
      success: false,
      ok: false,
      error: 'rate_limited',
      retry_after: retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(retryAfter),
      },
    },
  );
}
