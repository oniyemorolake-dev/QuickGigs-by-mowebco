-- QuickGigs — daily age-18 graduation check.
-- Before running, create Vault secrets:
--   graduation_function_url = https://<project>.supabase.co/functions/v1/graduate-account
--   graduation_cron_secret  = same value as the Edge Function GRADUATION_CRON_SECRET

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quickgigs-daily-account-graduation') THEN
    PERFORM cron.unschedule('quickgigs-daily-account-graduation');
  END IF;
END $$;

SELECT cron.schedule(
  'quickgigs-daily-account-graduation',
  '15 8 * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'graduation_function_url'
      LIMIT 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'graduation_cron_secret'
        LIMIT 1
      )
    ),
    body := '{"mode":"cron"}'::jsonb
  );
  $$
);
