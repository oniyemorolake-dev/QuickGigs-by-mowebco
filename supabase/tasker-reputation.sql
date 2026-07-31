-- QuickGigs — tasker reputation / reviews visibility
-- Run in Supabase SQL Editor after reviews.sql
--
-- Public can read reviews left for a tasker (aggregate rating + list).
-- Private stats (earnings, payment rows, email/phone) stay out of reviews policies.
-- Beta uses Firebase Auth + anon Supabase key, so SELECT is granted to anon/authenticated.

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Public read of reviews (needed for profile + posters viewing taskers)
DROP POLICY IF EXISTS "anon_select_reviews" ON reviews;
DROP POLICY IF EXISTS "authenticated_select_reviews" ON reviews;
DROP POLICY IF EXISTS "reviews_select_auth" ON reviews;
DROP POLICY IF EXISTS "reviews_select_public" ON reviews;

CREATE POLICY "reviews_select_public" ON reviews
  FOR SELECT TO anon, authenticated
  USING (true);

-- Inserts: reviewer writes their own review (beta: anon key + app check)
DROP POLICY IF EXISTS "anon_insert_reviews" ON reviews;
DROP POLICY IF EXISTS "reviews_insert_auth" ON reviews;
DROP POLICY IF EXISTS "reviews_insert_public" ON reviews;

CREATE POLICY "reviews_insert_public" ON reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- No public UPDATE/DELETE on reviews (reviewee read-only)
DROP POLICY IF EXISTS "anon_update_reviews" ON reviews;
DROP POLICY IF EXISTS "anon_delete_reviews" ON reviews;
DROP POLICY IF EXISTS "reviews_update_auth" ON reviews;
DROP POLICY IF EXISTS "reviews_delete_auth" ON reviews;

GRANT SELECT, INSERT ON reviews TO anon, authenticated;

-- Optional helper view for aggregate rating (still public-readable)
CREATE OR REPLACE VIEW public.tasker_reputation AS
SELECT
  r.reviewee_id AS tasker_id,
  ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
  COUNT(*)::integer AS review_count
FROM public.reviews r
GROUP BY r.reviewee_id;

GRANT SELECT ON public.tasker_reputation TO anon, authenticated;

COMMENT ON VIEW public.tasker_reputation IS
  'Public aggregate ratings for taskers. Completed job counts come from applications+tasks in the app.';
