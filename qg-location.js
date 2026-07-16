// QuickGigs — detect and store user city for task location defaults
(function () {
  var DEFAULT = 'Calgary, AB';

  function saveLocation(city) {
    if (city) localStorage.setItem('qg-user-location', city);
  }

  window.getUserLocation = function () {
    return localStorage.getItem('qg-user-location') || DEFAULT;
  };

  window.getUserCityLabel = function () {
    return getUserLocation().split(',')[0].trim();
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
          fetch(
            'https://nominatim.openstreetmap.org/reverse?lat=' + pos.coords.latitude +
            '&lon=' + pos.coords.longitude + '&format=json',
            { headers: { 'Accept-Language': 'en' } }
          )
            .then(function (r) { return r.json(); })
            .then(function (data) {
              var a = data.address || {};
              var city = a.city || a.town || a.municipality || a.county || '';
              var province = (a.state || a.province || 'Alberta').replace('Alberta', 'AB');
              var shortProv = province.length > 2 ? province.split(' ')[0] : province;
              var loc = city ? city + ', ' + shortProv : DEFAULT;
              saveLocation(loc);
              resolve(loc);
            })
            .catch(function () { resolve(DEFAULT); });
        },
        function () { resolve(DEFAULT); },
        { timeout: 4000, maximumAge: 600000 }
      );
    });
  };

  window.setUserLocation = function (city) {
    saveLocation(city);
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
    return (tasks || []).slice().sort(function (a, b) {
      var sa = getLocationProximityScore(a.location || a.LOCATION, loc);
      var sb = getLocationProximityScore(b.location || b.LOCATION, loc);
      if (sa !== sb) return sa - sb;
      return 0;
    });
  };
})();
