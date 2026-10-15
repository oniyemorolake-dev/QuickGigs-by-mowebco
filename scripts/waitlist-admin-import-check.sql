begin;
insert into public.waitlist (email) values ('Admin-Import-Check@example.com');
select email, name, interest, city, signed_up from public.waitlist where email = 'admin-import-check@example.com';
rollback;
