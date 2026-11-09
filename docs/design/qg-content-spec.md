# qg-content.css — change spec (content / legal pages)

Owner: CSS agent (Cursor). Pages affected: terms, privacy, faq, guidelines, how-it-works, safety,
poster-terms, contractor-agreement, dispute-resolution, plus 404 and feedback, which share this file.
Target: the mockup-v3 design language (flat surface cards, DM Sans, muted uppercase labels, Playfair
used only for the wordmark, no gradients or glows).

## 0. What the HTML side already did (no CSS action needed)

- `.nav-logo` now also has the class `sg-wordmark`, and every page links `qg-swift.css` (before `</head>`). The gradient
  wordmark therefore already renders. The `.nav-logo` rule in section 2 only sets the size to 18px and lets the wordmark
  render without qg-swift.css.
- The nav markup is now the same on all 9 pages: `.nav > .nav-brand > .nav-logo.sg-wordmark` + `.nav-right > .back-btn + #modeBtn.mode-btn`.
  (qg-brand-init.js still appends `.nav-role` into `.nav-brand` at runtime.)
- `meta theme-color` is set to `#0B0A14` on all 9 pages. No page has an inline `<style>` block, so this file controls the look.

## 1. Cascade warning: read this before editing

`qg-brand-init.js` appends these stylesheets **after** `qg-content.css` on every content page: qg-role-theme, qg-chrome,
qg-light-nav, qg-refine, qg-states, qg-light-fix, qg-shell, etc. Because they load later, some of their rules beat this file:

| Later sheet | Rule | Effect on content pages | Fix in this file |
|---|---|---|---|
| qg-refine.css | `.page-title{font-size:28px !important}` | page title stays 28px | `.page-content .page-title{font-size:24px !important}` (0,2,0 beats 0,1,0) |
| qg-refine.css | `.section-title{font-size:20px !important}` | h2 stays 20px | `font-size:17px !important` on `.page-content .section-title` |
| qg-light-nav.css | `body.light .mode-btn{background:var(--grad-accent)!important;color:…!important}` | light-mode pill fills with the accent colour | `!important` on `.page-content .mode-btn` background/color/border |
| qg-light-nav.css | `body.light .back-btn{color:var(--accent)!important}` | back link turns accent-coloured | `!important` on `.page-content .back-btn` color |
| qg-light-nav.css | `body.light .tab-btn.active{color:var(--accent)!important}` | **in light Poster mode the active tab gets purple text on a purple fill (invisible)** | `color:var(--primary-text) !important` on `.page-content .tab-btn.active` |
| qg-role-theme.css | `html[data-qg-mode="worker"] .mode-btn{background:rgba(107,63,160,.2)}` | old purple pill in tasker mode | covered by `!important` above |
| qg-shell.css | `.nav .nav-logo{color:var(--brand)!important}` | harmless, because `-webkit-text-fill-color:transparent` paints the gradient | none |

**Outside this file (must be fixed for the pages to stop looking old, so route each one to its owner):**
- **qg-role-theme.css L273–311**: `html[data-qg-mode="worker"]:not(.light)` and `body.light.qg-mode-worker` **redeclare
  `--bg --surface --border --text --text-muted --card-bg --nav-bg`** with the old palette (#0e061c, rgba(200,168,233,.16),
  #2d1b4e, #e8e2ff, #f0eeff…). qg-brand-init sets `data-qg-mode` on `<html>` on every content page, so **in Tasker mode
  every content page repaints in the old palette**. Delete both token blocks. Also L284–289, L323–343: old hex/rgba.
- **qg-cookies.css L20**: `body.light #qgCookieBanner a{color:#6b3fa0}` → `var(--primary)`. Check the rest of that file too.
- **qg-site.js L9**: the footer brand text is `'QuickGigs'`. Rename it to `SwiftGigs` (JS owner).

## 2. Selector-by-selector replacements

Replace each rule's declarations with the block shown. Rules not listed here stay as they are.

```css
/* L6 */
body.page-content,
body.trust-page {
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 15px;
  line-height: 1.65;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  transition: background 0.2s, color 0.2s;
}

/* L16 */
.page-content .nav,
.trust-page .nav {
  position: sticky; top: 0; z-index: 50;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  box-shadow: none;
  padding: 12px 20px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}

/* L30 — wordmark (matches qg-brand.css .nav-brand .nav-logo and the mockup .wordmark-sm) */
.page-content .nav-logo,
.trust-page .nav-logo {
  font-family: 'Playfair Display', Georgia, serif;
  font-style: italic;
  font-weight: 700;
  font-size: 18px;
  line-height: 1;
  letter-spacing: normal;
  background: var(--grad-wordmark);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}
@supports not ((-webkit-background-clip: text) or (background-clip: text)) {
  .page-content .nav-logo,
  .trust-page .nav-logo {
    background: none;
    color: var(--primary);
    -webkit-text-fill-color: var(--primary);
  }
}

/* L45 */
.page-content .back-btn,
.trust-page .back-btn {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted) !important;
  text-decoration: none;
}
.page-content .back-btn:hover,
.trust-page .back-btn:hover { color: var(--text) !important; text-decoration: none; }

/* L53 — secondary pill button */
.page-content .mode-btn,
.trust-page .mode-btn,
.page-content .mode-toggle {
  padding: 6px 14px;
  min-height: 36px;
  border-radius: 100px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface-alt) !important;
  color: var(--text) !important;
  border: 1px solid var(--border) !important;
  box-shadow: none !important;
}

/* L68 */
.page-content .content,
.trust-page .content {
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 20px 80px;
}

/* L75 */
.page-content .page-label,
.trust-page .page-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 8px;
}

/* L86 — DM Sans, not Playfair */
.page-content .page-title,
.trust-page .page-title {
  font-family: 'DM Sans', sans-serif;
  font-size: 24px !important;   /* beats qg-refine .page-title 28px !important */
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: var(--text);
  margin-bottom: 6px;
}
@media (max-width: 480px) {
  .page-content .page-title,
  .trust-page .page-title { font-size: 22px !important; }
}

/* L96 */
.page-content .page-date,
.page-content .page-sub,
.trust-page .page-date {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-muted);
  margin-bottom: 24px;
}

/* L105 — sections divided by a hairline, not boxed */
.page-content .section,
.trust-page .section {
  margin: 0;
  padding: 22px 0;
  border-top: 1px solid var(--border);
  scroll-margin-top: 72px;
}

/* L111 — h2 */
.page-content .section-title,
.trust-page .section-title {
  font-size: 17px !important;    /* beats qg-refine .section-title 20px !important */
  font-weight: 700;
  letter-spacing: -0.005em;
  line-height: 1.35;
  color: var(--text);
  margin-bottom: 10px;
  padding-bottom: 0;
  border-bottom: none;
}

/* L122 / L140 — body copy */
.page-content p,
.trust-page p {
  font-size: 15px;
  line-height: 1.65;
  color: var(--text);
  margin-bottom: 12px;
  max-width: 72ch;
}
.page-content li,
.trust-page li {
  font-size: 15px;
  line-height: 1.65;
  color: var(--text);
  margin-bottom: 6px;
}
.page-content li::marker,
.trust-page li::marker { color: var(--text-muted); }

/* L148 */
.page-content strong,
.trust-page strong { color: var(--text); font-weight: 600; }

/* L154 / L159 — links */
.page-content a,
.trust-page a {
  color: var(--primary);
  text-decoration: none;
  text-underline-offset: 2px;
}
.page-content a:hover,
.trust-page a:hover { text-decoration: underline; }

/* L165 — callout = surface card */
.page-content .info-box,
.trust-page .info-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 20px;
}
.page-content .info-box p,
.trust-page .info-box p { color: var(--text); margin: 0; font-size: 14px; }

/* L180 — zero-tolerance callout (semantic danger) */
.page-content .highlight-box,
.trust-page .highlight-box {
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 20px;
}
.page-content .highlight-box p,
.trust-page .highlight-box p { color: var(--text); margin: 0; font-size: 14px; }
.page-content .highlight-box strong,
.trust-page .highlight-box strong { color: var(--danger); }

/* L195 */
.page-content .contact-card,
.trust-page .contact-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  margin-top: 12px;
}

/* L208 / L215 — table-like tiles (12px radius per stat-tile spec) */
.page-content .service-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
@media (max-width: 420px) { .page-content .service-grid { grid-template-columns: 1fr; } }
.page-content .service-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
}
.page-content .service-name { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 2px; }
.page-content .service-desc { font-size: 12.5px; color: var(--text-muted); margin: 0; }

/* L236 — TOC */
.qg-content-toc {
  margin: 0 0 24px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
}
.qg-content-toc-title {
  font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 8px;
}
.qg-content-toc li { font-size: 13.5px; line-height: 1.45; margin-bottom: 6px; color: var(--text-muted); }
.qg-content-toc a { color: var(--primary); text-decoration: none; font-weight: 500; }

/* L284 — cards */
.page-content .step-card,
.trust-page .step-card,
.qg-help-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: none;
}

/* L294 — step number as icon square */
.page-content .step-num,
.trust-page .step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--primary);
  font-size: 13px; font-weight: 700;
  margin-bottom: 10px;
}

/* L309 — mockup .isq */
.qg-help-ico {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: var(--surface-alt);
  color: var(--primary);
  margin-bottom: 12px;
}
.qg-help-ico .qg-ico { width: 19px; height: 19px; }

/* L325 / L334 */
.page-content .step-card h3,
.trust-page .step-card h3,
.qg-help-card h3 { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.page-content .step-card p,
.trust-page .step-card p,
.qg-help-card p { margin-bottom: 0; font-size: 14px; color: var(--text-muted); }
.qg-help-card li { font-size: 14px; }

/* L355 — flat primary button */
.qg-content-cta {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px;
  padding: 13px 22px;
  border: none;
  border-radius: 12px;
  background: var(--primary);
  color: var(--primary-text);
  font-family: inherit; font-size: 15px; font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  box-shadow: none;
}
.qg-content-cta:hover { filter: brightness(1.06); text-decoration: none; }
.qg-content-cta.is-secondary {
  background: var(--surface-alt);
  color: var(--text);
  border: 1px solid var(--border);
}

/* L393 / L407 — chips */
.page-content .tab-btn,
.trust-page .tab-btn {
  padding: 8px 16px;
  min-height: 40px;
  border-radius: 100px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-family: inherit; font-size: 13.5px; font-weight: 600;
  cursor: pointer;
}
.page-content .tab-btn.active,
.trust-page .tab-btn.active {
  background: var(--primary);
  border-color: var(--primary) !important;
  color: var(--primary-text) !important;   /* beats qg-light-nav body.light .tab-btn.active */
}

/* L425 — FAQ */
.page-content .faq-item,
.trust-page .faq-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0;
  margin-bottom: 10px;
  overflow: hidden;
}
.page-content .faq-q,
.trust-page .faq-q {
  font-size: 14px; font-weight: 600; line-height: 1.4;
  color: var(--text);
  padding: 14px 16px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  cursor: pointer; list-style: none; user-select: none;
}
.page-content .faq-q span,
.trust-page .faq-q span {
  flex-shrink: 0;
  width: 20px; height: 20px;
  display: grid; place-items: center;
  background: none;
  border-radius: 0;
  color: var(--text-muted);
  font-size: 18px; font-weight: 400; line-height: 1;
  transition: transform 0.2s;
}
.page-content .faq-a,
.trust-page .faq-a {
  font-size: 14px; line-height: 1.65;
  color: var(--text-muted);
  padding: 0 16px 16px;
  display: none; max-width: none; margin: 0;
}
/* .faq-item.open rules (L467, L483): unchanged */

/* L501 — 404 code: not a wordmark, so drop Playfair */
.qg-err-code {
  font-family: 'DM Sans', sans-serif;
  font-size: 64px; font-weight: 700; font-style: normal;
  letter-spacing: -0.03em;
  color: var(--text-muted);
  line-height: 1; margin-bottom: 8px;
}

/* L523 */
.page-feedback .nav-title { font-size: 15px; font-weight: 600; color: var(--text); }

/* L529 */
.page-feedback .beta-note {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 13px; line-height: 1.55;
  color: var(--text-muted);
  margin-bottom: 24px;
}

/* L544 */
.page-feedback .field label {
  font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  display: block; margin-bottom: 8px; color: var(--text-muted);
}

/* L558 — inputs */
.page-feedback .field-input,
.page-feedback .field-select,
.page-feedback .field-textarea {
  width: 100%; box-sizing: border-box;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-family: inherit; font-size: 14px;
  outline: none;
}
.page-feedback .field-input::placeholder,
.page-feedback .field-textarea::placeholder { color: var(--text-muted); }
/* L578: change only the data-URI fill  %239a91b8  ->  %239C93AC  (= dark --text-muted; data URIs cannot use var()) */

/* L588 */
.page-feedback .field-input:focus,
.page-feedback .field-select:focus,
.page-feedback .field-textarea:focus {
  border-color: var(--primary);
  outline: 2px solid color-mix(in srgb, var(--primary) 30%, transparent);
  outline-offset: 0;
  box-shadow: none;
}

/* L617 */
.page-feedback .msg-box.err {
  display: block;
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  color: var(--danger);
}

/* L647 / L707 — flat buttons */
.page-feedback .submit-btn {
  width: 100%; min-height: 50px;
  border: none; border-radius: 12px;
  background: var(--primary);
  color: var(--primary-text);
  font-family: inherit; font-size: 15px; font-weight: 600;
  cursor: pointer; box-shadow: none;
}
.page-feedback .home-link {
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 10px 20px; border-radius: 12px;
  background: var(--primary); color: var(--primary-text);
  text-decoration: none; font-weight: 600;
}

/* L689 / L693 / L700 */
.page-feedback .success-icon { background: var(--money-soft); color: var(--green); }  /* other props unchanged */
.page-feedback .success-title { font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.page-feedback .success-sub { font-size: 14px; line-height: 1.6; color: var(--text-muted); margin-bottom: 24px; }

/* L720 — footer */
.page-content .site-footer,
.trust-page .site-footer {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 32px;
  border-top: 1px solid var(--border);
  text-align: center;
  font-size: 12px; line-height: 1.8;
  color: var(--text-muted);
}
.page-content .site-footer a,
.trust-page .site-footer a { color: var(--text-muted); text-decoration: none; }
.page-content .site-footer a:hover,
.trust-page .site-footer a:hover { color: var(--text); text-decoration: underline; }
/* NEW — footer brand slot rendered by qg-site.js */
.page-content .qg-foot-brand,
.trust-page .qg-foot-brand {
  font-family: 'Playfair Display', Georgia, serif;
  font-style: italic; font-weight: 700; font-size: 15px;
  background: var(--grad-wordmark);
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  display: inline-block; margin-bottom: 2px;
}

/* L739 — cookie banner */
#qgCookieBanner {
  /* layout props unchanged */
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);   /* toned down from .35 */
  color: var(--text-muted);
}
#qgCookieBanner p { color: var(--text-muted); }
#qgCookieBanner a { color: var(--primary); }
#qgCookieBanner button {
  background: var(--primary);
  color: var(--primary-text);
  border: none; border-radius: 10px;
  /* padding/size unchanged */
}
```

New rule (optional; keeps the first section from doubling the TOC border):
```css
.page-content .qg-content-toc + .section,
.page-content .page-date + .section { border-top: none; padding-top: 0; }
```

## 3. Every old/hardcoded colour or legacy alias in qg-content.css → replacement

| Line(s) | Current | Replace with |
|---|---|---|
| 578 | `%239a91b8` (off-palette lavender-grey, inside a data URI) | `%239C93AC` |
| 749 | `rgba(0, 0, 0, 0.35)` shadow | `rgba(0, 0, 0, 0.25)` (allowed shadow literal) |
| 10, 90, 115, 150, 225, 330, 439, 526, 569, 696 | `var(--text-primary)` | `var(--text)` |
| 126, 144, 176, 476, 537, 703, 752, 768 | `var(--text-secondary)` | `var(--text)` for body/callout copy (126, 144, 176), `var(--text-muted)` for secondary text (476, 537, 703, 752, 768) |
| 21, 200, 219, 240, 291, 429, 568, 747 | `var(--surface-1)` | `var(--surface)` |
| 22, 61, 118, 199, 218, 241, 290, 398, 427, 567, 727, 748 | `var(--line)` | `var(--border)` |
| 381 | `var(--line-strong)` | `var(--border)` |
| 35, 504 | `var(--brand)` | 35: `var(--grad-wordmark)` + clip (see .nav-logo); 504: `var(--text-muted)` |
| 32, 88, 502 | `'Playfair Display'` | keep only at L32 (wordmark); 88 and 502 → `'DM Sans', sans-serif` |
| 364, 652, 713, 780 | `var(--grad-accent)` | `var(--primary)` (flat) |
| 365, 653, 714, 781 | `var(--on-accent)` | `var(--primary-text)` |
| 48 | `var(--accent)` (back link) | `var(--text-muted)` |
| 64, 80 | `var(--accent)` (mode-btn, page-label) | `var(--text)` / `var(--text-muted)` |
| 156, 274, 734, 772 | `var(--accent)` (links) | `var(--primary)`; footer link 734 → `var(--text-muted)` |
| 303, 316 | `var(--accent)` (step-num / icon colour) | `var(--primary)` |
| 380 | `var(--accent)` (secondary CTA text) | `var(--text)` |
| 410, 460 | `var(--accent)` (active tab / faq +) | `var(--primary-text)` on `var(--primary)` fill / `var(--text-muted)` |
| 591 | `var(--accent)` focus border | `var(--primary)` |
| 63, 171, 302, 315, 409, 459, 535 | `var(--accent-soft)` | 63 → `var(--surface-alt)`; 171, 535 → `var(--surface)`; 302, 315 → `var(--surface-alt)`; 409 → `var(--primary)`; 459 → `none` |
| 592 | `box-shadow: 0 0 0 3px var(--accent-soft)` | `outline: 2px solid color-mix(in srgb, var(--primary) 30%, transparent); box-shadow: none` |
| 170, 411, 536 | `color-mix(… var(--accent) 35/45/32% …)` borders | `var(--border)` (411 → `var(--primary)`) |
| 186, 619 | `color-mix(in srgb, var(--danger) 12%, transparent)` | `var(--danger-soft)` |
| 191 | `.highlight-box p{color:var(--danger)}` | `var(--text)`; danger moves to `strong` |
| 690 | `var(--money)` | `var(--green)` |
| 374 | `filter: brightness(1.05)` | keep (functional hover), 1.06 |

There are no gradients, glows or old-palette hex values (#6b3fa0 family) in qg-content.css itself. The page still looks old
because of the legacy aliases, the Playfair page titles, the `--accent-soft` tinted boxes, and the runtime overrides
listed in §1 (especially the qg-role-theme.css token redeclarations in Tasker mode).
