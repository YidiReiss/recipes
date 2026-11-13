/* Commit 2B (Smart Meal Planning v1, UI stage) — offline tests for the
   non-DOM logic the UI adds: variant filtering for the detail page,
   chips normalization + the chips shape draftWeek consumes, prefs /
   feedback write shapes (through the REAL saveMealPlan chain against
   a fake bridge), warning signatures + strip HTML, feedback-row
   eligibility, and small pure helpers. Same extraction approach as
   commit2-test.cjs: real functions, brace-matched out of site/app.js.
   Run: node commit2-ui-test.cjs */
const fs = require('fs');
const path = require('path');

const SITE_DIR = fs.existsSync(path.join(__dirname, 'app.js'))
  ? __dirname
  : path.join(__dirname, '..', 'site');
const SRC = fs.readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
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
globalThis.getEditorName = () => 'Tester';
globalThis.editingSlot = null;   // slotHTML reads it; null = not editing
/* esc is a pure utility collaborator (used by planWarningsHTML for one
   attribute); extraction helpers can't slice it — its own body contains
   ';' inside the HTML entities — so it is stubbed with its exact app.js
   implementation. */
globalThis.esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
globalThis.fetch = async () => {
  await sleep(1);
  return { ok: true, json: async () => ({ ok: true, content: JSON.stringify(serverState) }) };
};
globalThis.ghPut = async (p, text) => { await sleep(1); serverState = JSON.parse(text); return { ok: true }; };

/* ---------------- load the real code ---------------- */
['totalTime', 'ymd', 'blankSlot'].forEach(n => geval(extractDeclSemi(n)));
['PLAN_RE', 'YIELD_LEFT_VALUES', 'TSP_PER', 'COUNT_TO_TSP', 'SIZE_WORDS',
 'UNCOUNTABLES', 'IRREGULAR_PLURALS', 'IRREGULAR_SINGULARS',
 'UNICODE_FRACTIONS'].forEach(n => geval(extractDecl(n)));
geval(SRC.match(/let _savePlanChain = Promise\.resolve\(\);/)[0] + '\n' +
      SRC.match(/let _savePlanInFlight = 0;/)[0] + '\n' +
      SRC.match(/let _shopSyncTimer = null;/)[0] + '\n' +
      SRC.match(/let _shopDirty = false;/)[0] + '\n' +
      SRC.match(/let _shopDirtyGen = 0;/)[0] + '\n' +
      extract('syncShopSoon') + '\n' +
      extract('attemptSaveMealPlan') + '\n' +
      extract('saveMealPlan'));
extract('parseQty', true).forEach(src => geval(src));
['qtyToNum', 'fmtQty', 'pluralize', 'pluralizeUnit', 'stripSize', 'groupKey',
 'parseSingleValue', 'parseFractionOrDecimal',
 'fromTsp', 'parseServings', 'normalizeSlot', 'sundayOf', 'weekDayYmd',
 'thisWeekKey', 'shoppingFromYmd', 'getWeek', 'recipeMeta', 'lookupShoppingSection', 'buildShoppingList',
 'normalizeHaveMarks', 'mergeHaveMarks', 'mergeManualItems', 'normalizePromotedList',
 'mergePromoted', 'mergeWeekState', 'mergeMealPlan', 'mergeDraftSnap', 'bridgeReadMealPlan',
 'slugify',
 'weekKeyDate', 'addDaysToKey', 'daysBetweenKeys', 'prevWeekKeyOf',
 'planningRawWeek', 'planSlot', 'planningPrefs', 'allPlanningMeta',
 'inferPlanningMeta', 'effectivePlanningMeta', 'yieldMedian', 'leftoverServings',
 'computeLastCooked', 'buildCarryInPool', 'recomputeWeekLunches',
 'slotIsProtected', 'slotKosherAllowed', 'scorePlanningCandidate',
 'planningCandidates', 'persistPlannedWeek', 'draftWeek',
 'swapCandidates', 'applySwap',
 /* Commit 2B */
 'variantDefaultKey', 'recipeVariantsFor', 'variantLabelFor',
 'ingredientVisibleForVariant', 'filterIngredientsForVariant',
 'normalizeDraftChips', 'buildPrefsEntry', 'setRecipePref', 'buildYieldEntry',
 'recordMealFeedback', 'warningSignature', 'planWarningsHTML',
 'lastMadeText', 'uniqueVariantKey', 'feedbackRowHTML', 'slotHTML',
 /* Phase 1 Cooking Enhancements */
 'formatQty', 'scaleQty', 'pluralizeScaledUnit',
 'parseTimerNumberToken', 'timerUnitSeconds', 'formatTimerPillDuration',
 'formatTimerReadout', 'parseStepTimers', 'renderStepWithTimersHTML',
 'createTimer', 'tickTimer', 'pauseTimer', 'resumeTimer', 'resetTimer',
 'addTimerSeconds', 'addTimerMinute', 'shouldFireTimerAlarm',
 'formatSpokenDuration', 'formatAlarmTimeRange', 'buildTimerAlarmPhrase',
 'speakTextWithOpts', 'resolveSpeechVoice', 'getSpeechVoices', 'filterAlarmVoices',
 'serializeTimersForSession', 'restoreTimersFromSessionJSON', 'timerDockHTML',
 'clampCookStepIndex', 'formatScaledIngredientLine', 'cookModeIngredientsHTML',
 'cookModeStepHTML',
 'stopStepSpeech', 'speakRecipeStepText'
].forEach(n => geval(extract(n)));
/* speakTimerAlarm closes over the module-level _alarmWatchdogId (Fix 1):
   load both in ONE eval unit so the binding survives (a bare `let` in its
   own indirect eval is discarded with that eval). */
geval('let _alarmWatchdogId = null;\n' + extract('speakTimerAlarm') + '\nglobalThis.speakTimerAlarm = speakTimerAlarm;');
['TIMER_WORD_NUMS', 'TIMER_ALARM_VOICE_OPTS'].forEach(n => geval(extractDecl(n)));
/* Spoken-alarm constants are plain numeric expressions — expose their
   evaluated values as globals so shouldFireTimerAlarm tests read the real
   source values instead of a duplicated copy. */
geval('globalThis.TIMER_ALARM_REPEAT_MS = ' + SRC.match(/const TIMER_ALARM_REPEAT_MS = ([^;]+);/)[1] + ';');
geval('globalThis.TIMER_ALARM_MAX_OVERTIME_MS = ' + SRC.match(/const TIMER_ALARM_MAX_OVERTIME_MS = ([^;]+);/)[1] + ';');
/* Voice-setting state + functions loaded in ONE eval unit so the functions
   close over timerVoiceEnabled (a module-level `let` in app.js). */
geval('let timerVoiceEnabled = true;\nlet _timerVoiceStorageFailed = false;\n' +
  extractDeclSemi('TIMER_VOICE_SETTING_KEY') + '\n' +
  extractDeclSemi('TIMER_SESSION_KEY') + '\n' +
  extract('resolveTimerVoiceSetting') + '\n' +
  extract('setTimerVoiceSetting') + '\n' +
  extract('initTimerVoiceSetting') + '\n' +
  'globalThis.resolveTimerVoiceSetting = resolveTimerVoiceSetting;\n' +
  'globalThis.setTimerVoiceSetting = setTimerVoiceSetting;\n' +
  'globalThis.initTimerVoiceSetting = initTimerVoiceSetting;\n' +
  'globalThis.__timerVoiceEnabled = () => timerVoiceEnabled;');
geval(extractDecl('PLAN_DAY_NAMES'));
/* draftUseUp/draftChipWeekKey are module-level `let`s shared with
   seedDraftChips — load them in ONE eval unit with test accessors. */
geval('let draftUseUp = [];\nlet draftChipWeekKey = null;\n' +
  extract('seedDraftChips') +
  '\nglobalThis.__draftUseUp = () => draftUseUp;' +

  '\nglobalThis.__draftChipWeekKey = () => draftChipWeekKey;');
/* Wake-lock wrapper state + functions loaded in one eval unit so the
   functions close over wakeLockSentinel / wakeLockWanted / wakeLockTimeoutId. */
geval('const WAKE_LOCK_MAX_MS = 7200000;\n' +
  'let wakeLockSentinel = null;\n' +
  'let wakeLockWanted = false;\n' +
  'let wakeLockTimeoutId = null;\n' +
  'function updateWakeLockButtons() {}\n' +
  'function tickAllTimers() {}\n' +
  extract('wakeLockSupported') + '\n' +
  extract('acquireWakeLock') + '\n' +
  extract('releaseWakeLock') + '\n' +
  extract('handleWakeLockVisibility') + '\n' +
  'globalThis.wakeLockSupported = wakeLockSupported;\n' +
  'globalThis.acquireWakeLock = acquireWakeLock;\n' +
  'globalThis.releaseWakeLock = releaseWakeLock;\n' +
  'globalThis.handleWakeLockVisibility = handleWakeLockVisibility;\n' +
  'globalThis.__wakeLockState = () => ({ sentinel: wakeLockSentinel, wanted: wakeLockWanted });');

/* ---------------- harness ---------------- */
const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : ''));
}
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

async function main() {
  /* ============ 1. Variant helpers + detail-page filtering ============ */
  const burritos = {
    id: 'burritos', title: 'Burritos', categories: ['main'], kosher_status: 'meat',
    tags: [], prep_minutes: 15, cook_minutes: 20, servings: '4',
    search_text: 'ground beef chicken tortilla rice',
    variants: [
      { key: 'beef', label: 'Beef', default: true, slotClass: 'ground-beef' },
      { key: 'chicken', label: 'Chicken', slotClass: 'chicken' }
    ],
    ingredients: [
      { section: '', items: [
        { qty: '8', unit: '', item: 'tortillas' },
        { qty: '1', unit: 'cup', item: 'rice' },
        { qty: '1', unit: 'lb', item: 'ground beef', variant: 'beef' },
        { qty: '1', unit: 'lb', item: 'cut-up chicken', variant: 'chicken' },
        { qty: '1', unit: 'tsp', item: 'chili flakes', optional: true }
      ]},
      { section: 'Chicken only extras', items: [
        { qty: '1', unit: '', item: 'lime', variant: 'chicken' }
      ]}
    ]
  };
  setMeta([burritos]);
  globalThis.byId = { burritos: JSON.parse(JSON.stringify(burritos)) };

  check('variantDefaultKey picks the flagged default',
    variantDefaultKey(burritos.variants) === 'beef');
  check('variantDefaultKey falls back to first / null',
    variantDefaultKey([{ key: 'a' }, { key: 'b' }]) === 'a' &&
    variantDefaultKey([]) === null && variantDefaultKey(null) === null);
  const rvf = recipeVariantsFor('burritos');
  check('recipeVariantsFor (full recipe): default flag honored',
    rvf.length === 2 && rvf[0].isDefault === true && rvf[1].isDefault === false);
  globalThis.byId = {};
  const rvfMeta = recipeVariantsFor('burritos');
  check('recipeVariantsFor (meta only): first is default',
    rvfMeta.length === 2 && rvfMeta[0].isDefault === true);
  check('variantLabelFor resolves labels, falls back to key',
    variantLabelFor('burritos', 'chicken') === 'Chicken' &&
    variantLabelFor('burritos', 'mystery') === 'mystery' &&
    variantLabelFor('burritos', null) === '');

  const itemsOf = secs => secs.flatMap(s => s.items.map(i => i.item));
  const beefList = filterIngredientsForVariant(burritos.ingredients, 'beef');
  check('filter beef: shared + beef shown, chicken hidden',
    itemsOf(beefList).includes('ground beef') && !itemsOf(beefList).includes('cut-up chicken') &&
    itemsOf(beefList).includes('tortillas'));
  check('filter beef: optional add-on shows under the version',
    itemsOf(beefList).includes('chili flakes'));
  check('filter beef: chicken-only section dropped',
    beefList.length === 1);
  const chickenList = filterIngredientsForVariant(burritos.ingredients, 'chicken');
  check('filter chicken: chicken + its section shown, beef hidden',
    itemsOf(chickenList).includes('cut-up chicken') && itemsOf(chickenList).includes('lime') &&
    !itemsOf(chickenList).includes('ground beef'));
  const sharedOnly = filterIngredientsForVariant(burritos.ingredients, null);
  check('filter null variant: shared items only',
    JSON.stringify(itemsOf(sharedOnly).sort()) ===
    JSON.stringify(['chili flakes', 'rice', 'tortillas']));
  check('ingredientVisibleForVariant predicate',
    ingredientVisibleForVariant({ item: 'x' }, 'beef') === true &&
    ingredientVisibleForVariant({ item: 'x', variant: 'beef' }, 'beef') === true &&
    ingredientVisibleForVariant({ item: 'x', variant: 'beef' }, 'chicken') === false &&
    ingredientVisibleForVariant({ item: 'x', variant: 'beef' }, null) === false &&
    ingredientVisibleForVariant(null, 'beef') === false);

  /* ============ 2. Chips normalization ============ */
  check('normalizeDraftChips: empty/garbage -> defaults',
    JSON.stringify(normalizeDraftChips(null)) ===
      JSON.stringify({ hostingFri: false, hostingSat: false, eatOut: [], useUp: [] }) &&
    JSON.stringify(normalizeDraftChips('junk')) ===
      JSON.stringify({ hostingFri: false, hostingSat: false, eatOut: [], useUp: [] }));
  const nc = normalizeDraftChips({
    hostingFri: 1, eatOut: [1, 4, 7, -1, 2.5, '3'],
    useUp: [' spinach ', '', 'beef', 'a', 'b', 'c', 'd']
  });
  check('normalizeDraftChips: eatOut filtered to int day indexes',
    JSON.stringify(nc.eatOut) === JSON.stringify([1, 4]));
  check('normalizeDraftChips: useUp trimmed, blanks dropped, capped at 5',
    JSON.stringify(nc.useUp) === JSON.stringify(['spinach', 'beef', 'a', 'b', 'c']) &&
    nc.hostingFri === true && nc.hostingSat === false);

  /* ============ 3. Chips -> draftWeek wiring shape ============ */
  const META = [
    { id: 'tacos', title: 'Beef Tacos', categories: ['main'], kosher_status: 'meat', tags: [], prep_minutes: 10, cook_minutes: 20, servings: '4', search_text: 'ground beef tortilla', leftover_friendly: false },
    { id: 'pesto-pasta', title: 'Pesto Pasta', categories: ['main', 'pasta'], kosher_status: 'dairy', tags: [], prep_minutes: 10, cook_minutes: 15, servings: '4', search_text: 'pasta basil', leftover_friendly: false },
    { id: 'schnitzel', title: 'Chicken Schnitzel', categories: ['main'], kosher_status: 'meat', tags: [], prep_minutes: 15, cook_minutes: 15, servings: '4', search_text: 'chicken breast crumbs', leftover_friendly: false },
    { id: 'salmon', title: 'Baked Salmon', categories: ['main'], kosher_status: 'pareve', tags: [], prep_minutes: 10, cook_minutes: 20, servings: '4', search_text: 'salmon fish', leftover_friendly: false },
    { id: 'brisket', title: 'Brisket', categories: ['main'], kosher_status: 'meat', tags: [], prep_minutes: 20, cook_minutes: 180, servings: '8', search_text: 'brisket roast beef', leftover_friendly: true },
    { id: 'shab-chicken', title: 'Shabbat Chicken', categories: ['main'], kosher_status: 'meat', tags: ['shabbat'], prep_minutes: 15, cook_minutes: 60, servings: '6', search_text: 'chicken potatoes', leftover_friendly: true }
  ];
  setMeta(META);
  const WK = '2026-11-01';
  setPlan({ [WK]: { days: blankDays() } });
  const chips = normalizeDraftChips({ hostingFri: true, eatOut: [1], useUp: ['spinach'] });
  await draftWeek(WK, chips);
  const drafted = serverState.weeks[WK];
  check('draft with chips: eat-out Monday dinner marked skipped',
    drafted.days[1].dinner.skipped === true && drafted.days[1].dinner.note === 'Eat out');
  check('draft with chips: Thu pizza standing dish placed',
    (drafted.days[4].dinner.dishes || []).some(d => d.custom === 'Pizza'));
  let scaleWritten = false;
  drafted.days.forEach(day => ['lunch', 'dinner'].forEach(m =>
    (day[m].dishes || []).forEach(d => { if ('scale' in d) scaleWritten = true; })));
  check('draft with chips: generator never wrote dish.scale', !scaleWritten);

  /* ============ 4. Prefs writes ============ */
  const pe = buildPrefsEntry({ rating: 'fine', slotClass: 'chicken' }, { rating: null }, 'Tester', 12345);
  check('buildPrefsEntry: null clears a field, others preserved, stamped',
    pe.rating === null && pe.slotClass === 'chicken' &&
    pe.updatedAt === 12345 && pe.updatedBy === 'Tester');
  setPlan({}, { recipePrefs: {} });
  await setRecipePref('tacos', { rating: 'favorite' });
  check('setRecipePref writes through saveMealPlan',
    serverState.recipePrefs.tacos.rating === 'favorite' &&
    serverState.recipePrefs.tacos.updatedBy === 'Tester' &&
    typeof serverState.recipePrefs.tacos.updatedAt === 'number');
  await setRecipePref('tacos', { effort: 'shabbat' });
  check('setRecipePref merges fields (rating kept)',
    serverState.recipePrefs.tacos.rating === 'favorite' &&
    serverState.recipePrefs.tacos.effort === 'shabbat');
  await setRecipePref('tacos', { rating: null });
  check('setRecipePref Auto clears back to inferred',
    serverState.recipePrefs.tacos.rating === null &&
    serverState.recipePrefs.tacos.effort === 'shabbat');

  /* ============ 5. Feedback writes ============ */
  const ye = buildYieldEntry({ recipe: 'brisket', scale: 2, variant: 'beef' }, '2020-01-10', 'a lot', 'Tester', 'yl-x');
  check('buildYieldEntry shape (scale/variant passthrough)',
    ye.id === 'yl-x' && ye.recipe === 'brisket' && ye.scale === 2 && ye.variant === 'beef' &&
    ye.left === 'a lot' && ye.date === '2020-01-10' && ye.updatedBy === 'Tester');
  const ye2 = buildYieldEntry({ recipe: 'tacos' }, '2020-01-10', 'none', 'Tester', 'yl-y');
  check('buildYieldEntry defaults scale 1, variant null',
    ye2.scale === 1 && ye2.variant === null);

  const PAST = '2020-01-05';   // a Sunday, safely in the past
  const pastDays = blankDays();
  pastDays[5].dinner = { dishes: [{ recipe: 'brisket', leftovers: false, cookDate: null }], skipped: false, note: '' };
  pastDays[2].dinner = { dishes: [{ recipe: 'tacos', leftovers: false, cookDate: null }], skipped: false, note: '' };
  setPlan({ [PAST]: { days: pastDays } }, { recipePrefs: {}, yieldLog: [] });

  await recordMealFeedback(PAST, 5, 'dinner', 0, { rating: 'favorite' });
  check('feedback rating tap: prefs written, feedback NOT completed',
    serverState.recipePrefs.brisket.rating === 'favorite' &&
    !serverState.weeks[PAST].days[5].dinner.dishes[0].feedbackDone &&
    (serverState.yieldLog || []).length === 0);
  await recordMealFeedback(PAST, 5, 'dinner', 0, { left: 'a lot' });
  const yl = serverState.yieldLog || [];
  check('feedback Left tap: yield entry appended (right date/recipe/left)',
    yl.length === 1 && yl[0].recipe === 'brisket' && yl[0].left === 'a lot' &&
    yl[0].date === '2020-01-10' && yl[0].scale === 1 && yl[0].variant === null &&
    typeof yl[0].id === 'string' && yl[0].id.length > 0);
  check('feedback Left tap: dish feedbackDone set',
    serverState.weeks[PAST].days[5].dinner.dishes[0].feedbackDone === true);
  await recordMealFeedback(PAST, 2, 'dinner', 0, { dismiss: true });
  check('feedback dismiss: completes WITHOUT a yield entry',
    (serverState.yieldLog || []).length === 1 &&
    serverState.weeks[PAST].days[2].dinner.dishes[0].feedbackDone === true);

  /* ============ 6. Warnings strip ============ */
  check('warningSignature distinguishes warnings',
    warningSignature({ day: 2, kind: 'partial', have: 1, need: 2 }) === '2|partial|1|2' &&
    warningSignature({ day: 2, kind: 'uncovered', have: 0, need: 2 }) === '2|uncovered|0|2');
  const wkWarn = {
    lunchWarnings: [
      { day: 2, kind: 'partial', have: 1, need: 2 },
      { day: 3, kind: 'uncovered', have: 0, need: 2 }
    ]
  };
  const strip = planWarningsHTML(PAST, wkWarn);
  check('warnings strip renders partial + uncovered lines',
    strip.includes('Tuesday lunch only has ~1 leftover serving (needs 2)') &&
    strip.includes('Wednesday lunch isn\u2019t covered by leftovers') &&
    strip.includes('data-dismiss-warnings'));
  const stripDismissed = planWarningsHTML(PAST, {
    ...wkWarn, dismissedWarnings: ['2|partial|1|2', '3|uncovered|0|2']
  });
  check('warnings strip hidden when all dismissed', stripDismissed === '');
  const stripPartial = planWarningsHTML(PAST, {
    ...wkWarn, dismissedWarnings: ['2|partial|1|2']
  });
  check('warnings strip shows only un-dismissed warnings',
    !stripPartial.includes('Tuesday') && stripPartial.includes('Wednesday'));
  check('warnings strip empty with no warnings',
    planWarningsHTML(PAST, {}) === '' && planWarningsHTML(PAST, { lunchWarnings: [] }) === '');

  /* ============ 7. Feedback row eligibility ============ */
  const fbWeek = { draftChips: { hostingFri: false, hostingSat: false, eatOut: [], useUp: [] } };
  const dish = { recipe: 'brisket', leftovers: false, cookDate: null };
  const rowHtml = feedbackRowHTML(PAST, 3, 'dinner', 0, dish, fbWeek);
  check('feedback row: past dinner dish shows rating + Left',
    rowHtml.includes('How was it?') && rowHtml.includes('Left:') &&
    rowHtml.includes('data-fbrate') && rowHtml.includes('data-fbleft') &&
    rowHtml.includes('data-fbdismiss'));
  const hostRow = feedbackRowHTML(PAST, 5, 'dinner', 0, dish,
    { draftChips: { hostingFri: true, hostingSat: false, eatOut: [], useUp: [] } });
  check('feedback row: Friday hosting hides Left, keeps rating',
    hostRow.includes('How was it?') && !hostRow.includes('Left:'));
  check('feedback row: hidden for leftovers / done / lunch / custom / future',
    feedbackRowHTML(PAST, 3, 'dinner', 0, { ...dish, leftovers: true }, fbWeek) === '' &&
    feedbackRowHTML(PAST, 3, 'dinner', 0, { ...dish, feedbackDone: true }, fbWeek) === '' &&
    feedbackRowHTML(PAST, 3, 'lunch', 0, dish, fbWeek) === '' &&
    feedbackRowHTML(PAST, 3, 'dinner', 0, { custom: 'Pizza' }, fbWeek) === '' &&
    feedbackRowHTML('2999-01-03', 3, 'dinner', 0, dish, fbWeek) === '');

  /* ============ 8. Small helpers ============ */
  check('lastMadeText phrasing',
    lastMadeText('2026-10-20', '2026-10-22') === 'Last made this week' &&
    lastMadeText('2026-10-13', '2026-10-22') === 'Last made 1 wk ago' &&
    lastMadeText('2026-09-24', '2026-10-22') === 'Last made 4 wks ago' &&
    lastMadeText('2026-10-23', '2026-10-22') === '' &&
    lastMadeText('', '2026-10-22') === '');
  check('uniqueVariantKey slugifies + dedupes, ignores self',
    uniqueVariantKey([], 'Cut-up Chicken', -1) === 'cut-up-chicken' &&
    uniqueVariantKey([{ key: 'beef' }], 'Beef', -1) === 'beef-2' &&
    uniqueVariantKey([{ key: 'beef' }], 'Beef', 0) === 'beef' &&
    uniqueVariantKey([], '', -1) === 'recipe');   // slugify's own fallback
  seedDraftChips('2026-11-01', { draftChips: { useUp: ['spinach', 'beef'] } });
  check('seedDraftChips seeds use-up from the week record',
    JSON.stringify(globalThis.__draftUseUp()) === JSON.stringify(['spinach', 'beef']) &&
    globalThis.__draftChipWeekKey() === '2026-11-01');
  seedDraftChips('2026-11-01', { draftChips: { useUp: ['other'] } });
  check('seedDraftChips does not reseed for the same week',
    JSON.stringify(globalThis.__draftUseUp()) === JSON.stringify(['spinach', 'beef']));
  seedDraftChips('2026-11-08', {});
  check('seedDraftChips reseeds (empty) for a new week',
    JSON.stringify(globalThis.__draftUseUp()) === JSON.stringify([]));

  /* ============ 9. Argon fix 7: no Swap button on leftovers dishes ============ */
  setMeta(META);
  setPlan({ [PAST]: { days: blankDays(), lunchWarnings: [] } });
  const mixedSlot = { dishes: [
    { recipe: 'brisket', leftovers: true, drafted: true, cookDate: null },
    { recipe: 'tacos', leftovers: false, drafted: true, cookDate: null }
  ], skipped: false, note: '' };
  const mixedHTML = slotHTML(PAST, 2, 'dinner', mixedSlot, true, false);
  const swapCount = (mixedHTML.match(/data-dishswap/g) || []).length;
  check('fix7: Swap button rendered exactly once (normal dish only, NOT the leftovers dish)',
    swapCount === 1, 'data-dishswap x' + swapCount);
  check('fix7: the one Swap targets the tacos row (index 1)',
    mixedHTML.includes('data-dishswap="' + PAST + '|2|dinner|1"'));
  const leftoversOnlyHTML = slotHTML(PAST, 2, 'dinner',
    { dishes: [{ recipe: 'brisket', leftovers: true, drafted: true, cookDate: null }], skipped: false, note: '' },
    true, false);
  check('fix7: a leftovers-only slot renders no Swap at all',
    !leftoversOnlyHTML.includes('data-dishswap'));

  /* ============ 10. Home search suggestions (2026-11-01) ============ */
  geval(extract('filteredRecipes'));
  geval(extractDecl('fmtTime'));
  geval(extract('homeSuggestMatches'));
  geval(extract('homeSuggestHTML'));
  globalThis.filters = { q: '', kosher: 'all', kfp: false, category: 'all', tag: 'all', maxTime: 0, leftovers: false, sort: 'asc' };
  const SUGG = [
    { id: 'chicken-soup', title: 'Chicken Soup', kosher_status: 'meat', kosher_for_passover: false, categories: ['main'], tags: [], prep_minutes: 60, cook_minutes: 60, servings: 6, leftover_friendly: true, search_text: 'chicken carrots', notes: '' },
    { id: 'chicken-salad', title: 'Chicken Salad', kosher_status: 'meat', kosher_for_passover: false, categories: ['salad'], tags: [], prep_minutes: 10, cook_minutes: 10, servings: 4, leftover_friendly: false, search_text: 'chicken mayo', notes: '' },
    { id: 'quick-salad', title: 'Quick Salad', kosher_status: 'pareve', kosher_for_passover: false, categories: ['salad'], tags: [], prep_minutes: 10, cook_minutes: 5, servings: 2, leftover_friendly: false, search_text: 'greens chicken broth', notes: '' },
    { id: 'dairy-pasta', title: 'Dairy Pasta', kosher_status: 'dairy', kosher_for_passover: false, categories: ['pasta'], tags: [], prep_minutes: 10, cook_minutes: 20, servings: 4, leftover_friendly: false, search_text: 'pasta cheese', notes: '' },
  ];
  for (let i = 0; i < 10; i++) SUGG.push({ id: 'soup-' + i, title: 'Soup ' + i, kosher_status: 'pareve', kosher_for_passover: false, categories: ['soup'], tags: [], prep_minutes: 5, cook_minutes: 5, servings: 2, leftover_friendly: false, search_text: '', notes: '' });
  setMeta(SUGG);
  const chickenIds = homeSuggestMatches('chicken').map(r => r.id);
  check('suggest: title matches rank before ingredient-only matches (grid time order within each tier)',
    JSON.stringify(chickenIds) === JSON.stringify(['chicken-salad', 'chicken-soup', 'quick-salad']),
    chickenIds.join(','));
  check('suggest: capped at 8', homeSuggestMatches('soup').length === 8);
  check('suggest: empty/blank query returns no matches',
    homeSuggestMatches('').length === 0 && homeSuggestMatches('   ').length === 0);
  check('suggest: query override ignores filters.q',
    (() => { globalThis.filters.q = 'zzz'; const ids = homeSuggestMatches('chicken').map(r => r.id); globalThis.filters.q = ''; return ids.length === 3; })());
  globalThis.filters.kosher = 'dairy';
  check('suggest: respects the active kosher filter',
    JSON.stringify(homeSuggestMatches('pasta').map(r => r.id)) === JSON.stringify(['dairy-pasta']));
  globalThis.filters.kosher = 'meat';
  check('suggest: filter can empty the list', homeSuggestMatches('pasta').length === 0);
  globalThis.filters.kosher = 'all';
  const noMatchHTML = homeSuggestHTML('a<b', [], -1);
  check('suggest: no-match row escapes the query',
    noMatchHTML.includes('No recipes match') && noMatchHTML.includes('a&lt;b') && !noMatchHTML.includes('<b') &&
    noMatchHTML.includes('role="status"'));
  check('suggest: empty query renders no HTML', homeSuggestHTML('', [], -1) === '');
  const suggHTML = homeSuggestHTML('chicken', homeSuggestMatches('chicken'), 1);
  check('suggest: exactly one active row with option id + aria-selected',
    (suggHTML.match(/combo-item active/g) || []).length === 1 &&
    suggHTML.includes('id="q-opt-1"') && suggHTML.includes('aria-selected="true"') &&
    (suggHTML.match(/role="option"/g) || []).length === 3);
  check('suggest: rows carry the total-time hint', suggHTML.includes('20 min'));

/* ============ 15. Phase 1: parseStepTimers (messy strings, ranges, fractions, false positives) ============ */
  const t2030 = parseStepTimers('Stir for 20-30 seconds until fragrant.');
  check('timers: "20-30 seconds" -> lower bound 20s, high 30s, range label',
    t2030.length === 1 && t2030[0].seconds === 20 && t2030[0].lowSeconds === 20 &&
    t2030[0].highSeconds === 30 && t2030[0].label === '20s\u201330s (20s)', JSON.stringify(t2030));

  const t1m = parseStepTimers('Beat on medium for 1 minute.');
  check('timers: "1 minute" -> 60s, label 1m',
    t1m.length === 1 && t1m[0].seconds === 60 && t1m[0].label === '1m');

  const t1h = parseStepTimers('Let rise for 1 hour in a warm spot.');
  check('timers: "1 hour" -> 3600s, label 1h',
    t1h.length === 1 && t1h[0].seconds === 3600 && t1h[0].label === '1h');

  const t3040 = parseStepTimers('Roast for 30-40 minutes until golden.');
  check('timers: "30-40 minutes" -> starts at lower bound 1800s, high 2400s, label "30m–40m (30m)"',
    t3040.length === 1 && t3040[0].seconds === 1800 && t3040[0].highSeconds === 2400 &&
    t3040[0].label === '30m\u201340m (30m)');

  const t4045 = parseStepTimers('Bake 40-45 minutes.');
  check('timers: "40-45 minutes" -> 2400s low, 2700s high',
    t4045.length === 1 && t4045[0].seconds === 2400 && t4045[0].highSeconds === 2700 &&
    t4045[0].label === '40m\u201345m (40m)');

  const tAbout5 = parseStepTimers('Cook about 5 minutes.');
  check('timers: "about 5 minutes" -> 300s (5m)',
    tAbout5.length === 1 && tAbout5[0].seconds === 300 && tAbout5[0].label === '5m');

  const tUnicodeRange = parseStepTimers('Place the meat in the pot and simmer over low flame for 1½ to 2 hours.');
  check('timers: Unicode fraction range "1½ to 2 hours" -> 5400s low, 7200s high',
    tUnicodeRange.length === 1 && tUnicodeRange[0].seconds === 5400 &&
    tUnicodeRange[0].highSeconds === 7200 && tUnicodeRange[0].label === '1h 30m\u20132h (1h 30m)');

  const tAsciiMixedRange = parseStepTimers('Bring to a simmer and cook gently, starting to check at 3-3 1/2 hours.');
  check('timers: ASCII mixed range "3-3 1/2 hours" -> 10800s low, 12600s high',
    tAsciiMixedRange.length === 1 && tAsciiMixedRange[0].seconds === 10800 &&
    tAsciiMixedRange[0].highSeconds === 12600 && tAsciiMixedRange[0].label === '3h\u20133h 30m (3h)');

  const tCompound = parseStepTimers('Bake about 1 hour 40 minutes to 2 hours, until the center reads 180°F.');
  check('timers: compound "1 hour 40 minutes to 2 hours" -> 6000s low, 7200s high',
    tCompound.length === 1 && tCompound[0].seconds === 6000 &&
    tCompound[0].highSeconds === 7200 && tCompound[0].label === '1h 40m\u20132h (1h 40m)');

  const tProseHourHalf = parseStepTimers('Bake at 350°F for at least an hour and a half.');
  const tProseHalfHour = parseStepTimers('Uncover and bake for another ½ hour or so.');
  const tWordMin = parseStepTimers('Boil for one minute.');
  check('timers: prose "an hour and a half" (5400s), "½ hour" (1800s), "one minute" (60s)',
    tProseHourHalf.length === 1 && tProseHourHalf[0].seconds === 5400 &&
    tProseHalfHour.length === 1 && tProseHalfHour[0].seconds === 1800 &&
    tWordMin.length === 1 && tWordMin[0].seconds === 60);

  // False-positive rejection on real recipes in the collection
  check('timers: rejects false positives ("second bowl", "second layer", "second prepared", "a few seconds", no time)',
    parseStepTimers('Transfer the cookie dough to a second bowl and set aside.').length === 0 &&
    parseStepTimers('Layer turkey pastrami over the onion, then repeat with a second layer of pastrami.').length === 0 &&
    parseStepTimers('Place the frozen sprouts on the second prepared baking sheet.').length === 0 &&
    parseStepTimers('Pour in the eggs. Let them sit for a few seconds, then push around.').length === 0 &&
    parseStepTimers('Place one marrow bone at the bottom and the second in the middle layer.').length === 0 &&
    parseStepTimers('Season to taste with salt and pepper.').length === 0);

  // Multiple timers in a single step
  const tMulti = parseStepTimers(
    'Mix on low for 30 seconds until combined and then on medium speed until smooth, about 1 minute.'
  );
  check('timers: multiple times in one step ("30 seconds" + "1 minute") both parsed in order',
    tMulti.length === 2 && tMulti[0].seconds === 30 && tMulti[1].seconds === 60);

  const stepHTML = renderStepWithTimersHTML(
    'Sear for 3.5 to 4 minutes, then flip for 60 seconds & serve.', 3
  );
  check('timers: renderStepWithTimersHTML emits two .timer-pill buttons and escapes HTML',
    (stepHTML.match(/class="timer-pill/g) || []).length === 2 &&
    stepHTML.includes('data-seconds="210"') &&
    stepHTML.includes('data-high-seconds="240"') &&
    stepHTML.includes('data-seconds="60"') &&
    stepHTML.includes('&amp; serve.'));

  /* ============ 11. Phase 1: Timer state reducer (timestamp sleep catch-up, pause/resume, +1m/+5m/+10m, reset, sessionStorage) ============ */
  const t0 = 1000000;
  const tmr = createTimer({
    id: 't-roast', recipeId: 'roast', recipeTitle: 'Roast', stepNum: 2,
    label: '30m\u201340m (30m)', seconds: 1800, lowSeconds: 1800, highSeconds: 2400
  }, t0);
  check('timer reducer: created running at lower bound (1800s)',
    tmr.status === 'running' && tmr.remainingMs === 1800000 && tmr.endTimeMs === t0 + 1800000);

  // Simulated 10-minute (600,000ms) tab sleep: timestamp math catches up immediately
  const after10m = tickTimer(tmr, t0 + 600000);
  check('timer reducer: 10-minute tab sleep catches up accurately via endTimeMs (20m left)',
    after10m.status === 'running' && after10m.remainingMs === 1200000 &&
    formatTimerReadout(after10m.remainingMs) === '20:00');

  // Pause after 10m, wait 5m paused, resume
  const paused = pauseTimer(after10m, t0 + 600000);
  const pausedTick = tickTimer(paused, t0 + 900000);
  check('timer reducer: pause freezes remainingMs across time',
    paused.status === 'paused' && pausedTick.remainingMs === 1200000);
  const resumed = resumeTimer(pausedTick, t0 + 900000);
  check('timer reducer: resume recomputes endTimeMs from remainingMs',
    resumed.status === 'running' && resumed.endTimeMs === t0 + 900000 + 1200000);

  // +1m / +5m / +10m — always repeatable, never clamped to the range max (2026-11-01)
  const plus1 = addTimerMinute(resumed, t0 + 900000);
  check('timer buttons: +1m adds 60s to running timer',
    plus1.remainingMs === 1260000 && plus1.durationSec === 1860);
  const plus5 = addTimerSeconds(plus1, 300, t0 + 900000);
  check('timer buttons: +5m adds exactly 300s',
    plus5.remainingMs === 1560000 && plus5.durationSec === 2160);
  const plus5again = addTimerSeconds(plus5, 300, t0 + 900000);
  check('timer buttons: +5m is repeatable (second +5m adds another 300s)',
    plus5again.remainingMs === 1860000 && plus5again.durationSec === 2460);
  const plus10 = addTimerSeconds(plus5again, 600, t0 + 900000);
  check('timer buttons: +10m adds exactly 600s, cumulative with +5m (+900s total)',
    plus10.remainingMs === 2460000 && plus10.durationSec === 3060);
  check('timer buttons: +5m/+10m leave lowSeconds/highSeconds and the range label unchanged',
    plus10.lowSeconds === 1800 && plus10.highSeconds === 2400 && plus10.label === tmr.label);

  // Expiry at 00:00 + overtime count-up
  const expired = tickTimer(tmr, t0 + 1800000 + 15000);
  check('timer reducer: crosses 00:00 -> status done, remaining 0, overtime 15s',
    expired.status === 'done' && expired.remainingMs === 0 && expired.overtimeMs === 15000);

  // Reset returns to initial lowSeconds, paused
  const reset = resetTimer(plus10);
  check('timer reducer: reset restores original lowSeconds (1800s) in paused state',
    reset.status === 'paused' && reset.remainingMs === 1800000 &&
    reset.durationSec === 1800);

  // Session serialization + same-tab reload recovery + dock HTML
  const rawSess = serializeTimersForSession([tmr]);
  const restoredSess = restoreTimersFromSessionJSON(rawSess, t0 + 300000);
  check('timer session: restoreTimersFromSessionJSON recomputes remaining time after reload; the save carries no voice setting',
    !('soundOn' in JSON.parse(rawSess)) && restoredSess.timers.length === 1 &&
    restoredSess.timers[0].remainingMs === 1500000);
  const dockHtml = timerDockHTML([tmr, expired], true);
  check('timer dock HTML: range card shows +1m/+5m/+10m, no to-max button, Voice: On toggle, Done! overtime banner',
    dockHtml.includes('🗣 Voice: On') && dockHtml.includes('data-timer-act="toggle-voice"') &&
    dockHtml.includes('+5m') && dockHtml.includes('+10m') &&
    !dockHtml.includes('to max') && !dockHtml.includes('tomax') &&
    dockHtml.includes('00:00 · Done! +00:15'));
  const singleTmr = createTimer({ id: 't-single', recipeId: 'x', recipeTitle: 'X', stepNum: 1, label: '30s', seconds: 30 }, t0);
  const dockSingle = timerDockHTML([singleTmr], true);
  check('timer dock HTML: non-range card gets the same +1m/+5m/+10m buttons with no range gating',
    dockSingle.includes('+1m') && dockSingle.includes('+5m') && dockSingle.includes('+10m') && !dockSingle.includes('to max'));

  /* ============ 12. Phase 1: Cook Mode scaled ingredients, variant filtering, and step clamping ============ */
  const cmIngBeef2x = cookModeIngredientsHTML(burritos, 2, 'beef', new Set(['ing-0']));
  check('cook mode ingredients: 2x beef variant scales tortillas (8->16), rice (1->2 cups), ground beef (1->2 lb), hides chicken',
    cmIngBeef2x.includes('16') && cmIngBeef2x.includes('tortillas') &&
    cmIngBeef2x.includes('2 cups') && cmIngBeef2x.includes('2 lb') &&
    cmIngBeef2x.includes('ground beef') && !cmIngBeef2x.includes('cut-up chicken') &&
    cmIngBeef2x.includes('cm-ing-item is-checked'));
  const cmIngChicken1x = cookModeIngredientsHTML(burritos, 1, 'chicken', new Set());
  check('cook mode ingredients: 1x chicken variant shows cut-up chicken + lime, hides ground beef',
    cmIngChicken1x.includes('cut-up chicken') && cmIngChicken1x.includes('lime') &&
    !cmIngChicken1x.includes('ground beef'));

  const cmRecipe = {
    id: 'test-cook', title: 'Test Cook',
    instructions: ['First step.', 'Simmer for 15-20 minutes.', 'Final step.']
  };
  check('cook mode steps: clampCookStepIndex clamps negative and overflow indices',
    clampCookStepIndex(-3, 3) === 0 && clampCookStepIndex(0, 3) === 0 &&
    clampCookStepIndex(2, 3) === 2 && clampCookStepIndex(99, 3) === 2);
  const cmStep2 = cookModeStepHTML(cmRecipe, 1);
  const cmStepClamped = cookModeStepHTML(cmRecipe, 50);
  check('cook mode steps: step 2 renders timer pill; out-of-range index clamps to final step',
    cmStep2.includes('Step 2 of 3') && cmStep2.includes('class="timer-pill') &&
    cmStep2.includes('15m\u201320m (15m)') && cmStepClamped.includes('Step 3 of 3'));

  /* ============ 13. Phase 1: Wake Lock wrapper (supported, unsupported, rejected, re-acquire, release) ============ */
  const wlUnsupported = await acquireWakeLock({});
  check('wake lock: unsupported navigator returns ok:false, supported:false',
    wlUnsupported.ok === false && wlUnsupported.supported === false &&
    __wakeLockState().wanted === false);

  const wlRejected = await acquireWakeLock({
    wakeLock: { request: async () => { throw new Error('NotAllowedError'); } }
  });
  check('wake lock: rejected request returns ok:false, supported:true with reason',
    wlRejected.ok === false && wlRejected.supported === true &&
    wlRejected.reason === 'NotAllowedError');

  let requestCalls = 0;
  let releaseCalls = 0;
  const mockNav = {
    wakeLock: {
      request: async () => {
        requestCalls++;
        return {
          released: false,
          addEventListener: () => {},
          release: async function () { this.released = true; releaseCalls++; }
        };
      }
    }
  };
  const wlOk = await acquireWakeLock(mockNav);
  check('wake lock: supported navigator acquires sentinel and sets wanted=true',
    wlOk.ok === true && wlOk.supported === true && requestCalls === 1 &&
    __wakeLockState().wanted === true && !!__wakeLockState().sentinel);

  // Simulate browser auto-releasing sentinel when tab hides, then re-acquiring on visibilitychange
  __wakeLockState().sentinel.released = true;
  const reacquired = await handleWakeLockVisibility({ hidden: false }, mockNav);
  check('wake lock: visibilitychange (visible) re-acquires when wakeLockWanted is true',
    reacquired === true && requestCalls === 2 && __wakeLockState().sentinel.released === false);

  await releaseWakeLock();
  check('wake lock: releaseWakeLock releases sentinel and clears wanted',
    releaseCalls === 1 && __wakeLockState().wanted === false && __wakeLockState().sentinel === null);

  /* ============ 14. Capability probe REMOVED (2026-11-11) & Read-Aloud helper ============ */
  check('capability probe removed: no probe functions, pill, or card in app.js',
    !SRC.includes('checkCookCapabilities') && !SRC.includes('formatCapabilitiesReportHTML') &&
    !SRC.includes('probeOpen') && !SRC.includes('data-cm-act="probe"') &&
    !SRC.includes('data-cm-act="close-probe"') && !SRC.includes('cm-probe-card'));
  check('capability probe removed: no probe CSS left in styles.css',
    !CSS.includes('.cap-badge') && !CSS.includes('.cm-probe-card') && !CSS.includes('.cm-probe-head') &&
    !CSS.includes('.cm-probe-list'));
  check('wake button fix: updateWakeLockButtons writes the label span, not textContent',
    SRC.includes("cmBtn.querySelector('.cm-btn-label')") &&
    !SRC.includes('cmBtn.textContent = wakeLockWanted'));
  check('top bar: probe pill gone, help link moved to the ingredients drawer',
    SRC.includes("helpLinkHTML('cook-mode', true)") && !SRC.includes('Test Device Capabilities'));

  let spokenText = null;
  let spokenUtterance = null;
  const fakeWin = {
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    speechSynthesis: {
      cancel: () => {},
      speak: function (u) { spokenText = u.text; spokenUtterance = u; if (u.onend) u.onend(); }
    }
  };
  let endedOk = false;
  const didSpeak = speakRecipeStepText('Step 1 of 3. Preheat oven.', ok => { endedOk = ok; }, fakeWin);
  check('read-aloud helper: speakRecipeStepText speaks single step, invokes onEnd(true), and sets ONLY rate 0.98 (V0 baseline discipline)',
    didSpeak === true && spokenText === 'Step 1 of 3. Preheat oven.' && endedOk === true &&
    spokenUtterance && spokenUtterance.rate === 0.98 &&
    spokenUtterance.pitch === undefined && spokenUtterance.volume === undefined &&
    spokenUtterance.voice === undefined);

  /* ============ 16. Spoken timer alarm (2026-11-01): 7s repeat, 5-min cap, skip-if-speaking ============ */
  check('spoken alarm: constants are 7s repeat / 5-min cap',
    TIMER_ALARM_REPEAT_MS === 7000 && TIMER_ALARM_MAX_OVERTIME_MS === 300000);
  const ct0 = 2000000;
  const ctmr = createTimer({ id: 't-alarm', recipeId: 'x', recipeTitle: 'X', stepNum: 1, label: '30s', seconds: 30 }, ct0);
  check('spoken alarm: new timer carries lastAlarmAtMs null',
    ctmr.alarmFired === false && ctmr.lastAlarmAtMs === null);
  check('spoken alarm: running timer never fires',
    shouldFireTimerAlarm(ctmr, ct0 + 5000) === false);
  const done0 = tickTimer(ctmr, ct0 + 30000);
  check('spoken alarm: fires at the 00:00 transition',
    done0.status === 'done' && shouldFireTimerAlarm(done0, ct0 + 30000) === true);
  const firedOnce = Object.assign({}, done0, { alarmFired: true, lastAlarmAtMs: ct0 + 30000 });
  check('spoken alarm: silent 1ms..6999ms after an alarm, fires at +7000ms',
    shouldFireTimerAlarm(tickTimer(firedOnce, ct0 + 30001), ct0 + 30001) === false &&
    shouldFireTimerAlarm(tickTimer(firedOnce, ct0 + 36999), ct0 + 36999) === false &&
    shouldFireTimerAlarm(tickTimer(firedOnce, ct0 + 37000), ct0 + 37000) === true);
  const firedTwice = Object.assign({}, done0, { alarmFired: true, lastAlarmAtMs: ct0 + 37000 });
  check('spoken alarm: silent until +14000ms after the second alarm, fires there',
    shouldFireTimerAlarm(tickTimer(firedTwice, ct0 + 43999), ct0 + 43999) === false &&
    shouldFireTimerAlarm(tickTimer(firedTwice, ct0 + 44000), ct0 + 44000) === true);
  // Cap tail: the 7s grid does not divide 300000 — the last fire is at
  // +294000ms of overtime; after it fires, silence through the cap and past it.
  const firedLate = Object.assign({}, done0, { alarmFired: true, lastAlarmAtMs: ct0 + 317000 });
  check('spoken alarm: fires at +294000ms of overtime (last grid point inside the cap)',
    shouldFireTimerAlarm(tickTimer(firedLate, ct0 + 324000), ct0 + 324000) === true);
  const firedLast = Object.assign({}, done0, { alarmFired: true, lastAlarmAtMs: ct0 + 324000 });
  check('spoken alarm: silent +295000ms..+300000ms after the last fire, and past the cap',
    shouldFireTimerAlarm(tickTimer(firedLast, ct0 + 325000), ct0 + 325000) === false &&
    shouldFireTimerAlarm(tickTimer(firedLast, ct0 + 330000), ct0 + 330000) === false &&
    shouldFireTimerAlarm(tickTimer(firedLast, ct0 + 330001), ct0 + 330001) === false);
  check('spoken alarm: silent past the cap even if the first alarm never fired',
    shouldFireTimerAlarm(tickTimer(ctmr, ct0 + 400000), ct0 + 400000) === false);
  // Full simulated run: 250ms ticker (ensureTimerTicker), updating alarm
  // state exactly as tickAllTimers does — exactly 43 speaks, zero past the cap.
  let simTimer = createTimer({ id: 't-sim', recipeId: 'x', recipeTitle: 'X', stepNum: 1, label: '1s', seconds: 1 }, 3000000);
  let simBursts = 0;
  let simBurstsPastCap = 0;
  for (let nowMs = 3000250; nowMs <= 3310000; nowMs += 250) {
    simTimer = tickTimer(simTimer, nowMs);
    if (shouldFireTimerAlarm(simTimer, nowMs)) {
      simBursts++;
      if (nowMs > 3301000) simBurstsPastCap++;
      simTimer = Object.assign({}, simTimer, { alarmFired: true, lastAlarmAtMs: nowMs });
    }
  }
  check('spoken alarm: simulated 250ms ticker fires exactly 43 alarms and zero past the 5-min cap',
    simBursts === 43 && simBurstsPastCap === 0);
  const legacy = Object.assign({}, done0, { alarmFired: true });
  delete legacy.lastAlarmAtMs;
  check('spoken alarm: legacy saved state without lastAlarmAtMs fires once, then tracks',
    shouldFireTimerAlarm(legacy, ct0 + 30000) === true);
  const cleared = resetTimer(firedOnce);
  check('spoken alarm: reset clears alarmFired + lastAlarmAtMs',
    cleared.alarmFired === false && cleared.lastAlarmAtMs === null);
  const plusClears = addTimerMinute(firedOnce, ct0 + 45000);
  check('spoken alarm: +1m on a done timer restarts it running and clears alarm state',
    plusClears.status === 'running' && plusClears.alarmFired === false && plusClears.lastAlarmAtMs === null);
  const rangeTmr = createTimer({ id: 't-range', recipeId: 'x', recipeTitle: 'X', stepNum: 1, label: '30m', seconds: 1800, lowSeconds: 1800, highSeconds: 2400 }, ct0);
  const rangeDone = Object.assign({}, tickTimer(rangeTmr, ct0 + 1800000), { alarmFired: true, lastAlarmAtMs: ct0 + 1800000 });
  const plus10Clears = addTimerSeconds(rangeDone, 600, ct0 + 1800000);
  check('spoken alarm: +10m on a done timer restarts it running and clears alarm state',
    plus10Clears.status === 'running' && plus10Clears.remainingMs === 600000 &&
    plus10Clears.alarmFired === false && plus10Clears.lastAlarmAtMs === null);
  const plus5Clears = addTimerSeconds(rangeDone, 300, ct0 + 1800000);
  check('spoken alarm: +5m on a done timer restarts it running and clears alarm state',
    plus5Clears.status === 'running' && plus5Clears.remainingMs === 300000 &&
    plus5Clears.alarmFired === false && plus5Clears.lastAlarmAtMs === null);
  const pausedDone = Object.assign({}, rangeDone, { status: 'paused', remainingMs: 0 });
  const plusPausedClears = addTimerSeconds(pausedDone, 300, ct0 + 1800000);
  check('spoken alarm: +5m on a paused done timer also clears alarm state (paused branch)',
    plusPausedClears.alarmFired === false && plusPausedClears.lastAlarmAtMs === null &&
    plusPausedClears.remainingMs === 300000);
  const rawAlarm = serializeTimersForSession([firedOnce]);
  const parsedAlarm = JSON.parse(rawAlarm);
  const restoredAlarm = restoreTimersFromSessionJSON(rawAlarm, ct0 + 35000);
  check('spoken alarm: session save writes no sound setting, lastAlarmAtMs survives round-trip and stays silent mid-interval',
    !('soundOn' in parsedAlarm) && restoredAlarm.timers[0].lastAlarmAtMs === ct0 + 30000 &&
    restoredAlarm.timers[0].alarmFired === true &&
    shouldFireTimerAlarm(restoredAlarm.timers[0], ct0 + 35000) === false);
  const legacyRaw = JSON.stringify({ soundOn: false, timers: [Object.assign({}, firedOnce, { maxAdded: true, chimeFired: true, lastChimeAtMs: ct0 + 30000 })] });
  const legacyRestored = restoreTimersFromSessionJSON(legacyRaw, ct0 + 35000);
  const legacyPlus5 = addTimerSeconds(legacyRestored.timers[0], 300, ct0 + 35000);
  check('spoken alarm: restore maps legacy chimeFired/lastChimeAtMs onto alarm fields, ignores maxAdded, +5m still works',
    legacyRestored.timers[0].alarmFired === true && legacyRestored.timers[0].lastAlarmAtMs === ct0 + 30000 &&
    !('maxAdded' in legacyRestored.timers[0]) && !('chimeFired' in legacyRestored.timers[0]) &&
    legacyPlus5.status === 'running' && legacyPlus5.remainingMs === 300000);
  const dockDone = timerDockHTML([done0], true);
  const dockRunning = timerDockHTML([ctmr], true);
  const dockOff = timerDockHTML([ctmr], false);
  check('spoken alarm: done card shows a large ✓ Dismiss button, running card keeps ✕, dock toggle is Voice On/Off',
    dockDone.includes('✓ Dismiss') && dockDone.includes('timer-dismiss-done') &&
    dockRunning.includes('aria-label="Dismiss timer">✕<') &&
    dockDone.includes('data-timer-act="toggle-voice"') && dockDone.includes('🗣 Voice: On') &&
    dockOff.includes('🔕 Voice: Off'));

  /* ---- skip-if-speaking + phrase templates ---- */
  check('spoken durations: seconds / minutes / hours phrasing',
    formatSpokenDuration(1) === '1 second' && formatSpokenDuration(30) === '30 seconds' &&
    formatSpokenDuration(60) === '1 minute' && formatSpokenDuration(90) === '1 minute 30 seconds' &&
    formatSpokenDuration(3600) === '1 hour' && formatSpokenDuration(3900) === '1 hour 5 minutes' &&
    formatSpokenDuration(0) === '0 seconds');
  check('spoken ranges: shared-unit elision, mixed units stay explicit',
    formatAlarmTimeRange(1800, 2400) === '30 to 40 minutes' &&
    formatAlarmTimeRange(30, 45) === '30 to 45 seconds' &&
    formatAlarmTimeRange(60, 120) === '1 to 2 minutes' &&
    formatAlarmTimeRange(3600, 7200) === '1 to 2 hours' &&
    formatAlarmTimeRange(3300, 3600) === '55 minutes to 1 hour' &&
    formatAlarmTimeRange(90, 90) === '1 minute 30 seconds' &&
    formatAlarmTimeRange(1800, 1800) === '30 minutes');
  check('alarm phrases: full / duration-only / no-step fallbacks (Q4)',
    buildTimerAlarmPhrase({ stepNum: 5, lowSeconds: 1800, highSeconds: 2400 }) === 'Kitchen timer! Kitchen timer! Step 5, 30 to 40 minutes is done.' &&
    buildTimerAlarmPhrase({ stepNum: 3, durationSec: 600 }) === 'Kitchen timer! Kitchen timer! Step 3, 10 minutes is done.' &&
    buildTimerAlarmPhrase({ stepNum: 5 }) === 'Kitchen timer! Kitchen timer! Step 5 is done.' &&
    buildTimerAlarmPhrase({}) === 'Kitchen timer! Kitchen timer! Your timer is done.' &&
    buildTimerAlarmPhrase({ stepNum: 0, lowSeconds: 30 }) === 'Kitchen timer! Kitchen timer! Your timer is done.');

  function mockSpeechEnv(opts) {
    const o = opts || {};
    const utterances = [];
    const synth = {
      speaking: !!o.speaking,
      pending: !!o.pending,
      cancelCount: 0,
      cancel() { this.cancelCount++; },
      speak(u) {
        utterances.push(u);
        if (o.holdUtterance) return; // never fires onend: in-flight persists
        if (u.onend) u.onend();
      }
    };
    const win = {
      SpeechSynthesisUtterance: function (t) { this.text = t; },
      speechSynthesis: synth
    };
    return { win, synth, utterances };
  }
  const env1 = mockSpeechEnv();
  const st1 = { inFlight: false, generation: 0, timerId: null };
  const spoke1 = speakTimerAlarm({ id: 'a1', stepNum: 5, lowSeconds: 1800, highSeconds: 2400, status: 'done' },
    { winObj: env1.win, state: st1, voiceOn: true, firstFire: true });
  check('speakTimerAlarm: first fire speaks the production phrase with V1 params and preempts (cancel-first)',
    spoke1 === true && env1.utterances.length === 1 &&
    env1.utterances[0].text === 'Kitchen timer! Kitchen timer! Step 5, 30 to 40 minutes is done.' &&
    env1.utterances[0].pitch === 1.15 && env1.utterances[0].rate === 0.92 &&
    env1.utterances[0].volume === 1.0 && env1.synth.cancelCount === 1 &&
    st1.inFlight === false);
  const env2 = mockSpeechEnv();
  const st2 = { inFlight: false, generation: 0, timerId: null };
  speakTimerAlarm({ id: 'a2', stepNum: 1, lowSeconds: 30, status: 'done' },
    { winObj: env2.win, state: st2, voiceOn: true, firstFire: false });
  check('speakTimerAlarm: repeat fire does NOT cancel (cancel-first only on first fire)',
    env2.utterances.length === 1 && env2.synth.cancelCount === 0);
  const env3 = mockSpeechEnv();
  const st3 = { inFlight: true, generation: 1, timerId: 'other' };
  check('speakTimerAlarm: skip-if-speaking — in-flight state means no second utterance',
    speakTimerAlarm({ id: 'a3', stepNum: 1, lowSeconds: 30, status: 'done' },
      { winObj: env3.win, state: st3, voiceOn: true, firstFire: false }) === false &&
    env3.utterances.length === 0);
  const env4 = mockSpeechEnv({ speaking: true });
  check('speakTimerAlarm: repeat fire skips when the synthesizer reports speaking',
    speakTimerAlarm({ id: 'a4', stepNum: 1, lowSeconds: 30, status: 'done' },
      { winObj: env4.win, state: { inFlight: false, generation: 0, timerId: null }, voiceOn: true, firstFire: false }) === false &&
    env4.utterances.length === 0);
  const env4b = mockSpeechEnv({ speaking: true });
  const st4b = { inFlight: false, generation: 0, timerId: null };
  const spoke4b = speakTimerAlarm({ id: 'a4b', stepNum: 1, lowSeconds: 30, status: 'done' },
    { winObj: env4b.win, state: st4b, voiceOn: true, firstFire: true });
  check('speakTimerAlarm: first fire PREEMPTS step read-aloud when the synthesizer reports speaking (Fix 1)',
    spoke4b === true && env4b.utterances.length === 1 && env4b.synth.cancelCount === 1 &&
    st4b.inFlight === false);
  const env5 = mockSpeechEnv();
  check('speakTimerAlarm: voice off means no utterance',
    speakTimerAlarm({ id: 'a5', stepNum: 1, lowSeconds: 30, status: 'done' },
      { winObj: env5.win, state: { inFlight: false, generation: 0, timerId: null }, voiceOn: false, firstFire: true }) === false &&
    env5.utterances.length === 0);
  check('speakTimerAlarm: no speechSynthesis support means no utterance and no throw',
    speakTimerAlarm({ id: 'a6', stepNum: 1, lowSeconds: 30, status: 'done' },
      { winObj: {}, state: { inFlight: false, generation: 0, timerId: null }, voiceOn: true, firstFire: true }) === false);
  const env7 = mockSpeechEnv({ holdUtterance: true });
  const st7 = { inFlight: false, generation: 0, timerId: null };
  const first7 = speakTimerAlarm({ id: 'a7', stepNum: 1, lowSeconds: 30, status: 'done' },
    { winObj: env7.win, state: st7, voiceOn: true, firstFire: true });
  const second7 = speakTimerAlarm({ id: 'a7', stepNum: 1, lowSeconds: 30, status: 'done' },
    { winObj: env7.win, state: st7, voiceOn: true, firstFire: false });
  env7.utterances[0].onend();
  const clearedAfterEnd = st7.inFlight === false;
  const third7 = speakTimerAlarm({ id: 'a7', stepNum: 1, lowSeconds: 30, status: 'done' },
    { winObj: env7.win, state: st7, voiceOn: true, firstFire: false });
  check('speakTimerAlarm: in-flight flag blocks repeats until onend clears it, then speaking resumes',
    first7 === true && second7 === false && clearedAfterEnd && third7 === true &&
    env7.utterances.length === 2);
  const env8 = mockSpeechEnv({ holdUtterance: true });
  const st8 = { inFlight: false, generation: 0, timerId: null };
  const spoke8 = speakTimerAlarm({ id: 'a8', stepNum: 1, lowSeconds: 30, status: 'done' },
    { winObj: env8.win, state: st8, voiceOn: true, firstFire: true, watchdogMs: 10 });
  const heldBeforeWatchdog = spoke8 === true && st8.inFlight === true;
  await sleep(40);
  check('speakTimerAlarm: stuck-utterance watchdog clears in-flight state and cancels (Fix 1, watchdogMs)',
    heldBeforeWatchdog && st8.inFlight === false && st8.timerId === null &&
    env8.utterances.length === 1 && env8.synth.cancelCount === 2);
  /* ============ 17. Final cleanup (2026-11-01): test panel removed, production alarm locked at V1 ============ */
  check('final cleanup: production alarm constant is exactly V1 (volume 1.0, pitch 1.15, rate 0.92)',
    JSON.stringify(TIMER_ALARM_VOICE_OPTS) === JSON.stringify({ volume: 1.0, pitch: 1.15, rate: 0.92 }));
  check('final cleanup: no voice-test code remains in app.js source (grep-zero)',
    !SRC.includes('voiceTestVariant') && !SRC.includes('voiceTestButtonsHTML') &&
    !SRC.includes('voiceTestDemoRange') && !SRC.includes('VOICE_TEST_') &&
    !SRC.includes('data-voice-test') && !SRC.includes('data-cm-voice-list') &&
    !SRC.includes('data-cm-voice-prompt') && !SRC.includes('cm-voice-tests') &&
    !SRC.includes('runVoiceTest') && !SRC.includes('fillVoiceTestButtons'));


  /* ---- speakTextWithOpts param discipline + voice resolution ---- */
  function mockSpeakWin(voices) {
    let lastU = null;
    let cancelCount = 0;
    const win = {
      SpeechSynthesisUtterance: function (t) { this.text = t; },
      speechSynthesis: {
        cancel() { cancelCount++; },
        getVoices: () => voices || [],
        speak(u) { lastU = u; if (u.onend) u.onend(); }
      }
    };
    return { win, get lastU() { return lastU; }, get cancelCount() { return cancelCount; } };
  }
  const mw1 = mockSpeakWin();
  speakTextWithOpts('Hello', { pitch: 1.15, rate: 0.92 }, () => {}, mw1.win);
  check('speak helper: sets only provided properties (volume/voice/lang stay unset)',
    mw1.lastU && mw1.lastU.pitch === 1.15 && mw1.lastU.rate === 0.92 &&
    mw1.lastU.volume === undefined && mw1.lastU.voice === undefined && mw1.lastU.lang === undefined &&
    mw1.cancelCount === 1);
  const mw2 = mockSpeakWin();
  speakTextWithOpts('Hello', { volume: 1.0, cancelFirst: false }, () => {}, mw2.win);
  check('speak helper: cancelFirst:false skips the cancel call',
    mw2.lastU && mw2.lastU.volume === 1.0 && mw2.cancelCount === 0);
  const voiceList = [
    { name: 'English US', lang: 'en-US', voiceURI: 'uri-us', default: true },
    { name: 'English US', lang: 'en-US', voiceURI: 'uri-us', default: true },
    { name: 'English GB', lang: 'en-GB', voiceURI: 'uri-gb', default: false },
    { name: 'Deutsch', lang: 'de-DE', voiceURI: 'uri-de', default: false }
  ];
  const mw3 = mockSpeakWin(voiceList);
  speakTextWithOpts('Hello', { voice: 'uri-gb' }, () => {}, mw3.win);
  check('speak helper: voice resolved by voiceURI from a fresh getVoices() fetch',
    mw3.lastU && mw3.lastU.voice && mw3.lastU.voice.voiceURI === 'uri-gb');
  const mw4 = mockSpeakWin(voiceList);
  speakTextWithOpts('Hello', { voice: 'no-such-voice' }, () => {}, mw4.win);
  check('speak helper: unknown voice reference leaves voice unset, no throw',
    mw4.lastU && mw4.lastU.voice === undefined);
  check('speak helper: empty text and missing speechSynthesis both return false',
    speakTextWithOpts('   ', {}, () => {}, mw1.win) === false &&
    speakTextWithOpts('Hello', {}, () => {}, {}) === false);

  /* ---- voice enumeration ---- */
  check('voice enumeration: en* only, default first, deduped by name+lang+voiceURI',
    (() => {
      const out = filterAlarmVoices(voiceList);
      return out.length === 2 && out[0].voiceURI === 'uri-us' && out[1].voiceURI === 'uri-gb';
    })());
  check('voice enumeration: empty / throwing / absent getVoices all yield []',
    filterAlarmVoices([]).length === 0 &&
    getSpeechVoices({ speechSynthesis: { getVoices() { throw new Error('boom'); } } }).length === 0 &&
    getSpeechVoices({}).length === 0 &&
    getSpeechVoices().length === 0);
  check('voice enumeration: non-array input yields []',
    filterAlarmVoices(null).length === 0 && filterAlarmVoices('en-US').length === 0);

  /* ---- persistence: precedence + migration (Q5) ---- */
  check('voice setting precedence: stored local value wins (incl. explicit off); then legacy session; then ON default',
    resolveTimerVoiceSetting('1', false) === true &&
    resolveTimerVoiceSetting('0', true) === false &&
    resolveTimerVoiceSetting('on', false) === true &&
    resolveTimerVoiceSetting('off', true) === false &&
    resolveTimerVoiceSetting(null, false) === false &&
    resolveTimerVoiceSetting(null, true) === true &&
    resolveTimerVoiceSetting('banana', false) === false &&
    resolveTimerVoiceSetting(undefined, undefined) === true);
  function stubStorage(initial) {
    const map = Object.assign({}, initial || {});
    return {
      map,
      getItem(k) { return (k in map) ? map[k] : null; },
      setItem(k, v) { map[k] = v; },
      removeItem(k) { delete map[k]; }
    };
  }
  const savedLocal = globalThis.localStorage;
  const savedSession = globalThis.sessionStorage;
  try {
    globalThis.localStorage = stubStorage({ 'recipe-timer-voice': '0' });
    globalThis.sessionStorage = stubStorage({});
    initTimerVoiceSetting();
    const offKept = __timerVoiceEnabled() === false;
    globalThis.localStorage = stubStorage({});
    globalThis.sessionStorage = stubStorage({ 'reiss-active-timers-v1': JSON.stringify({ soundOn: false, timers: [] }) });
    initTimerVoiceSetting();
    const migrated = __timerVoiceEnabled() === false && globalThis.localStorage.map['recipe-timer-voice'] === '0';
    globalThis.localStorage = stubStorage({});
    globalThis.sessionStorage = stubStorage({});
    initTimerVoiceSetting();
    const defaultOn = __timerVoiceEnabled() === true && globalThis.localStorage.map['recipe-timer-voice'] === '1';
    globalThis.localStorage = stubStorage({ 'recipe-timer-voice': 'banana' });
    globalThis.sessionStorage = stubStorage({ 'reiss-active-timers-v1': JSON.stringify({ soundOn: true, timers: [] }) });
    initTimerVoiceSetting();
    const invalidNormalized = __timerVoiceEnabled() === true && globalThis.localStorage.map['recipe-timer-voice'] === '1';
    setTimerVoiceSetting(false);
    const setOff = __timerVoiceEnabled() === false && globalThis.localStorage.map['recipe-timer-voice'] === '0';
    setTimerVoiceSetting(true);
    const setOn = __timerVoiceEnabled() === true && globalThis.localStorage.map['recipe-timer-voice'] === '1';
    check('voice setting persistence: stored off wins, legacy session migrates once, default on, invalid normalized, set writes',
      offKept && migrated && defaultOn && invalidNormalized && setOff && setOn);
    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    globalThis.sessionStorage = stubStorage({});
    let threw = false;
    try { initTimerVoiceSetting(); setTimerVoiceSetting(false); } catch (e) { threw = true; }
    check('voice setting persistence: throwing storage falls back to memory, never throws',
      threw === false && __timerVoiceEnabled() === false);
  } finally {
    if (savedLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = savedLocal;
    if (savedSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = savedSession;
  }

  /* ---- probe removal: no report HTML can render (functions are gone) ---- */
  check('capability probe removed: no probe markup or handlers remain in app.js',
    !SRC.includes('Device Capabilities Report') && !SRC.includes('cm-probe-card') &&
    !SRC.includes('probeOpen') && !SRC.includes('close-probe'));

  /* ============ 18. Search Sections in drawGrid (Nov 4, 2026) ============ */
  ['bannerHTML', 'badgesHTML', 'recipeCardHTML', 'partitionSearchResults',
   'searchSectionHeaderHTML', 'gridSectionsHTML', 'drawGrid',
   'inferVariantSlotClass', 'buildRecipeCard', 'cardDriftFields', 'cardIsStale'].forEach(n => geval(extract(n)));

  let fakeGridEl = { innerHTML: '' };
  let fakeCountEl = { textContent: '' };
  globalThis.$ = sel => {
    if (sel === '#grid') return fakeGridEl;
    if (sel === '#result-count') return fakeCountEl;
    return null;
  };

  const HONEY_CARDS = [
    {
      id: 'dill-dip-salmon', title: 'Dill Dip Salmon',
      kosher_status: 'pareve', kosher_for_passover: false, categories: ['main', 'fish'], tags: ['quick'],
      prep_minutes: 20, cook_minutes: 15, servings: '4', leftover_friendly: true,
      ingredients_text: 'mayo fresh dill lemon juice garlic honey salmon',
      search_text: 'mayo fresh dill lemon juice garlic honey salmon Text submission.'
    },
    {
      id: 'honey-lemon-chicken', title: 'Honey Lemon Chicken',
      kosher_status: 'meat', kosher_for_passover: false, categories: ['main', 'chicken'], tags: ['quick'],
      prep_minutes: 30, cook_minutes: 15, servings: '6', leftover_friendly: true,
      ingredients_text: 'chicken breast flour oil garlic chicken broth honey lemon juice soy sauce',
      search_text: 'chicken breast flour oil garlic chicken broth honey lemon juice soy sauce RecipeTin Eats.'
    },
    {
      id: 'legacy-no-ing-text', title: 'Legacy Glazed Carrots',
      kosher_status: 'pareve', kosher_for_passover: false, categories: ['side'], tags: [],
      prep_minutes: 10, cook_minutes: 20, servings: '4', leftover_friendly: false,
      // No ingredients_text field — defensive fallback to search_text
      search_text: 'carrots honey olive oil salt'
    },
    {
      id: 'plain-roasted-potatoes', title: 'Plain Roasted Potatoes',
      kosher_status: 'pareve', kosher_for_passover: false, categories: ['appetizer'], tags: ['freezer-friendly'],
      prep_minutes: 10, cook_minutes: 25, servings: '4', leftover_friendly: false,
      ingredients_text: 'potatoes olive oil kosher salt black pepper',
      search_text: 'potatoes olive oil kosher salt black pepper Great crowd pleaser.'
    }
  ];
  setMeta(HONEY_CARDS);
  globalThis.filters = { q: '', kosher: 'all', kfp: false, category: 'all', tag: 'all', maxTime: 0, leftovers: false, sort: 'asc' };

  // 18a. No query: flat card grid, no section headers, sorted by time ascending
  drawGrid();
  check('drawGrid (no query): renders flat card list with no section headers',
    !fakeGridEl.innerHTML.includes('search-section-head') &&
    fakeCountEl.textContent === '4 of 4 recipes' &&
    fakeGridEl.innerHTML.indexOf('legacy-no-ing-text') < fakeGridEl.innerHTML.indexOf('honey-lemon-chicken'));

  // 18b. Active query "honey": splits into Titles section first, then Ingredients section; falls back to search_text when ingredients_text is absent
  globalThis.filters.q = 'honey';
  drawGrid();
  const gridHtmlHoney = fakeGridEl.innerHTML;
  const titleHeadPos = gridHtmlHoney.indexOf("Titles matching 'honey'");
  const ingHeadPos = gridHtmlHoney.indexOf("With 'honey' as an ingredient");
  const honeyChickenPos = gridHtmlHoney.indexOf('href="#/recipe/honey-lemon-chicken"');
  const dillSalmonPos = gridHtmlHoney.indexOf('href="#/recipe/dill-dip-salmon"');
  const legacyCarrotsPos = gridHtmlHoney.indexOf('href="#/recipe/legacy-no-ing-text"');
  check('drawGrid (query="honey"): renders Titles section before Ingredient section with counts (1) and (2)',
    titleHeadPos >= 0 && ingHeadPos > titleHeadPos &&
    gridHtmlHoney.includes("Titles matching 'honey' <span class=\"search-section-count\">(1)</span>") &&
    gridHtmlHoney.includes("With 'honey' as an ingredient <span class=\"search-section-count\">(2)</span>") &&
    !gridHtmlHoney.includes('data-search-section="other"') &&
    fakeCountEl.textContent === '3 of 4 recipes');
  check('drawGrid (query="honey"): Honey Lemon Chicken (total 45m) appears in Titles section ahead of faster Dill Dip Salmon (total 35m) in Ingredients section',
    honeyChickenPos > titleHeadPos && honeyChickenPos < ingHeadPos &&
    dillSalmonPos > ingHeadPos && legacyCarrotsPos > ingHeadPos);
  check('drawGrid (query="honey"): within Ingredient section, sort order (total time asc) is preserved and defensive search_text fallback works',
    legacyCarrotsPos < dillSalmonPos &&
    !gridHtmlHoney.includes('plain-roasted-potatoes'));

  // 18c. Descending sort within sections
  globalThis.filters.sort = 'desc';
  drawGrid();
  const gridHtmlDesc = fakeGridEl.innerHTML;
  check('drawGrid (sort="desc"): reverses order within Ingredient section (35m Dill Dip Salmon before 30m Legacy Carrots)',
    gridHtmlDesc.indexOf('href="#/recipe/dill-dip-salmon"') < gridHtmlDesc.indexOf('href="#/recipe/legacy-no-ing-text"'));
  globalThis.filters.sort = 'asc';

  // 18d. Section with zero matches shows no header (ingredient-only query "mayo" -> no Titles header)
  globalThis.filters.q = 'mayo';
  drawGrid();
  check('drawGrid (ingredient-only matches): omits Titles section header when 0 title matches',
    !fakeGridEl.innerHTML.includes('data-search-section="title"') &&
    fakeGridEl.innerHTML.includes('data-search-section="ingredient"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="other"') &&
    fakeGridEl.innerHTML.includes("With 'mayo' as an ingredient <span class=\"search-section-count\">(1)</span>"));

  // 18e. Title-only match ("Roasted") -> omits Ingredient and More matches section headers when 0 matches
  globalThis.filters.q = 'Roasted';
  drawGrid();
  check('drawGrid (title-only matches): omits Ingredient section header when 0 ingredient matches',
    fakeGridEl.innerHTML.includes('data-search-section="title"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="ingredient"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="other"') &&
    fakeGridEl.innerHTML.includes("Titles matching 'Roasted' <span class=\"search-section-count\">(1)</span>"));

  // 18f. Filter combination (kosher='meat' + query='honey' -> only Honey Lemon Chicken, Ingredient section hidden)
  globalThis.filters.q = 'honey';
  globalThis.filters.kosher = 'meat';
  drawGrid();
  check('drawGrid (kosher filter + query): filters first, then partitions',
    fakeGridEl.innerHTML.includes('data-search-section="title"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="ingredient"') &&
    fakeCountEl.textContent === '1 of 4 recipes');
  globalThis.filters.kosher = 'all';

  // 18g. Tag-only query ("freezer-friendly") -> renders in 3rd section ("More matches") and is counted
  globalThis.filters.q = 'freezer-friendly';
  drawGrid();
  check('drawGrid (tag-only query): renders recipe in 3rd section ("More matches") and counts it in result-count',
    !fakeGridEl.innerHTML.includes('data-search-section="title"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="ingredient"') &&
    fakeGridEl.innerHTML.includes('data-search-section="other"') &&
    fakeGridEl.innerHTML.includes('More matches <span class="search-section-count">(1)</span>') &&
    fakeGridEl.innerHTML.includes('href="#/recipe/plain-roasted-potatoes"') &&
    fakeCountEl.textContent === '1 of 4 recipes');

  // 18h. Category-only query ("appetizer") -> renders in 3rd section ("More matches") and is counted
  globalThis.filters.q = 'appetizer';
  drawGrid();
  check('drawGrid (category-only query): renders recipe in 3rd section ("More matches") and counts it in result-count',
    !fakeGridEl.innerHTML.includes('data-search-section="title"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="ingredient"') &&
    fakeGridEl.innerHTML.includes('data-search-section="other"') &&
    fakeGridEl.innerHTML.includes('More matches <span class="search-section-count">(1)</span>') &&
    fakeGridEl.innerHTML.includes('href="#/recipe/plain-roasted-potatoes"') &&
    fakeCountEl.textContent === '1 of 4 recipes');

  // 18i. Notes-only query ("RecipeTin Eats") -> renders in 3rd section ("More matches") and is counted
  globalThis.filters.q = 'RecipeTin Eats';
  drawGrid();
  check('drawGrid (notes-only query): renders recipe in 3rd section ("More matches") and counts it in result-count',
    !fakeGridEl.innerHTML.includes('data-search-section="title"') &&
    !fakeGridEl.innerHTML.includes('data-search-section="ingredient"') &&
    fakeGridEl.innerHTML.includes('data-search-section="other"') &&
    fakeGridEl.innerHTML.includes('More matches <span class="search-section-count">(1)</span>') &&
    fakeGridEl.innerHTML.includes('href="#/recipe/honey-lemon-chicken"') &&
    fakeCountEl.textContent === '1 of 4 recipes');

  // 18j. All three sections simultaneously: Title first, Ingredient second, More matches third
  const THREE_SEC_CARDS = [
    ...HONEY_CARDS.slice(0, 3),
    {
      id: 'honey-note-only', title: 'Crispy Potato Wedges',
      kosher_status: 'pareve', kosher_for_passover: false, categories: ['side'], tags: ['honey-free'],
      prep_minutes: 10, cook_minutes: 25, servings: '4', leftover_friendly: false,
      ingredients_text: 'potatoes olive oil salt',
      search_text: 'potatoes olive oil salt Great alongside honey dishes.'
    }
  ];
  setMeta(THREE_SEC_CARDS);
  globalThis.filters.q = 'honey';
  drawGrid();
  const threeSecHtml = fakeGridEl.innerHTML;
  const s1Pos = threeSecHtml.indexOf('data-search-section="title"');
  const s2Pos = threeSecHtml.indexOf('data-search-section="ingredient"');
  const s3Pos = threeSecHtml.indexOf('data-search-section="other"');
  const wedgePos = threeSecHtml.indexOf('href="#/recipe/honey-note-only"');
  check('drawGrid (3 sections): renders Title first, Ingredient second, More matches third, and counts all 4',
    s1Pos >= 0 && s2Pos > s1Pos && s3Pos > s2Pos && wedgePos > s3Pos &&
    threeSecHtml.includes('More matches <span class="search-section-count">(1)</span>') &&
    fakeCountEl.textContent === '4 of 4 recipes');
  setMeta(HONEY_CARDS);

  // 18k. Empty state unchanged when no recipes match
  globalThis.filters.q = 'nonexistent-ingredient-xyz';
  drawGrid();
  check('drawGrid (no matches): renders unchanged empty state',
    fakeGridEl.innerHTML.includes('No recipes match. Try clearing a filter.') &&
    !fakeGridEl.innerHTML.includes('search-section-head') &&
    fakeCountEl.textContent === '0 of 4 recipes');
  globalThis.filters.q = '';

  /* ============ 19. Timer-dock clearance sync (2026-11-11 fix) ============ */
  // Defect 1 (Screenfly QA): the Step pill and the Read step button wrapped
  // on phones, inflating the top bar to ~70px. Both must never wrap.
  check('CSS: Step pill never wraps (top bar stays one row on phones)',
    /\.cm-progress-pill\s*\{[^}]*white-space:\s*nowrap/.test(CSS));
  check('CSS: Read/Repeat buttons never wrap',
    /\.cm-read-btn,\s*\.cm-repeat-btn\s*\{[^}]*white-space:\s*nowrap/.test(CSS));
  // v20261111c (Screenfly re-QA): the speech row was ~360px wide, wider
  // than the 360px viewport — "Auto-read on Next" clipped ~25px at 360px
  // (and ~5px at 393px). Portrait-only shrink so it fits one row at 360:
  // narrower stage sides + tighter speech buttons/label (checkbox untouched).
  check('CSS: portrait speech row fits 360px (compact stage + buttons)',
    CSS.includes('padding: 0.9rem 0.75rem;') &&
    CSS.includes('padding: 0.4rem 0.45rem;') &&
    !CSS.includes('padding: 0.5rem 0.6rem;'));
  // v20261111d (Screenfly re-QA): the c-shrink still clipped ~10px at 360
  // ("Auto-read on Nex") — the row measured ~346px, not the ~326px
  // estimated. Decisive fix: the " on Next" suffix hides on portrait
  // phones, so the label reads "Auto-read" there (~50px saved, label
  // still fully worded on desktop/landscape). The suffix span must exist
  // in the label HTML and be hidden by the portrait query.
  check('Cook Mode: " on Next" suffix hides on portrait phones',
    SRC.includes('<span class="cm-autoread-suffix"> on Next</span>') &&
    /\.cm-autoread-suffix\s*\{\s*display:\s*none;?\s*\}/.test(CSS));
  // Defect 2 (Screenfly QA): the dock (~200px at 393px, ~135px landscape)
  // covered Cook Mode's nav row and speech bar because the overlay lifted
  // by a fixed 108px. The fix measures the live dock instead.
  check('dock clearance: renderTimerDock() re-measures after every change',
    extract('renderTimerDock').includes('syncTimerDockClearance'));
  check('dock clearance: Cook Mode re-render re-applies it',
    extract('renderCookModeOverlay').includes('syncTimerDockClearance'));
  check('dock clearance: rotation/resize re-measures (wired once on the dock)',
    SRC.includes('dock._resizeWired') && SRC.includes("addEventListener('resize'"));

  // Behaviour: run the real sync function against stub DOM.
  geval('let activeTimers = [];\n' + extract('syncTimerDockClearance') +
    '\nglobalThis.syncTimerDockClearance = syncTimerDockClearance;' +
    '\nglobalThis.__setActiveTimers = v => { activeTimers = v; };');
  const bodyStyleSink = {};
  let fakeOverlayEl = { style: {} };
  const fakeDockEl = { hidden: false, offsetHeight: 200 };
  globalThis.document = {
    getElementById: id => id === 'timer-dock' ? fakeDockEl : null,
    querySelector: sel => sel === '.cook-mode-overlay' ? fakeOverlayEl : null,
    body: { style: bodyStyleSink, classList: { contains: () => true, add: () => {}, remove: () => {} } }
  };
  globalThis.__setActiveTimers([{ id: 't1' }]);
  syncTimerDockClearance();
  check('dock clearance: one timer, 200px dock lifts overlay + page by 200px',
    fakeOverlayEl.style.bottom === '200px' && bodyStyleSink.paddingBottom === '200px');
  fakeDockEl.offsetHeight = 135;
  syncTimerDockClearance();
  check('dock clearance: 135px dock (landscape) lifts by 135px',
    fakeOverlayEl.style.bottom === '135px' && bodyStyleSink.paddingBottom === '135px');
  globalThis.__setActiveTimers([]);
  syncTimerDockClearance();
  check('dock clearance: no timers clears both inline lifts',
    fakeOverlayEl.style.bottom === '' && bodyStyleSink.paddingBottom === '');
  globalThis.__setActiveTimers([{ id: 't1' }]);
  fakeDockEl.offsetHeight = 200;
  fakeOverlayEl = null;
  syncTimerDockClearance();
  check('dock clearance: Cook Mode closed (no overlay) still lifts the page, no throw',
    bodyStyleSink.paddingBottom === '200px');
  delete globalThis.document;

  /* ============ 20. Cook Mode A2 + T1–T3, Unified Add Screen (Section B r1), and Speed P1–P4 (2026-11-12) ============ */
  const portraitIdx = CSS.indexOf('@media (max-width: 768px)');
  const landscapeIdx = CSS.indexOf('@media (orientation: landscape) and (max-height: 500px)');
  const rcptCssIdx = CSS.indexOf('BEGIN DELIMITED RECEIPTS STYLES');
  const baseCookCSS = CSS.slice(CSS.indexOf('.cook-mode-overlay {'), portraitIdx);
  const portraitCSS = CSS.slice(portraitIdx, landscapeIdx);
  const landscapeCSS = CSS.slice(landscapeIdx, rcptCssIdx);

  // 20a. Section A2 + T1–T3 CSS rules
  check('A2 CSS: .cm-progress-pill is hidden in portrait (<=768px) only, kept on desktop and landscape',
    /\.cm-progress-pill\s*\{\s*display:\s*none;\s*\}/.test(portraitCSS) &&
    !/\.cm-progress-pill\s*\{\s*display:\s*none;\s*\}/.test(baseCookCSS) &&
    !/\.cm-progress-pill\s*\{\s*display:\s*none;\s*\}/.test(landscapeCSS));

  check('A2 CSS: .cm-step-badge is visible as an eyebrow in portrait (<=768px) and stays hidden in phone landscape',
    /\.cm-step-badge\s*\{[^}]*display:\s*block;[^}]*font-size:\s*0\.78rem;[^}]*border-bottom:\s*1px solid var\(--cream-dark\);/.test(portraitCSS) &&
    !/\.cm-step-badge\s*\{\s*display:\s*none;\s*\}/.test(portraitCSS) &&
    /\.cm-step-badge\s*\{\s*display:\s*none;\s*\}/.test(landscapeCSS));

  check('A2 CSS: .cm-step-card uses justify-content: flex-start and overflow-y: auto in base CSS; .cm-title-wrap uses align-items: center',
    /\.cm-step-card\s*\{[^}]*justify-content:\s*flex-start;[^}]*overflow-y:\s*auto;/.test(baseCookCSS) &&
    /\.cm-title-wrap\s*\{[^}]*align-items:\s*center;/.test(baseCookCSS));

  check('T1 CSS: .cm-title wraps up to 2 lines (-webkit-line-clamp: 2) in BOTH phone media queries and never uses nowrap/ellipsis',
    /\.cm-title\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*2;[^}]*-webkit-box-orient:\s*vertical;[^}]*overflow:\s*hidden;/.test(portraitCSS) &&
    /\.cm-title\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*2;[^}]*-webkit-box-orient:\s*vertical;[^}]*overflow:\s*hidden;/.test(landscapeCSS) &&
    !/\.cm-title\s*\{[^}]*text-overflow:\s*ellipsis/.test(portraitCSS) &&
    !/\.cm-title\s*\{[^}]*text-overflow:\s*ellipsis/.test(landscapeCSS) &&
    !/\.cm-title\s*\{[^}]*-webkit-line-clamp/.test(baseCookCSS));

  check('T2 CSS: wake-active on phones uses warm cream tint (#fff6ec / #d9a074 / var(--accent-dark)) with NO ::after corner dot',
    /\.cm-top-actions\s+\.wake-pill\.active\s*\{[^}]*background:\s*#fff6ec;[^}]*border-color:\s*#d9a074;[^}]*color:\s*var\(--accent-dark\);/.test(portraitCSS) &&
    /\.cm-top-actions\s+\.wake-pill\.active\s*\{[^}]*background:\s*#fff6ec;[^}]*border-color:\s*#d9a074;[^}]*color:\s*var\(--accent-dark\);/.test(landscapeCSS) &&
    !CSS.includes('.wake-pill.active::after'));

  check('T2/T3 CSS: uniform 44x44 square buttons for icon actions and auto-width labeled Ingredients button in both phone queries',
    /\.cm-top-actions\s+\.pill,\s*\.cm-top-actions\s+\.btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*border-radius:\s*10px;/.test(portraitCSS) &&
    /\.cm-top-actions\s+\.cm-drawer-toggle\s*\{[^}]*width:\s*auto;/.test(portraitCSS) &&
    /\.cm-drawer-toggle\s+\.cm-btn-label\s*\{\s*display:\s*inline;\s*\}/.test(portraitCSS) &&
    /\.cm-drawer-toggle\s+\.cm-btn-label\s*\{\s*display:\s*inline;\s*\}/.test(landscapeCSS));

  // 20b. Section B (r1): Home + Browse entry buttons and Unified Add a recipe screen with toggle
  ['activeHaveMarks', 'planCarouselHTML', 'helpLinkHTML', 'renderLanding',
   'blankRecipe', 'historyHTML', 'recipeFormHTML', 'setAddRecipeMode', 'renderAddRecipeScreen',
   'renderAdd', 'renderSubmit'].forEach(n => geval(extract(n)));
  ['GUIDE_SECTION_SLUGS', 'KNOWN_CATEGORIES'].forEach(n => geval(extractDecl(n)));

  const landingApp = { innerHTML: '' };
  globalThis.document = { title: '' };
  renderLanding(landingApp);
  const cardsCloseIdx = landingApp.innerHTML.indexOf('</section>', landingApp.innerHTML.indexOf('class="landing-cards"'));
  const homeAddBtnIdx = landingApp.innerHTML.indexOf('id="home-add-recipe-btn"');
  const thisWeekIdx = landingApp.innerHTML.indexOf('<h2>This week</h2>');
  check('Section B: renderLanding includes #home-add-recipe-btn below .landing-cards and above This week, linking to #/submit',
    homeAddBtnIdx > cardsCloseIdx && homeAddBtnIdx < thisWeekIdx &&
    landingApp.innerHTML.includes('id="home-add-recipe-btn" href="#/submit">+ Add a recipe</a>'));

  const renderRecipesSrc = extract('renderRecipes');
  check('Section B: renderRecipes has single #recipes-add-recipe-btn linking to #/submit (old two buttons removed) and no modal chooser exists',
    renderRecipesSrc.includes('id="recipes-add-recipe-btn" href="#/submit">+ Add a recipe</a>') &&
    !renderRecipesSrc.includes('Submit recipe') &&
    !SRC.includes('openAddRecipeChooser'));

  // Test unified Add screen mount, initial mode selection (#/submit vs #/add), and state-preserving toggle round-trip
  let wiredSaveFn = null;
  globalThis.wireRecipeForm = fn => { wiredSaveFn = fn; };
  globalThis.sendSubmission = () => {};
  globalThis.clearSubmitDraft = () => {};
  globalThis.restoreSubmitDraft = () => {};
  globalThis.loadInboxList = () => {};
  globalThis.window = { _submitPhotos: [] };

  function makeAddScreenEnv() {
    const els = {
      '#add-pane-import': { hidden: false, style: { display: '' } },
      '#add-pane-manual': { hidden: true, style: { display: 'none' } },
      '#add-mode-import': {
        classes: new Set(['btn', 'add-mode-btn', 'active']),
        attrs: { 'aria-pressed': 'true' },
        classList: {
          toggle(c, on) { if (on) els['#add-mode-import'].classes.add(c); else els['#add-mode-import'].classes.delete(c); },
          contains(c) { return els['#add-mode-import'].classes.has(c); }
        },
        setAttribute(k, v) { els['#add-mode-import'].attrs[k] = v; }
      },
      '#add-mode-manual': {
        classes: new Set(['btn', 'secondary', 'add-mode-btn']),
        attrs: { 'aria-pressed': 'false' },
        classList: {
          toggle(c, on) { if (on) els['#add-mode-manual'].classes.add(c); else els['#add-mode-manual'].classes.delete(c); },
          contains(c) { return els['#add-mode-manual'].classes.has(c); }
        },
        setAttribute(k, v) { els['#add-mode-manual'].attrs[k] = v; }
      },
      '#add-help-wrap': { innerHTML: '' },
      '#submit-send': {},
      '#submit-cancel': { addEventListener() {} },
      '#s-url': { value: '', addEventListener() {} },
      '#s-note': { value: '', addEventListener() {} },
      '#s-text': { value: '', addEventListener() {} },
      '#e-title': { value: '' }
    };
    const appNode = {
      innerHTML: '',
       syncPanesFromHTML() {
        const importHidden = /id="add-pane-import"[^>]*hidden/.test(this.innerHTML);
        const manualHidden = /id="add-pane-manual"[^>]*hidden/.test(this.innerHTML);
        els['#add-pane-import'].hidden = importHidden;
        els['#add-pane-import'].style.display = importHidden ? 'none' : '';
        els['#add-pane-manual'].hidden = manualHidden;
        els['#add-pane-manual'].style.display = manualHidden ? 'none' : '';
      }
    };
    return { els, appNode };
  }

  const addEnv = makeAddScreenEnv();
  const prevDollar = globalThis.$;
  globalThis.$ = sel => addEnv.els[sel] || null;
  globalThis.allCats = () => ['main', 'side'];
  globalThis.saveNewRecipe = () => {};
  geval('let editDraft = null;\n' +
    extract('renderAddRecipeScreen') + '\n' +
    extract('renderAdd') + '\n' +
    extract('renderSubmit') + '\n' +
    'globalThis.renderAddRecipeScreen = renderAddRecipeScreen;\n' +
    'globalThis.renderAdd = renderAdd;\n' +
    'globalThis.renderSubmit = renderSubmit;\n' +
    'globalThis.__getEditDraft = () => editDraft;');

  renderSubmit(addEnv.appNode);
  addEnv.appNode.syncPanesFromHTML();
  check('Section B: #/submit (renderSubmit) renders BOTH panes and preselects Auto-Import',
    addEnv.appNode.innerHTML.includes('id="add-mode-import"') &&
    addEnv.appNode.innerHTML.includes('id="add-mode-manual"') &&
    addEnv.appNode.innerHTML.includes('id="add-pane-import"') &&
    addEnv.appNode.innerHTML.includes('id="add-pane-manual"') &&
    addEnv.els['#add-pane-import'].hidden === false &&
    addEnv.els['#add-pane-manual'].hidden === true &&
    wiredSaveFn === globalThis.saveNewRecipe);

  // Type into both panes and toggle import -> manual -> import: neither pane re-renders or loses typed content
  addEnv.els['#s-url'].value = 'https://example.com/soup';
  addEnv.els['#s-note'].value = 'Grandma recipe';
  addEnv.els['#s-text'].value = '2 cups broth';
  addEnv.els['#e-title'].value = 'Typed Manual Title';
  globalThis.__getEditDraft().title = 'Typed Manual Title';
  const htmlBeforeToggle = addEnv.appNode.innerHTML;

  addEnv.els['#add-mode-manual'].onclick();
  const manualVisibleAfterClick = addEnv.els['#add-pane-manual'].hidden === false &&
    addEnv.els['#add-pane-import'].hidden === true &&
    addEnv.els['#add-mode-manual'].classList.contains('active') &&
    !addEnv.els['#add-mode-import'].classList.contains('active') &&
    addEnv.els['#add-help-wrap'].innerHTML.includes('#/guide/editing');

  addEnv.els['#add-mode-import'].onclick();
  const importVisibleAfterRoundTrip = addEnv.els['#add-pane-import'].hidden === false &&
    addEnv.els['#add-pane-manual'].hidden === true &&
    addEnv.els['#add-mode-import'].classList.contains('active') &&
    !addEnv.els['#add-mode-manual'].classList.contains('active') &&
    addEnv.els['#add-help-wrap'].innerHTML.includes('#/guide/submitting');

  check('Section B: toggling switches pane visibility and help slug without re-rendering or wiping typed fields',
    manualVisibleAfterClick && importVisibleAfterRoundTrip &&
    addEnv.appNode.innerHTML === htmlBeforeToggle &&
    addEnv.els['#s-url'].value === 'https://example.com/soup' &&
    addEnv.els['#s-note'].value === 'Grandma recipe' &&
    addEnv.els['#s-text'].value === '2 cups broth' &&
    addEnv.els['#e-title'].value === 'Typed Manual Title' &&
    globalThis.__getEditDraft().title === 'Typed Manual Title');

  renderAdd(addEnv.appNode);
  addEnv.appNode.syncPanesFromHTML();
  check('Section B: #/add (renderAdd) renders unified screen with Manual Form preselected',
    addEnv.els['#add-pane-manual'].hidden === false &&
    addEnv.els['#add-pane-import'].hidden === true &&
    addEnv.appNode.innerHTML.includes('id="add-mode-manual" data-add-mode="manual" aria-pressed="true"'));
  globalThis.$ = prevDollar;

  // 20b-extra. Category-erasure fix (Nov 12, 2026): KNOWN_CATEGORIES carries
  // all 15 live categories, the form renders a checkbox for any category
  // already on the recipe, and collectRecipeForm preserve-merges unlisted
  // categories instead of silently deleting them.
  const formHTML = recipeFormHTML(blankRecipe(), '#/');
  check('Section B (categories): recipeFormHTML renders all 15 KNOWN_CATEGORIES as .e-cat checkboxes',
    KNOWN_CATEGORIES.length === 15 &&
    KNOWN_CATEGORIES.every(c => formHTML.includes('class="e-cat" value="' + c + '"')));
  const formWithExtra = recipeFormHTML(Object.assign(blankRecipe(), { categories: ['drinks'] }), '#/');
  check('Section B (categories): recipeFormHTML renders a checked checkbox for a category on the recipe that is not in KNOWN_CATEGORIES',
    formWithExtra.includes('class="e-cat" value="drinks" checked'));

  geval(extract('collectRecipeForm'));
  const catDollar = globalThis.$;
  const catDocument = globalThis.document;
  globalThis.$ = sel => ({
    '#e-title': { value: 'Test Dish' },
    '#e-kosher': { value: 'pareve' },
    '#e-prep': { value: '10' },
    '#e-cook': { value: '0' },
    '#e-serv': { value: '4' },
    '#e-kfp': { checked: false },
    '#e-left': { checked: false },
    '#e-needs-side': { checked: false },
    '#e-kosher-review': { checked: false },
    '#e-kosher-notes': { value: '' },
    '#e-tags': { value: '' },
    '#e-banner': { value: '' },
    '#e-pdf': { value: '' },
    '#e-leftnote': { value: '' },
    '#e-notes': { value: '' },
    '#e-source': { value: '' }
  }[sel] || null);
  globalThis.document = {
    querySelectorAll: sel => sel === '.e-cat'
      ? [{ value: 'main', checked: true }, { value: 'dips', checked: false }, { value: 'side', checked: false }]
      : []
  };
  const mergeDraft = Object.assign(blankRecipe(), {
    categories: ['drinks', 'dips'],
    ingredients: [{ section: '', items: [{ qty: '1', unit: 'cup', item: 'water' }] }],
    instructions: ['Stir.'],
    pairings: [], variants: []
  });
  collectRecipeForm(mergeDraft);
  check('Section B (categories): collectRecipeForm preserve-merges — keeps an unlisted category, drops an offered-but-unchecked one, keeps a checked one',
    JSON.stringify(mergeDraft.categories) === JSON.stringify(['drinks', 'main']));
  globalThis.$ = catDollar;
  globalThis.document = catDocument;

  // 20c. Section C — P1 (route() scrollTo guard + renderRecipe scrollTo + hash-change abort) & P2 (instant shell + 200ms loading timer + hero preservation)
  const routeSrc = extract('route');
  check('Section C (P1): route() skips window.scrollTo(0, 0) on #/recipe/ routes',
    routeSrc.includes("if (!h.startsWith('#/recipe/')) window.scrollTo(0, 0);"));

  globalThis.wakeLockWanted = false;
  geval(extractDecl('fmtTime'));
  ['pdfUrl', 'recipeRatingRowHTML', 'recipeCookBarHTML',
   'recipeHeroHeaderHTML', 'renderRecipe'].forEach(n => geval(extract(n)));

  let scrollCalls = 0;
  globalThis.window = {
    scrollTo: () => { scrollCalls++; },
    print: () => {}
  };
  globalThis.location = { hash: '#/recipe/shell-test-soup' };
  globalThis.document = { title: 'Reiss Family Recipes' };
  globalThis.metaById['shell-test-soup'] = {
    id: 'shell-test-soup',
    title: 'Shell Test Soup',
    kosher_status: 'pareve',
    kosher_for_passover: true,
    categories: ['soup'],
    tags: ['quick'],
    prep_minutes: 10,
    cook_minutes: 25,
    servings: '4',
    leftover_friendly: true,
    banner_image: 'images/shell-test-soup.jpg'
  };
  delete globalThis.byId['shell-test-soup'];

  let resolveRecipeFetch = null;
  globalThis.ensureRecipe = id => new Promise(res => { resolveRecipeFetch = res; });

  const heroNodeRef = { tag: 'div', className: 'recipe-hero' };
  const bodyNodeRef = { innerHTML: '' };
  const cookBtnRef = { disabled: true, addEventListener() {} };
  const recipeApp = {
    nodeType: 1,
    innerHTML: '<div>Old Home Screen</div>',
    querySelector(sel) {
      if (sel === '.recipe-hero') return heroNodeRef;
      if (sel === '#recipe-detail-body') return bodyNodeRef;
      if (sel === '#open-cook-mode-btn') return cookBtnRef;
      return null;
    },
    querySelectorAll() { return []; }
  };

  const renderPromise = renderRecipe(recipeApp, 'shell-test-soup');
  const shellHTMLImmediate = recipeApp.innerHTML;
  const scrolledOnShell = scrollCalls === 1;
  const noLoadingMsgAt0ms = !shellHTMLImmediate.includes('Loading recipe…') && !bodyNodeRef.innerHTML.includes('Loading recipe…');

  check('Section C (P1/P2): renderRecipe paints instant shell synchronously from metaById[id], scrolls once, and shows no loading text before 200ms',
     !shellHTMLImmediate.includes('Old Home Screen') &&
    shellHTMLImmediate.includes('Shell Test Soup') &&
    shellHTMLImmediate.includes('images/shell-test-soup.jpg') &&
    shellHTMLImmediate.includes('Prep <strong>10 min</strong>') &&
    shellHTMLImmediate.includes('Cook <strong>25 min</strong>') &&
    shellHTMLImmediate.includes('Serves <strong id="header-servings-val">4</strong>') &&
    shellHTMLImmediate.includes('<div id="recipe-detail-body"></div>') &&
    scrolledOnShell && noLoadingMsgAt0ms);

  // Wait 220ms while ensureRecipe is still pending -> "Loading recipe…" appears in #recipe-detail-body
  await sleep(220);
  const loadingShownAfter200ms = bodyNodeRef.innerHTML.includes('Loading recipe…');
  check('Section C (P2): "Loading recipe…" appears in #recipe-detail-body only when ensureRecipe takes >200ms',
    loadingShownAfter200ms);

  // Resolve ensureRecipe -> populates #recipe-detail-body without re-writing recipeApp.innerHTML (preserving .recipe-hero)
  const shellHTMLBeforeResolve = recipeApp.innerHTML;
  resolveRecipeFetch({
    id: 'shell-test-soup',
    title: 'Shell Test Soup',
    kosher_status: 'pareve',
    kosher_for_passover: true,
    categories: ['soup'],
    tags: ['quick'],
    prep_minutes: 10,
    cook_minutes: 25,
    servings: '4',
    leftover_friendly: true,
    banner_image: 'images/shell-test-soup.jpg',
    ingredients: [{ section: '', items: [{ qty: '2', unit: 'cups', item: 'water' }] }],
    instructions: ['Boil water for 5 minutes.']
  });
  await renderPromise;

  check('Section C (P2): resolving ensureRecipe populates #recipe-detail-body in place without re-mounting .recipe-hero or scrolling a second time',
    recipeApp.innerHTML === shellHTMLBeforeResolve &&
    recipeApp.querySelector('.recipe-hero') === heroNodeRef &&
    bodyNodeRef.innerHTML.includes('<h2>Ingredients</h2>') &&
    bodyNodeRef.innerHTML.includes('<h2>Instructions</h2>') &&
    bodyNodeRef.innerHTML.includes('Boil water for') &&
    !bodyNodeRef.innerHTML.includes('Loading recipe…') &&
    scrollCalls === 1);

  check('Section C (P2): shell Cook Mode button is disabled while loading and enabled once the recipe loads',
    shellHTMLImmediate.includes('id="open-cook-mode-btn" disabled') &&
    cookBtnRef.disabled === false);

  // Test stale hash-change abort (P1): navigate away while ensureRecipe is in flight
  let resolveStaleFetch = null;
  globalThis.ensureRecipe = id => new Promise(res => { resolveStaleFetch = res; });
  globalThis.location = { hash: '#/recipe/shell-test-soup' };
  const staleApp = {
    innerHTML: '',
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const stalePromise = renderRecipe(staleApp, 'shell-test-soup');
  // Simulate user clicking Back to #/recipes before ensureRecipe resolves
  globalThis.location.hash = '#/recipes';
  staleApp.innerHTML = '<section>Browse Recipes Grid</section>';
  globalThis.document.title = 'Recipes — Reiss Family Recipes';
  resolveStaleFetch({
    id: 'shell-test-soup',
    title: 'Shell Test Soup',
    kosher_status: 'pareve',
    ingredients: [],
    instructions: ['Step 1']
  });
  await stalePromise;
  check('Section C (P1): renderRecipe aborts after await if location.hash changed while ensureRecipe was in flight',
    staleApp.innerHTML === '<section>Browse Recipes Grid</section>' &&
    globalThis.document.title === 'Recipes — Reiss Family Recipes');

  // 20d. Section C — P3 (boot() non-blocking fetchLiveMealPlan)
  const bootSrc = extract('boot');
  check('Section C (P3): boot() starts fetchLiveMealPlan() in parallel, calls route() before awaiting it, and merges/refreshes on resolve',
    bootSrc.includes('const livePlanPromise = Promise.resolve().then(() => fetchLiveMealPlan())') &&
    bootSrc.indexOf('route();') < bootSrc.indexOf('livePlanPromise.then(') &&
    bootSrc.includes('mealPlan = mergeMealPlan(mp, mealPlan);'));

  // Behavioral test of boot() with a slow fetchLiveMealPlan
  let resolveSlowLivePlan = null;
  let routeCalledCount = 0;
  let landingRenderedAfterPlan = false;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('meta.json')) {
      return { ok: true, json: async () => [{ id: 'r1', title: 'R1', kosher_status: 'meat', categories: ['main'], banner_image: 'images/r1.jpg' }] };
    }
    if (String(url).includes('shopping-sections.json')) {
      return { ok: true, json: async () => ({ departments: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  geval(
    'let _bootRouteCalls = 0;\n' +
    'let _bootLandingCalls = 0;\n' +
    'function loadError() {}\n' +
    'function loadShopLocal() {}\n' +
    'function initTimerVoiceSetting() {}\n' +
    'function loadTimersFromSession() {}\n' +
    'function ensureTimerDockMounted() {}\n' +
    'function renderTimerDock() {}\n' +
    'function preloadCategoryTileImages() {}\n' +
    'function route() { _bootRouteCalls++; }\n' +
    'function renderLanding() { _bootLandingCalls++; }\n' +
    'function fetchLiveMealPlan() { return new Promise(r => { globalThis.__resolveBootPlan = r; }); }\n' +
    extract('boot') + '\n' +
    'globalThis.__runBootTest = boot;\n' +
    'globalThis.__getBootCounts = () => ({ routeCalls: _bootRouteCalls, landingCalls: _bootLandingCalls });'
  );
  globalThis.location = { hash: '#/' };
  globalThis.document = { hidden: false, addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  await globalThis.__runBootTest();
  const countsBeforePlan = globalThis.__getBootCounts();
  check('Section C (P3): boot() finishes and calls route() immediately while fetchLiveMealPlan() is still pending',
    countsBeforePlan.routeCalls === 1 && countsBeforePlan.landingCalls === 0);

  globalThis.__resolveBootPlan({ weeks: { [thisWeekKey()]: { days: blankDays() } } });
  await sleep(10);
  const countsAfterPlan = globalThis.__getBootCounts();
  check('Section C (P3): when fetchLiveMealPlan() resolves on #/, boot() merges the plan and re-renders Landing',
    countsAfterPlan.landingCalls === 1 && !!globalThis.mealPlan.weeks[thisWeekKey()]);
  globalThis.fetch = savedFetch;

  // 20e. Section C — P4 (tilesHTML decoding="async", no loading="lazy", pickCategoryTileImages, .cat-tile gradient)
  ['TILE_HEROES', 'TILE_CATS'].forEach(n => geval(extractDecl(n)));
  ['pickCategoryTileSpecs', 'pickCategoryTileImages', 'preloadCategoryTileImages', 'tilesHTML'].forEach(n => geval(extract(n)));
  setMeta([
    { id: 'brisket-with-vegetables-and-dried-fruit', title: 'Brisket', kosher_status: 'meat', categories: ['main'], banner_image: 'images/brisket.jpg' },
    { id: 'baked-ziti', title: 'Baked Ziti', kosher_status: 'dairy', categories: ['main'], banner_image: 'images/ziti.jpg' },
    { id: 'potato-kugel', title: 'Potato Kugel', kosher_status: 'pareve', categories: ['side'], banner_image: 'images/kugel.jpg' }
  ]);
  const renderedTiles = tilesHTML();
  const pickedUrls = pickCategoryTileImages();
  check('Section C (P4): tilesHTML uses decoding="async", drops loading="lazy", and pickCategoryTileImages returns deduplicated URLs',
    renderedTiles.includes('decoding="async"') &&
    !renderedTiles.includes('loading="lazy"') &&
    JSON.stringify(pickedUrls) === JSON.stringify(['images/brisket.jpg', 'images/ziti.jpg', 'images/kugel.jpg']));
  check('Section C (P4): .cat-tile in styles.css uses warm gradient background instead of flat --cream-dark',
    /\.cat-tile\s*\{[^}]*background:\s*linear-gradient\(135deg,\s*#dfcbb2,\s*#b87b56\)/.test(CSS));

  const failed = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' assertions passed ====');
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
