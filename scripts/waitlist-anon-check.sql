begin;
select public.join_waitlist('Ada Tester', 'waitlist-check@example.com', 'both', 'calgary') as signed_up;
set local role anon;
select count(*)::int as anon_visible_rows from public.waitlist;
rollback;
