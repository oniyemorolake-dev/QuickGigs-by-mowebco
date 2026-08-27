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
  var GEO_SESSION_KEY = 'qg-geo-filter-pos';
  var USER_POS_KEY = 'qg-user-location-pos';
  var RADIUS_KEY = 'qg-near-radius-km';
  var NOMINATIM = 'https://nominatim.openstreetmap.org';
  var RADIUS_OPTIONS = [25, 50, 100, 250];
  var MAJOR_METRO = [
    { lat: 43.653, lng: -79.383 }, { lat: 45.501, lng: -73.567 },
    { lat: 49.283, lng: -123.121 }, { lat: 51.044, lng: -114.072 },
    { lat: 53.546, lng: -113.494 }, { lat: 45.421, lng: -75.697 },
    { lat: 49.895, lng: -97.138 }, { lat: 44.648, lng: -63.575 }
  ];

  function saveLocation(city) {
    if (city) localStorage.setItem('qg-user-location', city);
  }

  window.getUserLocation = function () {
    return localStorage.getItem('qg-user-location') || '';
  };

  window.getUserCityLabel = function () {
    var loc = getUserLocation();
    if (!loc) return '';
    return loc.split(',')[0].trim();
  };

  window.isRemoteTask = function (task) {
    if (!task) return false;
    return String(task.location_type || task.LOCATION_TYPE || '').toLowerCase() === 'remote';
  };

  function writeUserLocationPos(lat, lng) {
    try {
      localStorage.setItem(USER_POS_KEY, JSON.stringify({
        lat: roundCoord(lat, 3),
        lng: roundCoord(lng, 3)
      }));
    } catch (e) {}
  }

  function readUserLocationPos() {
    try {
      var raw = localStorage.getItem(USER_POS_KEY);
      var p = raw ? JSON.parse(raw) : null;
      if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return null;
      return { lat: Number(p.lat), lng: Number(p.lng), source: 'chosen' };
    } catch (e) {
      return null;
    }
  }

  function geocodeQuery(query) {
    if (typeof geocodeCanadaLocation === 'function') {
      return geocodeCanadaLocation(query).then(function (res) {
        if (!res || !res.success) return null;
        return {
          lat: res.lat,
          lng: res.lng,
          location: res.location || query,
          city: res.city,
          province: res.province
        };
      });
    }
    if (typeof geocodeDisplayLocation === 'function') {
      return geocodeDisplayLocation(query);
    }
    return Promise.resolve(null);
  }

  window.setUserLocation = function (city) {
    clearGeoFilterPos();
    if (!city) return Promise.resolve(null);
    return geocodeQuery(city).then(function (result) {
      if (!result) return null;
      writeUserLocationPos(result.lat, result.lng);
      saveLocation(result.location || city);
      if (typeof suggestNearRadiusKm === 'function') suggestNearRadiusKm(result.lat, result.lng);
      return result;
    });
  };

  window.setUserLocationResult = function (city, lat, lng) {
    saveLocation(city);
    clearGeoFilterPos();
    if (isFinite(Number(lat)) && isFinite(Number(lng))) {
      writeUserLocationPos(lat, lng);
      if (typeof suggestNearRadiusKm === 'function') suggestNearRadiusKm(lat, lng);
    }
  };

  window.setUserLocationLabel = saveLocation;

  /** Round coords for storage (~0.01° ≈ 1 km). Never use full GPS precision in DB. */
  function roundCoord(n, decimals) {
    decimals = decimals == null ? 2 : decimals;
    var x = Number(n);
    if (!isFinite(x)) return null;
    var f = Math.pow(10, decimals);
    return Math.round(x * f) / f;
  }

  window.roundCoord = roundCoord;

  function isCanadianCoordinate(lat, lng) {
    return isFinite(Number(lat)) && isFinite(Number(lng)) &&
      Number(lat) >= 41.5 && Number(lat) <= 83.5 &&
      Number(lng) >= -141.1 && Number(lng) <= -52.5;
  }

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
    if (!task || window.isRemoteTask(task)) return null;
    var lat = Number(task.lat != null ? task.lat : task.LAT);
    var lng = Number(task.lng != null ? task.lng : task.LNG);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  window.taskCoords = taskCoords;

  function isNearMajorMetro(lat, lng) {
    for (var i = 0; i < MAJOR_METRO.length; i++) {
      if (haversineKm(lat, lng, MAJOR_METRO[i].lat, MAJOR_METRO[i].lng) <= 35) return true;
    }
    return false;
  }

  /** Dense metros → 50 km default; rural/sparse → 150 km. User can override anytime. */
  window.suggestNearRadiusKm = function (lat, lng) {
    if (!isFinite(Number(lat)) || !isFinite(Number(lng))) return 100;
    var suggested = isNearMajorMetro(lat, lng) ? 50 : 150;
    try {
      if (!localStorage.getItem(RADIUS_KEY)) {
        localStorage.setItem(RADIUS_KEY, String(suggested));
      }
    } catch (e) {}
    return suggested;
  };

  window.getNearRadiusOptions = function () {
    return RADIUS_OPTIONS.slice();
  };

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

  window.getGeoFilterPos = function () {
    return readGeoFilterPos() || readUserLocationPos();
  };
  window.clearGeoFilterPos = clearGeoFilterPos;

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
          if (!isCanadianCoordinate(lat, lng)) {
            clearGeoFilterPos();
            resolve(null);
            return;
          }
          writeGeoFilterPos(lat, lng);
          if (typeof suggestNearRadiusKm === 'function') suggestNearRadiusKm(lat, lng);
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
    var raw = String(localStorage.getItem(RADIUS_KEY) || '').toLowerCase();
    if (raw === 'any' || raw === 'anywhere') return Infinity;
    var n = parseInt(raw, 10);
    if (RADIUS_OPTIONS.indexOf(n) < 0) {
      var pos = window.getGeoFilterPos();
      n = pos ? window.suggestNearRadiusKm(pos.lat, pos.lng) : 100;
    }
    return n;
  };

  window.setNearRadiusKm = function (km) {
    if (String(km).toLowerCase() === 'any' || !isFinite(Number(km))) {
      try { localStorage.setItem(RADIUS_KEY, 'any'); } catch (e) {}
      return Infinity;
    }
    var n = parseInt(km, 10);
    if (RADIUS_OPTIONS.indexOf(n) < 0) n = 100;
    try { localStorage.setItem(RADIUS_KEY, String(n)); } catch (e) {}
    return n;
  };

  window.formatDistanceKm = function (km) {
    if (km == null || !isFinite(km)) return '';
    if (km < 1) return Math.max(0.1, Math.round(km * 10) / 10) + ' km away';
    if (km < 100) return (Math.round(km * 10) / 10) + ' km away';
    return Math.round(km) + ' km away';
  };

  window.formatBrowseRadiusLabel = function (radiusKm) {
    if (!isFinite(radiusKm)) return 'anywhere in Canada';
    return 'within ' + radiusKm + ' km';
  };

  window.toApproximateArea = function (loc) {
    var s = String(loc || '').trim();
    if (!s) return '';
    if (/^remote\s*\/?\s*online$/i.test(s)) return 'Remote / Online';
    if (/^\d/.test(s) || /\b(st|street|ave|avenue|rd|road|blvd|drive|dr|cres|way|lane|ln)\b/i.test(s)) {
      var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length >= 2) s = parts.slice(-2).join(', ');
      else return 'Nearby area';
    }
    return typeof formatLocationDisplay === 'function' ? formatLocationDisplay(s) : s;
  };

  window.formatPublicTaskLocation = function (task) {
    if (window.isRemoteTask(task)) return 'Remote / Online';
    var loc = (task && (task.location || task.LOCATION)) || '';
    return window.toApproximateArea(loc);
  };

  window.canViewPreciseAddress = function (task, viewerUid, opts) {
    opts = opts || {};
    if (!task || !viewerUid || window.isRemoteTask(task)) return false;
    var poster = String(task.posted_by || task.POSTED_BY || '');
    var me = String(viewerUid);
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

  window.sortTasksByProximity = function (tasks, userLocation) {
    var pos = window.getGeoFilterPos();
    return (tasks || []).slice().sort(function (a, b) {
      var aRemote = window.isRemoteTask(a);
      var bRemote = window.isRemoteTask(b);
      if (pos) {
        var ca = taskCoords(a);
        var cb = taskCoords(b);
        var da = aRemote ? Infinity : (ca ? haversineKm(pos.lat, pos.lng, ca.lat, ca.lng) : Infinity);
        var db = bRemote ? Infinity : (cb ? haversineKm(pos.lat, pos.lng, cb.lat, cb.lng) : Infinity);
        a._distanceKm = aRemote ? null : (isFinite(da) ? da : null);
        b._distanceKm = bRemote ? null : (isFinite(db) ? db : null);
        if (da !== db) return da - db;
      }
      return 0;
    });
  };

  window.taskDistanceKm = function (task, fromPos) {
    if (window.isRemoteTask(task)) return null;
    var pos = fromPos || window.getGeoFilterPos();
    var c = taskCoords(task);
    if (!pos || !c) return null;
    return haversineKm(pos.lat, pos.lng, c.lat, c.lng);
  };

  /**
   * Haversine radius filter. Remote tasks always pass. In-person tasks without coords are excluded
   * when a viewer position is set (they need backfill / re-post with geocode).
   */
  window.filterTasksByDistance = function (tasks, opts) {
    opts = opts || {};
    var pos = opts.pos || window.getGeoFilterPos();
    var radiusKm = opts.radiusKm != null ? Number(opts.radiusKm) : getNearRadiusKm();
    if (!pos || !isFinite(radiusKm)) return tasks || [];
    return (tasks || []).filter(function (t) {
      if (window.isRemoteTask(t)) {
        t._distanceKm = null;
        return true;
      }
      var c = taskCoords(t);
      if (c) {
        var d = haversineKm(pos.lat, pos.lng, c.lat, c.lng);
        t._distanceKm = d;
        return d <= radiusKm;
      }
      t._distanceKm = null;
      return false;
    });
  };

  function nominatimHeaders() {
    return {
      'Accept-Language': 'en',
      'Accept': 'application/json'
    };
  }

  function canadianLocationLabel(row, fallback) {
    var a = (row && row.address) || {};
    var city = a.city || a.town || a.municipality || a.village || a.hamlet || a.suburb || '';
    var province = a['ISO3166-2-lvl4'] || a.state_code || a.state || '';
    province = String(province).replace(/^CA-/i, '');
    var provinceMap = {
      Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB',
      'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS', Ontario: 'ON',
      'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK',
      'Northwest Territories': 'NT', Nunavut: 'NU', Yukon: 'YT'
    };
    province = provinceMap[province] || province;
    return city ? city + (province ? ', ' + province : '') : String(fallback || '').trim();
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
        var province = (a.state || a.province || '').replace(/^CA-/i, '');
        var provinceMap = {
          Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB',
          'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS', Ontario: 'ON',
          'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK',
          'Northwest Territories': 'NT', Nunavut: 'NU', Yukon: 'YT'
        };
        var shortProv = provinceMap[province] || province;
        var area = neighbourhood && city && neighbourhood.toLowerCase() !== city.toLowerCase()
          ? neighbourhood + ', ' + city
          : (city || neighbourhood || '');
        var loc = area ? area + ', ' + shortProv : '';
        return {
          location: loc,
          lat: roundCoord(lat, 2),
          lng: roundCoord(lng, 2),
          raw: data
        };
      });
  };

  window.geocodeDisplayLocation = function (query) {
    return geocodeQuery(query);
  };

  window.initUserLocation = function () {
    if (localStorage.getItem('qg-user-location')) {
      return Promise.resolve(getUserLocation());
    }
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve('');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude)
            .then(function (res) {
              if (res && res.location) {
                saveLocation(res.location);
                writeUserLocationPos(res.lat, res.lng);
                if (typeof suggestNearRadiusKm === 'function') {
                  suggestNearRadiusKm(res.lat, res.lng);
                }
                resolve(res.location);
              } else {
                resolve('');
              }
            })
            .catch(function () { resolve(''); });
        },
        function () { resolve(''); },
        { timeout: 4000, maximumAge: 600000 }
      );
    });
  };

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
                location: res.location || '',
                lat: res.lat,
                lng: res.lng
              });
            })
            .catch(function () {
              resolve({
                ok: true,
                location: '',
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
