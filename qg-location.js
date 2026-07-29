/**
 * QuickGigs — location helpers (city display + distance filtering).
 *
 * PRIVACY
 * - Never store or broadcast the user's live/current GPS to other users.
 *   Geolocation is used only to filter/sort open tasks for the viewer (session only).
 * - Public cards/detail show APPROXIMATE area (city / neighbourhood) via tasks.location.
 *   Never show raw lat/lng or precise street addresses publicly.
 * - precise_address may be revealed only to poster + accepted tasker after accept/escrow.
 *   // SERVER-TODO: enforce precise_address visibility with Supabase RLS / edge function —
 *   // client checks alone are not enough once the anon key can SELECT the column.
 */
(function () {
  var DEFAULT = 'Calgary, AB';
  var GEO_SESSION_KEY = 'qg-geo-filter-pos';
  var RADIUS_KEY = 'qg-near-radius-km';
  var NOMINATIM = 'https://nominatim.openstreetmap.org';

  function saveLocation(city) {
    if (city) localStorage.setItem('qg-user-location', city);
  }

  window.getUserLocation = function () {
    return localStorage.getItem('qg-user-location') || DEFAULT;
  };

  window.getUserCityLabel = function () {
    return getUserLocation().split(',')[0].trim();
  };

  window.setUserLocation = function (city) {
    saveLocation(city);
  };

  /** Round coords for storage (~0.01° ≈ 1 km). Never use full GPS precision in DB. */
  function roundCoord(n, decimals) {
    decimals = decimals == null ? 2 : decimals;
    var x = Number(n);
    if (!isFinite(x)) return null;
    var f = Math.pow(10, decimals);
    return Math.round(x * f) / f;
  }

  window.roundCoord = roundCoord;

  function haversineKm(lat1, lng1, lat2, lng2) {
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  window.haversineKm = haversineKm;

  function taskCoords(task) {
    if (!task) return null;
    var lat = Number(task.lat != null ? task.lat : task.LAT);
    var lng = Number(task.lng != null ? task.lng : task.LNG);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  window.taskCoords = taskCoords;

  /** Session-only viewer position for Near me — not written to user profile / not shared. */
  function readGeoFilterPos() {
    try {
      var raw = sessionStorage.getItem(GEO_SESSION_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return null;
      return { lat: Number(p.lat), lng: Number(p.lng), at: p.at || 0 };
    } catch (e) {
      return null;
    }
  }

  function writeGeoFilterPos(lat, lng) {
    try {
      sessionStorage.setItem(GEO_SESSION_KEY, JSON.stringify({
        lat: roundCoord(lat, 3),
        lng: roundCoord(lng, 3),
        at: Date.now()
      }));
    } catch (e) {}
  }

  function clearGeoFilterPos() {
    try { sessionStorage.removeItem(GEO_SESSION_KEY); } catch (e) {}
  }

  window.getGeoFilterPos = readGeoFilterPos;
  window.clearGeoFilterPos = clearGeoFilterPos;

  /**
   * Browser Geolocation for task filtering only.
   * @returns {Promise<{lat:number,lng:number}|null>}
   */
  window.requestGeoForFilter = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var lat = pos.coords.latitude;
          var lng = pos.coords.longitude;
          writeGeoFilterPos(lat, lng);
          resolve({ lat: lat, lng: lng });
        },
        function () {
          if (!opts.keepPrevious) clearGeoFilterPos();
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
      );
    });
  };

  window.getNearRadiusKm = function () {
    var n = parseInt(localStorage.getItem(RADIUS_KEY) || '25', 10);
    if ([5, 10, 25, 50].indexOf(n) < 0) n = 25;
    return n;
  };

  window.setNearRadiusKm = function (km) {
    var n = parseInt(km, 10);
    if ([5, 10, 25, 50].indexOf(n) < 0) n = 25;
    try { localStorage.setItem(RADIUS_KEY, String(n)); } catch (e) {}
    return n;
  };

  window.formatDistanceKm = function (km) {
    if (km == null || !isFinite(km)) return '';
    if (km < 1) return '~' + Math.max(0.1, Math.round(km * 10) / 10) + ' km away';
    if (km < 10) return '~' + (Math.round(km * 10) / 10) + ' km away';
    return '~' + Math.round(km) + ' km away';
  };

  /**
   * Public area label — city / neighbourhood only.
   * Strips leading street-number addresses down to trailing city, province parts.
   */
  window.toApproximateArea = function (loc) {
    var s = String(loc || '').trim();
    if (!s) return '';
    if (/^\d/.test(s) || /\b(st|street|ave|avenue|rd|road|blvd|drive|dr|cres|way|lane|ln)\b/i.test(s)) {
      var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length >= 2) s = parts.slice(-2).join(', ');
      else return 'Nearby area';
    }
    return typeof formatLocationDisplay === 'function' ? formatLocationDisplay(s) : s;
  };

  window.formatPublicTaskLocation = function (task) {
    var loc = (task && (task.location || task.LOCATION)) || '';
    return window.toApproximateArea(loc);
  };

  /**
   * Precise address for poster / accepted tasker after accept.
   * // SERVER-TODO: enforce precise_address visibility with Supabase RLS / edge function —
   * // client checks alone are not enough once the anon key can SELECT the column.
   */
  window.canViewPreciseAddress = function (task, viewerUid, opts) {
    opts = opts || {};
    if (!task || !viewerUid) return false;
    var poster = String(task.posted_by || task.POSTED_BY || '');
    var me = String(viewerUid);
    // Poster always sees their own precise address on their listings.
    if (me && poster && me === poster) return true;
    var st = String(task.status || task.STATUS || '').toLowerCase();
    if (st !== 'in_progress' && st !== 'completed' && st !== 'accepted') return false;
    var worker = String(
      opts.workerId ||
      task.accepted_worker_id ||
      task.worker_id ||
      task.WORKER_ID ||
      ''
    );
    if (me && worker && me === worker) return true;
    return false;
  };

  window.formatTaskLocationForViewer = function (task, viewerUid, opts) {
    opts = opts || {};
    var approx = window.formatPublicTaskLocation(task) || 'Location TBD';
    if (!window.canViewPreciseAddress(task, viewerUid, opts)) return approx;
    var precise = String(task.precise_address || task.PRECISE_ADDRESS || '').trim();
    if (!precise) return approx;
    return precise;
  };

  function parseLocationParts(loc) {
    var raw = String(loc || '').trim();
    if (!raw) return { city: '', region: '' };
    var parts = raw.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    return {
      city: (parts[0] || '').toLowerCase(),
      region: (parts[1] || parts[0] || '').toLowerCase()
    };
  }

  /** Lower score = closer match (same city → 0, same region → 1, else → 2). */
  window.getLocationProximityScore = function (taskLocation, userLocation) {
    var task = parseLocationParts(taskLocation);
    var user = parseLocationParts(userLocation || getUserLocation());
    if (task.city && user.city && task.city === user.city) return 0;
    if (task.region && user.region && task.region === user.region) return 1;
    if (task.city && user.city && task.city.indexOf(user.city) >= 0) return 0;
    if (user.city && task.city && user.city.indexOf(task.city) >= 0) return 0;
    return 2;
  };

  window.sortTasksByProximity = function (tasks, userLocation) {
    var loc = userLocation || getUserLocation();
    var pos = readGeoFilterPos();
    return (tasks || []).slice().sort(function (a, b) {
      if (pos) {
        var ca = taskCoords(a);
        var cb = taskCoords(b);
        var da = ca ? haversineKm(pos.lat, pos.lng, ca.lat, ca.lng) : Infinity;
        var db = cb ? haversineKm(pos.lat, pos.lng, cb.lat, cb.lng) : Infinity;
        if (da !== db) return da - db;
      }
      var sa = getLocationProximityScore(a.location || a.LOCATION, loc);
      var sb = getLocationProximityScore(b.location || b.LOCATION, loc);
      if (sa !== sb) return sa - sb;
      return 0;
    });
  };

  window.taskDistanceKm = function (task, fromPos) {
    var pos = fromPos || readGeoFilterPos();
    var c = taskCoords(task);
    if (!pos || !c) return null;
    return haversineKm(pos.lat, pos.lng, c.lat, c.lng);
  };

  /**
   * Distance filter. Tasks without coords keep city-match fallback when nearMe;
   * if no geo permission / no pos → return list unchanged (caller shows all).
   */
  window.filterTasksByDistance = function (tasks, opts) {
    opts = opts || {};
    var pos = opts.pos || readGeoFilterPos();
    var radiusKm = opts.radiusKm != null ? Number(opts.radiusKm) : getNearRadiusKm();
    if (!pos || !isFinite(radiusKm)) return tasks || [];
    var cityRef = opts.cityRef || getUserLocation();
    return (tasks || []).filter(function (t) {
      var c = taskCoords(t);
      if (c) {
        var d = haversineKm(pos.lat, pos.lng, c.lat, c.lng);
        t._distanceKm = d;
        return d <= radiusKm;
      }
      t._distanceKm = null;
      if (opts.includeUnknown !== false) {
        return getLocationProximityScore(t.location || t.LOCATION, cityRef) === 0;
      }
      return false;
    });
  };

  function nominatimHeaders() {
    return {
      'Accept-Language': 'en',
      'Accept': 'application/json'
    };
  }

  window.reverseGeocodeCity = function (lat, lng) {
    return fetch(
      NOMINATIM + '/reverse?lat=' + encodeURIComponent(lat) +
      '&lon=' + encodeURIComponent(lng) + '&format=json',
      { headers: nominatimHeaders() }
    )
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var a = data.address || {};
        var city = a.city || a.town || a.municipality || a.suburb || a.county || '';
        var neighbourhood = a.neighbourhood || a.suburb || '';
        var province = (a.state || a.province || 'Alberta').replace('Alberta', 'AB');
        var shortProv = province.length > 2 ? province.split(' ')[0] : province;
        if (String(province).toLowerCase().indexOf('alberta') >= 0) shortProv = 'AB';
        var area = neighbourhood && city && neighbourhood.toLowerCase() !== city.toLowerCase()
          ? neighbourhood + ', ' + city
          : (city || neighbourhood || '');
        var loc = area ? area + ', ' + shortProv : DEFAULT;
        return {
          location: loc,
          lat: roundCoord(lat, 2),
          lng: roundCoord(lng, 2),
          raw: data
        };
      });
  };

  window.geocodeDisplayLocation = function (query) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve(null);
    var url = NOMINATIM + '/search?q=' + encodeURIComponent(q) +
      '&format=json&limit=1&countrycodes=ca';
    return fetch(url, { headers: nominatimHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (!rows || !rows[0]) return null;
        var lat = roundCoord(rows[0].lat, 2);
        var lng = roundCoord(rows[0].lon, 2);
        if (lat == null || lng == null) return null;
        return { lat: lat, lng: lng, display: rows[0].display_name || q };
      })
      .catch(function () { return null; });
  };

  window.initUserLocation = function () {
    if (localStorage.getItem('qg-user-location')) return Promise.resolve(getUserLocation());

    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve(DEFAULT);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude)
            .then(function (res) {
              saveLocation(res.location);
              resolve(res.location);
            })
            .catch(function () { resolve(DEFAULT); });
        },
        function () { resolve(DEFAULT); },
        { timeout: 4000, maximumAge: 600000 }
      );
    });
  };

  /**
   * Capture approximate coords for a new task (post form).
   * Uses optional browser GPS once for the listing — not stored as the user's live location.
   */
  window.captureTaskLocationFromDevice = function () {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ ok: false, error: 'unsupported' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude)
            .then(function (res) {
              resolve({
                ok: true,
                location: res.location,
                lat: res.lat,
                lng: res.lng
              });
            })
            .catch(function () {
              resolve({
                ok: true,
                location: DEFAULT,
                lat: roundCoord(pos.coords.latitude, 2),
                lng: roundCoord(pos.coords.longitude, 2)
              });
            });
        },
        function (err) {
          resolve({ ok: false, error: err && err.code === 1 ? 'denied' : 'failed' });
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    });
  };
})();
