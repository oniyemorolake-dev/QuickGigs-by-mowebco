-- QuickGigs — reviews table (run once in Supabase SQL Editor)
-- Safe to re-run

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

CREATE INDEX IF NOT EXISTS reviews_reviewee_idx ON reviews (reviewee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_task_idx ON reviews (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_task_reviewer_uniq ON reviews (task_id, reviewer_id);

GRANT SELECT, INSERT ON reviews TO anon, authenticated;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reviews" ON reviews;
DROP POLICY IF EXISTS "anon_insert_reviews" ON reviews;

CREATE POLICY "anon_select_reviews" ON reviews FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_reviews" ON reviews FOR INSERT TO anon WITH CHECK (true);
