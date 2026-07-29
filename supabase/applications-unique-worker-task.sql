-- QuickGigs — backstop: one application per worker per task
-- Run in Supabase SQL Editor. Safe to re-run.
-- worker_id = Firebase Auth uid (text); task_id = tasks.task_id (uuid/text).

-- Optional: inspect duplicates before creating the index
-- SELECT worker_id, task_id, COUNT(*) AS n
-- FROM applications
-- WHERE worker_id IS NOT NULL AND task_id IS NOT NULL
-- GROUP BY worker_id, task_id
-- HAVING COUNT(*) > 1;

-- Keep the newest row per (worker_id, task_id); delete older duplicates
DELETE FROM applications a
USING applications b
WHERE a.worker_id = b.worker_id
  AND a.task_id = b.task_id
  AND a.worker_id IS NOT NULL
  AND a.task_id IS NOT NULL
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS applications_worker_task_uidx
  ON applications (worker_id, task_id)
  WHERE worker_id IS NOT NULL AND task_id IS NOT NULL;
