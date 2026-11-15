-- On-demand page translation with a permanent cache.
-- Each English phrase is translated once per language and then served from here,
-- so the paid translation API is only ever called for text it has not seen.
create table if not exists public.translations (
  lang text not null,
  src_hash text not null,
  src text not null,
  out text not null,
  created_at timestamptz not null default now(),
  primary key (lang, src_hash)
);
alter table public.translations enable row level security;
revoke all on public.translations from anon, authenticated;

-- Monthly character budget, so translation can never run up a bill.
create table if not exists public.translate_usage (
  month text primary key,
  chars integer not null default 0
);
alter table public.translate_usage enable row level security;
revoke all on public.translate_usage from anon, authenticated;

create or replace function public.qg_translate_reserve(p_chars integer, p_cap integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  used integer;
begin
  if p_chars is null or p_chars <= 0 then return true; end if;
  insert into public.translate_usage (month, chars) values (m, 0)
    on conflict (month) do nothing;
  select chars into used from public.translate_usage where month = m for update;
  if used + p_chars > p_cap then return false; end if;
  update public.translate_usage set chars = chars + p_chars where month = m;
  return true;
end;
$$;
revoke all on function public.qg_translate_reserve(integer, integer) from public, anon, authenticated;
