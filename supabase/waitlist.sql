-- SwiftGigs public waitlist fields on the existing admin waitlist table.
-- The table already stores invite status (waitlist_id, signed_up, invited_at).
-- This adds interest and city for the landing-page form and does not drop those columns.
-- Anyone may insert. Only admins may read. join_waitlist updates a repeat email.

alter table public.waitlist add column if not exists interest text;
alter table public.waitlist add column if not exists city text;
alter table public.waitlist add column if not exists updated_at timestamptz not null default now();

alter table public.waitlist drop constraint if exists waitlist_interest_check;
alter table public.waitlist add constraint waitlist_interest_check
  check (interest is null or interest in ('post', 'earn', 'both'));

alter table public.waitlist drop constraint if exists waitlist_city_check;
alter table public.waitlist add constraint waitlist_city_check
  check (city is null or city in ('calgary', 'edmonton', 'other'));

create or replace function public.waitlist_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(btrim(coalesce(new.email, '')));
  if new.name is not null then
    new.name := btrim(new.name);
  end if;
  if new.interest is not null then
    new.interest := lower(btrim(new.interest));
  end if;
  if new.city is not null then
    new.city := lower(btrim(new.city));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists waitlist_normalize_trg on public.waitlist;
create trigger waitlist_normalize_trg
  before insert or update on public.waitlist
  for each row execute function public.waitlist_normalize();

alter table public.waitlist enable row level security;

drop policy if exists "anon_select_waitlist" on public.waitlist;
drop policy if exists waitlist_insert_public on public.waitlist;
create policy waitlist_insert_public on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists waitlist_select_admin on public.waitlist;
create policy waitlist_select_admin on public.waitlist
  for select
  to anon, authenticated
  using (public.is_qg_admin());

revoke all on table public.waitlist from public, anon, authenticated;
grant insert on table public.waitlist to anon, authenticated;
grant select on table public.waitlist to anon, authenticated;

create or replace function public.join_waitlist(
  p_name text,
  p_email text,
  p_interest text,
  p_city text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_interest text := lower(btrim(coalesce(p_interest, '')));
  v_city text := lower(btrim(coalesce(p_city, '')));
  v_existed boolean := false;
  v_created timestamptz;
  v_position integer;
begin
  if v_name = '' or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if v_interest not in ('post', 'earn', 'both') then
    return jsonb_build_object('ok', false, 'error', 'invalid_interest');
  end if;
  if v_city not in ('calgary', 'edmonton', 'other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_city');
  end if;

  select exists(select 1 from public.waitlist w where w.email = v_email) into v_existed;

  insert into public.waitlist (email, name, interest, city)
  values (v_email, v_name, v_interest, v_city)
  on conflict (email) do update
    set name = excluded.name,
        interest = excluded.interest,
        city = excluded.city
  returning created_at into v_created;

  select 1 + count(*)::integer into v_position
  from public.waitlist w
  where w.created_at < v_created
     or (w.created_at = v_created and w.email < v_email);

  return jsonb_build_object(
    'ok', true,
    'already', v_existed,
    'position', v_position
  );
end;
$$;

revoke all on function public.waitlist_normalize() from public, anon, authenticated;
revoke all on function public.join_waitlist(text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, text) to anon, authenticated, service_role;

comment on table public.waitlist is
  'Launch waitlist plus admin invite tracking. Public insert, admin read. join_waitlist updates a repeat email instead of inserting a second row.';
