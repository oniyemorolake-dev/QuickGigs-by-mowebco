-- QuickGigs — admin allow-list (Firebase UIDs, not emails)
-- Run when wiring JWT + service-role admin API. Safe to re-run.
--
-- Frontend isAdmin() is UX only. Backend must check this table (or custom claim)
-- with the service-role key before delete / moderation / reading others' reports.

CREATE TABLE IF NOT EXISTS admins (
  user_id    TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert your Firebase UID once (Authentication → Users → User UID):
-- INSERT INTO admins (user_id) VALUES ('YOUR_FIREBASE_UID');

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- No anon policies: clients cannot read/write this table.
-- Service-role Edge Functions bypass RLS.

COMMENT ON TABLE admins IS 'Server-side admin allow-list. Never expose via anon key.';
