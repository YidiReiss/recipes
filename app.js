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
    if (!metaRes.ok) throw new Error('no metadata');
    const meta = await metaRes.json();
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
    if (editingSlot || document.hidden) return;
    const mp = await fetchLiveMealPlan();
    if (mp && typeof mp.weeks === 'object') {
      // Merge, don't overwrite: preserve local shopping state.
      Object.keys(mp.weeks).forEach(k => {
        const serverWeek = mp.weeks[k];
        const localWeek = mealPlan.weeks[k];
        if (!localWeek || !Array.isArray(localWeek.days)) {
          mealPlan.weeks[k] = serverWeek;
        } else {
          const merged = { ...serverWeek };
          mergeWeekState(merged, localWeek);
          mealPlan.weeks[k] = merged;
        }
      });
      const h = location.hash || '#/';
      if (h === '#/planner' || h === '#/' || h === '') route();
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRefreshPlan(); });
  window.addEventListener('focus', maybeRefreshPlan);
}

/* Re-fetch the meal plan (e.g. after someone else saves). Skips while editing. */
async function refreshMealPlan() {
  if (editingSlot) return;
  const mp = await fetchLiveMealPlan();
  if (!mp) return;
  // Merge, don't overwrite: server wins for days (planner), union for shopping state.
  Object.keys(mp.weeks).forEach(k => {
    const serverWeek = mp.weeks[k];
    const localWeek = mealPlan.weeks[k];
    if (!localWeek || !Array.isArray(localWeek.days)) {
      mealPlan.weeks[k] = serverWeek;
    } else {
      const merged = { ...serverWeek };
      mergeWeekState(merged, localWeek);
      mealPlan.weeks[k] = merged;
    }
  });
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
function buildShoppingList() {
  const mon = sundayOf(0);
  const week = getWeek(thisWeekKey());
  const from = shoppingFromYmd();
  const ids = [];
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
        ids.push(rid);
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
  ids.forEach(id => {
    const r = byId[id];
    if (!r) return;  // not loaded yet (ensurePlannedRecipes fetches before shopping renders)
    (r.ingredients || []).forEach(sec => {
      (sec.items || []).forEach(it => {
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
          e = { base: gkey, unit: unitRaw, qty: 0, hasNum: false, texts: [], isConv: !!convBase, optional: !!it.optional };
          map.set(nkey, e);
        }
        // If any occurrence is required, the whole line is required.
        if (!it.optional) e.optional = false;
        if (convBase !== null) { e.qty += convBase; e.hasNum = true; }
        else {
          const n = qtyToNum(parseQty(it.qty));
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
      const s = ds[m];
      if (!s || s.skipped) return;
      if (s.recipe && recipeMeta(s.recipe)) parts.push(recipeMeta(s.recipe).title);
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
  const marks = normalizeHaveMarks(week.haveGenerated);
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

  // Split into To Buy vs Already Have vs Optional, with quantity-aware splitting:
  // if you checked "1 cup honey" and later need 3 cups total, show
  // "1 cup honey" checked + "2 cups honey" unchecked as separate lines.
  // Optional items: undecided → Optional section; promoted → To Buy; marked → Already Have.
  const toBuy = [];
  const haveIts = [];
  const optionalIts = [];
  const promoted = new Set(week.optionalPromoted || []);
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
  const manToBuy = week.manualItems.filter(m => !m.have);
  const manHave = week.manualItems.filter(m => m.have);

  const conflictBadge = k =>
    conflictKeys.has(k)
      ? '<span class="shop-conflict">⚠️ Both grabbed this — check for duplicates ' +
        '<button class="link-btn" data-confack="' + esc(k) + '" type="button">dismiss</button></span>'
      : '';
  const genToBuyLis = toBuy.map(it =>
    '<div class="shop-item" data-shop="' + esc(it.key) + '"' + (it.split ? ' data-shop-split="' + it.split + '"' : '') + '>' +
      '<button class="shop-have-btn" type="button" aria-label="Mark as have">○</button>' +
      '<span>' + esc(it.label) + '</span></div>'
  ).join('');
  const genHaveLis = haveIts.map(it =>
    '<div class="shop-item have' + (conflictKeys.has(it.key) ? ' conflict' : '') + '" data-shop="' + esc(it.key) + '"' + (it.split ? ' data-shop-split="' + it.split + '"' : '') + '>' +
      '<button class="shop-have-btn" type="button" aria-label="Move back to buy">●</button>' +
      '<span>' + esc(it.label) + '</span>' + conflictBadge(it.key) + '</div>'
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

  let html = '';
  if (!items.length && !week.manualItems.length) {
    html = '<p class="muted">Nothing planned yet' + (from ? ' from the shopping day onward' : '') +
      ' — <a href="#/planner">plan your week</a> and your shopping list builds itself here.</p>';
  } else {
    if (genToBuyLis || manToBuyLis) {
      html += '<h3 class="shop-sub">To buy</h3><div class="shop-list" data-gen="1">' + genToBuyLis + manToBuyLis + '</div>';
    }
    if (optLis) {
      html += '<details class="shop-opt-section"><summary>Optional (' + optionalIts.length + ')</summary>' +
        '<div class="shop-list" data-opt="1">' + optLis + '</div></details>';
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
    '<p class="muted">' + (shoppingFromLabel() || 'Based on your meal plan') + '</p></section>' +
    '<div id="shop-wrap"></div>' +
    '<div class="no-print" style="margin-top:1rem"><a class="link-btn" href="#/planner">← Back to planner</a></div>';

  // Fetch full JSONs for planned recipes only (parallel).
  await ensurePlannedRecipes();
  const wrap = $('#shop-wrap');
  if (wrap) wrap.innerHTML = shoppingListHTML();

  const shopWrap = $('#shop-wrap');
  const saveShop = () => { markShopDirty(); };
  const rerender = () => { $('#shop-wrap').innerHTML = shoppingListHTML(); };
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
        // Promoted optional item: tapping "○" sends it back to Optional.
        const isPromoted = Array.isArray(week.optionalPromoted) && week.optionalPromoted.includes(k);
        if (isPromoted && !existing && split !== 'need') {
          week.optionalPromoted = week.optionalPromoted.filter(x => x !== k);
          markShopDirty(); rerender(); return;
        }
        if (existing && split !== 'need') {
          // Uncheck: remove my mark (tapping the checked portion unchecks all).
          week.haveGenerated = week.haveGenerated.filter(x => !(x.key === k && x.session === sid));
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
            // Update existing mark (split "need" tap) instead of duplicating.
            Object.assign(existing, mark);
          } else {
            week.haveGenerated.push(mark);
          }
        }
        markShopDirty(); rerender(); return;
      }
      if (manItem) {
        const m = (week.manualItems || []).find(x => x.id === manItem.dataset.manual);
        if (m) {
          if (m.have && m.haveSession === sid) {
            m.have = false; m.haveSession = null; m.haveAt = 0; m.haveSessions = [];
          } else {
            m.have = true; m.haveSession = sid; m.haveAt = now;
            if (!Array.isArray(m.haveSessions)) m.haveSessions = [];
            if (!m.haveSessions.includes(sid)) m.haveSessions.push(sid);
          }
        }
        markShopDirty(); rerender(); return;
      }
    }
    // Optional items: "+" promotes to To Buy, "✓" marks Already Have.
    const optAdd = e.target.closest('[data-opt-add]');
    if (optAdd) {
      const week = getWeek(thisWeekKey());
      if (!Array.isArray(week.optionalPromoted)) week.optionalPromoted = [];
      const k = optAdd.dataset.optAdd;
      if (!week.optionalPromoted.includes(k)) week.optionalPromoted.push(k);
      markShopDirty(); rerender(); return;
    }
    const optHave = e.target.closest('[data-opt-have]');
    if (optHave) {
      const week = getWeek(thisWeekKey());
      const sid = getSessionId(), now = Date.now();
      const k = optHave.dataset.optHave;
      week.haveGenerated = normalizeHaveMarks(week.haveGenerated);
      // Remove from promoted if it was there.
      if (Array.isArray(week.optionalPromoted)) {
        week.optionalPromoted = week.optionalPromoted.filter(x => x !== k);
      }
      const line = buildShoppingList().find(it => it.key === k);
      const mark = { key: k, session: sid, at: now };
      if (line && line.qty !== null && line.qty !== undefined) {
        mark.qty = line.qty;
        mark.unit = line.unit || '';
      }
      week.haveGenerated.push(mark);
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
      week.manualItems = (week.manualItems || []).filter(x => x.id !== del.dataset.mandel);
      saveShop(); rerender(); return;
    }
    // Add manual item
    if (e.target.closest('#shop-add')) {
      const input = $('#shop-new');
      const text = (input.value || '').trim();
      if (!text) return;
      const week = getWeek(thisWeekKey());
      if (!Array.isArray(week.manualItems)) week.manualItems = [];
      week.manualItems.push({ id: 'm' + Date.now().toString(36), text, have: false });
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
    const haveKeys = new Set(normalizeHaveMarks(week.haveGenerated).map(m => m.key));
    const toBuy = buildShoppingList().filter(it => !haveKeys.has(it.key));
    const manToBuy = (week.manualItems || []).filter(m => !m.have);
    const lines = toBuy.map(it => '• ' + it.label).concat(manToBuy.map(m => '• ' + m.text));
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
  const haveKeys = new Set(normalizeHaveMarks(week.haveGenerated).map(m => m.key));
  const toBuyCount = items.filter(it => !haveKeys.has(it.key)).length +
    (week.manualItems || []).filter(m => !m.have).length;
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
  if (Array.isArray(q)) return q.length ? Math.max(...q) : null;
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
    app.innerHTML = '<a class="back-link" href="#/">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  document.title = r.title + ' — Reiss Family Recipes';

  // Scale controls: compute on render, embed originals in data attributes.
  // Never re-parse DOM text (avoids compounding drift). Resets to 1x on navigation.
  let scaleState = { factor: 1, servings: r.servings || null };
  const scaleBarHTML = () => {
    const presets = [0.5, 1, 2, 3];
    const presetBtns = presets.map(p =>
      '<button class="scale-btn' + (scaleState.factor === p ? ' active' : '') + '" data-scale="' + p + '" type="button">' + (p === 1 ? '1x' : p + 'x') + '</button>'
    ).join('');
    let servesHTML = '';
    if (scaleState.servings) {
      const curServings = Math.round(scaleState.servings * scaleState.factor);
      servesHTML = '<span class="scale-serves">Serves <button class="scale-step" data-step="-1" type="button" aria-label="Fewer servings">−</button> <span id="scale-servings-val">' + curServings + '</span> <button class="scale-step" data-step="1" type="button" aria-label="More servings">+</button></span>';
    }
    return '<div class="scale-bar no-print">' +
      '<span class="scale-label">Scale:</span> ' + presetBtns + servesHTML +
      '<span class="scale-current" id="scale-current">' +
        (scaleState.factor === 1 ? 'Original recipe' : 'Showing ' + scaleState.factor + 'x' + (scaleState.servings ? ' · ' + Math.round(scaleState.servings * scaleState.factor) + ' servings' : '')) +
      '</span></div>';
  };

  const ingHTML = (r.ingredients || []).map(s =>
    (s.section ? '<h3>' + esc(s.section) + '</h3>' : '') +
    '<ul class="ing-list">' + (s.items || []).map(i =>
      '<li><span class="qty ing-qty" data-base-qty="' + esc(i.qty || '') + '" data-unit="' + esc(i.unit || '') + '">' +
      esc([i.qty, i.unit].filter(Boolean).join(' ')) + '</span> ' +
      '<span class="ing-item" data-base-item="' + esc(i.item || '') + '">' + esc(i.item) + '</span>' +
      (i.optional ? ' <em class="opt-tag">optional</em>' : '') + '</li>'
    ).join('') + '</ul>'
  ).join('');

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
        '<span>Serves <strong id="header-servings-val">' + esc(r.servings || '—') + '</strong></span>' +
      '</div>' +
      '<section class="recipe-section"><h2>Ingredients</h2>' + scaleBarHTML() + ingHTML + '</section>' +
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
        'Showing ' + dispFactor + 'x' + (scaleState.servings ? ' · ' + Math.round(scaleState.servings * f) + ' servings' : '');
    }
    const servVal = app.querySelector('#scale-servings-val');
    const headerServVal = app.querySelector('#header-servings-val');
    if (scaleState.servings) {
      const scaledServings = Math.round(scaleState.servings * f);
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
      if (!scaleState.servings) return;
      const step = parseInt(btn.dataset.step, 10);
      if (isNaN(step)) return;
      const curServings = Math.round(scaleState.servings * scaleState.factor);
      const newServings = Math.max(1, curServings + step);
      // Compute factor from target servings — no rounding, no precision loss.
      scaleState.factor = newServings / scaleState.servings;
      applyScale();
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

/* ---------------- Delete recipe ----------------
   Two-step: #/delete/<id> shows a confirmation page (never a bare
   confirm dialog). Confirm deletes the JSON + PDF via the bridge
   and removes the ID from the index, then returns to the list. */
async function renderDelete(app, id) {
  const r = await ensureRecipe(id);
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/">← All recipes</a>' +
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
    app.innerHTML = '<a class="back-link" href="#/">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  editDraft = normalizeDraft(JSON.parse(JSON.stringify(r))); // working copy
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
      // Update the inbox index
      const idxRes = await fetch('data/inbox/index.json?v=' + Date.now());
      let idx = idxRes.ok ? await idxRes.json() : [];
      idx.push({ id: entryId, status: 'pending', type: 'edit', edit_target: recipeId,
        created_at: entry.created_at });
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
    '<a class="back-link no-print" href="#/">← All recipes</a>' +
    '<h1 class="recipe-title">Add recipe</h1>' +
    recipeFormHTML(editDraft, '#/');
  wireRecipeForm(saveNewRecipe);
}

function wireRecipeForm(onSave) {
  drawIngEditor();
  drawStepsEditor();
  drawPairEditor();
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
      '<div class="mini-row ing-header">' +
        '<span class="qty">Qty</span><span class="unit">Unit</span>' +
        '<span class="ing-name">Ingredient</span><span class="prep">Prep</span><span class="ing-opt">Opt?</span><span class="ing-x"></span>' +
      '</div>' +
      (s.items || []).map((it, ii) =>
        '<div class="mini-row">' +
          '<input class="qty" type="text" data-item="' + si + '|' + ii + '|qty" value="' + esc(it.qty || '') + '" placeholder="Qty" aria-label="Quantity">' +
          '<input class="unit" type="text" data-item="' + si + '|' + ii + '|unit" value="' + esc(it.unit || '') + '" placeholder="Unit" aria-label="Unit">' +
          '<input type="text" data-item="' + si + '|' + ii + '|item" value="' + esc(it.item || '') + '" placeholder="Ingredient" aria-label="Ingredient">' +
          '<input type="text" data-item="' + si + '|' + ii + '|prep" value="' + esc(it.prep || '') + '" placeholder="Prep (sliced, diced…)" aria-label="Prep">' +
          '<input class="ing-opt-check" type="checkbox" data-item="' + si + '|' + ii + '|optional"' + (it.optional ? ' checked' : '') + ' aria-label="Optional" title="Optional">' +
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
    await maybeUploadPhoto(d);
    await ghPut('data/recipes/' + id + '.json', JSON.stringify(d, null, 2), 'Update recipe: ' + d.title);
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
    // Log the direct edit in Recent submissions.
    try {
      const entryId = 'edit-' + Date.now().toString(36);
      const entry = {
        id: entryId, type: 'direct-edit', edit_target: id,
        text: null, url: null, image: null, note: 'Direct edit via site',
        status: 'done', created_at: new Date().toISOString(),
        recipe_id: id, fail_reason: null
      };
      await ghPut('data/inbox/' + entryId + '.json', JSON.stringify(entry, null, 2),
        'Direct edit log: ' + d.title);
      const inboxRes = await fetch('data/inbox/index.json?v=' + Date.now());
      let inboxIdx = inboxRes.ok ? await inboxRes.json() : [];
      inboxIdx.push({ id: entryId, status: 'done', type: 'direct-edit',
        edit_target: id, created_at: entry.created_at });
      await ghPut('data/inbox/index.json', JSON.stringify(inboxIdx, null, 2),
        'Direct edit log index: ' + entryId);
    } catch (e) { console.warn('edit log failed', e); }
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
    await maybeUploadPhoto(d);
    await ghPut('data/recipes/' + id + '.json', JSON.stringify(d, null, 2), 'Add recipe: ' + d.title);
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
        dishBody = '<a href="#/recipe/' + encodeURIComponent(meta.id) + '">' + esc(meta.title) + '</a>';
      } else if (dish.custom) {
        dishBody = '<span class="slot-custom">' + esc(dish.custom) + '</span>';
      } else {
        dishBody = '<span class="slot-skipped">—</span>';
      }
      if (dish.leftovers) dishBody += ' <span class="badge leftovers">Leftovers</span>';
      if (dish.cookDate) dishBody += ' <span class="slot-note">(cook ' + esc(dish.cookDate) + ')</span>';
      const editBtn = canEdit
        ? ' <button class="link-btn" data-dishedit="' + key + '|' + di + '|' + meal + '|' + idx + '" type="button">Edit</button>'
        : '';
      return '<div class="dish-row">' + dishBody + editBtn + '</div>';
    }).join('');
    if (s.note) body += ' <span class="slot-note">— ' + esc(s.note) + '</span>';
  } else {
    body = '<span class="slot-skipped">—</span>';
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
    if (t.dataset.clear) {
      const [k, di, meal] = t.dataset.clear.split('|');
      getWeek(k).days[+di][meal] = blankSlot();
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
// Union shopping state from `source` week into `target` week (in place).
// Used everywhere we combine local + server state so neither side wipes the other.
function mergeWeekState(target, source) {
  if (!target || !source) return target;
  const tMarks = normalizeHaveMarks(target.haveGenerated);
  const seen = new Set(tMarks.map(m => m.key + '|' + m.session));
  normalizeHaveMarks(source.haveGenerated).forEach(m => {
    const id = m.key + '|' + m.session;
    if (!seen.has(id)) { tMarks.push(m); seen.add(id); }
  });
  target.haveGenerated = tMarks;
  const tManual = Array.isArray(target.manualItems) ? target.manualItems : (target.manualItems = []);
  const seenId = new Set(tManual.map(m => m.id));
  (Array.isArray(source.manualItems) ? source.manualItems : []).forEach(m => {
    if (m.id && !seenId.has(m.id)) { tManual.push(m); seenId.add(m.id); }
  });
  if (source.conflictAcked) {
    target.conflictAcked = { ...(target.conflictAcked || {}), ...source.conflictAcked };
  }
  // Merge optional promotions (union) so a promotion isn't lost in sync.
  const tPromoted = new Set(Array.isArray(target.optionalPromoted) ? target.optionalPromoted : []);
  (Array.isArray(source.optionalPromoted) ? source.optionalPromoted : []).forEach(k => tPromoted.add(k));
  target.optionalPromoted = [...tPromoted];
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
        // Merge, don't overwrite: local offline taps union with the server copy.
        Object.keys(lp.weeks).forEach(k => {
          mergeWeekState(getWeek(k), lp.weeks[k]);
        });
        // Persist the merged state so localStorage never goes stale.
        try { localStorage.setItem(SHOP_LOCAL_KEY, JSON.stringify(mealPlan)); } catch (e) {}
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
  // Pull + merge FIRST so we push the union (both devices' marks), never a stale overwrite.
  await pollShopServer();
  try {
    await ghPut('data/meal-plan.json', JSON.stringify(mealPlan, null, 2), 'Shopping list sync');
    _shopDirty = false;
  } catch (e) {
    _shopDirty = true;  // push failed — retry on next poll / online event
  }
}
// Poll server state via worker /read (bypasses Pages rebuild). Merges have-marks.
async function pollShopServer() {
  try {
    const r = await fetch(BRIDGE + '/read?path=' + encodeURIComponent('data/meal-plan.json'));
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok || !data.content) return;
    const server = JSON.parse(data.content);
    if (!server || typeof server.weeks !== 'object') return;
    const key = thisWeekKey();
    const localWeek = getWeek(key);
    const serverWeek = (server.weeks || {})[key];
    if (!serverWeek) return;
    // Merge have-marks: union by (key, session)
    const localMarks = normalizeHaveMarks(localWeek.haveGenerated);
    const serverMarks = normalizeHaveMarks(serverWeek.haveGenerated);
    const seen = new Set(localMarks.map(m => m.key + '|' + m.session));
    serverMarks.forEach(m => {
      if (!seen.has(m.key + '|' + m.session)) localMarks.push(m);
    });
    localWeek.haveGenerated = localMarks;
    // Merge manual items
    (serverWeek.manualItems || []).forEach(sm => {
      const lm = (localWeek.manualItems || []).find(x => x.id === sm.id);
      if (!lm) {
        localWeek.manualItems.push(sm);
      } else if (sm.have && !lm.have) {
        lm.have = true; lm.haveSession = sm.haveSession; lm.haveAt = sm.haveAt;
        lm.haveSessions = [...new Set([...(lm.haveSessions || []), ...(sm.haveSessions || [])])];
      } else if (sm.have && lm.have) {
        lm.haveSessions = [...new Set([...(lm.haveSessions || []), ...(sm.haveSessions || [])])];
      }
    });
    // Merge conflict acks
    if (serverWeek.conflictAcked) {
      localWeek.conflictAcked = { ...(localWeek.conflictAcked || {}), ...serverWeek.conflictAcked };
    }
    saveShopLocal();
    // Re-render if we're on the shopping page
    if ((location.hash || '#/') === '#/shopping' && $('#shop-wrap')) {
      $('#shop-wrap').innerHTML = shoppingListHTML();
    }
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
  try {
    const draft = {
      url: ($('#s-url') || {}).value || '',
      note: ($('#s-note') || {}).value || '',
      text: ($('#s-text') || {}).value || '',
      photoB64: window._submitPhotoB64 || null,
      photoName: window._submitPhotoName || null
    };
    localStorage.setItem(SUBMIT_DRAFT_KEY, JSON.stringify(draft));
  } catch (e) { /* storage full or unavailable — non-fatal */ }
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
  window._submitPhotoB64 = null;
  window._submitPhotoName = null;
}
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
      '<div class="field"><label>Photo (optional)</label>' +
        '<input type="file" id="s-photo" accept="image/*" style="display:none">' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<button class="btn secondary" id="s-choose-btn" type="button">🖼️ Choose photo</button>' +
          '<button class="btn secondary" id="s-camera-btn" type="button">📷 Take photo</button></div>' +
        '<div class="form-hint" id="s-photo-hint">A photo of a written recipe, a dish, a cookbook page…</div></div>' +
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
  // Single photo input; buttons toggle the capture attribute.
  // "Choose photo" (no capture) → OS shows gallery/files/camera chooser.
  // "Take photo" (capture=environment) → OS goes straight to camera.
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
      const file = (photoInput.files || [])[0];
      if (!file) return;
      if (photoHint) photoHint.textContent = 'Processing photo…';
      await processPhotoFile(file);
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
  loadInboxList();
}

/* Shared photo processing: resize to 1600px JPEG, stash base64 in memory
   + localStorage draft, update the hint and preview. */
async function processPhotoFile(file, nameOverride) {
  const photoHint = $('#s-photo-hint');
  try {
    const dataUrl = await readAsDataURL(file);
    const img = await loadImage(dataUrl);
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('decode failed');
    const resizedDataUrl = await readAsDataURL(blob);
    window._submitPhotoB64 = resizedDataUrl.split(',')[1];
    window._submitPhotoName = nameOverride || file.name || 'photo.jpg';
  } catch (e) {
    try {
      const raw = String(await readAsDataURL(file)).split(',');
      window._submitPhotoB64 = raw[1] || null;
      window._submitPhotoName = nameOverride || file.name || 'photo.jpg';
    } catch (e2) {
      window._submitPhotoB64 = null;
    }
  }
  saveSubmitDraft();
  if (photoHint) {
    photoHint.textContent = window._submitPhotoB64
      ? 'Photo ready: ' + (window._submitPhotoName || 'photo')
      : 'Could not read that photo — try again.';
  }
  updatePhotoPreview();
}

/* In-page camera: uses getUserMedia so the tab never leaves the page.
   (The file-input capture approach lets Android kill the tab.) */
let _camStream = null;
async function openInPageCamera() {
  const photoHint = $('#s-photo-hint');
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
      await processPhotoFile(blob, 'camera-photo.jpg');
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
  const draft = loadSubmitDraft();
  if (!draft) return;
  const urlInput = $('#s-url'), noteInput = $('#s-note'), textInput = $('#s-text'), photoHint = $('#s-photo-hint');
  if (draft.url && urlInput) urlInput.value = draft.url;
  if (draft.note && noteInput) noteInput.value = draft.note;
  if (draft.text && textInput) textInput.value = draft.text;
  if (draft.photoB64) {
    window._submitPhotoB64 = draft.photoB64;
    window._submitPhotoName = draft.photoName || 'photo.jpg';
    if (photoHint) photoHint.textContent = 'Photo ready: ' + window._submitPhotoName + ' (restored)';
  }
  updatePhotoPreview();
}
function updatePhotoPreview() {
  let prev = $('#s-photo-preview');
  let rmBtn = $('#s-photo-remove');
  const hint = $('#s-photo-hint');
  if (window._submitPhotoB64) {
    const src = 'data:image/jpeg;base64,' + window._submitPhotoB64;
    if (!prev && hint) {
      const wrap = document.createElement('div');
      wrap.id = 's-photo-preview-wrap';
      wrap.style.cssText = 'position:relative;display:inline-block;margin-top:.5rem';
      prev = document.createElement('img');
      prev.id = 's-photo-preview';
      prev.style.cssText = 'max-width:120px;border-radius:8px;display:block';
      rmBtn = document.createElement('button');
      rmBtn.id = 's-photo-remove';
      rmBtn.type = 'button';
      rmBtn.textContent = '×';
      rmBtn.setAttribute('aria-label', 'Remove photo');
      rmBtn.style.cssText = 'position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;' +
        'background:#a03d1a;color:#fff;border:none;font-size:16px;line-height:1;cursor:pointer';
      rmBtn.onclick = removeSubmitPhoto;
      wrap.appendChild(prev);
      wrap.appendChild(rmBtn);
      hint.parentElement.appendChild(wrap);
    }
    if (prev) { prev.src = src; prev.style.display = 'block'; }
    const wrap = $('#s-photo-preview-wrap');
    if (wrap) wrap.style.display = 'inline-block';
  } else {
    const wrap = $('#s-photo-preview-wrap');
    if (wrap) wrap.style.display = 'none';
  }
}
function removeSubmitPhoto() {
  window._submitPhotoB64 = null;
  window._submitPhotoName = null;
  saveSubmitDraft();
  updatePhotoPreview();
  const hint = $('#s-photo-hint');
  if (hint) hint.textContent = 'A photo of a written recipe, a dish, a cookbook page…';
  const photoInput = $('#s-photo');
  if (photoInput) photoInput.value = '';
}
async function loadInboxList() {
  const host = $('#inbox-list');
  if (!host) return;
  let idx = [];
  try {
    // Cache-buster: GitHub Pages aggressively caches JSON
    const r = await fetch('data/inbox/index.json?v=' + Date.now());
    if (r.ok) idx = await r.json();
  } catch (e) { /* no inbox yet */ }
  // Refresh the list every 60s while the submit page is open,
  // so entries update when the checker processes them.
  if (!window._inboxRefreshTimer) {
    window._inboxRefreshTimer = setInterval(() => {
      if (document.getElementById('inbox-list')) loadInboxList();
      else { clearInterval(window._inboxRefreshTimer); window._inboxRefreshTimer = null; }
    }, 60000);
  }
  if (!idx.length) {
    host.innerHTML = '<p>Nothing submitted yet.</p>';
    return;
  }
  const badge = s => s === 'done' ? '✓ added'
    : s === 'failed' ? '⚠ needs attention'
    : s === 'duplicate' ? '⧉ duplicate — skipped'
    : s === 'needs_input' ? '? needs your input'
    : s === 'working' ? '… working on it' : '… in the inbox';
  // For edit requests, fetch the full entry to show the request text
  const editDetails = {};
  for (const s of idx.slice(-10)) {
    if (s.type === 'edit') {
      try {
        const r = await fetch('data/inbox/' + s.id + '.json?v=' + Date.now());
        if (r.ok) editDetails[s.id] = await r.json();
      } catch (e) { /* skip */ }
    }
  }
  host.innerHTML = '<ul class="pairing-list">' + idx.slice(-10).reverse().map(s => {
    // Edit requests get special display
    if (s.type === 'edit') {
      const full = editDetails[s.id] || {};
      const targetTitle = s.edit_target && recipeMeta(s.edit_target) ? recipeMeta(s.edit_target).title : (s.edit_target || 'recipe');
      const reqText = full.text || '';
      const preview = reqText.length > 100 ? reqText.slice(0, 97) + '…' : reqText;
      const editBadge = s.status === 'done' ? '✓ applied' : badge(s.status);
      return '<li><strong>✏️ Edit: ' + esc(targetTitle) + '</strong> — ' + editBadge +
        (preview ? '<br><span style="color:var(--muted)">"' + esc(preview) + '"</span>' : '') +
        (s.status === 'done' && s.edit_target ?
          ' → <a href="#/recipe/' + encodeURIComponent(s.edit_target) + '">view recipe</a>' : '') +
        (s.fail_reason ? ' <span style="color:var(--danger)">' + esc(s.fail_reason) + '</span>' : '') +
        '</li>';
    }
    // Direct edits (via site edit page) and deletions get their own display
    if (s.type === 'direct-edit') {
      const targetTitle = s.edit_target && recipeMeta(s.edit_target) ? recipeMeta(s.edit_target).title : (s.edit_target || 'recipe');
      return '<li><strong>✏️ Edited: ' + esc(targetTitle) + '</strong> — ✓ saved' +
        (s.edit_target ?
          ' → <a href="#/recipe/' + encodeURIComponent(s.edit_target) + '">view recipe</a>' : '') +
        '</li>';
    }
    if (s.type === 'delete') {
      const targetTitle = s.note ? s.note.replace(/^Deleted via site: /, '') : (s.edit_target || 'recipe');
      return '<li><strong>🗑️ Deleted: ' + esc(targetTitle) + '</strong> — ✓ removed</li>';
    }
    // Show the recipe title once it's processed
    let titlePart = '';
    if (s.recipe_id && recipeMeta(s.recipe_id)) {
      titlePart = ' → <a href="#/recipe/' + encodeURIComponent(s.recipe_id) + '">' +
        esc(recipeMeta(s.recipe_id).title) + '</a>';
    } else if (s.recipe_id) {
      titlePart = ' → <a href="#/recipe/' + encodeURIComponent(s.recipe_id) + '">view recipe</a>';
    }
    // Show what was submitted — list each piece: link, photo filename, text, note
    const parts = [];
    if (s.url) {
      const shortUrl = s.url.length > 60 ? s.url.slice(0, 57) + '…' : s.url;
      parts.push('🔗 <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(shortUrl) + '</a>');
    }
    if (s.image) {
      const fname = s.image.split('/').pop();
      parts.push('📷 ' + esc(fname));
    }
    if (s.text) {
      const preview = s.text.length > 80 ? s.text.slice(0, 77) + '…' : s.text;
      parts.push('📝 <span title="' + esc(s.text.slice(0, 500)) + '">' + esc(preview) + '</span>');
    }
    if (s.note) parts.push('💬 ' + esc(s.note));
    const what = parts.length ? parts.join(' · ') : 'empty submission';
    // For duplicates, show what it's a duplicate of
    let dupPart = '';
    if (s.status === 'duplicate' && s.duplicate_of) {
      const dupTitle = recipeMeta(s.duplicate_of) ? esc(recipeMeta(s.duplicate_of).title) : esc(s.duplicate_of);
      dupPart = ' (duplicate of ' + dupTitle + ')';
    }
    return '<li><strong>' + badge(s.status) + '</strong> — ' + what + titlePart + dupPart +
      (s.fail_reason ? ' <span style="color:var(--danger)">' + esc(s.fail_reason) + '</span>' : '') +
      '</li>';
  }).join('') + '</ul>';
}

async function sendSubmission() {
  const st = $('#submit-status');
  const url = $('#s-url').value.trim();
  const note = $('#s-note').value.trim();
  const text = ($('#s-text') || {}).value.trim();
  // Photo comes from the draft (saved when selected, survives tab death).
  // Falls back to the file input if the draft is empty (e.g. very old flow).
  let b64 = window._submitPhotoB64 || null;
  let photoName = window._submitPhotoName || 'photo.jpg';
  const file = (($('#s-photo').files || [])[0] || null);
  if (!url && !b64 && !file && !text) {
    st.className = 'form-status error';
    st.textContent = 'Add a link, a photo, recipe text, or a combination.';
    return;
  }
  st.className = 'form-status';
  st.textContent = 'Submitting…';
  const id = 'inbox-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
  try {
    let imagePath = null;
    if (b64) {
      // Already resized when the photo was selected.
      imagePath = 'data/inbox/' + id + '.jpg';
      await ghPutB64(imagePath, b64, 'Inbox photo ' + id);
    } else if (file) {
      // Fallback: read from the file input directly.
      if (!file.size) throw new Error('That photo didn\u2019t come through — try selecting it again.');
      let fb64 = null, ext = 'jpg';
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
        fb64 = String(await readAsDataURL(blob)).split(',')[1];
      } catch (e) {
        const raw = String(await readAsDataURL(file)).split(',');
        if (!raw[1]) throw new Error('Could not read that photo — try downloading it as a JPG first.');
        fb64 = raw[1];
        const mt = (file.type || '').toLowerCase();
        ext = mt.includes('png') ? 'png' : mt.includes('heic') ? 'heic' : mt.includes('webp') ? 'webp' : 'jpg';
      }
      imagePath = 'data/inbox/' + id + '.' + ext;
      await ghPutB64(imagePath, fb64, 'Inbox photo ' + id);
    }
    const entry = {
      id, url: url || null, image: imagePath, note: note || null, text: text || null,
      status: 'pending', created_at: new Date().toISOString(),
      recipe_id: null, fail_reason: null
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
    const st2 = $('#s-text'); if (st2) st2.value = '';
    const ph = $('#s-photo-hint'); if (ph) ph.textContent = 'A photo of a written recipe, a dish, a cookbook page…';
    clearSubmitDraft();
    updatePhotoPreview();
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
