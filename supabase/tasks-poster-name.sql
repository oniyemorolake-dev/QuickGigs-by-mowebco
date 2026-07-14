-- QuickGigs — store poster display name on tasks (run in Supabase SQL Editor)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_name TEXT;
