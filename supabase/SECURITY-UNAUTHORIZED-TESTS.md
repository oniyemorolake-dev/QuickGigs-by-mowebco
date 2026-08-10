# Security unauthorized tests (role matrix)

Run after deploying Edge Functions + applying `supabase/security-lockdown.sql`.
These prove **server/DB** denial — not UI hiding.

Set env (PowerShell):

```powershell
$BASE = "https://nuyfqsxstsrbloztzgau.supabase.co"
$ANON = "<supabase-anon-key>"
$FN = "$BASE/functions/v1"
# Firebase ID tokens for each persona (from browser console: await firebase.auth().currentUser.getIdToken())
$TOKEN_POSTER = "..."
$TOKEN_TASKER = "..."
$TOKEN_STRANGER = "..."   # logged-in user not on the task
$TOKEN_TEEN = "..."       # 16–17 tasker
$TOKEN_GUARDIAN = "..."
$TOKEN_ADMIN = "..."
$TASK_IN_PROGRESS = "<task_id status=in_progress>"
$TASK_COMPLETED = "<task_id status=completed poster_confirmed>"
$CONV_LOCKED = "<conv_id is_unlocked=false>"
```

Helper:

```powershell
function Invoke-Fn($name, $token, $body) {
  $headers = @{
    apikey = $ANON
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
  }
  if (-not $token) { $headers.Remove("Authorization"); $headers.Authorization = "Bearer $ANON" }
  try {
    $r = Invoke-WebRequest -Uri "$FN/$name" -Method POST -Headers $headers -Body ($body | ConvertTo-Json -Compress)
    return @{ status = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json) }
  } catch {
    $resp = $_.Exception.Response
    $reader = New-Object IO.StreamReader($resp.GetResponseStream())
    $raw = $reader.ReadToEnd()
    return @{ status = [int]$resp.StatusCode; body = ($raw | ConvertFrom-Json -ErrorAction SilentlyContinue); raw = $raw }
  }
}
```

## 1. Anonymous (no Firebase JWT)

| Action | Call | Expect |
|--------|------|--------|
| Refund | `refund-payment` `{task_id}` + anon key only | **401** |
| Complete | `complete-task` `{task_id, actor_id: spoof}` | **401** |
| Confirm | `confirm-checkout` `{session_id}` | **401** |
| Sync pay | `sync-payment` `{poster_id: victim}` | **401** |
| Release | `release-payout` `{task_id}` | **401** |
| Notify | `send-notification` `{email,subject,body}` no secret | **401** |
| REST users | `GET /rest/v1/users?select=*` with anon | **empty / 401** (no anon policy) |
| REST payments | `GET /rest/v1/payments` with anon | **denied** |

```powershell
Invoke-Fn "refund-payment" $null @{ task_id = $TASK_IN_PROGRESS; actor_id = "spoof" }
# expect status 401
Invoke-Fn "send-notification" $null @{ email = "spam@example.com"; subject = "x"; body = "y" }
# expect 401 unauthorized
```

## 2. Normal 18+ stranger (authenticated, not party)

| Action | Expect |
|--------|--------|
| `complete-task` on someone else's task | **403** `not_authorized` |
| `refund-payment` on someone else's task | **403** |
| `release-payout` | **403** |
| `confirm-checkout` conv_id for others | **403** |
| PATCH `users` set `role=admin` for self | **42501 / privileged_fields** (trigger) |
| PATCH conversation `is_unlocked=true` | **42501** `conversation_unlock_is_server_managed` |
| INSERT message into locked conv | **RLS deny** |

```powershell
Invoke-Fn "complete-task" $TOKEN_STRANGER @{ task_id = $TASK_IN_PROGRESS; actor_id = "<poster_uid>" }
# 403 — body actor_id ignored; token is stranger
Invoke-Fn "release-payout" $TOKEN_STRANGER @{ task_id = $TASK_COMPLETED }
# 403
```

## 3. Poster (party)

| Action | Expect |
|--------|--------|
| `complete-task` while `in_progress` | **200** + sets `poster_confirmed_at` |
| `release-payout` while still `in_progress` | **400** `task_not_completed` |
| `release-payout` after complete | **200** (or skipped if no held payment) |
| `refund-payment` while held | **200** / Stripe refund |
| Spoof `actor_id` as tasker in body | still acts as **poster** (token) |

## 4. Tasker (worker)

| Action | Expect |
|--------|--------|
| `complete-task` | **403** only poster may complete |
| `release-payout` while `in_progress` | **403** `not_authorized` (and **400** if somehow completed without being poster) |
| `release-payout` after poster completed | **403** worker cannot self-release |
| `sync-payment` with body `poster_id` = poster | syncs **tasker's own** poster rows only (empty) — cannot confirm others' sessions |
| Unlock via `secure-messaging` update `is_unlocked:true` | ignored / stays locked |

```powershell
Invoke-Fn "release-payout" $TOKEN_TASKER @{ task_id = $TASK_IN_PROGRESS }
# 400 task_not_completed OR 403 not_authorized
Invoke-Fn "complete-task" $TOKEN_TASKER @{ task_id = $TASK_IN_PROGRESS }
# 403
```

## 5. 16–17 Tasker

| Action | Expect |
|--------|--------|
| `create-connect-link` self | **blocked** `minor_requires_guardian_payout` (existing) |
| Money functions same as adult tasker | same 401/403 matrix |
| Cannot escalate `role` / verification flags via REST | trigger deny |

## 6. Guardian

| Action | Expect |
|--------|--------|
| Consent flows via guardian token endpoints only | unchanged |
| Cannot call `release-payout` for teen's task as non-poster | **403** |
| Cannot open `send-notification` without secret | **401** |

## 7. Admin (`admins` table)

| Action | Expect |
|--------|--------|
| `users.role` change via REST still blocked unless service_role | trigger (admin UX uses Edge Functions / service) |
| Dispute resolve Edge Function | allowed if function checks `admins` |
| Not in `admins` + JWT claiming admin in body | **denied** |

## REST checks (PostgREST)

```powershell
# Role escalation
Invoke-RestMethod -Method PATCH -Uri "$BASE/rest/v1/users?firebase_uid=eq.$myUid" `
  -Headers @{ apikey=$ANON; Authorization="Bearer $TOKEN_STRANGER"; Prefer="return=minimal" } `
  -ContentType "application/json" -Body '{"role":"admin"}'
# expect error privileged_fields_are_server_managed

# Unlock bypass
Invoke-RestMethod -Method PATCH -Uri "$BASE/rest/v1/conversations?conv_id=eq.$CONV_LOCKED" `
  -Headers @{ apikey=$ANON; Authorization="Bearer $TOKEN_TASKER"; Prefer="return=minimal" } `
  -ContentType "application/json" -Body '{"is_unlocked":true}'
# expect conversation_unlock_is_server_managed
```

## Pass criteria

- Every unauthenticated money/notify call returns **401**
- Every cross-party money call returns **403**
- Tasker cannot release payout in any task status
- Poster cannot release until `status=completed` + `poster_confirmed_at`
- Client cannot set `users.role` or `conversations.is_unlocked=true`
- No finding marked fixed based on frontend alone

Record results in the security re-audit canvas after running.
