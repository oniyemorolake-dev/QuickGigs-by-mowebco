// QuickGigs — admin console API (reads + mutations via service role)
// Deploy: supabase functions deploy admin-console --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { corsHeaders, forbiddenJson, isQgAdmin, json } from '../_shared/admin-auth.ts';

const ALLOWED_USER_PATCH = new Set(['name', 'email', 'role', 'status', 'review_flag']);
const ALLOWED_ROLES = new Set(['poster', 'worker', 'both']);
const ALLOWED_USER_STATUS = new Set(['active', 'warned', 'banned']);
const ALLOWED_TASK_PATCH = new Set([
  'title', 'description', 'budget', 'location', 'location_type', 'status', 'category',
  'task_mode', 'posted_by', 'poster_name', 'age_preference', 'budget_negotiable',
]);
const ALLOWED_TASK_STATUS = new Set(['open', 'in_progress', 'completed', 'expired', 'removed', 'cancelled']);
const ALLOWED_REPORT_STATUS = new Set(['open', 'reviewing', 'resolved', 'dismissed', 'reviewed', 'actioned']);
const ALLOWED_DISPUTE_STATUS = new Set(['reviewing', 'resolved', 'rejected']);

function sanitizeUserPatch(patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED_USER_PATCH.has(k)) continue;
    if (k === 'role') {
      const role = String(v || '').toLowerCase();
      if (!ALLOWED_ROLES.has(role)) continue;
      out[k] = role;
      continue;
    }
    if (k === 'status') {
      const st = String(v || '').toLowerCase();
      if (!ALLOWED_USER_STATUS.has(st)) continue;
      out[k] = st;
      continue;
    }
    if (k === 'review_flag') {
      out[k] = v === true || v === 1 || v === 'true' || v === '1';
      continue;
    }
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function sanitizeTaskPatch(patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED_TASK_PATCH.has(k)) continue;
    if (k === 'status') {
      const st = String(v || '').toLowerCase();
      if (!ALLOWED_TASK_STATUS.has(st)) continue;
      out[k] = st;
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function logAction(
  supabase: ReturnType<typeof createClient>,
  adminEmail: string,
  actionType: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
) {
  await supabase.from('admin_actions').insert({
    admin_email: adminEmail,
    action_type: actionType,
    target_type: targetType || '',
    target_id: String(targetId || ''),
    detail,
  });
}

async function findUserRow(
  supabase: ReturnType<typeof createClient>,
  keys: { user_id?: string; firebase_uid?: string; email?: string },
) {
  const uid = String(keys.firebase_uid || '').trim();
  const userId = String(keys.user_id || '').trim();
  const email = String(keys.email || '').trim().toLowerCase();

  if (uid) {
    const { data } = await supabase.from('users').select('*').eq('firebase_uid', uid).maybeSingle();
    if (data) return data;
  }
  if (userId) {
    const { data } = await supabase.from('users').select('*').eq('user_id', userId).maybeSingle();
    if (data) return data;
  }
  if (email) {
    const { data } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function isAdminUser(
  supabase: ReturnType<typeof createClient>,
  firebaseUid: string,
): Promise<boolean> {
  if (!firebaseUid) return false;
  return isQgAdmin(supabase, firebaseUid);
}

async function hardDeleteTask(supabase: ReturnType<typeof createClient>, taskId: string) {
  const tid = String(taskId || '').trim();
  if (!tid) return { success: false, error: 'missing_task_id' };

  await supabase.from('applications').delete().eq('task_id', tid);
  const { data: convs } = await supabase.from('conversations').select('conv_id').eq('task_id', tid);
  for (const c of convs || []) {
    const cid = String(c.conv_id || '');
    if (!cid) continue;
    await supabase.from('messages').delete().eq('conv_id', cid);
  }
  await supabase.from('conversations').delete().eq('task_id', tid);
  await supabase.from('reviews').delete().eq('task_id', tid);
  await supabase.from('disputes').delete().eq('task_id', tid);

  let { error } = await supabase.from('tasks').delete().eq('task_id', tid);
  if (error) {
    const { data: row } = await supabase.from('tasks').select('id').eq('task_id', tid).maybeSingle();
    if (row?.id != null) {
      const res = await supabase.from('tasks').delete().eq('id', row.id);
      error = res.error;
    }
  }
  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function deleteUserCascade(
  supabase: ReturnType<typeof createClient>,
  userRow: Record<string, unknown>,
) {
  const firebaseUid = String(userRow.firebase_uid || '').trim();
  if (!firebaseUid) return { success: false, error: 'missing_uid' };
  if (await isAdminUser(supabase, firebaseUid)) {
    return { success: false, error: 'cannot_delete_admin' };
  }

  const { data: posted } = await supabase.from('tasks').select('task_id').eq('posted_by', firebaseUid);
  for (const t of posted || []) {
    const tid = String(t.task_id || '');
    if (tid) await hardDeleteTask(supabase, tid);
  }

  await supabase.from('applications').delete().eq('worker_id', firebaseUid);
  const { error } = await supabase.from('users').delete().eq('firebase_uid', firebaseUid);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function handleFetchDashboard(supabase: ReturnType<typeof createClient>) {
  const [
    users, tasks, disputes, reports, applications, waitlist, payments,
    adminActions, adminNotes, reviews, userWarnings, platformBanner,
  ] = await Promise.all([
    supabase.from('users').select('*').order('created_at', { ascending: false }).limit(2000),
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(2000),
    supabase.from('disputes').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('applications').select('*').order('created_at', { ascending: false }).limit(2000),
    supabase.from('waitlist').select('*').order('created_at', { ascending: false }).limit(2000),
    supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('admin_notes').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('reviews').select('*').order('created_at', { ascending: false }).limit(300),
    supabase.from('user_warnings').select('warning_id,user_id,reason,source,report_id,created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('platform_banner').select('*').eq('id', 1).maybeSingle(),
  ]);

  return json({
    success: true,
    ok: true,
    users: users.data || [],
    tasks: tasks.data || [],
    disputes: disputes.data || [],
    reports: reports.data || [],
    applications: applications.data || [],
    waitlist: waitlist.data || [],
    payments: payments.data || [],
    admin_actions: adminActions.data || [],
    admin_notes: adminNotes.data || [],
    reviews: reviews.data || [],
    user_warnings: userWarnings.data || [],
    platform_banner: platformBanner.data || null,
  });
}

async function handleFetchMeta(supabase: ReturnType<typeof createClient>) {
  const [adminActions, adminNotes] = await Promise.all([
    supabase.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('admin_notes').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  return json({
    success: true,
    ok: true,
    admin_actions: adminActions.data || [],
    admin_notes: adminNotes.data || [],
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let identity;
  try {
    identity = await requireFirebaseUser(req);
  } catch (err) {
    return json({ success: false, ok: false, error: 'unauthorized' }, authErrorStatus(err));
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '').trim();
  const adminOk = await isQgAdmin(supabase, identity.uid);

  if (action === 'verify') {
    if (!adminOk) return forbiddenJson();
    return json({ success: true, ok: true });
  }

  if (!adminOk) return forbiddenJson();

  const adminEmail = identity.email || '';

  try {
    switch (action) {
      case 'fetch_dashboard':
        return await handleFetchDashboard(supabase);

      case 'fetch_meta':
        return await handleFetchMeta(supabase);

      case 'user_patch': {
        const patch = sanitizeUserPatch(body.patch || {});
        if (!Object.keys(patch).length) return json({ success: false, error: 'invalid_patch' }, 400);
        const row = await findUserRow(supabase, {
          user_id: body.user_id,
          firebase_uid: body.firebase_uid,
          email: body.email,
        });
        if (!row) return json({ success: false, error: 'not_found' }, 404);
        const key = row.firebase_uid ? 'firebase_uid' : 'user_id';
        const val = row.firebase_uid || row.user_id;
        const { data, error } = await supabase.from('users').update(patch).eq(key, val).select().maybeSingle();
        if (error) return json({ success: false, error: 'update_failed' }, 500);
        await logAction(supabase, adminEmail, 'user_edit', 'user', String(row.firebase_uid || row.user_id), patch);
        return json({ success: true, ok: true, user: data });
      }

      case 'user_warn': {
        const uid = String(body.user_id || body.firebase_uid || '').trim();
        if (!uid) return json({ success: false, error: 'missing_user' }, 400);
        const reason = String(body.reason || 'Admin warning from console').trim();
        await supabase.from('user_warnings').insert({
          user_id: uid,
          reason,
          source: 'admin',
          report_id: body.report_id || null,
        });
        await supabase.from('users').update({ status: 'warned' }).eq('firebase_uid', uid);
        const warnings = await supabase.from('user_warnings').select('warning_id').eq('user_id', uid);
        const count = (warnings.data || []).length;
        if (count >= 3) {
          await supabase.from('users').update({ status: 'banned' }).eq('firebase_uid', uid);
        }
        await logAction(supabase, adminEmail, 'user_warn', 'user', uid, { reason });
        return json({ success: true, ok: true, warning_count: count });
      }

      case 'user_ban': {
        const uid = String(body.user_id || body.firebase_uid || '').trim();
        if (!uid) return json({ success: false, error: 'missing_user' }, 400);
        if (await isAdminUser(supabase, uid)) return json({ success: false, error: 'cannot_ban_admin' }, 400);
        await supabase.from('users').update({ status: 'banned' }).eq('firebase_uid', uid);
        await logAction(supabase, adminEmail, 'user_ban', 'user', uid, {});
        return json({ success: true, ok: true });
      }

      case 'user_unban': {
        const uid = String(body.user_id || body.firebase_uid || '').trim();
        if (!uid) return json({ success: false, error: 'missing_user' }, 400);
        await supabase.from('users').update({ status: 'active' }).eq('firebase_uid', uid);
        await logAction(supabase, adminEmail, 'user_unban', 'user', uid, {});
        return json({ success: true, ok: true });
      }

      case 'users_bulk': {
        const bulkAction = String(body.bulk_action || '').toLowerCase();
        const ids: string[] = Array.isArray(body.user_ids) ? body.user_ids.map(String) : [];
        if (!ids.length || !['warn', 'ban'].includes(bulkAction)) {
          return json({ success: false, error: 'invalid_bulk' }, 400);
        }
        let n = 0;
        for (const uid of ids) {
          if (bulkAction === 'warn') {
            await supabase.from('user_warnings').insert({
              user_id: uid,
              reason: String(body.reason || 'Bulk admin warning'),
              source: 'admin',
            });
            await supabase.from('users').update({ status: 'warned' }).eq('firebase_uid', uid);
            await logAction(supabase, adminEmail, 'user_warn', 'user', uid, { bulk: true });
          } else if (!(await isAdminUser(supabase, uid))) {
            await supabase.from('users').update({ status: 'banned' }).eq('firebase_uid', uid);
            await logAction(supabase, adminEmail, 'user_ban', 'user', uid, { bulk: true });
          }
          n++;
        }
        return json({ success: true, ok: true, count: n });
      }

      case 'user_delete': {
        const row = await findUserRow(supabase, {
          user_id: body.user_id,
          firebase_uid: body.firebase_uid,
          email: body.email,
        });
        if (!row) return json({ success: false, error: 'not_found' }, 404);
        const result = await deleteUserCascade(supabase, row);
        if (!result.success) return json({ success: false, error: result.error || 'delete_failed' }, 400);
        await logAction(supabase, adminEmail, 'user_hard_delete', 'user', String(row.firebase_uid || ''), {
          email: row.email || '',
        });
        return json({ success: true, ok: true });
      }

      case 'user_note': {
        const uid = String(body.user_id || '').trim();
        const noteBody = String(body.body || '').trim();
        if (!uid || !noteBody) return json({ success: false, error: 'invalid_note' }, 400);
        const { data, error } = await supabase.from('admin_notes').insert({
          user_id: uid,
          body: noteBody,
          admin_email: adminEmail,
        }).select().maybeSingle();
        if (error) return json({ success: false, error: 'insert_failed' }, 500);
        await logAction(supabase, adminEmail, 'user_note', 'user', uid, { body: noteBody });
        return json({ success: true, ok: true, note: data });
      }

      case 'task_patch': {
        const taskId = String(body.task_id || '').trim();
        const patch = sanitizeTaskPatch(body.patch || {});
        if (!taskId || !Object.keys(patch).length) return json({ success: false, error: 'invalid_patch' }, 400);
        let { data, error } = await supabase.from('tasks').update(patch).eq('task_id', taskId).select().maybeSingle();
        if (error || !data) {
          const alt = await supabase.from('tasks').update(patch).eq('id', taskId).select().maybeSingle();
          data = alt.data;
          error = alt.error;
        }
        if (error || !data) return json({ success: false, error: 'update_failed' }, 500);
        await logAction(supabase, adminEmail, 'task_edit', 'task', taskId, patch);
        return json({ success: true, ok: true, task: data });
      }

      case 'task_status': {
        const taskId = String(body.task_id || '').trim();
        const status = String(body.status || '').toLowerCase();
        if (!taskId || !ALLOWED_TASK_STATUS.has(status)) {
          return json({ success: false, error: 'invalid_status' }, 400);
        }
        const { data, error } = await supabase.from('tasks').update({ status }).eq('task_id', taskId).select().maybeSingle();
        if (error || !data) return json({ success: false, error: 'update_failed' }, 500);
        const logType = status === 'removed' ? 'task_hide' : status === 'open' ? 'task_unhide' : 'task_status';
        await logAction(supabase, adminEmail, logType, 'task', taskId, { status, bulk: !!body.bulk });
        return json({ success: true, ok: true, task: data });
      }

      case 'task_delete': {
        const taskId = String(body.task_id || '').trim();
        const result = await hardDeleteTask(supabase, taskId);
        if (!result.success) return json({ success: false, error: result.error || 'delete_failed' }, 500);
        await logAction(supabase, adminEmail, 'task_hard_delete', 'task', taskId, { bulk: !!body.bulk });
        return json({ success: true, ok: true });
      }

      case 'tasks_bulk': {
        const bulkAction = String(body.bulk_action || '').toLowerCase();
        const ids: string[] = Array.isArray(body.task_ids) ? body.task_ids.map(String) : [];
        if (!ids.length || !['hide', 'delete'].includes(bulkAction)) {
          return json({ success: false, error: 'invalid_bulk' }, 400);
        }
        let n = 0;
        for (const tid of ids) {
          if (bulkAction === 'hide') {
            const { error } = await supabase.from('tasks').update({ status: 'removed' }).eq('task_id', tid);
            if (!error) {
              n++;
              await logAction(supabase, adminEmail, 'task_hide', 'task', tid, { bulk: true });
            }
          } else {
            const r = await hardDeleteTask(supabase, tid);
            if (r.success) {
              n++;
              await logAction(supabase, adminEmail, 'task_hard_delete', 'task', tid, { bulk: true });
            }
          }
        }
        return json({ success: true, ok: true, count: n });
      }

      case 'report_status': {
        const reportId = String(body.report_id || '').trim();
        const status = String(body.status || '').toLowerCase();
        if (!reportId || !ALLOWED_REPORT_STATUS.has(status)) {
          return json({ success: false, error: 'invalid_status' }, 400);
        }
        const { data, error } = await supabase.from('reports').update({ status }).eq('report_id', reportId).select().maybeSingle();
        if (error || !data) return json({ success: false, error: 'update_failed' }, 500);
        await logAction(supabase, adminEmail, 'report_' + status, 'report', reportId, {});
        return json({ success: true, ok: true, report: data });
      }

      case 'dispute_status': {
        const disputeId = String(body.dispute_id || '').trim();
        const status = String(body.status || '').toLowerCase();
        if (!disputeId || !ALLOWED_DISPUTE_STATUS.has(status)) {
          return json({ success: false, error: 'invalid_status' }, 400);
        }
        const patch: Record<string, unknown> = { status };
        if (status === 'resolved' || status === 'rejected') {
          patch.resolved_at = new Date().toISOString();
        }
        const { data, error } = await supabase.from('disputes').update(patch).eq('dispute_id', disputeId).select().maybeSingle();
        if (error || !data) return json({ success: false, error: 'update_failed' }, 500);
        await logAction(supabase, adminEmail, 'dispute_' + status, 'dispute', disputeId, { money: false });
        return json({ success: true, ok: true, dispute: data });
      }

      case 'waitlist_import': {
        const emails: string[] = Array.isArray(body.emails) ? body.emails.map((e: unknown) => String(e).trim().toLowerCase()) : [];
        const unique = [...new Set(emails.filter(Boolean))];
        let added = 0;
        for (const email of unique) {
          const { error } = await supabase.from('waitlist').insert({ email });
          if (!error) added++;
        }
        await logAction(supabase, adminEmail, 'waitlist_import', 'waitlist', String(added), { count: added });
        return json({ success: true, ok: true, added });
      }

      case 'waitlist_patch': {
        const waitlistId = String(body.waitlist_id || '').trim();
        const patch = body.patch || {};
        if (!waitlistId || !Object.keys(patch).length) return json({ success: false, error: 'invalid_patch' }, 400);
        const allowed = ['invited_at', 'reminder_sent_at', 'signed_up', 'signed_up_at', 'name', 'notes'];
        const safe: Record<string, unknown> = {};
        for (const k of allowed) {
          if (patch[k] !== undefined) safe[k] = patch[k];
        }
        const { data, error } = await supabase.from('waitlist').update(safe).eq('waitlist_id', waitlistId).select().maybeSingle();
        if (error || !data) return json({ success: false, error: 'update_failed' }, 500);
        return json({ success: true, ok: true, row: data });
      }

      case 'waitlist_delete': {
        const waitlistId = String(body.waitlist_id || '').trim();
        if (!waitlistId) return json({ success: false, error: 'missing_id' }, 400);
        const { error } = await supabase.from('waitlist').delete().eq('waitlist_id', waitlistId);
        if (error) return json({ success: false, error: 'delete_failed' }, 500);
        return json({ success: true, ok: true });
      }

      case 'waitlist_sync_signups': {
        const { data: users } = await supabase.from('users').select('email,created_at');
        const { data: rows } = await supabase.from('waitlist').select('waitlist_id,email,signed_up');
        const byEmail: Record<string, string> = {};
        for (const u of users || []) {
          const em = String(u.email || '').toLowerCase();
          if (em) byEmail[em] = u.created_at;
        }
        let synced = 0;
        for (const w of rows || []) {
          const em = String(w.email || '').toLowerCase();
          if (em && byEmail[em] && !w.signed_up) {
            await supabase.from('waitlist').update({
              signed_up: true,
              signed_up_at: byEmail[em],
            }).eq('waitlist_id', w.waitlist_id);
            synced++;
          }
        }
        return json({ success: true, ok: true, synced });
      }

      case 'banner_save': {
        const patch = body.patch || {};
        const allowed = ['message', 'link', 'style', 'active', 'soft_close'];
        const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const k of allowed) {
          if (patch[k] !== undefined) safe[k] = patch[k];
        }
        let { data, error } = await supabase.from('platform_banner').update(safe).eq('id', 1).select().maybeSingle();
        if (error || !data) {
          const ins = await supabase.from('platform_banner').upsert({ id: 1, ...safe }).select().maybeSingle();
          data = ins.data;
          error = ins.error;
        }
        if (error || !data) return json({ success: false, error: 'save_failed' }, 500);
        await logAction(supabase, adminEmail, 'banner_save', 'platform_banner', '1', safe);
        return json({ success: true, ok: true, banner: data });
      }

      default:
        return json({ success: false, error: 'unknown_action' }, 400);
    }
  } catch (err) {
    console.error('admin-console', action, err);
    return json({ success: false, error: 'server_error' }, 500);
  }
});
