/* QuickGigs — Google Analytics 4 (set ga4MeasurementId in qg-config.js; use G-XXXXXXXXXX until live) */
(function () {
  var id = (window.QG_CONFIG && window.QG_CONFIG.ga4MeasurementId) || 'G-XXXXXXXXXX';

  window.qgTrackEvent = function (name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  };

  window.qgTrackConversion = function (conversionLabel) {
    if (typeof window.gtag === 'function' && conversionLabel) {
      window.gtag('event', 'conversion', { send_to: id + '/' + conversionLabel });
    }
  };

  // Placeholder IDs do not load the network tag
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
})();
