-- Every chat message refused for contact details or off-app payment talk.
-- Feeds the one-hour time-out and the admin "Going off-platform?" list.
create table if not exists public.contact_blocks (
  id bigint generated always as identity primary key,
  user_id text not null,
  conv_id text,
  task_id text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists contact_blocks_user_idx on public.contact_blocks (user_id, created_at desc);
alter table public.contact_blocks enable row level security;
revoke all on public.contact_blocks from anon, authenticated;

-- Profiles are public before any payment, so they get the listing filter too:
-- no phone numbers, emails, links or @handles in name, bio or skills.
create or replace function public.qg_block_profile_contact()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if (tg_op = 'INSERT'
      or new.name is distinct from old.name
      or new.bio is distinct from old.bio
      or new.skills is distinct from old.skills)
     and public.qg_text_has_contact(
       coalesce(new.name, '') || E'\n' || coalesce(new.bio, '') || E'\n' || coalesce(new.skills, '')) then
    raise exception 'profile_contact_not_allowed'
      using hint = 'Remove phone numbers, emails, links and social handles from your profile.';
  end if;
  return new;
end;
$$;
drop trigger if exists users_block_profile_contact on public.users;
create trigger users_block_profile_contact
  before insert or update of name, bio, skills on public.users
  for each row execute function public.qg_block_profile_contact();
