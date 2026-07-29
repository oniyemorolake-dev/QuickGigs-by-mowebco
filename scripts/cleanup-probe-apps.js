/**
 * Delete probe application rows created during apply-bug diagnosis.
 * Run: node scripts/cleanup-probe-apps.js
 */
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'supabaseClient.js'), 'utf8');
var url = (src.match(/SUPABASE_URL = '([^']+)'/) || [])[1];
var key = (src.match(/SUPABASE_ANON_KEY = '([^']+)'/) || [])[1];
var headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

async function main() {
  var list = await fetch(url + '/rest/v1/applications?select=app_id,worker_id,message,price', { headers: headers }).then(function (r) { return r.json(); });
  console.log('before', list.length, list);
  var probes = (list || []).filter(function (a) {
    return String(a.message || '').indexOf('Probe') >= 0 || a.worker_name === 'Probe';
  });
  for (var i = 0; i < probes.length; i++) {
    var id = probes[i].app_id;
    var res = await fetch(url + '/rest/v1/applications?app_id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: headers
    });
    console.log('delete', id, res.status);
  }
  var after = await fetch(url + '/rest/v1/applications?select=app_id,worker_id,message', { headers: headers }).then(function (r) { return r.json(); });
  console.log('after', after.length, after);
}

main().catch(function (e) { console.error(e); process.exit(1); });
