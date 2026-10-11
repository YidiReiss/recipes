/* ============================================================
   Reiss Family Recipes — app
   Vanilla JS. No frameworks, no CDNs, no build step.

   Data lives in the repo:
     data/recipes/index.json      -> ["id", ...] manifest
     data/recipes/<id>.json       -> one recipe per file
     data/meal-plan.json          -> { weeks: { "YYYY-MM-DD": {...} } }

   Editing + meal planner persist through the GitHub Contents API
   using an editor key (fine-grained token) stored in localStorage.
   ============================================================ */
'use strict';

/* ---------------- Config ---------------- */
const REPO = { owner: 'YidiReiss', repo: 'recipes', branch: 'main' };
const LS_KEY = 'rc_editor_key'; // editor key lives only in this browser
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

/* ---------------- Editor key ---------------- */
const editorKey = () => localStorage.getItem(LS_KEY) || '';
const editingEnabled = () => !!editorKey();

function updateEditToggle() {
  const b = $('#edit-toggle');
  const on = editingEnabled();
  b.textContent = on ? 'Editing on ✓' : 'Enable editing';
  b.classList.toggle('on', on);
}

function openKeyModal() {
  closeModal();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.id = 'modal';
  bd.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="Enable editing">' +
      '<h2>Enable editing</h2>' +
      '<p>Paste your editor key below. It is stored only in this browser, ' +
      'and only this device will show edit controls.</p>' +
      '<div class="form-status" id="key-status"></div>' +
      '<input type="password" id="key-input" placeholder="Editor key" autocomplete="off">' +
      '<div class="modal-actions">' +
        '<button class="btn secondary" id="key-cancel" type="button">Cancel</button>' +
        '<button class="btn" id="key-save" type="button">Save</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(bd);
  $('#key-cancel').onclick = closeModal;
  bd.addEventListener('click', e => { if (e.target === bd) closeModal(); });
  $('#key-save').onclick = async () => {
    const v = $('#key-input').value.trim();
    if (!v) return;
    const st = $('#key-status');
    st.className = 'form-status';
    st.textContent = 'Checking…';
    try {
      // Validates the token itself; the recipes repo may not exist yet.
      const res = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': 'Bearer ' + v, 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error('bad');
      localStorage.setItem(LS_KEY, v);
      closeModal();
      updateEditToggle();
      route();
      toast('Editing enabled on this device.');
    } catch (e) {
      st.className = 'form-status error';
      st.textContent = 'That key didn’t work. Check it and try again.';
    }
  };
  setTimeout(() => { const i = $('#key-input'); if (i) i.focus(); }, 50);
}

/* ---------------- GitHub Contents API ---------------- */
const GH = 'https://api.github.com';

async function ghGet(path) {
  const res = await fetch(
    GH + '/repos/' + REPO.owner + '/' + REPO.repo + '/contents/' + path +
    '?ref=' + encodeURIComponent(REPO.branch),
    { headers: { 'Authorization': 'Bearer ' + editorKey(), 'Accept': 'application/vnd.github+json' } }
  );
  if (res.status === 401) throw new Error('key');
  if (res.status === 404) throw new Error('missing'); // file doesn't exist yet
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return { sha: j.sha, text: fromB64(j.content || '') };
}

async function ghPut(path, text, message) {
  let sha = null;
  try {
    const got = await ghGet(path);
    sha = got.sha;
  } catch (e) {
    if (e.message === 'key') throw e; // bad key / repo — surface it
    sha = null; // file may not exist yet -> create it
  }
  const url = GH + '/repos/' + REPO.owner + '/' + REPO.repo + '/contents/' + path;
  const headers = {
    'Authorization': 'Bearer ' + editorKey(),
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
  const send = s => fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(Object.assign(
      { message, content: toB64(text), branch: REPO.branch },
      s ? { sha: s } : {}
    ))
  });
  let res = await send(sha);
  if (res.status === 401 || res.status === 404) throw new Error('key');
  if ((res.status === 409 || res.status === 422) && sha) {
    // SHA conflict (someone else saved first): re-fetch once and retry.
    const fresh = await ghGet(path);
    res = await send(fresh.sha);
    if (res.status === 401 || res.status === 404) throw new Error('key');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
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
  $('#edit-toggle').addEventListener('click', () => {
    if (editingEnabled()) {
      localStorage.removeItem(LS_KEY);
      updateEditToggle();
      route();
      toast('Editing disabled on this device.');
    } else {
      openKeyModal();
    }
  });

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

  updateEditToggle();
  window.addEventListener('hashchange', route);
  route();
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
  if (h === '#/planner') return renderPlanner(app);
  return renderHome(app);
}

/* ---------------- Home: search / filter / grid ---------------- */
const allTags = () => [...new Set(recipes.flatMap(r => r.tags || []))].sort();
const allCats = () => [...new Set(recipes.flatMap(r => r.categories || []))].sort();

function renderHome(app) {
  const tags = allTags(), cats = allCats();
  app.innerHTML =
    '<div class="search-row no-print">' +
      '<input type="search" id="q" placeholder="Search recipes, ingredients, tags…" ' +
      'value="' + esc(filters.q) + '" aria-label="Search recipes"></div>' +
    '<div class="filters no-print">' +
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
    '<div class="card-grid" id="grid"></div>';

  $('#q').addEventListener('input', e => { filters.q = e.target.value; drawGrid(); });
  $('#f-kosher').addEventListener('change', e => { filters.kosher = e.target.value; drawGrid(); });
  $('#f-cat').addEventListener('change', e => { filters.category = e.target.value; drawGrid(); });
  $('#f-tag').addEventListener('change', e => { filters.tag = e.target.value; drawGrid(); });
  $('#f-time').addEventListener('change', e => { filters.maxTime = Number(e.target.value); drawGrid(); });
  $('#f-sort').addEventListener('change', e => { filters.sort = e.target.value; drawGrid(); });
  $('#f-kfp').addEventListener('change', e => { filters.kfp = e.target.checked; drawGrid(); });
  $('#f-left').addEventListener('change', e => { filters.leftovers = e.target.checked; drawGrid(); });
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
  const canEdit = editingEnabled();

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
        (canEdit ? '<a class="btn secondary" href="#/edit/' + encodeURIComponent(r.id) + '">Edit</a>' : '') +
        '<button class="btn secondary" id="share-btn" type="button">Share</button>' +
        '<button class="btn" id="print-btn" type="button">Print / PDF</button>' +
      '</div>' +
    '</article>';

  $('#share-btn').onclick = () => shareRecipe(r);
  $('#print-btn').onclick = () => window.print();
}

async function shareRecipe(r) {
  const url = location.href; // includes #/recipe/<id>; no login gate, so links work for everyone
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
function renderEdit(app, id) {
  const r = byId[id];
  if (!r) {
    app.innerHTML = '<a class="back-link" href="#/">← All recipes</a>' +
      '<div class="empty-state"><h2>Recipe not found</h2></div>';
    return;
  }
  if (!editingEnabled()) {
    app.innerHTML =
      '<a class="back-link" href="#/recipe/' + encodeURIComponent(id) + '">← Back to recipe</a>' +
      '<div class="planner-locked"><strong>Editing is disabled on this device.</strong><br>' +
      'Use “Enable editing” (top right) and paste your editor key first.</div>';
    return;
  }
  editDraft = JSON.parse(JSON.stringify(r)); // working copy
  // Normalize optional fields so real recipes with missing keys still edit cleanly.
  editDraft.ingredients = editDraft.ingredients || [];
  editDraft.instructions = editDraft.instructions || [];
  editDraft.pairings = editDraft.pairings || [];
  editDraft.tags = editDraft.tags || [];
  editDraft.categories = editDraft.categories || [];
  document.title = 'Edit: ' + r.title + ' — Reiss Family Recipes';

  app.innerHTML =
    '<a class="back-link no-print" href="#/recipe/' + encodeURIComponent(id) + '">← Back to recipe</a>' +
    '<h1 class="recipe-title">Edit recipe</h1>' +
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
        '<a class="btn secondary" href="#/recipe/' + encodeURIComponent(id) + '">Cancel</a>' +
      '</div>' +
    '</form>';

  drawIngEditor();
  drawStepsEditor();
  drawPairEditor();
  $('#ing-add-sec').onclick = () => {
    editDraft.ingredients.push({ section: '', items: [{ qty: '', unit: '', item: '' }] });
    drawIngEditor();
  };
  $('#step-add').onclick = () => { editDraft.instructions.push(''); drawStepsEditor(); };
  $('#pair-add').onclick = () => { editDraft.pairings.push({ recipe_id: '', note: '' }); drawPairEditor(); };
  $('#edit-save').onclick = () => saveRecipe(id);
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
  host.innerHTML = editDraft.instructions.map((s, i) =>
    '<div class="dynamic-block"><div class="mini-row">' +
      '<input type="text" data-step="' + i + '" value="' + esc(s) + '" placeholder="Step ' + (i + 1) + '" aria-label="Step ' + (i + 1) + '">' +
      '<button class="link-btn danger" data-stepdel="' + i + '" type="button">✕</button>' +
    '</div></div>'
  ).join('');
  host.querySelectorAll('[data-step]').forEach(el =>
    el.addEventListener('input', e => { editDraft.instructions[+e.target.dataset.step] = e.target.value; }));
  host.querySelectorAll('[data-stepdel]').forEach(el =>
    el.addEventListener('click', e => { editDraft.instructions.splice(+e.target.dataset.stepdel, 1); drawStepsEditor(); }));
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
  d.leftover_note = $('#e-leftnote').value.trim();
  d.notes = $('#e-notes').value.trim();
  d.source = $('#e-source').value.trim();
  // ingredients / instructions / pairings already live in the draft via input sync;
  // drop empties so the JSON stays clean.
  d.ingredients = d.ingredients
    .map(s => ({ section: s.section.trim(), items: s.items.filter(i => i.item.trim()) }))
    .filter(s => s.items.length);
  d.instructions = d.instructions.map(s => s.trim()).filter(Boolean);
  d.pairings = d.pairings.filter(p => p.recipe_id);

  if (!d.title) {
    st.className = 'form-status error';
    st.textContent = 'Give the recipe a title first.';
    return;
  }
  st.className = 'form-status';
  st.textContent = 'Saving…';
  try {
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
      ? 'Editor key invalid. Re-enter it via “Enable editing”.'
      : 'Save failed: ' + e.message;
  }
}

/* ---------------- Meal planner ---------------- */
const blankSlot = () => ({ recipe: null, skipped: false, note: '' });

function mondayOf(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
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
  } else {
    body = '<span class="slot-skipped">—</span>';
  }
  const has = slot.recipe || slot.skipped || slot.note;
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
  const opts = recipes.length
    ? '<option value="">—</option>' + recipes.map(r =>
        '<option value="' + esc(r.id) + '"' + (slot.recipe === r.id ? ' selected' : '') + '>' +
        esc(r.title) + '</option>').join('')
    : '<option value="">—</option>';
  return '<div class="slot-editor">' +
    '<select id="se-recipe"' + (recipes.length ? '' : ' disabled') + ' aria-label="Recipe">' + opts + '</select>' +
    (recipes.length ? '' : '<div class="slot-note">No recipes yet — add one first.</div>') +
    '<label><input type="checkbox" id="se-skipped"' + (slot.skipped ? ' checked' : '') + '> Skipped</label> ' +
    '<input type="text" id="se-note" placeholder="Note (optional)" value="' + esc(slot.note || '') + '">' +
    '<div><button class="btn" id="se-save" type="button">Save</button> ' +
    '<button class="btn secondary" id="se-cancel" type="button">Cancel</button></div>' +
    '<div class="form-status" id="se-status"></div></div>';
}

function renderPlanner(app) {
  document.title = 'Meal Planner — Reiss Family Recipes';
  const mon = mondayOf(plannerOffset);
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
      slotHTML(key, i, 'lunch', ds.lunch, canEdit, i === 5) +   // Saturday lunch = Shabbat
      slotHTML(key, i, 'dinner', ds.dinner, canEdit, i === 4) + // Friday dinner = Shabbat
      '</div>';
  }

  app.innerHTML =
    '<div class="planner-nav no-print">' +
      '<button class="btn secondary" id="wk-prev" type="button">‹ Prev</button>' +
      '<h2>' + esc(label) + '</h2>' +
      '<button class="btn secondary" id="wk-next" type="button">Next ›</button>' +
    '</div>' +
    (plannerOffset !== 0
      ? '<div class="no-print" style="text-align:center;margin-bottom:1rem">' +
        '<button class="link-btn" id="wk-today" type="button">Back to this week</button></div>'
      : '') +
    (canEdit ? '' :
      '<div class="planner-locked no-print">Enable editing (top right) to plan meals. ' +
      'The plan is shared — you both see the same week.</div>') +
    '<div id="days">' + days + '</div>';

  $('#wk-prev').onclick = () => { plannerOffset--; renderPlanner(app); };
  $('#wk-next').onclick = () => { plannerOffset++; renderPlanner(app); };
  const today = $('#wk-today');
  if (today) today.onclick = () => { plannerOffset = 0; renderPlanner(app); };

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
}

function saveSlot(key) {
  const st = $('#se-status');
  const slot = getWeek(key).days[editingSlot.di][editingSlot.meal];
  slot.recipe = $('#se-recipe').value || null;
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
      ? 'Editor key invalid. Re-enter it via “Enable editing”.'
      : 'Save failed: ' + e.message;
    if (statusEl) { statusEl.className = 'form-status error'; statusEl.textContent = msg; }
    else toast(msg);
  }
}

/* ---------------- Go ---------------- */
document.addEventListener('DOMContentLoaded', boot);
