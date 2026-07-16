/* QuickGigs — Google Analytics 4 (set ga4MeasurementId in qg-config.js) */
(function () {
  var id = window.QG_CONFIG && window.QG_CONFIG.ga4MeasurementId;
  if (!id || id === 'G-XXXXXXXXXX') return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id, { send_page_view: true });

  window.qgTrackEvent = function (name, params) {
    if (typeof gtag === 'function') gtag('event', name, params || {});
  };

  window.qgTrackConversion = function (conversionLabel) {
    if (typeof gtag === 'function') {
      gtag('event', 'conversion', {
        send_to: id + '/' + conversionLabel
      });
    }
  };
})();
