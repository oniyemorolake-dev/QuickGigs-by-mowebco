-- =============================================================================
-- QuickGigs — canonical schema (single source of truth)
-- Supabase project: nuyfqsxstsrbloztzgau
--
-- Run in the Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Safe to re-run (idempotent): IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- CREATE INDEX IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
-- Do NOT rename existing tables or columns. Column names match live client
-- selects/writes in supabase-db.js (SELECT_* constants) and related pages.
-- Never commit real API keys or service-role secrets here — schema only.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------- users ----------
-- Live: SELECT_USERS_SELF / SELF_CORE / PUBLIC in supabase-db.js
CREATE TABLE IF NOT EXISTS users (
  user_id                   TEXT PRIMARY KEY,
  firebase_uid              TEXT,
  name                      TEXT,
  email                     TEXT,
  phone                     TEXT,
  avatar_url                TEXT,
  role                      TEXT DEFAULT 'poster',
  is_tasker                 BOOLEAN NOT NULL DEFAULT TRUE,
  is_poster                 BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_mode          TEXT NOT NULL DEFAULT 'tasker',
  roles_updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                    TEXT DEFAULT 'active',
  account_status            TEXT DEFAULT 'active',
  bio                       TEXT,
  skills                    TEXT,
  pronouns                  TEXT,
  availability              TEXT DEFAULT 'available',
  service_area              TEXT,
  languages                 TEXT,
  gender                    TEXT,
  date_of_birth             DATE,
  identity_collected_at     TIMESTAMPTZ,
  guardian_name             TEXT,
  guardian_email            TEXT,
  guardian_phone            TEXT,
  guardian_consent_status   TEXT DEFAULT 'not_required',
  guardian_consent_at       TIMESTAMPTZ,
  guardian_consent_sent_at  TIMESTAMPTZ,
  guardian_consent_token    TEXT,
  consent_token             TEXT,
  consent_token_expires_at  TIMESTAMPTZ,
  consent_accepted_at       TIMESTAMPTZ,
  email_verified            BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified               BOOLEAN NOT NULL DEFAULT FALSE,
  tasker_verified           BOOLEAN NOT NULL DEFAULT FALSE,
  tasker_verified_at        TIMESTAMPTZ,
  tasker_verification_status TEXT NOT NULL DEFAULT 'unverified',
  tasker_identity_session_id TEXT,
  tasker_background_check_status TEXT NOT NULL DEFAULT 'not_started',
  tasker_background_checked_at TIMESTAMPTZ,
  poster_verified           BOOLEAN NOT NULL DEFAULT FALSE,
  poster_verified_at        TIMESTAMPTZ,
  poster_verification_status TEXT NOT NULL DEFAULT 'unverified',
  poster_stripe_customer_id TEXT,
  poster_payment_method_id  TEXT,
  is_subscriber             BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_connect_id         TEXT,
  stripe_payouts_enabled    BOOLEAN DEFAULT FALSE,
  guardian_stripe_connect_id TEXT,
  guardian_stripe_payouts_enabled BOOLEAN DEFAULT FALSE,
  graduated_at              TIMESTAMPTZ,
  payout_owner              TEXT NOT NULL DEFAULT 'self',
  review_flag               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_tasker BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_poster BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_mode TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS availability TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS service_area TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS languages TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_collected_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_token_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tasker_verified BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tasker_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tasker_verification_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tasker_identity_session_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tasker_background_check_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tasker_background_checked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS poster_verified BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS poster_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS poster_verification_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS poster_stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS poster_payment_method_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_subscriber BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_stripe_connect_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_stripe_payouts_enabled BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_owner TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS review_flag BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE users
SET is_tasker = TRUE,
    is_poster = TRUE,
    last_active_mode = CASE WHEN LOWER(COALESCE(role, '')) = 'worker' THEN 'tasker' ELSE 'poster' END,
    roles_updated_at = COALESCE(roles_updated_at, NOW())
WHERE is_tasker IS NULL OR is_poster IS NULL OR last_active_mode IS NULL OR roles_updated_at IS NULL;
UPDATE users
SET is_tasker = TRUE, is_poster = FALSE, last_active_mode = 'tasker', roles_updated_at = NOW()
WHERE date_of_birth IS NOT NULL
  AND date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::DATE;
ALTER TABLE users ALTER COLUMN is_tasker SET DEFAULT TRUE;
ALTER TABLE users ALTER COLUMN is_poster SET DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN last_active_mode SET DEFAULT 'tasker';
ALTER TABLE users ALTER COLUMN roles_updated_at SET DEFAULT NOW();
ALTER TABLE users ALTER COLUMN is_tasker SET NOT NULL;
ALTER TABLE users ALTER COLUMN is_poster SET NOT NULL;
ALTER TABLE users ALTER COLUMN last_active_mode SET NOT NULL;
ALTER TABLE users ALTER COLUMN roles_updated_at SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_has_role_check;
ALTER TABLE users ADD CONSTRAINT users_has_role_check CHECK (is_tasker OR is_poster);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_last_active_mode_check;
ALTER TABLE users ADD CONSTRAINT users_last_active_mode_check
  CHECK (
    (last_active_mode = 'tasker' AND is_tasker) OR
    (last_active_mode = 'poster' AND is_poster)
  );

UPDATE users SET payout_owner = 'self' WHERE payout_owner IS NULL;
ALTER TABLE users ALTER COLUMN payout_owner SET DEFAULT 'self';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_payout_owner_check;
ALTER TABLE users ADD CONSTRAINT users_payout_owner_check
  CHECK (payout_owner IN ('guardian', 'self'));
UPDATE users SET tasker_verified = FALSE WHERE tasker_verified IS NULL;
UPDATE users SET poster_verified = FALSE WHERE poster_verified IS NULL;
UPDATE users SET tasker_verification_status = 'unverified' WHERE tasker_verification_status IS NULL;
UPDATE users SET poster_verification_status = 'unverified' WHERE poster_verification_status IS NULL;
UPDATE users SET tasker_background_check_status = 'not_started' WHERE tasker_background_check_status IS NULL;
ALTER TABLE users ALTER COLUMN tasker_verified SET DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN poster_verified SET DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN tasker_verification_status SET DEFAULT 'unverified';
ALTER TABLE users ALTER COLUMN poster_verification_status SET DEFAULT 'unverified';
ALTER TABLE users ALTER COLUMN tasker_background_check_status SET DEFAULT 'not_started';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tasker_verification_status_check;
ALTER TABLE users ADD CONSTRAINT users_tasker_verification_status_check
  CHECK (tasker_verification_status IN ('unverified', 'pending', 'verified', 'rejected'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_poster_verification_status_check;
ALTER TABLE users ADD CONSTRAINT users_poster_verification_status_check
  CHECK (poster_verification_status IN ('unverified', 'pending', 'verified', 'failed'));

-- ---------- tasks ----------
-- Live: SELECT_TASKS_BROWSE / DETAIL — task_mode (not mode); rate_type, is_recurring, etc.
CREATE TABLE IF NOT EXISTS tasks (
  task_id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title              TEXT NOT NULL,
  description        TEXT,
  category           TEXT,
  task_mode          TEXT DEFAULT 'standard',
  budget             NUMERIC,
  location           TEXT,
  status             TEXT DEFAULT 'open',
  posted_by          TEXT,
  poster_name        TEXT,
  budget_negotiable  BOOLEAN NOT NULL DEFAULT FALSE,
  photo_urls         TEXT,
  scheduled_at       TIMESTAMPTZ,
  scheduled_label    TEXT,
  requires_photos    BOOLEAN NOT NULL DEFAULT FALSE,
  rate_type          TEXT NOT NULL DEFAULT 'fixed',
  is_recurring       BOOLEAN NOT NULL DEFAULT FALSE,
  hourly_rate        NUMERIC(10,2),
  frequency          TEXT,
  est_hours          NUMERIC(6,2),
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  precise_address    TEXT,
  age_preference     TEXT NOT NULL DEFAULT 'adults_only',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_mode TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budget NUMERIC;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS posted_by TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budget_negotiable BOOLEAN;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_urls TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_label TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_photos BOOLEAN;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rate_type TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS frequency TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS est_hours NUMERIC(6,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS precise_address TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS age_preference TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE tasks SET age_preference = 'adults_only' WHERE age_preference IS NULL;
ALTER TABLE tasks ALTER COLUMN age_preference SET DEFAULT 'adults_only';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_rate_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_rate_type_check
  CHECK (rate_type IS NULL OR rate_type IN ('fixed', 'hourly'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_frequency_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_frequency_check
  CHECK (frequency IS NULL OR frequency IN ('weekly', 'biweekly', 'monthly'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_age_preference_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_age_preference_check
  CHECK (age_preference IN ('adults_only', 'teens_welcome', 'any_with_guardian'));

UPDATE tasks
SET lat = NULL, lng = NULL
WHERE (lat IS NULL) <> (lng IS NULL)
   OR lat NOT BETWEEN 41.5 AND 83.5
   OR lng NOT BETWEEN -141.1 AND -52.5;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_coordinates_pair_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_coordinates_pair_check
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_coordinates_range_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_coordinates_range_check
  CHECK (
    lat IS NULL OR
    (lat BETWEEN 41.5 AND 83.5 AND lng BETWEEN -141.1 AND -52.5)
  );

-- ---------- applications ----------
-- Live: SELECT_APPLICATIONS — app_id, counter_* negotiation columns
CREATE TABLE IF NOT EXISTS applications (
  app_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          TEXT NOT NULL,
  worker_id        TEXT NOT NULL,
  worker_name      TEXT,
  message          TEXT,
  price            NUMERIC,
  status           TEXT DEFAULT 'pending',
  counter_price    NUMERIC,
  counter_by       TEXT,
  counter_round    INT NOT NULL DEFAULT 0,
  last_counter_at  TIMESTAMPTZ,
  guardian_status  TEXT NOT NULL DEFAULT 'approved',
  guardian_reviewed_at TIMESTAMPTZ,
  guardian_distance_km NUMERIC(7,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS worker_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS worker_name TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS price NUMERIC;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_price NUMERIC;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_by TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_round INT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_counter_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS guardian_status TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS guardian_reviewed_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS guardian_distance_km NUMERIC(7,2);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE applications SET guardian_status = 'approved' WHERE guardian_status IS NULL;
ALTER TABLE applications ALTER COLUMN guardian_status SET DEFAULT 'approved';

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_guardian_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_guardian_status_check
  CHECK (guardian_status IN ('pending_guardian', 'approved', 'rejected'));

-- ---------- payments ----------
-- Live: SELECT_PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  payment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        TEXT NOT NULL,
  poster_id      TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  amount         NUMERIC NOT NULL DEFAULT 0,
  platform_fee   NUMERIC NOT NULL DEFAULT 0,
  worker_payout  NUMERIC NOT NULL DEFAULT 0,
  stripe_id      TEXT,
  transfer_id    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS poster_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS worker_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount NUMERIC;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS platform_fee NUMERIC;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS worker_payout NUMERIC;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transfer_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ---------- reviews ----------
-- Live: SELECT_REVIEWS — review_comment (not comment)
CREATE TABLE IF NOT EXISTS reviews (
  review_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         TEXT NOT NULL,
  reviewer_id     TEXT NOT NULL,
  reviewee_id     TEXT NOT NULL,
  rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_comment  TEXT NOT NULL DEFAULT '',
  reviewer_name   TEXT,
  task_title      TEXT,
  tags            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_id TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewee_id TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS task_title TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- ---------- conversations (required by messages.conv_id) ----------
-- Live: SELECT_CONVERSATIONS — task_id is TEXT in client (legacy BIGINT migrated)
CREATE TABLE IF NOT EXISTS conversations (
  conv_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               TEXT NOT NULL,
  poster_id             TEXT NOT NULL,
  worker_id             TEXT NOT NULL,
  poster_name           TEXT,
  worker_name           TEXT,
  task_title            TEXT,
  task_category         TEXT,
  status                TEXT NOT NULL DEFAULT 'in_progress',
  is_unlocked           BOOLEAN NOT NULL DEFAULT FALSE,
  last_message          TEXT,
  last_message_at       TIMESTAMPTZ,
  last_sender_id        TEXT,
  poster_last_read_at   TIMESTAMPTZ,
  worker_last_read_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, poster_id, worker_id)
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS poster_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS worker_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS poster_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS worker_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_title TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_category TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_unlocked BOOLEAN;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_sender_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS poster_last_read_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS worker_last_read_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- ---------- messages ----------
-- Live: SELECT_MESSAGES — keyed by conv_id (not task_id)
CREATE TABLE IF NOT EXISTS messages (
  message_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_id     UUID NOT NULL REFERENCES conversations (conv_id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS conv_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- ---------- reports ----------
CREATE TABLE IF NOT EXISTS reports (
  report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('task', 'user')),
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN
                 ('spam', 'scam', 'inappropriate', 'off_platform', 'other')),
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_id TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- ---------- blocks ----------
CREATE TABLE IF NOT EXISTS blocks (
  block_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  TEXT NOT NULL,
  blocked_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

ALTER TABLE blocks ADD COLUMN IF NOT EXISTS blocker_id TEXT;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS blocked_id TEXT;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- ---------- disputes ----------
CREATE TABLE IF NOT EXISTS disputes (
  dispute_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      TEXT NOT NULL,
  raised_by    TEXT NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN
                 ('not_done', 'not_as_described', 'no_show', 'payment', 'other')),
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS raised_by TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- tasks: status + created_at, task_mode, posted_by
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_mode ON tasks (task_mode);
CREATE INDEX IF NOT EXISTS idx_tasks_posted_by ON tasks (posted_by);

-- applications: task_id, worker_id
CREATE INDEX IF NOT EXISTS idx_apps_task ON applications (task_id);
CREATE INDEX IF NOT EXISTS idx_apps_worker ON applications (worker_id);

-- messages: live code keys by conv_id (not task_id)
CREATE INDEX IF NOT EXISTS idx_msgs_conv_created ON messages (conv_id, created_at);
CREATE INDEX IF NOT EXISTS idx_convs_task ON conversations (task_id);

-- reports: status + target
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id);

-- disputes: status + task_id
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_task ON disputes (task_id);

-- Supporting lookups (live code)
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_idx
  ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);
CREATE INDEX IF NOT EXISTS payments_task_idx ON payments (task_id);
CREATE INDEX IF NOT EXISTS reviews_reviewee_idx ON reviews (reviewee_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_task_reviewer_uniq ON reviews (task_id, reviewer_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — ADMIN SETUP
-- ═══════════════════════════════════════════════════════════════════════════

-- Server-side admin allow-list (Firebase UIDs). Frontend isAdmin() is UX only.
CREATE TABLE IF NOT EXISTS admins (
  user_id    TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert your Firebase UID once (Authentication → Users → User UID):
-- INSERT INTO admins (user_id) VALUES ('YOUR_FIREBASE_UID') ON CONFLICT DO NOTHING;

COMMENT ON TABLE admins IS 'Server-side admin allow-list. Never expose via anon key.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — RLS (COMMENTED OUT)
-- RUN ONLY AFTER Firebase JWT is linked to Supabase — enabling RLS
-- before that will lock the app out.
-- Admin (service-role Edge Function) reads all reports/disputes — never put
-- the service-role key in the frontend.
-- ═══════════════════════════════════════════════════════════════════════════

/*
ALTER TABLE reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insert own reports" ON reports;
CREATE POLICY "insert own reports" ON reports
  FOR INSERT WITH CHECK (reporter_id = auth.jwt() ->> 'sub');

DROP POLICY IF EXISTS "manage own blocks" ON blocks;
CREATE POLICY "manage own blocks" ON blocks
  FOR ALL USING (blocker_id = auth.jwt() ->> 'sub')
  WITH CHECK (blocker_id = auth.jwt() ->> 'sub');

DROP POLICY IF EXISTS "read own blocks" ON blocks;
CREATE POLICY "read own blocks" ON blocks
  FOR SELECT USING (
    blocker_id = auth.jwt() ->> 'sub'
    OR blocked_id = auth.jwt() ->> 'sub'
  );

DROP POLICY IF EXISTS "raise own disputes" ON disputes;
CREATE POLICY "raise own disputes" ON disputes
  FOR INSERT WITH CHECK (raised_by = auth.jwt() ->> 'sub');

DROP POLICY IF EXISTS "read own disputes" ON disputes;
CREATE POLICY "read own disputes" ON disputes
  FOR SELECT USING (raised_by = auth.jwt() ->> 'sub');
*/
