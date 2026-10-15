begin;

create temp table waitlist_checks (name text primary key, ok boolean, detail jsonb);

do $$
declare
  first jsonb;
  second jsonb;
  bad jsonb;
  n integer;
  row_name text;
  row_interest text;
  row_city text;
  row_email text;
begin
  first := public.join_waitlist('Ada Tester', 'Waitlist-Check@example.com', 'both', 'calgary');
  second := public.join_waitlist('Ada Updated', 'waitlist-check@example.com', 'earn', 'edmonton');

  select count(*)::int, min(name), min(interest), min(city), min(email)
    into n, row_name, row_interest, row_city, row_email
  from public.waitlist
  where email = 'waitlist-check@example.com';

  insert into waitlist_checks values (
    'one_row_updated',
    n = 1
      and row_name = 'Ada Updated'
      and row_interest = 'earn'
      and row_city = 'edmonton'
      and row_email = 'waitlist-check@example.com'
      and coalesce((first->>'ok')::boolean, false)
      and coalesce((first->>'already')::boolean, true) = false
      and coalesce((second->>'already')::boolean, false)
      and (first->>'position') = (second->>'position'),
    jsonb_build_object('first', first, 'second', second, 'name', row_name, 'interest', row_interest, 'city', row_city)
  );

  bad := public.join_waitlist('Ada Tester', 'not-an-email', 'both', 'calgary');
  insert into waitlist_checks values (
    'invalid_email_rejected',
    bad->>'error' = 'invalid_email' and coalesce((bad->>'ok')::boolean, true) = false,
    bad
  );

  if exists (select 1 from waitlist_checks where ok is not true) then
    raise exception 'waitlist checks failed: %', (
      select jsonb_agg(jsonb_build_object('name', name, 'detail', detail))
      from waitlist_checks where ok is not true
    );
  end if;
end
$$;

select name, ok, detail from waitlist_checks order by name;

set local role anon;
select count(*)::int as anon_visible_rows from public.waitlist;
select public.join_waitlist('No Name', 'still-bad', 'post', 'calgary') as anon_invalid;

rollback;
