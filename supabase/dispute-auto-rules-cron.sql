-- QuickGigs — daily dispute auto-rules (auto-release + no-show flag)
-- Vault secrets:
--   dispute_auto_rules_url = https://<project>.supabase.co/functions/v1/dispute-auto-rules
--   dispute_cron_secret    = same as Edge Function DISPUTE_CRON_SECRET (or reuse graduation_cron_secret)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quickgigs-dispute-auto-rules') THEN
    PERFORM cron.unschedule('quickgigs-dispute-auto-rules');
  END IF;
END $$;

SELECT cron.schedule(
  'quickgigs-dispute-auto-rules',
  '45 8 * * *',
  $$
  SELECT net.http_post(
    url := COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dispute_auto_rules_url' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'graduation_function_url' LIMIT 1)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dispute_cron_secret' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'graduation_cron_secret' LIMIT 1)
      )
    ),
    body := '{"mode":"cron"}'::jsonb
  );
  $$
);
