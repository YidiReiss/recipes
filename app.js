/* ============================================================
   Reiss Family Recipes — app
   Vanilla JS. No frameworks, no CDNs, no build step.

   Data lives in the repo:
     data/recipes/index.json      -> ["id", ...] manifest
     data/recipes/<id>.json       -> one recipe per file
     data/meal-plan.json          -> { weeks: { "YYYY-MM-DD": {...} } }

   Editing + meal planner persist through a private write bridge
   (a Cloudflare Worker holding the GitHub token securely server-side).
   Reads are direct from the public repo; writes POST to the bridge.
   No login, no per-device setup, no token in the repo — editing is on.
   ============================================================ */
'use strict';

/* ---------------- Config ---------------- */
const REPO = { owner: 'YidiReiss', repo: 'recipes', branch: 'main' };
/* Private write bridge — set to the deployed Worker URL. */
const BRIDGE = 'https://recipe-bridge.leibreiss.workers.dev';
const editingEnabled = () => true; // editing is always on; no login gate
const KNOWN_CATEGORIES = ['main', 'side', 'soup', 'salad', 'fish', 'chicken',
                          'meat', 'dessert', 'baking', 'breakfast'];

/* ---------------- State ---------------- */
let recipes = [];          // recipe objects, in manifest order
let byId = {};             // id -> recipe
let mealPlan = { weeks: {} };
let plannerOffset = 0;     // weeks away from the current week
let filters = { q: '', kosher: 'all', kfp: false, category: 'all',
                maxTime: 0, tag: 'all', leftovers: false, sort: 'asc' };
let editDraft = null;      // working copy while the edit form is open
let editingSlot = null;    // {key, di, meal} while a planner slot is being edited

/* ---------------- Small helpers ---------------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const totalTime = r => (Number(r.prep_minutes) || 0) + (Number(r.cook_minutes) || 0);
const fmtTime = mins => {
  mins = Number(mins) || 0;
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + ' hr' + (m ? ' ' + m + ' min' : '') : m + ' min';
};

/* base64 with proper unicode handling (GitHub API needs base64 content) */
const toB64 = s => btoa(unescape(encodeURIComponent(s)));
const fromB64 = b => decodeURIComponent(escape(atob(String(b).replace(/\s+/g, ''))));

/* ---------------- Toast + modal ---------------- */
let toastTimer = null;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3600);
}
function closeModal() {
  const m = $('#modal');
  if (m) m.remove();
}

/* ---------------- Write bridge ----------------
   Reads go straight to the public repo (no auth needed).
   Every write POSTs to the private bridge, which holds the GitHub
   token securely and commits on the site's behalf. */
const GH = 'https://api.github.com';

async function bridgeSave(path, content, message, encoding) {
  const res = await fetch(BRIDGE + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, message, encoding: encoding || 'utf8' })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 160); } catch (e) {}
    throw new Error('save failed (' + res.status + ') ' + detail);
  }
  return res.json();
}

async function ghGet(path) {
  const res = await fetch(
    GH + '/repos/' + REPO.owner + '/' + REPO.repo + '/contents/' + path +
    '?ref=' + encodeURIComponent(REPO.branch),
    { headers: { 'Accept': 'application/vnd.github+json' } }
  );
  if (res.status === 404) throw new Error('missing'); // file doesn't exist yet
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return { sha: j.sha, text: fromB64(j.content || '') };
}

async function ghPut(path, text, message) {
  return bridgeSave(path, text, message || ('Update ' + path + ' via recipe site'));
}
async function ghPutB64(path, b64, message) {
  return bridgeSave(path, String(b64).replace(/\s+/g, ''),
    message || ('Upload ' + path + ' via recipe site'), 'base64');
}

/* ---------------- Badges + banners ---------------- */
function badgesHTML(r) {
  const k = String(r.kosher_status || '').toLowerCase();
  let h = '<span class="badge ' + esc(k) + '">' + esc(k ? k.toUpperCase() : '?') + '</span>';
  if (r.kosher_for_passover) h += ' <span class="badge kfp">KFP</span>';
  return '<span class="badges">' + h + '</span>';
}

// Elegant fallback when a recipe has no banner_image: warm gradient + title.
// No placeholder image files needed.
function bannerHTML(r) {
  if (r.banner_image) {
    return '<img src="' + esc(r.banner_image) + '" alt="' + esc(r.title) + '" loading="lazy">';
  }
  const v = [...String(r.id || r.title)].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  return '<div class="banner-fallback gf-' + v + '" role="img" aria-label="' +
         esc(r.title) + '"><span>' + esc(r.title) + '</span></div>';
}

/* ---------------- Boot ---------------- */
function loadError() {
  $('#app').innerHTML =
    '<div class="load-error"><h2>Couldn’t load recipes</h2>' +
    '<p>Your browser blocked the site from reading its own data files. ' +
    'This happens when the site is opened straight from disk.</p>' +
    '<p>Serve it over HTTP instead — from the site folder, run:</p>' +
    '<p><code>python3 -m http.server 8000</code></p>' +
    '<p>then open <code>http://localhost:8000</code>.</p></div>';
}

async function boot() {
  try {
    const idxRes = await fetch('data/recipes/index.json');
    if (!idxRes.ok) throw new Error('no manifest');
    const ids = await idxRes.json();
    recipes = [];
    for (const id of (Array.isArray(ids) ? ids : [])) {
      try {
        const r = await (await fetch('data/recipes/' + id + '.json')).json();
        recipes.push(r);
      } catch (e) { console.warn('Could not load recipe', id, e); }
    }
  } catch (e) { loadError(); return; }

  byId = {};
  recipes.forEach(r => { byId[r.id] = r; });

  try {
    const mp = await (await fetch('data/meal-plan.json')).json();
    mealPlan = (mp && typeof mp.weeks === 'object') ? mp : { weeks: {} };
  } catch (e) { mealPlan = { weeks: {} }; }

  window.addEventListener('hashchange', route);
  route();

  // Keep the meal plan fresh when someone else (e.g. Nava) saves:
  // re-fetch when the tab regains focus, unless mid-edit.
  const maybeRefreshPlan = async () => {
    if (editingSlot || document.hidden) return;
    try {
      const mp = await (await fetch('data/meal-plan.json?t=' + Date.now())).json();
      if (mp && typeof mp.weeks === 'object') {
        mealPlan = mp;
        const h = location.hash || '#/';
        if (h === '#/planner' || h === '#/' || h === '') route();
      }
    } catch (e) { /* keep the copy we have */ }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRefreshPlan(); });
  window.addEventListener('focus', maybeRefreshPlan);
}

/* Re-fetch the meal plan (e.g. after someone else saves). Skips while editing. */
async function refreshMealPlan() {
  if (editingSlot) return;
  try {
    const mp = await (await fetch('data/meal-plan.json?t=' + Date.now())).json();
    if (mp && typeof mp.weeks === 'object') mealPlan = mp;
  } catch (e) { /* keep the copy we have */ }
}

/* ---------------- Router ---------------- */
function route() {
  closeModal();
  editingSlot = null;
  const h = location.hash || '#/';
  const app = $('#app');
  $('#nav-recipes').classList.toggle('active', !h.startsWith('#/planner'));
  $('#nav-planner').classList.toggle('active', h.startsWith('#/planner'));
  window.scrollTo(0, 0);
  document.title = 'Reiss Family Recipes';
  if (h.startsWith('#/recipe/')) return renderRecipe(app, decodeURIComponent(h.slice(9)));
  if (h.startsWith('#/edit/')) return renderEdit(app, decodeURIComponent(h.slice(7)));
  if (h === '#/add') return renderAdd(app);
  if (h === '#/submit') return renderSubmit(app);
  if (h === '#/planner') {
    // Grab the latest plan in case someone else just saved.
    refreshMealPlan().then(() => { if ((location.hash || '#/') === '#/planner') renderPlanner(app); });
    return renderPlanner(app);
  }
  return renderHome(app);
}

/* ---------------- Home ---------------- */

/* Aggregate this week's planned recipes into a shopping list. */
const UNICODE_FRACS = { '½': 1/2, '⅓': 1/3, '⅔': 2/3, '¼': 1/4, '¾': 3/4, '⅕': 1/5, '⅖': 2/5, '⅗': 3/5, '⅘': 4/5, '⅙': 1/6, '⅚': 5/6, '⅛': 1/8, '⅜': 3/8, '⅝': 5/8, '⅞': 7/8 };
function parseQty(q) {
  if (q == null) return null;
  let s = String(q).trim();
  if (!s) return null;
  // unicode fractions -> ascii ("1½" -> "1 1/2", "¾" -> "3/4")
  s = s.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, m => {
    const v = UNICODE_FRACS[m];
    const num = Math.round(v * 8), den = 8; // normalize to eighths then reduce below
    return ' ' + num + '/' + den;
  }).trim().replace(/\s+/g, ' ');
  // mixed number "1 3/4", fraction "3/4", decimal "1.5", integer "2"
  let total = 0, found = false;
  const mixed = s.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed && +mixed[3]) return (+mixed[1]) + (+mixed[2]) / (+mixed[3]);
  const frac = s.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (frac && +frac[2]) return (+frac[1]) / (+frac[2]);
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return null;
}
function fmtQty(n) {
  // 1.5 -> "1½", 0.75 -> "¾", 2 -> "2". Reduces to eighths.
  if (n == null) return '';
  const rounded = Math.round(n * 8) / 8;
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  const FRAC_STR = { 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' };
  const fs = FRAC_STR[Math.round(frac * 1000) / 1000] || '';
  if (!whole && !fs) return '0';
  return (whole ? String(whole) : '') + fs;
}
/* Words that never take an "s" in a shopping list. */
const UNCOUNTABLES = new Set(['water', 'salt', 'pepper', 'garlic', 'mayonnaise', 'flour', 'sugar', 'oil', 'milk',
  'butter', 'cheese', 'rice', 'pasta', 'bread', 'honey', 'vinegar', 'sauce', 'ketchup', 'mustard',
  'coca-cola', 'coke', 'coffee', 'tea', 'juice', 'broth', 'stock', 'cream', 'yogurt', 'beef', 'chicken',
  'pork', 'fish', 'salmon', 'tuna', 'turkey', 'lamb', 'bacon', 'sausage', 'tofu', 'cornstarch']);
function pluralize(word, qty) {
  // Conservative: only pluralize simple countable nouns when qty > 1.
  // Never touches parentheticals — pluralizes the head word only.
  if (!(qty > 1)) return word;
  const m = word.match(/^(.*?)(\s*\(.*\))?$/);
  const head = (m[1] || '').trim(), tail = m[2] || '';
  if (!head) return word;
  const low = head.toLowerCase();
  if (UNCOUNTABLES.has(low)) return word;
  const words = low.split(/\s+/);
  const lastWord = words[words.length - 1];
  // Mass nouns stay singular even with modifiers ("fresh garlic", "lean ground beef",
  // "Worcestershire sauce", "black pepper"). Exception: "bell pepper" is a countable vegetable.
  const isBellPepper = low === 'bell pepper' || low.endsWith(' bell pepper');
  if (!isBellPepper && UNCOUNTABLES.has(lastWord)) return word;
  if (/s$/.test(low)) return word; // already plural (or looks it) — leave alone
  let p = head;
  if (/[^aeiou]y$/.test(low)) p = head.slice(0, -1) + 'ies';
  else if (/(x|z|ch|sh)$/.test(low)) p = head + 'es';
  else p = head + 's';
  return (p + (tail ? ' ' + tail.trim() : '')).trim();
}
function thisWeekKey() { return ymd(sundayOf(0)); }
/* Day-date (yyyy-mm-dd) of each slot index for a week starting at `mon`. */
function weekDayYmd(mon, i) {
  const d = new Date(mon);
  d.setDate(d.getDate() + i);
  return ymd(d);
}
function shoppingFromYmd() {
  const week = getWeek(thisWeekKey());
  return week.shoppingDay || null;
}
/* Size descriptors that don't change what you buy ("large egg" = "egg"). Stripped
   for grouping so "1 egg" + "1 large egg" merge. Never applied to display alone. */
const SIZE_WORDS = ['extra-large', 'extra large', 'jumbo', 'large', 'medium', 'small'];
function stripSize(item) {
  let s = ' ' + String(item || '').toLowerCase() + ' ';
  SIZE_WORDS.forEach(w => {
    s = s.replace(new RegExp(' ' + w.replace(/-/g, '[- ]').replace(/ /g, '\\s+') + ' ', 'g'), ' ');
  });
  return s.trim().replace(/\s+/g, ' ');
}
/* Convert tsp/tbsp/cup to a common base so "½ cup + 3 tbsp" merges to one line. */
const TSP_PER = { tsp: 1, tbsp: 3, cup: 48 };
function fromTsp(total) {
  // Prefer cups for anything >= ¼ cup (12 tsp) — "11 tbsp" becomes "¾ cup".
  if (total >= 12) return { qty: total / 48, unit: 'cup' };
  if (total >= 3) return { qty: total / 3, unit: 'tbsp' };
  return { qty: total, unit: 'tsp' };
}
/* Count-to-volume for common produce, so "1 onion" + "½ cup chopped onion"
   merge. Conservative: only these three, widely-agreed conversions. */
const COUNT_TO_TSP = {
  'onion': 24,   // 1 medium onion ≈ ½ cup chopped
  'garlic': 1,   // 1 clove ≈ 1 tsp minced
  'lemon': 9,    // 1 lemon ≈ 3 tbsp juice
};
/* Canonical grouping key: lowercase, no size words, singular-ish. */
function groupKey(item) {
  let s = stripSize(item);
  // singularize last word for grouping ("eggs"->"egg") so plurals merge
  s = s.replace(/\b(\w+)s$/, (m, w) => {
    if (w.length <= 2 || /ss$/.test(w)) return m;
    return w;
  });
  return s;
}
/* Pluralize units for display: "2 cups", but "2 tbsp" stays. */
function pluralizeUnit(unit, qty) {
  if (!(qty > 1)) return unit;
  const u = (unit || '').toLowerCase();
  if (u === 'cup') return 'cups';
  if (u === 'can') return 'cans';
  if (u === 'package') return 'packages';
  if (u === 'clove') return 'cloves';
  return unit;
}
function buildShoppingList() {
  const mon = sundayOf(0);
  const week = getWeek(thisWeekKey());
  const from = shoppingFromYmd();
  const ids = [];
  week.days.forEach((d, i) => {
    if (from && weekDayYmd(mon, i) < from) return; // already cooked — had the ingredients
    ['lunch', 'dinner'].forEach(m => {
      const s = d[m];
      if (s && s.recipe && !s.skipped && byId[s.recipe]) ids.push(s.recipe);
    });
  });
  // Group on the clean item name (intake already split item/prep), with size
  // words stripped so "1 egg" + "1 large egg" merge. Shopping list shows
  // what to BUY only — prep notes are cooking instructions, not shopping info.
  // tsp/tbsp/cup convert to a common base so "½ cup + 3 tbsp" becomes one line.
  const map = new Map();
  ids.forEach(id => {
    const r = byId[id];
    (r.ingredients || []).forEach(sec => {
      (sec.items || []).forEach(it => {
        const raw = (it.item || '').trim();
        if (!raw) return;
        const gkey = groupKey(raw);
        if (!gkey) return;
        let unitRaw = (it.unit || '').trim();
        let qtyVal = parseQty(it.qty);
        // normalize convertible units to tsp-base for grouping
        const ul = unitRaw.toLowerCase();
        let convBase = null;
        if (qtyVal !== null && TSP_PER[ul]) {
          convBase = qtyVal * TSP_PER[ul];
          unitRaw = '__tspbase__';
        } else if (qtyVal !== null && COUNT_TO_TSP[gkey] && (ul === '' || ul === 'clove' || ul === 'cloves')) {
          // count-to-volume: "1 onion" -> 24 tsp so it merges with "½ cup chopped onion"
          convBase = qtyVal * COUNT_TO_TSP[gkey];
          unitRaw = '__tspbase__';
        }
        const nkey = gkey + '|' + unitRaw.toLowerCase();
        let e = map.get(nkey);
        if (!e) {
          e = { base: gkey, unit: unitRaw, qty: 0, hasNum: false, texts: [], isConv: !!convBase };
          map.set(nkey, e);
        }
        if (convBase !== null) { e.qty += convBase; e.hasNum = true; }
        else {
          const n = parseQty(it.qty);
          if (n !== null) { e.qty += n; e.hasNum = true; }
          else if (it.qty && String(it.qty).trim()) e.texts.push(String(it.qty).trim());
        }
      });
    });
  });
  return [...map.values()].map(e => {
    let q = '', qnum = 0, dispUnit = e.unit;
    if (e.hasNum) {
      if (e.isConv) {
        const c = fromTsp(Math.round(e.qty * 100) / 100);
        qnum = Math.round(c.qty * 100) / 100;
        q = fmtQty(qnum);
        dispUnit = c.unit;
      } else {
        qnum = Math.round(e.qty * 100) / 100;
        q = fmtQty(qnum);
      }
    }
    if (e.texts.length) q = (q ? q + ' + ' : '') + e.texts.join(' + ');
    const name = pluralize(e.base, e.hasNum ? qnum : 0);
    const du = dispUnit === '__tspbase__' ? '' : pluralizeUnit(dispUnit, e.hasNum ? qnum : 0);
    return {
      key: e.base.toLowerCase() + '|' + du.toLowerCase(),
      label: [q, du, name].filter(Boolean).join(' ').trim()
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
}
/* Manual (synced) shopping-list items live on the week object. */
function manualItems() {
  const week = getWeek(thisWeekKey());
  if (!Array.isArray(week.manualItems)) week.manualItems = [];
  return week.manualItems;
}
function saveManualItems(done) {
  persistWeek(thisWeekKey(), null, done || null, true);
}

function weekStripHTML() {
  const mon = sundayOf(0);
  const week = getWeek(thisWeekKey());
  const shopDay = week.shoppingDay || null;
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(d.getDate() + i);
    const ds = week.days[i];
    const isShop = shopDay && weekDayYmd(mon, i) === shopDay;
    const parts = [];
    ['lunch', 'dinner'].forEach(m => {
      const s = ds[m];
      if (!s || s.skipped) return;
      if (s.recipe && byId[s.recipe]) parts.push(byId[s.recipe].title);
      else if (s.custom) parts.push(s.custom);
    });
    out.push(
      '<a class="week-day' + (isShop ? ' is-shop' : '') + '" href="#/planner">' +
        '<span class="wd-name">' + d.toLocaleDateString('en-US', { weekday: 'short' }) +
        (isShop ? ' 🛒' : '') + '</span>' +
        '<span class="wd-meals">' + (parts.length ? esc(parts.join(' · ')) : '<em>—</em>') + '</span>' +
      '</a>'
    );
  }
  return out.join('');
}

function tilesHTML() {
  const tile = (label, count, img, act) =>
    '<button type="button" class="cat-tile" data-tile="' + esc(act) + '">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="tile-ph"></span>') +
      '<span class="tile-label">' + esc(label) + ' <em>' + count + '</em></span></button>';
  const out = [];
  ['meat', 'dairy', 'pareve'].forEach(k => {
    const rs = recipes.filter(r => r.kosher_status === k);
    if (!rs.length) return;
    const img = (rs.find(r => r.banner_image) || {}).banner_image || '';
    out.push(tile(k[0].toUpperCase() + k.slice(1), rs.length, img, 'kosher:' + k));
  });
  allCats().slice(0, 6).forEach(c => {
    const rs = recipes.filter(r => (r.categories || []).includes(c));
    if (!rs.length) return;
    const img = (rs.find(r => r.banner_image) || {}).banner_image || '';
    out.push(tile(c, rs.length, img, 'cat:' + c));
  });
  return out.join('');
}

function shoppingFromLabel() {
  const from = shoppingFromYmd();
  if (!from) return '';
  return ' <span class="muted" style="font-weight:400;font-size:.85rem">— from ' +
    esc(new Date(from + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) +
    ' onward</span>';
}
function shoppingListHTML() {
  const week = getWeek(thisWeekKey());
  if (!Array.isArray(week.manualItems)) week.manualItems = [];
  if (!Array.isArray(week.checkedGenerated)) week.checkedGenerated = [];
  const items = buildShoppingList();
  const from = shoppingFromYmd();
  const checked = week.checkedGenerated;
  const genLis = items.map(it =>
    '<label class="shop-item"><input type="checkbox" data-shop="' + esc(it.key) + '"' +
      (checked.includes(it.key) ? ' checked' : '') + '>' +
      '<span>' + esc(it.label) + '</span></label>'
  ).join('');
  const manLis = week.manualItems.map(m =>
    '<label class="shop-item manual"><input type="checkbox" data-manual="' + esc(m.id) + '"' +
      (m.checked ? ' checked' : '') + '>' +
      '<span>' + esc(m.text) + '</span>' +
      '<button class="shop-del" data-mandel="' + esc(m.id) + '" type="button" aria-label="Remove">×</button></label>'
  ).join('');
  let html = '';
  if (!items.length && !week.manualItems.length) {
    html = '<p class="muted">Nothing planned yet' + (from ? ' from the shopping day onward' : '') +
      ' — <a href="#/planner">plan your week</a> and your shopping list builds itself here.</p>';
  } else {
    if (genLis) html += '<div class="shop-list" data-gen="1">' + genLis + '</div>';
    if (manLis) html += '<h3 class="shop-sub">Your items</h3><div class="shop-list" data-man="1">' + manLis + '</div>';
  }
  html += '<div class="shop-add no-print"><input type="text" id="shop-new" placeholder="Add your own item…" aria-label="Add your own item">' +
    '<button class="btn secondary" id="shop-add" type="button">Add</button></div>';
  html += '<div style="margin-top:.6rem"><button class="btn secondary" id="shop-copy" type="button">Copy list</button></div>';
  return html;
}

/* ---------------- Home: search / filter / grid ---------------- */
const allTags = () => [...new Set(recipes.flatMap(r => r.tags || []))].sort();
const allCats = () => [...new Set(recipes.flatMap(r => r.categories || []))].sort();

function renderHome(app) {
  const tags = allTags(), cats = allCats();
  app.innerHTML =
    '<section class="hero">' +
      '<h1>What are we cooking?</h1>' +
      '<div class="search-row hero-search no-print">' +
        '<input type="search" id="q" placeholder="Search recipes, ingredients, tags…" ' +
        'value="' + esc(filters.q) + '" aria-label="Search recipes"></div>' +
    '</section>' +

    '<section class="home-section">' +
      '<div class="section-head"><h2>This week</h2>' +
      '<a class="link-btn" href="#/planner">Open planner →</a></div>' +
      '<div class="week-strip">' + weekStripHTML() + '</div>' +
    '</section>' +

    '<section class="home-section">' +
      '<div class="section-head"><h2>Shopping list' + shoppingFromLabel() + '</h2></div>' +
      '<div id="shop-wrap">' + shoppingListHTML() + '</div>' +
    '</section>' +

    '<section class="home-section">' +
      '<div class="section-head"><h2>Browse recipes</h2></div>' +
      '<div class="cat-tiles no-print">' + tilesHTML() + '</div>' +
    '</section>' +

    '<section id="browse">' +
    '<div class="no-print" id="filter-toggle-wrap"><button class="btn secondary" id="filter-toggle" type="button">Show filters</button></div>' +
    '<div class="filters no-print" id="filters">' +
      '<div class="filter-field"><label for="f-kosher">Kosher</label><select id="f-kosher">' +
        '<option value="all">All</option>' +
        ['meat', 'dairy', 'pareve'].map(k =>
          '<option value="' + k + '"' + (filters.kosher === k ? ' selected' : '') + '>' +
          k[0].toUpperCase() + k.slice(1) + '</option>').join('') +
      '</select></div>' +
      '<div class="filter-field"><label for="f-cat">Category</label><select id="f-cat">' +
        '<option value="all">All</option>' +
        cats.map(c => '<option' + (filters.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
      '</select></div>' +
      '<div class="filter-field"><label for="f-tag">Tag</label><select id="f-tag">' +
        '<option value="all">All</option>' +
        tags.map(t => '<option' + (filters.tag === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
      '</select></div>' +
      '<div class="filter-field"><label for="f-time">Max time</label><select id="f-time">' +
        '<option value="0">Any</option>' +
        [15, 30, 45, 60, 90, 120].map(m =>
          '<option value="' + m + '"' + (filters.maxTime === m ? ' selected' : '') + '>≤ ' + m + ' min</option>').join('') +
      '</select></div>' +
      '<div class="filter-field"><label for="f-sort">Sort</label><select id="f-sort">' +
        '<option value="asc"' + (filters.sort === 'asc' ? ' selected' : '') + '>Time: short → long</option>' +
        '<option value="desc"' + (filters.sort === 'desc' ? ' selected' : '') + '>Time: long → short</option>' +
      '</select></div>' +
      '<label class="check-row"><input type="checkbox" id="f-kfp"' + (filters.kfp ? ' checked' : '') + '> Kosher for Passover</label>' +
      '<label class="check-row"><input type="checkbox" id="f-left"' + (filters.leftovers ? ' checked' : '') + '> Good leftovers</label>' +
    '</div>' +
    '<p class="result-count" id="result-count"></p>' +
    '<div class="no-print" style="margin:0 0 1rem"><a class="btn" href="#/add">+ Add recipe</a> ' +
    '<a class="btn secondary" href="#/submit">Submit a link or photo</a></div>' +
    '<div class="card-grid" id="grid"></div></section>';

  $('#q').addEventListener('input', e => { filters.q = e.target.value; drawGrid(); });

  $('#q').addEventListener('input', e => { filters.q = e.target.value; drawGrid(); });
  $('#f-kosher').addEventListener('change', e => { filters.kosher = e.target.value; drawGrid(); });
  $('#f-cat').addEventListener('change', e => { filters.category = e.target.value; drawGrid(); });
  $('#f-tag').addEventListener('change', e => { filters.tag = e.target.value; drawGrid(); });
  $('#f-time').addEventListener('change', e => { filters.maxTime = Number(e.target.value); drawGrid(); });
  $('#f-sort').addEventListener('change', e => { filters.sort = e.target.value; drawGrid(); });
  $('#f-kfp').addEventListener('change', e => { filters.kfp = e.target.checked; drawGrid(); });
  $('#f-left').addEventListener('change', e => { filters.leftovers = e.target.checked; drawGrid(); });
  const fz = $('#filters'), ft = $('#filter-toggle');
  ft.addEventListener('click', () => {
    const hidden = fz.style.display === 'none';
    fz.style.display = hidden ? '' : 'none';
    ft.textContent = hidden ? 'Hide filters' : 'Show filters';
  });
  if (window.innerWidth < 700) { fz.style.display = 'none'; }
  else { ft.style.display = 'none'; }

  // Category tiles act as quick filters.
  const tiles = document.querySelector('.cat-tiles');
  if (tiles) tiles.addEventListener('click', e => {
    const btn = e.target.closest('[data-tile]');
    if (!btn) return;
    const [kind, val] = btn.dataset.tile.split(/:(.+)/);
    if (kind === 'kosher') {
      filters.kosher = val;
      const sel = $('#f-kosher');
      if (sel) sel.value = val;
    } else if (kind === 'cat') {
      filters.category = val;
      // ensure the option exists in the select
      const sel = $('#f-cat');
      if (sel && ![...sel.options].some(o => o.value === val && o.text === val)) {
        const opt = document.createElement('option');
        opt.textContent = val;
        sel.appendChild(opt);
      }
      if (sel) sel.value = val;
    }
    drawGrid();
    const browse = $('#browse');
    if (browse) browse.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Shopping list: synced checks, manual items, copy button.
  const shopWrap = $('#shop-wrap');
  if (shopWrap) {
    const saveShop = () => persistWeek(thisWeekKey(), null, null);
    shopWrap.addEventListener('change', e => {
      const week = getWeek(thisWeekKey());
      const gen = e.target.closest('[data-shop]');
      if (gen) {
        if (!Array.isArray(week.checkedGenerated)) week.checkedGenerated = [];
        const k = gen.dataset.shop;
        if (gen.checked && !week.checkedGenerated.includes(k)) week.checkedGenerated.push(k);
        if (!gen.checked) week.checkedGenerated = week.checkedGenerated.filter(x => x !== k);
        saveShop();
        return;
      }
      const man = e.target.closest('[data-manual]');
      if (man) {
        const m = (week.manualItems || []).find(x => x.id === man.dataset.manual);
        if (m) { m.checked = man.checked; saveShop(); }
      }
    });
    shopWrap.addEventListener('click', e => {
      const del = e.target.closest('[data-mandel]');
      if (del) {
        const week = getWeek(thisWeekKey());
        week.manualItems = (week.manualItems || []).filter(x => x.id !== del.dataset.mandel);
        saveShop();
        $('#shop-wrap').innerHTML = shoppingListHTML();
        return;
      }
      if (e.target.closest('#shop-add')) {
        const input = $('#shop-new');
        const text = (input.value || '').trim();
        if (!text) return;
        const week = getWeek(thisWeekKey());
        if (!Array.isArray(week.manualItems)) week.manualItems = [];
        week.manualItems.push({ id: 'm' + Date.now().toString(36), text, checked: false });
        saveShop();
        $('#shop-wrap').innerHTML = shoppingListHTML();
        const ni = $('#shop-new');
        if (ni) ni.focus();
      }
    });
    const newInput = $('#shop-new');
    if (newInput) newInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#shop-add').click(); }
    });
    const copyBtn = $('#shop-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const week = getWeek(thisWeekKey());
      const lines = buildShoppingList().map(it => '• ' + it.label)
        .concat((week.manualItems || []).map(m => '• ' + m.text + (m.checked ? ' ✓' : '')));
      const text = 'Shopping list — week of ' + thisWeekKey() + '\n' + lines.join('\n');
      const done = () => toast('Shopping list copied');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => toast('Copy failed'));
      } else { toast('Copy not supported here'); }
    });
  }

  drawGrid();
}

function filteredRecipes() {
  const q = filters.q.trim().toLowerCase();
  const list = recipes.filter(r => {
    if (filters.kosher !== 'all' && String(r.kosher_status || '') !== filters.kosher) return false;
    if (filters.kfp && !r.kosher_for_passover) return false;
    if (filters.category !== 'all' && !(r.categories || []).includes(filters.category)) return false;
    if (filters.maxTime && totalTime(r) > filters.maxTime) return false;
    if (filters.tag !== 'all' && !(r.tags || []).includes(filters.tag)) return false;
    if (filters.leftovers && !r.leftover_friendly) return false;
    if (q) {
      const hay = [
        r.title,
        (r.tags || []).join(' '),
        (r.categories || []).join(' '),
        (r.ingredients || []).flatMap(s =>
          [s.section, (s.items || []).map(i => [i.qty, i.unit, i.item].filter(Boolean).join(' ')).join(' ')]
        ).join(' '),
        r.notes || ''
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list.sort((a, b) => filters.sort === 'desc'
    ? totalTime(b) - totalTime(a)
    : totalTime(a) - totalTime(b));
  return list;
}

function drawGrid() {
  const grid = $('#grid');
  if (!grid) return;
  const list = filteredRecipes();
  $('#result-count').textContent = recipes.length
    ? list.length + ' of ' + recipes.length + ' recipe' + (recipes.length === 1 ? '' : 's')
    : '';

  if (!recipes.length) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">' +
        '<h2>No recipes yet</h2>' +
        '<p>Recipes you add will appear here — search, filters, and sorting are ready when they do.</p>' +
      '</div>';
    return;
  }
  if (!list.length) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">' +
        '<p>No recipes match. Try clearing a filter.</p>' +
      '</div>';
    return;
  }
  grid.innerHTML = list.map(r =>
    '<a class="card" href="#/recipe/' + encodeURIComponent(r.id) + '">' +
      bannerHTML(r) +
      '<div class="card-body"><h2>' + esc(r.title) + '</h2>' +
      '<div class="card-meta">' + esc(fmtTime(totalTime(r))) + ' total · Serves ' + esc(r.servings || '—') + '</div>' +
      badgesHTML(r) + '</div></a>'
  ).join('');
}

/* ---------------- Recipe page ---------------- */
function renderRecipe(app, id) {
  const r = byId[id];
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  document.title = r.title + ' — Reiss Family Recipes';

  const ingHTML = (r.ingredients || []).map(s =>
    (s.section ? '<h3>' + esc(s.section) + '</h3>' : '') +
    '<ul class="ing-list">' + (s.items || []).map(i =>
      '<li><span class="qty">' + esc([i.qty, i.unit].filter(Boolean).join(' ')) + '</span> ' +
      esc(i.item) + '</li>'
    ).join('') + '</ul>'
  ).join('');

  const pairHTML = (r.pairings && r.pairings.length)
    ? '<section class="recipe-section"><h2>Pairings</h2><ul class="pairing-list">' +
      r.pairings.map(p => {
        const t = byId[p.recipe_id];
        return '<li>' + (t
          ? '<a href="#/recipe/' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a>'
          : esc(p.recipe_id)) + ' — ' + esc(p.note || '') + '</li>';
      }).join('') + '</ul></section>'
    : '';

  const leftoverNote = r.leftover_note ||
    (r.leftover_friendly ? 'Good for leftovers.' : 'Best eaten fresh.');

  app.innerHTML =
    '<a class="back-link no-print" href="#/">← All recipes</a>' +
    '<article class="recipe-print">' +
      '<div class="recipe-hero">' + bannerHTML(r) + '</div>' +
      '<h1 class="recipe-title">' + esc(r.title) + '</h1>' +
      badgesHTML(r) +
      (r.needs_kosher_review
        ? '<div class="kosher-alert"><strong>⚠️ Potential kosher issues — review needed.</strong>' +
          (r.kosher_review_notes ? '<br>' + esc(r.kosher_review_notes) : '') + '</div>'
        : '') +
      '<div class="recipe-meta">' +
        '<span>Prep <strong>' + esc(fmtTime(r.prep_minutes)) + '</strong></span>' +
        '<span>Cook <strong>' + esc(fmtTime(r.cook_minutes)) + '</strong></span>' +
        '<span>Total <strong>' + esc(fmtTime(totalTime(r))) + '</strong></span>' +
        '<span>Serves <strong>' + esc(r.servings || '—') + '</strong></span>' +
      '</div>' +
      '<section class="recipe-section"><h2>Ingredients</h2>' + ingHTML + '</section>' +
      '<section class="recipe-section"><h2>Instructions</h2><ol class="steps">' +
        (r.instructions || []).map(s => '<li>' + esc(s) + '</li>').join('') +
      '</ol></section>' +
      pairHTML +
      '<section class="recipe-section"><h2>Leftovers</h2>' +
        '<div class="leftover-box ' + (r.leftover_friendly ? 'yes' : 'no') + '">' +
          (r.leftover_friendly ? '✓ ' : '✗ ') + esc(leftoverNote) +
        '</div></section>' +
      ((r.notes || r.source)
        ? '<p class="source-line">' + esc([r.notes, r.source].filter(Boolean).join(' — ')) + '</p>'
        : '') +
      '<div class="actions no-print">' +
        '<a class="btn secondary" href="#/edit/' + encodeURIComponent(r.id) + '">Edit</a>' +
        (pdfUrl(r) ? '<a class="btn" href="' + esc(pdfUrl(r)) + '" target="_blank" rel="noopener">View PDF</a>' : '') +
        '<button class="btn secondary" id="share-btn" type="button">Share</button>' +
        '<button class="btn' + (pdfUrl(r) ? ' secondary' : '') + '" id="print-btn" type="button">Print / PDF</button>' +
      '</div>' +
    '</article>';

  $('#share-btn').onclick = () => shareRecipe(r);
  $('#print-btn').onclick = () => window.print();
}

/* PDF URL for a recipe: explicit r.pdf wins; otherwise every complete recipe
   (has ingredients) has a Recipe Press PDF at pdfs/<id>.pdf by convention. */
function pdfUrl(r) {
  if (r.pdf) return r.pdf;
  if (r.id && r.ingredients && r.ingredients.length) return 'pdfs/' + r.id + '.pdf';
  return null;
}

async function shareRecipe(r) {
  const url = location.href; // includes #/recipe/<id>; no login gate, so links work for everyone
  // When the recipe has a pre-generated PDF, share the file itself.
  const pu = pdfUrl(r);
  if (pu) {
    try {
      const res = await fetch(pu);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const name = String(pu).split('/').pop().split('?')[0] || 'recipe.pdf';
      const file = new File([blob], name, { type: blob.type || 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: r.title, text: r.title + ' — Reiss Family Recipes' });
        return;
      }
      // No file sharing: download the PDF so it can be shared from the Files app.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
      toast('PDF downloaded — share it from your files.');
      return;
    } catch (e) {
      console.warn('PDF share failed, falling back to link share.', e);
    }
  }
  // No PDF (or PDF path failed): the link share / clipboard behavior.
  const data = { title: r.title, text: r.title + ' — Reiss Family Recipes', url };
  if (navigator.share) {
    try { await navigator.share(data); } catch (e) { /* user dismissed */ }
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard.');
    } catch (e) { prompt('Copy this link:', url); }
  } else {
    prompt('Copy this link:', url);
  }
}

/* ---------------- Edit form ---------------- */
function blankRecipe() {
  return {
    id: '', title: '', kosher_status: 'pareve', kosher_for_passover: false,
    categories: [], prep_minutes: 0, cook_minutes: 0, servings: '',
    ingredients: [{ section: '', items: [{ qty: '', unit: '', item: '' }] }],
    instructions: [''], pairings: [], tags: [], tags_need_review: false,
    leftover_friendly: false, leftover_note: '', banner_image: '', pdf: null,
    notes: '', source: ''
  };
}

function normalizeDraft(d) {
  d.ingredients = d.ingredients || [];
  d.instructions = d.instructions || [];
  d.pairings = d.pairings || [];
  d.tags = d.tags || [];
  d.categories = d.categories || [];
  d.pdf = d.pdf || null;
  d.banner_image = d.banner_image || '';
  return d;
}

/* Shared recipe form: used by Edit and by Add. Values come from r. */
function recipeFormHTML(r, cancelHref) {
  return (
    '<form class="edit-form no-print" id="edit-form" onsubmit="return false">' +
      '<div class="field"><label for="e-title">Title</label>' +
        '<input type="text" id="e-title" value="' + esc(r.title) + '"></div>' +
      '<div class="form-row">' +
        '<div class="field"><label for="e-kosher">Kosher status</label><select id="e-kosher">' +
          ['meat', 'dairy', 'pareve'].map(k =>
            '<option value="' + k + '"' + (r.kosher_status === k ? ' selected' : '') + '>' +
            k[0].toUpperCase() + k.slice(1) + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label for="e-prep">Prep (min)</label>' +
          '<input type="number" id="e-prep" min="0" value="' + esc(r.prep_minutes || 0) + '"></div>' +
        '<div class="field"><label for="e-cook">Cook (min)</label>' +
          '<input type="number" id="e-cook" min="0" value="' + esc(r.cook_minutes || 0) + '"></div>' +
        '<div class="field"><label for="e-serv">Servings</label>' +
          '<input type="text" id="e-serv" value="' + esc(r.servings || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>Kosher flags</label><div class="checks">' +
        '<label><input type="checkbox" id="e-kfp"' + (r.kosher_for_passover ? ' checked' : '') + '> Kosher for Passover</label>' +
        '<label><input type="checkbox" id="e-left"' + (r.leftover_friendly ? ' checked' : '') + '> Good leftovers</label>' +
      '</div></div>' +
      '<div class="field"><label>Categories</label><div class="checks">' +
        KNOWN_CATEGORIES.map(c =>
          '<label><input type="checkbox" class="e-cat" value="' + c + '"' +
          ((r.categories || []).includes(c) ? ' checked' : '') + '> ' + c + '</label>').join('') +
      '</div></div>' +
      '<div class="field"><label for="e-tags">Tags (comma-separated)</label>' +
        '<input type="text" id="e-tags" value="' + esc((r.tags || []).join(', ')) + '"></div>' +
      '<div class="field"><label for="e-banner">Banner image path (blank = automatic title card)</label>' +
        '<input type="text" id="e-banner" value="' + esc(r.banner_image || '') + '" placeholder="assets/images/my-photo.jpg"></div>' +
      '<div class="field"><label for="e-photo">Photo &mdash; pick from your phone or computer</label>' +
        '<input type="file" id="e-photo" accept="image/*">' +
        '<div class="form-hint">Optional. Uploads with the recipe and becomes its banner.</div></div>' +
      '<div class="field"><label for="e-pdf">PDF file path (blank = none)</label>' +
        '<input type="text" id="e-pdf" value="' + esc(r.pdf || '') + '" placeholder="pdfs/my-recipe.pdf"></div>' +
      '<div class="field"><label for="e-leftnote">Leftovers note</label>' +
        '<input type="text" id="e-leftnote" value="' + esc(r.leftover_note || '') + '"></div>' +
      '<div class="field"><label>Ingredients</label><div id="ing-editor"></div>' +
        '<button class="link-btn" id="ing-add-sec" type="button">+ Add section</button></div>' +
      '<div class="field"><label>Instructions</label><div id="steps-editor"></div>' +
        '<button class="link-btn" id="step-add" type="button">+ Add step</button></div>' +
      '<div class="field"><label>Pairings</label><div id="pair-editor"></div>' +
        '<button class="link-btn" id="pair-add" type="button">+ Add pairing</button></div>' +
      '<div class="field"><label for="e-notes">Notes</label>' +
        '<textarea id="e-notes">' + esc(r.notes || '') + '</textarea></div>' +
      '<div class="field"><label for="e-source">Source</label>' +
        '<input type="text" id="e-source" value="' + esc(r.source || '') + '"></div>' +
      '<div class="form-status" id="edit-status"></div>' +
      '<div class="actions" style="margin-bottom:0">' +
        '<button class="btn" id="edit-save" type="button">Save recipe</button>' +
        '<a class="btn secondary" href="' + cancelHref + '">Cancel</a>' +
      '</div>' +
    '</form>'
  );
}

function renderEdit(app, id) {
  const r = byId[id];
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  editDraft = normalizeDraft(JSON.parse(JSON.stringify(r))); // working copy
  document.title = 'Edit: ' + r.title + ' — Reiss Family Recipes';
  app.innerHTML =
    '<a class="back-link no-print" href="#/recipe/' + encodeURIComponent(id) + '">← Back to recipe</a>' +
    '<h1 class="recipe-title">Edit recipe</h1>' +
    recipeFormHTML(r, '#/recipe/' + encodeURIComponent(id));
  wireRecipeForm(() => saveRecipe(id));
}

function renderAdd(app) {
  editDraft = blankRecipe();
  document.title = 'Add recipe — Reiss Family Recipes';
  app.innerHTML =
    '<a class="back-link no-print" href="#/">← All recipes</a>' +
    '<h1 class="recipe-title">Add recipe</h1>' +
    recipeFormHTML(editDraft, '#/');
  wireRecipeForm(saveNewRecipe);
}

function wireRecipeForm(onSave) {
  drawIngEditor();
  drawStepsEditor();
  drawPairEditor();
  $('#ing-add-sec').onclick = () => {
    editDraft.ingredients.push({ section: '', items: [{ qty: '', unit: '', item: '' }] });
    drawIngEditor();
  };
  $('#step-add').onclick = () => { editDraft.instructions.push(''); drawStepsEditor(); };
  $('#pair-add').onclick = () => { editDraft.pairings.push({ recipe_id: '', note: '' }); drawPairEditor(); };
  $('#edit-save').onclick = onSave;
}

/* Read every e-* field into d; drop empties so the JSON stays clean. */
function collectRecipeForm(d) {
  d.title = $('#e-title').value.trim();
  d.kosher_status = $('#e-kosher').value;
  d.prep_minutes = Math.max(0, parseInt($('#e-prep').value, 10) || 0);
  d.cook_minutes = Math.max(0, parseInt($('#e-cook').value, 10) || 0);
  d.servings = $('#e-serv').value.trim();
  d.kosher_for_passover = $('#e-kfp').checked;
  d.leftover_friendly = $('#e-left').checked;
  d.categories = [...document.querySelectorAll('.e-cat')].filter(c => c.checked).map(c => c.value);
  d.tags = $('#e-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  d.banner_image = $('#e-banner').value.trim();
  d.pdf = $('#e-pdf').value.trim() || null;
  d.leftover_note = $('#e-leftnote').value.trim();
  d.notes = $('#e-notes').value.trim();
  d.source = $('#e-source').value.trim();
  // ingredients / instructions / pairings already live in the draft via input sync
  d.ingredients = d.ingredients
    .map(s => ({ section: (s.section || '').trim(), items: s.items.filter(i => (i.item || '').trim()) }))
    .filter(s => s.items.length);
  d.instructions = d.instructions.map(s => (s || '').trim()).filter(Boolean);
  d.pairings = d.pairings.filter(p => p.recipe_id);
}

function slugify(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe';
}

function readAsDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Could not read that file — it may be corrupt or an unsupported format.'));
    fr.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('That photo could not be opened as an image — try a JPG or PNG.'));
    img.src = src;
  });
}

/* If a photo was picked, shrink it and upload it, then point banner_image at it. */
async function maybeUploadPhoto(d) {
  const inp = $('#e-photo');
  if (!inp || !inp.files || !inp.files[0]) return;
  let img;
  try {
    img = await loadImage(await readAsDataURL(inp.files[0]));
  } catch (e) {
    throw new Error('Could not read that photo — try a JPG or PNG.');
  }
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not read that photo — try a JPG or PNG.');
  const b64 = String(await readAsDataURL(blob)).split(',')[1];
  const path = 'assets/images/' + d.id + '.jpg';
  await ghPutB64(path, b64, 'Add photo for ' + d.title);
  d.banner_image = path;
}

function drawIngEditor() {
  const host = $('#ing-editor');
  if (!host) return;
  host.innerHTML = editDraft.ingredients.map((s, si) =>
    '<div class="dynamic-block">' +
      '<div class="mini-row">' +
        '<input type="text" data-secname="' + si + '" value="' + esc(s.section || '') + '" ' +
        'placeholder="Section name (e.g. Dough)" aria-label="Section name">' +
        '<button class="link-btn danger" data-secdel="' + si + '" type="button">Remove</button>' +
      '</div>' +
      (s.items || []).map((it, ii) =>
        '<div class="mini-row">' +
          '<input class="qty" type="text" data-item="' + si + '|' + ii + '|qty" value="' + esc(it.qty || '') + '" placeholder="Qty" aria-label="Quantity">' +
          '<input class="unit" type="text" data-item="' + si + '|' + ii + '|unit" value="' + esc(it.unit || '') + '" placeholder="Unit" aria-label="Unit">' +
          '<input type="text" data-item="' + si + '|' + ii + '|item" value="' + esc(it.item || '') + '" placeholder="Ingredient" aria-label="Ingredient">' +
          '<button class="link-btn danger" data-itemdel="' + si + '|' + ii + '" type="button">✕</button>' +
        '</div>'
      ).join('') +
      '<button class="link-btn" data-itemadd="' + si + '" type="button">+ Add ingredient</button>' +
    '</div>'
  ).join('');
  // Sync typing straight into the draft so re-renders never lose input.
  host.querySelectorAll('[data-secname]').forEach(el =>
    el.addEventListener('input', e => { editDraft.ingredients[+e.target.dataset.secname].section = e.target.value; }));
  host.querySelectorAll('[data-item]').forEach(el =>
    el.addEventListener('input', e => {
      const [si, ii, f] = e.target.dataset.item.split('|');
      editDraft.ingredients[+si].items[+ii][f] = e.target.value;
    }));
  host.querySelectorAll('[data-secdel]').forEach(el =>
    el.addEventListener('click', e => { editDraft.ingredients.splice(+e.target.dataset.secdel, 1); drawIngEditor(); }));
  host.querySelectorAll('[data-itemdel]').forEach(el =>
    el.addEventListener('click', e => {
      const [si, ii] = e.target.dataset.itemdel.split('|').map(Number);
      editDraft.ingredients[si].items.splice(ii, 1);
      drawIngEditor();
    }));
  host.querySelectorAll('[data-itemadd]').forEach(el =>
    el.addEventListener('click', e => {
      editDraft.ingredients[+e.target.dataset.itemadd].items.push({ qty: '', unit: '', item: '' });
      drawIngEditor();
    }));
}

function drawStepsEditor() {
  const host = $('#steps-editor');
  if (!host) return;
  const n = editDraft.instructions.length;
  host.innerHTML = editDraft.instructions.map((s, i) =>
    '<div class="dynamic-block"><div class="mini-row">' +
      '<span class="step-num">' + (i + 1) + '</span>' +
      '<input type="text" data-step="' + i + '" value="' + esc(s) + '" placeholder="Step ' + (i + 1) + '" aria-label="Step ' + (i + 1) + '">' +
      '<button class="link-btn" data-stepup="' + i + '" type="button" aria-label="Move step up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="link-btn" data-stepdown="' + i + '" type="button" aria-label="Move step down"' + (i === n - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="link-btn danger" data-stepdel="' + i + '" type="button" aria-label="Delete step">✕</button>' +
    '</div></div>'
  ).join('');
  host.querySelectorAll('[data-step]').forEach(el =>
    el.addEventListener('input', e => { editDraft.instructions[+e.target.dataset.step] = e.target.value; }));
  host.querySelectorAll('[data-stepdel]').forEach(el =>
    el.addEventListener('click', e => { editDraft.instructions.splice(+e.target.dataset.stepdel, 1); drawStepsEditor(); }));
  host.querySelectorAll('[data-stepup]').forEach(el =>
    el.addEventListener('click', e => {
      const i = +e.target.dataset.stepup;
      if (i > 0) {
        const t = editDraft.instructions[i - 1];
        editDraft.instructions[i - 1] = editDraft.instructions[i];
        editDraft.instructions[i] = t;
        drawStepsEditor();
      }
    }));
  host.querySelectorAll('[data-stepdown]').forEach(el =>
    el.addEventListener('click', e => {
      const i = +e.target.dataset.stepdown;
      if (i < editDraft.instructions.length - 1) {
        const t = editDraft.instructions[i + 1];
        editDraft.instructions[i + 1] = editDraft.instructions[i];
        editDraft.instructions[i] = t;
        drawStepsEditor();
      }
    }));
}

function drawPairEditor() {
  const host = $('#pair-editor');
  if (!host) return;
  const opts = sel =>
    '<option value="">— pick a recipe —</option>' +
    recipes.map(r => '<option value="' + esc(r.id) + '"' + (sel === r.id ? ' selected' : '') + '>' +
      esc(r.title) + '</option>').join('');
  host.innerHTML = editDraft.pairings.map((p, i) =>
    '<div class="dynamic-block"><div class="mini-row">' +
      '<select data-pair="' + i + '|recipe_id" aria-label="Paired recipe">' + opts(p.recipe_id) + '</select>' +
      '<button class="link-btn danger" data-pairdel="' + i + '" type="button">✕</button>' +
    '</div><div class="mini-row">' +
      '<input type="text" data-pair="' + i + '|note" value="' + esc(p.note || '') + '" placeholder="Note (e.g. perfect with…)" aria-label="Pairing note">' +
    '</div></div>'
  ).join('');
  host.querySelectorAll('[data-pair]').forEach(el =>
    el.addEventListener('input', e => {
      const [i, f] = e.target.dataset.pair.split('|');
      editDraft.pairings[+i][f] = e.target.value;
    }));
  host.querySelectorAll('[data-pairdel]').forEach(el =>
    el.addEventListener('click', e => { editDraft.pairings.splice(+e.target.dataset.pairdel, 1); drawPairEditor(); }));
}

async function saveRecipe(id) {
  const st = $('#edit-status');
  const d = editDraft;
  collectRecipeForm(d);
  if (!d.title) {
    st.className = 'form-status error';
    st.textContent = 'Give the recipe a title first.';
    return;
  }
  st.className = 'form-status';
  st.textContent = 'Saving…';
  try {
    await maybeUploadPhoto(d);
    await ghPut('data/recipes/' + id + '.json', JSON.stringify(d, null, 2), 'Update recipe: ' + d.title);
    const i = recipes.findIndex(x => x.id === id);
    if (i >= 0) recipes[i] = d;
    byId[id] = d;
    st.className = 'form-status ok';
    st.textContent = 'Saved — the site rebuilds in about a minute.';
    toast('Saved — the site rebuilds in about a minute.');
  } catch (e) {
    st.className = 'form-status error';
    st.textContent = e.message === 'key'
      ? 'Couldn\u2019t save — editing isn\u2019t set up yet.'
      : 'Save failed: ' + e.message;
  }
}

async function saveNewRecipe() {
  const st = $('#edit-status');
  const d = editDraft;
  collectRecipeForm(d);
  if (!d.title) {
    st.className = 'form-status error';
    st.textContent = 'Give the recipe a title first.';
    return;
  }
  let id = slugify(d.title), n = 2;
  while (byId[id]) id = slugify(d.title) + '-' + (n++);
  d.id = id;
  d.tags_need_review = false;
  st.className = 'form-status';
  st.textContent = 'Saving…';
  try {
    await maybeUploadPhoto(d);
    await ghPut('data/recipes/' + id + '.json', JSON.stringify(d, null, 2), 'Add recipe: ' + d.title);
    const idx = JSON.parse((await ghGet('data/recipes/index.json')).text);
    idx.push(id);
    await ghPut('data/recipes/index.json', JSON.stringify(idx), 'Add to index: ' + d.title);
    recipes.push(d);
    byId[id] = d;
    toast('Saved — the site rebuilds in about a minute.');
    location.hash = '#/recipe/' + encodeURIComponent(id);
  } catch (e) {
    st.className = 'form-status error';
    st.textContent = e.message === 'key'
      ? 'Couldn\u2019t save — editing isn\u2019t set up yet.'
      : 'Save failed: ' + e.message;
  }
}



/* ---------------- Meal planner ---------------- */
const blankSlot = () => ({ recipe: null, custom: null, skipped: false, note: '' });

function sundayOf(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d;
}
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                 '-' + String(d.getDate()).padStart(2, '0');
const prettyDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayName = d => d.toLocaleDateString('en-US', { weekday: 'long' });

function getWeek(key) {
  if (!mealPlan.weeks[key] || !Array.isArray(mealPlan.weeks[key].days)) {
    mealPlan.weeks[key] = { days: Array.from({ length: 7 }, () => ({ lunch: blankSlot(), dinner: blankSlot() })) };
  }
  // Normalize any slot missing fields (older saves).
  mealPlan.weeks[key].days.forEach(day => {
    ['lunch', 'dinner'].forEach(m => {
      day[m] = Object.assign(blankSlot(), day[m] || {});
    });
  });
  return mealPlan.weeks[key];
}

function slotHTML(key, di, meal, slot, canEdit, shabbat) {
  const label = (meal === 'lunch' ? 'Lunch' : 'Dinner') +
    (shabbat ? ' <span class="shabbat">· Shabbat</span>' : '');
  let body;
  if (editingSlot && editingSlot.key === key && editingSlot.di === di && editingSlot.meal === meal) {
    body = slotEditorHTML(slot);
  } else if (slot.skipped) {
    body = '<span class="slot-skipped">Skipped</span>' +
      (slot.note ? ' <span class="slot-note">— ' + esc(slot.note) + '</span>' : '');
  } else if (slot.recipe && byId[slot.recipe]) {
    const r = byId[slot.recipe];
    body = '<a href="#/recipe/' + encodeURIComponent(r.id) + '">' + esc(r.title) + '</a>' +
      (slot.note ? ' <span class="slot-note">— ' + esc(slot.note) + '</span>' : '');
  } else if (slot.custom) {
    body = '<span class="slot-custom">' + esc(slot.custom) + '</span>' +
      (slot.note ? ' <span class="slot-note">— ' + esc(slot.note) + '</span>' : '');
  } else {
    body = '<span class="slot-skipped">—</span>';
  }
  const has = slot.recipe || slot.custom || slot.skipped || slot.note;
  const btns = canEdit
    ? ' <button class="link-btn" data-slot="' + key + '|' + di + '|' + meal + '" type="button">' +
      (has ? 'Edit' : 'Add') + '</button>' +
      (has ? ' <button class="link-btn danger" data-clear="' + key + '|' + di + '|' + meal +
        '" type="button">Clear</button>' : '')
    : '';
  return '<div class="slot"><div class="slot-label">' + label + '</div>' +
         '<div class="slot-body">' + body + btns + '</div></div>';
}

function slotEditorHTML(slot) {
  const currentLabel = (slot.recipe && byId[slot.recipe]) ? byId[slot.recipe].title
    : (slot.custom || '');
  const currentRid = (slot.recipe && byId[slot.recipe]) ? slot.recipe : '';
  return '<div class="slot-editor">' +
    '<div class="combo-wrap">' +
      '<input type="text" id="se-meal" placeholder="Type a recipe or your own dish…" autocomplete="off" ' +
      'value="' + esc(currentLabel) + '" data-rid="' + esc(currentRid) + '" aria-label="Meal">' +
      '<div class="combo-list" id="se-suggest" hidden></div>' +
    '</div>' +
    '<div class="slot-note">Pick a recipe from the list, or just type your own — it saves as-is.</div>' +
    '<label><input type="checkbox" id="se-skipped"' + (slot.skipped ? ' checked' : '') + '> Skipped</label> ' +
    '<input type="text" id="se-note" placeholder="Note (optional)" value="' + esc(slot.note || '') + '">' +
    '<div><button class="btn" id="se-save" type="button">Save</button> ' +
    '<button class="btn secondary" id="se-cancel" type="button">Cancel</button></div>' +
    '<div class="form-status" id="se-status"></div></div>';
}

/* Searchable combobox for the meal slot: filters recipes as you type,
   or keeps free text as a custom entry. */
function wireCombo(input) {
  const list = $('#se-suggest');
  if (!list) return;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const matches = recipes
      .filter(r => !q || r.title.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { list.hidden = true; list.innerHTML = ''; return; }
    list.innerHTML = matches.map(r =>
      '<button type="button" class="combo-item" data-rid="' + esc(r.id) + '">' +
        esc(r.title) + '</button>'
    ).join('');
    list.hidden = false;
  };
  input.addEventListener('input', () => { input.dataset.rid = ''; draw(); });
  input.addEventListener('focus', draw);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  list.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-rid]');
    if (!b) return;
    e.preventDefault();
    input.value = b.textContent;
    input.dataset.rid = b.dataset.rid;
    list.hidden = true;
    input.focus();
  });
}

function renderPlanner(app) {
  document.title = 'Meal Planner — Reiss Family Recipes';
  const mon = sundayOf(plannerOffset);
  const key = ymd(mon);
  const week = getWeek(key);
  const canEdit = editingEnabled();
  const label = plannerOffset === 0 ? 'This week' : 'Week of ' + prettyDate(mon);

  let days = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(d.getDate() + i);
    const ds = week.days[i];
    days += '<div class="day-card"><h3>' + dayName(d) +
      ' <span style="color:var(--ink-soft);font-weight:400;font-size:.9rem">' + prettyDate(d) + '</span></h3>' +
      slotHTML(key, i, 'lunch', ds.lunch, canEdit, i === 6) +   // Saturday lunch = Shabbat
      slotHTML(key, i, 'dinner', ds.dinner, canEdit, i === 5) + // Friday dinner = Shabbat
      '</div>';
  }

  app.innerHTML =
    '<div class="planner-nav no-print">' +
      '<button class="btn secondary" id="wk-prev" type="button">‹ Prev</button>' +
      '<h2>' + esc(label) + '</h2>' +
      '<button class="btn secondary" id="wk-next" type="button">Next ›</button>' +
    '</div>' +
    '<div class="shop-day-row no-print">' +
      '<label for="shop-day">🛒 Shopping day</label>' +
      '<input type="date" id="shop-day" value="' + esc(week.shoppingDay || '') + '">' +
      '<button class="link-btn" id="shop-day-clear" type="button"' +
        (week.shoppingDay ? '' : ' hidden') + '>Clear</button>' +
      '<span class="muted" style="font-size:.85rem">List covers this day onward</span>' +
    '</div>' +
    (plannerOffset !== 0
      ? '<div class="no-print" style="text-align:center;margin-bottom:1rem">' +
        '<button class="link-btn" id="wk-today" type="button">Back to this week</button></div>'
      : '') +
    '<div id="days">' + days + '</div>';

  $('#wk-prev').onclick = () => { plannerOffset--; renderPlanner(app); };
  $('#wk-next').onclick = () => { plannerOffset++; renderPlanner(app); };
  const today = $('#wk-today');
  if (today) today.onclick = () => { plannerOffset = 0; renderPlanner(app); };

  const shopDay = $('#shop-day');
  if (shopDay) shopDay.addEventListener('change', () => {
    getWeek(key).shoppingDay = shopDay.value || null;
    persistWeek(key, null, () => renderPlanner(app));
  });
  const shopClear = $('#shop-day-clear');
  if (shopClear) shopClear.addEventListener('click', () => {
    getWeek(key).shoppingDay = null;
    persistWeek(key, null, () => renderPlanner(app));
  });

  $('#days').addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'se-save') return saveSlot(key);
    if (t.id === 'se-cancel') { editingSlot = null; return renderPlanner(app); }
    if (t.dataset.slot) {
      const [k, di, meal] = t.dataset.slot.split('|');
      editingSlot = { key: k, di: +di, meal };
      return renderPlanner(app);
    }
    if (t.dataset.clear) {
      const [k, di, meal] = t.dataset.clear.split('|');
      getWeek(k).days[+di][meal] = blankSlot();
      return persistWeek(k, null, () => renderPlanner(app));
    }
  });

  const mealInput = $('#se-meal');
  if (mealInput) wireCombo(mealInput);
}

function saveSlot(key) {
  const st = $('#se-status');
  const slot = getWeek(key).days[editingSlot.di][editingSlot.meal];
  const mealInput = $('#se-meal');
  const rid = mealInput ? mealInput.dataset.rid : '';
  const text = mealInput ? mealInput.value.trim() : '';
  if (rid && byId[rid]) {
    slot.recipe = rid;
    slot.custom = null;
  } else if (text) {
    slot.recipe = null;
    slot.custom = text;
  } else {
    slot.recipe = null;
    slot.custom = null;
  }
  slot.skipped = $('#se-skipped').checked;
  slot.note = $('#se-note').value.trim();
  persistWeek(key, st, () => { editingSlot = null; renderPlanner($('#app')); });
}

async function persistWeek(key, statusEl, done) {
  try {
    await ghPut('data/meal-plan.json', JSON.stringify(mealPlan, null, 2), 'Update meal plan: ' + key);
    toast('Saved — the site rebuilds in about a minute.');
    if (done) done();
  } catch (e) {
    const msg = e.message === 'key'
      ? 'Couldn\u2019t save — editing isn\u2019t set up yet.'
      : 'Save failed: ' + e.message;
    if (statusEl) { statusEl.className = 'form-status error'; statusEl.textContent = msg; }
    else toast(msg);
  }
}

/* ---------------- Submit a recipe (inbox) ----------------
   Paste a link and/or attach a photo. It lands in data/inbox/ and the
   intake checker (every 30 min) turns it into a recipe + standardized PDF.
   Nava uses the same box — no setup, no login. */
function renderSubmit(app) {
  document.title = 'Submit a recipe — Reiss Family Recipes';
  app.innerHTML =
    '<a class="back-link no-print" href="#/">← All recipes</a>' +
    '<h1 class="recipe-title">Submit a recipe</h1>' +
    '<p class="no-print" style="max-width:34rem">Paste a link, attach a photo of a recipe, or both. ' +
    'It goes into the inbox, and within about 30 minutes it shows up in the collection as a finished recipe with its PDF. ' +
    'If something can\u2019t be figured out, it\u2019ll be marked below so you know.</p>' +
    '<form class="edit-form no-print" id="submit-form" onsubmit="return false">' +
      '<div class="field"><label for="s-url">Link (optional)</label>' +
        '<input type="url" id="s-url" placeholder="https://… recipe page, video, post"></div>' +
      '<div class="field"><label for="s-photo">Photo (optional)</label>' +
        '<input type="file" id="s-photo" accept="image/*">' +
        '<div class="form-hint">A photo of a written recipe, a dish, a cookbook page…</div></div>' +
      '<div class="field"><label for="s-note">Note (optional)</label>' +
        '<input type="text" id="s-note" placeholder="Anything helpful — whose recipe, occasion…"></div>' +
      '<div class="form-status" id="submit-status"></div>' +
      '<div class="actions" style="margin-bottom:0">' +
        '<button class="btn" id="submit-send" type="button">Submit</button>' +
        '<a class="btn secondary" href="#/">Cancel</a>' +
      '</div>' +
    '</form>' +
    '<h2 class="recipe-title" style="font-size:1.2rem;margin-top:2rem">Recent submissions</h2>' +
    '<div id="inbox-list"><p>Loading…</p></div>';
  $('#submit-send').onclick = sendSubmission;
  loadInboxList();
}

async function loadInboxList() {
  const host = $('#inbox-list');
  if (!host) return;
  let idx = [];
  try {
    const r = await fetch('data/inbox/index.json');
    if (r.ok) idx = await r.json();
  } catch (e) { /* no inbox yet */ }
  if (!idx.length) {
    host.innerHTML = '<p>Nothing submitted yet.</p>';
    return;
  }
  const badge = s => s === 'done' ? '✓ added'
    : s === 'failed' ? '⚠ needs attention'
    : s === 'working' ? '… working on it' : '… in the inbox';
  host.innerHTML = '<ul class="pairing-list">' + idx.slice(-10).reverse().map(s =>
    '<li><strong>' + badge(s.status) + '</strong> — ' +
    esc(s.url ? s.url : 'photo') +
    (s.recipe_id ? ' → <a href="#/recipe/' + encodeURIComponent(s.recipe_id) + '">view recipe</a>' : '') +
    (s.fail_reason ? ' <span style="color:var(--danger)">' + esc(s.fail_reason) + '</span>' : '') +
    '</li>'
  ).join('') + '</ul>';
}

async function sendSubmission() {
  const st = $('#submit-status');
  const url = $('#s-url').value.trim();
  const note = $('#s-note').value.trim();
  const file = ($('#s-photo').files || [])[0] || null;
  if (!url && !file) {
    st.className = 'form-status error';
    st.textContent = 'Add a link, a photo, or both.';
    return;
  }
  st.className = 'form-status';
  st.textContent = 'Submitting…';
  const id = 'inbox-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
  try {
    let imagePath = null;
    if (file) {
      // Try to shrink the photo first; if the browser can't decode it
      // (e.g. HEIC from Google Photos), upload the original bytes as-is.
      let b64 = null, ext = 'jpg';
      try {
        const img = await loadImage(await readAsDataURL(file));
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
        if (!blob) throw new Error('decode failed');
        b64 = String(await readAsDataURL(blob)).split(',')[1];
      } catch (e) {
        const raw = String(await readAsDataURL(file)).split(',');
        if (!raw[1]) throw new Error('Could not read that photo — try downloading it as a JPG first.');
        b64 = raw[1];
        const mt = (file.type || '').toLowerCase();
        ext = mt.includes('png') ? 'png' : mt.includes('heic') ? 'heic' : mt.includes('webp') ? 'webp' : 'jpg';
      }
      imagePath = 'data/inbox/' + id + '.' + ext;
      await ghPutB64(imagePath, b64, 'Inbox photo ' + id);
    }
    const entry = {
      id, url: url || null, image: imagePath, note: note || null,
      status: 'pending', created_at: new Date().toISOString(),
      recipe_id: null, fail_reason: null
    };
    await ghPut('data/inbox/' + id + '.json', JSON.stringify(entry, null, 2), 'Inbox submission ' + id);
    let idx = [];
    try { idx = JSON.parse((await ghGet('data/inbox/index.json')).text); } catch (e) { idx = []; }
    idx.push(entry);
    await ghPut('data/inbox/index.json', JSON.stringify(idx, null, 2), 'Inbox index ' + id);
    st.className = 'form-status ok';
    st.textContent = 'Submitted — it should appear in the collection within about 30 minutes.';
    $('#s-url').value = ''; $('#s-note').value = ''; $('#s-photo').value = '';
    toast('Submitted!');
    loadInboxList();
  } catch (e) {
    st.className = 'form-status error';
    st.textContent = e.message === 'key'
      ? 'Couldn\u2019t submit — editing isn\u2019t set up yet.'
      : 'Submit failed: ' + e.message;
  }
}

/* ---------------- Go ---------------- */
document.addEventListener('DOMContentLoaded', boot);
