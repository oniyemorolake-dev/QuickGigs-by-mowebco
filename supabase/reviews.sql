-- QuickGigs — reviews table (run once in Supabase SQL Editor)
-- Safe to re-run — upgrades columns and restores anon insert (beta uses Firebase + anon key)

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

-- Upgrade older reviews tables that predate optional columns / TEXT task_id
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS task_title TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Drop FK so reviews can store task ids even when UI still has a legacy/alias id
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_task_id_fkey;

-- Production may have task_id as UUID; app sends TEXT (UUID or legacy numeric)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews'
      AND column_name = 'task_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE reviews ALTER COLUMN task_id TYPE TEXT USING task_id::text;
  END IF;
END $$;

ALTER TABLE reviews ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE reviews ALTER COLUMN reviewer_id SET NOT NULL;
ALTER TABLE reviews ALTER COLUMN reviewee_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS reviews_reviewee_idx ON reviews (reviewee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_task_idx ON reviews (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_task_reviewer_uniq ON reviews (task_id, reviewer_id);

GRANT SELECT, INSERT ON reviews TO anon, authenticated;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Remove secure-mode policies if rls-secure.sql was applied (app still uses anon key in beta)
DROP POLICY IF EXISTS "reviews_select_auth" ON reviews;
DROP POLICY IF EXISTS "reviews_insert_auth" ON reviews;
DROP POLICY IF EXISTS "anon_select_reviews" ON reviews;
DROP POLICY IF EXISTS "anon_insert_reviews" ON reviews;

CREATE POLICY "anon_select_reviews" ON reviews FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_reviews" ON reviews FOR INSERT TO anon WITH CHECK (true);
