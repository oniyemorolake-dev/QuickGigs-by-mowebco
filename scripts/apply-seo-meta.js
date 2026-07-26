/**
 * Injects unique title/description/canonical/OG/Twitter/robots into listed HTML pages.
 * Run: node scripts/apply-seo-meta.js
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var OG_IMAGE = 'https://quickgigs.ca/QuickGigsLogo.png';
var BASE = 'https://quickgigs.ca';

var PAGES = {
  'index.html': {
    title: 'QuickGigs — Get everyday tasks done across Canada',
    description: 'Canadian task marketplace to hire local help or earn money doing tasks. Live in Calgary, Edmonton, and across Canada.',
    path: '/',
    robots: 'index,follow',
    isHome: true
  },
  'browsetask.html': {
    title: 'Browse tasks — QuickGigs',
    description: 'Browse open tasks near you on QuickGigs — Canada\'s marketplace to earn money doing errands, home help, and more.',
    path: '/browsetask.html',
    robots: 'index,follow'
  },
  'posttask.html': {
    title: 'Post a task — QuickGigs',
    description: 'Post a task in minutes on QuickGigs. Hire local taskers for errands, cleaning, tutoring, and more across Canada.',
    path: '/posttask.html',
    robots: 'index,follow'
  },
  'login.html': {
    title: 'Log in — QuickGigs',
    description: 'Log in to QuickGigs to post tasks, apply as a tasker, and manage your work across Canada.',
    path: '/login.html',
    robots: 'index,follow'
  },
  'signup.html': {
    title: 'Sign up — QuickGigs',
    description: 'Create a free QuickGigs account to hire local help or earn money doing tasks in Calgary, Edmonton, and beyond.',
    path: '/signup.html',
    robots: 'index,follow'
  },
  'modeselector.html': {
    title: 'Choose how you will use QuickGigs',
    description: 'Start as a poster or tasker on QuickGigs — Canada\'s marketplace for everyday tasks.',
    path: '/modeselector.html',
    robots: 'index,follow'
  },
  'feedback.html': {
    title: 'Feedback — QuickGigs',
    description: 'Share beta feedback with the QuickGigs team. Help improve Canada’s task marketplace.',
    path: '/feedback.html',
    robots: 'index,follow'
  },
  'terms.html': {
    title: 'Terms of service — QuickGigs',
    description: 'Terms of service for QuickGigs, the Canadian marketplace connecting posters and taskers.',
    path: '/terms.html',
    robots: 'index,follow'
  },
  'privacy.html': {
    title: 'Privacy policy — QuickGigs',
    description: 'How QuickGigs collects and uses personal information under Canadian privacy expectations.',
    path: '/privacy.html',
    robots: 'index,follow'
  },
  'dashboard.html': {
    title: 'Dashboard — QuickGigs',
    description: 'Your QuickGigs dashboard for posting tasks and finding work as a tasker.',
    path: '/dashboard.html',
    robots: 'noindex,nofollow'
  },
  'mytasks.html': {
    title: 'My tasks — QuickGigs',
    description: 'Manage posted tasks and applications on QuickGigs.',
    path: '/mytasks.html',
    robots: 'noindex,nofollow'
  },
  'messages.html': {
    title: 'Messages — QuickGigs',
    description: 'Your QuickGigs message inbox.',
    path: '/messages.html',
    robots: 'noindex,nofollow'
  },
  'chat.html': {
    title: 'Chat — QuickGigs',
    description: 'Chat with your poster or tasker on QuickGigs.',
    path: '/chat.html',
    robots: 'noindex,nofollow'
  },
  'review.html': {
    title: 'Leave a review — QuickGigs',
    description: 'Leave a review after a completed QuickGigs task.',
    path: '/review.html',
    robots: 'noindex,nofollow'
  },
  'profile.html': {
    title: 'Profile — QuickGigs',
    description: 'Your QuickGigs profile, skills, and reviews.',
    path: '/profile.html',
    robots: 'noindex,nofollow'
  }
};

function stripExisting(html) {
  return html
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']keywords["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi, '');
}

function buildBlock(meta) {
  var url = BASE + meta.path;
  return [
    '<title>' + meta.title + '</title>',
    '<meta name="description" content="' + meta.description + '">',
    '<meta name="robots" content="' + meta.robots + '">',
    '<link rel="canonical" href="' + url + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:title" content="' + meta.title + '">',
    '<meta property="og:description" content="' + meta.description + '">',
    '<meta property="og:image" content="' + OG_IMAGE + '">',
    '<meta property="og:locale" content="en_CA">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + meta.title + '">',
    '<meta name="twitter:description" content="' + meta.description + '">',
    '<meta name="twitter:image" content="' + OG_IMAGE + '">'
  ].join('\n');
}

function ensureAnalytics(html, file) {
  if (/qg-analytics\.js/.test(html)) return html;
  // Prefer after qg-config.js; else before </head>
  if (/qg-config\.js/.test(html)) {
    return html.replace(
      /(<script[^>]*src=["']qg-config\.js[^"']*["'][^>]*><\/script>)/i,
      '$1\n<script defer src="qg-analytics.js?v=20260726seo"></script>'
    );
  }
  if (/<\/head>/i.test(html)) {
    var inject = '';
    if (!/qg-config\.js/.test(html) && file !== 'terms.html' && file !== 'privacy.html') {
      inject += '<script src="qg-config.js"></script>\n';
    } else if (!/qg-config\.js/.test(html)) {
      inject += '<script src="qg-config.js"></script>\n';
    }
    inject += '<script defer src="qg-analytics.js?v=20260726seo"></script>\n';
    return html.replace(/<\/head>/i, inject + '</head>');
  }
  return html;
}

function ensureHelp(html, file) {
  var app = {
    'dashboard.html': 1, 'browsetask.html': 1, 'posttask.html': 1, 'mytasks.html': 1,
    'messages.html': 1, 'chat.html': 1, 'review.html': 1, 'profile.html': 1, 'modeselector.html': 1
  };
  if (!app[file] || /qg-help\.js/.test(html)) return html;
  return html.replace(/<\/body>/i, '<script defer src="qg-help.js?v=20260726seo"></script>\n</body>');
}

function ensurePolishCss(html) {
  if (/qg-polish\.css/.test(html)) {
    return html.replace(/qg-polish\.css\?v=[^"']+/g, 'qg-polish.css?v=20260726seo');
  }
  if (/qg-brand\.css/.test(html)) {
    return html.replace(
      /(<link[^>]*href=["']qg-brand\.css["'][^>]*>)/i,
      '$1\n<link rel="stylesheet" href="qg-polish.css?v=20260726seo">'
    );
  }
  return html.replace(/<\/head>/i, '<link rel="stylesheet" href="qg-polish.css?v=20260726seo">\n</head>');
}

Object.keys(PAGES).forEach(function (file) {
  var fp = path.join(root, file);
  if (!fs.existsSync(fp)) {
    console.warn('skip missing', file);
    return;
  }
  var html = fs.readFileSync(fp, 'utf8');
  var meta = PAGES[file];
  html = stripExisting(html);
  // Insert block after charset or viewport
  if (/<meta charset=/i.test(html)) {
    html = html.replace(/(<meta charset=[^>]*>\s*)/i, '$1\n' + buildBlock(meta) + '\n');
  } else if (/<head>/i.test(html)) {
    html = html.replace(/<head>/i, '<head>\n' + buildBlock(meta) + '\n');
  }
  html = ensureAnalytics(html, file);
  html = ensureHelp(html, file);
  html = ensurePolishCss(html);
  fs.writeFileSync(fp, html);
  console.log('updated', file);
});

console.log('done');
