-- QuickGigs — ensure tasks.created_at exists (fixes browse + My Tasks not loading)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS tasks_created_idx ON tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks (status, created_at DESC);
