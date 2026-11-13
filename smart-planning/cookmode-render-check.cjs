// cookmode-render-check.cjs — render simulation for Cook Mode.
// Extracts the REAL renderCookModeOverlay() + updateWakeLockButtons() +
// syncTimerDockClearance() (+ wakeLockSupported, clampCookStepIndex, esc)
// from site/app.js and runs them against a stub DOM. Rebuilt 2026-11-11
// after the /tmp copy was lost in a VM replacement; this copy lives next
// to the test suites so it survives. Helpers that the render calls but
// that do not matter for the structural checks (cookModeIngredientsHTML,
// cookModeStepHTML, helpLinkHTML) are stubbed with deterministic HTML.
// Checks 1–15 are the behavioral harness (real overlay render, wake-label
// updates, dock lift/clear). Checks 16–27 are the A2 / T1–T3 CSS checks,
// merged 2026-11-12 from Argon's rewritten harness (its checks 4–15) —
// the rewritten file itself was rejected: it never called
// renderCookModeOverlay, so it could not replace this harness.
// Run: node smart-planning/cookmode-render-check.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'site', 'app.js'), 'utf8');

function extract(src, name) {
  // form 1: function NAME(
  let m = new RegExp('function ' + name + '\\s*\\(').exec(src);
  if (m) {
    let i = src.indexOf('{', m.index);
    let depth = 0;
    const start = m.index;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
  }
  // form 2: const/let NAME = <expression>;  (e.g. esc at app.js:53)
  m = new RegExp('(?:const|let) ' + name + '\\s*=\\s*').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  const start = m.index;
  let i = m.index + m[0].length, depth = 0, inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}

const REAL = ['renderCookModeOverlay', 'updateWakeLockButtons', 'syncTimerDockClearance',
  'wakeLockSupported', 'clampCookStepIndex'].map(n => extract(SRC, n)).join('\n\n');
// esc is a 2-line const-arrow with a regex literal containing quotes, so the
// extractor mis-parses it; stub it with byte-identical semantics (app.js:53).
const ESC_STUB = "const esc = s => String(s ?? '').replace(/[&<>\"']/g,\n  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n";

// --- stub DOM -------------------------------------------------------------
function makeEl(id) {
  const el = {
    id: id || '', className: '', _html: '',
    style: {}, _attrs: {}, _labelText: null, _text: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) {
      if (sel === '.cm-btn-label') {
        if (this._noLabel) return null;
        const self = this;
        return { get textContent() { return self._labelText; },
                 set textContent(v) { self._labelText = v; } };
      }
      return null;
    },
    appendChild() {},
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = v;
      const m = /<span class="cm-btn-label">([^<]*)<\/span>/.exec(v);
      if (m) this._labelText = m[1];
    },
    configurable: true,
  });
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = v; },
    configurable: true,
  });
  return el;
}

const registry = {};
const bodyStyle = {};
let parsedCache = {};
let lastOverlayHtml = null;
const documentStub = {
  getElementById(id) {
    if (registry[id]) return registry[id];
    const overlay = registry['cook-mode-overlay'];
    if (!overlay) return null;
    if (overlay._html !== lastOverlayHtml) { parsedCache = {}; lastOverlayHtml = overlay._html; }
    if (parsedCache[id]) return parsedCache[id];
    // The overlay's buttons are HTML text, not real elements: parse the
    // element with this id out of the overlay's innerHTML.
    const m = new RegExp('<\\w+[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</\\w+>').exec(overlay._html);
    if (!m) return null;
    const el = makeEl(id);
    el.innerHTML = m[1];
    parsedCache[id] = el;
    return el;
  },
  querySelector(sel) {
    if (sel === '.cook-mode-overlay') return registry['cook-mode-overlay'] || null;
    return null;
  },
  createElement(tag) { return makeEl(''); },
  body: { style: bodyStyle, appendChild(el) { if (el.id) registry[el.id] = el; } },
};
const dock = makeEl('timer-dock');
dock.hidden = true;
Object.defineProperty(dock, 'offsetHeight', { get() { return this._h || 0; }, set(v) { this._h = v; }, configurable: true });
registry['timer-dock'] = dock;

// navigator: Node 24's built-in is getter-only, so define it explicitly.
function setNavigator(wakeLock) {
  Object.defineProperty(globalThis, 'navigator',
    { value: wakeLock === undefined ? {} : { wakeLock }, configurable: true, writable: true });
}
setNavigator({ request: async () => ({ released: false, release: async () => {} }) });

// --- run the real code in one scope ---------------------------------------
const harness = `
let activeTimers = [];
let wakeLockWanted = false;
let wakeLockSentinel = null;
let cookModeState = null;
function cookModeIngredientsHTML() { return '<li>test ingredient</li>'; }
function cookModeStepHTML() { return '<div class="cm-step-card"><div class="cm-step-body">Test step.</div></div>'; }
function helpLinkHTML(section, iconOnly) { return '<a class="help-link" href="#/guide?section=cook-mode">?</a>'; }
${ESC_STUB}
${REAL}
`;
const run = new Function('document', harness + '\nreturn { renderCookModeOverlay, updateWakeLockButtons, syncTimerDockClearance, setState: (s) => { cookModeState = s; }, setWake: (w, s) => { wakeLockWanted = w; wakeLockSentinel = s; }, setTimers: (t) => { activeTimers = t; } };');
const api = run(documentStub);

function freshState(overrides) {
  return Object.assign({
    recipe: { title: 'Baked Feta Pasta', instructions: ['Step one.', 'Step two.', 'Step three.'], variants: [] },
    stepIdx: 0, getScale: () => 1, getVariant: () => null,
    ingDrawerOpen: false, isSpeaking: false, autoRead: false, checkedIngredients: {},
  }, overrides || {});
}

const results = [];
function check(name, ok) { results.push([name, !!ok]); }

// --- checks ---------------------------------------------------------------
api.setState(freshState());
api.renderCookModeOverlay();
const html = registry['cook-mode-overlay'].innerHTML;

check('rendered HTML has no probe identifiers', !/probe/i.test(html));
check('wake button has icon + label spans',
  /id="cm-wake-btn"[^>]*><span class="cm-icon"[^>]*>☀<\/span><span class="cm-btn-label">/.test(html));
const topActions = /<div class="cm-top-actions">([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
const actionsHtml = topActions ? topActions[1] : '';
check('exit button is LAST in the top actions',
  actionsHtml.lastIndexOf('cm-exit-btn') > actionsHtml.lastIndexOf('cm-wake-btn') &&
  actionsHtml.lastIndexOf('cm-exit-btn') > actionsHtml.lastIndexOf('cm-drawer-toggle'));
check('exit button has aria-label "Exit Cook Mode"',
  /cm-exit-btn"[^>]*aria-label="Exit Cook Mode"/.test(html));
check('drawer toggle carries aria-expanded',
  /cm-drawer-toggle"[^>]*aria-expanded="(true|false)"/.test(html));
check('help link appears exactly once, inside .cm-ing-foot',
  (html.match(/help-link/g) || []).length === 1 &&
  /<div class="cm-ing-foot">[\s\S]*?help-link/.test(html));
check('speech bar + nav deck present',
  html.includes('cm-speech-bar') && html.includes('cm-nav-deck'));
check('label reads "Auto-read" with the " on Next" suffix span (v20261111d)',
  html.includes('Auto-read') && html.includes('<span class="cm-autoread-suffix"> on Next</span>'));

// unsupported branch: no wakeLock -> fallback span, no wake button
setNavigator(undefined);
api.setState(freshState());
delete registry['cook-mode-overlay'];
api.renderCookModeOverlay();
const htmlNoWl = registry['cook-mode-overlay'].innerHTML;
check('unsupported branch renders the fallback span, no wake button',
  htmlNoWl.includes('wake-unsupported') && !htmlNoWl.includes('id="cm-wake-btn"'));
setNavigator({ request: async () => ({ released: false, release: async () => {} }) });

// wake lock button behaviour
api.setState(freshState());
delete registry['cook-mode-overlay'];
api.renderCookModeOverlay();
const cmBtn = documentStub.getElementById('cm-wake-btn');
const labelEl = cmBtn.querySelector('.cm-btn-label');
api.setWake(true, { released: false });
api.updateWakeLockButtons();
check('wake ON updates only the label span, icon span intact',
  labelEl.textContent === 'Screen awake: On' &&
  registry['cook-mode-overlay'].innerHTML.includes('<span class="cm-icon"'));
check('wake ON sets aria-pressed + aria-label',
  cmBtn.getAttribute('aria-pressed') === 'true' &&
  cmBtn.getAttribute('aria-label') === 'Screen awake: On');
api.setWake(false, null);
api.updateWakeLockButtons();
check('wake OFF restores the label',
  labelEl.textContent === 'Keep screen awake: Off');

// no-label-span fallback writes the full text onto the button
const bareBtn = makeEl('cm-wake-btn');
bareBtn._noLabel = true;
registry['cm-wake-btn'] = bareBtn;
api.setWake(false, null);
api.updateWakeLockButtons();
check('no-label-span fallback writes full text on the button',
  bareBtn.textContent === '☀ Keep screen awake: Off');
delete registry['cm-wake-btn'];

// dock clearance
api.setTimers([{ id: 't1' }]);
dock.hidden = false; dock.offsetHeight = 200;
api.syncTimerDockClearance();
check('overlay lifted 200px with a timer',
  registry['cook-mode-overlay'].style.bottom === '200px' &&
  bodyStyle.paddingBottom === '200px');
api.setTimers([]);
api.syncTimerDockClearance();
check('lift cleared when there are no timers',
  registry['cook-mode-overlay'].style.bottom === '' && bodyStyle.paddingBottom === '');

// --- extra section: A2 / T1–T3 CSS checks (Argon's checks 4–15, verbatim
// except renumbering) -----------------------------------------------
const CSS = fs.readFileSync(path.join(__dirname, '..', 'site', 'styles.css'), 'utf8');
const portraitIdx = CSS.indexOf('@media (max-width: 768px)');
const landscapeIdx = CSS.indexOf('@media (orientation: landscape) and (max-height: 500px)');
const rcptIdx = CSS.indexOf('BEGIN DELIMITED RECEIPTS STYLES');
const baseCookCSS = CSS.slice(CSS.indexOf('.cook-mode-overlay {'), portraitIdx);
const portraitCSS = CSS.slice(portraitIdx, landscapeIdx);
const landscapeCSS = CSS.slice(landscapeIdx, rcptIdx);

check('16. CSS: .cm-title-wrap uses align-items: center',
  /\.cm-title-wrap\s*\{[^}]*align-items:\s*center;/.test(baseCookCSS));
check('17. CSS: .cm-step-card uses justify-content: flex-start and overflow-y: auto',
  /\.cm-step-card\s*\{[^}]*justify-content:\s*flex-start;[^}]*overflow-y:\s*auto;/.test(baseCookCSS));
check('18. CSS: Portrait .cm-progress-pill is hidden (display: none)',
  /\.cm-progress-pill\s*\{\s*display:\s*none;\s*\}/.test(portraitCSS));
check('19. CSS: Desktop & Landscape .cm-progress-pill is NOT hidden',
  !/\.cm-progress-pill\s*\{\s*display:\s*none;\s*\}/.test(baseCookCSS) &&
  !/\.cm-progress-pill\s*\{\s*display:\s*none;\s*\}/.test(landscapeCSS));
check('20. CSS: Portrait .cm-step-badge is visible as eyebrow (display: block, 0.78rem, bottom border)',
  /\.cm-step-badge\s*\{[^}]*display:\s*block;[^}]*font-size:\s*0\.78rem;[^}]*border-bottom:\s*1px solid var\(--cream-dark\);/.test(portraitCSS));
check('21. CSS: Landscape .cm-step-badge stays hidden (display: none)',
  /\.cm-step-badge\s*\{\s*display:\s*none;\s*\}/.test(landscapeCSS));
check('22. CSS: T1 Portrait & Landscape .cm-title wraps to 2 lines (-webkit-line-clamp: 2), no ellipsis/nowrap',
  /\.cm-title\s*\{[^}]*-webkit-line-clamp:\s*2;/.test(portraitCSS) &&
  /\.cm-title\s*\{[^}]*-webkit-line-clamp:\s*2;/.test(landscapeCSS) &&
  !/\.cm-title\s*\{[^}]*white-space:\s*nowrap/.test(portraitCSS) &&
  !/\.cm-title\s*\{[^}]*white-space:\s*nowrap/.test(landscapeCSS));
check('23. CSS: T2 Portrait & Landscape .wake-pill.active uses warm cream (#fff6ec / #d9a074 / var(--accent-dark))',
  /\.cm-top-actions\s+\.wake-pill\.active\s*\{[^}]*background:\s*#fff6ec;[^}]*border-color:\s*#d9a074;[^}]*color:\s*var\(--accent-dark\);/.test(portraitCSS) &&
  /\.cm-top-actions\s+\.wake-pill\.active\s*\{[^}]*background:\s*#fff6ec;[^}]*border-color:\s*#d9a074;[^}]*color:\s*var\(--accent-dark\);/.test(landscapeCSS));
check('24. CSS: T2 no .wake-pill.active::after corner dot anywhere in styles.css',
  !CSS.includes('.wake-pill.active::after'));
check('25. CSS: T3 Portrait & Landscape .cm-drawer-toggle .cm-btn-label is display: inline',
  /\.cm-drawer-toggle\s+\.cm-btn-label\s*\{\s*display:\s*inline;\s*\}/.test(portraitCSS) &&
  /\.cm-drawer-toggle\s+\.cm-btn-label\s*\{\s*display:\s*inline;\s*\}/.test(landscapeCSS));
check('26. CSS: T2/T3 Portrait & Landscape icon buttons are 44x44 rounded squares and .cm-drawer-toggle is width: auto',
  /\.cm-top-actions\s+\.pill,\s*\.cm-top-actions\s+\.btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/.test(portraitCSS) &&
  /\.cm-top-actions\s+\.cm-drawer-toggle\s*\{[^}]*width:\s*auto;/.test(portraitCSS));
check('27. CSS: Drawer toggle active state keeps terracotta fill (var(--accent) / #fff)',
  /\.cm-top-actions\s+\.cm-drawer-toggle\.active\s*\{[^}]*background:\s*var\(--accent\);[^}]*color:\s*#fff;/.test(portraitCSS));

const failed = results.filter(r => !r[1]);
for (const [name, ok] of results) console.log((ok ? 'PASS ' : 'FAIL ') + name);
console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' render checks passed ====');
if (failed.length) process.exit(1);
