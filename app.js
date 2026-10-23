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
let recipes = [];          // recipe metadata, in manifest order (list/search/filter)
let byId = {};             // id -> FULL recipe (on-demand cache via ensureRecipe)
let metaById = {};         // id -> lightweight metadata (loaded at boot)
// Fetch a full recipe JSON on demand; cached in byId after first load.
async function ensureRecipe(id) {
  if (byId[id]) return byId[id];
  try {
    const r = await (await fetch('data/recipes/' + id + '.json?v=' + Date.now())).json();
    if (r && r.id) { byId[id] = r; return r; }
  } catch (e) { console.warn('Could not load recipe', id, e); }
  return null;
}
// Metadata lookup with full-recipe fallback for fields only in the JSON.
function recipeMeta(id) {
  return metaById[id] || byId[id] || null;
}
let mealPlan = { weeks: {} };
let plannerOffset = 0;     // weeks away from the current week
let filters = { q: '', kosher: 'all', kfp: false, category: 'all',
                maxTime: 0, tag: 'all', leftovers: false, sort: 'asc' };
let editDraft = null;      // working copy while the edit form is open
let currentEditSha = null;  // GitHub blob SHA when the edit page loaded (for 409 conflict detection)
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

/* Parse a servings statement ("6", "6-8", 6) into { low, high } | null.
   Hoisted to top level in Commit 2A (Smart Meal Planning v1): the planner's
   yield math (leftoverServings) reuses the exact parser the recipe detail
   page's scale bar uses, so both always agree on what "Serves 6-8" means. */
function parseServings(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number' && isFinite(s)) return { low: s, high: s };
  const m = String(s).match(/^\s*(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const low = parseFloat(m[1]), high = parseFloat(m[2]);
    if (isFinite(low) && isFinite(high)) return { low: Math.min(low, high), high: Math.max(low, high) };
    return null;
  }
  const n = parseFloat(s);
  return isFinite(n) ? { low: n, high: n } : null;
}

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
  if (typeof closeInboxLightbox === 'function') closeInboxLightbox();
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

/* Save a recipe through the worker-side history endpoint.
   The worker fetches the live file, diffs, appends history, and commits.
   Throws with code 409 if base_sha doesn't match (someone else saved first). */
async function bridgeSaveRecipe(path, recipe, actor, reasoning, baseSha, action) {
  const res = await fetch(BRIDGE + '/save-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, recipe, actor, reasoning, base_sha: baseSha, action })
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) {
    const err = new Error(data.detail || 'Conflict');
    err.code = 409;
    throw err;
  }
  if (!res.ok || !data.ok) {
    throw new Error('save failed (' + res.status + ') ' + (data.error || ''));
  }
  return data;
}

/* One-time editor name prompt, stored per device for history attribution. */
function getEditorName() {
  let name = null;
  try { name = localStorage.getItem('editor_name'); } catch (e) {}
  // 'Anonymous' is a fallback label, never a stored identity: a saved
  // 'Anonymous' (from a dismissed prompt) counts as unset so the prompt
  // is offered again on the next save.
  if (!name || name === 'Anonymous') {
    const entered = (window.prompt('Your name (for change history):') || '').trim();
    if (entered && entered !== 'Anonymous') {
      try { localStorage.setItem('editor_name', entered); } catch (e) {}
      return entered;
    }
    return 'Anonymous';
  }
  return name;
}

async function bridgeDelete(path, message) {
  const res = await fetch(BRIDGE + '/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, message })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 160); } catch (e) {}
    throw new Error('delete failed (' + res.status + ') ' + detail);
  }
  return res.json();
}

async function ghGet(path) {
  const res = await fetch(
    GH + '/repos/' + REPO.owner + '/' + REPO.repo + '/contents/' + path +
    '?ref=' + encodeURIComponent(REPO.branch) + '&t=' + Date.now(),
    { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' }
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
  // Lazy loading: fetch only metadata + meal plan upfront (2 requests).
  // Full recipe JSONs load on demand via ensureRecipe() and are cached in byId.
  try {
    const cb = '?v=' + Date.now();
    const metaRes = await fetch('data/recipes/meta.json' + cb);
    // Missing metadata (e.g. a fresh install before seeding) means an empty
    // collection, not a fatal error.
    const meta = metaRes.ok ? await metaRes.json() : [];
    metaById = {};
    recipes = [];
    (Array.isArray(meta) ? meta : []).forEach(m => {
      metaById[m.id] = m;
      recipes.push(m);  // list view works off metadata
    });
  } catch (e) { loadError(); return; }

  byId = {};  // full recipe cache, populated on demand

  try {
    const mp = await fetchLiveMealPlan();
    mealPlan = (mp && typeof mp.weeks === 'object') ? mp : { weeks: {} };
  } catch (e) { mealPlan = { weeks: {} }; }
  // Merge any local shopping-list state (offline taps) over the server copy
  loadShopLocal();

  window.addEventListener('hashchange', route);
  route();

  // Keep the meal plan fresh when someone else (e.g. Nava) saves:
  // re-fetch when the tab regains focus, unless mid-edit.
  const maybeRefreshPlan = async () => {
    if (_savePlanInFlight > 0) return;
    if (editingSlot || document.hidden) return;
    const mp = await fetchLiveMealPlan();
    if (mp && typeof mp.weeks === 'object') {
      // Merge, don't overwrite: fresh days win, local shopping state unions in.
      mealPlan = mergeMealPlan(mp, mealPlan);
      const h = location.hash || '#/';
      if (h === '#/planner' || h === '#/' || h === '') route();
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRefreshPlan(); });
  window.addEventListener('focus', maybeRefreshPlan);
}

/* Re-fetch the meal plan (e.g. after someone else saves). Skips while editing. */
async function refreshMealPlan() {
  if (_savePlanInFlight > 0) return;
  if (editingSlot) return;
  const mp = await fetchLiveMealPlan();
  if (!mp) return;
  // Merge, don't overwrite: server wins for days (planner), union for shopping state.
  mealPlan = mergeMealPlan(mp, mealPlan);
}

/* ---------------- Router ---------------- */
function route() {
  closeModal();
  editingSlot = null;
  const h = location.hash || '#/';
  const app = $('#app');
  $('#nav-recipes').classList.toggle('active', h.startsWith('#/recipes') || h.startsWith('#/recipe/'));
  $('#nav-planner').classList.toggle('active', h.startsWith('#/planner'));
  $('#nav-shopping').classList.toggle('active', h.startsWith('#/shopping'));
  window.scrollTo(0, 0);
  document.title = 'Reiss Family Recipes';
  if (h.startsWith('#/recipe/')) return renderRecipe(app, decodeURIComponent(h.slice(9)));
  if (h.startsWith('#/edit/')) return renderEdit(app, decodeURIComponent(h.slice(7)));
  if (h.startsWith('#/delete/')) return renderDelete(app, decodeURIComponent(h.slice(9)));
  if (h === '#/add') return renderAdd(app);
  if (h === '#/submit') return renderSubmit(app);
  if (h === '#/recipes') return renderRecipes(app);
  if (h === '#/planner/tune') {
    refreshMealPlan().then(() => { if ((location.hash || '#/') === '#/planner/tune') renderQuickSort(app); });
    return renderQuickSort(app);
  }
  if (h === '#/planner') {
    // Grab the latest plan in case someone else just saved.
    refreshMealPlan().then(() => { if ((location.hash || '#/') === '#/planner') renderPlanner(app); });
    return renderPlanner(app);
  }
  if (h === '#/shopping') {
    refreshMealPlan().then(() => { if ((location.hash || '#/') === '#/shopping') renderShopping(app); });
    return renderShopping(app);
  }
  return renderLanding(app);
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
const IRREGULAR_PLURALS = {
  tomato: 'tomatoes', potato: 'potatoes', hero: 'heroes',
  half: 'halves', loaf: 'loaves', leaf: 'leaves', knife: 'knives',
  clove: 'cloves', slice: 'slices', chili: 'chilies',
  person: 'people', child: 'children', foot: 'feet', tooth: 'teeth'
};
const IRREGULAR_SINGULARS = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([sing, plur]) => [plur, sing])
);

function pluralize(word, qty) {
  if (!word) return '';
  // Split head noun phrase from any trailing parenthetical or comma prep note:
  // e.g. "beefsteak tomatoes (8 oz each)" -> head: "beefsteak tomatoes", tail: " (8 oz each)"
  // e.g. "red onion, finely chopped"      -> head: "red onion",          tail: ", finely chopped"
  const m = word.match(/^([^,(]+?)(\s*(?:,.*|\(.*))?$/);
  const head = (m && m[1] ? m[1] : word).trim();
  const tail = (m && m[2]) || '';
  if (!head) return word;

  const low = head.toLowerCase();
  if (UNCOUNTABLES.has(low)) return word;
  const words = head.split(/\s+/);
  const lastWord = words[words.length - 1];
  const lastLow = lastWord.toLowerCase();

  // Mass nouns stay invariant even with modifiers ("fresh garlic", "black pepper"),
  // except "bell pepper" which is countable.
  const isBellPepper = low === 'bell pepper' || low.endsWith(' bell pepper') ||
                       low === 'bell peppers' || low.endsWith(' bell peppers');
  if (!isBellPepper && UNCOUNTABLES.has(lastLow)) return word;

  // Singularize when 0 < qty <= 1 (e.g. "2 eggs" at 0.5x -> "1 egg", "2 beefsteak tomatoes (8 oz each)" -> "1 beefsteak tomato (8 oz each)")
  if (qty > 0 && qty <= 1) {
    let singLast = lastWord;
    if (IRREGULAR_SINGULARS[lastLow]) {
      singLast = IRREGULAR_SINGULARS[lastLow];
    } else if (/ies$/i.test(lastLow) && lastLow.length > 3) {
      singLast = lastWord.slice(0, -3) + 'y';
    } else if (/(?:ses|xes|zes|ches|shes)$/i.test(lastLow)) {
      singLast = lastWord.slice(0, -2);
    } else if (/s$/i.test(lastLow) && !/(?:ss|us|is)$/i.test(lastLow) && lastLow.length > 1) {
      singLast = lastWord.slice(0, -1);
    }
    words[words.length - 1] = singLast;
    return words.join(' ') + tail;
  }

  if (!(qty > 1)) return word;

  // Pluralize when qty > 1
  if (IRREGULAR_SINGULARS[lastLow]) return word; // already an irregular plural
  if (/s$/i.test(lastLow) && !/(?:ss|us|is)$/i.test(lastLow)) return word; // already plural

  let plurLast = lastWord;
  if (IRREGULAR_PLURALS[lastLow]) {
    plurLast = IRREGULAR_PLURALS[lastLow];
  } else if (/[^aeiou]y$/i.test(lastLow)) {
    plurLast = lastWord.slice(0, -1) + 'ies';
  } else if (/(?:s|x|z|ch|sh)$/i.test(lastLow)) {
    plurLast = lastWord + 'es';
  } else {
    plurLast = lastWord + 's';
  }
  words[words.length - 1] = plurLast;
  return words.join(' ') + tail;
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
/* Normalize a meal slot to the dishes array format.
   Old: { recipe: 'id', custom: 'text', skipped: bool, note: '' }
   New: { dishes: [{ recipe, custom, leftovers, cookDate }], skipped, note } */
function normalizeSlot(slot) {
  if (!slot) return { dishes: [], skipped: false, note: '' };
  if (Array.isArray(slot.dishes)) return slot;
  const dishes = [];
  if (slot.recipe) dishes.push({ recipe: slot.recipe, leftovers: false, cookDate: null });
  else if (slot.custom) dishes.push({ custom: slot.custom, leftovers: false, cookDate: null });
  return { dishes, skipped: !!slot.skipped, note: slot.note || '' };
}
/* Pantry staples: items the Reiss kitchen always has. The shopping list's
   "Hide pantry staples" toggle moves generated To Buy lines whose clean base
   name exactly matches this set into a collapsed section. Exact match only,
   on the groupKey-normalized base name: "flour" hides, "flour tortillas"
   doesn't; "water" hides, "coconut water" doesn't. Set curated by Yidi
   (2026-10-21): hide only what he'd bet is already in the kitchen — niche
   items (nutmeg, dried herbs, vanilla, honey, specialty oils/flours) stay
   visible. */
const PANTRY_STAPLES = new Set([
  // water
  'water', 'cold water', 'warm water', 'hot water', 'ice water', 'boiling water',
  'lukewarm water', 'room temperature water', 'tap water',
  // salt & pepper
  'salt', 'kosher salt', 'coarse kosher salt', 'sea salt', 'fine sea salt', 'table salt',
  'black pepper', 'ground black pepper', 'freshly ground black pepper',
  'freshly cracked black pepper', 'white pepper', 'ground white pepper',
  'salt and pepper', 'salt & pepper',
  // everyday oils
  'oil', 'olive oil', 'extra virgin olive oil', 'vegetable oil', 'neutral vegetable oil',
  'canola oil', 'neutral oil', 'cooking spray',
  // spice shakers & ground spices (this kitchen's standards)
  'garlic powder', 'onion powder', 'paprika', 'sweet paprika', 'smoked paprika',
  'cinnamon', 'ground cinnamon', 'cumin', 'ground cumin', 'coriander', 'ground coriander',
  'turmeric', 'ground turmeric', 'chili powder', 'cayenne', 'cayenne pepper', 'ground cayenne',
  'red pepper flake', 'crushed red pepper', 'crushed red pepper flake', 'taco seasoning',
  'bay leaf', 'bay leave',
  // flour, sugar, baking
  'flour', 'all purpose flour', 'unbleached all purpose flour',
  'sugar', 'granulated sugar', 'brown sugar', 'light brown sugar',
  'powdered sugar', 'confectioners sugar', 'cornstarch', 'baking powder', 'baking soda'
]);
function isPantryStaple(base) {
  const norm = String(base || '').toLowerCase().replace(/-/g, ' ').replace(/['\u2019]/g, '').replace(/\s+/g, ' ').trim();
  return PANTRY_STAPLES.has(norm);
}
function getHideStaples() {
  try { return localStorage.getItem('recipe-hide-staples') === '1'; } catch (e) { return false; }
}
function setHideStaples(v) {
  try { localStorage.setItem('recipe-hide-staples', v ? '1' : '0'); } catch (e) {}
}
/* Split generated To Buy lines into visible vs pantry-staple lines. A staple
   the user explicitly promoted from Optional stays visible — an explicit
   "I need this" beats the view filter. */
function partitionStaples(toBuy, week) {
  if (!getHideStaples()) return { active: toBuy, staples: [] };
  const promoted = promotedKeySet(week);
  const active = [], staples = [];
  toBuy.forEach(it => {
    (isPantryStaple((it.key || '').split('|')[0]) && !promoted.has(it.key) ? staples : active).push(it);
  });
  return { active, staples };
}
/* Split aggregated shopping lines into To Buy / Already Have / Optional,
   quantity-aware: if you marked "1 cup honey" as Have and the plan now needs
   3 cups, Already Have shows the 1 cup and To Buy keeps a "2 cups" remainder
   line. Shared by the shopping page render and Copy list so they agree. */
function splitShopItems(items, week) {
  const marks = activeHaveMarks(week.haveGenerated);
  const promoted = promotedKeySet(week);
  const toBuy = [], haveIts = [], optionalIts = [];
  items.forEach(it => {
    const mark = marks.find(m => m.key === it.key);
    if (it.optional && !mark && !promoted.has(it.key)) { optionalIts.push(it); return; }
    if (!mark) { toBuy.push(it); return; }
    const markedQty = (mark.qty !== null && mark.qty !== undefined) ? mark.qty : null;
    const curQty = (it.qty !== null && it.qty !== undefined) ? it.qty : null;
    if (markedQty !== null && curQty !== null && curQty > markedQty + 1e-9) {
      const base = it.key.split('|')[0];
      const remainder = Math.round((curQty - markedQty) * 100) / 100;
      haveIts.push({
        key: it.key, split: 'have',
        label: [fmtQty(markedQty), mark.unit || it.unit, pluralize(base, markedQty)].filter(Boolean).join(' ').trim()
      });
      toBuy.push({
        key: it.key, split: 'need',
        label: [fmtQty(remainder), it.unit, pluralize(base, remainder)].filter(Boolean).join(' ').trim()
      });
    } else {
      haveIts.push(it);
    }
  });
  return { toBuy, haveIts, optionalIts };
}
/* Re-render the shopping list preserving which collapsible sections are
   open — taps and the 15s background sync re-render constantly and would
   otherwise slam Optional / Pantry staples / Already have shut each time. */
function renderShopWrap() {
  const wrapEl = $('#shop-wrap');
  if (!wrapEl) return;
  const openState = {};
  ['shop-opt-section', 'shop-staples-section', 'shop-have-section'].forEach(cls => {
    const d = wrapEl.querySelector('details.' + cls);
    if (d) openState[cls] = d.open;
  });
  wrapEl.innerHTML = shoppingListHTML();
  Object.keys(openState).forEach(cls => {
    const d = wrapEl.querySelector('details.' + cls);
    if (d) d.open = openState[cls];
  });
}
function buildShoppingList() {
  const mon = sundayOf(0);
  const week = getWeek(thisWeekKey());
  const from = shoppingFromYmd();
  // Commit 2A: collect { id, scale, variant } per planned dish instead of bare
  // ids — quantities multiply by the dish's (manual-only) scale, and a variant
  // dish buys only its chosen version's ingredients. Leftovers dishes stay
  // excluded, as before.
  const entries = [];
  week.days.forEach((d, i) => {
    ['lunch', 'dinner'].forEach(m => {
      const s = normalizeSlot(d[m]);
      if (!s || s.skipped) return;
      s.dishes.forEach(dish => {
        if (dish.leftovers) return; // already made — don't buy ingredients
        const rid = dish.recipe;
        if (!rid || !byId[rid]) return;
        // Use cook date if set (prepare in advance), else meal date
        const effectiveDate = dish.cookDate || weekDayYmd(mon, i);
        if (from && effectiveDate < from) return; // already cooked
        entries.push({ id: rid, scale: dish.scale || 1, variant: dish.variant || null });
      });
    });
  });
  // Group on the clean item name (intake already split item/prep), with size
  // words stripped so "1 egg" + "1 large egg" merge. Shopping list shows
  // what to BUY only — prep notes are cooking instructions, not shopping info.
  // tsp/tbsp/cup convert to a common base so "½ cup + 3 tbsp" becomes one line.
  // Optional: an item is optional only if ALL occurrences are optional.
  // If any recipe requires it, the aggregated line is required.
  const map = new Map();
  entries.forEach(en => {
    const r = byId[en.id];
    if (!r) return;  // not loaded yet (ensurePlannedRecipes fetches before shopping renders)
    // Variant filter (Commit 2A): shared items (untagged) plus ONLY the chosen
    // version's tagged items. A variant recipe planned without an explicit
    // version buys the default version — never both proteins.
    const scale = en.scale || 1;
    let effVariant = en.variant || null;
    if (Array.isArray(r.variants) && r.variants.length) {
      if (!effVariant || !r.variants.some(v => v.key === effVariant)) {
        const def = r.variants.find(v => v.default) || r.variants[0];
        effVariant = def ? def.key : null;
      }
    }
    (r.ingredients || []).forEach(sec => {
      (sec.items || []).forEach(it => {
        if (effVariant && it.variant && it.variant !== effVariant) return;
        const raw = (it.item || '').trim();
        if (!raw) return;
        const gkey = groupKey(raw);
        if (!gkey) return;
        let unitRaw = (it.unit || '').trim();
        let qtyVal = qtyToNum(parseQty(it.qty));
        // normalize convertible units to tsp-base for grouping
        const ul = unitRaw.toLowerCase();
        let convBase = null;
        if (qtyVal !== null && TSP_PER[ul]) {
          convBase = qtyVal * scale * TSP_PER[ul];
          unitRaw = '__tspbase__';
        } else if (qtyVal !== null && COUNT_TO_TSP[gkey] && (ul === '' || ul === 'clove' || ul === 'cloves')) {
          // count-to-volume: "1 onion" -> 24 tsp so it merges with "½ cup chopped onion"
          convBase = qtyVal * scale * COUNT_TO_TSP[gkey];
          unitRaw = '__tspbase__';
        }
        const nkey = gkey + '|' + unitRaw.toLowerCase();
        let e = map.get(nkey);
        if (!e) {
          e = { base: gkey, unit: unitRaw, qty: 0, hasNum: false, texts: [], isConv: !!convBase, optional: !!it.optional };
          map.set(nkey, e);
        }
        // If any occurrence is required, the whole line is required.
        if (!it.optional) e.optional = false;
        if (convBase !== null) { e.qty += convBase; e.hasNum = true; }
        else {
          const n = qtyToNum(parseQty(it.qty));
          if (n !== null) { e.qty += n * scale; e.hasNum = true; }
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
    // Stable key: raw (non-pluralized) unit so the key never changes with quantity.
    const rawDu = dispUnit === '__tspbase__' ? '' : dispUnit;
    return {
      key: e.base.toLowerCase() + '|' + rawDu.toLowerCase(),
      label: [q, du, name].filter(Boolean).join(' ').trim(),
      qty: e.hasNum ? qnum : null,
      unit: du,
      optional: !!e.optional
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
      const s = normalizeSlot(ds[m]);
      if (s.skipped) return;
      s.dishes.forEach(dish => {
        const meta = dish.recipe ? recipeMeta(dish.recipe) : null;
        if (meta) parts.push(meta.title);
        else if (dish.custom) parts.push(dish.custom);
      });
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
  // Pinned hero photos (Yidi, 2026-10-21): one hand-picked representative
  // recipe per tile — representativeness is a judgment call, so the picks
  // are curated, not computed. Fallback when a hero is deleted, leaves the
  // group, or loses its photo: the first member with a photo that no
  // earlier tile is already using (keeps tiles duplicate-free).
  const TILE_HEROES = {
    'kosher:meat': 'brisket-with-vegetables-and-dried-fruit',
    'kosher:dairy': 'baked-ziti',
    'kosher:pareve': 'potato-kugel',
    'cat:main': 'michelin-star-beef-short-ribs-fallow',
    'cat:side': 'roasted-potatoes',
    'cat:soup': 'chicken-soup',
    'cat:salad': 'cucumber-salad',
    'cat:fish': 'mediterranean-roasted-whole-fish',
    'cat:chicken': 'forty-clove-garlic-chicken',
    'cat:baking': 'cinnamon-rolls',
    'cat:dessert': 'chocolate-cake',
    'cat:appetizer': 'authentic-italian-bruschetta'
  };
  const usedImgs = new Set();
  const pickImg = (key, rs) => {
    const hero = rs.find(r => r.id === TILE_HEROES[key]);
    if (hero && hero.banner_image && !usedImgs.has(hero.banner_image)) { usedImgs.add(hero.banner_image); return hero.banner_image; }
    const fresh = rs.find(r => r.banner_image && !usedImgs.has(r.banner_image));
    const chosen = fresh || rs.find(r => r.banner_image);
    if (chosen) usedImgs.add(chosen.banner_image);
    return chosen ? chosen.banner_image : '';
  };
  const out = [];
  ['meat', 'dairy', 'pareve'].forEach(k => {
    const rs = recipes.filter(r => r.kosher_status === k);
    if (!rs.length) return;
    out.push(tile(k[0].toUpperCase() + k.slice(1), rs.length, pickImg('kosher:' + k, rs), 'kosher:' + k));
  });
  // Curated category tiles (Yidi, 2026-10-20): a fixed editorial order —
  // the old allCats().slice(0, 6) took the first six ALPHABETICALLY, which
  // buried main/side/fish/soup and promoted typo categories like "desserts".
  const TILE_CATS = ['main', 'side', 'soup', 'salad', 'fish', 'chicken', 'baking', 'dessert', 'appetizer'];
  TILE_CATS.forEach(c => {
    const rs = recipes.filter(r => (r.categories || []).includes(c));
    if (!rs.length) return;
    out.push(tile(c[0].toUpperCase() + c.slice(1), rs.length, pickImg('cat:' + c, rs), 'cat:' + c));
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
  // Migrate old checkbox state to the new Have model (one-time)
  if (!Array.isArray(week.haveGenerated)) {
    week.haveGenerated = Array.isArray(week.checkedGenerated) ? [...week.checkedGenerated] : [];
    delete week.checkedGenerated;
  }
  week.manualItems.forEach(m => {
    if (m.checked !== undefined && m.have === undefined) { m.have = !!m.checked; delete m.checked; }
  });
  const items = buildShoppingList();
  const from = shoppingFromYmd();
  const marks = activeHaveMarks(week.haveGenerated);
  // Conflict: item marked have by 2+ distinct sessions and not acknowledged
  const conflictKeys = new Set();
  const byKey = {};
  marks.forEach(m => { (byKey[m.key] = byKey[m.key] || new Set()).add(m.session); });
  Object.keys(byKey).forEach(k => {
    if (byKey[k].size > 1 && !(week.conflictAcked && week.conflictAcked[k])) conflictKeys.add(k);
  });
  // Manual items: conflict if haveSession differs from another mark (track via haveSessions array)
  week.manualItems.forEach(m => {
    if (m.have && Array.isArray(m.haveSessions) && new Set(m.haveSessions).size > 1 &&
        !(week.conflictAcked && week.conflictAcked['m:' + m.id])) conflictKeys.add('m:' + m.id);
  });

  // Split into To Buy vs Already Have vs Optional (quantity-aware — see
  // splitShopItems; Copy list uses the same split so the two always agree).
  const { toBuy, haveIts, optionalIts } = splitShopItems(items, week);
  // Pantry staples toggle: generated staple lines move to their own collapsed
  // section. Undecided Optional lines and manual items are never filtered.
  const { active: activeToBuy, staples: stapleIts } = partitionStaples(toBuy, week);
  const manToBuy = week.manualItems.filter(m => !m.deleted && !m.have);
  const manHave = week.manualItems.filter(m => !m.deleted && m.have);

  const conflictBadge = k =>
    conflictKeys.has(k)
      ? '<span class="shop-conflict">⚠️ Both grabbed this — check for duplicates ' +
        '<button class="link-btn" data-confack="' + esc(k) + '" type="button">dismiss</button></span>'
      : '';
  const genToBuyLis = activeToBuy.map(it =>
    '<div class="shop-item" data-shop="' + esc(it.key) + '"' + (it.split ? ' data-shop-split="' + it.split + '"' : '') + '>' +
      '<button class="shop-have-btn" type="button" aria-label="Mark as have">○</button>' +
      '<span>' + esc(it.label) + '</span></div>'
  ).join('');
  const genHaveLis = haveIts.map(it =>
    '<div class="shop-item have' + (conflictKeys.has(it.key) ? ' conflict' : '') + '" data-shop="' + esc(it.key) + '"' + (it.split ? ' data-shop-split="' + it.split + '"' : '') + '>' +
      '<button class="shop-have-btn" type="button" aria-label="Move back to buy">●</button>' +
      '<span>' + esc(it.label) + '</span>' + conflictBadge(it.key) + '</div>'
  ).join('');
  // Staple rows reuse the exact To Buy row template (same keys, same split
  // attribute) so the delegated have-toggle handlers work unchanged.
  const stapleLis = stapleIts.map(it =>
    '<div class="shop-item" data-shop="' + esc(it.key) + '"' + (it.split ? ' data-shop-split="' + it.split + '"' : '') + '>' +
      '<button class="shop-have-btn" type="button" aria-label="Mark as have">○</button>' +
      '<span>' + esc(it.label) + '</span></div>'
  ).join('');
  const manToBuyLis = manToBuy.map(m =>
    '<div class="shop-item manual" data-manual="' + esc(m.id) + '">' +
      '<button class="shop-have-btn" type="button" aria-label="Mark as have">○</button>' +
      '<span>' + esc(m.text) + '</span>' +
      '<button class="shop-del" data-mandel="' + esc(m.id) + '" type="button" aria-label="Remove">×</button></div>'
  ).join('');
  const manHaveLis = manHave.map(m =>
    '<div class="shop-item manual have' + (conflictKeys.has('m:' + m.id) ? ' conflict' : '') + '" data-manual="' + esc(m.id) + '">' +
      '<button class="shop-have-btn" type="button" aria-label="Move back to buy">●</button>' +
      '<span>' + esc(m.text) + '</span>' + conflictBadge('m:' + m.id) +
      '<button class="shop-del" data-mandel="' + esc(m.id) + '" type="button" aria-label="Remove">×</button></div>'
  ).join('');
  // Optional items: two tap targets — "+" promotes to To Buy, "✓" marks Already Have.
  const optLis = optionalIts.map(it =>
    '<div class="shop-item optional" data-shop-opt="' + esc(it.key) + '">' +
      '<span>' + esc(it.label) + ' <em class="opt-tag">optional</em></span>' +
      '<button class="shop-opt-btn" data-opt-add="' + esc(it.key) + '" type="button" aria-label="Add to buy list" title="Add to buy list">+</button>' +
      '<button class="shop-opt-btn" data-opt-have="' + esc(it.key) + '" type="button" aria-label="Already have" title="Already have">✓</button></div>'
  ).join('');

  let html = '<div class="week-strip no-print">' + weekStripHTML() + '</div>';
  if (!items.length && !week.manualItems.some(m => !m.deleted)) {
    html += '<p class="muted">Nothing planned yet' + (from ? ' from the shopping day onward' : '') +
      ' — <a href="#/planner">plan your week</a> and your shopping list builds itself here.</p>';
  } else {
    if (genToBuyLis || manToBuyLis) {
      html += '<h3 class="shop-sub">To buy</h3><div class="shop-list" data-gen="1">' + genToBuyLis + manToBuyLis + '</div>';
    } else if (stapleLis) {
      html += '<h3 class="shop-sub">To buy</h3><p class="muted">Nothing left to buy.</p>';
    }
    if (optLis) {
      html += '<details class="shop-opt-section"><summary>Optional (' + optionalIts.length + ')</summary>' +
        '<div class="shop-list" data-opt="1">' + optLis + '</div></details>';
    }
    if (stapleLis) {
      html += '<details class="shop-staples-section"><summary>Pantry staples (' + stapleIts.length + ')</summary>' +
        '<div class="shop-list" data-staples="1">' + stapleLis + '</div></details>';
    }
    if (genHaveLis || manHaveLis) {
      html += '<details class="shop-have-section"><summary>Already have (' + (haveIts.length + manHave.length) + ')</summary>' +
        '<div class="shop-list" data-have="1">' + genHaveLis + manHaveLis + '</div></details>';
    }
  }
  html += '<div class="shop-add no-print"><input type="text" id="shop-new" placeholder="Add your own item…" aria-label="Add your own item">' +
    '<button class="btn secondary" id="shop-add" type="button">Add</button></div>';
  html += '<div style="margin-top:.6rem"><button class="btn secondary" id="shop-copy" type="button">Copy list</button></div>';
  return html;
}

/* ---------------- Home: search / filter / grid ---------------- */
const allTags = () => [...new Set(recipes.flatMap(r => r.tags || []))].sort();
const allCats = () => [...new Set(recipes.flatMap(r => r.categories || []))].sort();

function renderRecipes(app) {
  const tags = allTags(), cats = allCats();
  app.innerHTML =
    '<section class="hero">' +
      '<h1>What are we cooking?</h1>' +
      '<div class="search-row hero-search no-print">' +
        '<input type="search" id="q" placeholder="Search recipes, ingredients, tags…" ' +
        'value="' + esc(filters.q) + '" aria-label="Search recipes"></div>' +
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
      '<div class="filter-actions"><button class="btn secondary" id="f-clear" type="button">Clear filters</button></div>' +
    '</div>' +
    '<p class="result-count" id="result-count"></p>' +
    '<div class="no-print" style="margin:0 0 1rem"><a class="btn" href="#/add">+ Add recipe</a> ' +
    '<a class="btn secondary" href="#/submit">Submit recipe</a></div>' +
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
  $('#f-clear').addEventListener('click', () => {
    Object.assign(filters, { q: '', kosher: 'all', kfp: false, category: 'all', tag: 'all', maxTime: 0, leftovers: false, sort: 'asc' });
    $('#q').value = '';
    $('#f-kosher').value = 'all';
    $('#f-cat').value = 'all';
    $('#f-tag').value = 'all';
    $('#f-time').value = '0';
    $('#f-sort').value = 'asc';
    $('#f-kfp').checked = false;
    $('#f-left').checked = false;
    drawGrid();
  });
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

  drawGrid();
}

/* ---------------- Shopping list page ---------------- */
// Fetch full JSONs for all recipes in the current week's meal plan (parallel).
// Used by the shopping list, which needs ingredients. Cached in byId.
async function ensurePlannedRecipes() {
  const week = getWeek(thisWeekKey());
  const ids = new Set();
  (week.days || []).forEach(d => {
    ['lunch', 'dinner'].forEach(m => {
      const s = normalizeSlot(d[m]);
      (s.dishes || []).forEach(dish => {
        if (dish.recipe && !dish.leftovers) ids.add(dish.recipe);
      });
    });
  });
  await Promise.all([...ids].map(id => ensureRecipe(id)));
}
async function renderShopping(app) {
  document.title = 'Shopping List — Reiss Family Recipes';
  app.innerHTML =
    '<section class="page-head"><h1>Shopping List</h1>' +
    '<p class="muted">' + (shoppingFromLabel() || 'Based on your meal plan') + '</p>' +
    '<label class="shop-staple-toggle no-print"><input type="checkbox" id="shop-hide-staples"' + (getHideStaples() ? ' checked' : '') + '> Hide pantry staples</label></section>' +
    '<div id="shop-wrap"></div>' +
    '<div class="no-print" style="margin-top:1rem"><a class="link-btn" href="#/planner">← Back to planner</a></div>';

  // Fetch full JSONs for planned recipes only (parallel).
  await ensurePlannedRecipes();
  renderShopWrap();

  const shopWrap = $('#shop-wrap');
  const saveShop = () => { markShopDirty(); };
  const rerender = () => renderShopWrap();
  const stapleToggle = $('#shop-hide-staples');
  if (stapleToggle) stapleToggle.addEventListener('change', () => { setHideStaples(stapleToggle.checked); rerender(); });
  // Start 15s background sync while the shopping page is open
  startShopPoll();

  shopWrap.addEventListener('click', e => {
    // Toggle have / to-buy (local-first: works offline, syncs in background)
    const haveBtn = e.target.closest('.shop-have-btn');
    if (haveBtn) {
      const week = getWeek(thisWeekKey());
      const sid = getSessionId(), now = Date.now();
      const genItem = haveBtn.closest('[data-shop]');
      const manItem = haveBtn.closest('[data-manual]');
      if (genItem) {
        week.haveGenerated = normalizeHaveMarks(week.haveGenerated);
        const k = genItem.dataset.shop;
        const split = genItem.dataset.shopSplit || null;
        const existing = week.haveGenerated.find(x => x.key === k && x.session === sid);
        // "Have" belongs to the item, not to the session that checked it:
        // sessions live in sessionStorage, so every new tab or device is a
        // new session. Unchecking must therefore work from ANY session —
        // keying it to the checking session made cross-session items
        // impossible to uncheck and added the tapper as a false second
        // checker instead (Argon QA, 2026-10-20).
        const anyHave = week.haveGenerated.some(x => x.key === k && !x.removed);
        // Promoted optional item: tapping "○" sends it back to Optional.
        const isPromoted = promotedKeySet(week).has(k);
        if (isPromoted && !anyHave && split !== 'need') {
          setPromoted(week, k, false);
          markShopDirty(); rerender(); return;
        }
        if (anyHave && split !== 'need') {
          // Uncheck: tombstone EVERY active mark for this key (any session's)
          // so no checked copy in sync can resurrect it.
          week.haveGenerated.forEach(x => { if (x.key === k && !x.removed) { x.removed = true; x.at = now; } });
        } else {
          // Check: capture the quantity on the line at check time, so later additions
          // of the same ingredient split into a separate unchecked line.
          // Tapping a split "need" line checks the full current quantity.
          const line = buildShoppingList().find(it => it.key === k);
          const mark = { key: k, session: sid, at: now };
          if (line && line.qty !== null && line.qty !== undefined) {
            mark.qty = line.qty;
            mark.unit = line.unit || '';
          }
          if (existing) {
            // Update existing mark (split "need" tap, or re-check after an
            // uncheck) instead of duplicating.
            Object.assign(existing, mark);
            delete existing.removed;
          } else {
            week.haveGenerated.push(mark);
          }
        }
        markShopDirty(); rerender(); return;
      }
      if (manItem) {
        const m = (week.manualItems || []).find(x => x.id === manItem.dataset.manual);
        if (m) {
          if (m.have) {
            // Any session can uncheck a manual item (the checking session may
            // be a closed tab or another device); newest updatedAt wins in
            // sync, so this uncheck propagates.
            m.have = false; m.haveSession = null; m.haveAt = 0; m.haveSessions = []; m.updatedAt = now; m.updatedBy = sid;
          } else {
            m.have = true; m.haveSession = sid; m.haveAt = now;
            if (!Array.isArray(m.haveSessions)) m.haveSessions = [];
            if (!m.haveSessions.includes(sid)) m.haveSessions.push(sid);
            m.updatedAt = now; m.updatedBy = sid;
          }
        }
        markShopDirty(); rerender(); return;
      }
    }
    // Optional items: "+" promotes to To Buy, "✓" marks Already Have.
    const optAdd = e.target.closest('[data-opt-add]');
    if (optAdd) {
      const week = getWeek(thisWeekKey());
      const k = optAdd.dataset.optAdd;
      setPromoted(week, k, true);
      markShopDirty(); rerender(); return;
    }
    const optHave = e.target.closest('[data-opt-have]');
    if (optHave) {
      const week = getWeek(thisWeekKey());
      const sid = getSessionId(), now = Date.now();
      const k = optHave.dataset.optHave;
      week.haveGenerated = normalizeHaveMarks(week.haveGenerated);
      // Remove from promoted if it was there.
      setPromoted(week, k, false);
      const line = buildShoppingList().find(it => it.key === k);
      const mark = { key: k, session: sid, at: now };
      if (line && line.qty !== null && line.qty !== undefined) {
        mark.qty = line.qty;
        mark.unit = line.unit || '';
      }
      const exMark = week.haveGenerated.find(x => x.key === k && x.session === sid);
      if (exMark) { Object.assign(exMark, mark); delete exMark.removed; }
      else week.haveGenerated.push(mark);
      markShopDirty(); rerender(); return;
    }
    // Dismiss conflict warning
    const conflictBtn = e.target.closest('[data-confack]');
    if (conflictBtn) {
      const week = getWeek(thisWeekKey());
      if (!week.conflictAcked) week.conflictAcked = {};
      week.conflictAcked[conflictBtn.dataset.confack] = true;
      markShopDirty(); rerender(); return;
    }
    // Delete manual item
    const del = e.target.closest('[data-mandel]');
    if (del) {
      const week = getWeek(thisWeekKey());
      const dm = (week.manualItems || []).find(x => x.id === del.dataset.mandel);
      if (dm) { dm.deleted = true; dm.updatedAt = Date.now(); dm.updatedBy = getSessionId(); }
      saveShop(); rerender(); return;
    }
    // Add manual item
    if (e.target.closest('#shop-add')) {
      const input = $('#shop-new');
      const text = (input.value || '').trim();
      if (!text) return;
      const week = getWeek(thisWeekKey());
      if (!Array.isArray(week.manualItems)) week.manualItems = [];
      week.manualItems.push({ id: 'm' + Date.now().toString(36), text, have: false, updatedAt: Date.now(), updatedBy: getSessionId() });
      saveShop(); rerender();
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
    // Copy exactly what the To buy section shows: full lines + quantity-split
    // remainders, minus undecided optionals and (toggle on) pantry staples.
    const { active } = partitionStaples(splitShopItems(buildShoppingList(), week).toBuy, week);
    const manToBuy = (week.manualItems || []).filter(m => !m.deleted && !m.have);
    const lines = active.map(it => '• ' + it.label).concat(manToBuy.map(m => '• ' + m.text));
    const text = 'Shopping list — week of ' + thisWeekKey() + '\n' + lines.join('\n');
    const done = () => toast('Shopping list copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => toast('Copy failed'));
    } else { toast('Copy not supported here'); }
  });
}

/* ---------------- Landing page ---------------- */
function renderLanding(app) {
  document.title = 'Reiss Family Recipes';
  const week = getWeek(thisWeekKey());
  const items = buildShoppingList();
  const haveKeys = new Set(activeHaveMarks(week.haveGenerated).map(m => m.key));
  const toBuyCount = items.filter(it => !haveKeys.has(it.key)).length +
    (week.manualItems || []).filter(m => !m.deleted && !m.have).length;
  const plannedCount = week.days.reduce((n, d) =>
    n + normalizeSlot(d.lunch).dishes.length + normalizeSlot(d.dinner).dishes.length, 0);

  app.innerHTML =
    '<section class="hero landing-hero">' +
      '<h1>Reiss Family Recipes</h1>' +
      '<p class="muted">What are we cooking this week?</p>' +
    '</section>' +
    '<section class="landing-cards">' +
      '<a class="landing-card" href="#/recipes">' +
        '<div class="landing-card-icon">🍳</div>' +
        '<h2>Recipes</h2><p>' + recipes.length + ' recipes</p></a>' +
      '<a class="landing-card" href="#/planner">' +
        '<div class="landing-card-icon">📅</div>' +
        '<h2>Meal Planner</h2><p>' + plannedCount + ' meals planned</p></a>' +
      '<a class="landing-card" href="#/shopping">' +
        '<div class="landing-card-icon">🛒</div>' +
        '<h2>Shopping List</h2><p>' + toBuyCount + ' items to buy</p></a>' +
    '</section>' +
    '<section class="home-section">' +
      '<div class="section-head"><h2>This week</h2>' +
      '<a class="link-btn" href="#/planner">Open planner →</a></div>' +
      '<div class="plan-carousel">' + planCarouselHTML() + '</div>' +
    '</section>';
}

function planCarouselHTML() {
  const mon = sundayOf(0);
  const week = getWeek(thisWeekKey());
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return week.days.map((d, i) => {
    const date = new Date(mon);
    date.setDate(date.getDate() + i);
    const meals = [];
    ['lunch', 'dinner'].forEach(m => {
      const s = normalizeSlot(d[m]);
      s.dishes.forEach(dish => {
        const label = m === 'lunch' ? 'Lunch' : 'Dinner';
        const meta = dish.recipe ? recipeMeta(dish.recipe) : null;
        if (meta) {
          meals.push('<div class="carousel-meal"><span class="carousel-meal-type">' + label + '</span>' +
            '<a href="#/recipe/' + encodeURIComponent(meta.id) + '">' + esc(meta.title) + '</a>' +
            (dish.leftovers ? ' <span class="badge leftovers">Leftovers</span>' : '') + '</div>');
        } else if (dish.custom) {
          meals.push('<div class="carousel-meal"><span class="carousel-meal-type">' + label + '</span>' +
            esc(dish.custom) +
            (dish.leftovers ? ' <span class="badge leftovers">Leftovers</span>' : '') + '</div>');
        }
      });
    });
    return '<div class="carousel-day"><h4>' + days[i] + '</h4>' +
      '<div class="carousel-date">' + (date.getMonth() + 1) + '/' + date.getDate() + '</div>' +
      (meals.length ? meals.join('') : '<span class="muted">—</span>') + '</div>';
  }).join('');
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
        r.search_text || '',
        // Fallback for fully-loaded recipes (pre-meta format)
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
// ---- Serving scaling (Argon-built, Muse-reviewed) ----
// Pure functions for parsing, formatting, and scaling ingredient quantities.
// Used by recipe detail page scale controls. PDFs always stay at 1x.
const UNICODE_FRACTIONS = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6',
  '⅚': '5/6', '⅐': '1/7', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8',
  '⅞': '7/8', '⅑': '1/9', '⅒': '1/10'
};
function parseFractionOrDecimal(token) {
  if (!token) return null;
  if (token.includes('/')) {
    const parts = token.split('/');
    if (parts.length !== 2) return null;
    const n = parts[0], d = parts[1];
    if (!n || !d) return null;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(n)) return null;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(d)) return null;
    const num = parseFloat(n), den = parseFloat(d);
    if (den === 0) return null;
    return num / den;
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return null;
  const v = parseFloat(token);
  return Number.isFinite(v) ? v : null;
}
function parseSingleValue(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim();
  if (!s) return null;
  for (const ch of Object.keys(UNICODE_FRACTIONS)) {
    if (s.includes(ch)) s = s.split(ch).join(' ' + UNICODE_FRACTIONS[ch] + ' ');
  }
  s = s.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/[a-zA-Z]/.test(s)) return null;
  if (/[^0-9./\s]/.test(s)) return null;
  const parts = s.split(' ').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parseFractionOrDecimal(parts[0]);
  if (parts.length === 2) {
    if (!parts[1].includes('/')) return null;
    if (parts[0].includes('/')) return null;
    const whole = parseFractionOrDecimal(parts[0]);
    const frac = parseFractionOrDecimal(parts[1]);
    if (whole === null || frac === null) return null;
    return whole + frac;
  }
  return null;
}
function parseQty(qtyStr) {
  if (typeof qtyStr !== 'string') return null;
  const s = qtyStr.trim();
  if (!s) return null;
  if (/\s+to\s+/i.test(s)) {
    const parts = s.split(/\s+to\s+/i);
    if (parts.length !== 2) return null;
    const a = parseSingleValue(parts[0]), b = parseSingleValue(parts[1]);
    if (a === null || b === null) return null;
    return a <= b ? [a, b] : [b, a];
  }
  if (/[‐–—-]/.test(s)) {
    const parts = s.split(/[‐–—-]/);
    if (parts.length !== 2) return null;
    if (!parts[0].trim() || !parts[1].trim()) return null;
    const a = parseSingleValue(parts[0]), b = parseSingleValue(parts[1]);
    if (a === null || b === null) return null;
    return a <= b ? [a, b] : [b, a];
  }
  return parseSingleValue(s);
}
// For shopping lists: collapse a parseQty result to a single number.
// Ranges use the max so you buy enough ("1-2 tbsp" -> 2).
function qtyToNum(q) {
  if (q === null || q === undefined) return null;
  if (Array.isArray(q)) {
    const nums = q.filter(n => typeof n === 'number' && Number.isFinite(n));
    return nums.length ? Math.max(...nums) : null;
  }
  return (typeof q === 'number' && Number.isFinite(q)) ? q : null;
}
function formatQty(value, unit) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return '';
  if (value === 0) return '0';
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (value < 0) {
    const pos = formatQty(-value, unit);
    if (!pos) return '';
    return pos === 'a pinch' ? '-a pinch' : '-' + pos;
  }
  const LARGE_DECIMAL_UNITS = new Set(['kg','kilogram','kilograms','l','liter','liters','litre','litres']);
  const SMALL_DECIMAL_UNITS = new Set(['g','gram','grams','mg','milligram','milligrams','ml','milliliter','milliliters','millilitre','millilitres']);
  // Note: oz/lb use FRACTIONS (US cooking: "1 1/4 lb"), not decimals. Only metric stays decimal.
  if (LARGE_DECIMAL_UNITS.has(u)) {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === 0) return 'a pinch';
    return String(rounded);
  }
  if (SMALL_DECIMAL_UNITS.has(u)) {
    if (value < 0.2) return 'a pinch';
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return String(rounded);
  }
  if (value < 0.09) return 'a pinch';
  let whole = Math.floor(value);
  let frac = value - whole;
  const all = [
    { num: 0, den: 1, val: 0 }, { num: 1, den: 16, val: 1/16 },
    { num: 1, den: 8, val: 1/8 }, { num: 1, den: 4, val: 1/4 },
    { num: 1, den: 3, val: 1/3 }, { num: 3, den: 8, val: 3/8 },
    { num: 1, den: 2, val: 1/2 }, { num: 5, den: 8, val: 5/8 },
    { num: 2, den: 3, val: 2/3 }, { num: 3, den: 4, val: 3/4 },
    { num: 7, den: 8, val: 7/8 }, { num: 1, den: 1, val: 1 }
  ];
  const candidates = value < 0.25 ? all : all.filter((c) => !(c.num === 1 && c.den === 16));
  let best = candidates[0];
  let bestDiff = Math.abs(frac - best.val);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(frac - candidates[i].val);
    if (diff < bestDiff) { best = candidates[i]; bestDiff = diff; }
  }
  if (best.val === 1) { whole += 1; return String(whole); }
  if (best.val === 0) { if (whole === 0) return 'a pinch'; return String(whole); }
  if (whole === 0) return best.num + '/' + best.den;
  return whole + ' ' + best.num + '/' + best.den;
}
function scaleQty(qtyStr, unit, scale) {
  if (typeof qtyStr !== 'string') return '';
  if (qtyStr === '') return '';
  const parsed = parseQty(qtyStr);
  if (parsed === null) return qtyStr;
  if (Array.isArray(parsed)) {
    const fmtMin = formatQty(parsed[0] * scale, unit);
    const fmtMax = formatQty(parsed[1] * scale, unit);
    if (fmtMin === fmtMax) return fmtMin;
    // If lower bound fell below pinch threshold but upper bound is a valid fraction/number,
    // collapse to the upper bound rather than emitting "a pinch-1/8".
    if (fmtMin === 'a pinch') return fmtMax;
    return fmtMin + '-' + fmtMax;
  }
  return formatQty(parsed * scale, unit);
}
// Pluralize a unit based on scaled quantity ("1 clove" → "2 cloves").
// Rule: singular if 0 < value <= 1 (covers "1", "1/2", "1/4"); plural otherwise
// (covers "0", "2", "1 1/2", ranges). Uses numeric value, not string equality.
function pluralizeScaledUnit(unit, formattedQty) {
  if (!unit) return '';
  const u = unit.trim().toLowerCase();
  const map = {
    cup: 'cups', clove: 'cloves', can: 'cans', package: 'packages',
    packet: 'packets', pkt: 'pkts', pinch: 'pinches', dash: 'dashes',
    teaspoon: 'teaspoons', tablespoon: 'tablespoons', ounce: 'ounces',
    pound: 'pounds', gram: 'grams', kilogram: 'kilograms', liter: 'liters',
    litre: 'litres', milliliter: 'milliliters', millilitre: 'millilitres',
    slice: 'slices', piece: 'pieces', bunch: 'bunches', head: 'heads',
    stalk: 'stalks', sprig: 'sprigs', leaf: 'leaves', stick: 'sticks',
    box: 'boxes', jar: 'jars', bottle: 'bottles', bag: 'bags',
    ear: 'ears', quart: 'quarts', pint: 'pints', gallon: 'gallons',
    drop: 'drops', strip: 'strips'
  };
  // Parse formattedQty to a number (handles "1/2", "1 1/2", "2-3", "1").
  const parsed = parseQty(formattedQty);
  let value = null;
  if (typeof parsed === 'number') value = parsed;
  else if (Array.isArray(parsed)) value = parsed[1]; // range: use max for plural decision
  const isSingular = value !== null && value > 0 && value <= 1;
  if (isSingular) {
    const singular = Object.keys(map).find(k => map[k] === u);
    return singular || unit;
  }
  if (map[u]) return map[u];
  if (Object.values(map).includes(u)) return unit;
  return unit; // tbsp, tsp, g, ml, oz, lb are invariant
}

async function renderRecipe(app, id) {
  const r = await ensureRecipe(id);
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/recipes">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  document.title = r.title + ' — Reiss Family Recipes';

  // Scale controls: compute on render, embed originals in data attributes.
  // Never re-parse DOM text (avoids compounding drift). Resets to 1x on navigation.
  // Servings can be a number or a range string like "6-8" — parse once, scale both ends.
  // parseServings itself is hoisted to top level (Commit 2A) — see the helpers
  // section; this renderer calls the shared one.
  function formatScaledServings(parsed, factor) {
    if (!parsed) return '';
    const low = Math.round(parsed.low * factor);
    const high = Math.round(parsed.high * factor);
    return low === high ? String(low) : low + '-' + high;
  }
  let scaleState = { factor: 1, servings: r.servings || null, parsedServings: parseServings(r.servings) };
  const scaleBarHTML = () => {
    const presets = [0.5, 1, 2, 3];
    const presetBtns = presets.map(p =>
      '<button class="scale-btn' + (scaleState.factor === p ? ' active' : '') + '" data-scale="' + p + '" type="button">' + (p === 1 ? '1x' : p + 'x') + '</button>'
    ).join('');
    let servesHTML = '';
    if (scaleState.parsedServings) {
      const curServings = formatScaledServings(scaleState.parsedServings, scaleState.factor);
      servesHTML = '<span class="scale-serves">Serves <button class="scale-step" data-step="-1" type="button" aria-label="Fewer servings">−</button> <span id="scale-servings-val">' + curServings + '</span> <button class="scale-step" data-step="1" type="button" aria-label="More servings">+</button></span>';
    }
    return '<div class="scale-bar no-print">' +
      '<span class="scale-label">Scale:</span> ' + presetBtns + servesHTML +
      '<span class="scale-current" id="scale-current">' +
        (scaleState.factor === 1 ? 'Original recipe' : 'Showing ' + scaleState.factor + 'x' + (scaleState.parsedServings ? ' · ' + formatScaledServings(scaleState.parsedServings, scaleState.factor) + ' servings' : '')) +
      '</span></div>';
  };

  // Variant toggle (Commit 2B): when the recipe has versions, the
  // ingredient list shows shared items + the selected version's items
  // (default preselected). The servings scaler re-runs on the filtered
  // list, so scaling keeps working per version.
  let selectedVariant = variantDefaultKey(r.variants);
  const ingListHTML = sections => (sections || []).map(s =>
    (s.section ? '<h3>' + esc(s.section) + '</h3>' : '') +
    '<ul class="ing-list">' + (s.items || []).map(i =>
      '<li><span class="qty ing-qty" data-base-qty="' + esc(i.qty || '') + '" data-unit="' + esc(i.unit || '') + '">' +
      esc([i.qty, i.unit].filter(Boolean).join(' ')) + '</span> ' +
      '<span class="ing-item" data-base-item="' + esc(i.item || '') + '">' + esc(i.item) + '</span>' +
      (i.optional ? ' <em class="opt-tag">optional</em>' : '') + '</li>'
    ).join('') + '</ul>'
  ).join('');
  const ingHTML = ingListHTML(filterIngredientsForVariant(r.ingredients, selectedVariant));
  const variantPillsHTML = (Array.isArray(r.variants) && r.variants.length)
    ? '<div class="variant-pills no-print" role="group" aria-label="Recipe version">' +
      r.variants.map(v => '<button type="button" class="variant-pill' +
        (v.key === selectedVariant ? ' active' : '') + '" data-variant="' + esc(v.key) + '">' +
        esc(v.label) + '</button>').join('') + '</div>'
    : '';
  let curRating = ((mealPlan.recipePrefs || {})[r.id] || {}).rating || null;
  const ratingRowHTML =
    '<div class="rating-row no-print"><span class="rating-label">Family rating:</span>' +
    '<span class="seg-control" id="rating-seg">' +
    [['favorite', 'Favorite'], ['fine', 'Fine'], ['skip', 'Skip']].map(([v, l]) =>
      '<button type="button" class="seg-btn' + (curRating === v ? ' active' : '') +
      '" data-rating="' + v + '">' + l + '</button>').join('') +
    '</span></div>';

  const pairHTML = (r.pairings && r.pairings.length)
    ? '<section class="recipe-section"><h2>Pairings</h2><ul class="pairing-list">' +
      r.pairings.map(p => {
        const t = recipeMeta(p.recipe_id);
        return '<li>' + (t
          ? '<a href="#/recipe/' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a>'
          : esc(p.recipe_id)) + ' — ' + esc(p.note || '') + '</li>';
      }).join('') + '</ul></section>'
    : '';

  const leftoverNote = r.leftover_note ||
    (r.leftover_friendly ? 'Good for leftovers.' : 'Best eaten fresh.');

  app.innerHTML =
    '<a class="back-link no-print" href="#/recipes">← All recipes</a>' +
    '<article class="recipe-print">' +
      '<div class="recipe-hero">' + bannerHTML(r) + '</div>' +
      '<h1 class="recipe-title">' + esc(r.title) + '</h1>' +
      badgesHTML(r) +
      ratingRowHTML +
      (r.needs_kosher_review
        ? '<div class="kosher-alert"><strong>⚠️ Potential kosher issues — review needed.</strong>' +
          (r.kosher_review_notes ? '<br>' + esc(r.kosher_review_notes) : '') + '</div>'
        : '') +
      '<div class="recipe-meta">' +
        '<span>Prep <strong>' + esc(fmtTime(r.prep_minutes)) + '</strong></span>' +
        '<span>Cook <strong>' + esc(fmtTime(r.cook_minutes)) + '</strong></span>' +
        '<span>Total <strong>' + esc(fmtTime(totalTime(r))) + '</strong></span>' +
        '<span>Serves <strong id="header-servings-val">' + esc(r.servings || '—') + '</strong></span>' +
      '</div>' +
      '<section class="recipe-section"><h2>Ingredients</h2>' + scaleBarHTML() + variantPillsHTML +
      '<div id="ing-wrap">' + ingHTML + '</div></section>' +
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
      '<div class="danger-zone no-print">' +
        '<a class="btn danger-outline" href="#/delete/' + encodeURIComponent(r.id) + '">Delete recipe</a>' +
      '</div>' +
    '</article>';

  $('#share-btn').onclick = () => shareRecipe(r);
  $('#print-btn').onclick = () => window.print();

  // Scale controls: recompute all quantities from data-base-qty on every change.
  // Store targetServings (not rounded factor) to avoid precision loss.
  const applyScale = () => {
    const f = scaleState.factor;
    app.querySelectorAll('.ing-qty').forEach(el => {
      const baseQty = el.dataset.baseQty || '';
      const unit = el.dataset.unit || '';
      // Empty qty: preserve unit if present (e.g. "salt" with unit "" stays empty,
      // but a unit-only entry like "pinch" keeps its unit).
      if (!baseQty) { el.textContent = unit; return; }
      const scaled = scaleQty(baseQty, unit, f);
      // If scaleQty returns empty/unparseable, fall back to original text.
      if (!scaled) { el.textContent = [baseQty, unit].filter(Boolean).join(' '); return; }
      // Non-numeric results ("a pinch", "to taste") need no unit appended.
      const isTextual = !/\d/.test(scaled);
      if (isTextual) { el.textContent = scaled; return; }
      const dispUnit = pluralizeScaledUnit(unit, scaled);
      el.textContent = dispUnit ? scaled + ' ' + dispUnit : scaled;
    });
    // Bare count nouns: pluralize item name when unit is empty and qty > 1.
    // "2 red onion" → "2 red onions". Uses existing pluralize() (handles uncountables).
    app.querySelectorAll('.ing-item').forEach(el => {
      const baseItem = el.dataset.baseItem || '';
      const qtyEl = el.parentElement ? el.parentElement.querySelector('.ing-qty') : null;
      const baseQty = qtyEl ? (qtyEl.dataset.baseQty || '') : '';
      const unit = qtyEl ? (qtyEl.dataset.unit || '') : '';
      if (!baseItem || unit) { el.textContent = baseItem; return; }
      const parsed = parseQty(baseQty);
      let scaledNum = null;
      if (typeof parsed === 'number') scaledNum = parsed * f;
      else if (Array.isArray(parsed)) scaledNum = parsed[1] * f;
      if (scaledNum === null) { el.textContent = baseItem; return; }
      el.textContent = pluralize(baseItem, scaledNum);
    });
    // Update scale bar UI (scoped to app, not global $).
    app.querySelectorAll('.scale-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.scale) === f);
    });
    const curEl = app.querySelector('#scale-current');
    if (curEl) {
      // Display factor rounded to 2 decimals (calculation uses full precision).
      const dispFactor = Math.round(f * 100) / 100;
      curEl.textContent = f === 1 ? 'Original recipe' :
        'Showing ' + dispFactor + 'x' + (scaleState.parsedServings ? ' · ' + formatScaledServings(scaleState.parsedServings, f) + ' servings' : '');
    }
    const servVal = app.querySelector('#scale-servings-val');
    const headerServVal = app.querySelector('#header-servings-val');
    if (scaleState.parsedServings) {
      const scaledServings = formatScaledServings(scaleState.parsedServings, f);
      if (servVal) servVal.textContent = scaledServings;
      if (headerServVal) headerServVal.textContent = scaledServings;
    }
  };
  app.querySelectorAll('[data-scale]').forEach(btn => {
    btn.addEventListener('click', () => {
      scaleState.factor = parseFloat(btn.dataset.scale);
      applyScale();
    });
  });
  app.querySelectorAll('[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!scaleState.parsedServings) return;
      const step = parseInt(btn.dataset.step, 10);
      if (isNaN(step)) return;
      // For ranges, step from the midpoint.
      const baseMid = (scaleState.parsedServings.low + scaleState.parsedServings.high) / 2;
      const curServings = Math.round(baseMid * scaleState.factor);
      const newServings = Math.max(1, curServings + step);
      // Compute factor from target servings — no rounding, no precision loss.
      scaleState.factor = newServings / baseMid;
      applyScale();
    });
  });
  // Variant toggle: swap the ingredient list to the chosen version and
  // re-run the scaler over the new nodes.
  app.querySelectorAll('[data-variant]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedVariant = btn.dataset.variant;
      app.querySelectorAll('[data-variant]').forEach(b =>
        b.classList.toggle('active', b === btn));
      const wrap = app.querySelector('#ing-wrap');
      if (wrap) wrap.innerHTML = ingListHTML(filterIngredientsForVariant(r.ingredients, selectedVariant));
      applyScale();
    });
  });
  // Family rating: tap to set; tap the active one again to clear.
  app.querySelectorAll('[data-rating]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const next = curRating === btn.dataset.rating ? null : btn.dataset.rating;
      try {
        await setRecipePref(r.id, { rating: next });
        curRating = next;
        app.querySelectorAll('[data-rating]').forEach(b =>
          b.classList.toggle('active', b.dataset.rating === next));
      } catch (e) {
        toast('Couldn\u2019t save rating: ' + e.message);
      }
    });
  });
  // Normalize initial render (e.g. "1 cups" in stored data → "1 cup").
  applyScale();
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
  d.variants = Array.isArray(d.variants) ? d.variants : [];
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
        '<label><input type="checkbox" id="e-kosher-review"' + (r.needs_kosher_review ? ' checked' : '') + '> Needs kosher review</label>' +
      '</div>' +
      '<div class="field" id="e-kosher-notes-wrap" style="margin-top:.5rem;' + (r.needs_kosher_review ? '' : 'display:none') + '">' +
        '<label for="e-kosher-notes">Kosher review notes</label>' +
        '<input type="text" id="e-kosher-notes" value="' + esc(r.kosher_review_notes || '') + '" placeholder="What needs checking?">' +
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
      '<div class="field"><label>Versions (optional)</label><div id="variant-editor"></div>' +
        '<button class="link-btn" id="variant-add" type="button">+ Add version</button>' +
        '<div class="form-hint">A version is a named way of making this dish (e.g. Beef / Chicken). ' +
        'Tag ingredients to a version in the Version column below; untagged ingredients are in every version.</div></div>' +
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
      '<div class="field"><label for="edit-reasoning">Why did you change this? <span style="font-weight:400;color:#8a7a68">(optional, saved to change history)</span></label>' +
        '<input type="text" id="edit-reasoning" maxlength="240" placeholder="e.g. Fixed the salt amount after making it"></div>' +
      '<div class="actions" style="margin-bottom:0">' +
        '<button class="btn" id="edit-save" type="button">Save recipe</button>' +
        '<a class="btn secondary" href="' + cancelHref + '">Cancel</a>' +
      '</div>' +
      historyHTML(r.history) +
    '</form>'
  );
}

/* Collapsible change history section for the edit page. */
function historyHTML(history) {
  const h = Array.isArray(history) ? [...history].reverse() : [];
  let inner;
  if (!h.length) {
    inner = '<p style="color:#8a7a68;font-size:.9em">No recorded changes yet.</p>';
  } else {
    inner = h.map(e => {
      const when = e.ts ? new Date(e.ts).toLocaleString() : '';
      const changes = Array.isArray(e.changes) ? e.changes.map(c => {
        if (typeof c === 'string') return '<li>' + esc(c) + '</li>';
        if (c && typeof c === 'object') {
          const from = c.from == null ? '—' : esc(String(c.from));
          const to = c.to == null ? '—' : esc(String(c.to));
          return '<li><strong>' + esc(c.field || '?') + ':</strong> ' + from + ' → ' + to + '</li>';
        }
        return '';
      }).join('') : '';
      return '<div style="margin-bottom:.75rem;padding-bottom:.75rem;border-bottom:1px solid #eee">' +
        '<div style="font-size:.85em;color:#8a7a68">' + esc(e.action || 'edit') + ' · ' + esc(e.actor || '') + ' · ' + esc(when) + '</div>' +
        (e.reasoning ? '<div style="font-style:italic;margin:.25rem 0">"' + esc(e.reasoning) + '"</div>' : '') +
        (changes ? '<ul style="margin:.25rem 0;padding-left:1.25rem;font-size:.9em">' + changes + '</ul>' : '') +
      '</div>';
    }).join('');
  }
  return '<details style="margin-top:1.5rem;border:1px solid #e0d5c1;border-radius:8px;padding:.75rem 1rem">' +
    '<summary style="cursor:pointer;font-weight:600">Change history (' + h.length + ')</summary>' +
    '<div style="margin-top:.75rem">' + inner + '</div></details>';
}

/* ---------------- Delete recipe ----------------
   Two-step: #/delete/<id> shows a confirmation page (never a bare
   confirm dialog). Confirm deletes the JSON + PDF via the bridge
   and removes the ID from the index, then returns to the list. */
async function renderDelete(app, id) {
  const r = await ensureRecipe(id);
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/recipes">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2><p>It may have already been deleted.</p></div>';
    return;
  }
  document.title = 'Delete ' + r.title + ' — Reiss Family Recipes';
  let busy = false;
  let err = '';
  const draw = () => {
    app.innerHTML =
      '<a class="back-link" href="#/recipe/' + encodeURIComponent(r.id) + '">← Back to recipe</a>' +
      '<div class="delete-confirm">' +
        '<h1 class="recipe-title">Delete recipe?</h1>' +
        '<p class="delete-name">"' + esc(r.title) + '"</p>' +
        '<p class="delete-warn">This will permanently remove the recipe, its photo PDF, and its entry from the recipe list. <strong>This can\'t be undone.</strong></p>' +
        (err ? '<p class="form-error">' + esc(err) + '</p>' : '') +
        '<div class="delete-actions">' +
          '<a class="btn secondary" href="#/recipe/' + encodeURIComponent(r.id) + '">Cancel</a>' +
          '<button class="btn danger" id="delete-confirm-btn" type="button"' + (busy ? ' disabled' : '') + '>' +
            (busy ? 'Deleting…' : 'Yes, delete it') + '</button>' +
        '</div>' +
      '</div>';
    $('#delete-confirm-btn').onclick = onConfirm;
  };
  const onConfirm = async () => {
    if (busy) return;
    busy = true; err = ''; draw();
    try {
      // Delete the recipe JSON and its PDF (PDF may not exist — bridge treats that as ok).
      await bridgeDelete('data/recipes/' + r.id + '.json', 'Delete recipe ' + r.id + ' via site');
      await bridgeDelete('pdfs/' + r.id + '.pdf', 'Delete PDF for ' + r.id + ' via site');
      // Remove from the index.
      const idxRes = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/recipes/index.json'));
      if (!idxRes.ok) throw new Error('could not read recipe index');
      const idx = await idxRes.json();
      const ids = Array.isArray(idx.content) ? idx.content : JSON.parse(idx.content);
      const next = ids.filter(x => x !== r.id);
      await bridgeSave('data/recipes/index.json', JSON.stringify(next, null, 2) + '\n',
        'Remove ' + r.id + ' from recipe index via site');
      // Remove from meta.json too (drives list/search/filter).
      try {
        const metaRes = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/recipes/meta.json'));
        if (metaRes.ok) {
          const metaJson = await metaRes.json();
          const meta = JSON.parse(metaJson.content);
          if (Array.isArray(meta)) {
            const nextMeta = meta.filter(m => m.id !== r.id);
            await bridgeSave('data/recipes/meta.json', JSON.stringify(nextMeta),
              'Remove ' + r.id + ' from meta via site');
          }
        }
      } catch (e) { console.warn('meta.json cleanup failed', e); }
      // Update local state so the list reflects the deletion immediately.
      delete byId[r.id];
      delete metaById[r.id];
      const ri = recipes.findIndex(m => m.id === r.id);
      if (ri >= 0) recipes.splice(ri, 1);
      // Log the deletion in Recent submissions.
      try {
        const entryId = 'delete-' + Date.now().toString(36);
        const entry = {
          id: entryId, type: 'delete', edit_target: r.id,
          text: null, url: null, image: null, note: 'Deleted via site: ' + r.title,
          status: 'done', created_at: new Date().toISOString(),
          recipe_id: null, fail_reason: null
        };
        await bridgeSave('data/inbox/' + entryId + '.json', JSON.stringify(entry, null, 2),
          'Delete log: ' + r.title);
        const inboxRes = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/inbox/index.json'));
        let inboxIdx = [];
        if (inboxRes.ok) {
          const inboxJson = await inboxRes.json();
          inboxIdx = JSON.parse(inboxJson.content);
        }
        inboxIdx.push({ id: entryId, status: 'done', type: 'delete',
          edit_target: r.id, created_at: entry.created_at });
        await bridgeSave('data/inbox/index.json', JSON.stringify(inboxIdx, null, 2),
          'Delete log index: ' + entryId);
      } catch (e) { console.warn('delete log failed', e); }
      location.hash = '#/recipes';
    } catch (e) {
      busy = false;
      err = 'Delete failed: ' + (e.message || e);
      draw();
    }
  };
  draw();
}

function renderEdit(app, id) {
  const r = byId[id];
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/recipes">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  editDraft = normalizeDraft(JSON.parse(JSON.stringify(r))); // working copy
  currentEditSha = null;
  // Fetch the live SHA for optimistic concurrency (409 on stale save).
  fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/recipes/' + id + '.json'))
    .then(res => res.ok ? res.json() : null)
    .then(data => { if (data && data.sha) currentEditSha = data.sha; })
    .catch(() => {});
  document.title = 'Edit: ' + r.title + ' — Reiss Family Recipes';
  app.innerHTML =
    '<a class="back-link no-print" href="#/recipe/' + encodeURIComponent(id) + '">← Back to recipe</a>' +
    '<h1 class="recipe-title">Edit recipe</h1>' +
    '<div class="field ai-edit-box" style="background:#f8f6f1;border:1px solid #e0d5c1;border-radius:12px;padding:1rem;margin-bottom:1.5rem">' +
      '<label for="ai-edit-request" style="font-weight:600;display:block;margin-bottom:.5rem">🤖 Describe changes in plain words</label>' +
      '<textarea id="ai-edit-request" rows="3" style="width:100%;box-sizing:border-box" ' +
        'placeholder="e.g. Double the servings, make it dairy, and use a better photo"></textarea>' +
      '<button class="btn" id="ai-edit-submit" type="button" style="margin-top:.5rem">Submit for AI edit</button>' +
      '<div class="form-hint">Takes up to 30 minutes — the checker processes it and updates the recipe. ' +
        'Shows in Recent submissions as an edit request.</div>' +
      '<div id="ai-edit-status" class="form-status"></div>' +
    '</div>' +
    recipeFormHTML(r, '#/recipe/' + encodeURIComponent(id));
  wireRecipeForm(() => saveRecipe(id));
  wireAiEdit(id);
}

async function wireAiEdit(recipeId) {
  const btn = $('#ai-edit-submit');
  if (!btn) return;
  btn.onclick = async () => {
    const text = $('#ai-edit-request').value.trim();
    const st = $('#ai-edit-status');
    if (!text) {
      st.className = 'form-status error';
      st.textContent = 'Describe the changes first.';
      return;
    }
    st.className = 'form-status';
    st.textContent = 'Submitting…';
    btn.disabled = true;
    try {
      const entryId = 'inbox-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const entry = {
        id: entryId,
        type: 'edit',
        edit_target: recipeId,
        text: text,
        url: null,
        image: null,
        note: null,
        status: 'pending',
        created_at: new Date().toISOString(),
        recipe_id: null,
        fail_reason: null
      };
      // Upload via the bridge (same as submissions)
      await ghPut('data/inbox/' + entryId + '.json', JSON.stringify(entry, null, 2),
        'Edit request: ' + recipeId);
      // Update the inbox index — include the request text inline so the
      // log can show it without fetching each entry file.
      const idxRes = await fetch('data/inbox/index.json?v=' + Date.now());
      let idx = idxRes.ok ? await idxRes.json() : [];
      idx.push({ id: entryId, status: 'pending', type: 'edit', edit_target: recipeId,
        created_at: entry.created_at, text: text.slice(0, 140) });
      await ghPut('data/inbox/index.json', JSON.stringify(idx, null, 2),
        'Edit request index: ' + entryId);
      st.className = 'form-status ok';
      st.textContent = 'Submitted — check Recent submissions for progress (up to 30 min).';
      $('#ai-edit-request').value = '';
    } catch (e) {
      st.className = 'form-status error';
      st.textContent = 'Could not submit: ' + (e.message || e);
    }
    btn.disabled = false;
  };
}

function renderAdd(app) {
  editDraft = blankRecipe();
  document.title = 'Add recipe — Reiss Family Recipes';
  app.innerHTML =
    '<a class="back-link no-print" href="#/recipes">← All recipes</a>' +
    '<h1 class="recipe-title">Add recipe</h1>' +
    recipeFormHTML(editDraft, '#/');
  wireRecipeForm(saveNewRecipe);
}

function wireRecipeForm(onSave) {
  drawVariantEditor();
  drawIngEditor();
  drawStepsEditor();
  drawPairEditor();
  const vAdd = $('#variant-add');
  if (vAdd) vAdd.onclick = () => {
    if (!Array.isArray(editDraft.variants)) editDraft.variants = [];
    editDraft.variants.push({ key: '', label: '', default: editDraft.variants.length === 0 });
    drawVariantEditor();
    drawIngEditor();
  };
  // Toggle kosher review notes visibility
  const krCb = $('#e-kosher-review'), krWrap = $('#e-kosher-notes-wrap');
  if (krCb && krWrap) krCb.addEventListener('change', () => {
    krWrap.style.display = krCb.checked ? '' : 'none';
  });
  $('#ing-add-sec').onclick = () => {
    editDraft.ingredients.push({ section: '', items: [{ qty: '', unit: '', item: '', prep: '' }] });
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
  d.needs_kosher_review = $('#e-kosher-review') ? $('#e-kosher-review').checked : false;
  d.kosher_review_notes = $('#e-kosher-notes') ? $('#e-kosher-notes').value.trim() : '';
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
  // Versions: keep only named ones, with exactly one default; drop
  // ingredient tags pointing at versions that no longer exist (an
  // untagged ingredient is shared by every version).
  const vars = (Array.isArray(d.variants) ? d.variants : [])
    .map(v => ({
      key: v.key || slugify(v.label || ''),
      label: (v.label || '').trim(),
      default: !!v.default
    }))
    .filter(v => v.label && v.key);
  if (vars.length) {
    let seenDefault = false;
    vars.forEach(v => {
      if (v.default && !seenDefault) seenDefault = true;
      else if (v.default) v.default = false;
    });
    if (!seenDefault) vars[0].default = true;
    d.variants = vars;
  } else {
    delete d.variants;
  }
  const varKeys = new Set(vars.map(v => v.key));
  d.ingredients.forEach(s => (s.items || []).forEach(it => {
    if (!it.variant || !varKeys.has(it.variant)) delete it.variant;
  }));
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
  const MAX = 2400;
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
  // A fresh user photo replaces any AI-generated placeholder — and flag the
  // replacement so saveRecipe can log it even though the banner_image path
  // itself doesn't change (same filename).
  d.photo_generated = false;
  d._photoReplaced = true;
}

/* Version list editor (Commit 2B): names + which is default. Keys are
   slugs derived from labels; renaming a version remaps its ingredient
   tags, removing one untags its ingredients (they become shared). */
function drawVariantEditor() {
  const host = $('#variant-editor');
  if (!host || !editDraft) return;
  if (!Array.isArray(editDraft.variants)) editDraft.variants = [];
  const vars = editDraft.variants;
  host.innerHTML = vars.length ? vars.map((v, vi) =>
    '<div class="mini-row variant-row">' +
      '<input type="text" data-variant-label="' + vi + '" value="' + esc(v.label || '') + '" ' +
        'placeholder="Version name (e.g. Chicken)" aria-label="Version name">' +
      '<label class="variant-default"><input type="radio" name="variant-default" ' +
        'data-variant-default="' + vi + '"' + (v.default ? ' checked' : '') + '> Default</label>' +
      '<button class="link-btn danger" data-variant-del="' + vi + '" type="button">✕</button>' +
    '</div>').join('')
    : '<div class="form-hint">No versions — this dish has one way of making it.</div>';
  host.querySelectorAll('[data-variant-label]').forEach(el =>
    el.addEventListener('input', e => {
      const vi = +e.target.dataset.variantLabel;
      const v = editDraft.variants[vi];
      if (!v) return;
      const oldKey = v.key;
      v.label = e.target.value;
      v.key = uniqueVariantKey(editDraft.variants, e.target.value, vi);
      if (oldKey && oldKey !== v.key) {
        (editDraft.ingredients || []).forEach(s => (s.items || []).forEach(it => {
          if (it.variant === oldKey) it.variant = v.key;
        }));
        drawIngEditor();
      }
    }));
  host.querySelectorAll('[data-variant-default]').forEach(el =>
    el.addEventListener('change', e => {
      const vi = +e.target.dataset.variantDefault;
      editDraft.variants.forEach((v, i) => { v.default = i === vi; });
    }));
  host.querySelectorAll('[data-variant-del]').forEach(el =>
    el.addEventListener('click', e => {
      const removed = editDraft.variants.splice(+e.target.dataset.variantDel, 1)[0];
      if (removed && removed.key) {
        (editDraft.ingredients || []).forEach(s => (s.items || []).forEach(it => {
          if (it.variant === removed.key) delete it.variant;
        }));
      }
      if (editDraft.variants.length && !editDraft.variants.some(v => v.default)) {
        editDraft.variants[0].default = true;
      }
      drawVariantEditor();
      drawIngEditor();
    }));
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
      '<div class="mini-row ing-header">' +
        '<span class="qty">Qty</span><span class="unit">Unit</span>' +
        '<span class="ing-name">Ingredient</span><span class="prep">Prep</span><span class="ing-opt">Opt?</span><span class="ing-ver">Version</span><span class="ing-x"></span>' +
      '</div>' +
      (s.items || []).map((it, ii) =>
        '<div class="mini-row">' +
          '<input class="qty" type="text" data-item="' + si + '|' + ii + '|qty" value="' + esc(it.qty || '') + '" placeholder="Qty" aria-label="Quantity">' +
          '<input class="unit" type="text" data-item="' + si + '|' + ii + '|unit" value="' + esc(it.unit || '') + '" placeholder="Unit" aria-label="Unit">' +
          '<input type="text" data-item="' + si + '|' + ii + '|item" value="' + esc(it.item || '') + '" placeholder="Ingredient" aria-label="Ingredient">' +
          '<input type="text" data-item="' + si + '|' + ii + '|prep" value="' + esc(it.prep || '') + '" placeholder="Prep (sliced, diced…)" aria-label="Prep">' +
          '<input class="ing-opt-check" type="checkbox" data-item="' + si + '|' + ii + '|optional"' + (it.optional ? ' checked' : '') + ' aria-label="Optional" title="Optional">' +
          '<select class="ing-variant" data-itemvariant="' + si + '|' + ii + '" aria-label="Version" title="Version">' +
            '<option value="">Shared</option>' +
            (editDraft.variants || []).filter(v => v.key).map(v =>
              '<option value="' + esc(v.key) + '"' + (it.variant === v.key ? ' selected' : '') + '>' +
              esc(v.label) + '</option>').join('') +
          '</select>' +
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
      const item = editDraft.ingredients[+si].items[+ii];
      // Checkbox (optional) stores a boolean; text inputs store the string.
      item[f] = (f === 'optional') ? !!e.target.checked : e.target.value;
      // Auto-split prep on comma: "tomatoes, sliced" → item "tomatoes" + prep "sliced".
      // Only when typing in the item field and prep is empty (don't clobber manual edits).
      if (f === 'item' && !item.prep && e.target.value.includes(',')) {
        const parts = e.target.value.split(',');
        const newItem = parts[0].trim();
        const newPrep = parts.slice(1).join(',').trim();
        if (newItem && newPrep) {
          item.item = newItem;
          item.prep = newPrep;
          e.target.value = newItem;
          // Update the prep field in the DOM without full re-render
          const prepEl = host.querySelector('[data-item="' + si + '|' + ii + '|prep"]');
          if (prepEl) prepEl.value = newPrep;
        }
      }
    }));
  host.querySelectorAll('[data-itemvariant]').forEach(el =>
    el.addEventListener('change', e => {
      const [si, ii] = e.target.dataset.itemvariant.split('|').map(Number);
      const item = editDraft.ingredients[si].items[ii];
      if (!item) return;
      if (e.target.value) item.variant = e.target.value;
      else delete item.variant;   // Shared = no variant key stored
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
      editDraft.ingredients[+e.target.dataset.itemadd].items.push({ qty: '', unit: '', item: '', prep: '' });
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
  host.innerHTML = editDraft.pairings.map((p, i) => {
    const selTitle = p.recipe_id && recipeMeta(p.recipe_id) ? recipeMeta(p.recipe_id).title : '';
    return '<div class="dynamic-block"><div class="mini-row" style="position:relative">' +
      '<input type="text" data-pairsearch="' + i + '" value="' + esc(selTitle) + '" ' +
        'placeholder="Type to search recipes…" aria-label="Paired recipe" autocomplete="off">' +
      '<input type="hidden" data-pair="' + i + '|recipe_id" value="' + esc(p.recipe_id || '') + '">' +
      '<div class="pair-results" data-pairresults="' + i + '" style="display:none;position:absolute;top:100%;left:0;right:0;' +
        'background:#fff;border:1px solid #ccc;border-radius:8px;max-height:200px;overflow-y:auto;z-index:50"></div>' +
      '<button class="link-btn danger" data-pairdel="' + i + '" type="button">✕</button>' +
    '</div><div class="mini-row">' +
      '<input type="text" data-pair="' + i + '|note" value="' + esc(p.note || '') + '" placeholder="Note (e.g. perfect with…)" aria-label="Pairing note">' +
    '</div></div>';
  }).join('');
  // Searchable pairing picker
  host.querySelectorAll('[data-pairsearch]').forEach(el => {
    const i = +el.dataset.pairsearch;
    const resultsEl = host.querySelector('[data-pairresults="' + i + '"]');
    const hiddenEl = host.querySelector('[data-pair="' + i + '|recipe_id"]');
    const showResults = (q) => {
      const query = (q || '').toLowerCase().trim();
      const matches = recipes.filter(r =>
        !query || r.title.toLowerCase().includes(query)).slice(0, 20);
      if (!matches.length) {
        resultsEl.style.display = 'none';
        return;
      }
      resultsEl.innerHTML = matches.map(r =>
        '<div data-pick="' + i + '|' + esc(r.id) + '" style="padding:.5rem;cursor:pointer;border-bottom:1px solid #eee">' +
        esc(r.title) + '</div>').join('');
      resultsEl.style.display = 'block';
      resultsEl.querySelectorAll('[data-pick]').forEach(opt =>
        opt.addEventListener('click', () => {
          const [pi, rid] = opt.dataset.pick.split('|');
          editDraft.pairings[+pi].recipe_id = rid;
          hiddenEl.value = rid;
          el.value = recipeMeta(rid) ? recipeMeta(rid).title : '';
          resultsEl.style.display = 'none';
        }));
    };
    el.addEventListener('input', () => {
      // Clear the selection when the user types something new
      if (hiddenEl.value && el.value !== ((recipeMeta(hiddenEl.value) || {}).title)) {
        hiddenEl.value = '';
        editDraft.pairings[i].recipe_id = '';
      }
      showResults(el.value);
    });
    el.addEventListener('focus', () => showResults(el.value));
    el.addEventListener('blur', () => setTimeout(() => { resultsEl.style.display = 'none'; }, 200));
  });
  host.querySelectorAll('[data-pair]').forEach(el => {
    if (el.type === 'hidden') return; // handled by the picker
    el.addEventListener('input', e => {
      const [i, f] = e.target.dataset.pair.split('|');
      editDraft.pairings[+i][f] = e.target.value;
    });
  });
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
  // Flag for PDF re-press — the intake checker picks this up and runs Recipe Press.
  d.pdf_stale = true;
  st.className = 'form-status';
  st.textContent = 'Saving…';
  try {
    // Resolve the editor name FIRST, synchronously inside the tap handler:
    // window.prompt() called after an await (e.g. the photo upload) is
    // silently swallowed by mobile browsers and returns null.
    const editorName = getEditorName();
    await maybeUploadPhoto(d);
    // Save via the worker-side history endpoint (server diffs + appends history).
    const actor = 'site-editor (' + editorName + ')';
    const reasoningEl = $('#edit-reasoning');
    let reasoning = reasoningEl ? (reasoningEl.value.trim() || null) : null;
    // Photo-only edit: the banner path doesn't change, so give the save a
    // reasoning so the auto-log records it (and drop the temp flag so it
    // never lands in the recipe JSON).
    if (d._photoReplaced) {
      delete d._photoReplaced;
      if (!reasoning) reasoning = 'Replaced photo';
    }
    let saveResult;
    try {
      saveResult = await bridgeSaveRecipe('data/recipes/' + id + '.json', d, actor, reasoning, currentEditSha, 'edit');
    } catch (e) {
      if (e.code === 409) {
        st.className = 'form-status error';
        st.textContent = 'This recipe was changed by someone else since you opened it. Reload the page to see the latest, then re-apply your changes.';
        return;
      }
      throw e;
    }
    // Update our SHA and history from the worker's response.
    if (saveResult.sha) currentEditSha = saveResult.sha;
    if (saveResult.history) d.history = saveResult.history;
    // Update metadata for lazy loading (list/search/filter).
    const metaEntry = {
      id: d.id, title: d.title, banner_image: d.banner_image,
      kosher_status: d.kosher_status, kosher_for_passover: !!d.kosher_for_passover,
      categories: d.categories || [], tags: d.tags || [],
      prep_minutes: d.prep_minutes, cook_minutes: d.cook_minutes, servings: d.servings,
      leftover_friendly: !!d.leftover_friendly, tags_need_review: !!d.tags_need_review,
      photo_generated: !!d.photo_generated,
      search_text: ((d.ingredients || []).flatMap(s => (s.items || []).map(i => i.item || '')).join(' ') + ' ' + (d.notes || '')).trim(),
    };
    const updateMeta = async () => {
      const meta = JSON.parse((await ghGet('data/recipes/meta.json')).text);
      const mi = meta.findIndex(x => x.id === id);
      if (mi >= 0) meta[mi] = metaEntry; else meta.push(metaEntry);
      await ghPut('data/recipes/meta.json', JSON.stringify(meta), 'Update meta: ' + d.title);
    };
    try {
      await updateMeta();
    } catch (e) {
      console.warn('meta.json first attempt failed, retrying once...', e);
      try {
        await new Promise(r => setTimeout(r, 800));
        await updateMeta();
      } catch (e2) {
        console.error('meta.json update failed', e2);
        toast('Recipe saved, but card index failed to sync — please click Save again.');
      }
    }
    const i = recipes.findIndex(x => x.id === id);
    if (i >= 0) recipes[i] = metaEntry;
    metaById[id] = metaEntry;
    byId[id] = d;
    // The worker auto-logs this edit to Recent submissions (no separate
    // inbox write needed here — handleSaveRecipe logs every edit itself).
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
  // Flag for PDF generation — the intake checker picks this up and runs Recipe Press.
  d.pdf_stale = true;
  st.className = 'form-status';
  st.textContent = 'Saving…';
  try {
    // Editor name first, inside the tap (see saveRecipe — prompt() after
    // an await gets swallowed by mobile browsers).
    const editorName = getEditorName();
    await maybeUploadPhoto(d);
    // Save via the worker-side history endpoint (initializes history with creation entry).
    const actor = 'site-editor (' + editorName + ')';
    const reasoningEl = $('#edit-reasoning');
    const reasoning = reasoningEl ? (reasoningEl.value.trim() || null) : null;
    delete d._photoReplaced; // temp flag from maybeUploadPhoto — never persisted
    const saveResult = await bridgeSaveRecipe('data/recipes/' + id + '.json', d, actor, reasoning, null, 'intake');
    if (saveResult.history) d.history = saveResult.history;
    const idx = JSON.parse((await ghGet('data/recipes/index.json')).text);
    idx.push(id);
    await ghPut('data/recipes/index.json', JSON.stringify(idx), 'Add to index: ' + d.title);
    // Update meta.json for lazy loading (list/search/filter use metadata only).
    const metaEntry = {
      id: d.id, title: d.title, banner_image: d.banner_image,
      kosher_status: d.kosher_status, kosher_for_passover: !!d.kosher_for_passover,
      categories: d.categories || [], tags: d.tags || [],
      prep_minutes: d.prep_minutes, cook_minutes: d.cook_minutes, servings: d.servings,
      leftover_friendly: !!d.leftover_friendly, tags_need_review: !!d.tags_need_review,
      photo_generated: !!d.photo_generated,
      search_text: ((d.ingredients || []).flatMap(s => (s.items || []).map(i => i.item || '')).join(' ') + ' ' + (d.notes || '')).trim(),
    };
    const updateMeta = async () => {
      const meta = JSON.parse((await ghGet('data/recipes/meta.json')).text);
      const mi = meta.findIndex(x => x.id === d.id);
      if (mi >= 0) meta[mi] = metaEntry; else meta.push(metaEntry);
      await ghPut('data/recipes/meta.json', JSON.stringify(meta), 'Add to meta: ' + d.title);
    };
    try {
      await updateMeta();
    } catch (e) {
      console.warn('meta.json first attempt failed, retrying once...', e);
      try {
        await new Promise(r => setTimeout(r, 800));
        await updateMeta();
      } catch (e2) {
        console.error('meta.json update failed', e2);
        toast('Recipe saved, but card index failed to sync — please click Save again.');
      }
    }
    recipes.push(metaEntry);
    metaById[id] = metaEntry;
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
  const s = normalizeSlot(slot);
  const week = (mealPlan.weeks || {})[key] || {};
  const lunchWarn = (meal === 'lunch' && Array.isArray(week.lunchWarnings))
    ? week.lunchWarnings.find(w => w.day === di) : null;
  let body;
  if (editingSlot && editingSlot.key === key && editingSlot.di === di && editingSlot.meal === meal) {
    body = slotEditorHTML(s, editingSlot.dishIdx);
  } else if (s.skipped) {
    body = '<span class="slot-skipped">Skipped</span>' +
      (s.note ? ' <span class="slot-note">— ' + esc(s.note) + '</span>' : '');
  } else if (s.dishes.length) {
    body = s.dishes.map((dish, idx) => {
      let dishBody;
      const meta = dish.recipe ? recipeMeta(dish.recipe) : null;
      if (meta) {
        const title = meta.title + (dish.variant ? ' · ' + variantLabelFor(dish.recipe, dish.variant) : '');
        dishBody = '<a href="#/recipe/' + encodeURIComponent(meta.id) + '">' + esc(title) + '</a>';
      } else if (dish.custom) {
        dishBody = '<span class="slot-custom">' + esc(dish.custom) + '</span>';
      } else {
        dishBody = '<span class="slot-skipped">—</span>';
      }
      if (dish.leftovers) dishBody += ' <span class="badge leftovers">Leftovers</span>';
      if (dish.coverage != null) {
        const need = lunchWarn && lunchWarn.kind === 'partial' ? lunchWarn.need : (di === 5 ? 1 : 2);
        dishBody += ' <span class="badge warn">Only ' + esc(dish.coverage) + ' of ' + need + ' servings</span>';
      }
      if (dish.scale && dish.scale !== 1) {
        dishBody += ' <span class="badge neutral">' + esc(dish.scale) + '×</span>';
      }
      if (dish.cookDate) dishBody += ' <span class="slot-note">(cook ' + esc(dish.cookDate) + ')</span>';
      if (dish.locked) dishBody += ' <span class="dish-lock" title="Locked — Draft Week won\u2019t change it">🔒</span>';
      const at = key + '|' + di + '|' + meal + '|' + idx;
      const editBtn = canEdit
        ? ' <button class="link-btn" data-dishedit="' + at + '" type="button">Edit</button>'
        : '';
      const swapBtn = (canEdit && dish.drafted && dish.recipe && !dish.locked && !dish.leftovers)
        ? ' <button class="link-btn" data-dishswap="' + at + '" type="button" title="Swap for a similar dish">↻ Swap</button>'
        : '';
      const lockBtn = (canEdit && dish.drafted)
        ? ' <button class="link-btn" data-dishlock="' + at + '" type="button">' +
          (dish.locked ? '🔓 Unlock' : '🔒 Lock') + '</button>'
        : '';
      let row = '<div class="dish-row">' + dishBody + editBtn + swapBtn + lockBtn + '</div>';
      if (dish.reason) row += '<div class="dish-reason">' + esc(dish.reason) + '</div>';
      row += feedbackRowHTML(key, di, meal, idx, dish, week);
      return row;
    }).join('');
    if (s.note) body += ' <span class="slot-note">— ' + esc(s.note) + '</span>';
  } else {
    body = '<span class="slot-skipped">—</span>';
    if (lunchWarn && lunchWarn.kind === 'uncovered') {
      body += ' <span class="badge warn">Not covered</span>';
    }
  }
  const btns = canEdit
    ? '<div class="slot-actions"><button class="link-btn" data-slotadd="' + key + '|' + di + '|' + meal + '" type="button">' +
      (s.dishes.length ? '+ Add dish' : 'Add') + '</button>' +
      ((s.dishes.length || s.note) ? '<button class="link-btn danger" data-clear="' + key + '|' + di + '|' + meal +
        '" type="button">Clear</button>' : '') + '</div>'
    : '';
  return '<div class="slot"><div class="slot-label">' + label + '</div>' +
         '<div class="slot-body">' + body + btns + '</div></div>';
}

function slotEditorHTML(slot, dishIdx) {
  const s = normalizeSlot(slot);
  const dish = (dishIdx !== undefined && s.dishes[dishIdx]) ? s.dishes[dishIdx] : {};
  const currentLabel = (dish.recipe && recipeMeta(dish.recipe)) ? recipeMeta(dish.recipe).title
    : (dish.custom || '');
  const currentRid = (dish.recipe && recipeMeta(dish.recipe)) ? dish.recipe : '';
  // Version pills for the dish being edited (rendered for the recipe it
  // currently names; picking a different recipe re-opens the editor).
  const evars = dish.recipe ? recipeVariantsFor(dish.recipe) : [];
  const selVariant = dish.variant ||
    (evars.length ? (evars.find(v => v.isDefault) || evars[0]).key : null);
  const variantRow = evars.length
    ? '<div class="se-variant"><span class="se-variant-label">Version:</span>' +
      evars.map(v => '<button type="button" class="variant-pill' +
        (v.key === selVariant ? ' active' : '') + '" data-sevariant="' + esc(v.key) + '">' +
        esc(v.label) + '</button>').join('') + '</div>'
    : '';
  // A manual save marks the dish manual (drafted:false) and, per the
  // spec invariant, locked — the checkbox starts there for drafted and
  // brand-new dishes; an existing manual dish keeps its own state.
  const lockChecked = dish.drafted ? true
    : (dish.locked !== undefined ? !!dish.locked : true);
  return '<div class="slot-editor">' +
    '<div class="combo-wrap">' +
      '<input type="text" id="se-meal" placeholder="Type a recipe or your own dish…" autocomplete="off" ' +
      'value="' + esc(currentLabel) + '" data-rid="' + esc(currentRid) + '" aria-label="Dish">' +
      '<div class="combo-list" id="se-suggest" hidden></div>' +
    '</div>' +
    '<div class="slot-note">Pick a recipe from the list, or just type your own — it saves as-is.</div>' +
    '<label><input type="checkbox" id="se-leftovers"' + (dish.leftovers ? ' checked' : '') + '> Leftovers / already made (excludes from shopping list)</label><br>' +
    '<label><input type="checkbox" id="se-advance"' + (dish.cookDate ? ' checked' : '') + '> Prepare in advance</label> ' +
    '<input type="date" id="se-cookdate" value="' + esc(dish.cookDate || '') + '"' +
      (dish.cookDate ? '' : ' style="display:none"') + ' aria-label="Cook date"><br>' +
    '<label>Scale <select id="se-scale" aria-label="Scale">' +
      [0.5, 1, 1.5, 2, 3].map(v => '<option value="' + v + '"' +
        ((dish.scale || 1) === v ? ' selected' : '') + '>' + v + '×</option>').join('') +
    '</select></label><br>' +
    variantRow +
    '<label><input type="checkbox" id="se-locked"' + (lockChecked ? ' checked' : '') +
      '> Locked — Draft Week won\u2019t change this dish</label><br>' +
    '<label><input type="checkbox" id="se-skipped"' + (s.skipped ? ' checked' : '') + '> Skipped</label> ' +
    '<input type="text" id="se-note" placeholder="Note (optional)" value="' + esc(s.note || '') + '">' +
    '<div><button class="btn" id="se-save" type="button">Save</button> ' +
    '<button class="btn secondary" id="se-cancel" type="button">Cancel</button></div>' +
    '<div class="form-status" id="se-status"></div></div>';
}

/* Searchable combobox for the meal slot: filters recipes as you type,
   or keeps free text as a custom entry. */
function wireCombo(input) {
  const list = $('#se-suggest');
  if (!list) return;
  const lastCookedMap = computeLastCooked().byRecipe;
  const todayStr = ymd(new Date());
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const matches = recipes
      .filter(r => !q || r.title.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { list.hidden = true; list.innerHTML = ''; return; }
    list.innerHTML = matches.map(r => {
      const hint = lastCookedMap[r.id] ? lastMadeText(lastCookedMap[r.id], todayStr) : '';
      return '<button type="button" class="combo-item" data-rid="' + esc(r.id) + '">' +
        esc(r.title) +
        (hint ? '<span class="combo-hint">' + esc(hint) + '</span>' : '') + '</button>';
    }).join('');
    list.hidden = false;
  };
  input.addEventListener('input', () => { input.dataset.rid = ''; draw(); });
  input.addEventListener('focus', draw);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  list.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-rid]');
    if (!b) return;
    e.preventDefault();
    // The button may carry a "last made" hint span — use the recipe's
    // own title, not the button's full text.
    const rec = recipeMeta(b.dataset.rid);
    input.value = rec ? rec.title : b.textContent;
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
  seedDraftChips(key, week);
  const chips = normalizeDraftChips(week.draftChips);
  const canEdit = editingEnabled();
  const label = plannerOffset === 0 ? 'This week' : 'Week of ' + prettyDate(mon);
  const dayLetters = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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
    // Draft Week chip bar: its own row, well away from the per-slot
    // Clear buttons down in the day cards (Yidi's UI rule).
    '<div class="draft-bar no-print">' +
      '<div class="chip-row">' +
        '<span class="chip-group-label">Hosting:</span>' +
        '<label class="chip-check"><input type="checkbox" id="draft-hosting-fri"' +
          (chips.hostingFri ? ' checked' : '') + '> Friday</label>' +
        '<label class="chip-check"><input type="checkbox" id="draft-hosting-sat"' +
          (chips.hostingSat ? ' checked' : '') + '> Saturday</label>' +
      '</div>' +
      '<div class="chip-row">' +
        '<span class="chip-group-label">Eating out / skip dinner:</span>' +
        dayLetters.map((L, i) =>
          '<button type="button" class="day-chip' + (chips.eatOut.includes(i) ? ' active' : '') +
          '" data-eatout="' + i + '" title="' + PLAN_DAY_NAMES[i] + '"' +
          (i === 4 ? ' aria-label="Thursday — pizza night, always kept"' : '') + '>' + L + '</button>'
        ).join('') +
      '</div>' +
      '<div class="chip-row">' +
        '<span class="chip-group-label">Use up:</span>' +
        '<span id="draft-useup-chips"></span>' +
        '<input type="text" id="draft-useup-input" placeholder="Ingredient to use up" aria-label="Ingredient to use up">' +
        '<button class="link-btn" id="draft-useup-add" type="button">Add</button>' +
      '</div>' +
      '<div class="draft-actions">' +
        '<a class="link-btn" href="#/planner/tune">Tune rotation</a>' +
        '<button class="btn" id="draft-week-btn" type="button">Draft Week ✨</button>' +
      '</div>' +
    '</div>' +
    planWarningsHTML(key, week) +
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

  // --- Draft Week chip bar wiring ---
  app.querySelectorAll('[data-eatout]').forEach(b =>
    b.addEventListener('click', () => b.classList.toggle('active')));
  renderUseUpChips();
  const useUpHost = $('#draft-useup-chips');
  if (useUpHost) useUpHost.addEventListener('click', e => {
    const del = e.target.closest('[data-useup-del]');
    if (!del) return;
    draftUseUp.splice(+del.dataset.useupDel, 1);
    renderUseUpChips();
  });
  const addUseUp = () => {
    const inp = $('#draft-useup-input');
    const v = inp ? inp.value.trim() : '';
    if (!v) return;
    if (draftUseUp.length >= 5) { toast('Up to 5 use-up items.'); return; }
    draftUseUp.push(v);
    inp.value = '';
    renderUseUpChips();
    inp.focus();
  };
  const useUpAdd = $('#draft-useup-add');
  if (useUpAdd) useUpAdd.addEventListener('click', addUseUp);
  const useUpInput = $('#draft-useup-input');
  if (useUpInput) useUpInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addUseUp(); }
  });
  const draftBtn = $('#draft-week-btn');
  if (draftBtn) draftBtn.addEventListener('click', () => runDraftWeek(key, app));
  const dismissBtn = app.querySelector('[data-dismiss-warnings]');
  if (dismissBtn) dismissBtn.addEventListener('click', () => {
    const wk = getWeek(key);
    wk.dismissedWarnings = (Array.isArray(wk.lunchWarnings) ? wk.lunchWarnings : []).map(warningSignature);
    persistWeek(key, null, () => renderPlanner(app));
  });

  $('#days').addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'se-save') return saveSlot(key);
    if (t.id === 'se-cancel') { editingSlot = null; return renderPlanner(app); }
    if (t.dataset.slotadd) {
      const [k, di, meal] = t.dataset.slotadd.split('|');
      editingSlot = { key: k, di: +di, meal, dishIdx: -1 }; // -1 = new dish
      return renderPlanner(app);
    }
    if (t.dataset.dishedit) {
      const [k, di, meal, idx] = t.dataset.dishedit.split('|');
      editingSlot = { key: k, di: +di, meal, dishIdx: +idx };
      return renderPlanner(app);
    }
    if (t.dataset.dishswap) {
      const [k, di, meal, idx] = t.dataset.dishswap.split('|');
      applySwap(k, +di, meal, +idx)
        .then(d => {
          if (!d) toast('No swap options for this dish.');
          renderPlanner(app);
        })
        .catch(err => { toast('Swap failed: ' + err.message); renderPlanner(app); });
      return;
    }
    if (t.dataset.dishlock) {
      const [k, di, meal, idx] = t.dataset.dishlock.split('|');
      const s = planSlot(getWeek(k), +di, meal);
      const dish = s.dishes[+idx];
      if (!dish) return;
      dish.locked = !dish.locked;
      persistPlannedWeek(k, 'Lock dish: ' + k)
        .then(() => renderPlanner(app))
        .catch(err => { toast('Couldn\u2019t save: ' + err.message); renderPlanner(app); });
      return;
    }
    if (t.dataset.fbrate) {
      const [k, di, meal, idx, rating] = t.dataset.fbrate.split('|');
      recordMealFeedback(k, +di, meal, +idx, { rating })
        .then(() => renderPlanner(app))
        .catch(err => { toast('Couldn\u2019t save rating: ' + err.message); renderPlanner(app); });
      return;
    }
    if (t.dataset.fbleft) {
      const [k, di, meal, idx, left] = t.dataset.fbleft.split('|');
      recordMealFeedback(k, +di, meal, +idx, { left })
        .then(() => renderPlanner(app))
        .catch(err => { toast('Couldn\u2019t save feedback: ' + err.message); renderPlanner(app); });
      return;
    }
    if (t.dataset.fbdismiss) {
      const [k, di, meal, idx] = t.dataset.fbdismiss.split('|');
      recordMealFeedback(k, +di, meal, +idx, { dismiss: true })
        .then(() => renderPlanner(app))
        .catch(err => { toast('Couldn\u2019t save feedback: ' + err.message); renderPlanner(app); });
      return;
    }
    if (t.dataset.clear) {
      const [k, di, meal] = t.dataset.clear.split('|');
      getWeek(k).days[+di][meal] = blankSlot();
      recomputeWeekLunches(k);   // clearing a dinner can uncover lunches
      return persistWeek(k, null, () => renderPlanner(app));
    }
  });

  const mealInput = $('#se-meal');
  if (mealInput) {
    wireCombo(mealInput);
    // Prepare in advance toggle shows/hides the date picker
    const advToggle = $('#se-advance');
    const cookDate = $('#se-cookdate');
    if (advToggle && cookDate) {
      advToggle.addEventListener('change', () => {
        cookDate.style.display = advToggle.checked ? '' : 'none';
        if (!advToggle.checked) cookDate.value = '';
      });
    }
    // Version pills: single-select, read back by saveSlot.
    app.querySelectorAll('[data-sevariant]').forEach(b =>
      b.addEventListener('click', () => {
        app.querySelectorAll('[data-sevariant]').forEach(x =>
          x.classList.toggle('active', x === b));
      }));
  }
}

function saveSlot(key) {
  const st = $('#se-status');
  const slot = normalizeSlot(getWeek(key).days[editingSlot.di][editingSlot.meal]);
  const mealInput = $('#se-meal');
  const rid = mealInput ? mealInput.dataset.rid : '';
  const text = mealInput ? mealInput.value.trim() : '';
  const dish = {};
  if (rid && recipeMeta(rid)) {
    dish.recipe = rid;
  } else if (text) {
    dish.custom = text;
  }
  dish.leftovers = $('#se-leftovers').checked;
  const advChecked = $('#se-advance').checked;
  dish.cookDate = advChecked ? ($('#se-cookdate').value || null) : null;
  // Manual-planning fields (Commit 2B): scale is set ONLY here, in the
  // slot editor — the generator never writes it. Variant comes from
  // the editor's version pills. A manual save marks the dish manual:
  // drafted:false, reason:null, and locked per the Locked checkbox.
  if (dish.recipe) {
    const scaleSel = $('#se-scale');
    const scaleVal = scaleSel ? parseFloat(scaleSel.value) : 1;
    if (scaleVal && scaleVal !== 1) dish.scale = scaleVal;
    const evars = recipeVariantsFor(dish.recipe);
    if (evars.length) {
      const activePill = document.querySelector('[data-sevariant].active');
      dish.variant = activePill ? activePill.dataset.sevariant
        : (evars.find(v => v.isDefault) || evars[0]).key;
    }
  }
  dish.drafted = false;
  dish.reason = null;
  const lockBox = $('#se-locked');
  dish.locked = lockBox ? lockBox.checked : true;

  const idx = editingSlot.dishIdx;
  if (idx === -1) {
    // New dish — only add if there's content
    if (dish.recipe || dish.custom) slot.dishes.push(dish);
  } else if (slot.dishes[idx]) {
    if (dish.recipe || dish.custom) {
      slot.dishes[idx] = dish;
    } else {
      slot.dishes.splice(idx, 1); // removed
    }
  }
  slot.skipped = $('#se-skipped').checked;
  slot.note = $('#se-note').value.trim();
  getWeek(key).days[editingSlot.di][editingSlot.meal] = slot;
  recomputeWeekLunches(key);   // dinner/scale changes move lunch coverage
  persistWeek(key, st, () => { editingSlot = null; renderPlanner($('#app')); });
}

/* ---------------- Meal plan sync: one serialized writer ----------------
   Every write to data/meal-plan.json goes through saveMealPlan(): saves are
   queued on a promise chain so rapid taps can't race, each attempt re-reads
   the fresh server copy via the bridge (never the Pages CDN), merges it with
   local state via mergeMealPlan(), applies the caller's mutator LAST, and
   writes the result. Retries (at most 3 attempts, 400ms apart) happen only on
   failure; a successful save is NOT verified with a re-read — the GitHub
   Contents API is synchronous, so a SHA race surfaces as a failed write and
   takes the retry path. */

// Read the meal plan straight from the bridge /read endpoint (the same fetch
// pattern fetchLiveMealPlan/pollShopServer use). Throws on any failure: a
// save must never merge against a stale or empty copy.
async function bridgeReadMealPlan() {
  const r = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/meal-plan.json'));
  if (!r.ok) throw new Error('meal-plan read failed (HTTP ' + r.status + ')');
  const data = await r.json();
  if (!data.ok || !data.content) throw new Error('meal-plan read failed (no content)');
  const mp = JSON.parse(data.content);
  if (!mp || typeof mp.weeks !== 'object') throw new Error('meal-plan read failed (bad shape)');
  return mp;
}

/* Merge a fresh (server) meal plan with the local one. Fresh is the base:
   for every shared week, fresh's days/shoppingDay/dismissedWarnings win and
   ONLY the 4 shopping keys merge in from local (via mergeWeekState) — a
   stale tab can never resurrect its days over the fresh copy. Weeks that
   exist only locally (created offline, never saved) are kept untouched.
   Top-level keys: recipePrefs merge per recipe id (latest updatedAt wins),
   yieldLog unions by entry id (latest 200 by date), framework goes to the
   copy with the latest updatedAt. */
function mergeMealPlan(fresh, local) {
  const f = (fresh && typeof fresh === 'object') ? fresh : {};
  const l = (local && typeof local === 'object') ? local : {};
  const merged = { ...f };
  const fWeeks = (f.weeks && typeof f.weeks === 'object') ? f.weeks : {};
  const lWeeks = (l.weeks && typeof l.weeks === 'object') ? l.weeks : {};
  merged.weeks = {};
  Object.keys(fWeeks).forEach(k => {
    const fw = fWeeks[k];
    const lw = lWeeks[k];
    if (lw && fw && typeof fw === 'object' && typeof lw === 'object') {
      const w = { ...fw };
      mergeWeekState(w, lw);   // merges ONLY the 4 shopping keys from local
      merged.weeks[k] = w;
    } else {
      merged.weeks[k] = fw;
    }
  });
  Object.keys(lWeeks).forEach(k => {
    if (!(k in merged.weeks)) merged.weeks[k] = lWeeks[k];   // local-only week: keep
  });
  // recipePrefs: per recipe id, latest updatedAt wins (tie -> fresh).
  if (f.recipePrefs || l.recipePrefs) {
    const fp = f.recipePrefs || {}, lp = l.recipePrefs || {};
    const prefs = {};
    Object.keys(fp).forEach(id => { prefs[id] = fp[id]; });
    Object.keys(lp).forEach(id => {
      const cur = prefs[id];
      if (!cur || ((lp[id] && lp[id].updatedAt) || 0) > ((cur && cur.updatedAt) || 0)) {
        prefs[id] = lp[id];
      }
    });
    merged.recipePrefs = prefs;
  }
  // yieldLog: union by entry id, keep the latest 200 (by date, then id).
  if (Array.isArray(f.yieldLog) || Array.isArray(l.yieldLog)) {
    const byEntryId = new Map();
    [...(Array.isArray(f.yieldLog) ? f.yieldLog : []),
     ...(Array.isArray(l.yieldLog) ? l.yieldLog : [])].forEach(e => {
      if (!e || typeof e !== 'object') return;
      byEntryId.set(e.id || JSON.stringify(e), e);
    });
    merged.yieldLog = [...byEntryId.values()].sort((a, b) => {
      const da = String(a.date || ''), db = String(b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      const ia = String(a.id || ''), ib = String(b.id || '');
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    }).slice(-200);
  }
  // framework: latest updatedAt wins (tie -> fresh).
  if (f.framework || l.framework) {
    const fu = (f.framework && f.framework.updatedAt) || 0;
    const lu = (l.framework && l.framework.updatedAt) || 0;
    merged.framework = lu > fu ? l.framework : (f.framework || l.framework);
  }
  return merged;
}

let _savePlanChain = Promise.resolve();
let _savePlanInFlight = 0;
function saveMealPlan(mutator, message) {
  _savePlanInFlight++;
  const run = async () => {
    try { return await attemptSaveMealPlan(mutator, message); }
    finally { _savePlanInFlight--; }
  };
  // Run on both settle paths so one failed save cannot poison the queue.
  _savePlanChain = _savePlanChain.then(run, run);
  return _savePlanChain;
}

async function attemptSaveMealPlan(mutator, message) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fresh = await bridgeReadMealPlan();   // never the Pages CDN
      const merged = mergeMealPlan(fresh, mealPlan);
      if (mutator) mutator(merged);               // caller's change, applied last
      await ghPut('data/meal-plan.json', JSON.stringify(merged, null, 2),
        message || 'Update meal plan');
      mealPlan = merged;
      saveShopLocal();
      return merged;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise(res => setTimeout(res, 400));
    }
  }
  throw lastErr;
}

async function persistWeek(key, statusEl, done) {
  // The caller's edit is already applied to the in-memory week. Shallow-copy
  // that week now and re-apply it as the saveMealPlan mutator: the merge
  // takes every week from the fresh server copy (so another device's newer
  // days are never clobbered), and the mutator — applied last — puts this
  // tab's edited week back on top, then mergeWeekState pulls the freshly
  // merged shopping keys (haveGenerated/manualItems/optionalPromoted/
  // conflictAcked) from the merged copy into it, so a concurrent device's
  // shopping marks on this same week are never wiped by the snapshot.
  const weekSnapshot = (mealPlan.weeks && mealPlan.weeks[key]) ? { ...mealPlan.weeks[key] } : undefined;
  try {
    await saveMealPlan(merged => {
      if (!weekSnapshot) return;
      const prev = merged.weeks[key];
      const next = { ...weekSnapshot };
      if (prev && typeof prev === 'object') {
        mergeWeekState(next, prev);
      }
      merged.weeks[key] = next;
    }, 'Update meal plan: ' + key);
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

/* ================================================================
   Smart Meal Planning v1 — logic core (Commit 2A)
   Pure planning logic: classifier, yield math, rotation memory,
   leftover-bucket lunch coverage, the Draft Week generator and
   swap. No UI lives here (chip bar / Quick Sort / feedback row are
   a later stage); every function below works off mealPlan + meta
   and is exercised offline by smart-planning/commit2-test.cjs.

   Week/day conventions (same as the planner): a week key is the
   Sunday date 'YYYY-MM-DD'; day index 0=Sunday .. 5=Friday,
   6=Saturday. Friday dinner (5/dinner) and Saturday lunch
   (6/lunch) are the Shabbat meals.

   Week-record fields this stage owns:
   - week.carryInPool: snapshot of the Shabbat carry-in pool as
     last computed by recomputeWeekLunches — { 'recipe|variant':
     { recipe, variant, servings, cookOffset, source } } where
     cookOffset is -2 (prev Fri dinner) or -1 (prev Sat lunch).
   - week.carryInDeductions: { 'recipe|variant': servings } written
     by draftWeek when it spends pool servings on the Shabbat-
     leftovers night. recomputeWeekLunches charges the pool for
     every leftovers dinner of a pool source still present in the
     week's dinners — the recorded deduction when there is one,
     else the standard 2 servings (a manually added leftovers
     dinner of a Shabbat main records no entry but still eats
     from the pool) — so a manual delete refunds the pool.
   - week.lunchWarnings: [{ day, kind: 'partial'|'uncovered',
     have, need }] — rebuilt from scratch by every recompute.
   Dish field added here: dish.coverage — on a partially covered
   lunch placement, the servings actually available (the badge
   reads "Only <coverage> of <need> servings").
   ================================================================ */

/* ---------------- Planning date helpers ---------------- */
function weekKeyDate(key) {          // 'YYYY-MM-DD' -> Date at local noon
  const p = String(key || '').split('-').map(Number);
  return new Date(p[0] || 1970, (p[1] || 1) - 1, p[2] || 1, 12, 0, 0, 0);
}
function addDaysToKey(key, n) {
  const d = weekKeyDate(key);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function daysBetweenKeys(a, b) {     // whole days from a to b (b minus a)
  return Math.round((weekKeyDate(b) - weekKeyDate(a)) / 86400000);
}
function prevWeekKeyOf(key) { return addDaysToKey(key, -7); }
/* The stored week record for a key, or null — never creates one. */
function planningRawWeek(key) {
  const wk = (mealPlan && mealPlan.weeks) ? mealPlan.weeks[key] : null;
  return (wk && Array.isArray(wk.days)) ? wk : null;
}
/* Normalized slot for a stored week, written back so mutations stick
   (normalizeSlot returns a fresh object for legacy-format slots). */
function planSlot(week, di, meal) {
  const s = normalizeSlot(week.days[di] && week.days[di][meal]);
  if (week.days[di]) week.days[di][meal] = s;
  return s;
}
function planningPrefs() { return (mealPlan && mealPlan.recipePrefs) || {}; }
/* Meta entries for the whole collection (the loaded meta list). */
function allPlanningMeta() {
  if (Array.isArray(recipes) && recipes.length) return recipes;
  return Object.values(metaById || {});
}

/* ---------------- Classifier ----------------
   inferPlanningMeta(metaEntry) -> { slotClass, effort, shabbatFit,
   mainEligible }. Pure and deterministic. `mainEligible` is the
   spec's main-slot eligibility gate, exposed as a field so the
   generator and Quick Sort can apply it without recomputing:
   a recipe may fill a main slot only if its categories include
   'main', or it carries no categories at all ("unclassified" —
   every real non-main in the collection carries at least one
   non-main category, and a recipePrefs slotClass override lifts
   the gate; see effectivePlanningMeta). */
const PLAN_RE = {
  chulent: /\bch(?:u|o)lent\b/i,
  groundBeef: /\b(ground\s+(?:beef|meat)|minced?\s+beef|burgers?|meatballs?|kofta|meatloaf|hamburger)\b/i,
  beefRoast: /\b(brisket|chuck|short\s*ribs?|flanken|corned\s+beef|beef\s+stew|stew\s+beef|beef\s+shank|pot\s+roast|roast\s+beef)\b/i,
  beefWord: /\bbeef\b(?!\s+(?:broth|stock|bouillon|fat))/i,
  chickenWord: /\bchicken\b(?!\s+(?:broth|stock|bouillon|schmaltz|fat))/i,
  fishWord: /\b(salmon|tuna|tilapia|trout|branzino|sea\s+bass|halibut|cod|flounder|snapper|sardines?|anchov\w*|mackerel|herring|whitefish|fish)\b/i,
  pastaWord: /\b(pasta|noodles?|spaghetti|ziti|lasagna|lasagne|macaroni|penne|fettuccine|linguine|gnocchi|ramen|udon|soba|orzo)\b/i,
  vegWord: /\b(tofu|tempeh|seitan|vegetarian|vegan)\b/i,
  lunchSignal: /\b(kugel|overnight|slow[\s-]?cook\w*|crock\s*pot|make[\s-]?ahead|room\s+temp\w*)\b/i
};
function inferPlanningMeta(meta) {
  if (!meta) return { slotClass: 'other', effort: 'weeknight', shabbatFit: 'friday', mainEligible: false };
  const cats = (meta.categories || []).map(c => String(c).toLowerCase().trim());
  const title = String(meta.title || '');
  const hay = (title + ' ' + String(meta.search_text || '') + ' ' + cats.join(' ')).toLowerCase();
  const kosher = String(meta.kosher_status || '').toLowerCase();
  const tags = (meta.tags || []).map(t => String(t).toLowerCase().trim());
  const total = totalTime(meta);
  const mainEligible = cats.includes('main') || cats.length === 0;

  // Chulent: class by its actual protein; always Shabbat effort, lunch fit.
  if (PLAN_RE.chulent.test(title) || PLAN_RE.chulent.test(String(meta.id || ''))) {
    let cls = 'veg';
    if (PLAN_RE.chickenWord.test(hay)) cls = 'chicken';
    else if (PLAN_RE.groundBeef.test(hay)) cls = 'ground-beef';
    else if (PLAN_RE.beefWord.test(hay) || kosher === 'meat') cls = 'beef-roast';
    else if (PLAN_RE.fishWord.test(hay)) cls = 'fish';
    return { slotClass: cls, effort: 'shabbat', shabbatFit: 'lunch', mainEligible };
  }

  // slotClass, in the spec's priority order. The protein regexes carry a
  // broth/stock negative lookahead so "chicken broth" never makes a soup
  // (or anything else) a chicken main.
  let slotClass = 'other';
  if (PLAN_RE.groundBeef.test(hay)) slotClass = 'ground-beef';
  else if (PLAN_RE.beefRoast.test(hay) || PLAN_RE.beefWord.test(hay)) slotClass = 'beef-roast';
  else if (PLAN_RE.chickenWord.test(hay)) slotClass = 'chicken';
  else if (PLAN_RE.fishWord.test(hay)) slotClass = 'fish';
  else if (cats.includes('pasta') || PLAN_RE.pastaWord.test(hay)) slotClass = 'pasta';
  else if (PLAN_RE.vegWord.test(hay)) slotClass = 'veg';

  // effort: 'special' is manual-override only, never inferred.
  let effort;
  if (tags.includes('shabbat')) effort = 'shabbat';
  else if (slotClass === 'beef-roast') effort = 'shabbat';
  else if (!total) effort = (kosher === 'meat') ? 'shabbat' : 'weeknight';
  else if (total <= 45) effort = 'weeknight';
  else if (total >= 90) effort = 'shabbat';
  else effort = (slotClass === 'pasta' || slotClass === 'chicken' || slotClass === 'fish')
    ? 'weeknight' : 'shabbat';

  // shabbatFit: strong make-ahead/room-temp signals -> lunch; a
  // leftover-friendly hot main reheats for either meal -> both;
  // everything else is a Friday (hot, cooked) dish.
  let shabbatFit = 'friday';
  if (cats.includes('salad') || PLAN_RE.lunchSignal.test(title + ' ' + String(meta.search_text || ''))) {
    shabbatFit = 'lunch';
  } else if (meta.leftover_friendly) {
    shabbatFit = 'both';
  }
  return { slotClass, effort, shabbatFit, mainEligible };
}
/* inferPlanningMeta + recipePrefs overrides (slotClass also lifts the
   eligibility gate; effort overrides inference). Adds `rating` and
   `variants` passthrough for the generator's convenience. */
function effectivePlanningMeta(id) {
  const meta = recipeMeta(id);
  if (!meta) return null;
  const out = inferPlanningMeta(meta);
  const prefs = planningPrefs()[id] || null;
  if (prefs) {
    if (prefs.slotClass) { out.slotClass = prefs.slotClass; out.mainEligible = true; }
    if (prefs.effort) out.effort = prefs.effort;
  }
  out.rating = prefs && prefs.rating ? prefs.rating : null;
  out.variants = (Array.isArray(meta.variants) && meta.variants.length) ? meta.variants : null;
  return out;
}

/* ---------------- Yield math ----------------
   leftoverServings(dish, metaEntry, yieldLog?) -> POST-dinner leftover
   servings. Learned yieldLog values are already post-dinner leftovers;
   they are used directly and the 2 dinner servings are NEVER subtracted
   from them a second time (the Argon-caught bug this function exists to
   prevent). The -2 appears only in the inference/fallback paths, where
   a total cooked yield is converted into what remains after dinner. */
const YIELD_LEFT_VALUES = { 'none': 0, 'a little': 1, 'a lot': 2, 'most': 3 };
function yieldMedian(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}
function leftoverServings(dish, metaEntry, yieldLog) {
  if (!dish || dish.leftovers || !dish.recipe) return 0;
  const scale = dish.scale || 1;
  const variant = dish.variant || null;
  const log = Array.isArray(yieldLog) ? yieldLog : ((mealPlan && mealPlan.yieldLog) || []);
  const entries = log.filter(e => e && e.recipe === dish.recipe &&
    Object.prototype.hasOwnProperty.call(YIELD_LEFT_VALUES, e.left));
  if (entries.length) {
    const byDate = [...entries].sort((a, b) => {
      const da = String(a.date || ''), db = String(b.date || '');
      return da < db ? -1 : da > db ? 1 : 0;
    });
    // Exact recipe+scale+variant: latest 3, median, used directly.
    const exact = byDate.filter(e => (e.scale || 1) === scale && (e.variant || null) === variant);
    if (exact.length) return yieldMedian(exact.slice(-3).map(e => YIELD_LEFT_VALUES[e.left]));
    // Cross-variant at the same scale: a serving is a serving — direct.
    const sameScale = byDate.filter(e => (e.scale || 1) === scale);
    if (sameScale.length) return yieldMedian(sameScale.slice(-3).map(e => YIELD_LEFT_VALUES[e.left]));
    // Cross-scale inference: logged left L at scale s means (2 + L) total
    // servings were cooked at s; scale that total to this dish and take
    // dinner back off. Prefer a same-variant entry as the source.
    const srcPool = byDate.filter(e => (e.variant || null) === variant);
    const src = (srcPool.length ? srcPool : byDate).slice(-1)[0];
    const inferred = ((2 + YIELD_LEFT_VALUES[src.left]) / (src.scale || 1)) * scale - 2;
    return Math.max(0, Math.floor(inferred));
  }
  // Fallback: the servings statement. Unparseable -> conservative low of 4.
  const meta = metaEntry || recipeMeta(dish.recipe);
  const base = meta ? parseServings(meta.servings) : null;
  const baseLow = base ? base.low : 4;
  const rawLeft = Math.max(0, Math.floor(baseLow * scale - 2));
  if (rawLeft === 0 && meta && meta.leftover_friendly && baseLow >= 3) return 1;
  return rawLeft;
}

/* ---------------- Rotation memory ----------------
   Latest date each recipe was actually cooked (a non-leftovers dish in
   any stored week; leftovers appearances don't count as cooking), plus
   the same per recipe+variant. Returns { byRecipe, byVariant } with
   'YYYY-MM-DD' values; byVariant keys are 'recipeId|variantKey'. */
function computeLastCooked() {
  const byRecipe = {}, byVariant = {};
  const weeks = (mealPlan && mealPlan.weeks) || {};
  Object.keys(weeks).forEach(key => {
    const wk = weeks[key];
    if (!wk || !Array.isArray(wk.days)) return;
    wk.days.forEach((day, i) => {
      if (!day) return;
      const date = addDaysToKey(key, i);
      ['lunch', 'dinner'].forEach(m => {
        const s = normalizeSlot(day[m]);
        if (s.skipped) return;
        s.dishes.forEach(dish => {
          if (!dish.recipe || dish.leftovers) return;
          if (!byRecipe[dish.recipe] || date > byRecipe[dish.recipe]) byRecipe[dish.recipe] = date;
          if (dish.variant) {
            const k = dish.recipe + '|' + dish.variant;
            if (!byVariant[k] || date > byVariant[k]) byVariant[k] = date;
          }
        });
      });
    });
  });
  return { byRecipe, byVariant };
}

/* ---------------- Leftover buckets + lunch coverage ----------------
   The Shabbat carry-in pool: the PREVIOUS week's Friday dinner and
   Saturday lunch mains, keyed 'recipe|variant'. cookOffset is -2/-1
   relative to this week's Sunday, so the 7-day window and the spacing
   rule treat them exactly like this week's own dinners. */
function buildCarryInPool(weekKey) {
  const prev = planningRawWeek(prevWeekKeyOf(weekKey));
  const pool = {};
  if (!prev) return pool;
  [{ day: 5, meal: 'dinner', offset: -2, source: 'Friday dinner' },
   { day: 6, meal: 'lunch', offset: -1, source: 'Saturday lunch' }].forEach(sp => {
    const day = prev.days[sp.day];
    if (!day) return;
    const s = normalizeSlot(day[sp.meal]);
    if (s.skipped) return;
    s.dishes.forEach(dish => {
      if (!dish.recipe || dish.leftovers) return;
      pool[dish.recipe + '|' + (dish.variant || '')] = {
        recipe: dish.recipe,
        variant: dish.variant || null,
        servings: leftoverServings(dish, recipeMeta(dish.recipe)),
        cookOffset: sp.offset,
        source: sp.source
      };
    });
  });
  return pool;
}

/* recomputeWeekLunches(weekKey) — pure function of the stored weeks.
   Rebuilds Mon–Fri lunch coverage from leftover buckets: this week's
   dinners plus the Shabbat carry-in pool. A bucket stays usable for
   up to 7 days after its cook day; allocation is earliest-lunch-first,
   oldest-bucket-first (FIFO). Spacing: a source is ineligible on
   day d when placing it there would put it on 3 consecutive days or
   on the same day twice — i.e. it already appears on d itself (its
   own leftovers dinner that night counts as an appearance), on both
   d-1 and d-2, on both d-1 and d+1 (bridge), or on both d+1 and
   d+2 — so the same leftovers never run more than 2 days in a row.
   No placements on Sunday (fresh-cook priority) and
   none on Saturday (Shabbat lunch is a planned main, not coverage).
   Only lunch slots that are empty or hold nothing but drafted,
   unlocked dishes are touched; manual dishes are never blocked,
   moved, or removed. Partial coverage still places the dish (with
   dish.coverage set) and records a warning instead of wasting the
   serving. Mutates the stored week in place and returns it. */
function recomputeWeekLunches(weekKey) {
  const week = planningRawWeek(weekKey) || getWeek(weekKey);

  // Carry-in pool, minus what this week's leftovers dinners eat.
  const pool = buildCarryInPool(weekKey);
  const deductions = (week.carryInDeductions && typeof week.carryInDeductions === 'object')
    ? week.carryInDeductions : {};
  const leftoverDinnerKeys = new Set();
  week.days.forEach(day => {
    if (!day) return;
    normalizeSlot(day.dinner).dishes.forEach(d => {
      if (d.leftovers && d.recipe) leftoverDinnerKeys.add(d.recipe + '|' + (d.variant || ''));
    });
  });
  Object.keys(pool).forEach(k => {
    // Every leftovers dinner of a pool source charges the pool: the
    // generator's recorded carryInDeductions amount when there is
    // one, else the standard 2 servings (a manually added leftovers
    // dinner records no deduction entry but still eats from the pool).
    if (leftoverDinnerKeys.has(k)) {
      pool[k].servings = Math.max(0, pool[k].servings - (deductions[k] || 2));
    }
  });
  week.carryInPool = pool;

  // Buckets: carry-in first (oldest cook offsets), then this week's dinners.
  const buckets = [];
  Object.keys(pool).forEach(k => {
    if (pool[k].servings > 0) buckets.push({ key: k, ...pool[k] });
  });
  week.days.forEach((day, i) => {
    if (!day) return;
    const s = normalizeSlot(day.dinner);
    if (s.skipped) return;
    s.dishes.forEach(dish => {
      if (!dish.recipe || dish.leftovers) return;
      const servings = leftoverServings(dish, recipeMeta(dish.recipe));
      if (servings > 0) {
        buckets.push({
          key: dish.recipe + '|' + (dish.variant || ''),
          recipe: dish.recipe, variant: dish.variant || null,
          servings, cookOffset: i, source: 'dinner'
        });
      }
    });
  });
  buckets.sort((a, b) => a.cookOffset - b.cookOffset);

  // Clear the lunch slots we own (Mon–Fri, empty or all drafted+unlocked)
  // BEFORE counting appearances, so yesterday's placements don't block
  // today's rebuild.
  const touchable = [];
  for (let d = 1; d <= 5; d++) {
    const s = planSlot(week, d, 'lunch');
    if (s.skipped) continue;
    if (s.dishes.length && !s.dishes.every(dish => dish.drafted && !dish.locked)) {
      // Untouchable slot (locked or manual dishes): its leftovers
      // dishes already ate from their buckets — charge the matching
      // bucket (the dish's recorded coverage, else the day's need)
      // so the same servings are never placed again on a later day.
      const need = d === 5 ? 1 : 2;   // Friday: 1 serving (Nava only)
      s.dishes.forEach(dish => {
        if (!dish.leftovers || !dish.recipe) return;
        const bucket = buckets.find(b => b.key === dish.recipe + '|' + (dish.variant || ''));
        if (!bucket) return;
        const amt = dish.coverage != null ? dish.coverage : need;
        bucket.servings = Math.max(0, bucket.servings - Math.min(amt, bucket.servings));
      });
      continue;
    }
    s.dishes = [];
    touchable.push(d);
  }

  // Appearances per source (for the spacing rule): every dish still in
  // the week, plus each bucket source's own cook day.
  const appearances = {};
  const noteAppearance = (key, offset) => {
    (appearances[key] = appearances[key] || new Set()).add(offset);
  };
  buckets.forEach(b => noteAppearance(b.key, b.cookOffset));
  week.days.forEach((day, i) => {
    if (!day) return;
    ['lunch', 'dinner'].forEach(m => {
      normalizeSlot(day[m]).dishes.forEach(dish => {
        if (dish.recipe) noteAppearance(dish.recipe + '|' + (dish.variant || ''), i);
      });
    });
  });

  const warnings = [];
  touchable.forEach(d => {
    const need = d === 5 ? 1 : 2;   // Friday: 1 serving (Nava only)
    const bucket = buckets.find(b => {
      if (b.servings <= 0) return false;
      if (d <= b.cookOffset || d - b.cookOffset > 7) return false;
      const seen = appearances[b.key];
      if (seen) {
        if (seen.has(d)) return false;                                 // already on day d (e.g. its own leftovers dinner)
        if (seen.has(d - 1) && seen.has(d - 2)) return false;           // would extend a run to 3 days
        if (seen.has(d - 1) && seen.has(d + 1)) return false;           // would bridge into 3 days in a row
        if (seen.has(d + 1) && seen.has(d + 2)) return false;           // would start a run of 3 days
      }
      return true;
    });
    const s = planSlot(week, d, 'lunch');
    if (!bucket) {
      warnings.push({ day: d, kind: 'uncovered', have: 0, need });
      return;
    }
    const placed = Math.min(bucket.servings, need);
    const dish = {
      recipe: bucket.recipe, leftovers: true, cookDate: null,
      drafted: true, locked: false, variant: bucket.variant || null,
      reason: 'Leftovers from ' + (bucket.cookOffset < 0 ? 'Shabbat' : 'a dinner this week')
    };
    if (placed < need) {
      dish.coverage = placed;
      warnings.push({ day: d, kind: 'partial', have: placed, need });
    }
    bucket.servings -= placed;
    noteAppearance(bucket.key, d);
    s.dishes = [dish];
  });
  week.lunchWarnings = warnings;
  return week;
}

/* ---------------- Generator: scoring ----------------
   A slot is protected (the generator never touches it) when it is
   skipped or holds any locked or manual (non-drafted) dish. Drafted,
   unlocked dishes may be re-rolled. */
function slotIsProtected(slot) {
  const s = normalizeSlot(slot);
  if (s.skipped) return true;
  return s.dishes.some(d => d.locked || !d.drafted);
}
/* Per-slot kosher lock: once a slot holds a meat dish, further picks
   must be meat/pareve; a dairy dish locks to dairy/pareve. Pareve
   alone locks nothing. Returns null when there is no lock. */
function slotKosherAllowed(slot) {
  const s = normalizeSlot(slot);
  let hasMeat = false, hasDairy = false;
  s.dishes.forEach(d => {
    if (!d.recipe) return;
    const m = recipeMeta(d.recipe);
    if (!m) return;
    if (m.kosher_status === 'meat') hasMeat = true;
    if (m.kosher_status === 'dairy') hasDairy = true;
  });
  if (hasMeat) return new Set(['meat', 'pareve']);
  if (hasDairy) return new Set(['dairy', 'pareve']);
  return null;
}

function scorePlanningCandidate(meta, pm, co, opts) {
  let score = 0;
  const factors = [];
  if (pm.rating === 'favorite') { score += 30; factors.push('Favorite'); }
  else if (pm.rating === 'fine') { score += 18; factors.push('Rated fine'); }
  else score += 12;
  const last = (opts.lastCooked || {})[meta.id] || null;
  if (!last) {
    // Never-cooked bonus: +6, but only for the first untried pick of
    // the week (the cap is on the bonus, not on untried picks — with
    // an empty history everything is untried and the draft must
    // still be able to fill the framework).
    if ((opts.untriedUsed || 0) < 1) { score += 6; factors.push('Never made — worth a try'); }
  } else {
    const days = daysBetweenKeys(last, opts.weekKey);
    let pen = 0;
    if (days < 7) pen = 40;
    else if (days < 14) pen = 28;
    else if (days < 21) pen = 16;
    if (pm.rating === 'favorite' && days >= 14) pen = 0;   // favorites exempt after 2 wks
    if (pen) score -= pen;
    else if (days >= 21) factors.push('Not made in ' + Math.floor(days / 7) + ' wks');
  }
  const searchText = String(meta.search_text || '').toLowerCase();
  let useUpScore = 0;
  (opts.useUp || []).forEach(u => {
    const t = String(u || '').trim().toLowerCase();
    if (t && searchText.includes(t) && useUpScore < 24) {   // +8 per hit, capped at +24
      useUpScore += 8;
      factors.push('Uses ' + t + ' on hand');
    }
  });
  score += useUpScore;
  // Hosting: a bonus on NATURAL size only — the generator never scales.
  if (opts.hosting) {
    const low = (parseServings(meta.servings) || { low: 4 }).low;
    if (low >= 8) { score += 20; factors.push('Big batch — good for hosting'); }
    else if (low >= 6) { score += 12; factors.push('Serves a crowd'); }
  }
  // Leftover-selection bonus: a naturally big yield drafted early
  // enough in the week leaves a later lunch it can cover.
  if (opts.cookDay != null && opts.cookDay < 5 &&
      leftoverServings({ recipe: meta.id, variant: co.variant || null }, meta) >= 2) {
    score += 10;
    factors.push('Leftovers cover a lunch');
  }
  return {
    id: meta.id, title: meta.title,
    variant: co.variant || null, variantLabel: co.variantLabel || null,
    slotClass: co.cls, score, factors, meta
  };
}

/* Enumerate scored candidates. opts: { classes:Set|null, efforts:Set,
   fits:Set|null, kosher:Set|null, hosting, useUp:[], lastCooked:{},
   untriedUsed, weekKey, cookDay }. A variant recipe contributes one
   candidate per version (class from the version's meta entry); a
   plain recipe contributes one (its inferred/overridden class). */
function planningCandidates(opts) {
  const out = [];
  const useUp = (opts.useUp || []).slice(0, 5);
  allPlanningMeta().forEach(meta => {
    if (!meta || !meta.id) return;
    const pm = effectivePlanningMeta(meta.id);
    if (!pm || !pm.mainEligible) return;
    if (pm.rating === 'skip') return;
    if (pm.effort === 'special') return;
    if (opts.efforts && !opts.efforts.has(pm.effort)) return;
    if (opts.kosher && !opts.kosher.has(String(meta.kosher_status || '').toLowerCase())) return;
    if (opts.fits && !opts.fits.has(pm.shabbatFit)) return;
    const variants = (Array.isArray(meta.variants) && meta.variants.length) ? meta.variants : null;
    const classOptions = [];
    if (variants) {
      variants.forEach(v => {
        if (v && v.key) classOptions.push({ cls: v.slotClass || pm.slotClass, variant: v.key, variantLabel: v.label || v.key });
      });
    } else {
      classOptions.push({ cls: pm.slotClass, variant: null, variantLabel: null });
    }
    classOptions.forEach(co => {
      if (opts.classes && !opts.classes.has(co.cls)) return;
      out.push(scorePlanningCandidate(meta, pm, co, { ...opts, useUp }));
    });
  });
  return out;
}

/* Persist one planned week through the unified writer (Commit 1):
   the snapshot of the week we just built is applied last, with the
   freshly merged shopping keys preserved via mergeWeekState. */
async function persistPlannedWeek(weekKey, message) {
  const wk = (mealPlan && mealPlan.weeks) ? mealPlan.weeks[weekKey] : null;
  if (!wk) return;
  const snapshot = JSON.parse(JSON.stringify(wk));
  await saveMealPlan(merged => {
    const prev = merged.weeks[weekKey];
    const next = { ...snapshot };
    if (prev && typeof prev === 'object') mergeWeekState(next, prev);
    merged.weeks[weekKey] = next;
  }, message || ('Update meal plan: ' + weekKey));
}

/* ---------------- Generator: Draft Week ----------------
   chips: { hostingFri, hostingSat, eatOut: [dayIdx...],
            useUp: [text, ...] } — all optional.
   HARD INVARIANT: the generator never writes dish.scale — every dish
   it creates omits scale (manual-only, set in the slot editor).
   Mutates the stored week, runs recomputeWeekLunches, persists via
   saveMealPlan, and resolves to the week. */
async function draftWeek(weekKey, chips) {
  chips = chips || {};
  const week = getWeek(weekKey);
  const useUp = Array.isArray(chips.useUp) ? chips.useUp.slice(0, 5) : [];
  const last = computeLastCooked();
  const used = new Set();
  let untriedUsed = 0;
  week.days.forEach(day => {
    ['lunch', 'dinner'].forEach(m => {
      normalizeSlot(day[m]).dishes.forEach(d => { if (d.recipe) used.add(d.recipe); });
    });
  });

  const clearDrafted = (di, meal) => {
    const s = planSlot(week, di, meal);
    s.dishes = s.dishes.filter(d => d.locked || !d.drafted);
    return s;
  };
  const pickFor = (opts) => {
    const cands = planningCandidates({
      ...opts, useUp, lastCooked: last.byRecipe, untriedUsed, weekKey
    }).filter(c => !used.has(c.id))
      .sort((a, b) => (b.score - a.score) || String(a.title).localeCompare(String(b.title)));
    const best = cands[0] || null;
    if (best) {
      used.add(best.id);
      if (!last.byRecipe[best.id]) untriedUsed++;
    }
    return best;
  };
  const dishFromPick = (pick, slotPhrase) => {
    const dish = { recipe: pick.id, leftovers: false, cookDate: null, drafted: true, locked: false };
    if (pick.variant) dish.variant = pick.variant;
    const parts = [];
    if (slotPhrase) parts.push(slotPhrase);
    if (pick.variantLabel) parts.push(pick.variantLabel + ' version');
    pick.factors.forEach(f => parts.push(f));
    dish.reason = parts.length ? parts.join(' · ') : null;
    return dish;
  };

  // Eat-out chips are TWO-WAY — reconcile dinner slots with the chip
  // state before anything fills them (Thu dinner is never touched —
  // rule 1 — even when chipped):
  // (a) a chipped day whose slot is not protected by manual/locked
  //     dishes loses its drafted dishes and becomes skipped with the
  //     auto-mark note 'Eat out' — even when a previous draft already
  //     filled the slot;
  // (b) a day no longer chipped whose slot carries that auto-mark
  //     (skipped, note exactly 'Eat out') is un-skipped so it can be
  //     drafted again. Manual skips (any other note) are never
  //     touched in either direction.
  {
    const eatOut = new Set(Array.isArray(chips.eatOut) ? chips.eatOut : []);
    for (let di = 0; di < 7; di++) {
      if (di === 4 || !week.days[di]) continue;
      const s = planSlot(week, di, 'dinner');
      if (eatOut.has(di)) {
        const protectedDish = s.dishes.some(d => d.locked || !d.drafted);
        const manualSkip = s.skipped && s.note !== 'Eat out';
        if (!protectedDish && !manualSkip) {
          s.dishes = s.dishes.filter(d => d.locked || !d.drafted);
          s.skipped = true; s.note = 'Eat out';
        }
      } else if (s.skipped && s.note === 'Eat out') {
        s.skipped = false; s.note = '';
      }
    }
  }

  // Rule 2: Thursday dinner is the standing pizza night.
  {
    const s = planSlot(week, 4, 'dinner');
    if (!s.skipped && !s.dishes.length) {
      s.dishes.push({
        custom: 'Pizza', leftovers: false, cookDate: null,
        locked: true, drafted: true, reason: 'Standing — Thursday pizza night'
      });
    }
  }

  // Rule 3: Shabbat mains — Friday dinner + Saturday lunch. Shabbat
  // effort, meat/pareve, fit matched to the meal; hosting chips add a
  // natural-size bonus. One main per slot in v1.
  const shabbatPicks = {};
  [{ di: 5, meal: 'dinner', fits: new Set(['friday', 'both']), hosting: !!chips.hostingFri, label: 'Shabbat dinner' },
   { di: 6, meal: 'lunch', fits: new Set(['lunch', 'both']), hosting: !!chips.hostingSat, label: 'Shabbat lunch' }]
  .forEach(ss => {
    if (slotIsProtected(week.days[ss.di][ss.meal])) return;
    const s = clearDrafted(ss.di, ss.meal);
    const kosher = slotKosherAllowed(s) || new Set(['meat', 'pareve']);
    const pick = pickFor({
      classes: null, efforts: new Set(['shabbat']), fits: ss.fits,
      kosher, hosting: ss.hosting, cookDay: ss.di
    });
    if (pick) {
      const dish = dishFromPick(pick, ss.label);
      s.dishes.push(dish);
      shabbatPicks[ss.di + ':' + ss.meal] = { pick, dish };
    }
  });
  // Both mains high-effort (>= 90 min): one cooks on Thursday.
  {
    const friP = shabbatPicks['5:dinner'], satP = shabbatPicks['6:lunch'];
    if (friP && satP && totalTime(friP.pick.meta) >= 90 && totalTime(satP.pick.meta) >= 90) {
      const target = (friP.pick.slotClass === 'beef-roast' || totalTime(friP.pick.meta) >= totalTime(satP.pick.meta))
        ? friP : satP;
      target.dish.cookDate = addDaysToKey(weekKey, 4);
      target.dish.reason = (target.dish.reason ? target.dish.reason + ' · ' : '') + 'Cook Thursday';
    }
  }

  // Rule 4: Shabbat-leftovers night on MONDAY (fallback Tuesday) —
  // never Sunday. Source: the previous week's Shabbat mains with a
  // real yield (>= 2 leftover servings — leftoverServings already
  // accounts for leftover_friendly, so a small proven yield never
  // qualifies on friendliness alone). The 2 servings the dinner
  // eats come out of the carry-in pool via week.carryInDeductions,
  // which recomputeWeekLunches applies.
  let leftoversDay = -1;
  // Q4 (Yidi's pick, 2026-10-22 — "leftovers replace their own
  // kind"): the leftovers source's class satisfies the matching
  // framework slot in rule 5 — beef leftovers (ground-beef or
  // beef-roast) satisfy the beef night, chicken leftovers ARE the
  // chicken night, fish/veg leftovers satisfy the fish/veg night.
  const LEFTOVER_SLOT_BY_CLASS = {
    'ground-beef': 'ground-beef', 'beef-roast': 'ground-beef',
    'chicken': 'chicken', 'pasta': 'pasta',
    'fish': 'fishveg', 'veg': 'fishveg'
  };
  const FRAMEWORK_SLOT_NAMES = {
    'ground-beef': 'the beef night', 'chicken': 'the chicken night',
    'pasta': 'the pasta night', 'fishveg': 'the fish / veg night'
  };
  let leftoversSlot = null;
  {
    const pool = buildCarryInPool(weekKey);
    const sources = Object.values(pool)
      .filter(p => p.servings >= 2)
      .sort((a, b) => (b.servings - a.servings) || (b.cookOffset - a.cookOffset)); // tie -> Saturday lunch (fresher)
    const src = sources[0] || null;
    if (src) {
      for (const di of [1, 2]) {
        if (slotIsProtected(week.days[di].dinner)) continue;
        const s = clearDrafted(di, 'dinner');
        const pm = effectivePlanningMeta(src.recipe);
        let srcClass = pm ? pm.slotClass : null;
        if (src.variant && pm && Array.isArray(pm.variants)) {
          const v = pm.variants.find(v => v.key === src.variant);
          if (v && v.slotClass) srcClass = v.slotClass;
        }
        leftoversSlot = LEFTOVER_SLOT_BY_CLASS[srcClass] || null;
        s.dishes.push({
          recipe: src.recipe, leftovers: true, cookDate: null,
          drafted: true, locked: false, variant: src.variant || null,
          reason: 'Leftovers from Shabbat' + (leftoversSlot
            ? ' · covers ' + FRAMEWORK_SLOT_NAMES[leftoversSlot] : '')
        });
        week.carryInDeductions = { [src.recipe + '|' + (src.variant || '')]: 2 };
        used.add(src.recipe);
        leftoversDay = di;
        break;
      }
    }
  }

  // Rule 5 (v3, Yidi 2026-10-22 — soft targets): the framework is a
  // POOL of categories, not a fixed queue. Weekly targets —
  // ground-beef 1, pasta 2, chicken 2, fish/veg 1 — are SOFT: they
  // deprioritize, never forbid. Each fresh Sun–Wed night, every
  // framework class's candidates compete on their normal score minus
  // bucket penalties (tuning constants — Yidi expects to adjust):
  //   REPEAT_PENALTY (25) per pick the bucket already has this week,
  //   OVER_TARGET_PENALTY (60) more per pick beyond the target,
  //   ADJACENT_PENALTY (15) when the bucket matches last night's.
  // Counts start from the dishes already standing in Sun–Wed dinner
  // slots — manual/locked dishes and the rule-4 leftovers dish (its
  // class counts toward its own target: Q4 "leftovers replace their
  // own kind" falls out of the counting). Unprotected slots are
  // cleared BEFORE counting, so a re-draft never counts the previous
  // draft against itself (Argon trap 3A). Only main-eligible dishes
  // (or leftovers dishes) count — a manual side dish in a slot must
  // not eat a framework target (Argon trap 3B). A night stays empty
  // only when NO framework class has any candidate. Weeknight only.
  {
    const FRAMEWORK_TARGETS = { 'ground-beef': 1, 'pasta': 2, 'chicken': 2, 'fishveg': 1 };
    const FRAMEWORK_PRIORITY = ['ground-beef', 'pasta', 'chicken', 'fishveg'];
    const REPEAT_PENALTY = 25, OVER_TARGET_PENALTY = 60, ADJACENT_PENALTY = 15;
    const labels = {
      'ground-beef': 'Ground-beef night', 'pasta': 'Pasta night',
      'chicken': 'Chicken night', 'fishveg': 'Fish / veg night'
    };
    const bucketOfDish = (dish) => {
      if (!dish || !dish.recipe) return null;
      const pm = effectivePlanningMeta(dish.recipe);
      if (!pm) return null;
      if (!dish.leftovers && !pm.mainEligible) return null;
      let cls = pm.slotClass;
      if (dish.variant && Array.isArray(pm.variants)) {
        const v = pm.variants.find(v => v.key === dish.variant);
        if (v && v.slotClass) cls = v.slotClass;
      }
      return LEFTOVER_SLOT_BY_CLASS[cls] || null;
    };
    // Clear first (trap 3A), then count what genuinely stands.
    for (const di of [0, 1, 2, 3]) {
      if (di !== leftoversDay && !slotIsProtected(week.days[di].dinner)) clearDrafted(di, 'dinner');
    }
    const counts = { 'ground-beef': 0, 'pasta': 0, 'chicken': 0, 'fishveg': 0 };
    const standingBucket = {};
    for (const di of [0, 1, 2, 3]) {
      if (di !== leftoversDay && !slotIsProtected(week.days[di].dinner)) continue;
      const dishes = normalizeSlot(week.days[di].dinner).dishes;
      for (const dish of dishes) {
        const b = bucketOfDish(dish);
        if (b) { counts[b]++; if (!standingBucket[di]) standingBucket[di] = b; }
      }
    }
    let prevBucket = null;
    for (const di of [0, 1, 2, 3]) {
      if (di === leftoversDay || slotIsProtected(week.days[di].dinner)) {
        prevBucket = standingBucket[di] || null;
        continue;
      }
      const s = clearDrafted(di, 'dinner');
      const cands = planningCandidates({
        classes: new Set(['ground-beef', 'chicken', 'pasta', 'fish', 'veg']),
        efforts: new Set(['weeknight']), fits: null,
        kosher: slotKosherAllowed(s), hosting: false, cookDay: di,
        useUp, lastCooked: last.byRecipe, untriedUsed, weekKey
      }).filter(c => !used.has(c.id))
        .map(c => {
          const bucket = LEFTOVER_SLOT_BY_CLASS[c.slotClass];
          let eff = c.score - REPEAT_PENALTY * counts[bucket]
            - OVER_TARGET_PENALTY * Math.max(0, counts[bucket] - FRAMEWORK_TARGETS[bucket] + 1);
          if (bucket === prevBucket) eff -= ADJACENT_PENALTY;
          return { ...c, bucket, eff };
        })
        .sort((a, b) => (b.eff - a.eff)
          || (FRAMEWORK_PRIORITY.indexOf(a.bucket) - FRAMEWORK_PRIORITY.indexOf(b.bucket))
          || String(a.title).localeCompare(String(b.title)));
      const best = cands[0] || null;
      if (best) {
        used.add(best.id);
        if (!last.byRecipe[best.id]) untriedUsed++;
        const n = counts[best.bucket];
        const phrase = labels[best.bucket]
          + (n === 0 ? '' : (n < FRAMEWORK_TARGETS[best.bucket]
              ? ' · #' + (n + 1) + ' this week' : ' · extra this week'));
        s.dishes.push(dishFromPick(best, phrase));
        counts[best.bucket]++;
        prevBucket = best.bucket;
      } else {
        prevBucket = null;
      }
    }
  }

  // Rule 9: lunch coverage from the final dinners.
  recomputeWeekLunches(weekKey);
  await persistPlannedWeek(weekKey, 'Draft week: ' + weekKey);
  return week;
}

/* ---------------- Swap ----------------
   swapCandidates returns the top-5 scored candidates for the class of
   the dish currently in the slot (a variant dish's class is its
   version's class, so the variant follows the slot), excluding any
   recipe already used elsewhere in the week. Swap scoring omits the
   never-cooked bonus (untriedUsed is passed as already spent) so a
   swap surfaces the strongest like-for-like replacements. */
function swapCandidates(weekKey, dayIdx, meal, dishIdx) {
  const week = planningRawWeek(weekKey);
  if (!week || !week.days[dayIdx]) return [];
  const s = normalizeSlot(week.days[dayIdx][meal]);
  const dish = s.dishes[dishIdx];
  if (!dish || !dish.recipe) return [];
  const pm = effectivePlanningMeta(dish.recipe);
  if (!pm) return [];
  let cls = pm.slotClass;
  if (dish.variant && Array.isArray(pm.variants)) {
    const v = pm.variants.find(v => v.key === dish.variant);
    if (v && v.slotClass) cls = v.slotClass;
  }
  const used = new Set();
  week.days.forEach(day => {
    ['lunch', 'dinner'].forEach(m => {
      normalizeSlot(day[m]).dishes.forEach(d => { if (d.recipe) used.add(d.recipe); });
    });
  });
  const opts = {
    // Fish and veg form ONE framework bucket (rule 5), so a fish dish
    // swaps against veg alternatives too, and vice versa.
    classes: (cls === 'fish' || cls === 'veg') ? new Set(['fish', 'veg']) : new Set([cls]),
    useUp: [], lastCooked: computeLastCooked().byRecipe,
    untriedUsed: 1, weekKey, cookDay: dayIdx
  };
  const isShabbatSlot = (dayIdx === 5 && meal === 'dinner') || (dayIdx === 6 && meal === 'lunch');
  if (isShabbatSlot) {
    opts.efforts = new Set(['shabbat']);
    opts.fits = new Set([dayIdx === 5 ? 'friday' : 'lunch', 'both']);
    opts.kosher = new Set(['meat', 'pareve']);
  } else {
    opts.efforts = new Set(['weeknight']);
  }
  const lockSet = slotKosherAllowed({ dishes: s.dishes.filter((d, i) => i !== dishIdx) });
  if (lockSet) opts.kosher = lockSet;
  return planningCandidates(opts)
    .filter(c => c.id !== dish.recipe && !used.has(c.id))
    .sort((a, b) => (b.score - a.score) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 5)
    .map(c => ({
      id: c.id, title: c.title, variant: c.variant, variantLabel: c.variantLabel,
      slotClass: c.slotClass, score: c.score,
      reason: (c.variantLabel ? c.variantLabel + ' version · ' : '') + c.factors.join(' · ')
    }));
}

/* applySwap replaces the dish at the slot with `pick` ({id, variant,
   reason} — typically from swapCandidates). With no pick it takes the
   top candidate; since swapCandidates excludes the current dish,
   repeated swaps cycle through the top-5. The new dish is drafted,
   carries the slot class's variant, and NEVER carries a scale. A
   dinner swap re-runs lunch coverage; the week persists via
   saveMealPlan. Resolves to the new dish, or null if nothing changed. */
async function applySwap(weekKey, dayIdx, meal, dishIdx, pick) {
  const week = planningRawWeek(weekKey) || getWeek(weekKey);
  if (!week.days[dayIdx]) return null;
  const s = planSlot(week, dayIdx, meal);
  const old = s.dishes[dishIdx];
  if (!old || !old.recipe) return null;
  let chosen = pick || null;
  if (!chosen) {
    const cands = swapCandidates(weekKey, dayIdx, meal, dishIdx);
    if (!cands.length) return null;
    chosen = cands[0];
  }
  const dish = {
    recipe: chosen.id, leftovers: false, cookDate: null,
    drafted: true, locked: false, reason: chosen.reason || null
  };
  if (chosen.variant) dish.variant = chosen.variant;
  s.dishes[dishIdx] = dish;
  if (meal === 'dinner') recomputeWeekLunches(weekKey);
  await persistPlannedWeek(weekKey, 'Swap dish: ' + weekKey);
  return dish;
}

/* ================================================================
   Smart Meal Planning v1 — UI (Commit 2B)
   Chip bar + Draft Week, lunch-coverage warnings, dish badges /
   Swap / Lock, the slot-editor scale + variant controls, the
   post-meal feedback row, the Quick Sort screen (#/planner/tune),
   the detail-page rating control + variant toggle, and the recipe
   editor's version support. All meal-plan writes go through
   saveMealPlan / persistPlannedWeek (Commit 1 + 2A) — no new
   write path is added here.
   ================================================================ */

/* The default version of a variant list: the one flagged default,
   else the first (the recipe-page toggle and PDF both preselect it). */
function variantDefaultKey(variants) {
  if (!Array.isArray(variants) || !variants.length) return null;
  const d = variants.find(v => v && v.default);
  return (d || variants[0]).key || null;
}

/* Normalized [{key, label, isDefault}] for a recipe id, from the full
   recipe when loaded (it carries the default flag), else from the
   meta card's variants (no default flag there — first is default). */
function recipeVariantsFor(rid) {
  if (!rid) return [];
  const full = byId[rid];
  if (full && Array.isArray(full.variants) && full.variants.length) {
    const defKey = variantDefaultKey(full.variants);
    return full.variants.map(v => ({
      key: v.key, label: v.label || v.key, isDefault: v.key === defKey
    }));
  }
  const meta = recipeMeta(rid);
  if (meta && Array.isArray(meta.variants) && meta.variants.length) {
    return meta.variants.map((v, i) => ({
      key: v.key, label: v.label || v.key, isDefault: i === 0
    }));
  }
  return [];
}

function variantLabelFor(rid, key) {
  if (!key) return '';
  const v = recipeVariantsFor(rid).find(v => v.key === key);
  return v ? v.label : key;
}

/* One ingredient item under a chosen version: shared items (untagged)
   and optional add-ons show under every version; a variant-tagged
   item shows only under its own version. */
function ingredientVisibleForVariant(item, variantKey) {
  if (!item) return false;
  if (!item.variant) return true;
  if (!variantKey) return false;
  return item.variant === variantKey;
}

/* Sections filtered to a version; sections left empty are dropped. */
function filterIngredientsForVariant(ingredients, variantKey) {
  return (ingredients || [])
    .map(s => ({
      section: s.section || '',
      items: (s.items || []).filter(i => ingredientVisibleForVariant(i, variantKey))
    }))
    .filter(s => s.items.length);
}

/* The chips object draftWeek() consumes, normalized from whatever was
   stored on the week record (week.draftChips) or built from the DOM. */
function normalizeDraftChips(chips) {
  const c = (chips && typeof chips === 'object') ? chips : {};
  return {
    hostingFri: !!c.hostingFri,
    hostingSat: !!c.hostingSat,
    eatOut: Array.isArray(c.eatOut)
      ? c.eatOut.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [],
    useUp: Array.isArray(c.useUp)
      ? c.useUp.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()).slice(0, 5) : []
  };
}

/* A recipePrefs entry with a patch applied and fresh stamps. A patch
   value of null clears that field back to "use inferred" (Auto). */
function buildPrefsEntry(existing, patch, byName, now) {
  const e = { ...((existing && typeof existing === 'object') ? existing : {}) };
  ['rating', 'effort', 'slotClass'].forEach(k => { if (k in patch) e[k] = patch[k]; });
  e.updatedAt = now;
  e.updatedBy = byName || e.updatedBy || '';
  return e;
}

/* One write path for rating/effort overrides (Quick Sort pills and
   the detail-page rating control both land here). */
async function setRecipePref(id, patch) {
  const name = getEditorName();
  const now = Date.now();
  await saveMealPlan(merged => {
    if (!merged.recipePrefs || typeof merged.recipePrefs !== 'object') merged.recipePrefs = {};
    merged.recipePrefs[id] = buildPrefsEntry(merged.recipePrefs[id], patch, name, now);
  }, 'Recipe prefs: ' + id);
}

/* The yieldLog entry a feedback "Left:" tap records. `idStr` is passed
   in so the entry shape stays a pure function of its inputs. */
function buildYieldEntry(dish, dateStr, left, byName, idStr) {
  return {
    id: idStr,
    recipe: dish.recipe,
    scale: dish.scale || 1,
    variant: dish.variant || null,
    left,
    date: dateStr,
    updatedBy: byName || ''
  };
}

/* Post-meal feedback writes. A rating tap updates recipePrefs only —
   the prompt stays until the leftovers half is answered. A "Left:"
   tap appends the yieldLog entry AND completes the dish's feedback
   (dish.feedbackDone), so the prompt disappears permanently.
   Dismiss (the ✕) completes the feedback WITHOUT a yield entry: it
   means "not tracked", and recording a false left:'none' would teach
   leftoverServings() that the recipe yields nothing. */
async function recordMealFeedback(key, di, meal, idx, action) {
  const week = getWeek(key);
  const dish = normalizeSlot(week.days[di][meal]).dishes[idx];
  if (!dish || !dish.recipe) return;
  const name = getEditorName();
  const entry = action.left
    ? buildYieldEntry(dish, addDaysToKey(key, di), action.left, name,
        'yl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8))
    : null;
  const complete = !!action.left || !!action.dismiss;
  await saveMealPlan(merged => {
    if (action.rating) {
      if (!merged.recipePrefs || typeof merged.recipePrefs !== 'object') merged.recipePrefs = {};
      merged.recipePrefs[dish.recipe] =
        buildPrefsEntry(merged.recipePrefs[dish.recipe], { rating: action.rating }, name, Date.now());
    }
    if (entry) {
      if (!Array.isArray(merged.yieldLog)) merged.yieldLog = [];
      merged.yieldLog.push(entry);
    }
    if (complete) {
      const wk = (merged.weeks || {})[key];
      if (wk && Array.isArray(wk.days) && wk.days[di]) {
        const s = planSlot(wk, di, meal);
        if (s.dishes[idx]) s.dishes[idx].feedbackDone = true;
      }
    }
  }, 'Meal feedback: ' + key);
}

/* Identity of a lunch warning for dismissal purposes: if a recompute
   produces a different warning, its signature differs and the strip
   shows again. */
function warningSignature(w) {
  return [w.day, w.kind, w.have || 0, w.need || 0].join('|');
}

const PLAN_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function planWarningsHTML(key, week) {
  const warns = (week && Array.isArray(week.lunchWarnings)) ? week.lunchWarnings : [];
  if (!warns.length) return '';
  const dismissed = new Set(Array.isArray(week.dismissedWarnings) ? week.dismissedWarnings : []);
  const visible = warns.filter(w => !dismissed.has(warningSignature(w)));
  if (!visible.length) return '';
  const lines = visible.map(w => '<div class="warn-line">' + (w.kind === 'partial'
    ? '⚠ ' + PLAN_DAY_NAMES[w.day] + ' lunch only has ~' + (w.have || 0) +
      ' leftover serving' + (w.have === 1 ? '' : 's') + ' (needs ' + w.need + ')'
    : '⚠ ' + PLAN_DAY_NAMES[w.day] + ' lunch isn\u2019t covered by leftovers') + '</div>').join('');
  return '<div class="plan-warnings no-print">' + lines +
    '<button class="warn-dismiss" data-dismiss-warnings="' + esc(key) +
    '" type="button" aria-label="Dismiss warnings">✕</button></div>';
}

/* "Last made N wks ago" for the slot picker (display only). */
function lastMadeText(dateStr, todayStr) {
  if (!dateStr || !todayStr) return '';
  const days = daysBetweenKeys(dateStr, todayStr);
  if (days == null || days < 0) return '';
  const weeks = Math.floor(days / 7);
  if (weeks <= 0) return 'Last made this week';
  if (weeks === 1) return 'Last made 1 wk ago';
  return 'Last made ' + weeks + ' wks ago';
}

/* A unique slug key for a new/renamed recipe version, derived from its
   label (existing ingredient tags follow a rename — see the editor). */
function uniqueVariantKey(vars, label, exceptIdx) {
  const base = slugify(label || '') || 'version';
  let key = base, n = 2;
  while ((vars || []).some((v, i) => i !== exceptIdx && v.key === key)) {
    key = base + '-' + n;
    n++;
  }
  return key;
}

/* Transient use-up chips for the planner header (seeded from the
   week's stored draftChips whenever the displayed week changes). */
let draftUseUp = [];
let draftChipWeekKey = null;
function seedDraftChips(key, week) {
  if (draftChipWeekKey === key) return;
  draftChipWeekKey = key;
  draftUseUp = normalizeDraftChips(week && week.draftChips).useUp.slice();
}

function renderUseUpChips() {
  const host = $('#draft-useup-chips');
  if (!host) return;
  host.innerHTML = draftUseUp.map((t, i) =>
    '<span class="useup-chip">' + esc(t) +
    '<button type="button" data-useup-del="' + i + '" aria-label="Remove">✕</button></span>'
  ).join('');
}

/* Draft Week button flow: read the chip bar, remember the chips on
   the week record (draftWeek persists the whole week, chips
   included), run the generator, re-render. */
async function runDraftWeek(key, app) {
  const chips = {
    hostingFri: !!($('#draft-hosting-fri') && $('#draft-hosting-fri').checked),
    hostingSat: !!($('#draft-hosting-sat') && $('#draft-hosting-sat').checked),
    eatOut: [...document.querySelectorAll('[data-eatout].active')].map(el => +el.dataset.eatout),
    useUp: draftUseUp.slice(0, 5)
  };
  try {
    getWeek(key).draftChips = chips;
    draftUseUp = chips.useUp.slice();
    await draftWeek(key, chips);
    toast('Week drafted — the site rebuilds in about a minute.');
  } catch (e) {
    toast('Draft failed: ' + e.message);
  }
  renderPlanner(app || $('#app'));
}

/* The inline feedback row under a cooked dish on a PAST day (dinner
   only in v1, per spec). Hosting on that slot hides the leftovers
   half — guest counts skew the 2-person yield — never the rating. */
function feedbackRowHTML(key, di, meal, idx, dish, week) {
  if (meal !== 'dinner' || !dish || !dish.recipe || dish.leftovers || dish.feedbackDone) return '';
  if (!(addDaysToKey(key, di) < ymd(new Date()))) return '';
  const cur = (planningPrefs()[dish.recipe] || {}).rating || null;
  const at = key + '|' + di + '|' + meal + '|' + idx;
  const rateBtns = [['favorite', 'Favorite'], ['fine', 'Fine'], ['skip', 'Skip']].map(([v, l]) =>
    '<button type="button" class="fb-btn' + (cur === v ? ' active' : '') +
    '" data-fbrate="' + at + '|' + v + '">' + l + '</button>').join('');
  let html = '<div class="feedback-row"><span class="fb-label">How was it?</span>' +
    '<span class="fb-group">' + rateBtns + '</span>';
  const chips = normalizeDraftChips(week && week.draftChips);
  const hosting = di === 5 && chips.hostingFri;  // Friday dinner hosting
  if (!hosting) {
    const leftBtns = [['none', 'None'], ['a little', 'A little'], ['a lot', 'A lot'], ['most', 'Most']]
      .map(([v, l]) => '<button type="button" class="fb-btn" data-fbleft="' + at + '|' + v + '">' +
        l + '</button>').join('');
    html += '<span class="fb-sep">· Left:</span><span class="fb-group">' + leftBtns +
      '<button type="button" class="fb-btn fb-dismiss" data-fbdismiss="' + at +
      '" aria-label="Dismiss feedback">✕</button></span>';
  }
  return html + '</div>';
}

/* ---------------- Quick Sort (#/planner/tune) ----------------
   Every recipe grouped by its effective class; variant recipes get a
   row under EACH version's class (prefs stay recipe-level). Pill
   groups write recipePrefs overrides through saveMealPlan; the Auto
   pill clears the override for that field. */
const QS_CLASS_ORDER = [
  ['ground-beef', 'Ground beef'], ['beef-roast', 'Beef & roasts'],
  ['chicken', 'Chicken'], ['fish', 'Fish'], ['pasta', 'Pasta'],
  ['veg', 'Veg & vegetarian'], ['other', 'Other']
];
function renderQuickSort(app) {
  document.title = 'Tune rotation — Reiss Family Recipes';
  const groups = new Map(QS_CLASS_ORDER.map(([k]) => [k, []]));
  allPlanningMeta().forEach(meta => {
    const pm = effectivePlanningMeta(meta.id);
    if (!pm) return;
    if (pm.variants) {
      pm.variants.forEach(v => {
        const bucket = groups.get(v.slotClass) || groups.get('other');
        bucket.push({ meta, pm, variant: v });
      });
    } else {
      (groups.get(pm.slotClass) || groups.get('other')).push({ meta, pm, variant: null });
    }
  });
  const prefs = planningPrefs();
  const pillGroup = (kind, id, effective, overrideVal, options) => {
    let h = '<span class="pill-group">' +
      '<button type="button" class="pill auto' + (overrideVal == null ? ' active' : '') +
      '" data-qs="' + kind + '|' + esc(id) + '|">Auto</button>';
    options.forEach(([v, l]) => {
      h += '<button type="button" class="pill' + (effective === v ? ' active' : '') +
        (overrideVal === v ? ' is-override' : '') +
        '" data-qs="' + kind + '|' + esc(id) + '|' + v + '">' + l + '</button>';
    });
    return h + '</span>';
  };
  let body = '';
  QS_CLASS_ORDER.forEach(([cls, label]) => {
    const rows = (groups.get(cls) || [])
      .sort((a, b) => String(a.meta.title).localeCompare(String(b.meta.title)));
    if (!rows.length) return;
    body += '<section class="qs-group"><h3>' + label +
      ' <span class="muted">(' + rows.length + ')</span></h3>' + rows.map(row => {
        const pref = prefs[row.meta.id] || {};
        return '<div class="qs-row">' +
          '<a class="qs-title" href="#/recipe/' + encodeURIComponent(row.meta.id) + '">' +
            esc(row.meta.title) + '</a>' +
          (row.variant ? ' <span class="badge neutral">variant · ' + esc(row.variant.label) + '</span>' : '') +
          '<span class="qs-pills"><span class="qs-kind">Effort</span>' +
            pillGroup('effort', row.meta.id, row.pm.effort, pref.effort || null,
              [['weeknight', 'Weeknight'], ['shabbat', 'Shabbat'], ['special', 'Special']]) + '</span>' +
          '<span class="qs-pills"><span class="qs-kind">Rating</span>' +
            pillGroup('rating', row.meta.id, row.pm.rating, pref.rating || null,
              [['favorite', 'Favorite'], ['fine', 'Fine'], ['skip', 'Skip']]) + '</span>' +
        '</div>';
      }).join('') + '</section>';
  });
  app.innerHTML =
    '<a class="back-link no-print" href="#/planner">← Back to planner</a>' +
    '<h1 class="recipe-title">Tune the rotation</h1>' +
    '<p class="muted">Every recipe joins the rotation automatically, grouped by the ' +
    'planner\u2019s best guess. Tap a pill only to correct it — Auto means the guess ' +
    'stands. Ratings are shared: one family opinion per recipe.</p>' + body;
  app.querySelectorAll('[data-qs]').forEach(b => b.addEventListener('click', async () => {
    const [kind, id, val] = b.dataset.qs.split('|');
    try {
      await setRecipePref(id, { [kind]: val || null });
      renderQuickSort(app);
    } catch (e) {
      toast('Couldn\u2019t save: ' + e.message);
    }
  }));
}

/* ---------------- Shopping list: offline-first with conflict detection ----------------
   Each device gets a session ID per page load. Taps save to localStorage instantly
   (works offline), then sync via the bridge in the background. The worker /read
   endpoint provides fresh server state bypassing Pages rebuild delay.
   If two sessions mark the same item as "have", it's flagged as a potential
   duplicate — the second tapper couldn't see the first mark when they tapped. */
function getSessionId() {
  let sid = sessionStorage.getItem('shop-session');
  if (!sid) {
    sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('shop-session', sid);
  }
  return sid;
}
const SHOP_LOCAL_KEY = 'recipe-shop-local';
// Have-marks are {key, session, at}. Supports legacy string array format.
function normalizeHaveMarks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => typeof x === 'string' ? { key: x, session: 'legacy', at: 0 } : x);
}
// Have-marks are {key, session, at}. Supports legacy string array format.
// A mark with removed: true is a tombstone: the user unchecked it. Tombstones
// are kept and merged by timestamp so an older checked copy on the server or
// another device can never resurrect the check.
function activeHaveMarks(arr) {
  // Collapse to one entry per (key, session) by newest `at` first, so a stale
  // duplicate can never shadow a tombstone; then drop tombstones.
  return mergeHaveMarks(arr, []).filter(m => !m.removed);
}
// Merge have-marks by (key, session): the entry with the newest `at` wins,
// so unchecks (removed tombstones) survive older checked copies, while
// concurrent checks from two sessions still union (different sessions).
function mergeHaveMarks(localArr, serverArr) {
  const byId = new Map();
  [...normalizeHaveMarks(localArr), ...normalizeHaveMarks(serverArr)].forEach(m => {
    if (!m || !m.key) return;
    const id = m.key + '|' + m.session;
    const cur = byId.get(id);
    if (!cur || (m.at || 0) >= (cur.at || 0)) byId.set(id, m);
  });
  return [...byId.values()];
}
// Merge manual items by id. A tombstone (deleted: true) always wins over a
// live copy; otherwise the copy with the newest updatedAt decides the have
// state, and haveSessions union when the merged state is "have" (so the
// two-shopper conflict badge still works).
function mergeManualItems(localArr, serverArr) {
  const byId = new Map();
  [...(Array.isArray(localArr) ? localArr : []), ...(Array.isArray(serverArr) ? serverArr : [])].forEach(item => {
    if (!item || !item.id) return;
    const cur = byId.get(item.id);
    if (!cur) { byId.set(item.id, { ...item }); return; }
    if (item.deleted || cur.deleted) {
      byId.set(item.id, { ...cur, ...item, deleted: true, updatedAt: Math.max(cur.updatedAt || 0, item.updatedAt || 0) });
      return;
    }
    const newer = (item.updatedAt || item.haveAt || 0) >= (cur.updatedAt || cur.haveAt || 0) ? item : cur;
    const merged = { ...cur, ...newer };
    if (merged.have) {
      merged.haveSessions = [...new Set([...(cur.haveSessions || []), ...(item.haveSessions || [])])];
    }
    byId.set(item.id, merged);
  });
  return [...byId.values()];
}
// optionalPromoted entries are {key, promotedAt, removedAt}. Legacy entries
// are plain key strings, treated as {key, promotedAt: 0, removedAt: null}.
// An entry is ACTIVE when promotedAt is set and later than removedAt.
// Un-promoting stamps removedAt instead of dropping the entry, so the
// removal can win merges against older promoted copies; merges carry the
// latest of each timestamp forward.
function normalizePromotedList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => typeof x === 'string' ? { key: x, promotedAt: 0, removedAt: null } : x);
}
function promotedIsActive(p) {
  return !!p && p.promotedAt !== null && p.promotedAt !== undefined &&
    (p.removedAt === null || p.removedAt === undefined || p.promotedAt > p.removedAt);
}
function promotedKeySet(week) {
  return new Set(normalizePromotedList(week && week.optionalPromoted).filter(promotedIsActive).map(p => p.key));
}
function setPromoted(week, key, on) {
  const arr = normalizePromotedList(week.optionalPromoted);
  const ex = arr.find(p => p.key === key);
  const now = Date.now();
  if (ex) {
    if (on) ex.promotedAt = now; else ex.removedAt = now;
  } else {
    arr.push(on ? { key, promotedAt: now, removedAt: null } : { key, promotedAt: null, removedAt: now });
  }
  week.optionalPromoted = arr;
}
function mergePromoted(localArr, serverArr) {
  const byKey = new Map();
  const maxTs = (a, b) => (a === null || a === undefined) ? (b ?? null) : (b === null || b === undefined) ? a : Math.max(a, b);
  [...normalizePromotedList(localArr), ...normalizePromotedList(serverArr)].forEach(p => {
    if (!p || !p.key) return;
    const cur = byKey.get(p.key);
    if (!cur) { byKey.set(p.key, { ...p }); return; }
    byKey.set(p.key, { key: p.key, promotedAt: maxTs(cur.promotedAt, p.promotedAt), removedAt: maxTs(cur.removedAt, p.removedAt) });
  });
  return [...byKey.values()];
}
// Merge shopping state from `source` week into `target` week (in place).
// Used everywhere we combine local + server state. Merges are timestamp-
// and tombstone-aware: concurrent "have" marks from two devices still
// union, but deletes and unchecks are never resurrected by older copies.
function mergeWeekState(target, source) {
  if (!target || !source) return target;
  target.haveGenerated = mergeHaveMarks(target.haveGenerated, source.haveGenerated);
  target.manualItems = mergeManualItems(target.manualItems, source.manualItems);
  if (source.conflictAcked) {
    target.conflictAcked = { ...(target.conflictAcked || {}), ...source.conflictAcked };
  }
  // Merge optional promotions (union) so a promotion isn't lost in sync.
  target.optionalPromoted = mergePromoted(target.optionalPromoted, source.optionalPromoted);
  return target;
}
// Fetch the meal plan from the live bridge API first (no Pages rebuild lag),
// falling back to the static Pages copy when offline or bridge-unreachable.
async function fetchLiveMealPlan() {
  try {
    const r = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/meal-plan.json'));
    if (r.ok) {
      const data = await r.json();
      if (data.ok && data.content) {
        const mp = JSON.parse(data.content);
        if (mp && typeof mp.weeks === 'object') return mp;
      }
    }
  } catch (e) { /* fall through to Pages copy */ }
  try {
    const mp = await (await fetch('data/meal-plan.json?t=' + Date.now())).json();
    if (mp && typeof mp.weeks === 'object') return mp;
  } catch (e) { /* offline */ }
  return null;
}
function saveShopLocal() {
  try {
    localStorage.setItem(SHOP_LOCAL_KEY, JSON.stringify(mealPlan));
  } catch (e) { /* storage full — non-fatal */ }
}
function loadShopLocal() {
  try {
    const raw = localStorage.getItem(SHOP_LOCAL_KEY);
    if (raw) {
      const lp = JSON.parse(raw);
      if (lp && typeof lp.weeks === 'object') {
        // Merge, don't overwrite: run the full mergeMealPlan so local
        // offline state recovers the same way everywhere — shopping keys
        // union per week, and top-level keys (recipePrefs/yieldLog/
        // framework) come back too, not just the current week's marks.
        mealPlan = mergeMealPlan(mealPlan, lp);
        saveShopLocal();
      }
    }
  } catch (e) { /* ignore */ }
}
// Debounced bridge sync — pull-merge-push so the server can never wipe local marks.
// Tracks unsynced changes; the 'online' event flushes them the moment connectivity returns.
let _shopSyncTimer = null;
let _shopDirty = false;
function markShopDirty() {
  _shopDirty = true;
  saveShopLocal();
  syncShopSoon();
}
function syncShopSoon() {
  if (_shopSyncTimer) clearTimeout(_shopSyncTimer);
  _shopSyncTimer = setTimeout(syncShop, 2000);
}
async function syncShop() {
  _shopSyncTimer = null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _shopDirty = true;  // offline — stay dirty, retry on 'online' event
    return;
  }
  // saveMealPlan itself re-reads the fresh server copy and merges before
  // writing, so the push is already the union (both devices' marks), never
  // a stale overwrite — no separate pollShopServer() pull needed here (it
  // would just double the /read calls).
  try {
    await saveMealPlan(null, 'Shopping list sync');
    _shopDirty = false;
    if ((location.hash || '#/') === '#/shopping') renderShopWrap();
  } catch (e) {
    _shopDirty = true;  // push failed — retry on next poll / online event
  }
}
// Poll server state via worker /read (bypasses Pages rebuild). Merges have-marks.
async function pollShopServer() {
  if (_savePlanInFlight > 0) return;
  try {
    const r = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/meal-plan.json'));
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok || !data.content) return;
    const server = JSON.parse(data.content);
    if (!server || typeof server.weeks !== 'object') return;
    // Full merge: fresh days win for every week, local shopping state
    // (timestamp/tombstone-aware) unions in, top-level keys stay live.
    mealPlan = mergeMealPlan(server, mealPlan);
    saveShopLocal();
    // Re-render if we're on the shopping page
    if ((location.hash || '#/') === '#/shopping') renderShopWrap();
  } catch (e) { /* offline or worker not yet deployed — non-fatal */ }
}
// 15s poll while the shopping page is open
function startShopPoll() {
  stopShopPoll();
  window._shopPollTimer = setInterval(() => {
    if ((location.hash || '#/') !== '#/shopping') { stopShopPoll(); return; }
    // If we have unsynced changes, do a full push; otherwise just pull.
    if (_shopDirty) syncShop();
    else pollShopServer();
  }, 15000);
}
function stopShopPoll() {
  if (window._shopPollTimer) { clearInterval(window._shopPollTimer); window._shopPollTimer = null; }
}
// Flush unsynced shopping changes the moment connectivity returns.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => {
    if (_shopDirty && (location.hash || '#/') === '#/shopping') syncShop();
    else if ((location.hash || '#/') === '#/shopping') pollShopServer();
  });
}
/* Submit draft persistence: Android may kill the tab when the camera opens,
   so we save the photo (as resized base64) + URL + note to localStorage the
   moment anything changes. On reload, the draft is restored. */
const SUBMIT_DRAFT_KEY = 'recipe-submit-draft';
function saveSubmitDraft() {
  const photos = Array.isArray(window._submitPhotos)
    ? window._submitPhotos.map(p => ({
        b64: p.b64,
        name: p.name || 'photo.jpg',
        ext: p.ext || 'jpg'
      }))
    : [];
  const base = {
    url: ($('#s-url') || {}).value || '',
    note: ($('#s-note') || {}).value || '',
    text: ($('#s-text') || {}).value || ''
  };
  for (let k = photos.length; k >= 0; k--) {
    try {
      const draft = {
        url: base.url,
        note: base.note,
        text: base.text,
        photos: photos.slice(0, k)
      };
      localStorage.setItem(SUBMIT_DRAFT_KEY, JSON.stringify(draft));
      return;
    } catch (e) { /* storage full or unavailable — shed photos until it fits */ }
  }
}
function loadSubmitDraft() {
  try {
    const raw = localStorage.getItem(SUBMIT_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function clearSubmitDraft() {
  try { localStorage.removeItem(SUBMIT_DRAFT_KEY); } catch (e) {}
  window._submitPhotos = [];
}
function renderSubmit(app) {
  document.title = 'Submit a recipe — Reiss Family Recipes';
  if (!Array.isArray(window._submitPhotos)) window._submitPhotos = [];
  app.innerHTML =
    '<a class="back-link no-print" href="#/recipes">← All recipes</a>' +
    '<h1 class="recipe-title">Submit a recipe</h1>' +
    '<p class="no-print" style="max-width:34rem">Paste a link, attach a photo of a recipe, upload a PDF, or a combination. ' +
    'It goes into the inbox, and within about 30 minutes it shows up in the collection as a finished recipe with its PDF. ' +
    'If something can\u2019t be figured out, it\u2019ll be marked below so you know.</p>' +
    '<form class="edit-form no-print" id="submit-form" onsubmit="return false">' +
      '<div class="field"><label for="s-url">Link (optional)</label>' +
        '<input type="url" id="s-url" placeholder="https://… recipe page, video, post"></div>' +
      '<div class="field"><label>Photos (optional)</label>' +
        '<input type="file" id="s-photo" accept="image/*" multiple style="display:none">' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<button class="btn secondary" id="s-choose-btn" type="button">🖼️ Choose photo</button>' +
          '<button class="btn secondary" id="s-camera-btn" type="button">📷 Take photo</button></div>' +
        '<div class="form-hint" id="s-photo-hint">A photo of a written recipe, a dish, a cookbook page…</div></div>' +
      '<div class="field"><label>PDF recipe (optional)</label>' +
        '<input type="file" id="s-pdf" accept=".pdf,application/pdf" style="display:none">' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<button class="btn secondary" id="s-pdf-btn" type="button">📄 Choose PDF</button></div>' +
        '<div class="form-hint" id="s-pdf-hint">A PDF of a recipe — text and layout are both used.</div></div>' +
      '<div class="field"><label for="s-note">Note (optional)</label>' +
        '<input type="text" id="s-note" placeholder="Anything helpful — whose recipe, occasion…"></div>' +
      '<div class="field"><label for="s-text">Or paste the recipe (optional)</label>' +
        '<textarea id="s-text" rows="8" placeholder="Paste the full recipe text here — title, ingredients, instructions. Sous Chef will parse it into a proper recipe. No need to format it perfectly."></textarea>' +
        '<div class="form-hint">Just dump the text — Sous Chef handles the rest.</div></div>' +
      '<div class="form-status" id="submit-status"></div>' +
      '<div class="actions" style="margin-bottom:0">' +
        '<button class="btn" id="submit-send" type="button">Submit</button>' +
        '<a class="btn secondary" href="#/" id="submit-cancel">Cancel</a>' +
      '</div>' +
    '</form>' +
    '<h2 class="recipe-title" style="font-size:1.2rem;margin-top:2rem">Recent submissions</h2>' +
    '<div id="inbox-list"><p>Loading…</p></div>';
  $('#submit-send').onclick = sendSubmission;
  const cancelBtn = $('#submit-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { clearSubmitDraft(); });
  // Single photo input (with multiple); buttons trigger gallery/files or in-page camera.
  const chooseBtn = $('#s-choose-btn');
  const camBtn = $('#s-camera-btn');
  const photoInput = $('#s-photo');
  const photoHint = $('#s-photo-hint');
  if (photoInput) {
    if (chooseBtn) chooseBtn.onclick = () => {
      photoInput.removeAttribute('capture');
      photoInput.click();
    };
    // Take photo: in-page camera (getUserMedia) so the tab never dies.
    // The old file-input+camouflage approach let Android kill the tab.
    if (camBtn) camBtn.onclick = () => { openInPageCamera(); };
    photoInput.addEventListener('change', async () => {
      const files = Array.from(photoInput.files || []);
      photoInput.value = '';
      if (!files.length) return;
      if (!Array.isArray(window._submitPhotos)) window._submitPhotos = [];
      const remaining = Math.max(0, 6 - window._submitPhotos.length);
      if (remaining === 0) {
        if (photoHint) photoHint.textContent = '6 photos ready (limit is 6)';
        toast('Maximum 6 photos per submission.');
        return;
      }
      const toProcess = files.slice(0, remaining);
      const overflow = files.length > remaining;
      for (let i = 0; i < toProcess.length; i++) {
        if (photoHint) {
          photoHint.textContent = toProcess.length > 1
            ? 'Processing photo ' + (i + 1) + ' of ' + toProcess.length + '…'
            : 'Processing photo…';
        }
        await processPhotoFile(toProcess[i]);
      }
      if (overflow) {
        const n = window._submitPhotos.length;
        if (photoHint) photoHint.textContent = n + ' photo' + (n === 1 ? '' : 's') + ' ready (limit is 6)';
        toast('Limit is 6 photos — kept the first ' + toProcess.length + '.');
      }
    });
  }
  // PDF upload: simple file picker, no processing needed client-side.
  const pdfInput = $('#s-pdf');
  const pdfBtn = $('#s-pdf-btn');
  const pdfHint = $('#s-pdf-hint');
  if (pdfInput && pdfBtn) {
    pdfBtn.onclick = () => pdfInput.click();
    pdfInput.addEventListener('change', () => {
      const file = (pdfInput.files || [])[0];
      if (!file) return;
      if (pdfHint) pdfHint.textContent = 'Selected: ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
    });
  }
  // Save URL/note/text as the user types (survives tab death)
  const urlInput = $('#s-url'), noteInput = $('#s-note'), textInput = $('#s-text');
  let draftTimer = null;
  const queueDraftSave = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveSubmitDraft, 500);
  };
  if (urlInput) urlInput.addEventListener('input', queueDraftSave);
  if (noteInput) noteInput.addEventListener('input', queueDraftSave);
  if (textInput) textInput.addEventListener('input', queueDraftSave);
  // Restore any saved draft (e.g. after Android killed the tab for the camera)
  restoreSubmitDraft();
  window._inboxRespondOpen = null;
  loadInboxList();
}

/* Shared photo resize helper: resize longest edge to 2400px JPEG (q=0.85),
   falling back to raw base64 with extension guessed from MIME/filename.
   Returns { b64, name, ext } (b64 is null if unreadable). */
async function resizePhotoFile(file, nameOverride) {
  const name = nameOverride || (file && file.name) || 'photo.jpg';
  let b64 = null;
  let ext = 'jpg';
  try {
    const dataUrl = await readAsDataURL(file);
    const img = await loadImage(dataUrl);
    const MAX = 2400;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('decode failed');
    const resizedDataUrl = await readAsDataURL(blob);
    b64 = String(resizedDataUrl).split(',')[1] || null;
    ext = 'jpg';
  } catch (e) {
    try {
      const raw = String(await readAsDataURL(file)).split(',');
      b64 = raw[1] || null;
      const mt = ((file && file.type) || '').toLowerCase();
      const fn = String(name).toLowerCase();
      ext = (mt.includes('png') || /\.png$/.test(fn)) ? 'png'
        : (mt.includes('heic') || /\.heic$/.test(fn)) ? 'heic'
        : (mt.includes('webp') || /\.webp$/.test(fn)) ? 'webp'
        : 'jpg';
    } catch (e2) {
      b64 = null;
    }
  }
  return { b64, name, ext };
}

/* Shared photo processing: resize to 2400px JPEG (q=0.85), append to
   _submitPhotos (capped at 6) + localStorage draft, update hint and preview. */
async function processPhotoFile(file, nameOverride) {
  if (!Array.isArray(window._submitPhotos)) window._submitPhotos = [];
  const photoHint = $('#s-photo-hint');
  if (window._submitPhotos.length >= 6) {
    if (photoHint) photoHint.textContent = '6 photos ready (limit is 6)';
    toast('Maximum 6 photos per submission.');
    updatePhotoPreview();
    return;
  }
  const { b64, name, ext } = await resizePhotoFile(file, nameOverride);
  if (!b64) {
    if (photoHint) {
      const n = window._submitPhotos.length;
      photoHint.textContent = n
        ? 'Could not read that photo — ' + n + ' photo' + (n === 1 ? '' : 's') + ' ready'
        : 'Could not read that photo — try again.';
    }
    updatePhotoPreview();
    return;
  }
  window._submitPhotos.push({ b64, name, ext });
  saveSubmitDraft();
  if (photoHint) {
    const n = window._submitPhotos.length;
    photoHint.textContent = n + ' photo' + (n === 1 ? '' : 's') + ' ready';
  }
  updatePhotoPreview();
}

/* In-page camera: uses getUserMedia so the tab never leaves the page.
   (The file-input capture approach lets Android kill the tab.) */
let _camStream = null;
async function openInPageCamera() {
  if (!Array.isArray(window._submitPhotos)) window._submitPhotos = [];
  const photoHint = $('#s-photo-hint');
  if (window._submitPhotos.length >= 6) {
    if (photoHint) photoHint.textContent = '6 photos ready (limit is 6)';
    toast('Maximum 6 photos per submission.');
    return;
  }
  // Fallback if camera API is unavailable
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const pi = $('#s-photo');
    if (pi) { pi.setAttribute('capture', 'environment'); pi.click(); }
    return;
  }
  // Build the modal
  const modal = document.createElement('div');
  modal.id = 'cam-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center';
  modal.innerHTML =
    '<video id="cam-video" playsinline muted autoplay style="width:100%;max-height:75vh;object-fit:contain;background:#000"></video>' +
    '<div style="display:flex;gap:1rem;margin-top:1rem">' +
      '<button id="cam-capture" class="btn" type="button" style="font-size:1.2rem;padding:.8rem 2rem">Capture</button>' +
      '<button id="cam-cancel" class="btn secondary" type="button">Cancel</button>' +
    '</div>' +
    '<div id="cam-status" style="color:#fff;margin-top:.75rem;font-size:.9rem"></div>';
  document.body.appendChild(modal);
  const video = $('#cam-video');
  const status = $('#cam-status');
  try {
    _camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    video.srcObject = _camStream;
  } catch (e) {
    if (status) status.textContent = 'Camera unavailable — falling back to file picker.';
    setTimeout(() => {
      closeInPageCamera();
      const pi = $('#s-photo');
      if (pi) { pi.removeAttribute('capture'); pi.click(); }
    }, 1200);
    return;
  }
  $('#cam-capture').onclick = async () => {
    if (status) status.textContent = 'Processing…';
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) throw new Error('no video frame');
      const canvas = document.createElement('canvas');
      canvas.width = vw; canvas.height = vh;
      canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('capture failed');
      await processPhotoFile(blob, 'camera-photo-' + (window._submitPhotos.length + 1) + '.jpg');
      closeInPageCamera();
    } catch (e) {
      if (status) status.textContent = 'Capture failed — try again.';
    }
  };
  $('#cam-cancel').onclick = () => { closeInPageCamera(); };
}
function closeInPageCamera() {
  if (_camStream) {
    _camStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    _camStream = null;
  }
  const modal = $('#cam-modal');
  if (modal) modal.remove();
}
function restoreSubmitDraft() {
  if (!Array.isArray(window._submitPhotos)) window._submitPhotos = [];
  const draft = loadSubmitDraft();
  if (!draft) {
    updatePhotoPreview();
    return;
  }
  const urlInput = $('#s-url'), noteInput = $('#s-note'), textInput = $('#s-text'), photoHint = $('#s-photo-hint');
  if (draft.url && urlInput) urlInput.value = draft.url;
  if (draft.note && noteInput) noteInput.value = draft.note;
  if (draft.text && textInput) textInput.value = draft.text;
  let restored = [];
  if (Array.isArray(draft.photos)) {
    restored = draft.photos
      .filter(p => p && typeof p.b64 === 'string' && p.b64)
      .slice(0, 6)
      .map(p => ({
        b64: p.b64,
        name: p.name || 'photo.jpg',
        ext: p.ext || 'jpg'
      }));
  } else if (draft.photoB64) {
    restored = [{
      b64: draft.photoB64,
      name: draft.photoName || 'photo.jpg',
      ext: 'jpg'
    }];
  }
  window._submitPhotos = restored;
  if (restored.length && photoHint) {
    const n = restored.length;
    photoHint.textContent = n + ' photo' + (n === 1 ? '' : 's') + ' ready (restored)';
  }
  updatePhotoPreview();
}
function updatePhotoPreview() {
  const hint = $('#s-photo-hint');
  const photos = Array.isArray(window._submitPhotos) ? window._submitPhotos : [];
  let wrap = $('#s-photo-preview-wrap');
  if (!photos.length) {
    if (wrap) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
    }
    return;
  }
  if (!wrap && hint && hint.parentElement) {
    wrap = document.createElement('div');
    wrap.id = 's-photo-preview-wrap';
    wrap.style.cssText = 'display:flex;gap:.75rem;flex-wrap:wrap;margin-top:.5rem';
    hint.parentElement.appendChild(wrap);
  }
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.style.display = 'flex';
  photos.forEach((p, idx) => {
    const ext = (p.ext || 'jpg').toLowerCase();
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'heic' ? 'image/heic'
      : 'image/jpeg';
    const item = document.createElement('div');
    item.className = 's-photo-thumb';
    item.style.cssText = 'position:relative;display:inline-block';

    const img = document.createElement('img');
    img.src = 'data:' + mime + ';base64,' + p.b64;
    img.alt = 'Photo ' + (idx + 1);
    img.style.cssText = 'width:96px;height:96px;object-fit:cover;border-radius:8px;display:block;border:1px solid #e0d5c1';

    const num = document.createElement('span');
    num.textContent = String(idx + 1);
    num.style.cssText = 'position:absolute;top:-8px;left:-8px;min-width:22px;height:22px;padding:0 5px;' +
      'border-radius:11px;background:#2c241d;color:#fff;font-size:12px;font-weight:600;line-height:22px;' +
      'text-align:center;box-sizing:border-box';

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = '×';
    rmBtn.setAttribute('aria-label', 'Remove photo ' + (idx + 1));
    rmBtn.style.cssText = 'position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;' +
      'background:#a03d1a;color:#fff;border:none;font-size:16px;line-height:1;cursor:pointer';
    rmBtn.onclick = () => removeSubmitPhotoAt(idx);

    item.appendChild(img);
    item.appendChild(num);
    item.appendChild(rmBtn);
    wrap.appendChild(item);
  });
}
function removeSubmitPhotoAt(i) {
  if (!Array.isArray(window._submitPhotos)) window._submitPhotos = [];
  if (i < 0 || i >= window._submitPhotos.length) return;
  window._submitPhotos.splice(i, 1);
  saveSubmitDraft();
  updatePhotoPreview();
  const hint = $('#s-photo-hint');
  if (hint) {
    const n = window._submitPhotos.length;
    hint.textContent = n
      ? n + ' photo' + (n === 1 ? '' : 's') + ' ready'
      : 'A photo of a written recipe, a dish, a cookbook page…';
  }
  const photoInput = $('#s-photo');
  if (photoInput) photoInput.value = '';
}
// Format an ISO timestamp for the log, in the user's local timezone.
function formatLogTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function loadInboxList(showAll = !!window._inboxShowAll) {
  const host = $('#inbox-list');
  if (!host) return;
  let idx = [];
  try {
    // Read via live bridge first (no Pages CDN lag), falling back to public fetch
    const liveIdx = await fetchLiveInboxJson('data/inbox/index.json');
    if (Array.isArray(liveIdx)) idx = liveIdx;
  } catch (e) { /* no inbox yet */ }
  // Refresh the list every 60s while the submit page is open, preserving
  // whether the user expanded it with "Show all" and skipping while a
  // respond form is open so a half-typed answer is never wiped.
  if (!window._inboxRefreshTimer) {
    window._inboxRefreshTimer = setInterval(() => {
      if (!document.getElementById('inbox-list')) {
        clearInterval(window._inboxRefreshTimer);
        window._inboxRefreshTimer = null;
        return;
      }
      if (isInboxRespondActive()) return;
      loadInboxList(!!window._inboxShowAll);
    }, 60000);
  }
  window._inboxShowAll = showAll;
  if (!idx.length) {
    window._inboxRowsById = {};
    host.innerHTML = '<p>Nothing submitted yet.</p>';
    return;
  }
  const badge = s => s === 'done' ? '✓ added'
    : s === 'failed' ? '⚠ needs attention'
    : s === 'duplicate' ? '⧉ duplicate — skipped'
    : s === 'needs_input' ? '? needs your input'
    : s === 'working' ? '… working on it' : '… in the inbox';
  const visible = (showAll ? idx.slice() : idx.slice(-10)).reverse();
  // For edit requests, show the request text: prefer the text stored inline
  // in the index summary; for older entries without it, fetch the full
  // entries — in parallel so "Show all" never freezes the page.
  const editDetails = {};
  const needsFetch = visible.filter(s => s.type === 'edit' && !s.text);
  if (needsFetch.length) {
    const fetched = await Promise.all(needsFetch.map(async s => {
      try {
        const full = await fetchLiveInboxJson('data/inbox/' + s.id + '.json');
        if (full && typeof full === 'object') return [s.id, full];
      } catch (e) { /* skip */ }
      return [s.id, {}];
    }));
    for (const [id, full] of fetched) editDetails[id] = full;
  }
  const rowsById = {};
  visible.forEach(s => {
    if (s && s.id) {
      rowsById[s.id] = s.type === 'edit' && editDetails[s.id]
        ? Object.assign({}, editDetails[s.id], s)
        : s;
    }
  });
  window._inboxRowsById = rowsById;

  const ts = s => {
    const f = formatLogTimestamp(s.created_at);
    return f ? ' <span style="color:var(--muted);font-size:0.85em">' + esc(f) + '</span>' : '';
  };
  host.innerHTML = '<ul class="pairing-list">' + visible.map(s => {
    // Edit requests get special display
    if (s.type === 'edit') {
      const full = editDetails[s.id] || {};
      const targetTitle = s.edit_target && recipeMeta(s.edit_target) ? recipeMeta(s.edit_target).title : (s.edit_target || 'recipe');
      const reqText = s.text || full.text || '';
      const preview = reqText.length > 100 ? reqText.slice(0, 97) + '…' : reqText;
      const editBadge = s.status === 'done' ? '✓ applied' : badge(s.status);
      const editImgs = inboxEntryImages(s).length ? inboxEntryImages(s) : inboxEntryImages(full);
      const editThumbs = editImgs.length ? renderInboxThumbsHTML(s.id, editImgs) : '';
      return '<li><strong>✏️ Edit: ' + esc(targetTitle) + '</strong> — ' + editBadge +
        (preview ? '<br><span style="color:var(--muted)">"' + esc(preview) + '"</span>' : '') +
        (s.status === 'done' && s.edit_target ?
          ' → <a href="#/recipe/' + encodeURIComponent(s.edit_target) + '">view recipe</a>' : '') +
        (s.fail_reason ? ' <span style="color:var(--danger)">' + esc(s.fail_reason) + '</span>' : '') +
        ts(s) +
        editThumbs +
        '</li>';
    }
    // Direct edits (via site edit page or bridge) and deletions get their
    // own display. Direct-edit entries may carry title/actor/note from the
    // bridge auto-log.
    if (s.type === 'direct-edit') {
      const targetTitle = s.title || (s.edit_target && recipeMeta(s.edit_target) ? recipeMeta(s.edit_target).title : (s.edit_target || 'recipe'));
      // Strip the "site-editor (...)" wrapper only when it wraps the whole
      // string (alternation precedence means a plain | would over-strip).
      const cleanActor = (s.actor || '').replace(/^site-editor \((.*)\)$/, '$1').trim();
      const actor = cleanActor && cleanActor !== 'Anonymous' ? cleanActor : null;
      const note = s.note && s.note !== 'Direct edit via site' ? s.note : '';
      return '<li><strong>✏️ Edited: ' + esc(targetTitle) + '</strong> — ✓ saved' +
        (actor ? ' · <span style="color:var(--muted)">by ' + esc(actor) + '</span>' : '') +
        (note ? '<br><span style="color:var(--muted)">' + esc(note.length > 140 ? note.slice(0, 137) + '…' : note) + '</span>' : '') +
        (s.edit_target ?
          ' → <a href="#/recipe/' + encodeURIComponent(s.edit_target) + '">view recipe</a>' : '') +
        ts(s) +
        '</li>';
    }
    if (s.type === 'delete') {
      const targetTitle = s.note ? s.note.replace(/^Deleted via site: /, '') : (s.edit_target || 'recipe');
      return '<li><strong>🗑️ Deleted: ' + esc(targetTitle) + '</strong> — ✓ removed' + ts(s) + '</li>';
    }
    // Show the recipe title once it's processed
    let titlePart = '';
    if (s.recipe_id && recipeMeta(s.recipe_id)) {
      titlePart = ' → <a href="#/recipe/' + encodeURIComponent(s.recipe_id) + '">' +
        esc(recipeMeta(s.recipe_id).title) + '</a>';
    } else if (s.recipe_id) {
      titlePart = ' → <a href="#/recipe/' + encodeURIComponent(s.recipe_id) + '">view recipe</a>';
    }
    // Show what was submitted — list each non-photo piece (link, text, note)
    // and render clickable thumbnails in place of the old "📷 filename / N photos" text.
    const parts = [];
    if (s.url) {
      const shortUrl = s.url.length > 60 ? s.url.slice(0, 57) + '…' : s.url;
      parts.push('🔗 <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(shortUrl) + '</a>');
    }
    const imgs = inboxEntryImages(s);
    if (s.text) {
      const preview = s.text.length > 80 ? s.text.slice(0, 77) + '…' : s.text;
      parts.push('📝 <span title="' + esc(s.text.slice(0, 500)) + '">' + esc(preview) + '</span>');
    }
    if (s.note) parts.push('💬 ' + esc(s.note));
    const what = parts.length ? parts.join(' · ') : (imgs.length ? '' : 'empty submission');
    const whatPart = what ? (' — ' + what) : '';
    const thumbsPart = imgs.length ? renderInboxThumbsHTML(s.id, imgs) : '';
    // For duplicates, show what it's a duplicate of
    let dupPart = '';
    if (s.status === 'duplicate' && s.duplicate_of) {
      const dupTitle = recipeMeta(s.duplicate_of) ? esc(recipeMeta(s.duplicate_of).title) : esc(s.duplicate_of);
      dupPart = ' (duplicate of ' + dupTitle + ')';
    }
    // Plain-language "What's needed" line + Respond action for needs_input rows;
    // Retry button for failed rows.
    let needsPart = '';
    let actionPart = '';
    if (s.status === 'needs_input') {
      const needsText = formatNeedsList(s.needs);
      if (needsText) {
        needsPart = '<div class="log-needs">What’s needed: <strong>' + esc(needsText) + '</strong></div>';
      }
      actionPart = ' <button class="btn secondary log-action-btn" type="button" data-inbox-respond="' + esc(s.id) + '">Respond</button>' +
        '<div class="respond-host" id="respond-host-' + esc(s.id) + '"></div>';
    } else if (s.status === 'failed') {
      actionPart = ' <button class="btn secondary log-action-btn" type="button" data-inbox-retry="' + esc(s.id) + '">Retry</button>' +
        ' <span class="log-retry-status" id="retry-status-' + esc(s.id) + '"></span>';
    }
    return '<li><strong>' + badge(s.status) + '</strong>' + whatPart + titlePart + dupPart +
      (s.fail_reason ? ' <span style="color:var(--danger)">' + esc(s.fail_reason) + '</span>' : '') +
      ts(s) +
      thumbsPart +
      needsPart +
      actionPart +
      '</li>';
  }).join('') + '</ul>' +
    (!showAll && idx.length > 10
      ? '<p><button class="btn secondary" id="inbox-show-all">Show all (' + idx.length + ')</button></p>'
      : '') +
    (showAll
      ? '<p><button class="btn secondary" id="inbox-show-less">Show recent only</button></p>'
      : '');
  const showAllBtn = $('#inbox-show-all');
  if (showAllBtn) showAllBtn.onclick = () => {
    if (isInboxRespondActive()) { toast('Finish or cancel your response first'); return; }
    loadInboxList(true);
  };
  const showLessBtn = $('#inbox-show-less');
  if (showLessBtn) showLessBtn.onclick = () => {
    if (isInboxRespondActive()) { toast('Finish or cancel your response first'); return; }
    loadInboxList(false);
  };
  host.onclick = e => {
    const thumbBtn = e.target.closest('[data-thumb-id]');
    if (thumbBtn) {
      const entryId = thumbBtn.dataset.thumbId;
      const startIdx = parseInt(thumbBtn.dataset.thumbIdx, 10) || 0;
      const row = (window._inboxRowsById || {})[entryId];
      if (!row) return;
      const imgs = inboxEntryImages(row);
      if (!imgs.length) return;
      openInboxLightbox(imgs, startIdx, inboxRowCaptionContext(row, badge));
      return;
    }
    const respBtn = e.target.closest('[data-inbox-respond]');
    if (respBtn) {
      const entryId = respBtn.dataset.inboxRespond;
      toggleInboxRespondForm(entryId);
      return;
    }
    const retryBtn = e.target.closest('[data-inbox-retry]');
    if (retryBtn) {
      const entryId = retryBtn.dataset.inboxRetry;
      retryFailedInboxEntry(entryId, retryBtn);
    }
  };
}

/* ---------------- Inbox log helpers: thumbnails, lightbox, respond & retry ---------------- */
const INBOX_NEEDS_LABELS = {
  title: "the recipe's name",
  ingredients: 'ingredient amounts / details',
  instructions: 'the instructions',
  servings: 'how much it makes (servings)',
  clearer_photo: 'a clearer photo',
  recipe_selection: 'which recipe(s) to add'
};

function formatNeedsList(needs) {
  if (!Array.isArray(needs) || !needs.length) return '';
  return needs
    .filter(k => typeof k === 'string' && k.trim())
    .map(k => {
      const key = k.trim();
      return INBOX_NEEDS_LABELS[key] || key;
    })
    .join(', ');
}

function inboxEntryImages(s) {
  if (!s || typeof s !== 'object') return [];
  if (Array.isArray(s.images) && s.images.length) return s.images.filter(Boolean);
  if (s.image) return [s.image];
  return [];
}

// One-shot fallback to raw.githubusercontent.com when a newly uploaded photo
// has not yet deployed to GitHub Pages (60-120s rebuild window).
function inboxImgFallback(imgEl) {
  if (!imgEl || imgEl.dataset.rawFallback) return;
  imgEl.dataset.rawFallback = '1';
  const rel = imgEl.getAttribute('data-src-path') || imgEl.getAttribute('src') || '';
  const clean = String(rel).split('?')[0].replace(/^\/+/, '');
  if (!clean || /^https?:\/\//i.test(clean)) return;
  imgEl.src = 'https://raw.githubusercontent.com/' + REPO.owner + '/' + REPO.repo + '/' +
    REPO.branch + '/' + clean + '?t=' + Date.now();
}

function renderInboxThumbsHTML(entryId, imgs) {
  if (!Array.isArray(imgs) || !imgs.length) return '';
  return '<div class="log-thumbs">' + imgs.map((p, i) =>
    '<button type="button" class="log-thumb-btn" data-thumb-id="' + esc(entryId) + '" data-thumb-idx="' + i + '" ' +
      'aria-label="View photo ' + (i + 1) + ' of ' + imgs.length + '">' +
      '<img class="log-thumb" src="' + esc(p) + '" data-src-path="' + esc(p) + '" alt="Photo ' + (i + 1) + '" ' +
        'loading="lazy" onerror="inboxImgFallback(this)">' +
    '</button>'
  ).join('') + '</div>';
}

function inboxRowCaptionContext(row, badgeFn) {
  if (!row) return '';
  const statusLabel = typeof badgeFn === 'function' ? badgeFn(row.status) : (row.status || '');
  if (row.recipe_id && recipeMeta(row.recipe_id)) {
    return statusLabel + ' · ' + recipeMeta(row.recipe_id).title;
  }
  if (row.type === 'edit' && row.edit_target) {
    const t = recipeMeta(row.edit_target) ? recipeMeta(row.edit_target).title : row.edit_target;
    return 'Edit: ' + t + ' (' + statusLabel + ')';
  }
  if (row.note) {
    const shortNote = row.note.length > 60 ? row.note.slice(0, 57) + '…' : row.note;
    return statusLabel + ' · ' + shortNote;
  }
  return statusLabel;
}

let _lightboxState = null;
let _lightboxKeyHandler = null;
let _lightboxPrevOverflow = '';

function openInboxLightbox(photos, startIndex, contextLabel) {
  if (!Array.isArray(photos) || !photos.length) return;
  closeInboxLightbox();
  const idx = Math.max(0, Math.min(photos.length - 1, Number(startIndex) || 0));
  _lightboxState = { photos, index: idx, context: contextLabel || '' };
  if (typeof document !== 'undefined' && document.documentElement) {
    _lightboxPrevOverflow = document.documentElement.style.overflow || '';
    document.documentElement.style.overflow = 'hidden';
  }
  const overlay = document.createElement('div');
  overlay.id = 'inbox-lightbox';
  overlay.className = 'lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Submission photo viewer');
  overlay.innerHTML =
    '<button type="button" class="lightbox-close" id="lightbox-close-btn" aria-label="Close photo viewer">✕</button>' +
    (photos.length > 1
      ? '<button type="button" class="lightbox-nav lightbox-prev" id="lightbox-prev-btn" aria-label="Previous photo">‹</button>' +
        '<button type="button" class="lightbox-nav lightbox-next" id="lightbox-next-btn" aria-label="Next photo">›</button>'
      : '') +
    '<div class="lightbox-stage">' +
      '<img class="lightbox-img" id="lightbox-img" src="" alt="" onerror="inboxImgFallback(this)">' +
      '<div class="lightbox-caption" id="lightbox-caption"></div>' +
    '</div>';
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.classList.contains('lightbox-stage')) {
      closeInboxLightbox();
    }
  });
  document.body.appendChild(overlay);
  const closeBtn = $('#lightbox-close-btn');
  if (closeBtn) closeBtn.onclick = () => closeInboxLightbox();
  const prevBtn = $('#lightbox-prev-btn');
  if (prevBtn) prevBtn.onclick = e => { e.stopPropagation(); stepInboxLightbox(-1); };
  const nextBtn = $('#lightbox-next-btn');
  if (nextBtn) nextBtn.onclick = e => { e.stopPropagation(); stepInboxLightbox(1); };

  _lightboxKeyHandler = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeInboxLightbox(); }
    else if (e.key === 'ArrowLeft' && _lightboxState && _lightboxState.photos.length > 1) {
      e.preventDefault(); stepInboxLightbox(-1);
    } else if (e.key === 'ArrowRight' && _lightboxState && _lightboxState.photos.length > 1) {
      e.preventDefault(); stepInboxLightbox(1);
    }
  };
  document.addEventListener('keydown', _lightboxKeyHandler);
  updateInboxLightboxSlide();
}

function updateInboxLightboxSlide() {
  if (!_lightboxState) return;
  const { photos, index, context } = _lightboxState;
  const src = photos[index] || '';
  const img = $('#lightbox-img');
  if (img) {
    delete img.dataset.rawFallback;
    img.setAttribute('data-src-path', src);
    img.src = src;
    img.alt = 'Photo ' + (index + 1) + ' of ' + photos.length;
  }
  const cap = $('#lightbox-caption');
  if (cap) {
    cap.textContent = 'Photo ' + (index + 1) + ' of ' + photos.length + (context ? ' — ' + context : '');
  }
}

function stepInboxLightbox(delta) {
  if (!_lightboxState || _lightboxState.photos.length <= 1) return;
  const len = _lightboxState.photos.length;
  _lightboxState.index = (_lightboxState.index + delta + len) % len;
  updateInboxLightboxSlide();
}

function closeInboxLightbox() {
  if (_lightboxKeyHandler) {
    document.removeEventListener('keydown', _lightboxKeyHandler);
    _lightboxKeyHandler = null;
  }
  const overlay = $('#inbox-lightbox');
  if (overlay) overlay.remove();
  if (_lightboxState && typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.overflow = _lightboxPrevOverflow;
  }
  _lightboxState = null;
}

// Self-healing refresh guard: returns true only when a respond form is both
// flagged open and actually mounted in the DOM.
function isInboxRespondActive() {
  const openId = window._inboxRespondOpen;
  if (!openId) return false;
  if (typeof document !== 'undefined' && document.getElementById('respond-' + openId)) {
    return true;
  }
  window._inboxRespondOpen = null;
  return false;
}

function formatInboxAnswerDate(d = new Date()) {
  const dt = (d instanceof Date && !isNaN(d.getTime())) ? d : new Date();
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function composeInboxAnswerNote(existingNote, editorName, answerText, dateStr) {
  const who = (editorName && String(editorName).trim()) ? String(editorName).trim() : 'Anonymous';
  const when = dateStr || formatInboxAnswerDate(new Date());
  const trimmedAnswer = (answerText && String(answerText).trim()) ? String(answerText).trim() : '';
  const body = trimmedAnswer || 'attached a clearer/additional photo.';
  const addition = 'Answer from ' + who + ' (' + when + '): ' + body;
  const prev = (existingNote && String(existingNote).trim()) ? String(existingNote).trim() : '';
  return prev ? (prev + ' — ' + addition) : addition;
}

function patchInboxIndexRow(indexArr, entryId, patch) {
  if (!Array.isArray(indexArr)) return [];
  return indexArr.map(row => {
    if (!row || row.id !== entryId) return row;
    return Object.assign({}, row, patch);
  });
}

// Read JSON from the live bridge first (bypasses GitHub Pages CDN lag),
// falling back to public fetch only when offline or bridge-unreachable.
async function fetchLiveInboxJson(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  try {
    const r = await fetch(BRIDGE + '/read?path=' + encodeURIComponent(clean));
    if (r.ok) {
      const data = await r.json();
      if (data && data.ok && typeof data.content === 'string') {
        return JSON.parse(data.content);
      }
    }
  } catch (e) { /* fall through to public fetch */ }
  try {
    const r2 = await fetch(clean + '?v=' + Date.now());
    if (r2.ok) return await r2.json();
  } catch (e) { /* offline or 404 */ }
  return null;
}

// Re-fetch data/inbox/index.json immediately before writing, patch the target
// row, and save via bridgeSave; retries once automatically on failure.
async function syncInboxIndexPatch(entryId, patch, commitMsg, fallbackEntry) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 400));
    }
    try {
      const idx = await fetchLiveInboxJson('data/inbox/index.json');
      if (!Array.isArray(idx)) throw new Error('could not read inbox index');
      const exists = idx.some(r => r && r.id === entryId);
      const updated = exists
        ? patchInboxIndexRow(idx, entryId, patch)
        : idx.concat([Object.assign({}, fallbackEntry || { id: entryId }, patch)]);
      await bridgeSave('data/inbox/index.json', JSON.stringify(updated, null, 2),
        commitMsg || ('Log response index ' + entryId));
      return updated;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('index update failed');
}

let _respondState = null;

function closeInboxRespondForm() {
  if (_respondState && _respondState.entryId) {
    const host = $('#respond-host-' + _respondState.entryId);
    if (host) host.innerHTML = '';
  }
  if (window._inboxRespondOpen) {
    const existing = document.getElementById('respond-' + window._inboxRespondOpen);
    if (existing && existing.parentElement) existing.parentElement.innerHTML = '';
  }
  window._inboxRespondOpen = null;
  _respondState = null;
}

function toggleInboxRespondForm(entryId) {
  if (!entryId) return;
  if (window._inboxRespondOpen === entryId && document.getElementById('respond-' + entryId)) {
    closeInboxRespondForm();
    return;
  }
  closeInboxRespondForm();
  const row = (window._inboxRowsById || {})[entryId];
  if (!row) return;
  const host = $('#respond-host-' + entryId);
  if (!host) return;
  const existingImgs = inboxEntryImages(row);
  const attachCap = Math.max(2, 6 - existingImgs.length);
  _respondState = {
    entryId,
    row,
    attachCap,
    photos: [],
    savedPatch: null,
    savedEntry: null
  };
  window._inboxRespondOpen = entryId;
  const promptText = row.fail_reason || 'What would you like to add?';
  host.innerHTML =
    '<div class="respond-form" id="respond-' + esc(entryId) + '">' +
      '<div class="respond-prompt">' + esc(promptText) + '</div>' +
      '<textarea class="respond-textarea" id="respond-text-' + esc(entryId) + '" rows="3" ' +
        'placeholder="Type the missing details…"></textarea>' +
      '<div class="respond-attach-row">' +
        '<input type="file" id="respond-file-' + esc(entryId) + '" accept="image/*" multiple style="display:none">' +
        '<button class="btn secondary" id="respond-photo-btn-' + esc(entryId) + '" type="button">📷 Attach photo</button>' +
        '<span class="form-hint" id="respond-photo-hint-' + esc(entryId) + '">Optional (up to ' + attachCap + ' photo' + (attachCap === 1 ? '' : 's') + ')</span>' +
      '</div>' +
      '<div class="respond-thumbs" id="respond-thumbs-' + esc(entryId) + '"></div>' +
      '<div class="form-status" id="respond-status-' + esc(entryId) + '"></div>' +
      '<div class="respond-actions">' +
        '<button class="btn" id="respond-send-' + esc(entryId) + '" type="button">Send answer</button>' +
        '<button class="btn secondary" id="respond-cancel-' + esc(entryId) + '" type="button">Cancel</button>' +
      '</div>' +
    '</div>';

  const fileInput = $('#respond-file-' + entryId);
  const photoBtn = $('#respond-photo-btn-' + entryId);
  const photoHint = $('#respond-photo-hint-' + entryId);
  if (photoBtn && fileInput) {
    photoBtn.onclick = () => fileInput.click();
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (!files.length || !_respondState || _respondState.entryId !== entryId) return;
      const rem = Math.max(0, _respondState.attachCap - _respondState.photos.length);
      if (rem === 0) {
        toast('Maximum ' + _respondState.attachCap + ' photo' + (_respondState.attachCap === 1 ? '' : 's') + ' for this response.');
        return;
      }
      const slice = files.slice(0, rem);
      const overflow = files.length > rem;
      for (let i = 0; i < slice.length; i++) {
        if (photoHint) photoHint.textContent = 'Processing photo ' + (i + 1) + ' of ' + slice.length + '…';
        const res = await resizePhotoFile(slice[i]);
        if (res.b64 && _respondState && _respondState.entryId === entryId) {
          _respondState.photos.push(res);
        }
      }
      renderRespondPhotoPreview(entryId);
      if (overflow) {
        toast('Kept the first ' + slice.length + ' photo' + (slice.length === 1 ? '' : 's') + ' (limit reached).');
      }
    });
  }
  const sendBtn = $('#respond-send-' + entryId);
  if (sendBtn) sendBtn.onclick = () => submitInboxResponse(entryId);
  const cancelBtn = $('#respond-cancel-' + entryId);
  if (cancelBtn) cancelBtn.onclick = () => closeInboxRespondForm();
  const ta = $('#respond-text-' + entryId);
  if (ta && ta.focus) ta.focus();
}

function renderRespondPhotoPreview(entryId) {
  if (!_respondState || _respondState.entryId !== entryId) return;
  const wrap = $('#respond-thumbs-' + entryId);
  const hint = $('#respond-photo-hint-' + entryId);
  const photos = _respondState.photos || [];
  if (hint) {
    hint.textContent = photos.length
      ? photos.length + ' photo' + (photos.length === 1 ? '' : 's') + ' attached'
      : 'Optional (up to ' + _respondState.attachCap + ' photo' + (_respondState.attachCap === 1 ? '' : 's') + ')';
  }
  if (!wrap) return;
  wrap.innerHTML = '';
  photos.forEach((p, idx) => {
    const ext = (p.ext || 'jpg').toLowerCase();
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'heic' ? 'image/heic'
      : 'image/jpeg';
    const tile = document.createElement('div');
    tile.className = 'respond-thumb-tile';
    const img = document.createElement('img');
    img.className = 'log-thumb';
    img.src = 'data:' + mime + ';base64,' + p.b64;
    img.alt = 'Attached photo ' + (idx + 1);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'respond-thumb-rm';
    rm.textContent = '×';
    rm.setAttribute('aria-label', 'Remove attached photo ' + (idx + 1));
    rm.onclick = () => {
      if (!_respondState || _respondState.entryId !== entryId) return;
      _respondState.photos.splice(idx, 1);
      renderRespondPhotoPreview(entryId);
    };
    tile.appendChild(img);
    tile.appendChild(rm);
    wrap.appendChild(tile);
  });
}

async function submitInboxResponse(entryId) {
  if (!_respondState || _respondState.entryId !== entryId) return;
  const st = $('#respond-status-' + entryId);
  const sendBtn = $('#respond-send-' + entryId);
  const cancelBtn = $('#respond-cancel-' + entryId);
  const photoBtn = $('#respond-photo-btn-' + entryId);
  const textEl = $('#respond-text-' + entryId);

  // Step 8 recovery path: if Step 6 already succeeded and the user tapped
  // "Retry", redo ONLY Step 7 (index update).
  if (_respondState.savedPatch) {
    if (sendBtn) sendBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (st) { st.className = 'form-status'; st.textContent = 'Updating inbox list…'; }
    try {
      await syncInboxIndexPatch(entryId, _respondState.savedPatch, 'Log response index ' + entryId, _respondState.savedEntry);
      closeInboxRespondForm();
      toast('Answer sent — it’ll be picked up within about 30 minutes.');
      await loadInboxList(!!window._inboxShowAll);
    } catch (e) {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Retry'; }
      if (cancelBtn) cancelBtn.disabled = false;
      if (st) {
        st.className = 'form-status error';
        st.textContent = 'Your answer was saved to the entry, but updating the list failed (' + (e.message || e) + '). Tap Retry to finish re-queuing it.';
      }
    }
    return;
  }

  const answerText = textEl ? textEl.value.trim() : '';
  const attached = (_respondState.photos || []).slice();
  // Validate non-empty before calling getEditorName() so an empty click never prompts
  if (!answerText && !attached.length) {
    if (st) {
      st.className = 'form-status error';
      st.textContent = 'Write an answer or attach a photo first.';
    }
    return;
  }

  // Step 1: resolve editor name synchronously inside the tap handler before any await
  const editorName = getEditorName();

  if (sendBtn) sendBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  if (photoBtn) photoBtn.disabled = true;
  if (st) { st.className = 'form-status'; st.textContent = 'Sending…'; }

  // Step 2: fetch full entry file via bridge /read (fallback to public fetch;
  // on 404 synthesize by copying the whole index row so test_mode/duplicate_of survive).
  let entry = null;
  try {
    const fetched = await fetchLiveInboxJson('data/inbox/' + entryId + '.json');
    if (fetched && typeof fetched === 'object' && fetched.id) {
      entry = Object.assign({}, _respondState.row, fetched);
    }
  } catch (e) { /* synthesize below */ }
  if (!entry) {
    entry = Object.assign({}, _respondState.row, { id: entryId });
  }

  // Step 3: upload any attached photos sequentially BEFORE mutating entry
  const existingImgs = inboxEntryImages(entry);
  const newPaths = [];
  try {
    for (let i = 0; i < attached.length; i++) {
      if (st) st.textContent = 'Uploading photo ' + (i + 1) + ' of ' + attached.length + '…';
      const num = existingImgs.length + i + 1;
      const ext = (attached[i].ext || 'jpg').toLowerCase();
      const rPath = 'data/inbox/' + entryId + '-r' + num + '.' + ext;
      await bridgeSave(rPath, String(attached[i].b64).replace(/\s+/g, ''),
        'Log response photo ' + entryId + ' (-r' + num + ')', 'base64');
      newPaths.push(rPath);
    }
  } catch (e) {
    if (sendBtn) sendBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (photoBtn) photoBtn.disabled = false;
    if (st) {
      st.className = 'form-status error';
      st.textContent = 'Photo upload failed: ' + (e.message || e);
    }
    return;
  }

  if (newPaths.length) {
    const combined = existingImgs.concat(newPaths);
    entry.images = combined;
    if (!entry.image) entry.image = combined[0];
  }

  // Step 4 & 5: compose note addition and clear needs/fail_reason, set status='pending'
  entry.note = composeInboxAnswerNote(entry.note, editorName, answerText, formatInboxAnswerDate(new Date()));
  entry.needs = null;
  entry.fail_reason = null;
  entry.status = 'pending';

  // Step 6: bridgeSave the entry file
  if (st) st.textContent = 'Saving answer…';
  try {
    await bridgeSave('data/inbox/' + entryId + '.json', JSON.stringify(entry, null, 2), 'Log response ' + entryId);
  } catch (e) {
    if (sendBtn) sendBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (photoBtn) photoBtn.disabled = false;
    if (st) {
      st.className = 'form-status error';
      st.textContent = 'Could not save response: ' + (e.message || e);
    }
    return;
  }

  // Step 7 & 8: re-fetch and patch data/inbox/index.json (with 1 automatic retry)
  const patch = {
    note: entry.note,
    needs: null,
    fail_reason: null,
    status: 'pending'
  };
  if (entry.image) patch.image = entry.image;
  if (Array.isArray(entry.images) && entry.images.length) patch.images = entry.images;

  if (st) st.textContent = 'Updating inbox list…';
  try {
    await syncInboxIndexPatch(entryId, patch, 'Log response index ' + entryId, entry);
  } catch (e) {
    _respondState.savedPatch = patch;
    _respondState.savedEntry = entry;
    if (textEl) textEl.disabled = true;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Retry'; }
    if (cancelBtn) cancelBtn.disabled = false;
    if (st) {
      st.className = 'form-status error';
      st.textContent = 'Your answer was saved to the entry, but updating the list failed (' + (e.message || e) + '). Tap Retry to finish re-queuing it.';
    }
    return;
  }

  // Step 9: success
  closeInboxRespondForm();
  toast('Answer sent — it’ll be picked up within about 30 minutes.');
  await loadInboxList(!!window._inboxShowAll);
}

const _retryPendingIndexPatches = {};

async function retryFailedInboxEntry(entryId, btnEl) {
  if (!entryId) return;
  const stEl = $('#retry-status-' + entryId);
  const row = (window._inboxRowsById || {})[entryId] || { id: entryId };
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Retrying…'; }
  if (stEl) { stEl.style.color = 'var(--muted)'; stEl.textContent = ''; }

  const patch = { status: 'pending', fail_reason: null, needs: null };

  // Step 6 equivalent: update the entry file unless already saved on a prior attempt
  if (!_retryPendingIndexPatches[entryId]) {
    let entry = null;
    try {
      const fetched = await fetchLiveInboxJson('data/inbox/' + entryId + '.json');
      if (fetched && typeof fetched === 'object' && fetched.id) {
        entry = Object.assign({}, row, fetched);
      }
    } catch (e) { /* synthesize below */ }
    if (!entry) {
      entry = Object.assign({}, row, { id: entryId });
    }
    entry.status = 'pending';
    entry.fail_reason = null;
    entry.needs = null;
    try {
      await bridgeSave('data/inbox/' + entryId + '.json', JSON.stringify(entry, null, 2), 'Retry inbox ' + entryId);
      _retryPendingIndexPatches[entryId] = entry;
    } catch (e) {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Retry'; }
      if (stEl) { stEl.style.color = 'var(--danger)'; stEl.textContent = 'Retry failed: ' + (e.message || e); }
      return;
    }
  }

  // Step 7 equivalent: update data/inbox/index.json (with 1 auto-retry)
  try {
    await syncInboxIndexPatch(entryId, patch, 'Retry inbox index ' + entryId, _retryPendingIndexPatches[entryId]);
    delete _retryPendingIndexPatches[entryId];
    toast('Re-queued — it’ll be retried within about 30 minutes.');
    await loadInboxList(!!window._inboxShowAll);
  } catch (e) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Retry'; }
    if (stEl) {
      stEl.style.color = 'var(--danger)';
      stEl.textContent = 'Entry reset, but list update failed — tap Retry again.';
    }
  }
}

async function sendSubmission() {
  const st = $('#submit-status');
  const sendBtn = $('#submit-send');
  const url = $('#s-url').value.trim();
  const note = $('#s-note').value.trim();
  const text = ($('#s-text') || {}).value.trim();
  const photos = Array.isArray(window._submitPhotos) ? window._submitPhotos.slice(0, 6) : [];
  const pdfFile = (($('#s-pdf').files || [])[0] || null);
  if (!url && !photos.length && !text && !pdfFile) {
    st.className = 'form-status error';
    st.textContent = 'Add a link, a photo, a PDF, recipe text, or a combination.';
    return;
  }
  if (sendBtn) sendBtn.disabled = true;
  st.className = 'form-status';
  st.textContent = 'Submitting…';
  const id = 'inbox-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
  try {
    const imagePaths = [];
    for (let i = 0; i < photos.length; i++) {
      st.textContent = 'Submitting photo ' + (i + 1) + ' of ' + photos.length + '…';
      const ext = (photos[i].ext || 'jpg').toLowerCase();
      const pPath = i === 0
        ? ('data/inbox/' + id + '.' + ext)
        : ('data/inbox/' + id + '-p' + (i + 1) + '.' + ext);
      await ghPutB64(pPath, photos[i].b64,
        'Inbox photo ' + id + (photos.length > 1 ? ' (' + (i + 1) + '/' + photos.length + ')' : ''));
      imagePaths.push(pPath);
    }
    // PDF upload: store as-is (no resizing), checker extracts text + renders pages.
    let pdfPath = null;
    if (pdfFile) {
      st.textContent = 'Submitting…';
      if (!pdfFile.size) throw new Error('That PDF didn\u2019t come through — try selecting it again.');
      const pdfB64 = String(await readAsDataURL(pdfFile)).split(',')[1];
      if (!pdfB64) throw new Error('Could not read that PDF — try downloading it first.');
      pdfPath = 'data/inbox/' + id + '.pdf';
      await ghPutB64(pdfPath, pdfB64, 'Inbox PDF ' + id);
    }
    if (photos.length) st.textContent = 'Submitting…';
    const entry = {
      id,
      url: url || null,
      image: imagePaths[0] || null,
      images: imagePaths.length ? imagePaths : null,
      file: pdfPath,
      note: note || null,
      text: text || null,
      status: 'pending',
      created_at: new Date().toISOString(),
      recipe_id: null,
      fail_reason: null
    };
    await ghPut('data/inbox/' + id + '.json', JSON.stringify(entry, null, 2), 'Inbox submission ' + id);
    let idx = [];
    try { idx = JSON.parse((await ghGet('data/inbox/index.json')).text); } catch (e) { idx = []; }
    idx.push(entry);
    await ghPut('data/inbox/index.json', JSON.stringify(idx, null, 2), 'Inbox index ' + id);
    // The bridge throws on HTTP errors, so reaching here means the uploads succeeded.
    // No additional verification needed — GitHub Pages cache would give false negatives.
    st.className = 'form-status ok';
    st.textContent = 'Submitted — it should appear in the collection within about 30 minutes.';
    $('#s-url').value = ''; $('#s-note').value = ''; $('#s-photo').value = '';
    const pdfIn = $('#s-pdf'); if (pdfIn) pdfIn.value = '';
    const pdfH = $('#s-pdf-hint'); if (pdfH) pdfH.textContent = 'A PDF of a recipe — text and layout are both used.';
    const st2 = $('#s-text'); if (st2) st2.value = '';
    const ph = $('#s-photo-hint'); if (ph) ph.textContent = 'A photo of a written recipe, a dish, a cookbook page…';
    clearSubmitDraft();
    updatePhotoPreview();
    if (sendBtn) sendBtn.disabled = false;
    toast('Submitted!');
    loadInboxList();
  } catch (e) {
    if (sendBtn) sendBtn.disabled = false;
    st.className = 'form-status error';
    st.textContent = e.message === 'key'
      ? 'Couldn\u2019t submit — editing isn\u2019t set up yet.'
      : 'Submit failed: ' + e.message;
  }
}

/* ---------------- Go ---------------- */
document.addEventListener('DOMContentLoaded', boot);
