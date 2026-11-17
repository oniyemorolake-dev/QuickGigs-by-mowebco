-- Database-level guarantees, so these can never depend on app code being right:
-- a gig has at most one live payment, and at most one accepted tasker.
create unique index if not exists payments_one_live_per_task
  on public.payments (task_id)
  where status in ('held', 'paid', 'completed');

create unique index if not exists applications_one_accepted_per_task
  on public.applications (task_id)
  where status = 'accepted';
