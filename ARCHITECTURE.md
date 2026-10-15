# Reiss Family Recipes — Architecture

## Overview
A recipe collection site for Yidi and Nava Reiss. Vanilla HTML/CSS/JS, no build step, no login gate. Hosted on GitHub Pages at https://yidireiss.github.io/recipes/.

## Components

### 1. Static Site (`site/`)
- `index.html` — Single-page app shell. Loads `app.js` with a cache-busting version query.
- `app.js` (~2,100 lines) — All client logic: routing, recipe list, recipe detail, meal planner, shopping list, submit page, manual editor, inbox log.
- `styles.css` (~950 lines) — All styling, mobile-first.

**Data loading:** On boot, fetches `data/recipes/index.json` (list of IDs), then fetches each `data/recipes/<id>.json` individually. All recipes held in memory for instant search/filter.

### 2. Write Bridge (Cloudflare Worker)
- **URL:** https://recipe-bridge.leibreiss.workers.dev
- **Source:** `bridge/worker.js` (~100 lines)
- **Purpose:** Holds the GitHub fine-grained token server-side. The public site POSTs to `/save` with `{path, content, message, encoding}`; the worker commits via GitHub API.
- **Security:** Token never touches the repo or browser. Allowlisted paths only.
- **Deploy record:** `bridge/DEPLOYED.md`

### 3. Sous Chef Skill (`~/workspace/skills/sous-chef/SKILL.md`)
The intake compiler. Takes any input (link, photo, pasted text, YouTube) and produces standardized recipe JSON + banner photo. Used by the intake checker.

Key rules:
- Ingredient item/prep splitting (buy vs cook)
- Unit normalization (tbsp, tsp, cup, lb, oz)
- Never silently kosherize — flag with `needs_kosher_review`
- Duplicate detection before publishing
- YouTube: include channel name in title
- Edit requests (type: "edit"): apply only requested changes to existing recipe

### 4. Recipe Press Skill (`~/workspace/skills/recipe-press/SKILL.md`)
PDF generator. Takes recipe JSON + banner photo, produces a styled PDF with:
- Hero photo, ingredients sidebar, tips section
- Kosher color theme (meat red / dairy blue / pareve green)
- Leftovers badge
- **Engine:** `intake/make_pdf.py` (~250 lines, Python)

### 5. Intake Checker (cron: `recipe-intake-check`)
- **Schedule:** Every 30 minutes, America/New_York
- **Skips:** Shabbat and Yom Tov (reads quiet-hours calendar)
- **Pipeline:**
  1. Check bridge health
  2. Fetch inbox index, find `pending` entries
  3. For each: duplicate check → mark working → analyze via Sous Chef → extract recipe → photo chain → Press PDF → upload via bridge → mark done
  4. Process edit requests (type: "edit") via Sous Chef section 7
  5. Re-press queue: regenerate PDFs for recipes with `pdf_stale: true`
  6. Report only on failures (3+), needs_input, duplicates, or bridge issues

## Data Schema

### Recipe JSON (`data/recipes/<id>.json`)
```json
{
  "id": "slug-id",
  "title": "Recipe Title",
  "kosher_status": "meat|dairy|pareve",
  "kosher_for_passover": false,
  "needs_kosher_review": false,
  "kosher_review_notes": "",
  "categories": [],
  "prep_minutes": 0,
  "cook_minutes": 0,
  "servings": "",
  "ingredients": [{"section": "", "items": [{"qty": "", "unit": "", "item": "", "prep": ""}]}],
  "instructions": [],
  "tips": [{"title": "", "text": ""}],
  "tags": [],
  "notes": "",
  "source": "",
  "pairings": [{"recipe_id": "", "note": ""}],
  "banner_image": "assets/images/<id>.jpg",
  "photo_generated": false,
  "pdf": "pdfs/<id>.pdf",
  "pdf_stale": false,
  "leftover_friendly": false,
  "leftover_note": ""
}
```

### Metadata Index (`data/recipes/meta.json`)
Lightweight array of recipe metadata for list/search/filter/sort. Each entry mirrors the recipe's card-relevant fields (id, title, banner_image, kosher_status, categories, tags, prep_minutes, cook_minutes, servings, etc.) plus a `search_text` field. Updated on every site save (saveRecipe/saveNewRecipe) and by the intake checker when adding recipes.

**2026-10-15 lost-update fix:** GitHub's Contents API returns `Cache-Control: max-age=60`. Rapid-fire saves (<60s apart) caused each save's `ghGet('data/recipes/meta.json')` to return a stale cached copy, silently reverting the previous save's entry (confirmed via git history: two reverts 38s and 36s after the correct writes). Fix: `ghGet` appends `&t=Date.now()` and uses `cache: 'no-store'` on all reads; meta.json updates retry once on failure with a user-visible toast ("please click Save again") instead of silent `console.warn`.

### Inbox Entry (`data/inbox/<id>.json`)
```json
{
  "id": "inbox-xxx",
  "type": "submission|edit",
  "edit_target": "<recipe-id>",
  "url": "",
  "image": "data/inbox/<id>.jpg",
  "note": "",
  "text": "",
  "status": "pending|working|done|failed|duplicate|needs_input",
  "created_at": "ISO timestamp",
  "recipe_id": "<created recipe id>",
  "duplicate_of": "<existing recipe id>",
  "fail_reason": "",
  "needs": []
}
```

### Inbox Index (`data/inbox/index.json`)
Array of `{id, status, type, edit_target, created_at}` — lightweight for the log display.

## Features
- **Three tabs:** Recipes, Meal Planner, Shopping List
- **Meal planner:** Multiple dishes per meal, leftovers marker, prepare-in-advance dates
- **Shopping list:** To Buy / Already Have / Optional (collapsed), syncs between Yidi and Nava, manual items reset Sundays
- **Submit page:** Link, photo (in-page camera), pasted text, note — all persist as drafts
- **AI edit:** Natural-language edit requests processed by the checker
- **Recent submissions log:** Shows all inbox entries with status, auto-refreshes every 60s
- **Serving scaling (2026-10-14):** Recipe detail pages have a Scale bar (0.5x, 1x, 2x, 3x presets + Serves stepper). Quantities recompute from `data-base-qty` on every change (never re-parse DOM text). Core functions (`parseQty`, `formatQty`, `scaleQty`) built by Argon; integration by Muse. PDFs stay at 1x. Shopping/planner integration is v2. **5-bug fix batch (2026-10-14, commit ad1c113):** (1) `formatQty` — kg/l keep 2 decimals, handled before pinch check; g/ml pinch at 0.2 with 1 decimal under 10; (2) pinch threshold no longer fires before metric check; (3) `scaleQty` collapses ranges when lower bound hits "a pinch"; `applyScale` uses digit-presence (not letter-presence) for textual detection; (4) `pluralize()` rewritten with `IRREGULAR_PLURALS` map, parenthetical/comma-note preservation, singularization on scale-down; (5) `pluralizeScaledUnit` expanded to 35 units; header Serves pill syncs via `#header-servings-val`.

## Shopping List Sync Design (2026-10-13)
Checkmarks are stored as `{key, session, at, qty, unit}` objects in `week.haveGenerated`, where `session` is a per-tab ID and `qty`/`unit` capture the line quantity at tap time.

**Key stability:** Item keys are `base|rawUnit` (non-pluralized). The display label may pluralize (`cup`→`cups`) but the key never changes with quantity.

**Sync flow (offline-first):**
1. Tap → mark stored in memory + localStorage immediately; `_shopDirty = true`; 2s debounce.
2. `syncShop()`: pull-merge-push — first `pollShopServer()` unions server marks into local, then `ghPut` pushes the merged state. Server can never wipe local marks.
3. `pollShopServer()`: every 15s, fetches via bridge `/read` (live GitHub API, bypasses Pages rebuild lag) and union-merges.
4. `online` event: if dirty, syncs immediately when connectivity returns.
5. `boot()` / `refreshMealPlan()`: use `fetchLiveMealPlan()` (bridge `/read` first, Pages fallback) and `mergeWeekState()` — never blind-overwrite.

**Quantity splits:** If a marked qty is less than the current line total (e.g. checked "1 cup honey", now need 3 cups), the line renders as two: checked portion + unchecked remainder. Tapping the checked portion unchecks all; tapping the remainder checks the full qty.

**Optional ingredients:** Ingredients with `optional: true` appear in a collapsed "Optional" section on the shopping list (never in "To buy" by default). Two buttons per item: "+" promotes to To Buy (tracked in `week.optionalPromoted`, merged on sync), "✓" marks Already Have directly. Tapping "○" on a promoted item in To Buy sends it back to Optional. If an item is required in any planned recipe, the aggregated line is required (optional only wins when ALL occurrences are optional).

**Conflict detection:** Same item marked by 2+ distinct sessions renders red with "⚠️ Both grabbed this" warning.
