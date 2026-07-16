/* QuickGigs — shared task categories (browse, categories page, post task) */
(function () {
  var CATEGORIES = [
    { id: 'errands', label: 'Errands', icon: '🚗', bg: 'rgba(251,191,36,0.15)', desc: 'Pickups, drop-offs, and quick runs' },
    { id: 'home', label: 'Home', icon: '🏠', bg: 'rgba(107,63,160,0.2)', desc: 'Cleaning, organizing, and home help' },
    { id: 'tutoring', label: 'Tutoring', icon: '🎓', bg: 'rgba(74,222,128,0.1)', desc: 'Lessons, homework help, and coaching' },
    { id: 'beauty', label: 'Beauty', icon: '💇', bg: 'rgba(200,168,233,0.15)', desc: 'Hair, nails, and personal care' },
    { id: 'moving', label: 'Moving', icon: '🚚', bg: 'rgba(107,63,160,0.2)', desc: 'Lifting, hauling, and move-day help' },
    { id: 'cooking', label: 'Cooking', icon: '🍳', bg: 'rgba(251,191,36,0.12)', desc: 'Meal prep, catering, and kitchen help' },
    { id: 'tech', label: 'Tech', icon: '💻', bg: 'rgba(107,63,160,0.2)', desc: 'Repairs, setup, and troubleshooting' },
    { id: 'care', label: 'Care', icon: '👶', bg: 'rgba(74,222,128,0.1)', desc: 'Childcare, elder care, and companionship' },
    { id: 'gardening', label: 'Garden', icon: '🌿', bg: 'rgba(74,222,128,0.08)', desc: 'Yard work, planting, and outdoor tasks' },
    { id: 'events', label: 'Events', icon: '🎉', bg: 'rgba(200,168,233,0.15)', desc: 'Party help, setup, and event support' },
    { id: 'trades', label: 'Trades', icon: '🔧', bg: 'rgba(107,63,160,0.2)', desc: 'Handyman, repairs, and skilled work' },
    { id: 'other', label: 'Other', icon: '📦', bg: 'rgba(255,255,255,0.06)', desc: 'Everything else on QuickGigs' }
  ];

  var MAP = {};
  CATEGORIES.forEach(function (c) { MAP[c.id] = c; });

  window.QG_CATEGORIES = CATEGORIES;
  window.QG_CAT_MAP = MAP;

  window.getCatInfo = function (cat) {
    var k = (cat || '').toLowerCase().trim();
    return MAP[k] || { id: k || 'other', label: cat || 'Other', icon: '📦', bg: 'rgba(255,255,255,0.06)', desc: '' };
  };
})();
