-- QuickGigs — indexes for browse pagination + common lookups
-- Run once in the Supabase SQL editor

create index if not exists idx_tasks_status_created on tasks (status, created_at desc);
create index if not exists idx_tasks_mode        on tasks (task_mode);
create index if not exists idx_tasks_posted_by   on tasks (posted_by);
create index if not exists idx_apps_task         on applications (task_id);
create index if not exists idx_apps_worker       on applications (worker_id);
-- messages are keyed by conv_id (not task_id); matches getMessagesForConversation
create index if not exists idx_msgs_conv         on messages (conv_id, created_at);
create index if not exists idx_convs_task         on conversations (task_id);
