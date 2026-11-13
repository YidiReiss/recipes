/* Commit 2A (Smart Meal Planning v1, logic core) — offline simulation tests.
   Extracts the REAL functions from the modified site/app.js (brace-matched
   source slices, eval'd against stubs) and proves the spec's classifier,
   yield math, lunch-bucket, generator, swap and shopping semantics.
   No network: fetch/ghPut are fakes backed by an in-memory "server".
   Meta: the local snapshot at site/data/recipes/meta.json (88 real
   entries; production has 107 — the snapshot is the newest local copy).
   Run: node commit2-test.cjs */
const fs = require('fs');
const path = require('path');

const SITE_DIR = fs.existsSync(path.join(__dirname, 'app.js'))
  ? __dirname
  : path.join(__dirname, '..', 'site');
const SRC = fs.readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
const geval = (0, eval);

function extract(name, all) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\s*\\(', 'g');
  const found = [];
  let m;
  while ((m = re.exec(SRC))) {
    let i = SRC.indexOf('{', m.index), depth = 0, j = i;
    for (; j < SRC.length; j++) {
      if (SRC[j] === '{') depth++;
      else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    found.push(SRC.slice(m.index, j));
    if (!all) break;
  }
  if (!found.length) throw new Error('extract: function not found: ' + name);
  return all ? found : found[0];
}
/* const/let declarations whose value is one bracketed literal. */
function extractDecl(name) {
  const m = new RegExp('(?:const|let|var) ' + name + '\\s*=').exec(SRC);
  if (!m) throw new Error('extractDecl: not found: ' + name);
  let j = SRC.indexOf('=', m.index);
  while (!'({['.includes(SRC[j])) j++;
  const open = SRC[j], close = { '(': ')', '{': '}', '[': ']' }[open];
  let depth = 0, k = j;
  for (; k < SRC.length; k++) {
    if (SRC[k] === open) depth++;
    else if (SRC[k] === close) { depth--; if (depth === 0) { k++; break; } }
  }
  let end = k;
  while (SRC[end] === ' ' || SRC[end] === '\t') end++;
  if (SRC[end] === ';') end++;
  return SRC.slice(m.index, end) + '\n;globalThis.' + name + ' = ' + name + ';';
}
/* Single-statement declarations ending at the first ';' (arrow helpers). */
function extractDeclSemi(name) {
  const m = new RegExp('(?:const|let|var) ' + name + '\\s*=').exec(SRC);
  if (!m) throw new Error('extractDeclSemi: not found: ' + name);
  const end = SRC.indexOf(';', m.index);
  return SRC.slice(m.index, end + 1) + '\n;globalThis.' + name + ' = ' + name + ';';
}

/* ---------------- stubs ---------------- */
let serverState = { weeks: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
globalThis.BRIDGE = 'fake://bridge';
globalThis.mealPlan = { weeks: {} };
globalThis.shoppingSections = null;
globalThis.recipes = [];
globalThis.metaById = {};
globalThis.byId = {};
globalThis.toast = () => {};
globalThis.saveShopLocal = () => {};
globalThis.fetch = async () => {
  await sleep(1);
  return { ok: true, json: async () => ({ ok: true, content: JSON.stringify(serverState) }) };
};
globalThis.ghPut = async (p, text) => { await sleep(1); serverState = JSON.parse(text); return { ok: true }; };

/* ---------------- load the real code ---------------- */
['totalTime', 'ymd', 'blankSlot'].forEach(n => geval(extractDeclSemi(n)));
['PLAN_RE', 'YIELD_LEFT_VALUES', 'TSP_PER', 'COUNT_TO_TSP', 'SIZE_WORDS',
 'UNCOUNTABLES', 'IRREGULAR_PLURALS', 'IRREGULAR_SINGULARS',
 'UNICODE_FRACTIONS', 'PANTRY_STAPLES'].forEach(n => geval(extractDecl(n)));
geval(SRC.match(/let _savePlanChain = Promise\.resolve\(\);/)[0] + '\n' +
      SRC.match(/let _savePlanInFlight = 0;/)[0] + '\n' +
      SRC.match(/let _shopSyncTimer = null;/)[0] + '\n' +
      SRC.match(/let _shopDirty = false;/)[0] + '\n' +
      SRC.match(/let _shopDirtyGen = 0;/)[0] + '\n' +
      extract('syncShopSoon') + '\n' +
      extract('attemptSaveMealPlan') + '\n' +
      extract('saveMealPlan'));
extract('parseQty', true).forEach(src => geval(src));   // single def in app.js since 2026-11-01 (dead duplicate removed)
['qtyToNum', 'fmtQty', 'pluralize', 'pluralizeUnit', 'stripSize', 'groupKey',
 'parseSingleValue', 'parseFractionOrDecimal',
 'fromTsp', 'parseServings', 'normalizeSlot', 'sundayOf', 'weekDayYmd',
 'thisWeekKey', 'shoppingFromYmd', 'getWeek', 'recipeMeta', 'lookupShoppingSection', 'buildShoppingList',
 'isPantryStaple',
 'normalizeHaveMarks', 'mergeHaveMarks', 'mergeManualItems', 'normalizePromotedList',
 'mergePromoted', 'mergeWeekState', 'mergeMealPlan', 'mergeDraftSnap', 'bridgeReadMealPlan',

 'weekKeyDate', 'addDaysToKey', 'daysBetweenKeys', 'prevWeekKeyOf',
 'planningRawWeek', 'planSlot', 'planningPrefs', 'allPlanningMeta',
 'inferPlanningMeta', 'effectivePlanningMeta', 'yieldMedian', 'leftoverServings',
 'computeLastCooked', 'buildCarryInPool', 'recomputeWeekLunches',
 'slotIsProtected', 'slotKosherAllowed', 'scorePlanningCandidate',
 'planningCandidates', 'persistPlannedWeek', 'draftWeek',
 'swapCandidates', 'applySwap', 'withNeedsSide', 'patchMetaNeedsSide',
 'inferVariantSlotClass', 'buildRecipeCard', 'cardDriftFields', 'cardIsStale',
 'partitionSearchResults',
].forEach(n => geval(extract(n)));

/* ---------------- harness ---------------- */
const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : ''));
}
const REAL_META = JSON.parse(fs.readFileSync(
  path.join(SITE_DIR, 'data', 'recipes', 'meta.json'), 'utf8'));
const realById = {};
REAL_META.forEach(m => { realById[m.id] = m; });

const blankDays = () => Array.from({ length: 7 }, () => ({
  lunch: { dishes: [], skipped: false, note: '' },
  dinner: { dishes: [], skipped: false, note: '' }
}));
function setMeta(entries) {
  globalThis.recipes = entries;
  globalThis.metaById = {};
  entries.forEach(m => { globalThis.metaById[m.id] = m; });
}
function setPlan(weeks, extra) {
  globalThis.mealPlan = { weeks, ...(extra || {}) };
  serverState = JSON.parse(JSON.stringify(globalThis.mealPlan));
}
const slotDishes = (week, di, meal) => {
  const s = week.days[di][meal];
  return Array.isArray(s.dishes) ? s.dishes : (s.recipe ? [{ recipe: s.recipe }] : []);
};

async function main() {
  /* ============ 1. parseServings hoist ============ */
  check('parseServings number', JSON.stringify(parseServings(6)) === '{"low":6,"high":6}');
  check('parseServings range', JSON.stringify(parseServings('6-8')) === '{"low":6,"high":8}');
  check('parseServings junk -> null', parseServings('a few') === null && parseServings(null) === null);

  /* ============ 2. Classifier on the real meta ============ */
  setMeta(REAL_META);
  const mainCount = REAL_META.filter(m => (m.categories || []).some(c => String(c).toLowerCase() === 'main')).length;
  const eligible = REAL_META.filter(m => inferPlanningMeta(m).mainEligible);
  check('classifier: eligible == recipes categorized main', eligible.length === mainCount,
    eligible.length + ' vs ' + mainCount + ' of ' + REAL_META.length);
  const badEligible = eligible.filter(m => (m.categories || []).some(c =>
    ['dessert', 'desserts', 'soup', 'side', 'salad', 'baking'].includes(String(c).toLowerCase())));
  // A recipe carrying BOTH main and soup (their data does this) stays eligible
  // by the gate's letter; assert instead: nothing eligible lacks 'main'.
  check('classifier: every eligible recipe carries the main category',
    eligible.every(m => (m.categories || []).some(c => String(c).toLowerCase() === 'main')));
  check('classifier: no dessert is a dinner main',
    REAL_META.filter(m => (m.categories || []).some(c => /dessert/i.test(c)))
      .every(m => !inferPlanningMeta(m).mainEligible));
  check('classifier: chicken soup (broth) is not a dinner main',
    inferPlanningMeta(realById['chicken-soup']).mainEligible === false);
  const ch = inferPlanningMeta(realById['chulent']);
  check('classifier: chulent -> beef-roast / shabbat / lunch',
    ch.slotClass === 'beef-roast' && ch.effort === 'shabbat' && ch.shabbatFit === 'lunch',
    JSON.stringify(ch));
  check('classifier: broth negative lookahead (synthetic)',
    inferPlanningMeta({ id: 'x', title: 'X', categories: ['main'], kosher_status: 'meat',
      search_text: 'chicken broth salt water', tags: [] }).slotClass !== 'chicken');
  check('classifier: real chicken breast classifies chicken',
    inferPlanningMeta({ id: 'y', title: 'Y', categories: ['main'], kosher_status: 'meat',
      search_text: 'chicken breast olive oil', tags: [] }).slotClass === 'chicken');
  check('classifier: ground beef beats beef-roast',
    inferPlanningMeta({ id: 'z', title: 'Burgers', categories: ['main'], kosher_status: 'meat',
      search_text: 'ground beef buns roast potatoes', tags: [] }).slotClass === 'ground-beef');
  const effDist = {};
  REAL_META.forEach(m => { const e = inferPlanningMeta(m).effort; effDist[e] = (effDist[e] || 0) + 1; });
  check('classifier: effort spread plausible (both kinds present, no special)',
    effDist.weeknight > 10 && effDist.shabbat > 10 && !effDist.special, JSON.stringify(effDist));
  // prefs override: slotClass lifts the gate and wins over inference
  setPlan({}, { recipePrefs: { 'chicken-soup': { rating: null, slotClass: 'chicken', effort: 'weeknight', updatedAt: 1 } } });
  const eff = effectivePlanningMeta('chicken-soup');
  check('effectivePlanningMeta: prefs slotClass lifts gate + overrides',
    eff.mainEligible === true && eff.slotClass === 'chicken' && eff.effort === 'weeknight');
  setPlan({});

  /* ============ 3. leftoverServings / yield math ============ */
  const meta6 = { id: 'm6', servings: '6', leftover_friendly: false };
  check('yield: leftovers dish -> 0', leftoverServings({ recipe: 'm6', leftovers: true }, meta6, []) === 0);
  check('yield: custom dish -> 0', leftoverServings({ custom: 'Pizza' }, meta6, []) === 0);
  check('yield: fallback servings 6 -> 4', leftoverServings({ recipe: 'm6' }, meta6, []) === 4);
  check('yield: fallback range low end (4-6 -> 2)',
    leftoverServings({ recipe: 'm4' }, { id: 'm4', servings: '4-6', leftover_friendly: false }, []) === 2);
  check('yield: unparseable servings -> baseLow 4 -> 2',
    leftoverServings({ recipe: 'mx' }, { id: 'mx', servings: null, leftover_friendly: false }, []) === 2);
  check('yield: leftover-friendly bump (serves 3 at 0.5x)',
    leftoverServings({ recipe: 'm3', scale: 0.5 }, { id: 'm3', servings: '3', leftover_friendly: true }, []) === 1);
  const log1 = [{ id: 'e1', recipe: 'm6', scale: 1, left: 'a lot', date: '2026-10-01' }];
  check('yield: learned value used DIRECTLY (a lot -> 2, never minus 2)',
    leftoverServings({ recipe: 'm6' }, meta6, log1) === 2);
  const logMedian = [
    { id: 'a', recipe: 'm6', scale: 1, left: 'none', date: '2026-09-01' },
    { id: 'b', recipe: 'm6', scale: 1, left: 'a lot', date: '2026-09-08' },
    { id: 'c', recipe: 'm6', scale: 1, left: 'most', date: '2026-09-15' }];
  check('yield: median of last 3 learned (0,2,3 -> 2)',
    leftoverServings({ recipe: 'm6' }, meta6, logMedian) === 2);
  check('yield: cross-scale inference (logged 2 at 1x, dish 2x -> 6)',
    leftoverServings({ recipe: 'm6', scale: 2 }, meta6, log1) === 6);
  check('yield: cross-scale inference floors at 0 (logged 0 at 1x, dish 0.5x)',
    leftoverServings({ recipe: 'm6', scale: 0.5 }, meta6,
      [{ id: 'e0', recipe: 'm6', scale: 1, left: 'none', date: '2026-10-01' }]) === 0);

  /* ============ 4. computeLastCooked ============ */
  {
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'a', variant: 'chicken' }];
    days[3].dinner.dishes = [{ recipe: 'a', leftovers: true }, { recipe: 'b' }];
    const days2 = blankDays();
    days2[0].lunch.dishes = [{ recipe: 'a' }];
    setPlan({ '2026-10-11': { days }, '2026-10-18': { days: days2 } });
    const lc = computeLastCooked();
    check('lastCooked: latest non-leftovers date wins (leftovers ignored)',
      lc.byRecipe['a'] === '2026-10-18', JSON.stringify(lc.byRecipe));
    check('lastCooked: per-variant last-made recorded',
      lc.byVariant['a|chicken'] === '2026-10-12');
    check('lastCooked: plain dish recorded', lc.byRecipe['b'] === '2026-10-14');
  }

  /* ============ shared fixtures for generator / buckets ============ */
  const FIX = [
    { id: 'fixture-beef', title: 'Fixture Burgers', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 15, servings: '4', leftover_friendly: false, search_text: 'ground beef buns lettuce' },
    { id: 'fixture-chicken', title: 'Fixture Chicken', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '6', leftover_friendly: true, search_text: 'chicken breast garlic' },
    { id: 'fixture-pasta', title: 'Fixture Pasta', kosher_status: 'dairy', categories: ['main', 'pasta'], tags: [],
      prep_minutes: 5, cook_minutes: 15, servings: '4', leftover_friendly: false, search_text: 'penne pasta cheese' },
    { id: 'fixture-fish', title: 'Fixture Salmon', kosher_status: 'pareve', categories: ['main'], tags: [],
      prep_minutes: 5, cook_minutes: 10, servings: '4', leftover_friendly: false, search_text: 'salmon fillets lemon' },
    { id: 'fixture-roast', title: 'Fixture Brisket', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 20, cook_minutes: 160, servings: '10', leftover_friendly: true, search_text: 'brisket onions carrots' },
    realById['chulent']
  ];
  const PREV = '2026-10-11', CUR = '2026-10-18';

  /* ============ 5. recomputeWeekLunches: Monday dinner covers Friday (+4), spacing ============ */
  {
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'fixture-feast', drafted: true }];
    setMeta([...FIX, { id: 'fixture-feast', title: 'Feast', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 30, servings: '12', leftover_friendly: false, search_text: 'beef potatoes' }]);
    setPlan({ [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    const lunch = d => slotDishes(wk, d, 'lunch');
    check('buckets: Tue lunch covered by Monday dinner', lunch(2).length === 1 && lunch(2)[0].recipe === 'fixture-feast');
    check('buckets: Wed lunch BLOCKED by spacing (dinner Mon + lunch Tue)',
      lunch(3).length === 0 && wk.lunchWarnings.some(w => w.day === 3 && w.kind === 'uncovered'));
    check('buckets: Thu lunch resumes after the gap day', lunch(4).length === 1);
    check('buckets: Friday lunch covered by Monday dinner (day +4, inside 7-day window)',
      lunch(5).length === 1 && lunch(5)[0].recipe === 'fixture-feast');
    check('buckets: no Sunday placement ever', slotDishes(wk, 0, 'lunch').length === 0);
    check('buckets: placements are drafted leftovers dishes',
      lunch(2)[0].leftovers === true && lunch(2)[0].drafted === true);
  }

  /* ============ 6. recomputeWeekLunches: Shabbat carry-in covers mid-week, spacing on the pool ============ */
  {
    const prevDays = blankDays();
    prevDays[6].lunch.dishes = [{ recipe: 'fixture-feast' }];   // Saturday lunch main, serves 12 -> 10 left
    const days = blankDays();
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    const lunch = d => slotDishes(wk, d, 'lunch');
    check('carry-in: pool snapshot stored on the week', !!wk.carryInPool && wk.carryInPool['fixture-feast|'].servings === 10);
    check('carry-in: Mon + Tue lunches from the pool',
      lunch(1)[0] && lunch(1)[0].recipe === 'fixture-feast' && lunch(2)[0] && lunch(2)[0].recipe === 'fixture-feast');
    check('carry-in: Wed blocked by spacing', lunch(3).length === 0);
    check('carry-in: Thu + Fri (1 serving) resume from the pool',
      lunch(4).length === 1 && lunch(5).length === 1);
  }

  /* ============ 7. recomputeWeekLunches: partial coverage + uncovered flags ============ */
  {
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'fixture-small' }];   // serves 5 -> 3 left
    setMeta([...FIX, { id: 'fixture-small', title: 'Small Pot', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 5, cook_minutes: 20, servings: '5', leftover_friendly: false, search_text: 'chicken rice' }]);
    setPlan({ [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    const thu = slotDishes(wk, 4, 'lunch');
    check('partial: Thu lunch placed with the 1 serving that exists',
      thu.length === 1 && thu[0].coverage === 1, JSON.stringify(thu));
    check('partial: warning recorded (partial, have 1, need 2)',
      wk.lunchWarnings.some(w => w.day === 4 && w.kind === 'partial' && w.have === 1 && w.need === 2));
    check('uncovered: Friday flagged when no bucket has servings',
      wk.lunchWarnings.some(w => w.day === 5 && w.kind === 'uncovered' && w.need === 1));
    check('uncovered: empty week flags all five lunches',
      (() => { setPlan({ [CUR]: { days: blankDays() } });
               const w2 = recomputeWeekLunches(CUR);
               return w2.lunchWarnings.length === 5 && w2.lunchWarnings.every(w => w.kind === 'uncovered'); })());
  }

  /* ============ 8. recomputeWeekLunches: manual lunches untouched ============ */
  {
    const days = blankDays();
    days[2].lunch.dishes = [{ custom: 'Sandwiches from the deli' }];   // manual (not drafted)
    days[1].dinner.dishes = [{ recipe: 'fixture-feast2' }];
    setMeta([...FIX, { id: 'fixture-feast2', title: 'Feast 2', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 30, servings: '12', leftover_friendly: false, search_text: 'beef potatoes' }]);
    setPlan({ [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    check('manual lunch is never moved or blocked',
      slotDishes(wk, 2, 'lunch').length === 1 && slotDishes(wk, 2, 'lunch')[0].custom === 'Sandwiches from the deli');
    check('manual lunch day gets no warning',
      !wk.lunchWarnings.some(w => w.day === 2));
  }

  /* ============ 9. draftWeek on fixtures: framework, Shabbat, leftovers night ============ */
  {
    setMeta(FIX);
    const prevDays = blankDays();
    prevDays[5].dinner.dishes = [{ recipe: 'fixture-roast' }];   // Fri dinner, serves 10 -> 8 left
    prevDays[6].lunch.dishes = [{ recipe: 'chulent' }];          // Sat lunch -> 2 left
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('draft: Thu dinner is the standing locked Pizza',
      dinner(4).length === 1 && dinner(4)[0].custom === 'Pizza' && dinner(4)[0].locked === true);
    check('draft: Fri dinner is the shabbat roast', dinner(5)[0] && dinner(5)[0].recipe === 'fixture-roast');
    check('draft: Sat lunch is chulent (lunch fit)', slotDishes(wk, 6, 'lunch')[0] &&
      slotDishes(wk, 6, 'lunch')[0].recipe === 'chulent');
    check('draft: leftovers night is MONDAY, sourced from Shabbat',
      dinner(1).length === 1 && dinner(1)[0].leftovers === true && dinner(1)[0].recipe === 'fixture-roast');
    check('draft: carry-in pool shows the 2-serving deduction (8 - 2 = 6)',
      wk.carryInPool && wk.carryInPool['fixture-roast|'].servings === 6, JSON.stringify(wk.carryInPool));
    check('draft: Sunday dinner is FRESH (no automatic leftovers on Sunday)',
      dinner(0).length === 1 && !dinner(0)[0].leftovers);
    check('draft: framework Sun = pasta (beef leftovers satisfy the beef night — Q4)',
      dinner(0)[0] && dinner(0)[0].recipe === 'fixture-pasta');
    check('draft: framework Tue = chicken', dinner(2)[0] && dinner(2)[0].recipe === 'fixture-chicken');
    check('draft: framework Wed = fish/veg (no class silently dropped — Q4)',
      dinner(3)[0] && dinner(3)[0].recipe === 'fixture-fish');
    check('draft: leftovers dish reason says it covers the beef night',
      dinner(1)[0] && /covers the beef night/.test(dinner(1)[0].reason || ''),
      dinner(1)[0] && dinner(1)[0].reason);
    check('draft: every drafted dish has a reason and NO scale (generator invariant)',
      wk.days.every(day => ['lunch', 'dinner'].every(m => slotDishes(wk, wk.days.indexOf(day), m)
        .every(dish => !('scale' in dish)))));
    check('draft: drafted dishes carry plain-word reasons',
      dinner(0)[0] && typeof dinner(0)[0].reason === 'string' && dinner(0)[0].reason.length > 0);
    check('draft: week persisted to the server copy',
      !!serverState.weeks[CUR] && slotDishes(serverState.weeks[CUR], 4, 'dinner')[0].custom === 'Pizza');
    check('draft: Mon lunch covered from the pool after the leftovers night',
      slotDishes(wk, 1, 'lunch').length === 1);
  }

  /* ============ 10. draftWeek: eat-out chip + Monday blocked -> leftovers night falls to Tuesday ============ */
  {
    setMeta(FIX);
    const prevDays = blankDays();
    prevDays[5].dinner.dishes = [{ recipe: 'fixture-roast' }];
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, { eatOut: [1] });
    check('draft: eat-out chip skips Monday dinner',
      wk.days[1].dinner.skipped === true && slotDishes(wk, 1, 'dinner').length === 0);
    check('draft: leftovers night falls back to Tuesday',
      slotDishes(wk, 2, 'dinner')[0] && slotDishes(wk, 2, 'dinner')[0].leftovers === true);
  }

  /* ============ 11. draftWeek on the REAL meta: invariants ============ */
  {
    setMeta(REAL_META);
    const prevDays = blankDays();
    prevDays[5].dinner.dishes = [{ recipe: 'brisket-with-vegetables-and-dried-fruit' }];
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days: blankDays() } },
      { recipePrefs: { 'forty-clove-garlic-chicken': { rating: 'skip', updatedAt: 1 } } });
    const wk = await draftWeek(CUR, { hostingFri: true });
    const allDishes = [];
    wk.days.forEach((day, di) => ['lunch', 'dinner'].forEach(m =>
      slotDishes(wk, di, m).forEach(dish => allDishes.push({ di, m, dish }))));
    check('real draft: no skip-rated recipe drafted',
      !allDishes.some(x => x.dish.recipe === 'forty-clove-garlic-chicken'));
    check('real draft: Thu pizza placed', slotDishes(wk, 4, 'dinner').some(d => d.custom === 'Pizza'));
    check('real draft: no dish has a scale', allDishes.every(x => !('scale' in x.dish)));
    check('real draft: Sunday dinner is not a leftovers dish',
      slotDishes(wk, 0, 'dinner').every(d => !d.leftovers));
    check('real draft: every drafted recipe dish is main-eligible',
      allDishes.filter(x => x.dish.recipe && x.dish.drafted)
        .every(x => { const pm = effectivePlanningMeta(x.dish.recipe); return pm && pm.mainEligible; }));
    check('real draft: Fri dinner is shabbat effort, meat/pareve',
      slotDishes(wk, 5, 'dinner').filter(d => d.recipe).every(d => {
        const pm = effectivePlanningMeta(d.recipe);
        const meta = realById[d.recipe];
        return pm.effort === 'shabbat' && ['meat', 'pareve'].includes(meta.kosher_status);
      }));
    check('real draft: Sun-Wed drafted dinners respect the day effort bands',
      [0, 1, 2, 3].every(di => slotDishes(wk, di, 'dinner').filter(d => d.recipe && !d.leftovers)
        .every(d => { const e = effectivePlanningMeta(d.recipe).effort;
          return di === 0 ? (e === 'weeknight' || e === 'sunday') : e === 'weeknight'; })));
    check('real draft: leftovers night (if placed) is Mon or Tue, from Shabbat',
      [0, 1, 2, 3].every(di => slotDishes(wk, di, 'dinner').filter(d => d.leftovers)
        .every(d => di === 1 || di === 2)));
  }

  /* ============ 12. Swap ============ */
  {
    setMeta([...FIX,
      { id: 'fixture-chicken-2', title: 'Fixture Chicken Two', kosher_status: 'meat', categories: ['main'], tags: [],
        prep_minutes: 10, cook_minutes: 25, servings: '4', leftover_friendly: false, search_text: 'chicken thighs onions' }]);
    const days = blankDays();
    days[0].dinner.dishes = [{ recipe: 'fixture-chicken', drafted: true }];
    setPlan({ [CUR]: { days } });
    const cands = swapCandidates(CUR, 0, 'dinner', 0);
    check('swap: candidates are same-class, exclude current + used',
      cands.length >= 1 && cands.every(c => c.slotClass === 'chicken' && c.id !== 'fixture-chicken'),
      JSON.stringify(cands.map(c => c.id)));
    check('swap: at most 5 candidates', cands.length <= 5);
    const newDish = await applySwap(CUR, 0, 'dinner', 0, cands[0]);
    check('swap: applySwap replaces the dish, drafted, no scale',
      newDish && newDish.recipe === cands[0].id && newDish.drafted === true && !('scale' in newDish));
    check('swap: week updated in place',
      slotDishes(globalThis.mealPlan.weeks[CUR], 0, 'dinner')[0].recipe === cands[0].id);
  }

  /* ============ 13. Variants: burritos fixture ============ */
  const BURRITOS_META = { id: 'burritos', title: 'Burritos', kosher_status: 'meat', categories: ['main'], tags: [],
    prep_minutes: 15, cook_minutes: 20, servings: '6', leftover_friendly: true,
    search_text: 'tortillas rice beans',
    variants: [{ key: 'beef', label: 'Beef', default: true, slotClass: 'ground-beef' },
               { key: 'chicken', label: 'Chicken', slotClass: 'chicken' }] };
  {
    // Beef slot: burritos is the only ground-beef candidate.
    setMeta([BURRITOS_META, ...FIX.filter(f => f.id !== 'fixture-beef')]);
    setPlan({ [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, {});
    const sun = slotDishes(wk, 0, 'dinner')[0];
    check('variant: burritos drafts into the ground-beef slot with variant=beef',
      sun && sun.recipe === 'burritos' && sun.variant === 'beef', JSON.stringify(sun));
    check('variant: reason names the version',
      !!sun && /beef/i.test(sun.reason || ''));
    // Chicken slot: with the beef fixture rated favorite (it wins the
    // ground-beef slot), burritos is still free for the chicken slot.
    setMeta([BURRITOS_META, ...FIX]);
    setPlan({ [CUR]: { days: blankDays() } },
      { recipePrefs: { 'fixture-beef': { rating: 'favorite', updatedAt: 1 } } });
    const wk2 = await draftWeek(CUR, {});
    const chickenDish = [];
    wk2.days.forEach((day, di) => slotDishes(wk2, di, 'dinner')
      .forEach(d => { if (d.recipe === 'burritos') chickenDish.push({ di, d }); }));
    check('variant: burritos drafts into a chicken slot with variant=chicken',
      chickenDish.some(x => x.d.variant === 'chicken'), JSON.stringify(chickenDish));
    // Recency is recipe-level: a recent chicken-version make penalizes the recipe.
    const days = blankDays();
    days[2].dinner.dishes = [{ recipe: 'burritos', variant: 'chicken' }];
    setPlan({ '2026-10-11': { days } });
    const lc = computeLastCooked();
    check('variant: recipe-level lastCooked after either version',
      lc.byRecipe['burritos'] === '2026-10-13' && lc.byVariant['burritos|chicken'] === '2026-10-13');
    // yieldLog prefers the matching variant.
    const vLog = [
      { id: 'v1', recipe: 'burritos', scale: 1, variant: 'beef', left: 'none', date: '2026-10-01' },
      { id: 'v2', recipe: 'burritos', scale: 1, variant: 'chicken', left: 'a lot', date: '2026-10-01' }];
    check('variant: yieldLog matches recipe+scale+variant first',
      leftoverServings({ recipe: 'burritos', variant: 'chicken' }, BURRITOS_META, vLog) === 2 &&
      leftoverServings({ recipe: 'burritos', variant: 'beef' }, BURRITOS_META, vLog) === 0);
  }

  /* ============ 14. Shopping: scale + variant ============ */
  {
    setMeta([BURRITOS_META]);
    globalThis.byId = { burritos: {
      id: 'burritos', title: 'Burritos',
      ingredients: [{ section: null, items: [
        { qty: '6', unit: '', item: 'tortillas' },
        { qty: '1', unit: 'lb', item: 'ground beef', variant: 'beef' },
        { qty: '1', unit: 'lb', item: 'chicken breast', variant: 'chicken' },
        { qty: '2', unit: 'cup', item: 'rice' }
      ] }]
    } };
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'burritos', variant: 'chicken', scale: 2 }];
    setPlan({ [thisWeekKey()]: { days } });
    const list = buildShoppingList();
    const labels = list.map(i => i.label).join(' ; ');
    check('shopping: variant dish buys ONLY the chosen version protein',
      list.some(i => /chicken breast/.test(i.label)) && !list.some(i => /ground beef/.test(i.label)), labels);
    check('shopping: scale multiplies the count path (6 tortillas x2 = 12)',
      list.some(i => i.label.startsWith('12') && /tortilla/.test(i.label)), labels);
    check('shopping: scale multiplies the unit-conversion path (2 cups rice x2 = 4 cups)',
      list.some(i => /4 cups? rice/.test(i.label)), labels);
    // Same recipe twice at different scales sums correctly.
    const days2 = blankDays();
    days2[1].dinner.dishes = [{ recipe: 'burritos', variant: 'beef', scale: 1 }];
    days2[2].dinner.dishes = [{ recipe: 'burritos', variant: 'beef', scale: 2 }];
    setPlan({ [thisWeekKey()]: { days: days2 } });
    const list2 = buildShoppingList();
    check('shopping: same recipe at 1x + 2x sums (3 lb ground beef)',
      list2.some(i => /3 lb ground beef/.test(i.label)), list2.map(i => i.label).join(' ; '));
    check('shopping: leftovers dishes stay excluded',
      (() => { const d3 = blankDays();
               d3[1].dinner.dishes = [{ recipe: 'burritos', variant: 'beef', leftovers: true }];
               setPlan({ [thisWeekKey()]: { days: d3 } });
               return buildShoppingList().length === 0; })());
    globalThis.byId = {};
  }

  /* ============ 15. Argon fix 1: full spacing predicate (has(d) + bridge cases) ============ */
  {
    // (a) A carry-in recipe whose leftovers dinner is Monday night is
    // NOT also placed at Monday lunch (appearances.has(d)); the pool
    // is still charged, and Tuesday lunch can draw from it.
    const prevDays = blankDays();
    prevDays[6].lunch.dishes = [{ recipe: 'fix1-feast' }];   // Sat lunch, serves 12 -> 10 left
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'fix1-feast', leftovers: true, drafted: true }];
    setMeta([...FIX, { id: 'fix1-feast', title: 'Fix1 Feast', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 30, servings: '12', leftover_friendly: false, search_text: 'beef potatoes' }]);
    setPlan({ [PREV]: { days: prevDays },
              [CUR]: { days, carryInDeductions: { 'fix1-feast|': 2 } } });
    const wk = recomputeWeekLunches(CUR);
    check('fix1: pool charged for the leftovers night (10 - 2 = 8)',
      wk.carryInPool['fix1-feast|'].servings === 8, JSON.stringify(wk.carryInPool));
    check('fix1: carry-in recipe NOT placed Monday lunch (its leftovers dinner is that night)',
      slotDishes(wk, 1, 'lunch').length === 0);
    check('fix1: Tuesday lunch CAN draw from the same pool',
      slotDishes(wk, 2, 'lunch').length === 1 && slotDishes(wk, 2, 'lunch')[0].recipe === 'fix1-feast');
  }
  {
    // (b) Bridge case: the same recipe is dinner Mon AND Wed, so a
    // Tuesday placement would sit between two appearances (d-1 & d+1)
    // and must be blocked; Thursday (after a gap) is fine.
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'fix1-bridge', drafted: true }];
    days[3].dinner.dishes = [{ recipe: 'fix1-bridge', drafted: true }];
    setMeta([...FIX, { id: 'fix1-bridge', title: 'Fix1 Bridge', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 30, servings: '12', leftover_friendly: false, search_text: 'beef potatoes' }]);
    setPlan({ [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    check('fix1: Tuesday lunch blocked by the bridge case (dinner Mon + dinner Wed)',
      slotDishes(wk, 2, 'lunch').length === 0);
    check('fix1: Wednesday lunch blocked (the recipe is dinner that night)',
      slotDishes(wk, 3, 'lunch').length === 0);
    check('fix1: Thursday lunch placed once a gap day exists',
      slotDishes(wk, 4, 'lunch').length === 1 && slotDishes(wk, 4, 'lunch')[0].recipe === 'fix1-bridge');
  }

  /* ============ 16. Argon fix 2: locked/manual leftover lunches charge their bucket ============ */
  {
    // Mon dinner serves 8 -> 6 leftover servings. A LOCKED leftovers
    // lunch on Monday (no coverage recorded) charges the bucket the
    // day's need (2): Tue 2 + Thu 2 exhausts it, so Friday runs dry.
    // Without the charge, Friday would still be covered.
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'fix2-feast', drafted: true }];
    days[1].lunch.dishes = [{ recipe: 'fix2-feast', leftovers: true, drafted: true, locked: true }];
    setMeta([...FIX, { id: 'fix2-feast', title: 'Fix2 Feast', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 30, servings: '8', leftover_friendly: false, search_text: 'beef potatoes' }]);
    setPlan({ [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    check('fix2: locked Monday lunch left in place',
      slotDishes(wk, 1, 'lunch').length === 1 && slotDishes(wk, 1, 'lunch')[0].locked === true);
    check('fix2: Tue + Thu lunches placed from the bucket',
      slotDishes(wk, 2, 'lunch').length === 1 && slotDishes(wk, 4, 'lunch').length === 1);
    check('fix2: Friday uncovered — the locked lunch already ate 2 of the 6 servings',
      wk.lunchWarnings.some(w => w.day === 5 && w.kind === 'uncovered'),
      JSON.stringify(wk.lunchWarnings));
  }

  /* ============ 17. Argon fix 3: leftovers-night source needs a proven yield >= 2 ============ */
  {
    // Prev Friday dinner: yieldLog proves only 'a little' (1 serving)
    // even though the recipe is leftover_friendly. It must NOT be
    // chosen for the leftovers night.
    setMeta([...FIX, { id: 'fix3-small', title: 'Fix3 Small Pot', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '4', leftover_friendly: true, search_text: 'chicken rice' }]);
    const prevDays = blankDays();
    prevDays[5].dinner.dishes = [{ recipe: 'fix3-small' }];
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days: blankDays() } },
      { yieldLog: [{ id: 'fy1', recipe: 'fix3-small', scale: 1, left: 'a little', date: '2026-10-09' }] });
    const wk = await draftWeek(CUR, {});
    const anyLeftoversDinner = [0, 1, 2, 3, 5].some(di =>
      slotDishes(wk, di, 'dinner').some(d => d.leftovers));
    check('fix3: 1-serving leftover-friendly source is NOT a leftovers night',
      !anyLeftoversDinner);
    check('fix3: Monday dinner is a fresh drafted dish instead',
      slotDishes(wk, 1, 'dinner').length === 1 && !slotDishes(wk, 1, 'dinner')[0].leftovers);
  }

  /* ============ 18. Argon fix 4: manual leftovers dinner charges the pool (default 2) ============ */
  {
    const prevDays = blankDays();
    prevDays[6].lunch.dishes = [{ recipe: 'fix4-feast' }];   // Sat lunch, serves 12 -> 10 left
    const days = blankDays();
    days[1].dinner.dishes = [{ recipe: 'fix4-feast', leftovers: true }];   // manual — no carryInDeductions entry
    setMeta([...FIX, { id: 'fix4-feast', title: 'Fix4 Feast', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 30, servings: '12', leftover_friendly: false, search_text: 'beef potatoes' }]);
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days } });
    const wk = recomputeWeekLunches(CUR);
    check('fix4: manual leftovers dinner charges the pool 2 (10 - 2 = 8)',
      wk.carryInPool['fix4-feast|'].servings === 8, JSON.stringify(wk.carryInPool));
  }

  /* ============ 19. Argon fix 5: eat-out chips are two-way ============ */
  {
    setMeta(FIX);
    setPlan({ [CUR]: { days: blankDays() } });
    const wk1 = await draftWeek(CUR, {});
    check('fix5: first draft fills Tuesday dinner',
      slotDishes(wk1, 2, 'dinner').length === 1 && wk1.days[2].dinner.skipped !== true);
    setPlan({ [CUR]: JSON.parse(JSON.stringify(wk1)) });
    const wk2 = await draftWeek(CUR, { eatOut: [2] });
    check('fix5: re-draft WITH the Tue chip replaces the drafted dinner with skipped/Eat out',
      wk2.days[2].dinner.skipped === true && wk2.days[2].dinner.note === 'Eat out' &&
      slotDishes(wk2, 2, 'dinner').length === 0);
    setPlan({ [CUR]: JSON.parse(JSON.stringify(wk2)) });
    const wk3 = await draftWeek(CUR, {});
    check('fix5: re-draft WITHOUT the chip un-skips Tuesday and drafts it again',
      wk3.days[2].dinner.skipped === false && slotDishes(wk3, 2, 'dinner').length === 1);
    // A manual skip (any other note) survives chipping AND unchipping.
    const days = blankDays();
    days[3].dinner = { dishes: [], skipped: true, note: 'Dinner at grandparents' };
    setPlan({ [CUR]: { days } });
    const wkA = await draftWeek(CUR, { eatOut: [3] });
    check('fix5: manual skip untouched when its day is chipped',
      wkA.days[3].dinner.skipped === true && wkA.days[3].dinner.note === 'Dinner at grandparents');
    setPlan({ [CUR]: JSON.parse(JSON.stringify(wkA)) });
    const wkB = await draftWeek(CUR, {});
    check('fix5: manual skip untouched when unchipped',
      wkB.days[3].dinner.skipped === true && wkB.days[3].dinner.note === 'Dinner at grandparents');
    // A chipped day holding a manual dish is left alone.
    const days2 = blankDays();
    days2[2].dinner.dishes = [{ custom: 'Leftovers from the freezer' }];
    setPlan({ [CUR]: { days: days2 } });
    const wkC = await draftWeek(CUR, { eatOut: [2] });
    check('fix5: chipped day with a manual dish is left alone',
      wkC.days[2].dinner.skipped !== true &&
      slotDishes(wkC, 2, 'dinner').length === 1 && slotDishes(wkC, 2, 'dinner')[0].custom === 'Leftovers from the freezer');
  }

  /* ============ 20. Argon fix 6: swap candidate reasons name the variant ============ */
  {
    setMeta([BURRITOS_META, ...FIX]);
    const days = blankDays();
    days[0].dinner.dishes = [{ recipe: 'fixture-beef', drafted: true }];
    setPlan({ [CUR]: { days } });
    const cands = swapCandidates(CUR, 0, 'dinner', 0);
    const burr = cands.find(c => c.id === 'burritos');
    check('fix6: variant recipe appears among swap candidates',
      !!burr, JSON.stringify(cands.map(c => c.id)));
    check('fix6: swap reason includes the version ("Beef version · ...")',
      !!burr && /^Beef version · /.test(burr.reason || ''), burr && burr.reason);
  }

  /* ============ 21. Q4: chicken leftovers ARE the chicken night ============ */
  {
    const SHAB_CHICKEN = { id: 'fixture-shabbat-chicken', title: 'Fixture Shabbat Chicken',
      kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 20, cook_minutes: 100, servings: '10', leftover_friendly: true,
      search_text: 'chicken onions garlic paprika' };
    setMeta([...FIX, SHAB_CHICKEN]);
    const prevDays = blankDays();
    prevDays[5].dinner.dishes = [{ recipe: 'fixture-shabbat-chicken' }];  // only pool source: 10 -> 8 left
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('Q4 chicken: leftovers night Monday is the Shabbat chicken',
      dinner(1).length === 1 && dinner(1)[0].leftovers === true &&
      dinner(1)[0].recipe === 'fixture-shabbat-chicken');
    check('Q4 chicken: reason says it covers the chicken night',
      /covers the chicken night/.test(dinner(1)[0].reason || ''), dinner(1)[0].reason);
    check('Q4 chicken: fresh queue is beef/pasta/fish — Sun = ground-beef',
      dinner(0)[0] && dinner(0)[0].recipe === 'fixture-beef');
    check('Q4 chicken: Tue = pasta', dinner(2)[0] && dinner(2)[0].recipe === 'fixture-pasta');
    check('Q4 chicken: Wed = fish/veg (not dropped)',
      dinner(3)[0] && dinner(3)[0].recipe === 'fixture-fish');
    check('Q4 chicken: no FRESH chicken dish is drafted Sun-Wed',
      [0, 1, 2, 3].every(d => dinner(d).every(dish => dish.leftovers || dish.recipe !== 'fixture-chicken')));
  }

  /* ============ 22. Q4: no leftovers night -> all four classes fit Sun-Wed ============ */
  {
    setMeta(FIX);
    setPlan({ [CUR]: { days: blankDays() } });   // no previous week -> empty pool
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('Q4 none: Sun = ground-beef', dinner(0)[0] && dinner(0)[0].recipe === 'fixture-beef');
    check('Q4 none: Mon = pasta', dinner(1)[0] && dinner(1)[0].recipe === 'fixture-pasta');
    check('Q4 none: Tue = chicken', dinner(2)[0] && dinner(2)[0].recipe === 'fixture-chicken');
    check('Q4 none: Wed = fish/veg', dinner(3)[0] && dinner(3)[0].recipe === 'fixture-fish');
    check('Q4 none: no leftovers dish anywhere Sun-Wed',
      [0, 1, 2, 3].every(d => dinner(d).every(dish => !dish.leftovers)));
  }

  /* ============ 23. Unmapped leftovers class -> replaces nothing, nights still fill (v3) ============ */
  {
    const STEW = { id: 'fixture-shabbat-stew', title: 'Fixture Shabbat Stew',
      kosher_status: 'pareve', categories: ['main'], tags: ['shabbat'],
      prep_minutes: 15, cook_minutes: 60, servings: '10', leftover_friendly: true,
      search_text: 'potatoes carrots onions celery' };
    check('v3: stew classifies as other (maps to no framework slot)',
      inferPlanningMeta(STEW).slotClass === 'other', JSON.stringify(inferPlanningMeta(STEW)));
    setMeta([...FIX, STEW]);
    const NEXT = '2026-10-25';
    const runFor = async (prevKey, curKey) => {
      const prevDays = blankDays();
      prevDays[5].dinner.dishes = [{ recipe: 'fixture-shabbat-stew' }];
      setPlan({ [prevKey]: { days: prevDays }, [curKey]: { days: blankDays() } });
      const wk = await draftWeek(curKey, {});
      const dinner = d => slotDishes(wk, d, 'dinner');
      return {
        leftoversPlaced: dinner(1).some(dish => dish.leftovers && dish.recipe === 'fixture-shabbat-stew'),
        sun: dinner(0)[0] && dinner(0)[0].recipe,
        tue: dinner(2)[0] && dinner(2)[0].recipe,
        wed: dinner(3)[0] && dinner(3)[0].recipe
      };
    };
    const a = await runFor(PREV, CUR);
    const b = await runFor(CUR, NEXT);
    check('v3: leftovers night placed in both weeks', a.leftoversPlaced && b.leftoversPlaced);
    check('v3: every fresh night fills in both weeks (parity alternation retired — nothing is dropped)',
      !!(a.sun && a.tue && a.wed && b.sun && b.tue && b.wed), JSON.stringify({ a, b }));
    check('v3: fresh nights are beef/pasta/chicken in both weeks (same result, no alternation)',
      a.sun === 'fixture-beef' && a.tue === 'fixture-pasta' && a.wed === 'fixture-chicken' &&
      b.sun === 'fixture-beef' && b.tue === 'fixture-pasta' && b.wed === 'fixture-chicken',
      JSON.stringify({ a, b }));
  }

  /* ============ 24. Rule 5 v3: a class with NO candidates -> nights fill from the pool ============ */
  {
    const PASTA2 = { id: 'fixture-pasta-2', title: 'Fixture Pasta Two', kosher_status: 'dairy',
      categories: ['main', 'pasta'], tags: [],
      prep_minutes: 5, cook_minutes: 15, servings: '4', leftover_friendly: false,
      search_text: 'ziti pasta mozzarella' };
    const CHICKEN2 = { id: 'fixture-chicken-2', title: 'Fixture Chicken Two', kosher_status: 'meat',
      categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '6', leftover_friendly: true,
      search_text: 'chicken wings soy sauce' };
    // NO ground-beef fixture at all — the live-QA Sunday situation.
    setMeta(FIX.filter(m => m.id !== 'fixture-beef').concat([PASTA2, CHICKEN2]));
    setPlan({ [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('fill: all four Sun-Wed nights are filled (no empty Sunday)',
      [0, 1, 2, 3].every(d => dinner(d).length === 1 && !!dinner(d)[0].recipe),
      JSON.stringify([0, 1, 2, 3].map(d => dinner(d)[0] && dinner(d)[0].recipe)));
    check('fill: Sun = pasta, Mon = chicken, Tue = fish (ranking order)',
      dinner(0)[0].recipe === 'fixture-pasta' && dinner(1)[0].recipe === 'fixture-chicken' &&
      dinner(2)[0].recipe === 'fixture-fish');
    check('fill: Wed = pasta #2 (repeat inside the raised target of 2)',
      dinner(3)[0].recipe === 'fixture-pasta-2', dinner(3)[0] && dinner(3)[0].recipe);
    check('fill: the #2 dish reason says so',
      /#2 this week/.test(dinner(3)[0].reason || ''), dinner(3)[0].reason);
  }

  /* ============ 25. Rule 5 v3: targets are SOFT — deprioritized, never forbidden ============ */
  {
    // (a) A favorite fresh chicken (raw score 40) still loses every night
    //     to ordinary first picks when chicken leftovers already count 1.
    const SHAB_CHICKEN = { id: 'fixture-shabbat-chicken', title: 'Fixture Shabbat Chicken',
      kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 20, cook_minutes: 100, servings: '10', leftover_friendly: true,
      search_text: 'chicken onions garlic paprika' };
    const CHICKEN2 = { id: 'fixture-chicken-2', title: 'Fixture Chicken Two', kosher_status: 'meat',
      categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '6', leftover_friendly: true,
      search_text: 'chicken wings soy sauce' };
    setMeta([...FIX, SHAB_CHICKEN, CHICKEN2]);
    const prevDays = blankDays();
    prevDays[5].dinner.dishes = [{ recipe: 'fixture-shabbat-chicken' }];
    setPlan({ [PREV]: { days: prevDays }, [CUR]: { days: blankDays() } },
      { recipePrefs: { 'fixture-chicken-2': { rating: 'favorite', updatedAt: 1 } } });
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('soft: Sun = beef, Tue = pasta (ordinary firsts beat the penalized favorite)',
      dinner(0)[0].recipe === 'fixture-beef' && dinner(2)[0].recipe === 'fixture-pasta');
    check('soft: Wed = fish — the favorite chicken #2 (raw 40, eff 15) is deprioritized',
      dinner(3)[0].recipe === 'fixture-fish', dinner(3)[0] && dinner(3)[0].recipe);
    check('soft: no fresh chicken drafted at all in (a)',
      [0, 2, 3].every(d => dinner(d).every(dish =>
        dish.recipe !== 'fixture-chicken' && dish.recipe !== 'fixture-chicken-2')));
  }
  {
    // (b) But soft means soft: with ONLY chicken candidates, a third
    //     chicken night fills even though the target is 2.
    const C1 = FIX.find(m => m.id === 'fixture-chicken');
    const C2 = { id: 'fixture-chicken-2', title: 'Fixture Chicken Two', kosher_status: 'meat',
      categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '6', leftover_friendly: true,
      search_text: 'chicken wings soy sauce' };
    const C3 = { id: 'fixture-chicken-3', title: 'Fixture Chicken Three', kosher_status: 'meat',
      categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '4', leftover_friendly: false,
      search_text: 'chicken drumsticks paprika' };
    setMeta([C1, C2, C3, FIX.find(m => m.id === 'fixture-roast'), realById['chulent']]);
    setPlan({ [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('soft: Sun + Mon are chicken #1 and #2',
      dinner(0)[0].recipe === 'fixture-chicken' && dinner(1)[0].recipe === 'fixture-chicken-3',
      JSON.stringify([0, 1].map(d => dinner(d)[0] && dinner(d)[0].recipe)));
    check('soft: Tue fills with the third chicken — over target, allowed (soft cap)',
      dinner(2)[0].recipe === 'fixture-chicken-2', dinner(2)[0] && dinner(2)[0].recipe);
    check('soft: the over-target dish reason says "extra this week"',
      /extra this week/.test(dinner(2)[0].reason || ''), dinner(2)[0].reason);
    check('soft: Wed stays empty — no candidates of any class remain',
      dinner(3).length === 0);
  }

  /* ============ 26. Swap: fish and veg are one framework bucket ============ */
  {
    const VEG = { id: 'fixture-veg', title: 'Fixture Tofu Stir Fry', kosher_status: 'pareve',
      categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 15, servings: '4', leftover_friendly: false,
      search_text: 'tofu zucchini peppers stir fry' };
    setMeta([...FIX, VEG]);
    const days = blankDays();
    days[0].dinner.dishes = [{ recipe: 'fixture-fish', drafted: true }];
    setPlan({ [CUR]: { days } });
    const cands = swapCandidates(CUR, 0, 'dinner', 0);
    check('swap bucket: a fish dish offers VEG alternatives too',
      cands.some(c => c.id === 'fixture-veg'), JSON.stringify(cands.map(c => c.id)));
    check('swap bucket: candidates stay inside the fish/veg classes',
      cands.length >= 1 && cands.every(c => c.slotClass === 'fish' || c.slotClass === 'veg'));
  }

  /* ============ 27. Draft snapshots (learning loop, Yidi 2026-10-22) ============ */
  {
    setMeta(FIX);
    setPlan({ [CUR]: { days: blankDays() } });
    const wk = await draftWeek(CUR, { hostingFri: true });
    const snap = (globalThis.mealPlan.draftSnapshots || {})[CUR];
    check('snap: draftWeek records a snapshot for the week', !!snap);
    check('snap: draftCount starts at 1, firstDays == days on the first draft',
      !!snap && snap.draftCount === 1 && JSON.stringify(snap.firstDays) === JSON.stringify(snap.days));
    check('snap: chips are recorded', !!snap && !!snap.chips && snap.chips.hostingFri === true);
    check('snap: snapshot reached the server copy',
      !!(serverState.draftSnapshots && serverState.draftSnapshots[CUR]));
    const sunBefore = JSON.stringify(snap.days[0].dinner);
    globalThis.mealPlan.weeks[CUR].days[0].dinner.dishes = [{ recipe: 'fixture-chicken' }];
    check('snap: later edits do not rewrite the snapshot (deep copy)',
      JSON.stringify(globalThis.mealPlan.draftSnapshots[CUR].days[0].dinner) === sunBefore);
    const firstDaysJson = JSON.stringify(snap.firstDays);
    const wk2 = await draftWeek(CUR, {});
    const snap3 = globalThis.mealPlan.draftSnapshots[CUR];
    check('snap: re-draft bumps draftCount to 2 and preserves firstDays',
      snap3.draftCount === 2 && JSON.stringify(snap3.firstDays) === firstDaysJson);
    check('snap: firstDraftedAt is stable across re-drafts', snap3.firstDraftedAt === snap.firstDraftedAt);
    const older = { draftedAt: '2026-10-20T10:00:00.000Z', firstDraftedAt: '2026-10-20T10:00:00.000Z', draftCount: 1, days: ['A'], firstDays: ['A'] };
    const newer = { draftedAt: '2026-10-22T10:00:00.000Z', firstDraftedAt: '2026-10-22T10:00:00.000Z', draftCount: 3, days: ['B'], firstDays: ['B'] };
    const mg = mergeDraftSnap(older, newer);
    check('snap merge: base is the later draft, first* from the earlier, count is max',
      mg.days[0] === 'B' && mg.firstDays[0] === 'A' && mg.draftCount === 3 &&
      mg.firstDraftedAt === '2026-10-20T10:00:00.000Z');
    check('snap merge: argument order does not matter',
      JSON.stringify(mergeDraftSnap(newer, older)) === JSON.stringify(mg));
    const many = {};
    for (let i = 0; i < 13; i++) {
      const d = new Date(Date.UTC(2026, 8, 6 + i * 7)).toISOString().slice(0, 10);
      many[d] = { draftedAt: d + 'T10:00:00.000Z', firstDraftedAt: d + 'T10:00:00.000Z', draftCount: 1, days: [], firstDays: [] };
    }
    const mergedPlan = mergeMealPlan({ weeks: {}, draftSnapshots: many }, { weeks: {} });
    const mkeys = Object.keys(mergedPlan.draftSnapshots).sort();
    check('snap merge: pruned to the 12 most recent weeks',
      mkeys.length === 12 && !('2026-09-06' in mergedPlan.draftSnapshots), mkeys.join(','));
  }

  /* ============ 28. Time bands (Yidi 2026-10-22): sunday tier + per-class caps ============ */
  {
    const synth = (over) => inferPlanningMeta(Object.assign(
      { id: 'synth', title: 'Synth', categories: ['main'], kosher_status: 'meat', tags: [],
        prep_minutes: null, cook_minutes: null, servings: '4', leftover_friendly: false, search_text: '' }, over));
    const effOf = (search, prep, cook, extra) => synth(Object.assign(
      { search_text: search, prep_minutes: prep, cook_minutes: cook }, extra || {})).effort;
    check('bands: standard caps — 60 weeknight, 61 sunday, 75 sunday, 76 shabbat',
      effOf('chicken breast', 20, 40) === 'weeknight' && effOf('chicken breast', 20, 41) === 'sunday' &&
      effOf('chicken breast', 25, 50) === 'sunday' && effOf('chicken breast', 26, 50) === 'shabbat');
    check('bands: ground-beef caps — 75 weeknight, 76 sunday, 90 sunday, 91 shabbat',
      effOf('ground beef onions', 25, 50) === 'weeknight' && effOf('ground beef onions', 26, 50) === 'sunday' &&
      effOf('ground beef onions', 30, 60) === 'sunday' && effOf('ground beef onions', 31, 60) === 'shabbat');
    check('bands: pasta uses the standard caps (50 weeknight, 70 sunday)',
      effOf('penne pasta tomato', 10, 40) === 'weeknight' && effOf('penne pasta tomato', 20, 50) === 'sunday');
    check('bands: exceptions hold — fast beef-roast (30) still shabbat; shabbat tag wins at 20',
      effOf('brisket onions', 10, 20) === 'shabbat' &&
      effOf('chicken breast', 5, 15, { tags: ['shabbat'] }) === 'shabbat');
    check('bands: no-times fallback unchanged (meat -> shabbat, pareve -> weeknight)',
      effOf('chicken breast', null, null) === 'shabbat' &&
      effOf('salmon fillets', null, null, { kosher_status: 'pareve' }) === 'weeknight');

    // A sunday-tier dish may be drafted on Sunday, never Mon–Wed.
    const SUN_CHICKEN = { id: 'fixture-sunday-chicken', title: 'Fixture Sunday Chicken', kosher_status: 'meat',
      categories: ['main'], tags: [], prep_minutes: 10, cook_minutes: 60, servings: '6',
      leftover_friendly: false, search_text: 'chicken thighs onions' };
    setMeta([...FIX, SUN_CHICKEN]);
    setPlan({ [CUR]: { days: blankDays() } },
      { recipePrefs: { 'fixture-sunday-chicken': { rating: 'favorite', updatedAt: 1 } } });
    const wk = await draftWeek(CUR, {});
    const dinner = d => slotDishes(wk, d, 'dinner');
    check('bands: favorite sunday-tier chicken is drafted on Sunday',
      dinner(0).some(d => d.recipe === 'fixture-sunday-chicken'),
      JSON.stringify([0, 1, 2, 3].map(d => dinner(d)[0] && dinner(d)[0].recipe)));
    check('bands: sunday-tier chicken never lands Mon-Wed',
      [1, 2, 3].every(d => dinner(d).every(dish => dish.recipe !== 'fixture-sunday-chicken')));

    // Swap mirrors the day context: Sunday offers sunday-tier, Monday does not.
    const days2 = blankDays();
    days2[0].dinner.dishes = [{ recipe: 'fixture-chicken', drafted: true }];
    days2[1].dinner.dishes = [{ recipe: 'fixture-chicken', drafted: true }];
    setPlan({ [CUR]: { days: days2 } });
    const sunCands = swapCandidates(CUR, 0, 'dinner', 0);
    const monCands = swapCandidates(CUR, 1, 'dinner', 0);
    check('bands: Sunday swap offers the sunday-tier chicken',
      sunCands.some(c => c.id === 'fixture-sunday-chicken'), JSON.stringify(sunCands.map(c => c.id)));
    check('bands: Monday swap does NOT offer the sunday-tier chicken',
      monCands.every(c => c.id !== 'fixture-sunday-chicken'));
  }

  /* ============ 29. Saturday eat-out chip targets Shabbat lunch + needs-a-side helpers (2026-10-31) ============ */
  {
    setMeta(FIX);
    setPlan({ [CUR]: { days: blankDays() } });
    const wk1 = await draftWeek(CUR, { eatOut: [6] });
    check('sat-eatout: Sa chip skips Saturday lunch with Eat out',
      wk1.days[6].lunch.skipped === true && wk1.days[6].lunch.note === 'Eat out' &&
      slotDishes(wk1, 6, 'lunch').length === 0);
    check('sat-eatout: Sa chip leaves Saturday dinner untouched (never drafted, not skipped)',
      wk1.days[6].dinner.skipped !== true && slotDishes(wk1, 6, 'dinner').length === 0,
      JSON.stringify(wk1.days[6].dinner));
    check('sat-eatout: Friday dinner still drafts with Sa chipped',
      slotDishes(wk1, 5, 'dinner').length === 1);
    setPlan({ [CUR]: JSON.parse(JSON.stringify(wk1)) });
    const wk2 = await draftWeek(CUR, {});
    check('sat-eatout: un-chipping Sa un-skips Saturday lunch and drafts it again',
      wk2.days[6].lunch.skipped === false && slotDishes(wk2, 6, 'lunch').length === 1);
    // A manual Saturday lunch dish is protected.
    const daysM = blankDays();
    daysM[6].lunch.dishes = [{ custom: 'Lunch with friends' }];
    setPlan({ [CUR]: { days: daysM } });
    const wkM = await draftWeek(CUR, { eatOut: [6] });
    check('sat-eatout: manual Saturday lunch dish untouched when chipped',
      wkM.days[6].lunch.skipped !== true && slotDishes(wkM, 6, 'lunch')[0].custom === 'Lunch with friends');
    // A pre-fix stale mark on Saturday dinner is released.
    const daysS = blankDays();
    daysS[6].dinner = { dishes: [], skipped: true, note: 'Eat out' };
    setPlan({ [CUR]: { days: daysS } });
    const wkS = await draftWeek(CUR, { eatOut: [6] });
    check('sat-eatout: stale pre-fix Eat out mark on Saturday dinner is released',
      wkS.days[6].dinner.skipped === false && wkS.days[6].dinner.note === '' &&
      wkS.days[6].lunch.skipped === true);
    // Friday chip behavior unchanged: Fri dinner skipped, Sat lunch drafted.
    setPlan({ [CUR]: { days: blankDays() } });
    const wkF = await draftWeek(CUR, { eatOut: [5] });
    check('sat-eatout: Fri chip still skips Friday dinner and leaves Saturday lunch drafted',
      wkF.days[5].dinner.skipped === true && wkF.days[5].dinner.note === 'Eat out' &&
      wkF.days[6].lunch.skipped !== true && slotDishes(wkF, 6, 'lunch').length === 1);

    // Needs-a-side helpers: single-source field, PDF staleness untouched.
    const base = { id: 'x', title: 'X', pdf_stale: false, leftover_friendly: true };
    const on = withNeedsSide(base, true);
    check('needsside: withNeedsSide sets true and preserves every other field',
      on.needs_side === true && on.pdf_stale === false && on.leftover_friendly === true && base.needs_side === undefined);
    const off = withNeedsSide({ ...base, needs_side: true, pdf_stale: true }, false);
    check('needsside: withNeedsSide sets false without clearing an existing pdf_stale',
      off.needs_side === false && off.pdf_stale === true);
    const card = { id: 'x', title: 'X', variants: [{ key: 'a', label: 'A', slotClass: 'chicken' }], needs_side: false };
    const cardOn = patchMetaNeedsSide(card, true);
    check('needsside: patchMetaNeedsSide preserves variants and other card fields',
      cardOn.needs_side === true && cardOn.variants === card.variants && cardOn.title === 'X');
    const flagMeta = { id: 'f', title: 'Fixture Chicken', kosher_status: 'meat', categories: ['main'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '6', leftover_friendly: true, search_text: 'chicken breast' };
    const withFlag = inferPlanningMeta({ ...flagMeta, needs_side: true });
    const withoutFlag = inferPlanningMeta(flagMeta);
    check('needsside: flag does not change classifier output (generator unaffected)',
      JSON.stringify(withFlag) === JSON.stringify(withoutFlag), JSON.stringify(withFlag));
  }

  /* ============ 30. Pantry staples suite (Yidi 2026-11-01, Argon Q4 scan strings) ============ */
  {
    check('staples: honey / coarse salt / Himalayan salt hide (incl. case variants)',
      isPantryStaple('honey') && isPantryStaple('Honey') &&
      isPantryStaple('coarse salt') && isPantryStaple('Himalayan salt') &&
      isPantryStaple('Coarse Salt'));
    check('staples: Option A parenthetical strip hides parenthetical honey/salt lines',
      isPantryStaple('honey (add to sauce)') &&
      isPantryStaple('honey (use maple syrup to make it fully vegan)') &&
      isPantryStaple('salt (does not need salt)') &&
      isPantryStaple('kosher salt (scant)') &&
      isPantryStaple('salt (for soaking the rice)'));
    check('staples: existing set entries still hide (fine sea salt, garlic powder)',
      isPantryStaple('fine sea salt') && isPantryStaple('garlic powder'));
    check('staples: near-misses stay visible (mustard, pepper, finishing salt, butter, garlic forms)',
      !isPantryStaple('dijon honey mustard') && !isPantryStaple('honey Dijon mustard') &&
      !isPantryStaple('pepper') && !isPantryStaple('freshly ground pepper') &&
      !isPantryStaple('flaky sea salt for finishing') &&
      !isPantryStaple('salted butter') && !isPantryStaple('unsalted butter') &&
      !isPantryStaple('garlic') && !isPantryStaple('fresh garlic') &&
      !isPantryStaple('granulated garlic'));
    check('garlic: COUNT_TO_TSP has no garlic conversion (onion/lemon stay)',
      COUNT_TO_TSP.garlic === undefined && COUNT_TO_TSP.onion === 24 && COUNT_TO_TSP.lemon === 9);
    setMeta([{ id: 'g1', title: 'Garlic Dish', kosher_status: 'pareve', categories: ['main'], tags: [],
      prep_minutes: 5, cook_minutes: 10, servings: '4', leftover_friendly: false, search_text: 'garlic onion' }]);
    globalThis.byId = { g1: { id: 'g1', title: 'Garlic Dish',
      ingredients: [{ section: null, items: [
        { qty: '3', unit: 'cloves', item: 'garlic' },
        { qty: '2', unit: '', item: 'onion' }
      ] }] } };
    const daysG = blankDays();
    daysG[1].dinner.dishes = [{ recipe: 'g1' }];
    daysG[2].dinner.dishes = [{ recipe: 'g1' }];
    setPlan({ [thisWeekKey()]: { days: daysG } });
    const glist = buildShoppingList();
    const glabels = glist.map(i => i.label).join(' ; ');
    check('garlic: cloves display as cloves, never as tbsp/cup (3+3 cloves merge)',
      glist.some(i => /6 cloves garlic/.test(i.label)) &&
      !glist.some(i => /garlic/.test(i.label) && /(tbsp|cup|tsp)/.test(i.label)), glabels);
    check('onion: count-to-volume conversion still merges counts (2+2 onions = 2 cups)',
      glist.some(i => /2 cups? onion/.test(i.label)), glabels);
    globalThis.byId = {};
  }

  /* ============ 31. Card builder, cardIsStale (incl. burritos), and search partitioning (Nov 4, 2026) ============ */
  {
    const burritosJson = JSON.parse(fs.readFileSync(
      path.join(SITE_DIR, 'data', 'recipes', 'burritos.json'), 'utf8'));
    // Stale-card fixture, verbatim from the Studio workspace meta.json
    // (118 cards, Nov 12 build). The live burritos card was re-pressed
    // Nov 11, 2026 23:42 and is fresh, so the live file can no longer
    // serve as the stale example. Stale in exactly the four ways the
    // checks below name: prep 45 (live 40), cook 30 (live 15), no
    // variants key, no ingredients_text key.
    const staleBurritosCard = {
      id: 'burritos', title: 'Burritos', banner_image: 'assets/images/burritos.jpg',
      kosher_status: 'meat', kosher_for_passover: false, categories: ['main'],
      tags: ['burritos', 'mexican', 'dinner'],
      prep_minutes: 45, cook_minutes: 30, servings: '4',
      leftover_friendly: true, tags_need_review: false, photo_generated: true,
      search_text: "ground beef Ortega taco seasoning boneless chicken breast black or pinto beans (15 oz) cumin seeds crushed red pepper jalapeno lemon juice heart of romaine lettuce tomatoes salt black pepper Avocado purple onion vinegar water salt sugar mayonnaise hot sauce garlic paprika honey lemon juice large flour tortillas oil Yidi's own recipe, dictated in chat on 2026-10-22. Versions: Beef (the usual, default) or Chicken; jalapeno is optional anytime. Makes 4 burritos. No rice — ever (Yidi was explicit). Sauce proportions and bean spices are reasonable estimates; the taco seasoning amount (about 1 tbsp) is Yidi's own estimate.",
      needs_side: false
    };
    check('cardIsStale: catches stale burritos card (missing variants + stale times)',
      cardIsStale(staleBurritosCard, burritosJson) === true);
    const burritosDrift = cardDriftFields(staleBurritosCard, burritosJson);
    check('cardDriftFields: reports burritos prep_minutes, cook_minutes, variants, and ingredients_text',
      burritosDrift.includes('prep_minutes') &&
      burritosDrift.includes('cook_minutes') &&
      burritosDrift.includes('variants') &&
      burritosDrift.includes('ingredients_text'),
      burritosDrift.join(','));

    const rebuiltBurritos = buildRecipeCard(burritosJson);
    check('buildRecipeCard: burritos card has prep 40, cook 15, needs_side copied from the recipe JSON, variants beef(ground-beef)+chicken(chicken)',
      rebuiltBurritos.prep_minutes === 40 &&
      rebuiltBurritos.cook_minutes === 15 &&
      rebuiltBurritos.needs_side === (burritosJson.needs_side || false) &&
      Array.isArray(rebuiltBurritos.variants) &&
      rebuiltBurritos.variants.length === 2 &&
      rebuiltBurritos.variants[0].key === 'beef' &&
      rebuiltBurritos.variants[0].slotClass === 'ground-beef' &&
      rebuiltBurritos.variants[1].key === 'chicken' &&
      rebuiltBurritos.variants[1].slotClass === 'chicken' &&
      cardIsStale(rebuiltBurritos, burritosJson) === false);

    const riceJson = JSON.parse(fs.readFileSync(
      path.join(SITE_DIR, 'data', 'recipes', 'rice.json'), 'utf8'));
    const rebuiltRice = buildRecipeCard(riceJson);
    check('buildRecipeCard: rice card matches existing meta.json variants field-for-field',
      JSON.stringify(rebuiltRice.variants) === JSON.stringify(realById['rice'].variants) &&
      rebuiltRice.ingredients_text === 'salt long-grain white rice water brown rice water');

    const honeyLemonJson = JSON.parse(fs.readFileSync(
      path.join(SITE_DIR, 'data', 'recipes', 'honey-lemon-chicken.json'), 'utf8'));
    const rebuiltHoneyLemon = buildRecipeCard(honeyLemonJson);
    check('buildRecipeCard: non-variant recipe omits variants key and separates ingredients_text from notes',
      !('variants' in rebuiltHoneyLemon) &&
      rebuiltHoneyLemon.ingredients_text.includes('honey') &&
      !rebuiltHoneyLemon.ingredients_text.includes('RecipeTin Eats') &&
      rebuiltHoneyLemon.search_text.includes('RecipeTin Eats'));

    // Search partitioning: honey query across all rebuilt cards (120 live).
    // The count is NOT hard-coded: it moves as recipes change (live chulent
    // added honey, 15 -> 17), so assert structure instead — 1 title match,
    // every ingredient match mentioning honey in its ingredients_text.
    const indexIds = JSON.parse(fs.readFileSync(
      path.join(SITE_DIR, 'data', 'recipes', 'index.json'), 'utf8'));
    const allRebuilt = indexIds.map(id => buildRecipeCard(JSON.parse(fs.readFileSync(
      path.join(SITE_DIR, 'data', 'recipes', id + '.json'), 'utf8'))));
    const honeySorted = allRebuilt
      .filter(r => [r.title, (r.tags || []).join(' '), (r.categories || []).join(' '), r.search_text].join(' ').toLowerCase().includes('honey'))
      .sort((a, b) => totalTime(a) - totalTime(b));
    const honeyPart = partitionSearchResults(honeySorted, 'honey');
    check('partitionSearchResults: honey query splits into 1 title match (Honey Lemon Chicken) + ingredient matches, every one mentioning honey',
      honeyPart.active === true &&
      honeyPart.titleMatches.length === 1 &&
      honeyPart.titleMatches[0].id === 'honey-lemon-chicken' &&
      honeyPart.ingredientMatches.length >= 1 &&
      honeyPart.ingredientMatches.every(r => (r.ingredients_text || '').toLowerCase().includes('honey')) &&
      honeyPart.ingredientMatches.some(r => r.id === 'dill-dip-salmon') &&
      honeyPart.otherMatches.length === 0);

    // Tag-only, category-only, and notes-only queries land in otherMatches (3rd bucket)
    const tagOnlyFixture = [{
      id: 'freezer-kugel', title: 'Potato Bake',
      categories: ['main'], tags: ['freezer-friendly', 'passover'],
      ingredients_text: 'potatoes eggs oil salt pepper',
      search_text: 'potatoes eggs oil salt pepper'
    }];
    const tagPart = partitionSearchResults(tagOnlyFixture, 'freezer-friendly');
    check('partitionSearchResults: tag-only query lands in otherMatches (3rd bucket)',
      tagPart.active === true &&
      tagPart.titleMatches.length === 0 &&
      tagPart.ingredientMatches.length === 0 &&
      tagPart.otherMatches.length === 1 &&
      tagPart.otherMatches[0].id === 'freezer-kugel');

    const catPart = partitionSearchResults([rebuiltHoneyLemon], 'main');
    check('partitionSearchResults: category-only query lands in otherMatches (3rd bucket)',
      catPart.active === true &&
      catPart.titleMatches.length === 0 &&
      catPart.ingredientMatches.length === 0 &&
      catPart.otherMatches.length === 1 &&
      catPart.otherMatches[0].id === 'honey-lemon-chicken');

    const notesPart = partitionSearchResults([rebuiltHoneyLemon], 'RecipeTin Eats');
    check('partitionSearchResults: notes-only query lands in otherMatches (3rd bucket)',
      notesPart.active === true &&
      notesPart.titleMatches.length === 0 &&
      notesPart.ingredientMatches.length === 0 &&
      notesPart.otherMatches.length === 1 &&
      notesPart.otherMatches[0].id === 'honey-lemon-chicken');
  }

  const failed = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' assertions passed ====');
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error('ERROR', e); process.exit(2); });

