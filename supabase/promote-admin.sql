-- QuickGigs — promote console admin (run once in SQL Editor)
-- Sets users.role = 'admin' and email_verified = true for the operator account.
-- Safe to re-run. No passwords. Client gate checks role === 'admin' + verified/email_verified.
--
-- True enforcement remains server-side (admins table + service-role) later.

UPDATE users
SET
  role = 'admin',
  email_verified = TRUE
WHERE lower(email) = lower('mowebsiteco@gmail.com')
   OR firebase_uid = 'Tg08W7IiWpUEOjc103dmqMUBI4h1';

-- Confirm:
-- SELECT firebase_uid, email, role, email_verified FROM users
-- WHERE lower(email) = lower('mowebsiteco@gmail.com');
