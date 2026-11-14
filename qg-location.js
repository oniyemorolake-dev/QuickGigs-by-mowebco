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
    if (String(task.location_type || task.LOCATION_TYPE || '').toLowerCase() === 'remote') return true;
    return /^remote\b/i.test(String(task.location || task.LOCATION || '').trim());
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
   * Haversine radius filter. Remote tasks always pass. Tasks without coords stay
   * visible unless includeUnknown is explicitly false — Nearby should not empty
   * the list just because a gig was posted with a city name and no pin.
   */
  window.filterTasksByDistance = function (tasks, opts) {
    opts = opts || {};
    var pos = opts.pos || window.getGeoFilterPos();
    var radiusKm = opts.radiusKm != null ? Number(opts.radiusKm) : getNearRadiusKm();
    if (!pos || !isFinite(radiusKm)) return tasks || [];
    var keepUnknown = opts.includeUnknown !== false;
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
      // No pin on the gig: fall back to the city name, so a Toronto tasker is
      // not shown a pinless Calgary gig as "nearby".
      var myCity = window.getUserCityLabel ? window.getUserCityLabel() : '';
      if (myCity) return taskInCity(t, myCity);
      return keepUnknown;
    });
  };

  function cityKey(label) {
    return String(label || '').split(',')[0].trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  /** True when the gig's public location names this city. */
  function taskInCity(task, city) {
    var want = cityKey(city);
    if (!want) return true;
    var loc = String((task && (task.location || task.LOCATION)) || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return loc.split(',').some(function (part) { return part.trim() === want; });
  }
  window.taskInCity = taskInCity;

  /** City-name filter for when there is a chosen city but no coordinates. Remote gigs always pass. */
  window.filterTasksByCity = function (tasks, city) {
    if (!cityKey(city)) return tasks || [];
    return (tasks || []).filter(function (t) {
      return window.isRemoteTask(t) || taskInCity(t, city);
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

  // Instant answer for the cities we serve most. Task locations are only
  // ever shown at city level (coords are rounded to ~1 km), so when the device
  // is inside one of these metros there is no need to wait on a network lookup.
  var NEAR_CITIES = [
    ['Calgary, AB', 51.045, -114.06, 30], ['Edmonton, AB', 53.546, -113.49, 30],
    ['Airdrie, AB', 51.29, -114.01, 8], ['Cochrane, AB', 51.19, -114.47, 8],
    ['Chestermere, AB', 51.05, -113.82, 6], ['Okotoks, AB', 50.73, -113.98, 8],
    ['St. Albert, AB', 53.63, -113.63, 7], ['Sherwood Park, AB', 53.54, -113.30, 8],
    ['Spruce Grove, AB', 53.54, -113.91, 7], ['Leduc, AB', 53.26, -113.55, 7],
    ['Red Deer, AB', 52.27, -113.81, 15], ['Lethbridge, AB', 49.69, -112.84, 15],
    ['Medicine Hat, AB', 50.04, -110.68, 12], ['Grande Prairie, AB', 55.17, -118.79, 12],
    ['Fort McMurray, AB', 56.73, -111.38, 15], ['Canmore, AB', 51.09, -115.35, 8],
    ['Vancouver, BC', 49.28, -123.12, 20], ['Victoria, BC', 48.43, -123.37, 15],
    ['Kelowna, BC', 49.89, -119.50, 15], ['Saskatoon, SK', 52.13, -106.67, 18],
    ['Regina, SK', 50.45, -104.61, 18], ['Winnipeg, MB', 49.90, -97.14, 22],
    ['Toronto, ON', 43.65, -79.38, 25], ['Ottawa, ON', 45.42, -75.70, 22],
    ['Montreal, QC', 45.50, -73.57, 22], ['Halifax, NS', 44.65, -63.58, 18]
  ];
  function kmBetween(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  /** Nearest served city within its radius, checking the small suburbs first. */
  function nearestKnownCity(lat, lng) {
    var best = null;
    NEAR_CITIES.forEach(function (c) {
      var d = kmBetween(lat, lng, c[1], c[2]);
      if (d <= c[3] && (!best || d / c[3] < best.score)) best = { name: c[0], score: d / c[3] };
    });
    return best ? best.name : '';
  }
  window.nearestKnownCity = nearestKnownCity;

  /** City-level name for a coordinate: "Calgary, AB". Neighbourhoods are left
   *  out on purpose: they read as an exact address and the server geocoder
   *  often could not match them, which produced "choose a valid city". */
  window.reverseGeocodeCity = function (lat, lng) {
    var quick = nearestKnownCity(lat, lng);
    if (quick) {
      return Promise.resolve({ location: quick, lat: roundCoord(lat, 2), lng: roundCoord(lng, 2), raw: null });
    }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : null;
    return fetch(
      NOMINATIM + '/reverse?lat=' + encodeURIComponent(lat) +
      '&lon=' + encodeURIComponent(lng) + '&format=json&zoom=10',
      { headers: nominatimHeaders(), signal: ctrl ? ctrl.signal : undefined }
    )
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        var a = data.address || {};
        var city = a.city || a.town || a.village || a.municipality || a.county || '';
        var province = (a.state || a.province || '').replace(/^CA-/i, '');
        var provinceMap = {
          Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB',
          'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS', Ontario: 'ON',
          'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK',
          'Northwest Territories': 'NT', Nunavut: 'NU', Yukon: 'YT'
        };
        var shortProv = provinceMap[province] || province;
        return {
          location: city ? city + (shortProv ? ', ' + shortProv : '') : '',
          lat: roundCoord(lat, 2),
          lng: roundCoord(lng, 2),
          raw: data
        };
      }, function (err) { if (timer) clearTimeout(timer); throw err; });
  };

  window.geocodeDisplayLocation = function (query) {
    return geocodeQuery(query);
  };

  /* A saved city used to be kept forever, so someone who signed up in Calgary
     and opened the app in Toronto still got Calgary gigs. When location
     permission is already granted this re-reads the device position quietly
     (no prompt) and moves the saved city if they are somewhere else. A city
     the person typed in themselves is left alone. */
  var refreshStarted = false;
  function refreshUserLocation() {
    if (refreshStarted || !navigator.geolocation) return;
    refreshStarted = true;
    try { if (localStorage.getItem('qg-user-location-manual') === '1') return; } catch (e) {}
    var go = function () {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (!isCanadianCoordinate(lat, lng)) return;
        writeGeoFilterPos(lat, lng);
        var saved = readUserLocationPos();
        if (saved && haversineKm(saved.lat, saved.lng, lat, lng) < 15) {
          document.dispatchEvent(new CustomEvent('qg-location-changed'));
          return;
        }
        reverseGeocodeCity(lat, lng).then(function (res) {
          if (res && res.location) {
            saveLocation(res.location);
            writeUserLocationPos(res.lat, res.lng);
            try { localStorage.removeItem(RADIUS_KEY); } catch (e) {}
            suggestNearRadiusKm(res.lat, res.lng);
          }
          document.dispatchEvent(new CustomEvent('qg-location-changed'));
        }).catch(function () {});
      }, function () {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
    };
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
        if (st && st.state === 'granted') go();
      }).catch(function () {});
    }
  }
  window.refreshUserLocation = refreshUserLocation;

  /** The person picked this city by hand: it wins over the device position. */
  window.chooseUserCity = function (city) {
    return window.setUserLocation(city).then(function (res) {
      if (res) {
        try {
          localStorage.setItem('qg-user-location-manual', '1');
          localStorage.removeItem(RADIUS_KEY);
        } catch (e) {}
        suggestNearRadiusKm(res.lat, res.lng);
        document.dispatchEvent(new CustomEvent('qg-location-changed'));
      }
      return res;
    });
  };
  /** Back to following the device. */
  window.useDeviceLocation = function () {
    try { localStorage.removeItem('qg-user-location-manual'); } catch (e) {}
    return window.requestGeoForFilter({ keepPrevious: true }).then(function (pos) {
      if (!pos) return null;
      return reverseGeocodeCity(pos.lat, pos.lng).then(function (res) {
        if (res && res.location) {
          saveLocation(res.location);
          writeUserLocationPos(res.lat, res.lng);
          try { localStorage.removeItem(RADIUS_KEY); } catch (e) {}
          suggestNearRadiusKm(res.lat, res.lng);
        }
        document.dispatchEvent(new CustomEvent('qg-location-changed'));
        return res;
      });
    });
  };

  window.initUserLocation = function () {
    if (localStorage.getItem('qg-user-location')) {
      refreshUserLocation();
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

  window.captureTaskLocationFromDevice = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ ok: false, error: 'unsupported' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var lat = pos.coords.latitude;
          var lng = pos.coords.longitude;
          if (!isCanadianCoordinate(lat, lng)) {
            resolve({ ok: false, error: 'outside_canada' });
            return;
          }
          reverseGeocodeCity(lat, lng)
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
                lat: roundCoord(lat, 2),
                lng: roundCoord(lng, 2)
              });
            });
        },
        function (err) {
          resolve({ ok: false, error: err && err.code === 1 ? 'denied' : 'failed' });
        },
        // City-level is all we store (coords are rounded to ~1 km), so ask for
        // the fast network/Wi-Fi fix and accept one from the last 10 minutes.
        // High-accuracy GPS with maximumAge 0 took 5-12 s from a cold start.
        {
          enableHighAccuracy: false,
          timeout: 7000,
          maximumAge: 10 * 60 * 1000
        }
      );
    });
  };

  // Canadian cities / large towns for typeahead. Neighbourhoods and postal
  // codes still go through geocode-canada on submit; this list is the instant
  // “as you type” set so posters are not staring at a blank field.
  var CANADIAN_CITIES = [
    'Calgary, AB', 'Edmonton, AB', 'Red Deer, AB', 'Lethbridge, AB', 'St. Albert, AB',
    'Medicine Hat, AB', 'Grande Prairie, AB', 'Airdrie, AB', 'Spruce Grove, AB',
    'Leduc, AB', 'Fort McMurray, AB', 'Fort Saskatchewan, AB', 'Okotoks, AB',
    'Cochrane, AB', 'Camrose, AB', 'Brooks, AB', 'Canmore, AB', 'Banff, AB',
    'Chestermere, AB', 'Beaumont, AB', 'Lloydminster, AB', 'Cold Lake, AB',
    'Lacombe, AB', 'Wetaskiwin, AB', 'High River, AB', 'Strathmore, AB',
    'Sherwood Park, AB', 'Stony Plain, AB', 'Sylvan Lake, AB', 'Hinton, AB',
    'Jasper, AB', 'Peace River, AB', 'Whitecourt, AB',
    'Vancouver, BC', 'Victoria, BC', 'Surrey, BC', 'Burnaby, BC', 'Richmond, BC',
    'Kelowna, BC', 'Kamloops, BC', 'Nanaimo, BC', 'Abbotsford, BC', 'Coquitlam, BC',
    'Langley, BC', 'Delta, BC', 'North Vancouver, BC', 'West Vancouver, BC',
    'New Westminster, BC', 'Maple Ridge, BC', 'Chilliwack, BC', 'Prince George, BC',
    'Vernon, BC', 'Courtenay, BC', 'Penticton, BC', 'Campbell River, BC',
    'Mission, BC', 'Port Coquitlam, BC', 'White Rock, BC', 'Port Moody, BC',
    'Cranbrook, BC', 'Fort St. John, BC', 'Terrace, BC', 'Prince Rupert, BC',
    'Williams Lake, BC', 'Dawson Creek, BC', 'Squamish, BC', 'Whistler, BC',
    'Revelstoke, BC', 'Nelson, BC', 'Trail, BC', 'Castlegar, BC', 'Salmon Arm, BC',
    'Parksville, BC', 'Sidney, BC', 'Saanich, BC', 'Langford, BC', 'Colwood, BC',
    'Sooke, BC', 'Duncan, BC', 'Pitt Meadows, BC', 'Port Alberni, BC',
    'Winnipeg, MB', 'Brandon, MB', 'Steinbach, MB', 'Thompson, MB',
    'Portage la Prairie, MB', 'Winkler, MB', 'Selkirk, MB', 'Dauphin, MB',
    'Morden, MB', 'Flin Flon, MB',
    'Moncton, NB', 'Saint John, NB', 'Fredericton, NB', 'Dieppe, NB',
    'Miramichi, NB', 'Edmundston, NB', 'Bathurst, NB', 'Riverview, NB',
    "St. John's, NL", 'Mount Pearl, NL', 'Corner Brook, NL', 'Conception Bay South, NL',
    'Paradise, NL', 'Grand Falls-Windsor, NL', 'Gander, NL', 'Labrador City, NL',
    'Happy Valley-Goose Bay, NL',
    'Halifax, NS', 'Dartmouth, NS', 'Sydney, NS', 'Truro, NS', 'New Glasgow, NS',
    'Kentville, NS', 'Amherst, NS', 'Bridgewater, NS', 'Yarmouth, NS',
    'Antigonish, NS', 'Wolfville, NS', 'Bedford, NS', 'Sackville, NS',
    'Toronto, ON', 'Ottawa, ON', 'Mississauga, ON', 'Brampton, ON', 'Hamilton, ON',
    'London, ON', 'Markham, ON', 'Vaughan, ON', 'Kitchener, ON', 'Windsor, ON',
    'Richmond Hill, ON', 'Oakville, ON', 'Burlington, ON', 'Greater Sudbury, ON',
    'Oshawa, ON', 'Barrie, ON', 'St. Catharines, ON', 'Cambridge, ON', 'Kingston, ON',
    'Guelph, ON', 'Thunder Bay, ON', 'Waterloo, ON', 'Brantford, ON', 'Pickering, ON',
    'Niagara Falls, ON', 'Peterborough, ON', 'Newmarket, ON', 'Sault Ste. Marie, ON',
    'Sarnia, ON', 'Welland, ON', 'North Bay, ON', 'Belleville, ON', 'Cornwall, ON',
    'Chatham-Kent, ON', 'Ajax, ON', 'Whitby, ON', 'Milton, ON', 'Clarington, ON',
    'Caledon, ON', 'Aurora, ON', 'Halton Hills, ON', 'St. Thomas, ON',
    'Woodstock, ON', 'Stratford, ON', 'Orillia, ON', 'Orangeville, ON',
    'Collingwood, ON', 'Wasaga Beach, ON', 'Owen Sound, ON', 'Brockville, ON',
    'Timmins, ON', 'Kenora, ON', 'Bracebridge, ON', 'Huntsville, ON', 'Grimsby, ON',
    'Fort Erie, ON', 'Cobourg, ON', 'Port Hope, ON', 'Quinte West, ON',
    'Niagara-on-the-Lake, ON', 'Midland, ON', 'Lindsay, ON',
    'Charlottetown, PE', 'Summerside, PE', 'Stratford, PE', 'Cornwall, PE',
    'Montreal, QC', 'Quebec City, QC', 'Laval, QC', 'Gatineau, QC', 'Longueuil, QC',
    'Sherbrooke, QC', 'Saguenay, QC', 'Levis, QC', 'Trois-Rivieres, QC',
    'Terrebonne, QC', 'Brossard, QC', 'Repentigny, QC', 'Drummondville, QC',
    'Saint-Jerome, QC', 'Granby, QC', 'Blainville, QC', 'Saint-Hyacinthe, QC',
    'Shawinigan, QC', 'Rimouski, QC', 'Chateauguay, QC', 'Victoriaville, QC',
    'Rouyn-Noranda, QC', "Val-d'Or, QC", 'Magog, QC', 'Mascouche, QC', 'Mirabel, QC',
    'Boucherville, QC', 'Alma, QC', 'Sept-Iles, QC', 'Riviere-du-Loup, QC',
    'Baie-Comeau, QC', 'Gaspe, QC', 'Pointe-Claire, QC', 'Dollard-des-Ormeaux, QC',
    'Saskatoon, SK', 'Regina, SK', 'Prince Albert, SK', 'Moose Jaw, SK',
    'Swift Current, SK', 'Yorkton, SK', 'North Battleford, SK', 'Estevan, SK',
    'Weyburn, SK', 'Lloydminster, SK', 'Warman, SK', 'Martensville, SK',
    'Yellowknife, NT', 'Hay River, NT', 'Inuvik, NT', 'Fort Smith, NT',
    'Iqaluit, NU', 'Rankin Inlet, NU',
    'Whitehorse, YT', 'Dawson City, YT'
  ];
  var MAJOR_CITIES = [
    'Toronto, ON', 'Montreal, QC', 'Vancouver, BC', 'Calgary, AB',
    'Edmonton, AB', 'Ottawa, ON', 'Winnipeg, MB', 'Halifax, NS'
  ];

  function isPostalish(q) {
    return /^[A-Za-z]\d[A-Za-z]/.test(String(q || '').trim());
  }

  function rankCityMatch(city, q) {
    var c = city.toLowerCase();
    var name = c.split(',')[0];
    var major = MAJOR_CITIES.indexOf(city) >= 0 ? 0 : 10;
    var r;
    if (name === q) r = 0;
    else if (name.indexOf(q) === 0) r = 1;
    else if (c.indexOf(q) === 0) r = 2;
    else if (name.indexOf(q) >= 0) r = 3;
    else if (c.indexOf(q) >= 0) r = 4;
    else return -1;
    return r + major;
  }

  window.suggestCanadianCities = function (query, limit) {
    limit = limit || 8;
    var q = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (isPostalish(q)) return [];
    if (!q) return MAJOR_CITIES.slice(0, limit);
    var scored = [];
    var seen = {};
    for (var i = 0; i < CANADIAN_CITIES.length; i++) {
      var city = CANADIAN_CITIES[i];
      var key = city.toLowerCase();
      if (seen[key]) continue;
      var r = rankCityMatch(city, q);
      if (r < 0) continue;
      seen[key] = true;
      scored.push({ city: city, r: r });
    }
    scored.sort(function (a, b) {
      return a.r - b.r || a.city.length - b.city.length || a.city.localeCompare(b.city);
    });
    var out = [];
    for (var j = 0; j < scored.length && out.length < limit; j++) out.push(scored[j].city);
    return out;
  };

  window.searchCanadianPlaces = function (query, signal) {
    var q = String(query || '').trim();
    if (q.length < 3 || isPostalish(q)) return Promise.resolve([]);
    return fetch(
      NOMINATIM + '/search?q=' + encodeURIComponent(q) +
      '&countrycodes=ca&format=json&addressdetails=1&limit=8',
      { headers: nominatimHeaders(), signal: signal }
    )
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var seen = {};
        var out = [];
        (rows || []).forEach(function (row) {
          var cls = String(row.class || '');
          if (cls && cls !== 'place' && cls !== 'boundary') return;
          var label = canadianLocationLabel(row, '');
          var key = label.toLowerCase();
          if (!label || seen[key]) return;
          seen[key] = true;
          out.push(label);
        });
        return out;
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return [];
        return [];
      });
  };

  window.bindCanadianCityTypeahead = function (input, listEl, opts) {
    if (!input || !listEl) return;
    opts = opts || {};
    var active = -1;
    var items = [];
    var timer = null;
    var ac = null;

    function close() {
      listEl.hidden = true;
      listEl.innerHTML = '';
      active = -1;
      items = [];
      input.setAttribute('aria-expanded', 'false');
      if (ac) { try { ac.abort(); } catch (e) {} ac = null; }
    }

    function select(city) {
      input.value = city;
      close();
      if (typeof opts.onSelect === 'function') opts.onSelect(city);
    }

    function paint() {
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      items.forEach(function (city, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = city;
        btn.setAttribute('aria-selected', i === active ? 'true' : 'false');
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        btn.addEventListener('click', function () { select(city); });
        li.appendChild(btn);
        listEl.appendChild(li);
      });
      listEl.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function showLocal(q) {
      items = suggestCanadianCities(q, 8);
      active = items.length ? 0 : -1;
      paint();
    }

    function mergeRemote(remote) {
      if (!remote || !remote.length) return;
      var seen = {};
      items.forEach(function (c) { seen[c.toLowerCase()] = true; });
      remote.forEach(function (c) {
        var key = String(c || '').toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        items.push(c);
      });
      items = items.slice(0, 8);
      if (active < 0 && items.length) active = 0;
      paint();
    }

    function onQuery() {
      var q = input.value;
      showLocal(q);
      if (timer) clearTimeout(timer);
      if (ac) { try { ac.abort(); } catch (e) {} ac = null; }
      if (String(q || '').trim().length < 3 || isPostalish(q)) return;
      timer = setTimeout(function () {
        ac = typeof AbortController === 'function' ? new AbortController() : null;
        searchCanadianPlaces(q, ac && ac.signal).then(mergeRemote);
      }, 320);
    }

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listEl.id || 'sgAreaSuggest');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');

    input.addEventListener('input', onQuery);
    input.addEventListener('focus', function () { onQuery(); });
    input.addEventListener('blur', function () {
      setTimeout(close, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (listEl.hidden) {
        if (e.key === 'ArrowDown') { onQuery(); e.preventDefault(); }
        return;
      }
      if (e.key === 'ArrowDown') {
        active = Math.min(items.length - 1, active + 1);
        paint();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        active = Math.max(0, active - 1);
        paint();
        e.preventDefault();
      } else if (e.key === 'Enter' && active >= 0 && items[active]) {
        select(items[active]);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        close();
        e.preventDefault();
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target === input || listEl.contains(e.target)) return;
      close();
    });
  };
})();
