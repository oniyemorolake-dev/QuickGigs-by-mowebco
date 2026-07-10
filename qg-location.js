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
})();
