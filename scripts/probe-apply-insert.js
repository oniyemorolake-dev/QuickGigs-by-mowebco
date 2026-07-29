/**
 * Probe live applications insert error (read keys from supabaseClient.js).
 * Run: node scripts/probe-apply-insert.js
 */
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'supabaseClient.js'), 'utf8');
var url = (src.match(/SUPABASE_URL = '([^']+)'/) || [])[1];
var key = (src.match(/SUPABASE_ANON_KEY = '([^']+)'/) || [])[1];
if (!url || !key) {
  console.error('Missing Supabase URL/key');
  process.exit(1);
}
var headers = {
  apikey: key,
  Authorization: 'Bearer ' + key,
  'Content-Type': 'application/json'
};

async function main() {
  var tasksRes = await fetch(url + '/rest/v1/tasks?select=task_id,posted_by,title,status&limit=3', { headers: headers });
  var tasksText = await tasksRes.text();
  console.log('GET tasks', tasksRes.status, tasksText.slice(0, 500));
  var tasks = [];
  try { tasks = JSON.parse(tasksText); } catch (e) {}

  var usersRes = await fetch(url + '/rest/v1/users?select=user_id,firebase_uid,email&limit=5', { headers: headers });
  var usersText = await usersRes.text();
  console.log('GET users', usersRes.status, usersText.slice(0, 500));
  var users = [];
  try { users = JSON.parse(usersText); } catch (e) {}

  var taskId = tasks[0] && tasks[0].task_id;
  var worker = (users.find(function (u) { return u.firebase_uid && u.firebase_uid !== (tasks[0] && tasks[0].posted_by); }) || users[0] || {});
  var workerId = worker.firebase_uid || 'Tg08W7IiWpUEOjc103dmqMUBI4h1';

  console.log('Using task_id=', taskId, 'worker_id=', workerId);

  // Attempt A: as client does (firebase uid in worker_id, task uuid in task_id)
  var rowA = {
    task_id: taskId,
    worker_id: workerId,
    message: 'Probe apply message for diagnosis — over twenty chars.',
    price: 40,
    status: 'pending',
    worker_name: 'Probe'
  };
  var postA = await fetch(url + '/rest/v1/applications', {
    method: 'POST',
    headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
    body: JSON.stringify(rowA)
  });
  var postAText = await postA.text();
  console.log('POST A (firebase worker_id)', postA.status, postAText.slice(0, 800));

  // Attempt B: put users.user_id UUID into worker_id (wrong identity)
  if (worker.user_id) {
    var rowB = {
      task_id: taskId,
      worker_id: worker.user_id,
      message: 'Probe with user_id uuid as worker — over twenty chars.',
      price: 41,
      status: 'pending'
    };
    var postB = await fetch(url + '/rest/v1/applications', {
      method: 'POST',
      headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
      body: JSON.stringify(rowB)
    });
    var postBText = await postB.text();
    console.log('POST B (user_id as worker_id)', postB.status, postBText.slice(0, 800));
  }

  // Cleanup probe rows if any created
  if (postA.ok) {
    await fetch(url + '/rest/v1/applications?message=like.Probe%20apply*', {
      method: 'DELETE',
      headers: headers
    });
    console.log('Cleaned probe A');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
