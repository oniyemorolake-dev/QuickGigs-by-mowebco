-- QuickGigs — reviews table RLS (run in Supabase SQL Editor)

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reviews" ON reviews;
DROP POLICY IF EXISTS "anon_insert_reviews" ON reviews;

CREATE POLICY "anon_select_reviews" ON reviews FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_reviews" ON reviews FOR INSERT TO anon WITH CHECK (true);
