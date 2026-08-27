#!/usr/bin/env node
/**
 * One-off backfill: geocode in-person tasks that are missing lat/lng.
 *
 * Prerequisites:
 *   1. Run supabase/migrations/20260827233000_location_type_geocode_cache.sql
 *   2. Deploy geocode-canada Edge Function (optional MAPBOX_ACCESS_TOKEN secret)
 *
 * Usage:
 *   set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
 *   set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
 *   node scripts/backfill-task-coords.js --dry-run
 *   node scripts/backfill-task-coords.js
 *
 * Optional: MAPBOX_ACCESS_TOKEN or GEOCODE_API_KEY for Mapbox (falls back to Nominatim).
 */
'use strict';

var SUPABASE_URL = process.env.SUPABASE_URL || '';
var SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
var DRY_RUN = process.argv.indexOf('--dry-run') >= 0;
var DELAY_MS = 1100;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isCanadian(lat, lng) {
  return lat >= 41.5 && lat <= 83.5 && lng >= -141.1 && lng <= -52.5;
}

function normalizeLookupKey(query) {
  var q = String(query || '').trim();
  var compact = q.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return 'postal:' + compact;
  return 'place:' + q.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function sbFetch(path, opts) {
  opts = opts || {};
  var res = await fetch(SUPABASE_URL.replace(/\/$/, '') + path, {
    method: opts.method || 'GET',
    headers: Object.assign({
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  var text = await res.text();
  var data;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    var err = new Error('HTTP ' + res.status + ': ' + (typeof data === 'object' ? JSON.stringify(data) : text));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function geocodeQuery(query) {
  var lookupKey = normalizeLookupKey(query);
  var cached = await sbFetch('/rest/v1/geocode_cache?lookup_key=eq.' + encodeURIComponent(lookupKey) + '&limit=1');
  if (Array.isArray(cached) && cached[0]) {
    return { hit: cached[0], cached: true };
  }

  var token = process.env.MAPBOX_ACCESS_TOKEN || process.env.GEOCODE_API_KEY || '';
  if (token) {
    var mbUrl = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
      encodeURIComponent(query) + '.json?access_token=' + encodeURIComponent(token) +
      '&country=ca&limit=1';
    var mbRes = await fetch(mbUrl);
    if (mbRes.ok) {
      var mb = await mbRes.json();
      var f = mb.features && mb.features[0];
      if (f && f.center) {
        var lat = Number(f.center[1]);
        var lng = Number(f.center[0]);
        if (isCanadian(lat, lng)) {
          var city = f.text || query.split(',')[0].trim();
          var province = '';
          (f.context || []).forEach(function (ctx) {
            if (String(ctx.id || '').indexOf('region') === 0) {
              province = String(ctx.short_code || ctx.text || '').replace(/^ca-/i, '').toUpperCase();
            }
          });
          return {
            hit: {
              lookup_key: lookupKey,
              city: city,
              province: province,
              lat: Math.round(lat * 100) / 100,
              lng: Math.round(lng * 100) / 100,
              location: city + (province ? ', ' + province : '')
            },
            cached: false
          };
        }
      }
    }
  }

  var nomUrl = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) +
    '&format=json&addressdetails=1&limit=1&countrycodes=ca';
  await sleep(DELAY_MS);
  var nomRes = await fetch(nomUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'QuickGigs-backfill/1.0 (https://quickgigs.ca)'
    }
  });
  if (!nomRes.ok) return null;
  var rows = await nomRes.json();
  if (!rows || !rows[0]) return null;
  var lat2 = Number(rows[0].lat);
  var lng2 = Number(rows[0].lon);
  if (!isCanadian(lat2, lng2)) return null;
  var a = rows[0].address || {};
  var city2 = a.city || a.town || a.municipality || query.split(',')[0].trim();
  var prov2 = String(a['ISO3166-2-lvl4'] || a.state || '').replace(/^CA-/i, '').toUpperCase();
  return {
    hit: {
      lookup_key: lookupKey,
      city: city2,
      province: prov2,
      lat: Math.round(lat2 * 100) / 100,
      lng: Math.round(lng2 * 100) / 100,
      location: city2 + (prov2 ? ', ' + prov2 : '')
    },
    cached: false
  };
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  var select = 'task_id,title,location,location_type,lat,lng,status';
  var tasks;
  try {
    tasks = await sbFetch('/rest/v1/tasks?select=' + select +
      '&or=(lat.is.null,lng.is.null)&location_type=neq.remote&limit=500');
  } catch (err) {
    if (err.status === 400) {
      tasks = await sbFetch('/rest/v1/tasks?select=task_id,title,location,lat,lng,status' +
        '&or=(lat.is.null,lng.is.null)&limit=500');
    } else {
      throw err;
    }
  }

  tasks = (tasks || []).filter(function (t) {
    var lt = String(t.location_type || 'in_person').toLowerCase();
    return lt !== 'remote' && String(t.location || '').trim();
  });

  console.log('Tasks missing coordinates (in-person, non-empty location): ' + tasks.length);
  if (!tasks.length) {
    console.log('Nothing to backfill.');
    return;
  }

  if (DRY_RUN) {
    tasks.forEach(function (t) {
      console.log('  #' + t.task_id + '  ' + JSON.stringify(t.location));
    });
    console.log('\nDry run — no rows updated. Re-run without --dry-run to apply.');
    return;
  }

  var updated = 0;
  var failed = 0;
  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    var query = String(task.location || '').trim();
    process.stdout.write('[' + (i + 1) + '/' + tasks.length + '] #' + task.task_id + ' ' + query + ' … ');
    try {
      var geo = await geocodeQuery(query);
      if (!geo || !geo.hit) {
        console.log('FAILED (no geocode hit)');
        failed += 1;
        continue;
      }
      if (!geo.cached) {
        await sbFetch('/rest/v1/geocode_cache', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: {
            lookup_key: geo.hit.lookup_key,
            city: geo.hit.city,
            province: geo.hit.province,
            lat: geo.hit.lat,
            lng: geo.hit.lng
          }
        });
      }
      await sbFetch('/rest/v1/tasks?task_id=eq.' + task.task_id, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: {
          lat: geo.hit.lat,
          lng: geo.hit.lng,
          location: geo.hit.location || query,
          location_type: 'in_person'
        }
      });
      console.log('OK → ' + geo.hit.lat + ',' + geo.hit.lng);
      updated += 1;
    } catch (e) {
      console.log('ERROR ' + (e.message || e));
      failed += 1;
    }
  }

  console.log('\nDone. Updated: ' + updated + ', failed: ' + failed);
  console.log('Then run: ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_in_person_requires_coords;');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
