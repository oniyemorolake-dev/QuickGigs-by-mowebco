-- Trigger and notification helpers must not be callable over PostgREST.
-- qg_apply_counter, qg_login_resolve, and the RLS helpers stay executable.

REVOKE ALL ON FUNCTION public.enforce_tasker_clearance_on_accept() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_qg_account_security_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_qg_application_guardian_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_qg_transaction_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_qg_verification_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qg_notify_application_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qg_notify_chat_unlocked() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qg_notify_message_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qg_notify_task_completed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qg_notify_user(text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qg_rate_limit_reports() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_active_qg_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_verified_tasker_on_acceptance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_qg_conversation_relationship() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_qg_message_sender() FROM PUBLIC, anon, authenticated;
