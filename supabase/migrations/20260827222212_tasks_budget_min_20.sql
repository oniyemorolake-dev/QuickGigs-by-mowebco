-- QuickGigs — enforce $20 CAD minimum task budget (matches qg-config abuseLimits.minBudget).
-- Safe: production had 0 rows with budget < 20 or NULL at apply time.

ALTER TABLE public.tasks
  ALTER COLUMN budget SET NOT NULL;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_budget_min_20;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_budget_min_20 CHECK (budget >= 20);
