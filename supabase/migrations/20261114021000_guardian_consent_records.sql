-- Audit record of each parent/guardian decision (who signed, when, from where).
create table if not exists public.guardian_consents (
  id bigint generated always as identity primary key,
  teen_uid text not null,
  decision text not null check (decision in ('approved','declined')),
  guardian_email text,
  guardian_name_given text,
  signed_name text,
  confirmed_adult boolean not null default false,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists guardian_consents_teen_idx on public.guardian_consents (teen_uid, created_at desc);
alter table public.guardian_consents enable row level security;
revoke all on public.guardian_consents from anon, authenticated;
comment on table public.guardian_consents is 'Audit record of each parent/guardian decision. Server-only: no policies, so only the service role reads or writes it.';
