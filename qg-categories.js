/* QuickGigs — shared task categories (browse, categories page, post task) */
(function () {
  var CATEGORIES = [
    { id: 'errands', label: 'Errands', icon: '🚗', bg: 'rgba(251,191,36,0.15)', desc: 'Pickups, drop-offs, and quick runs', requires_enhanced_verification: false },
    { id: 'home', label: 'Home', icon: '🏠', bg: 'rgba(107,63,160,0.2)', desc: 'Cleaning, organizing, and home help', requires_enhanced_verification: false },
    { id: 'tutoring', label: 'Tutoring', icon: '🎓', bg: 'rgba(74,222,128,0.1)', desc: 'Lessons, homework help, and coaching', requires_enhanced_verification: false },
    { id: 'beauty', label: 'Beauty', icon: '💇', bg: 'rgba(200,168,233,0.15)', desc: 'Hair, nails, and personal care', requires_enhanced_verification: false },
    { id: 'moving', label: 'Moving', icon: '🚚', bg: 'rgba(107,63,160,0.2)', desc: 'Lifting, hauling, and move-day help', requires_enhanced_verification: false },
    { id: 'cooking', label: 'Cooking', icon: '🍳', bg: 'rgba(251,191,36,0.12)', desc: 'Meal prep, catering, and kitchen help', requires_enhanced_verification: false },
    { id: 'tech', label: 'Tech', icon: '💻', bg: 'rgba(107,63,160,0.2)', desc: 'Repairs, setup, and troubleshooting', requires_enhanced_verification: false },
    { id: 'care', label: 'Care', icon: '👶', bg: 'rgba(74,222,128,0.1)', desc: 'Childcare, elder care, and companionship', requires_enhanced_verification: true },
    { id: 'gardening', label: 'Garden', icon: '🌿', bg: 'rgba(74,222,128,0.08)', desc: 'Yard work, planting, and outdoor tasks', requires_enhanced_verification: false },
    { id: 'events', label: 'Events', icon: '🎉', bg: 'rgba(200,168,233,0.15)', desc: 'Party help, setup, and event support', requires_enhanced_verification: false },
    { id: 'trades', label: 'Trades', icon: '🔧', bg: 'rgba(107,63,160,0.2)', desc: 'Handyman, repairs, and skilled work', requires_enhanced_verification: false },
    { id: 'other', label: 'Other', icon: '📦', bg: 'rgba(255,255,255,0.06)', desc: 'Everything else on QuickGigs', requires_enhanced_verification: false }
  ];

  var MAP = {};
  CATEGORIES.forEach(function (c) { MAP[c.id] = c; });

  window.QG_CATEGORIES = CATEGORIES;
  window.QG_CAT_MAP = MAP;

  window.QG_categoryRequiresEnhancedVerification = function (cat) {
    var info = window.getCatInfo(cat);
    return !!(info && info.requires_enhanced_verification);
  };

  window.getCatInfo = function (cat) {
    var k = (cat || '').toLowerCase().trim();
    return MAP[k] || { id: k || 'other', label: cat || 'Other', icon: '📦', bg: 'rgba(255,255,255,0.06)', desc: '', requires_enhanced_verification: false };
  };
})();
