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
  : (fs.existsSync(path.join(__dirname, '..', 'site', 'app.js'))
    ? path.join(__dirname, '..', 'site')
    : path.join(__dirname, '..'));
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
['totalTime', 'ymd', 'blankSlot', 'SHOP_STORE_KEY', 'STORE_NOTES_LOCAL_KEY'].forEach(n => geval(extractDeclSemi(n)));
['PLAN_RE', 'YIELD_LEFT_VALUES', 'TSP_PER', 'COUNT_TO_TSP', 'SIZE_WORDS',
 'UNCOUNTABLES', 'IRREGULAR_PLURALS', 'IRREGULAR_SINGULARS',
 'UNICODE_FRACTIONS', 'SECTION_GENERIC_WORDS',
 'ITEM_ALIASES', 'UNIT_ALIASES',
 'PRICE_ABBREV_MAP', 'PRICE_MODIFIER_WORDS', 'PRICE_QUALIFIED_HEADS'].forEach(n => geval(extractDecl(n)));
globalThis._priceHistoryCache = null;
globalThis._priceHistoryInFlight = null;
globalThis._priceHistoryFetched = false;
globalThis._openPriceDetailKeys = new Set();
globalThis._storeNotesCache = {};
globalThis._storeNotesInFlight = null;
globalThis._storeNotesFetched = false;
globalThis._saveStoreNotesChain = Promise.resolve();
globalThis._saveStoreNotesInFlight = 0;
geval(SRC.match(/let _savePlanChain = Promise\.resolve\(\);/)[0] + '\n' +
      SRC.match(/let _savePlanInFlight = 0;/)[0] + '\n' +
      SRC.match(/let _shopSyncTimer = null;/)[0] + '\n' +
      SRC.match(/let _shopDirty = false;/)[0] + '\n' +
      SRC.match(/let _shopDirtyGen = 0;/)[0] + '\n' +
      extract('syncShopSoon') + '\n' +
      extract('attemptSaveMealPlan') + '\n' +
      extract('saveMealPlan'));
extract('parseQty', true).forEach(src => geval(src));
['qtyToNum', 'parseQtyBounds', 'decomposeTsp', 'fmtQty', 'pluralize', 'pluralizeUnit', 'stripSize', 'stripSizeKeepCase',
 'singularizeWord', 'groupKey', 'canonicalUnit', 'canonicalShopKey', 'markMatchesShopKey',
 'parseSingleValue', 'parseFractionOrDecimal',
 'fromTsp', 'parseServings', 'normalizeSlot', 'sundayOf', 'weekDayYmd',
 'thisWeekKey', 'shoppingFromYmd', 'getWeek', 'recipeMeta', 'sectionMatchWords', 'lookupShoppingSection', 'buildShoppingList',
 'normalizeHaveMarks', 'mergeHaveMarks', 'mergeManualItems', 'normalizePromotedList',
 'mergePromoted', 'mergeWeekState', 'mergeMealPlan', 'mergeDraftSnap', 'bridgeReadMealPlan',
 'normalizeStore', 'displayStoreName', 'getShopStore', 'setShopStore',
 'normalizeStoreNotes', 'mergeStoreNotes', 'saveStoreNotesLocal', 'loadStoreNotesLocal',
 'setStoreNotesCache', 'resetStoreNotesSession', 'bridgeReadStoreNotes',
 'ensureStoreNotesLoaded', 'saveStoreNotes', 'getStoreNoteStatus', 'toggleStoreNote',
 'priceMatchWords', 'priceHeadNoun', 'mergePriceHistoryEntryPair',
 'entryPriceAtStore', 'entryPriceElsewhere', 'priceMatchFor', 'collectKnownStores',
 'setPriceHistoryCache', 'resetPriceHistorySession', 'ensurePriceHistoryLoaded',
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
 'normalizeDraftChips', 'persistWeek', 'readDraftChips', 'persistDraftChips',
 'buildPrefsEntry', 'setRecipePref', 'buildYieldEntry',
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

  check('T1 CSS: .cm-title wraps up to 3 lines (-webkit-line-clamp: 3) in BOTH phone media queries and never uses nowrap/ellipsis',
    /\.cm-title\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*3;[^}]*-webkit-box-orient:\s*vertical;[^}]*overflow:\s*hidden;/.test(portraitCSS) &&
    /\.cm-title\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*3;[^}]*-webkit-box-orient:\s*vertical;[^}]*overflow:\s*hidden;/.test(landscapeCSS) &&
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
  // v20261112d: homeToBuyCount now calls splitShopItems (To buy section only),
  // so its deps come along — promotedKeySet/promotedIsActive for the Optional split.
  ['activeHaveMarks', 'planCarouselHTML', 'helpLinkHTML', 'renderLanding', 'homeToBuyCount',
   'splitShopItems', 'promotedKeySet', 'promotedIsActive',
   'blankRecipe', 'historyHTML', 'recipeFormHTML', 'setAddRecipeMode', 'renderAddRecipeScreen',
   'renderAdd', 'renderSubmit'].forEach(n => geval(extract(n)));
  ['GUIDE_SECTION_SLUGS', 'KNOWN_CATEGORIES'].forEach(n => geval(extractDecl(n)));

  const landingApp = { innerHTML: '' };
  globalThis.document = { title: '' };
  // v20261112c: renderLanding warms the recipe cache and re-renders if the
  // home counter changes — stub the async fetch so this stays synchronous.
  globalThis.ensurePlannedRecipes = () => Promise.resolve();
  globalThis.location = { hash: '#/' };
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
    pairings: [],
    variants: [{ key: 'beef', label: 'Beef', default: true, slotClass: 'ground-beef' }]
  });
  collectRecipeForm(mergeDraft);
  check('Section B (categories): collectRecipeForm preserve-merges — keeps an unlisted category, drops an offered-but-unchecked one, keeps a checked one',
    JSON.stringify(mergeDraft.categories) === JSON.stringify(['drinks', 'main']));
  check('Section B (variants): collectRecipeForm preserves extra properties (e.g. slotClass) on existing variant objects',
    mergeDraft.variants.length === 1 && mergeDraft.variants[0].slotClass === 'ground-beef');
  globalThis.$ = catDollar;
  globalThis.document = catDocument;

  // 20c. Section C — P1 (route() scrollTo guard + renderRecipe scrollTo + hash-change abort) & P2 (instant shell + 200ms loading timer + hero preservation)
  const routeSrc = extract('route');
  check('Section C (P1): route() skips window.scrollTo(0, 0) on #/recipe/ routes',
    routeSrc.includes("if (!h.startsWith('#/recipe/')) window.scrollTo(0, 0);"));

  globalThis.wakeLockWanted = false;
  geval(extractDecl('fmtTime'));
  geval(extractDeclSemi('prettyDate'));
  geval(extractDeclSemi('dayName'));
  ['pdfUrl', 'recipeRatingRowHTML', 'recipeCookBarHTML',
   'plannerDateToWeekAndDay', 'plannerOffsetForWeekKey', 'formatPlannerConfirmDate',
   'resolveAddPlannerVariant', 'addToPlannerPanelHTML', 'addToPlannerConfirmHTML',
   'persistWeek', 'addRecipeToPlannerSlot',
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
  const addPlannerBtnRef = { disabled: true, classList: { remove() {}, add() {} }, setAttribute() {}, addEventListener() {} };
  const recipeApp = {
    nodeType: 1,
    innerHTML: '<div>Old Home Screen</div>',
    querySelector(sel) {
      if (sel === '.recipe-hero') return heroNodeRef;
      if (sel === '#recipe-detail-body') return bodyNodeRef;
      if (sel === '#open-cook-mode-btn') return cookBtnRef;
      if (sel === '#add-to-planner-btn') return addPlannerBtnRef;
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

  // Section 21. v20261112b regressions (Nov 14, 2026).
  // (a) Shopping list blank page: shoppingListHTML passed null as the manual
  // renderer for the Optional section; renderShopSections called [].map(null),
  // which throws and discarded the whole list HTML. The guard defaults a null
  // renderer to a no-op. (b) Cook Mode title clamps to 3 lines on phones.
  ['splitShopItems', 'partitionStaples', 'promotedKeySet', 'promotedIsActive', 'weekStripHTML', 'shoppingListHTML', 'getHideStaples']
    .forEach(n => geval(extract(n)));
  setMeta([{ id: 'burritos', title: 'Burritos', kosher_status: 'meat', categories: ['main'], banner_image: 'images/burritos.jpg' }]);
  globalThis.byId = { burritos: { id: 'burritos', title: 'Burritos', ingredients: [
    { section: 'Beans (always)', items: [
      { qty: '1', unit: 'can', item: 'black or pinto beans (15 oz)' },
      { qty: '1', unit: '', item: 'jalapeno', prep: 'diced', optional: true }
    ] },
    { section: 'Fresh', items: [
      { qty: '1', unit: '', item: 'heart of romaine lettuce', prep: 'sliced thin' }
    ] }
  ] } };
  globalThis.shoppingSections = { departments: ['Fresh Produce', 'Grocery'], fallbackDepartment: 'Unsorted' };
  const wkDays = blankDays();
  wkDays[0].dinner.dishes = [{ recipe: 'burritos', drafted: false }];
  setPlan({ [thisWeekKey()]: { days: wkDays, shoppingDay: thisWeekKey() } });
  let shopHTML = null, shopErr = null;
  try { shopHTML = shoppingListHTML(); } catch (e) { shopErr = e; }
  check('Section 21 (shopping): shoppingListHTML renders To buy + Optional (with the optional jalapeno) instead of throwing when a planned dish has an optional ingredient',
    !shopErr && shopHTML.includes('To buy') && shopHTML.includes('Optional') && shopHTML.includes('jalapeno'),
    shopErr ? ('threw: ' + shopErr.message) : '');
  check('Section 21 (cook-mode title): .cm-title clamps to 3 lines in both phone media queries, with no 2-line clamp left',
    (CSS.match(/\.cm-title\s*\{[^}]*-webkit-line-clamp:\s*3/g) || []).length === 2 &&
    !/\.cm-title\s*\{[^}]*-webkit-line-clamp:\s*2/.test(CSS));

  /* ============ 22. Add to Planner from Recipe Detail Page (Nov 14, 2026) ============ */
  // 22(a) recipeCookBarHTML renders #add-to-planner-btn (📅 Add to Planner) and respects disabled on the instant-shell path, enabled when wired
  const cookBarEnabledHTML = recipeCookBarHTML(true, false, false);
  const cookBarDisabledHTML = recipeCookBarHTML(true, false, true);
  check('22(a) recipeCookBarHTML renders 📅 Add to Planner button (#add-to-planner-btn) and #add-planner-host, disabled on shell and enabled when wired',
    cookBarEnabledHTML.includes('id="add-to-planner-btn">📅 Add to Planner</button>') &&
    cookBarEnabledHTML.includes('id="add-planner-host"') &&
    cookBarDisabledHTML.includes('id="add-to-planner-btn" disabled>📅 Add to Planner</button>') &&
    shellHTMLImmediate.includes('id="add-to-planner-btn" disabled') &&
    addPlannerBtnRef.disabled === false);

  // Set up test recipes (one standard recipe with leftovers, one variant recipe) and clean mealPlan state
  const PLAN_TEST_META = [
    {
      id: 'roast-chicken', title: 'Roast Chicken', kosher_status: 'meat',
      categories: ['main', 'chicken'], prep_minutes: 15, cook_minutes: 60,
      servings: '6', leftover_friendly: true
    },
    {
      id: 'garlic-green-beans', title: 'Garlic Green Beans', kosher_status: 'pareve',
      categories: ['side'], prep_minutes: 10, cook_minutes: 10,
      servings: '4', leftover_friendly: false
    },
    {
      id: 'stir-fry-bowls', title: 'Stir-Fry Bowls', kosher_status: 'meat',
      categories: ['main'], prep_minutes: 20, cook_minutes: 15,
      servings: '4', leftover_friendly: true,
      variants: [
        { key: 'chicken', label: 'Chicken', default: true, slotClass: 'chicken' },
        { key: 'tofu', label: 'Tofu', default: false, slotClass: 'veg' }
      ]
    }
  ];
  setMeta(PLAN_TEST_META);
  PLAN_TEST_META.forEach(m => { globalThis.byId[m.id] = { ...m }; });
  setPlan({});

  // 22(b) Adding a dish to an empty slot produces { recipe, variant (if any), drafted: false, reason: null, locked: false }
  // on the right weekKey + dayIdx + meal, and runs recomputeWeekLunches(key).
  const addSunRes = await addRecipeToPlannerSlot(globalThis.byId['roast-chicken'], '2026-11-15', 'dinner', null);
  const wkNov15 = getWeek('2026-11-15');
  const sunDinnerSlot = normalizeSlot(wkNov15.days[0].dinner);
  const monLunchSlot = normalizeSlot(wkNov15.days[1].lunch);
  check('22(b) adding a non-variant dish to an empty slot writes { recipe, drafted: false, reason: null, locked: false } (no variant key), persists via saveMealPlan, and runs recomputeWeekLunches',
    addSunRes.added === true &&
    addSunRes.duplicate === false &&
    addSunRes.persisted === true &&
    addSunRes.weekKey === '2026-11-15' &&
    addSunRes.dayIdx === 0 &&
    addSunRes.meal === 'dinner' &&
    addSunRes.message === 'Added to Sunday, Nov 15 dinner' &&
    sunDinnerSlot.dishes.length === 1 &&
    JSON.stringify(sunDinnerSlot.dishes[0]) === JSON.stringify({
      recipe: 'roast-chicken',
      drafted: false,
      reason: null,
      locked: false
    }) &&
    !('variant' in sunDinnerSlot.dishes[0]) &&
    monLunchSlot.dishes.length === 1 &&
    monLunchSlot.dishes[0].recipe === 'roast-chicken' &&
    monLunchSlot.dishes[0].leftovers === true &&
    serverState.weeks['2026-11-15'].days[0].dinner.dishes[0].recipe === 'roast-chicken');

  // 22(c) Adding to a slot that already has a dish appends alongside it (both dishes remain)
  const addSideRes = await addRecipeToPlannerSlot(globalThis.byId['garlic-green-beans'], '2026-11-15', 'dinner', null);
  const sunDinnerAfterSecond = normalizeSlot(getWeek('2026-11-15').days[0].dinner);
  check('22(c) adding to a slot that already has a dish appends alongside it (both dishes remain)',
    addSideRes.added === true &&
    sunDinnerAfterSecond.dishes.length === 2 &&
    sunDinnerAfterSecond.dishes[0].recipe === 'roast-chicken' &&
    sunDinnerAfterSecond.dishes[1].recipe === 'garlic-green-beans' &&
    sunDinnerAfterSecond.dishes[1].drafted === false &&
    sunDinnerAfterSecond.dishes[1].locked === false);

  // 22(d) Adding to a skipped slot (skipped: true, note: 'Eat out') clears skipped to false and note to ''
  getWeek('2026-11-15').days[2].dinner = { dishes: [], skipped: true, note: 'Eat out' };
  const addSkippedRes = await addRecipeToPlannerSlot(globalThis.byId['roast-chicken'], '2026-11-17', 'dinner', null);
  const tueDinnerSlot = normalizeSlot(getWeek('2026-11-15').days[2].dinner);
  check('22(d) adding to a skipped slot (skipped: true, note: "Eat out") clears skipped to false and note to ""',
    addSkippedRes.added === true &&
    addSkippedRes.dayIdx === 2 &&
    tueDinnerSlot.skipped === false &&
    tueDinnerSlot.note === '' &&
    tueDinnerSlot.dishes.length === 1 &&
    tueDinnerSlot.dishes[0].recipe === 'roast-chicken');

  // 22(e) Variant handling + Dedupe: adding the same recipe + variant to a slot is a no-op returning 'Already on <Day> <meal>',
  // while adding a different variant of the same recipe to that slot IS allowed (dish count becomes 2).
  // Test on Friday, Nov 20 dinner (Shabbat slot — allowed with no restriction).
  const addVar1 = await addRecipeToPlannerSlot(globalThis.byId['stir-fry-bowls'], '2026-11-20', 'dinner', 'chicken');
  const friDinnerAfter1 = JSON.parse(JSON.stringify(normalizeSlot(getWeek('2026-11-15').days[5].dinner)));
  const addVarDup = await addRecipeToPlannerSlot(globalThis.byId['stir-fry-bowls'], '2026-11-20', 'dinner', 'chicken');
  const friDinnerAfterDup = JSON.parse(JSON.stringify(normalizeSlot(getWeek('2026-11-15').days[5].dinner)));
  const addVar2 = await addRecipeToPlannerSlot(globalThis.byId['stir-fry-bowls'], '2026-11-20', 'dinner', 'tofu');
  const friDinnerAfter2 = JSON.parse(JSON.stringify(normalizeSlot(getWeek('2026-11-15').days[5].dinner)));
  check('22(e) dedupe blocks exact same recipe + variant ("Already on Friday dinner", dish count stays 1) and allows a different variant of the same recipe (dish count becomes 2)',
    addVar1.added === true &&
    addVar1.message === 'Added to Friday, Nov 20 dinner' &&
    friDinnerAfter1.dishes.length === 1 &&
    JSON.stringify(friDinnerAfter1.dishes[0]) === JSON.stringify({
      recipe: 'stir-fry-bowls',
      variant: 'chicken',
      drafted: false,
      reason: null,
      locked: false
    }) &&
    addVarDup.added === false &&
    addVarDup.duplicate === true &&
    addVarDup.message === 'Already on Friday dinner' &&
    friDinnerAfterDup.dishes.length === 1 &&
    addVar2.added === true &&
    friDinnerAfter2.dishes.length === 2 &&
    friDinnerAfter2.dishes[0].variant === 'chicken' &&
    friDinnerAfter2.dishes[1].variant === 'tofu');

  // 22(f) Picker panel HTML (date defaults to today, Dinner active by default, version line shown only for variant recipes) + View planner week offset math
  const panelVarHTML = addToPlannerPanelHTML(globalThis.byId['stir-fry-bowls'], 'tofu', '2026-11-20', 'dinner');
  const panelNoVarHTML = addToPlannerPanelHTML(globalThis.byId['roast-chicken'], null, '2026-11-20', 'dinner');
  const nextWeekKey = addDaysToKey(thisWeekKey(), 14);
  const confirmHTML = addToPlannerConfirmHTML('Added to Friday, Nov 20 dinner', nextWeekKey, false);
  check('22(f) addToPlannerPanelHTML renders date input, Lunch/Dinner toggle (Dinner default), conditional version line, and plannerOffsetForWeekKey computes exact week offset for View planner',
    panelVarHTML.includes('id="ap-date"') &&
    panelVarHTML.includes('value="2026-11-20"') &&
    panelVarHTML.includes('data-ap-meal="dinner" aria-pressed="true"') &&
    panelVarHTML.includes('id="ap-variant-line" data-ap-variant="tofu"') &&
    panelVarHTML.includes('<strong id="ap-variant-label">Tofu</strong>') &&
    !panelNoVarHTML.includes('id="ap-variant-line"') &&
    confirmHTML.includes('id="ap-view-planner"') &&
    plannerOffsetForWeekKey(thisWeekKey()) === 0 &&
    plannerOffsetForWeekKey(nextWeekKey) === 2 &&
    plannerOffsetForWeekKey(addDaysToKey(thisWeekKey(), -7)) === -1);

  // Section 23. Shopping classification: groupKey -es fix + word-overlap
  // fallback in lookupShoppingSection + map migration/additions (Nov 15, 2026).
  // (stripSize/singularizeWord/groupKey/sectionMatchWords/lookupShoppingSection
  // and SECTION_GENERIC_WORDS load at the top with the other real code.)
  check('Section 23 (groupKey): -es plurals singularize cleanly (tomatoes->tomato, leaves->leaf, potatoes->potato, cherries->cherry, cranberries->cranberry)',
    groupKey('crushed san marzano tomatoes') === 'crushed san marzano tomato' &&
    groupKey('basil leaves') === 'basil leaf' &&
    groupKey('russet potatoes') === 'russet potato' &&
    groupKey('cherries') === 'cherry' &&
    groupKey('cranberries') === 'cranberry' &&
    groupKey('bunches') === 'bunch' &&
    groupKey('boxes') === 'box');
  check('Section 23 (groupKey): old singularization preserved (eggs->egg, glass stays glass, cheese unchanged, size words still stripped)',
    groupKey('eggs') === 'egg' &&
    groupKey('glass') === 'glass' &&
    groupKey('cheese') === 'cheese' &&
    groupKey('large egg') === 'egg');
  const fixtureSections = { departments: ['Fresh Produce', 'Grocery', 'Dairy & Eggs', 'Meat, Poultry & Fish', 'Wine & Spirits'],
    fallbackDepartment: 'Unsorted',
    items: {
      'ground beef': { department: 'Meat, Poultry & Fish', subcategory: 'Beef & Veal' },
      'pasta': { department: 'Grocery', subcategory: 'Pasta, Rice & Grains' },
      'basil': { department: 'Fresh Produce', subcategory: 'Fresh Herbs' },
      'crushed red pepper': { department: 'Grocery', subcategory: 'Spices & Seasonings' },
      'red pepper': { department: 'Fresh Produce', subcategory: 'Fresh Vegetables' },
      'tomato': { department: 'Fresh Produce', subcategory: 'Fresh Vegetables' },
      'egg': { department: 'Dairy & Eggs', subcategory: 'Eggs' },
      'oil': { department: 'Grocery', subcategory: 'Oils & Vinegars' },
      'black pepper': { department: 'Grocery', subcategory: 'Spices & Seasonings' },
      'black pepper (plus 1/4 tsp more for the fish)': { department: 'Meat, Poultry & Fish', subcategory: 'Fish & Seafood' }
    } };
  globalThis.shoppingSections = fixtureSections;
  check('Section 23 (fallback): exact match still wins and is unchanged (ground beef -> Meat)',
    lookupShoppingSection('ground beef').department === 'Meat, Poultry & Fish');
  check('Section 23 (fallback): descriptive items map on shared words (fusilli pasta -> Grocery, basil leaf -> Fresh Produce, crushed dried red pepper -> Grocery/Spices, grape tomato -> Fresh Produce)',
    lookupShoppingSection('fusilli or other corkscrew pasta').department === 'Grocery' &&
    lookupShoppingSection('basil leaf').department === 'Fresh Produce' &&
    lookupShoppingSection('crushed dried red pepper').department === 'Grocery' &&
    lookupShoppingSection('crushed dried red pepper').subcategory === 'Spices & Seasonings' &&
    lookupShoppingSection('grape tomato').department === 'Fresh Produce');
  check('Section 23 (fallback): word boundaries only — eggplant does not match egg, boiled does not match oil',
    lookupShoppingSection('eggplant').department === 'Unsorted' &&
    lookupShoppingSection('boiled egg').department === 'Dairy & Eggs');
  check('Section 23 (fallback): clean entries beat note-carrying ones (spice blend -> black pepper in Grocery, not the fish-note entry)',
    lookupShoppingSection('garlic, hot paprika, cumin, coriander, and black pepper').department === 'Grocery');
  check('Section 23 (fallback): true unknowns still land in Unsorted (steamer, plain water)',
    lookupShoppingSection('steamer (equipment)').department === 'Unsorted' &&
    lookupShoppingSection('plain water').department === 'Unsorted');
  const liveMap = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shopping-sections.json'), 'utf8'));
  globalThis.shoppingSections = liveMap;
  check('Section 23 (map): migrated keys exist and mangled keys are gone (tomato, bay leaf present; tomatoe, bay leave, potatoe gone)',
    liveMap.items['tomato'] && liveMap.items['bay leaf'] && liveMap.items['potato'] &&
    !liveMap.items['tomatoe'] && !liveMap.items['bay leave'] && !liveMap.items['potatoe'] &&
    !liveMap.items['cherry tomatoe'] && !liveMap.items['fresh basil leave']);
  check('Section 23 (map): the screenshot items now sort right (mozzarella -> Dairy/Cheese, crushed San Marzano tomato -> Grocery/Canned, fusilli pasta -> Grocery, basil leaf -> Fresh Produce, crushed dried red pepper -> Grocery/Spices)',
    lookupShoppingSection('mozzarella').department === 'Dairy & Eggs' &&
    lookupShoppingSection('mozzarella').subcategory === 'Cheese' &&
    lookupShoppingSection('crushed san marzano tomato').department === 'Grocery' &&
    lookupShoppingSection('crushed san marzano tomato').subcategory === 'Canned Goods & Soups' &&
    lookupShoppingSection('fusilli or other corkscrew pasta').department === 'Grocery' &&
    lookupShoppingSection('basil leaf').department === 'Fresh Produce' &&
    lookupShoppingSection('crushed dried red pepper').department === 'Grocery');
  check('Section 23 (map): kishka and the steamer still land in Unsorted (no guess for them)',
    lookupShoppingSection('kishka').department === 'Unsorted' &&
    lookupShoppingSection('steamer (equipment)').department === 'Unsorted');
  geval(extractDecl('PANTRY_STAPLES'));
  geval(extract('isPantryStaple'));
  check('Section 23 (staples): plain water is a pantry staple, and water with a note still is (parenthetical stripped); coconut water is not',
    isPantryStaple('plain water') && isPantryStaple('water (maybe a little more)') && !isPantryStaple('coconut water'));
  check('Section 23 (staples): jerusalem mix and jerusalem spice are pantry staples (v20261115c)',
    isPantryStaple('jerusalem mix') && isPantryStaple('jerusalem spice'));

  // Section 24. Home counter counts only what is needed (v20261112d, Nov 15, 2026):
  // homeToBuyCount() is the To buy section (splitShopItems), not the raw
  // buildShoppingList() total — a purely-optional item doesn't count, a
  // promoted optional item does, and a partially-bought item counts its
  // remainder line. Fixture: the Section 21 burritos (1 required beans line,
  // 1 required lettuce line, 1 optional jalapeno) planned for dinner this week.
  setMeta([{ id: 'burritos', title: 'Burritos', kosher_status: 'meat', categories: ['main'], banner_image: 'images/burritos.jpg' }]);
  globalThis.byId = { burritos: { id: 'burritos', title: 'Burritos', ingredients: [
    { section: 'Beans (always)', items: [
      { qty: '1', unit: 'can', item: 'black or pinto beans (15 oz)' },
      { qty: '1', unit: '', item: 'jalapeno', prep: 'diced', optional: true }
    ] },
    { section: 'Fresh', items: [
      { qty: '1', unit: '', item: 'heart of romaine lettuce', prep: 'sliced thin' }
    ] }
  ] } };
  const wk24Days = blankDays();
  wk24Days[0].dinner.dishes = [{ recipe: 'burritos', drafted: false }];
  setPlan({ [thisWeekKey()]: { days: wk24Days, shoppingDay: thisWeekKey() } });
  const wk24 = getWeek(thisWeekKey());
  const jalKey = buildShoppingList().find(it => it.optional).key;
  check('Section 24 (home count): a purely-optional item does not count — burritos week tallies 2 (beans + lettuce), not 3 (jalapeno excluded)',
    homeToBuyCount() === 2);
  wk24.optionalPromoted = [{ key: jalKey, promotedAt: Date.now(), removedAt: null }];
  check('Section 24 (home count): a promoted optional item counts — promoting the jalapeno brings the tally to 3',
    homeToBuyCount() === 3);
  wk24.optionalPromoted = [];
  const beansIt = buildShoppingList().find(it => !it.optional && it.base.includes('bean'));
  wk24.haveGenerated = [{ key: beansIt.key, session: 'test', at: Date.now(), qty: 0.5, unit: 'can' }];
  check('Section 24 (home count): a partially-bought item counts its remainder line — half the beans marked have still leaves 2 (beans remainder + lettuce)',
    homeToBuyCount() === 2);
  wk24.haveGenerated = [];
  check('Section 24 (home count): the card matches the shopping page To buy section exactly, by construction (same splitShopItems split)',
    homeToBuyCount() === splitShopItems(buildShoppingList(), wk24).toBuy.length);

  // Section 25. Shopping-list ⋮ menu on every generated row (Feature 2, Nov 15, 2026).
  ['dismissShopKey', 'setPromoted', 'normalizePromotedList', 'mergePromoted',
   'normalizeHaveMarks', 'mergeHaveMarks', 'mergeManualItems', 'mergeWeekState',
   'setPriceHistoryCache', 'resetPriceHistorySession', 'ensurePriceHistoryLoaded']
    .forEach(n => geval(extract(n)));
  setPriceHistoryCache(null);

  setMeta([
    { id: 'burritos', title: 'Burritos', kosher_status: 'meat', categories: ['main'], banner_image: 'images/burritos.jpg' },
    { id: 'taco-salad', title: 'Taco Salad', kosher_status: 'meat', categories: ['main'], banner_image: 'images/tacos.jpg' }
  ]);
  globalThis.byId = {
    burritos: { id: 'burritos', title: 'Burritos', ingredients: [
      { section: 'Beans', items: [
        { qty: '2', unit: 'can', item: 'black or pinto beans (15 oz)' },
        { qty: '1', unit: '', item: 'jalapeno', prep: 'diced', optional: true }
      ] },
      { section: 'Fresh', items: [
        { qty: '1', unit: '', item: 'heart of romaine lettuce', prep: 'sliced thin' }
      ] }
    ] },
    'taco-salad': { id: 'taco-salad', title: 'Taco Salad', ingredients: [
      { section: 'Base', items: [
        { qty: '1', unit: '', item: 'heart of romaine lettuce', prep: 'chopped' },
        { qty: '1', unit: '', item: 'heart of romaine lettuce', prep: 'extra leaves' },
        { qty: '1', unit: '', item: 'avocado', optional: true }
      ] }
    ] }
  };
  const wk25Days = blankDays();
  wk25Days[0].dinner.dishes = [{ recipe: 'burritos', drafted: false }];
  wk25Days[1].dinner.dishes = [{ recipe: 'taco-salad', drafted: false }];
  setPlan({ [thisWeekKey()]: { days: wk25Days, shoppingDay: thisWeekKey() } });
  const wk25 = getWeek(thisWeekKey());
  const list25 = buildShoppingList();
  const lettuce25 = list25.find(it => !it.optional && it.base.includes('romaine'));
  const beans25 = list25.find(it => !it.optional && it.base.includes('bean'));
  const jal25 = list25.find(it => it.optional && it.base.includes('jalapeno'));
  check('Section 25 (sources): buildShoppingList tracks contributing recipe IDs in first-seen order without duplicates',
    !!lettuce25 && JSON.stringify(lettuce25.sources) === JSON.stringify(['burritos', 'taco-salad']) &&
    !!beans25 && JSON.stringify(beans25.sources) === JSON.stringify(['burritos']) &&
    !!jal25 && JSON.stringify(jal25.sources) === JSON.stringify(['burritos']));

  // Add one manual item and mark beans as Already have so all row types render
  wk25.manualItems = [{ id: 'm1', text: 'Paper towels', have: false, updatedAt: 100 }];
  wk25.haveGenerated = [{ key: beans25.key, session: 's1', at: 100 }];
  const html25 = shoppingListHTML();
  check('Section 25 (menu markup): To buy, Already have, and Optional generated rows render .shop-menu-btn (⋮) with From: <recipe> links, while manual rows have no ⋮ button',
    html25.includes('data-shop-menu="' + lettuce25.key + '"') &&
    html25.includes('data-shop-menu="' + beans25.key + '"') &&
    html25.includes('data-shop-menu="' + jal25.key + '"') &&
    !html25.includes('data-shop-menu="m1"') &&
    html25.includes('data-mandel="m1"') &&
    html25.includes('<a href="#/recipe/burritos">Burritos</a>, <a href="#/recipe/taco-salad">Taco Salad</a>'));
  check('Section 25 (menu options by section): Optional row menu includes Move to to buy, while To buy and Already-have row menus do not',
    html25.includes('data-shop-act="move-to-buy" data-shop-key="' + jal25.key + '"') &&
    !html25.includes('data-shop-act="move-to-buy" data-shop-key="' + lettuce25.key + '"') &&
    !html25.includes('data-shop-act="move-to-buy" data-shop-key="' + beans25.key + '"'));

  // Move to to buy on optional item uses setPromoted(week, key, true)
  wk25.manualItems = [];
  wk25.haveGenerated = [];
  setPromoted(wk25, jal25.key, true);
  const splitAfterPromote = splitShopItems(buildShoppingList(), wk25);
  check('Section 25 (Move to to buy): promoting an optional item moves it from optionalIts to toBuy and increments homeToBuyCount()',
    splitAfterPromote.toBuy.some(it => it.key === jal25.key) &&
    !splitAfterPromote.optionalIts.some(it => it.key === jal25.key) &&
    homeToBuyCount() === 3);

  // Dismissing a promoted optional item removes it from all sections while keeping its promotion record intact
  dismissShopKey(wk25, jal25.key);
  const splitAfterDismissPromoted = splitShopItems(buildShoppingList(), wk25);
  check('Section 25 (Delete promoted optional): dismissing a promoted optional item removes it from toBuy/haveIts/optionalIts for the week and drops homeToBuyCount() back to 2',
    !splitAfterDismissPromoted.toBuy.some(it => it.key === jal25.key) &&
    !splitAfterDismissPromoted.haveIts.some(it => it.key === jal25.key) &&
    !splitAfterDismissPromoted.optionalIts.some(it => it.key === jal25.key) &&
    promotedKeySet(wk25).has(jal25.key) &&
    homeToBuyCount() === 2);

  // Dismissing a required To buy item removes it from To buy and drops homeToBuyCount; returns on a fresh week object
  dismissShopKey(wk25, lettuce25.key);
  const splitAfterDismissReq = splitShopItems(buildShoppingList(), wk25);
  const freshWeekSplit = splitShopItems(buildShoppingList(), { days: wk25Days });
  check('Section 25 (Delete required & fresh week reset): dismissing a required item drops it from To buy and homeToBuyCount() (to 1), and a fresh week object restores all items',
    !splitAfterDismissReq.toBuy.some(it => it.key === lettuce25.key) &&
    homeToBuyCount() === 1 &&
    freshWeekSplit.toBuy.some(it => it.key === lettuce25.key) &&
    freshWeekSplit.toBuy.length === 2 &&
    freshWeekSplit.optionalIts.length === 2);

  // Merge week state unions dismissedShopKeys across devices without duplicates
  const mergedWk25 = mergeWeekState(
    { haveGenerated: [], manualItems: [], optionalPromoted: [], dismissedShopKeys: [lettuce25.key, jal25.key] },
    { haveGenerated: [], manualItems: [], optionalPromoted: [], dismissedShopKeys: [jal25.key, beans25.key] }
  );
  check('Section 25 (mergeWeekState): dismissedShopKeys merges as a deduplicated union across devices',
    JSON.stringify(mergedWk25.dismissedShopKeys) === JSON.stringify([lettuce25.key, jal25.key, beans25.key]));

  // Section 26. Receipt price history on the shopping list (Feature 3, Nov 15, 2026).
  wk25.dismissedShopKeys = [];
  wk25.optionalPromoted = [];
  wk25.manualItems = [{ id: 'm1', text: 'Paper towels', have: false, updatedAt: 100 }];
  wk25.haveGenerated = [{ key: beans25.key, session: 's1', at: 100 }];

  const receiptsCandidates = [
    path.join(__dirname, 'receipts.js'),
    path.join(SITE_DIR, 'receipts.js'),
    path.join(SITE_DIR, '..', 'bridge', 'receipts.js'),
    path.join(__dirname, '..', 'receipts.js')
  ];
  const receiptsPath = receiptsCandidates.find(p => fs.existsSync(p));
  const { pathToFileURL } = require('url');
  const receiptsMod = await import(pathToFileURL(receiptsPath).href);

  // 26(a) groupKey parity between app.js and receipts.js across -es/-ies plurals and the live recipe corpus
  // (In v20261115b Step 1, app.js adds head-noun singularization + ITEM_ALIASES while receipts.js stays on
  // git-v12; priceMatchFor bridges receipts.js group_keys via groupKey(k) + tail-singular tolerance.)
  const recipeDir26 = path.join(SITE_DIR, 'data', 'recipes');
  const recipeFiles26 = fs.existsSync(recipeDir26) ? fs.readdirSync(recipeDir26).filter(f => f.endsWith('.json')) : [];
  let corpusMismatches = 0;
  const legacyStripSize26 = s => {
    let out = ' ' + String(s || '').toLowerCase() + ' ';
    SIZE_WORDS.forEach(w => {
      out = out.replace(new RegExp(' ' + w.replace(/-/g, '[- ]').replace(/ /g, '\\s+') + ' ', 'g'), ' ');
    });
    return out.trim().replace(/^to\s+/i, '').replace(/\s+/g, ' ');
  };
  for (const rf of recipeFiles26) {
    const rj = JSON.parse(fs.readFileSync(path.join(recipeDir26, rf), 'utf8'));
    for (const sec of (rj.ingredients || [])) {
      for (const it of (sec.items || [])) {
        if (!it || !it.item) continue;
        const bk = groupKey(it.item);
        const rk = receiptsMod.groupKey(it.item);
        const gkFromRk = groupKey(rk);
        const bkTailSing = bk.replace(/\b(\w+)$/, (_, w) => singularizeWord(w));
        const rkTailSing = gkFromRk.replace(/\b(\w+)$/, (_, w) => singularizeWord(w));
        if (bk !== rk &&
            bk !== gkFromRk &&
            bkTailSing !== rkTailSing &&
            legacyStripSize26(bkTailSing) !== legacyStripSize26(rkTailSing)) {
          corpusMismatches++;
        }
      }
    }
  }
  check('Section 26 (groupKey parity): receipts.js groupKey matches app.js groupKey on -es/-ies plurals and bridges cleanly across all ' + recipeFiles26.length + ' live recipes (0 mismatches)',
    receiptsMod.groupKey('crushed san marzano tomatoes') === groupKey('crushed san marzano tomatoes') &&
    receiptsMod.groupKey('basil leaves') === groupKey('basil leaves') &&
    receiptsMod.groupKey('russet potatoes') === groupKey('russet potatoes') &&
    receiptsMod.groupKey('cranberries') === groupKey('cranberries') &&
    corpusMismatches === 0);

  // 26(b) Worker GET /price-history endpoint: verified-only filtering, last-vs-12m-average math, privacy fields, and empty state
  const mockReceiptRows = [
    // Verified purchases for romaine lettuce (4 purchases: 3 within 12 months, 1 older than 12 months)
    { status: 'verified', needs_review: 0, group_key: lettuce25.base, paid_price_cents: 299, store: 'Bingo', product_name: 'Romaine Hearts 3pk', raw_line: 'ROMAINE 3PK', receipt_date: '2026-11-10', receipt_id: 'r4', item_id: 40 },
    { status: 'verified', needs_review: 0, group_key: lettuce25.base, paid_price_cents: 349, store: 'NPGS', product_name: 'Romaine Hearts', raw_line: 'ROMAINE', receipt_date: '2026-10-15', receipt_id: 'r3', item_id: 30 },
    { status: 'verified', needs_review: 0, group_key: lettuce25.base, paid_price_cents: 319, store: 'Bingo', product_name: 'Romaine Hearts 3pk', raw_line: 'ROMAINE 3PK', receipt_date: '2026-08-01', receipt_id: 'r2', item_id: 20 },
    { status: 'verified', needs_review: 0, group_key: lettuce25.base, paid_price_cents: 199, store: 'Evergreen', product_name: 'Romaine Hearts', raw_line: 'ROMAINE', receipt_date: '2025-05-01', receipt_id: 'r1', item_id: 10 },
    // Single verified purchase for optional jalapeno (raw_line fallback when product_name is empty; avg12m_cents must be null)
    { status: 'verified', needs_review: 0, group_key: jal25.base, paid_price_cents: 89, store: 'Bingo', product_name: '', raw_line: 'JALAPENO PEPPER', receipt_date: '2026-11-08', receipt_id: 'r4', item_id: 41 },
    // Unverified receipt and needs_review item (must be excluded)
    { status: 'review', needs_review: 0, group_key: 'avocado', paid_price_cents: 150, store: 'Bingo', product_name: 'Hass Avocado', raw_line: 'AVOCADO', receipt_date: '2026-11-12', receipt_id: 'r5', item_id: 50 },
    { status: 'verified', needs_review: 1, group_key: 'avocado', paid_price_cents: 150, store: 'Bingo', product_name: 'Hass Avocado', raw_line: 'AVOCADO', receipt_date: '2026-11-12', receipt_id: 'r4', item_id: 42 }
  ];
  const makeMockEnv = rows => ({
    RECEIPTS_DB: {
      prepare() {
        return {
          all: async () => ({
            results: rows.filter(r =>
              r.status === 'verified' &&
              (r.needs_review === 0 || r.needs_review === null) &&
              r.paid_price_cents !== null &&
              r.group_key
            )
          })
        };
      }
    }
  });
  const phRes = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv(mockReceiptRows),
    { nowMs: new Date('2026-11-15T12:00:00Z').getTime() }
  );
  const phJson = await phRes.json();
  const romPrice = phJson.prices[lettuce25.base];
  const jalPrice = phJson.prices[jal25.base];
  check('Section 26 (worker /price-history): filters to verified non-needs_review items, computes newest price + last3 + 12-mo mean (null on single purchase), and strips private fields',
    phJson.ok === true &&
    !('avocado' in phJson.prices) &&
    !!romPrice &&
    romPrice.price_cents === 299 &&
    romPrice.store === 'Bingo' &&
    romPrice.bought_name === 'Romaine Hearts 3pk' &&
    romPrice.receipt_date === '2026-11-10' &&
    romPrice.avg12m_cents === Math.round((299 + 349 + 319) / 3) &&
    romPrice.last3.length === 3 &&
    JSON.stringify(romPrice.last3.map(x => x.price_cents)) === JSON.stringify([299, 349, 319]) &&
    Object.keys(romPrice).sort().join(',') === 'avg12m_cents,bought_name,by_store,last3,price_cents,receipt_date,store' &&
    Object.keys(romPrice.last3[0]).sort().join(',') === 'bought_name,price_cents,receipt_date,store' &&
    !!jalPrice &&
    jalPrice.price_cents === 89 &&
    jalPrice.bought_name === 'JALAPENO PEPPER' &&
    jalPrice.avg12m_cents === null &&
    jalPrice.last3.length === 1);

  const phEmptyRes = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv([]),
    { nowMs: new Date('2026-11-15T12:00:00Z').getTime() }
  );
  const phEmptyJson = await phEmptyRes.json();
  check('Section 26 (worker empty history): GET /price-history returns { ok: true, prices: {} } when no verified items exist',
    phEmptyJson.ok === true && JSON.stringify(phEmptyJson.prices) === '{}');

  // 26(c) Badge rendering, detail toggle markup, and estimated cart total in shoppingListHTML()
  // Place beans back in To buy (qty 2 cans) alongside romaine lettuce, plus an unpriced required item (tortillas)
  globalThis.byId.burritos.ingredients[0].items.push({ qty: '1', unit: 'pack', item: 'flour tortillas' });
  // Plus a PRICED pantry staple (sugar): it hides in the staples section when
  // the Hide-staples toggle is on, and must not count toward the cart total.
  // (Water was the original fixture here; water never reaches the list since
  // v20261115b, so the staple is sugar instead.)
  globalThis.byId.burritos.ingredients[1].items.push({ qty: '1', unit: 'tsp', item: 'sugar' });
  const sugar26 = buildShoppingList().find(it => it.base === 'sugar');
  const savedLocal26 = globalThis.localStorage;
  globalThis.localStorage = stubStorage({ 'recipe-hide-staples': '1' });
  wk25.haveGenerated = [];
  // Mark beans with a price too, and keep flour tortillas unpriced; add a manual item and mark a separate item have
  const pricedMap26 = {
    ...phJson.prices,
    [beans25.base]: {
      price_cents: 149,
      store: 'Bingo',
      bought_name: 'Goya Black Beans',
      receipt_date: '2026-11-08',
      avg12m_cents: null,
      last3: [{ price_cents: 149, store: 'Bingo', receipt_date: '2026-11-08' }]
    },
    [sugar26.base]: {
      price_cents: 100,
      store: 'Bingo',
      bought_name: 'Domino Sugar 4lb',
      receipt_date: '2026-11-09',
      avg12m_cents: null,
      last3: [{ price_cents: 100, store: 'Bingo', receipt_date: '2026-11-09' }]
    }
  };
  setPriceHistoryCache(pricedMap26);
  const html26 = shoppingListHTML();
  check('Section 26 (badges & detail): badges render on matched To buy and Optional rows with bought_name · $X.XX · store · Mon D, detail shows last3 and conditional 12-mo avg, and unmatched/manual/Already-have rows get no badge',
    html26.includes('Romaine Hearts 3pk · $2.99 · Bingo · Nov 10') &&
    html26.includes('Goya Black Beans · $1.49 · Bingo · Nov 8') &&
    html26.includes('JALAPENO PEPPER · $0.89 · Bingo · Nov 8') &&
    html26.includes('12-mo avg $3.22') &&
    !html26.includes('data-price-toggle="flour tortilla|pack"') &&
    !html26.includes('data-price-toggle="m1"'));

  // 26(d) Estimated cart total: 3 generated To buy lines (beans 2 cans @ $1.49, romaine @ $2.99, flour tortillas unpriced), plus 1 manual item (excluded from M) and 2 optional items (excluded from M)
  // Sum = $1.49 + $2.99 = $4.48 (one unit per line, NOT multiplied by 2 cans of beans), 2 of 3 items priced.
  // The priced sugar staple ($1.00) is hidden by the Hide-staples toggle: its badge still renders in the staples section, but it must NOT enter the sum or M — without the activeToBuy fix the total would read $5.48 · 3 of 4.
  check('Section 26 (estimated cart total): sums one unit per matched To buy line ($4.48) and reports 2 of 3 items priced (manual and optional items excluded from N and M)',
    html26.includes('Estimated total about $4.48 · 2 of 3 items priced'));
  check('Section 26 (estimated cart total): a priced pantry staple hidden by the Hide-staples toggle shows its badge but is excluded from the total (still $4.48 · 2 of 3, not $5.48 · 3 of 4)',
    html26.includes('Domino Sugar 4lb · $1.00 · Bingo · Nov 9') &&
    html26.includes('Estimated total about $4.48 · 2 of 3 items priced'));

  // Move beans to Already have: Already-have rows get NO badge, and cart total updates to $2.99 · 1 of 2 items priced
  wk25.haveGenerated = [{ key: beans25.key, session: 's1', at: 200 }];
  const html26Have = shoppingListHTML();
  check('Section 26 (Already have excluded): moving a priced item to Already have suppresses its badge and updates the cart total to $2.99 · 1 of 2 items priced',
    !html26Have.includes('Goya Black Beans · $1.49 · Bingo · Nov 8') &&
    html26Have.includes('Estimated total about $2.99 · 1 of 2 items priced'));

  globalThis.localStorage = savedLocal26;   // restore the Hide-staples toggle state

  // 26(e) Fetch failure renders cleanly without badges; one-shot session cache never refetches on subsequent calls
  const savedFetch26 = globalThis.fetch;
  let fetchCalls26 = 0;
  resetPriceHistorySession();
  globalThis.fetch = async () => { fetchCalls26++; throw new Error('network down'); };
  await ensurePriceHistoryLoaded();
  let htmlAfterFail = '';
  let failErr = null;
  try { htmlAfterFail = shoppingListHTML(); } catch (e) { failErr = e; }
  check('Section 26 (fetch failure): when /price-history rejects, shoppingListHTML renders cleanly with no badges and no error',
    !failErr && fetchCalls26 === 1 && !htmlAfterFail.includes('shop-price-badge') && !htmlAfterFail.includes('shop-est-total'));

  resetPriceHistorySession();
  fetchCalls26 = 0;
  globalThis.fetch = async () => {
    fetchCalls26++;
    return { ok: true, json: async () => phJson };
  };
  await ensurePriceHistoryLoaded();
  await ensurePriceHistoryLoaded();
  const htmlAfterOnce = shoppingListHTML();
  globalThis.fetch = savedFetch26;
  check('Section 26 (one-shot cache): ensurePriceHistoryLoaded fetches /price-history at most once per session and reuses the cached prices',
    fetchCalls26 === 1 && htmlAfterOnce.includes('Romaine Hearts 3pk · $2.99 · Bingo · Nov 10'));

  // Section 27. Draft chips save when tapped (Nov 15, 2026): the chip
  // bar used to write week.draftChips only inside runDraftWeek, so a
  // toggle changed the page and nothing else — refresh re-read the saved
  // chips and the box came back checked. Now every chip persists on tap
  // via persistDraftChips (the same persistWeek path as the shopping-day
  // change, no re-render). Fixture: week 2026-11-15 as the Nov 11 draft
  // left it — hosting Friday on — with a burritos dinner standing.
  const chipDOM = {
    fri: { checked: true },
    sat: { checked: false },
    eatOutActive: [{ dataset: { eatout: '0' } }, { dataset: { eatout: '5' } }]
  };
  globalThis.$ = sel => sel === '#draft-hosting-fri' ? chipDOM.fri
    : sel === '#draft-hosting-sat' ? chipDOM.sat : null;
  globalThis.document = { querySelectorAll: sel =>
    sel === '[data-eatout].active' ? chipDOM.eatOutActive : [] };
  globalThis.draftUseUp = ['spinach'];
  check('Section 27 (chips): readDraftChips reads the bar as shown — Friday on, Saturday off, eat-out days 0 and 5, use-up spinach',
    JSON.stringify(readDraftChips()) ===
    JSON.stringify({ hostingFri: true, hostingSat: false, eatOut: [0, 5], useUp: ['spinach'] }));
  globalThis.$ = () => null;
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.draftUseUp = [];
  check('Section 27 (chips): readDraftChips with no chip bar present reads all-off instead of throwing',
    JSON.stringify(readDraftChips()) ===
    JSON.stringify({ hostingFri: false, hostingSat: false, eatOut: [], useUp: [] }));
  // The regression: unchecking Friday must stick across a refresh.
  const wk27Days = blankDays();
  wk27Days[0].dinner.dishes = [{ recipe: 'burritos', drafted: true }];
  setPlan({ '2026-11-15': { days: wk27Days,
    draftChips: { hostingFri: true, hostingSat: false, eatOut: [], useUp: [] } } });
  chipDOM.fri.checked = false;   // the user unchecks Friday
  globalThis.$ = sel => sel === '#draft-hosting-fri' ? chipDOM.fri
    : sel === '#draft-hosting-sat' ? chipDOM.sat : null;
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.draftUseUp = [];
  await persistDraftChips('2026-11-15');
  check('Section 27 (chips): unchecking Friday persists — a fresh read of the saved week has hosting Friday off',
    serverState.weeks['2026-11-15'].draftChips.hostingFri === false);
  check('Section 27 (chips): the in-memory week agrees with the saved one',
    getWeek('2026-11-15').draftChips.hostingFri === false);
  check('Section 27 (chips): persisting chips does not clobber the week — the standing burritos dinner survives',
    serverState.weeks['2026-11-15'].days[0].dinner.dishes[0].recipe === 'burritos');
  // Eat-out and use-up chips persist the same way.
  chipDOM.eatOutActive = [{ dataset: { eatout: '2' } }];
  globalThis.document = { querySelectorAll: sel =>
    sel === '[data-eatout].active' ? chipDOM.eatOutActive : [] };
  await persistDraftChips('2026-11-15');
  check('Section 27 (chips): an eat-out day tapped on persists as eatOut [2]',
    JSON.stringify(serverState.weeks['2026-11-15'].draftChips.eatOut) === '[2]');
  globalThis.draftUseUp = ['kale'];
  await persistDraftChips('2026-11-15');
  check('Section 27 (chips): a use-up item added persists as useUp ["kale"]',
    JSON.stringify(serverState.weeks['2026-11-15'].draftChips.useUp) === '["kale"]');

  // Section 29. Orphaned leftover lunches are flagged, never auto-cleared
  // (tweak #1, v20261115a, Nov 15, 2026; Section 28 is reserved for the
  // store picker). Fixture: Sunday burritos dinner (beef variant, serves 4
  // -> 2 leftover servings) + Wednesday burrito-leftover lunch. Mon/Tue
  // lunches are skipped so the Sunday bucket survives to Wednesday.
  setMeta([{ id: 'burritos', title: 'Burritos', kosher_status: 'meat', categories: ['main'], servings: '4',
    variants: [
      { key: 'beef', label: 'Beef', default: true, slotClass: 'ground-beef' },
      { key: 'chicken', label: 'Chicken', slotClass: 'chicken' }
    ] }]);
  globalThis.byId = { burritos: { id: 'burritos', title: 'Burritos', servings: '4',
    variants: [
      { key: 'beef', label: 'Beef', default: true, slotClass: 'ground-beef' },
      { key: 'chicken', label: 'Chicken', slotClass: 'chicken' }
    ], ingredients: [] } };
  const K29 = thisWeekKey();
  const P29 = prevWeekKeyOf(K29);
  const orphanLunch = (over) => ({ recipe: 'burritos', variant: 'beef', leftovers: true,
    drafted: true, locked: false, reason: 'Leftovers from a dinner this week', ...(over || {}) });
  const mkOrphanWeek = (lunchDish) => {
    const days = blankDays();
    days[1].lunch.skipped = true;
    days[2].lunch.skipped = true;
    days[0].dinner.dishes = [{ recipe: 'burritos', variant: 'beef', drafted: false, locked: false }];
    days[3].lunch.dishes = [lunchDish];
    return days;
  };
  const warns29 = (wk) => (wk && Array.isArray(wk.lunchWarnings)) ? wk.lunchWarnings : [];
  // (a) The already-working case: a drafted, unlocked lunch is cleared with
  // its dinner and gets an uncovered warning (repro — must not regress).
  setPlan({ [K29]: { days: mkOrphanWeek(orphanLunch()), lunchWarnings: [] } });
  recomputeWeekLunches(K29);
  let wk29 = getWeek(K29);
  const covered29 = wk29.days[3].lunch.dishes.length === 1 &&
    wk29.days[3].lunch.dishes[0].recipe === 'burritos' &&
    !warns29(wk29).some(w => w.kind === 'orphan');
  wk29.days[0].dinner = blankSlot();
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  check('Section 29 (orphan a): dinner standing covers the drafted Wed lunch (no orphan); clearing the dinner clears the lunch + records uncovered',
    covered29 && wk29.days[3].lunch.dishes.length === 0 &&
    warns29(wk29).some(w => w.day === 3 && w.kind === 'uncovered'));
  // (b) The gap: a LOCKED lunch survives its dinner being cleared, flagged.
  setPlan({ [K29]: { days: mkOrphanWeek(orphanLunch({ locked: true })), lunchWarnings: [] } });
  wk29 = getWeek(K29);
  wk29.days[0].dinner = blankSlot();
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  check('Section 29 (orphan b): a locked leftover lunch survives its dinner being cleared, stamped orphan, with the warning + strip line + dish note',
    wk29.days[3].lunch.dishes.length === 1 &&
    wk29.days[3].lunch.dishes[0].orphan === true &&
    warns29(wk29).some(w => w.day === 3 && w.kind === 'orphan' && w.recipe === 'burritos' && w.variant === 'beef') &&
    planWarningsHTML(K29, wk29).includes('Wednesday lunch: Burritos · Beef leftovers have no dinner to come from') &&
    slotHTML(K29, 3, 'lunch', wk29.days[3].lunch, true, false).includes('No dinner to come from'));
  // (c) Carry-in is not an orphan: last week's Friday dinner feeds the lunch.
  const prev29 = blankDays();
  prev29[5].dinner.dishes = [{ recipe: 'burritos', variant: 'beef', drafted: false, locked: false }];
  setPlan({ [P29]: { days: prev29 }, [K29]: { days: mkOrphanWeek(orphanLunch({ locked: true })), lunchWarnings: [] } });
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  check('Section 29 (orphan c): a locked lunch fed by last week\'s Friday dinner (carry-in pool) is NOT an orphan',
    wk29.days[3].lunch.dishes.length === 1 &&
    wk29.days[3].lunch.dishes[0].orphan !== true &&
    !warns29(wk29).some(w => w.kind === 'orphan'));
  // (d) Variant mismatch is an orphan: only a beef dinner existed, the lunch
  // is chicken-variant leftovers — flagged even while the beef dinner stands.
  setPlan({ [K29]: { days: mkOrphanWeek(orphanLunch({ variant: 'chicken', locked: true })), lunchWarnings: [] } });
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  const mismatchBefore29 = warns29(wk29).some(w => w.kind === 'orphan' && w.variant === 'chicken');
  wk29.days[0].dinner = blankSlot();
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  check('Section 29 (orphan d): a chicken-variant lunch is an orphan when only the beef dinner existed (flagged before and after the dinner is cleared)',
    mismatchBefore29 && wk29.days[3].lunch.dishes.length === 1 &&
    wk29.days[3].lunch.dishes[0].orphan === true &&
    warns29(wk29).some(w => w.day === 3 && w.kind === 'orphan' && w.recipe === 'burritos' && w.variant === 'chicken'));
  // (e) Clearing the orphan clears the flag.
  setPlan({ [K29]: { days: mkOrphanWeek(orphanLunch({ locked: true })), lunchWarnings: [] } });
  wk29 = getWeek(K29);
  wk29.days[0].dinner = blankSlot();
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  const flagged29 = warns29(wk29).some(w => w.kind === 'orphan');
  wk29.days[3].lunch.dishes.splice(0, 1); // slot-editor save removes the dish
  recomputeWeekLunches(K29);
  wk29 = getWeek(K29);
  check('Section 29 (orphan e): removing the orphaned dish drops the orphan warning (flagged before removal, gone after)',
    flagged29 && !warns29(wk29).some(w => w.kind === 'orphan') &&
    wk29.days[3].lunch.dishes.length === 0);

  // Section 30. Shopping List Step 1 logic fixes (v20261115b, Nov 15, 2026):
  // groupKey head-noun singularization + ITEM_ALIASES, canonicalUnit,
  // two-pass buildShoppingList with unit buckets + no-qty attach, label guard
  // (pluralize skipped when unit present, displayHead preserved), range bounds
  // + fromTsp clean kitchen units, splitShopItems hardening + mark migration
  // + TSP_PER unit conversion, and stock/broth section routing.

  // 30(1) groupKey head-noun singularization + note immunity
  check('Section 30 (groupKey head-noun + note immunity): singularizes head noun before parentheticals/commas/semicolons and leaves trailing notes untouched ("matters" stays "matters")',
    groupKey('black or pinto beans (15 oz)') === 'black or pinto bean (15 oz)' &&
    groupKey('fresh brussel sprouts') === 'fresh brussel sprout' &&
    groupKey('cumin seeds') === 'cumin seed' &&
    groupKey('black pepper (plus 1/4 tsp more for the fish)') === 'black pepper (plus 1/4 tsp more for the fish)' &&
    groupKey('gochujang (Korean red chili paste); check label if gluten free matters') === 'gochujang (korean red chili paste); check label if gluten free matters');

  // 30(2) groupKey ITEM_ALIASES and held-out items
  check('Section 30 (groupKey ITEM_ALIASES): canonicalizes lemon/lime juice and black pepper aliases and merges plain salt into kosher salt, while keeping held-out items distinct',
    groupKey('fresh lemon juice') === 'lemon juice' &&
    groupKey('fresh lime juice') === 'lime juice' &&
    groupKey('freshly ground black pepper') === 'black pepper' &&
    groupKey('ground black pepper') === 'black pepper' &&
    groupKey('freshly cracked black pepper') === 'black pepper' &&
    groupKey('salt') === 'kosher salt' &&
    groupKey('fresh parsley') === 'fresh parsley' &&
    groupKey('kosher salt') === 'kosher salt' &&
    groupKey('jerusalem spice') === 'jerusalem spice' &&
    groupKey('cumin seeds') !== groupKey('cumin'));

  // 30(3) canonicalUnit + garlic cloves merge (6 cloves + 1 clove -> 7 cloves garlic, key garlic|clove)
  const K30 = thisWeekKey();
  setMeta([
    { id: 'r30-a', title: 'Recipe A', kosher_status: 'pareve', categories: ['main'], servings: '4' },
    { id: 'r30-b', title: 'Recipe B', kosher_status: 'pareve', categories: ['main'], servings: '4' }
  ]);
  globalThis.byId = {
    'r30-a': {
      id: 'r30-a', title: 'Recipe A', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '6', unit: 'cloves', item: 'garlic' },
        { qty: '1', unit: 'tbsp', item: 'lemon juice' },
        { qty: '', unit: '', item: 'lemon juice' },
        { qty: '1 1/2', unit: 'tsp', item: 'salt' }
      ] }]
    },
    'r30-b': {
      id: 'r30-b', title: 'Recipe B', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1', unit: 'clove', item: 'garlic' },
        { qty: '1', unit: 'Tbsp', item: 'fresh lemon juice' },
        { qty: '', unit: '', item: 'fresh lemon juice' },
        { qty: '', unit: '', item: 'salt' }
      ] }]
    }
  };
  const days30 = blankDays();
  days30[0].dinner.dishes = [{ recipe: 'r30-a' }];
  days30[1].dinner.dishes = [{ recipe: 'r30-b' }];
  setPlan({ [K30]: { days: days30 } });
  const list30a = buildShoppingList();
  const garlicCloves30 = list30a.filter(it => it.base === 'garlic');
  check('Section 30 (canonicalUnit & garlic merge): 6 cloves (unit "cloves") + 1 clove (unit "clove") merge into one "7 cloves garlic" row with key "garlic|clove", and COUNT_TO_TSP has no garlic entry',
    canonicalUnit('cloves') === 'clove' &&
    canonicalUnit('cans') === 'can' &&
    canonicalUnit('Tbsp') === 'tbsp' &&
    canonicalUnit('tablespoons') === 'tbsp' &&
    canonicalUnit('teaspoons') === 'tsp' &&
    canonicalUnit('lbs') === 'lb' &&
    canonicalUnit('pounds') === 'lb' &&
    canonicalUnit('ounces') === 'oz' &&
    COUNT_TO_TSP.garlic === undefined &&
    garlicCloves30.length === 1 &&
    garlicCloves30[0].label === '7 cloves garlic' &&
    garlicCloves30[0].key === 'garlic|clove' &&
    garlicCloves30[0].qty === 7);

  // 30(4) No-qty attachment + multi-bucket join
  const lemonRows30 = list30a.filter(it => it.base === 'lemon juice');
  const saltRows30 = list30a.filter(it => it.base === 'kosher salt');
  globalThis.byId['r30-b'].ingredients[0].items.push({ qty: '2', unit: 'teaspoons', item: 'garlic' });
  const list30Multi = buildShoppingList();
  const garlicMulti30 = list30Multi.filter(it => it.base === 'garlic');
  check('Section 30 (no-qty attachment & multi-bucket join): 1 tbsp lemon juice + 1 tbsp fresh lemon juice + two no-qty lemon juice lines -> ONE "2 tbsp lemon juice" line; 1½ tsp salt + no-qty salt -> ONE "1½ tsp kosher salt" line; 7 cloves + 2 tsp garlic -> ONE "7 cloves + 2 tsp garlic" line',
    lemonRows30.length === 1 &&
    lemonRows30[0].label === '2 tbsp lemon juice' &&
    lemonRows30[0].key === 'lemon juice|tbsp' &&
    lemonRows30[0].qty === 2 &&
    JSON.stringify(lemonRows30[0].sources) === JSON.stringify(['r30-a', 'r30-b']) &&
    saltRows30.length === 1 &&
    saltRows30[0].label === '1½ tsp kosher salt' &&
    garlicMulti30.length === 1 &&
    garlicMulti30[0].label === '7 cloves + 2 tsp garlic' &&
    garlicMulti30[0].key === 'garlic|clove' &&
    garlicMulti30[0].qty === 7);

  // 30(5) Label inflection + brand casing preserved
  globalThis.byId = {
    'r30-a': {
      id: 'r30-a', title: 'Recipe A', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1', unit: 'lb', item: 'fresh brussel sprouts' },
        { qty: '1', unit: 'can', item: 'black beans (15 oz)' },
        { qty: '1', unit: 'can', item: 'black or pinto beans (15 oz)' },
        { qty: '1/4', unit: 'tsp', item: 'cumin seeds' },
        { qty: '1 1/2', unit: 'lbs', item: 'pargiot (dark chicken cutlets)' },
        { qty: '1', unit: 'tbsp', item: 'mustard (Grey Poupon Dijon)' },
        { qty: '1', unit: 'packet', item: 'Ortega taco seasoning' },
        { qty: '2', unit: '', item: 'tomatoes' }
      ] }]
    },
    'r30-b': {
      id: 'r30-b', title: 'Recipe B', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '2', unit: '', item: 'tomatoes' }
      ] }]
    }
  };
  const days30b = blankDays();
  days30b[0].dinner.dishes = [{ recipe: 'r30-a', scale: 1 }];
  setPlan({ [K30]: { days: days30b } });
  const list30b = buildShoppingList();
  const labels30b = list30b.map(it => it.label);
  const days30c = blankDays();
  days30c[0].dinner.dishes = [{ recipe: 'r30-b', scale: 0.5 }];
  setPlan({ [K30]: { days: days30c } });
  const list30c = buildShoppingList();
  check('Section 30 (label inflection & brand casing): unit-bearing lines preserve displayHead ("1 lb fresh brussel sprouts", "1 can black beans (15 oz)", "1 can black or pinto beans (15 oz)", "¼ tsp cumin seeds", "1½ lb pargiot (dark chicken cutlets)", "Grey Poupon Dijon", "Ortega") while unitless tomatoes inflect ("2 tomatoes" vs "1 tomato")',
    labels30b.includes('1 lb fresh brussel sprouts') &&
    labels30b.includes('1 can black beans (15 oz)') &&
    labels30b.includes('1 can black or pinto beans (15 oz)') &&
    labels30b.includes('¼ tsp cumin seeds') &&
    labels30b.includes('1½ lb pargiot (dark chicken cutlets)') &&
    labels30b.includes('1 tbsp mustard (Grey Poupon Dijon)') &&
    labels30b.includes('1 packet Ortega taco seasoning') &&
    labels30b.includes('2 tomatoes') &&
    list30c.some(it => it.label === '1 tomato'));

  // 30(6) fromTsp clean kitchen units
  globalThis.byId = {
    'r30-a': {
      id: 'r30-a', title: 'Recipe A', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '3 1/2', unit: 'tsp', item: 'kosher salt' },
        { qty: '4', unit: 'tsp', item: 'cornstarch' },
        { qty: '15', unit: 'tbsp', item: 'olive oil' },
        { qty: '25', unit: 'tsp', item: 'milk' },
        { qty: '17 1/2', unit: 'tsp', item: 'honey' }
      ] }]
    }
  };
  setPlan({ [K30]: { days: days30b } });
  const list30Units = buildShoppingList();
  const unitLabels30 = list30Units.map(it => it.label);
  const ft16 = fromTsp(16);
  check('Section 30 (fromTsp clean units): renders "3½ tsp kosher salt", "4 tsp cornstarch", "¾ cup + 3 tbsp olive oil" (45 tsp decomposed), "½ cup + 1 tsp milk" and "⅓ cup + 1½ tsp honey" for non-clean totals, and 16 tsp -> "⅓ cup"',
    unitLabels30.includes('3½ tsp kosher salt') &&
    unitLabels30.includes('4 tsp cornstarch') &&
    unitLabels30.includes('¾ cup + 3 tbsp olive oil') &&
    unitLabels30.includes('½ cup + 1 tsp milk') &&
    unitLabels30.includes('⅓ cup + 1½ tsp honey') &&
    Math.abs(ft16.qty - 16 / 48) < 1e-6 && ft16.unit === 'cup' && fmtQty(ft16.qty) === '⅓');

  // 30(7) Ranges
  globalThis.byId = {
    'r30-a': {
      id: 'r30-a', title: 'Recipe A', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '2-4', unit: 'tsp', item: 'Sriracha chili sauce' }
      ] }]
    }
  };
  setPlan({ [K30]: { days: days30b } });
  const list30d = buildShoppingList();
  const sriracha30 = list30d.find(it => it.base === 'sriracha chili sauce');
  check('Section 30 (ranges): "2-4 tsp Sriracha chili sauce" shows the HIGH end only as "4 tsp Sriracha chili sauce" (never "1⅜ tbsp", never "2–4 tsp") with numeric qty = 4',
    !!sriracha30 &&
    sriracha30.label === '4 tsp Sriracha chili sauce' &&
    sriracha30.qty === 4 &&
    sriracha30.unit === 'tsp');

  // 30(8) Departments (stocks/broths -> Grocery > Canned Goods & Soups; water stays Unsorted)
  const savedSections30 = globalThis.shoppingSections;
  globalThis.shoppingSections = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shopping-sections.json'), 'utf8'));
  const secCs = lookupShoppingSection('chicken stock');
  const secVs = lookupShoppingSection('vegetable stock');
  const secCsvs = lookupShoppingSection('chicken stock or vegetable stock');
  const secBs = lookupShoppingSection('beef stock');
  const secCb = lookupShoppingSection('chicken broth');
  const secDs = lookupShoppingSection('duck stock');
  const secWater = lookupShoppingSection('water');
  globalThis.shoppingSections = savedSections30;
  check('Section 30 (departments): chicken stock, vegetable stock, chicken stock or vegetable stock, beef stock, chicken broth, and fallback duck stock route to Grocery > Canned Goods & Soups, while water stays Unsorted',
    secCs.department === 'Grocery' && secCs.subcategory === 'Canned Goods & Soups' &&
    secVs.department === 'Grocery' && secVs.subcategory === 'Canned Goods & Soups' &&
    secCsvs.department === 'Grocery' && secCsvs.subcategory === 'Canned Goods & Soups' &&
    secBs.department === 'Grocery' && secBs.subcategory === 'Canned Goods & Soups' &&
    secCb.department === 'Grocery' && secCb.subcategory === 'Canned Goods & Soups' &&
    secDs.department === 'Grocery' && secDs.subcategory === 'Canned Goods & Soups' &&
    secWater.department === 'Unsorted');

  // 30(9) Backward compat & splitShopItems hardening:
  // - 2 cups -> 1 cup have + 1 cup need renders "1 cup" (never "1 cups"), with .qty and .unit on both
  // - 3 cans -> 1 can have + 2 cans need renders "1 can" and "2 cans"
  // - old keys garlic|cloves and black or pinto beans (15 oz)|can match via canonicalShopKey
  // - old mark saved as 1.33 tbsp sriracha covers a 4 tsp item fully (no phantom remainder)
  const split30Cup = splitShopItems([
    { key: 'rice|cup', base: 'rice', displayHead: 'rice', label: '2 cups rice', qty: 2, unit: 'cups', rawUnit: 'cup', optional: false, sources: ['r30-a'], department: 'Grocery', subcategory: 'Grains, Rice & Dried', deptIndex: 4 }
  ], {
    haveGenerated: [{ key: 'rice|cup', qty: 1, unit: 'cup', session: 's1', at: 100 }]
  });
  const split30Can = splitShopItems([
    { key: 'black or pinto bean (15 oz)|can', base: 'black or pinto bean (15 oz)', displayHead: 'black or pinto beans (15 oz)', label: '3 cans black or pinto beans (15 oz)', qty: 3, unit: 'cans', rawUnit: 'can', optional: false, sources: ['r30-a'], department: 'Grocery', subcategory: 'Canned Goods & Soups', deptIndex: 4 }
  ], {
    haveGenerated: [{ key: 'black or pinto beans (15 oz)|can', qty: 1, unit: 'can', session: 's1', at: 100 }]
  });
  const split30Garlic = splitShopItems([
    { key: 'garlic|clove', base: 'garlic', displayHead: 'garlic', label: '7 cloves garlic', qty: 7, unit: 'cloves', rawUnit: 'clove', optional: false, sources: ['r30-a'], department: 'Fresh Produce', subcategory: 'Fresh Vegetables', deptIndex: 0 }
  ], {
    haveGenerated: [{ key: 'garlic|cloves', qty: 2, unit: 'cloves', session: 's1', at: 100 }]
  });
  const split30Sriracha = splitShopItems([
    { key: 'sriracha chili sauce|tsp', base: 'sriracha chili sauce', displayHead: 'Sriracha chili sauce', label: '4 tsp Sriracha chili sauce', qty: 4, unit: 'tsp', rawUnit: 'tsp', optional: false, sources: ['r30-a'], department: 'Grocery', subcategory: 'Condiments & Sauces', deptIndex: 4 }
  ], {
    haveGenerated: [{ key: 'sriracha chili sauce|tbsp', qty: 1.33, unit: 'tbsp', session: 's1', at: 100 }]
  });
  check('Section 30 (backward compat & splitShopItems): 2 cups -> 1 cup have + 1 cup need renders "1 cup" (never "1 cups"); old keys (garlic|cloves, black or pinto beans (15 oz)|can) match via canonicalShopKey; 1.33 tbsp sriracha mark covers 4 tsp item fully',
    split30Cup.haveIts.length === 1 &&
    split30Cup.haveIts[0].label === '1 cup rice' &&
    split30Cup.haveIts[0].qty === 1 &&
    split30Cup.haveIts[0].unit === 'cup' &&
    split30Cup.toBuy.length === 1 &&
    split30Cup.toBuy[0].label === '1 cup rice' &&
    split30Cup.toBuy[0].qty === 1 &&
    split30Cup.toBuy[0].unit === 'cup' &&
    split30Can.haveIts.length === 1 &&
    split30Can.haveIts[0].label === '1 can black or pinto beans (15 oz)' &&
    split30Can.toBuy.length === 1 &&
    split30Can.toBuy[0].label === '2 cans black or pinto beans (15 oz)' &&
    split30Garlic.haveIts.length === 1 &&
    split30Garlic.haveIts[0].label === '2 cloves garlic' &&
    split30Garlic.toBuy.length === 1 &&
    split30Garlic.toBuy[0].label === '5 cloves garlic' &&
    split30Sriracha.haveIts.length === 1 &&
    split30Sriracha.toBuy.length === 0);

  // 30(10) Water never appears on the shopping list (Yidi, Nov 15, 2026)
  globalThis.byId = {
    'r30-a': {
      id: 'r30-a', title: 'Recipe A', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1', unit: 'cup', item: 'water' },
        { qty: '2', unit: 'tbsp', item: 'plain water' },
        { qty: '1', unit: 'tsp', item: 'kosher salt' }
      ] }]
    }
  };
  setPlan({ [K30]: { days: days30b } });
  const list30Water = buildShoppingList();
  check('Section 30 (water exclusion): water and plain water never appear on the shopping list, while other items still build',
    !list30Water.some(it => it.base === 'water' || it.base === 'plain water') &&
    list30Water.some(it => it.base === 'kosher salt'));

  // ---------------------------------------------------------------------------
  // 31. Shopping-list fixes v20261115c+ (Nov 15, 2026): L1–L7
  // ---------------------------------------------------------------------------
  // 31(1) L1 — Replay exact live marks across 3 sessions (garlic 3 marks, mayo cup+tbsp,
  // sriracha tbsp mark vs tsp row, beans plural mark vs singular row, gochujang matter vs matters)
  const live36Marks = [
    { key: 'garlic|clove', session: 'smwi093dx8q78cg', at: 1794757525277, qty: 1, unit: 'clove', removed: true },
    { key: 'flour tortilla|', session: 'smwi0rpb9p8c03b', at: 1794758328549, qty: 4, unit: '' },
    { key: 'gluten free breadcrumbs (or regular breadcrumbs)|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758332789, qty: 3, unit: 'tbsp' },
    { key: 'garlic|clove', session: 'smwi0rpb9p8c03b', at: 1794758454127, qty: 1, unit: 'clove' },
    { key: 'parsley|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758507434, qty: 1, unit: 'tbsp' },
    { key: 'black or pinto beans (15 oz)|can', session: 'smwi0rpb9p8c03b', at: 1794758607945, qty: 1, unit: 'can' },
    { key: 'mayonnaise|cup', session: 'smwi0rpb9p8c03b', at: 1794758608673, qty: 1, unit: 'cup' },
    { key: 'hot sauce|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758609282, qty: 1, unit: 'tbsp' },
    { key: 'mustard (grey poupon dijon)|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758610907, qty: 1, unit: 'tbsp' },
    { key: 'ortega taco seasoning|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758612042, qty: 1, unit: 'tbsp' },
    { key: 'rice vinegar|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758612814, qty: 1, unit: 'tbsp' },
    { key: 'tamari or soy sauce|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758614849, qty: 1, unit: 'tbsp' },
    { key: 'toasted sesame oil|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758615940, qty: 1, unit: 'tbsp' },
    { key: 'tomato paste|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758618254, qty: 1, unit: 'tbsp' },
    { key: 'vinegar|cup', session: 'smwi0rpb9p8c03b', at: 1794758622109, qty: 0.5, unit: 'cup' },
    { key: 'gochujang (korean red chili paste); check label if gluten free matter|cup', session: 'smwi0rpb9p8c03b', at: 1794758623255, qty: 0.25, unit: 'cup' },
    { key: 'low sodium tamari or soy sauce|cup', session: 'smwi0rpb9p8c03b', at: 1794758628797, qty: 0.25, unit: 'cup' },
    { key: 'cumin seed|tsp', session: 'smwi0rpb9p8c03b', at: 1794758629834, qty: 0.25, unit: 'tsp' },
    { key: 'sriracha chili sauce|tbsp', session: 'smwi0rpb9p8c03b', at: 1794758631234, qty: 1.33, unit: 'tbsp' },
    { key: 'heart of romaine lettuce|', session: 'smwi7tm67j1bo6b', at: 1794770175103, qty: 1, unit: '' },
    { key: 'chicken stock or vegetable stock|cup', session: 'smwi7tm67j1bo6b', at: 1794770217943, qty: 1, unit: 'cup' },
    { key: 'onion soup mix (a good amount, sprinkled)|', session: 'smwi7tm67j1bo6b', at: 1794770225404 },
    { key: 'ground beef|lb', session: 'smwi7tm67j1bo6b', at: 1794770230879, qty: 1, unit: 'lb' },
    { key: 'cornflake crumb|cup', session: 'smwi7tm67j1bo6b', at: 1794770301144, qty: 0.25, unit: 'cup' },
    { key: 'purple onion|', session: 'smwi7tm67j1bo6b', at: 1794770383645, qty: 1, unit: '' },
    { key: 'shallot|', session: 'smwi7tm67j1bo6b', at: 1794770384695, qty: 1, unit: '' },
    { key: 'carrot|', session: 'smwi7tm67j1bo6b', at: 1794770462018, qty: 2, unit: '' },
    { key: 'tomato|', session: 'smwi7tm67j1bo6b', at: 1794770480124, qty: 2, unit: '' },
    { key: 'dried tomato or tomato|', session: 'smwi7tm67j1bo6b', at: 1794770496908, qty: 1, unit: '' },
    { key: 'fresh ginger|tsp', session: 'smwi7tm67j1bo6b', at: 1794770508322, qty: 1, unit: 'tsp' },
    { key: 'dried plum (prunes)|', session: 'smwi7tm67j1bo6b', at: 1794770513579, qty: 3, unit: '' },
    { key: 'lime juice|tsp', session: 'smwi7tm67j1bo6b', at: 1794770515879, qty: 2, unit: 'tsp' },
    { key: 'lemon juice|tbsp', session: 'smwi7tm67j1bo6b', at: 1794770516790, qty: 2, unit: 'tbsp' },
    { key: 'onion|cup', session: 'smwi7tm67j1bo6b', at: 1794770548350, qty: 0.5, unit: 'cup' },
    { key: 'garlic|clove', session: 'smwi7tm67j1bo6b', at: 1794770568328, qty: 7, unit: 'cloves' },
    { key: 'dried parsley|tsp', session: 'smwi7tm67j1bo6b', at: 1794770565981, qty: 0.5, unit: 'tsp' }
  ];
  globalThis.byId = {
    'r31-a': {
      id: 'r31-a', title: 'Live Replay Fixture', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1', unit: 'clove', item: 'garlic' },
        { qty: '6', unit: 'cloves', item: 'garlic' },
        { qty: '2', unit: 'tsp', item: 'garlic' },
        { qty: '1/2', unit: 'cup', item: 'mayonnaise' },
        { qty: '1/2', unit: 'cup', item: 'mayonnaise' },
        { qty: '1', unit: 'tbsp', item: 'mayonnaise' },
        { qty: '2-4', unit: 'tsp', item: 'Sriracha chili sauce' },
        { qty: '1', unit: 'can', item: 'black or pinto beans (15 oz)' },
        { qty: '1/4', unit: 'cup', item: 'gochujang (Korean red chili paste); check label if gluten free matters' },
        { qty: '1', unit: null, item: 'onion' }
      ] }]
    }
  };
  const days31 = blankDays();
  days31[0].dinner.dishes = [{ recipe: 'r31-a', drafted: false }];
  // Pre-tap state: garlic only has session A tombstone + session B qty:1 mark (so garlic is split 1 clove have / 6 cloves + 2 tsp need)
  const preTapMarks = live36Marks.filter(m => !(m.key === 'garlic|clove' && m.session === 'smwi7tm67j1bo6b'));
  setPlan({ [K30]: { days: days31, shoppingDay: K30, haveGenerated: JSON.parse(JSON.stringify(preTapMarks)) } });
  const preSplit31 = splitShopItems(buildShoppingList(), getWeek(K30));
  // Check mayo partial split with only the mayonnaise|cup (1 cup = 16 tbsp) mark present: 16 tbsp have / 1 tbsp need
  const mayoPreHave = preSplit31.haveIts.find(it => it.base === 'mayonnaise');
  const mayoPreNeed = preSplit31.toBuy.find(it => it.base === 'mayonnaise');
  check('Section 31 (L1 iv — mayo cup-mark partial split): mayonnaise|cup (qty 1) matches 1 cup + 1 tbsp mayonnaise and splits into "16 tbsp mayonnaise" (have) and "1 tbsp mayonnaise" (need)',
    !!mayoPreHave && mayoPreHave.label === '16 tbsp mayonnaise' &&
    !!mayoPreNeed && mayoPreNeed.label === '1 tbsp mayonnaise');

  // Now simulate tapping the garlic need-row in session smwi7tm67j1bo6b via the real renderShopping click listener
  ['activeHaveMarks', 'getSessionId', 'renderShopWrap', 'shoppingFromLabel', 'renderShopping']
    .forEach(n => geval(extract(n)));
  globalThis.helpLinkHTML = () => '';
  globalThis.ensurePlannedRecipes = async () => {};
  globalThis.startShopPoll = () => {};
  globalThis.stopShopPoll = () => {};
  globalThis.markShopDirty = () => { saveShopLocal(); };
  const savedSession31 = globalThis.sessionStorage;
  const savedDollar31 = globalThis.$;
  globalThis.sessionStorage = stubStorage({ 'shop-session': 'smwi7tm67j1bo6b' });
  let shopClickHandler31 = null;
  const shopWrap31 = {
    innerHTML: '',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(ev, fn) { if (ev === 'click') shopClickHandler31 = fn; }
  };
  const shopApp31 = {
    innerHTML: '',
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  globalThis.$ = sel => (sel === '#shop-wrap' ? shopWrap31 : null);
  await renderShopping(shopApp31);
  const tapShopRow = (shopKey, splitAttr) => {
    const expectedAttr = 'data-shop="' + shopKey + '"' + (splitAttr ? ' data-shop-split="' + splitAttr + '"' : '');
    if (!shopWrap31.innerHTML.includes(expectedAttr)) return false;
    const itemNode = {
      dataset: Object.assign({ shop: shopKey }, splitAttr ? { shopSplit: splitAttr } : {}),
      closest(s) { return s === '[data-shop]' ? itemNode : null; }
    };
    const btnNode = {
      closest(s) {
        if (s === '.shop-have-btn') return btnNode;
        if (s === '[data-shop]') return itemNode;
        return null;
      }
    };
    shopClickHandler31({ target: btnNode });
    return true;
  };
  const tappedNeed = tapShopRow('garlic|clove', 'need');
  const postNeedSplit31 = splitShopItems(buildShoppingList(), getWeek(K30));
  check('Section 31 (L1 i — need-row tap on garlic): tapping need-row clears garlic from To Buy and places full row in Already Have (newest mark beats stale session B qty-1 mark)',
    tappedNeed &&
    !postNeedSplit31.toBuy.some(it => it.base === 'garlic') &&
    postNeedSplit31.haveIts.filter(it => it.base === 'garlic').length === 1 &&
    postNeedSplit31.haveIts.find(it => it.base === 'garlic').label === '7 cloves + 2 tsp garlic');

  // Now tap the garlic have-row to move it back to To Buy
  const tappedHave = tapShopRow('garlic|clove', null);
  const postUncheckSplit31 = splitShopItems(buildShoppingList(), getWeek(K30));
  check('Section 31 (L1 ii — have-row tap on garlic): tapping have-row tombstones all sessions and moves full garlic row back to To Buy',
    tappedHave &&
    postUncheckSplit31.toBuy.filter(it => it.base === 'garlic').length === 1 &&
    !postUncheckSplit31.haveIts.some(it => it.base === 'garlic'));

  // Simulate a late-arriving remote mark from another session (older timestamp than the uncheck tombstone)
  const uncheckTs = Math.max(...getWeek(K30).haveGenerated.filter(m => m.key === 'garlic|clove' && m.removed).map(m => m.at || 0));
  const lateRemoteMarks = [{ key: 'garlic|clove', session: 'nava-phone-late', at: uncheckTs - 5000, qty: 7, unit: 'cloves' }];
  getWeek(K30).haveGenerated = mergeHaveMarks(getWeek(K30).haveGenerated, lateRemoteMarks);
  const afterLateSyncSplit31 = splitShopItems(buildShoppingList(), getWeek(K30));
  check('Section 31 (L1 iii — key-level uncheck survives late remote sync): a remote mark with older timestamp arriving after uncheck is suppressed and does NOT resurrect garlic',
    afterLateSyncSplit31.toBuy.filter(it => it.base === 'garlic').length === 1 &&
    !afterLateSyncSplit31.haveIts.some(it => it.base === 'garlic'));

  // Test L1(v): unchecking rows whose mark key differs (sriracha|tbsp vs sriracha|tsp, beans plural vs singular, gochujang matter vs matters)
  renderShopWrap();
  const tappedSriracha = tapShopRow('sriracha chili sauce|tsp', null);
  const tappedBeans = tapShopRow('black or pinto bean (15 oz)|can', null);
  const tappedGoch = tapShopRow('gochujang (korean red chili paste); check label if gluten free matters|cup', null);
  globalThis.sessionStorage = savedSession31;
  globalThis.$ = savedDollar31;
  const afterMismatchUncheck31 = splitShopItems(buildShoppingList(), getWeek(K30));
  check('Section 31 (L1 v — unchecking mismatched legacy mark keys): tapping have-row on Sriracha (tbsp mark vs tsp row), beans (plural mark), and gochujang (matter mark) unchecks each in one tap',
    tappedSriracha && tappedBeans && tappedGoch &&
    afterMismatchUncheck31.toBuy.some(it => it.base === 'sriracha chili sauce') &&
    !afterMismatchUncheck31.haveIts.some(it => it.base === 'sriracha chili sauce') &&
    afterMismatchUncheck31.toBuy.some(it => it.base === 'black or pinto bean (15 oz)') &&
    !afterMismatchUncheck31.haveIts.some(it => it.base === 'black or pinto bean (15 oz)') &&
    afterMismatchUncheck31.toBuy.some(it => it.base.startsWith('gochujang')) &&
    !afterMismatchUncheck31.haveIts.some(it => it.base.startsWith('gochujang')));

  // 31(2) L2 — Onion in whole units + legacy {onion|cup, qty 0.5} mark migration
  const onionHave31 = preSplit31.haveIts.find(it => it.base === 'onion');
  const onionNeed31 = preSplit31.toBuy.find(it => it.base === 'onion');
  check('Section 31 (L2 — whole onion + legacy cup mark migration): 1 onion stays "1 onion" (COUNT_TO_TSP.onion === undefined) and legacy {onion|cup, qty 0.5} mark covers it as one checked "1 onion" row without splitting',
    COUNT_TO_TSP.onion === undefined &&
    COUNT_TO_TSP.lemon === 9 &&
    !!onionHave31 && onionHave31.label === '1 onion' &&
    !onionNeed31);

  // 31(3) L3 + L6 + L7 — Decompose tbsp/tsp totals (17 tbsp mayo -> 1 cup + 1 tbsp; 10 tsp cornstarch -> 3 tbsp + 1 tsp),
  // eggs optional flag ("3 eggs (2 optional)" + split remainder), and flour alias ("½ cup + 3 tbsp all purpose flour")
  globalThis.byId = {
    'r31-b': {
      id: 'r31-b', title: 'L3/L6/L7 Fixture A', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1/2', unit: 'cup', item: 'mayonnaise' },
        { qty: '1', unit: 'tbsp', item: 'cornstarch' },
        { qty: '1', unit: 'tsp', item: 'cornstarch' },
        { qty: '1/2', unit: 'cup', item: 'flour' },
        { qty: '1', unit: null, item: 'egg' },
        { qty: '1', unit: 'tsp', item: 'vanilla extract' },
        { qty: '1', unit: null, item: 'dried tomato or small tomato' }
      ] }]
    },
    'r31-c': {
      id: 'r31-c', title: 'L3/L6/L7 Fixture B', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1/2', unit: 'cup', item: 'mayonnaise' },
        { qty: '1', unit: 'tbsp', item: 'mayonnaise' },
        { qty: '2', unit: 'tbsp', item: 'cornstarch' },
        { qty: '3', unit: 'tbsp', item: 'all purpose flour' },
        { qty: '2', unit: null, item: 'eggs', optional: true },
        { qty: '1', unit: 'tbsp', item: 'vanilla extract', optional: true }
      ] }]
    }
  };
  const days31b = blankDays();
  days31b[0].dinner.dishes = [{ recipe: 'r31-b', drafted: false }, { recipe: 'r31-c', drafted: false }];
  setPlan({ [K30]: { days: days31b, shoppingDay: K30, haveGenerated: [] } });
  const list31b = buildShoppingList();
  const labels31b = list31b.map(it => it.label);
  check('Section 31 (L3 — decompose tbsp & tsp): 17 tbsp mayo -> "1 cup + 1 tbsp mayonnaise", 10 tsp cornstarch -> "3 tbsp + 1 tsp cornstarch"',
    labels31b.includes('1 cup + 1 tbsp mayonnaise') &&
    labels31b.includes('3 tbsp + 1 tsp cornstarch'));
  check('Section 31 (L4 — stripSize at start only): "dried tomato or small tomato" keeps "small", while leading "medium to large cherry tomatoes" strips size range',
    labels31b.includes('1 dried tomato or small tomato') &&
    stripSize('medium to large cherry tomatoes, stemmed (about 4 cups)') === 'cherry tomatoes, stemmed (about 4 cups)' &&
    stripSize('large flour tortillas') === 'flour tortillas');
  check('Section 31 (L6 — eggs optional flag & volume optional flag): required 1 egg + optional 2 eggs -> "3 eggs (2 optional)", and required 1 tsp + optional 1 tbsp vanilla -> "4 tsp vanilla extract (1 tbsp optional)"',
    labels31b.includes('3 eggs (2 optional)') &&
    labels31b.includes('4 tsp vanilla extract (1 tbsp optional)'));
  const eggsSplit1 = splitShopItems(list31b, { haveGenerated: [{ key: 'egg|', qty: 1, unit: '', session: 's1', at: 100 }] });
  const eggsSplit2 = splitShopItems(list31b, { haveGenerated: [{ key: 'egg|', qty: 2, unit: '', session: 's1', at: 100 }] });
  check('Section 31 (L6 Edge Case B — split flagged row): marking 1 of 3 eggs (2 optional) have leaves "1 egg" (have, no flag) + "2 eggs (2 optional)" (need); marking 2 have leaves "2 eggs" (have) + "1 egg (1 optional)" (need)',
    eggsSplit1.haveIts.find(it => it.base === 'egg').label === '1 egg' &&
    eggsSplit1.toBuy.find(it => it.base === 'egg').label === '2 eggs (2 optional)' &&
    eggsSplit2.haveIts.find(it => it.base === 'egg').label === '2 eggs' &&
    eggsSplit2.toBuy.find(it => it.base === 'egg').label === '1 egg (1 optional)');
  check('Section 31 (L7 — flour = all purpose flour): ½ cup flour + 3 tbsp all purpose flour merge into "½ cup + 3 tbsp all purpose flour"',
    labels31b.includes('½ cup + 3 tbsp all purpose flour') &&
    !list31b.some(it => it.base === 'flour'));

  // 31(4) L5 — Aisle map entries (butternut squash, orange squash, apple, cornmeal, olcha)
  const savedSec31 = globalThis.shoppingSections;
  globalThis.shoppingSections = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shopping-sections.json'), 'utf8'));
  const secButternut = lookupShoppingSection('butternut squash');
  const secOrangeSq = lookupShoppingSection('orange squash');
  const secApple = lookupShoppingSection('apple');
  const secCornmeal = lookupShoppingSection('cornmeal');
  const secOlcha = lookupShoppingSection('olcha');
  globalThis.shoppingSections = savedSec31;
  check('Section 31 (L5 — shopping-sections.json): butternut squash & orange squash -> Fresh Produce > Fresh Vegetables, apple -> Fresh Produce > Fresh Fruit, cornmeal -> Grocery > Baking Needs, olcha stays Unsorted',
    secButternut.department === 'Fresh Produce' && secButternut.subcategory === 'Fresh Vegetables' &&
    secOrangeSq.department === 'Fresh Produce' && secOrangeSq.subcategory === 'Fresh Vegetables' &&
    secApple.department === 'Fresh Produce' && secApple.subcategory === 'Fresh Fruit' &&
    secCornmeal.department === 'Grocery' && secCornmeal.subcategory === 'Baking Needs' &&
    secOlcha.department === 'Unsorted');

  // ---------------------------------------------------------------------------
  // 32. Store-aware shopping list (v20261115e + Worker git-v13, Nov 15, 2026):
  //     word-overlap price matching, store picker, per-store badges/flags/sort/total,
  //     tap-to-note "carries this" (data/store-notes.json), coverage summary & verdict.
  // ---------------------------------------------------------------------------
  const fixtureCandidates32 = [
    path.join(SITE_DIR, 'hidden_files', 'store-picker-20261115', 'price-history-fixture-20261115.json'),
    path.join(__dirname, '..', 'hidden_files', 'store-picker-20261115', 'price-history-fixture-20261115.json'),
    path.join(SITE_DIR, 'price-history-fixture-20261115.json'),
    path.join(__dirname, '..', 'price-history-fixture-20261115.json'),
    path.join(__dirname, 'price-history-fixture-20261115.json')
  ];
  const fixturePath32 = fixtureCandidates32.find(p => fs.existsSync(p));
  const fixtureJson32 = JSON.parse(fs.readFileSync(fixturePath32, 'utf8'));
  const fixturePrices32 = fixtureJson32.prices;

  // 32(a) Word-overlap price matching, false-positive guards, tie guard, and 76-key deterministic fixture check
  const matchMozz32 = priceMatchFor('shredded mozzarella', fixturePrices32);
  const matchPotato32 = priceMatchFor('russet potato', fixturePrices32);
  const matchChoco32 = priceMatchFor('semi-sweet chocolate chips', fixturePrices32);
  const matchStock32 = priceMatchFor('chicken stock', fixturePrices32);
  const matchRomaine32 = priceMatchFor('heart of romaine lettuce', fixturePrices32);
  check('Section 32(a) (price fallback hits): word-overlap matches shredded mozzarella -> Part Skim Mozzarella Cheese, russet potato -> Potato Idaho - Loose, semi-sweet chocolate chips -> Semi Sweet Real Choco Chips (choco->chocolate), chicken stock -> Broth Chicken (broth->stock), and merges hyphen/space romaine-heart + romaine heart',
    !!matchMozz32 && matchMozz32.bought_name === 'Part Skim Mozzarella Cheese' && matchMozz32.price_cents === 549 &&
    !!matchPotato32 && matchPotato32.bought_name === 'Potato Idaho - Loose' && matchPotato32.price_cents === 150 &&
    !!matchChoco32 && matchChoco32.bought_name === 'Semi Sweet Real Choco Chips' && matchChoco32.price_cents === 898 &&
    !!matchStock32 && matchStock32.bought_name === 'Broth Chicken' && matchStock32.price_cents === 1000 &&
    !!matchRomaine32 && matchRomaine32.price_cents === 349 &&
    !!matchRomaine32.by_store &&
    matchRomaine32.by_store['trader joes'].price_cents === 349 &&
    matchRomaine32.by_store['arons'].price_cents === 399);

  const fixtureWithoutChoco32 = { ...fixturePrices32 };
  delete fixtureWithoutChoco32['liebers semi sweet real choco chip'];
  const tieMap32 = {
    'gefen garlic cube': { price_cents: 299, store: "Aron's Kissena Farms", bought_name: 'Gefen Garlic Cubes', receipt_date: '2026-11-01', avg12m_cents: null, last3: [] },
    'dorot crushed garlic': { price_cents: 349, store: "Trader Joe's", bought_name: 'Dorot Crushed Garlic', receipt_date: '2026-11-08', avg12m_cents: null, last3: [] }
  };
  check('Section 32(a) (false-positive & tie guards): chicken breast != chicken broth, red bell pepper != red onion, apple cider vinegar != apple, chocolate chip != potato chip, olive oil/kosher salt != potato chips olive oil salt vinegar, and a top-score tie returns null',
    priceMatchFor('chicken breast', fixturePrices32) === null &&
    priceMatchFor('boneless skinless chicken breast', fixturePrices32) === null &&
    priceMatchFor('red bell pepper', fixturePrices32) === null &&
    priceMatchFor('apple cider vinegar', fixturePrices32) === null &&
    priceMatchFor('chocolate chip', fixtureWithoutChoco32) === null &&
    priceMatchFor('olive oil', fixturePrices32) === null &&
    priceMatchFor('kosher salt', fixturePrices32) === null &&
    priceMatchFor('garlic powder', tieMap32) === null);

  // Deterministic corpus/week check on the live 2026-11-15 week against the 76-key fixture
  const savedPlan32 = globalThis.mealPlan;
  const savedRecipes32 = globalThis.recipes;
  const savedMetaById32 = globalThis.metaById;
  const savedById32 = globalThis.byId;
  const savedSec32 = globalThis.shoppingSections;
  const savedThisWeekKey32 = globalThis.thisWeekKey;
  globalThis.mealPlan = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'meal-plan.json'), 'utf8'));
  globalThis.shoppingSections = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shopping-sections.json'), 'utf8'));
  globalThis.recipes = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'recipes', 'meta.json'), 'utf8'));
  globalThis.metaById = {};
  globalThis.recipes.forEach(m => { globalThis.metaById[m.id] = m; });
  globalThis.byId = {};
  for (const rf of recipeFiles26) {
    if (rf === 'index.json' || rf === 'meta.json') continue;
    const rj = JSON.parse(fs.readFileSync(path.join(recipeDir26, rf), 'utf8'));
    if (rj && rj.id) globalThis.byId[rj.id] = rj;
  }
  globalThis.thisWeekKey = () => '2026-11-15';
  const liveWeekList32 = buildShoppingList();
  const matchedOnLiveWeek32 = liveWeekList32.filter(it => !!priceMatchFor(it, fixturePrices32));
  check('Section 32(a) (76-key fixture corpus check): fixture has 76 keys and deterministically matches 14 of 66 items on the 2026-11-15 week (up from 0 exact without normalization)',
    Object.keys(fixturePrices32).length === 76 &&
    liveWeekList32.length === 66 &&
    matchedOnLiveWeek32.length === 14);
  globalThis.thisWeekKey = savedThisWeekKey32;
  globalThis.mealPlan = savedPlan32;
  globalThis.recipes = savedRecipes32;
  globalThis.metaById = savedMetaById32;
  globalThis.byId = savedById32;
  globalThis.shoppingSections = savedSec32;

  // 32(b) Store picker: default All, localStorage round-trip, store-name normalization, and refresh inside #shop-wrap
  const savedLocal32 = globalThis.localStorage;
  globalThis.localStorage = stubStorage({});
  resetStoreNotesSession();
  setStoreNotesCache({});
  check('Section 32(b) (store normalization & persistence): default is "all", normalizeStore unifies "Aron\'s Kissena Farms" and "Arons Kissena Farms" to "arons" (displayed as "Aron\'s"), and setShopStore/getShopStore round-trip via localStorage',
    getShopStore() === 'all' &&
    normalizeStore("Aron's Kissena Farms") === 'arons' &&
    normalizeStore('Arons Kissena Farms') === 'arons' &&
    normalizeStore("Aron's") === 'arons' &&
    displayStoreName("Aron's Kissena Farms") === "Aron's" &&
    normalizeStore("Trader Joe's") === 'trader joes' &&
    displayStoreName("Trader Joe's") === "Trader Joe's" &&
    setShopStore("Aron's Kissena Farms") === 'arons' &&
    getShopStore() === 'arons' &&
    globalThis.localStorage.getItem('recipe-shop-store') === 'arons' &&
    setShopStore('all') === 'all' &&
    getShopStore() === 'all');

  // Set up deterministic 32(b)-(g) shopping week with Fresh Produce + Grocery + hidden staple + Optional + Already-have
  setMeta([
    { id: 'r32-main', title: 'Store Picker Test Dish', kosher_status: 'pareve', categories: ['main'], servings: '4' }
  ]);
  globalThis.byId = {
    'r32-main': {
      id: 'r32-main', title: 'Store Picker Test Dish', servings: '4',
      ingredients: [{ section: '', items: [
        { qty: '1', unit: '', item: 'heart of romaine lettuce' },
        { qty: '2', unit: '', item: 'carrots' },
        { qty: '3', unit: 'cloves', item: 'garlic' },
        { qty: '1', unit: '', item: 'shallot' },
        { qty: '1', unit: 'pack', item: 'flour tortillas' },
        { qty: '1', unit: 'tsp', item: 'sugar' },
        { qty: '1', unit: '', item: 'avocado', optional: true }
      ] }]
    }
  };
  globalThis.shoppingSections = {
    departments: ['Fresh Produce', 'Grocery'],
    fallbackDepartment: 'Unsorted',
    items: {
      'heart of romaine lettuce': { department: 'Fresh Produce', subcategory: 'Fresh Vegetables' },
      'carrot': { department: 'Fresh Produce', subcategory: 'Fresh Vegetables' },
      'garlic': { department: 'Fresh Produce', subcategory: 'Fresh Vegetables' },
      'shallot': { department: 'Fresh Produce', subcategory: 'Fresh Vegetables' },
      'avocado': { department: 'Fresh Produce', subcategory: 'Fresh Fruit' },
      'flour tortilla': { department: 'Grocery', subcategory: 'Bakery' },
      'sugar': { department: 'Grocery', subcategory: 'Baking Needs' }
    }
  };
  const K32 = thisWeekKey();
  const days32 = blankDays();
  days32[0].dinner.dishes = [{ recipe: 'r32-main', drafted: false }];
  setPlan({ [K32]: { days: days32, shoppingDay: K32, haveGenerated: [], manualItems: [] } });

  // Pre-select Trader Joe's while price history is not yet loaded, then resolve price history -> picker in #shop-wrap keeps selection & renders normalized options
  setShopStore("Trader Joe's");
  setPriceHistoryCache(null);
  const htmlBeforeLoad32 = shoppingListHTML();
  const storePriceFixture32 = {
    'romaine-heart': {
      price_cents: 349,
      store: "Trader Joe's",
      bought_name: 'TJ Romaine Hearts',
      receipt_date: '2026-11-08',
      avg12m_cents: 374,
      by_store: {
        'trader joes': { price_cents: 349, store: "Trader Joe's", bought_name: 'TJ Romaine Hearts', receipt_date: '2026-11-08' },
        'arons': { price_cents: 399, store: "Aron's Kissena Farms", bought_name: "Aron's Romaine Hearts", receipt_date: '2026-09-29' }
      },
      last3: [
        { price_cents: 349, store: "Trader Joe's", bought_name: 'TJ Romaine Hearts', receipt_date: '2026-11-08' },
        { price_cents: 399, store: "Aron's Kissena Farms", bought_name: "Aron's Romaine Hearts", receipt_date: '2026-09-29' }
      ]
    },
    'carrots-cut-peeled': {
      price_cents: 199,
      store: "Trader Joe's",
      bought_name: 'Carrots Cut & Peeled',
      receipt_date: '2026-11-08',
      avg12m_cents: null,
      by_store: {
        'trader joes': { price_cents: 199, store: "Trader Joe's", bought_name: 'Carrots Cut & Peeled', receipt_date: '2026-11-08' }
      },
      last3: [{ price_cents: 199, store: "Trader Joe's", bought_name: 'Carrots Cut & Peeled', receipt_date: '2026-11-08' }]
    },
    'garlic loose': {
      price_cents: 250,
      store: "Aron's Kissena Farms",
      bought_name: 'Garlic Loose',
      receipt_date: '2026-11-01',
      avg12m_cents: null,
      by_store: {
        'arons': { price_cents: 250, store: 'Arons Kissena Farms', bought_name: 'Garlic Loose', receipt_date: '2026-11-01' }
      },
      last3: [{ price_cents: 250, store: "Aron's Kissena Farms", bought_name: 'Garlic Loose', receipt_date: '2026-11-01' }]
    },
    'avocado ha': {
      price_cents: 297,
      store: "Aron's Kissena Farms",
      bought_name: 'Avocado Hass Large',
      receipt_date: '2026-09-29',
      avg12m_cents: null,
      by_store: {
        'arons': { price_cents: 297, store: "Aron's Kissena Farms", bought_name: 'Avocado Hass Large', receipt_date: '2026-09-29' }
      },
      last3: [{ price_cents: 297, store: "Aron's Kissena Farms", bought_name: 'Avocado Hass Large', receipt_date: '2026-09-29' }]
    },
    'sugar': {
      price_cents: 129,
      store: "Trader Joe's",
      bought_name: 'Organic Cane Sugar',
      receipt_date: '2026-11-08',
      avg12m_cents: null,
      by_store: {
        'trader joes': { price_cents: 129, store: "Trader Joe's", bought_name: 'Organic Cane Sugar', receipt_date: '2026-11-08' }
      },
      last3: [{ price_cents: 129, store: "Trader Joe's", bought_name: 'Organic Cane Sugar', receipt_date: '2026-11-08' }]
    }
  };
  setPriceHistoryCache(storePriceFixture32);
  const htmlTJ32 = shoppingListHTML();
  const aronsOptionMatches32 = htmlTJ32.match(/<option value="arons"/g) || [];
  check('Section 32(b) (picker mount in #shop-wrap & deduplicated store options): pre-selected store stays selected before and after price fetch, and "Aron\'s Kissena Farms" + "Arons Kissena Farms" collapse into a single "Aron\'s" option',
    htmlBeforeLoad32.includes('<option value="trader joes" selected>Trader Joe&#39;s</option>') &&
    htmlTJ32.includes('id="shop-store-picker"') &&
    htmlTJ32.includes('<option value="trader joes" selected>Trader Joe&#39;s</option>') &&
    htmlTJ32.includes('<option value="arons">Aron&#39;s</option>') &&
    aronsOptionMatches32.length === 1);

  // 32(c) Per-store price badge + "not seen here" flag + Already-have suppression
  setShopStore('arons');
  const htmlArons32 = shoppingListHTML();
  setShopStore('trader joes');
  check('Section 32(c) (per-store badge & "not seen here" flag): mixed-store item shows store-specific bought_name + price (TJ Romaine Hearts $3.49 vs Aron\'s Romaine Hearts $3.99); item only at Aron\'s shows "last bought at Aron\'s $2.50 · Nov 1 — no Trader Joe\'s price yet" on To buy and Optional rows; unpriced item shows neither',
    htmlTJ32.includes('TJ Romaine Hearts · $3.49 · Trader Joe&#39;s · Nov 8') &&
    !htmlTJ32.includes('Aron&#39;s Romaine Hearts · $3.99') &&
    htmlArons32.includes('Aron&#39;s Romaine Hearts · $3.99 · Aron&#39;s · Sep 29') &&
    !htmlArons32.includes('TJ Romaine Hearts · $3.49') &&
    htmlTJ32.includes('last bought at Aron&#39;s $2.50 · Nov 1 — no Trader Joe&#39;s price yet') &&
    htmlTJ32.includes('last bought at Aron&#39;s $2.97 · Sep 29 — no Trader Joe&#39;s price yet') &&
    !htmlTJ32.includes('data-price-toggle="flour tortilla|pack"') &&
    !htmlTJ32.includes('flour tortillas</span><span class="shop-price-flag">'));

  // Mark garlic and romaine as Already have -> neither badge nor flag appears on Already-have rows
  getWeek(K32).haveGenerated = [
    { key: 'heart of romaine lettuce|', session: 's1', at: 100, qty: 1, unit: '' },
    { key: 'garlic|clove', session: 's1', at: 100, qty: 3, unit: 'clove' }
  ];
  const htmlHave32 = shoppingListHTML();
  getWeek(K32).haveGenerated = [];
  check('Section 32(c) (Already-have rows stay badgeless & flagless): moving priced-here or priced-elsewhere items to Already have suppresses both .shop-price-badge and .shop-price-flag',
    !htmlHave32.includes('TJ Romaine Hearts · $3.49') &&
    !htmlHave32.includes('last bought at Aron&#39;s $2.50'));

  // 32(d) Sort within department section: pricedAtStore (tier 0) -> pricedOnlyElsewhere (tier 1) -> unpriced (tier 2), section order preserved
  const posRomaine32 = htmlTJ32.indexOf('1 heart of romaine lettuce');
  const posCarrots32 = htmlTJ32.indexOf('2 carrots');
  const posGarlic32 = htmlTJ32.indexOf('3 cloves garlic');
  const posShallot32 = htmlTJ32.indexOf('1 shallot');
  const posFreshDept32 = htmlTJ32.indexOf('<span>Fresh Produce</span>');
  const posGroceryDept32 = htmlTJ32.indexOf('<span>Grocery</span>');
  check('Section 32(d) (per-store department sort): within Fresh Produce, TJ-priced rows (1 heart of romaine lettuce, 2 carrots) precede Aron\'s-only row (3 cloves garlic), which precedes unpriced row (1 shallot), while Fresh Produce stays above Grocery',
    posFreshDept32 > 0 &&
    posGroceryDept32 > posFreshDept32 &&
    posRomaine32 > posFreshDept32 &&
    posCarrots32 > posRomaine32 &&
    posGarlic32 > posCarrots32 &&
    posShallot32 > posGarlic32 &&
    posShallot32 < posGroceryDept32);

  // 32(e) Tap-to-note "carries this" / "doesn't carry this" + persistence to data/store-notes.json without touching meal-plan.json
  setShopStore('all');
  const htmlAllNoNoteMenu32 = shoppingListHTML();
  setShopStore('trader joes');
  let savedStoreNotesText32 = '{}';
  let storeNotesSaveCount32 = 0;
  let mealPlanSaveCount32 = 0;
  let markShopDirtyCalls32 = 0;
  const savedGhPut32 = globalThis.ghPut;
  const savedFetch32 = globalThis.fetch;
  const savedMarkDirty32 = globalThis.markShopDirty;
  globalThis.markShopDirty = () => { markShopDirtyCalls32++; };
  globalThis.fetch = async url => {
    if (String(url).includes('data%2Fstore-notes.json') || String(url).includes('data/store-notes.json')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, content: savedStoreNotesText32 }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, content: JSON.stringify(serverState) }) };
  };
  globalThis.ghPut = async (p, text) => {
    if (p === 'data/store-notes.json') {
      storeNotesSaveCount32++;
      savedStoreNotesText32 = text;
      return { ok: true };
    }
    mealPlanSaveCount32++;
    serverState = JSON.parse(text);
    return { ok: true };
  };

  await toggleStoreNote('garlic', 'trader joes', 'carries');
  const htmlAfterCarries32 = shoppingListHTML();
  const parsedAfterCarries32 = JSON.parse(savedStoreNotesText32);
  check('Section 32(e) (note-carries): menu items appear only when a store is picked; noting garlic "carries" at Trader Joe\'s renders "✓ at Trader Joe\'s", writes data/store-notes.json, and never touches meal-plan.json or markShopDirty()',
    !htmlAllNoNoteMenu32.includes('data-shop-act="note-carries"') &&
    htmlTJ32.includes('data-shop-act="note-carries"') &&
    htmlTJ32.includes('data-shop-act="note-not-carried"') &&
    htmlAfterCarries32.includes('✓ at Trader Joe&#39;s') &&
    storeNotesSaveCount32 === 1 &&
    mealPlanSaveCount32 === 0 &&
    markShopDirtyCalls32 === 0 &&
    parsedAfterCarries32.garlic &&
    parsedAfterCarries32.garlic['trader joes'].status === 'carries' &&
    typeof parsedAfterCarries32.garlic['trader joes'].updatedAt === 'number');

  // Tap carries again on garlic -> clears note via status: null tombstone
  await sleep(5);
  await toggleStoreNote('garlic', 'trader joes', 'carries');
  const htmlAfterClear32 = shoppingListHTML();
  const parsedAfterClear32 = JSON.parse(savedStoreNotesText32);
  check('Section 32(e) (clear note via tombstone): tapping active "carries" a second time writes { status: null, updatedAt } tombstone and removes the note badge across re-render',
    !htmlAfterClear32.includes('✓ at Trader Joe&#39;s') &&
    parsedAfterClear32.garlic['trader joes'].status === null &&
    parsedAfterClear32.garlic['trader joes'].updatedAt > parsedAfterCarries32.garlic['trader joes'].updatedAt);

  // 32(f) & 32(g) Coverage summary, one-store-week verdict, and per-store estimated total (with Hide-staples ON so sugar staple is hidden)
  globalThis.localStorage.setItem('recipe-hide-staples', '1');
  // Active To buy items (with sugar hidden): romaine ($3.49 TJ), carrots ($1.99 TJ), garlic ($2.50 Aron's only), shallot (unpriced), flour tortillas (unpriced) -> M = 5, N = 2 priced at TJ ($5.48)
  const htmlSummaryInit32 = shoppingListHTML();
  check('Section 32(f) & 32(g) (initial coverage summary, verdict & per-store total): 2 of 5 priced at TJ ($5.48, hidden sugar staple $1.29 and Aron\'s-only garlic $2.50 excluded), 1 only at Aron\'s, 2 no price yet, and 3 unconfirmed items named in verdict',
    htmlSummaryInit32.includes('Trader Joe&#39;s: 2 of 5 priced here · 1 only at Aron&#39;s · 2 no price yet') &&
    htmlSummaryInit32.includes('3 items unconfirmed at Trader Joe&#39;s: garlic, shallot, flour tortillas') &&
    !htmlSummaryInit32.includes('You only need Trader Joe&#39;s this week.') &&
    htmlSummaryInit32.includes('Estimated total about $5.48 · 2 of 5 items priced'));

  // Note garlic, shallot, and flour tortilla as "carries" at Trader Joe's -> all 5 activeToBuy items are now either pricedAtStore (2) or notedCarriesOnly (3) -> one-store-week verdict fires!
  await toggleStoreNote('garlic', 'trader joes', 'carries');
  await toggleStoreNote('shallot', 'trader joes', 'carries');
  await toggleStoreNote('flour tortilla', 'trader joes', 'carries');
  const htmlVerdictOk32 = shoppingListHTML();
  check('Section 32(f) (one-store-week verdict): when all active To buy items are priced at Trader Joe\'s (2) or noted carried (3), summary drops "only at Aron\'s" and verdict shows "You only need Trader Joe\'s this week."',
    htmlVerdictOk32.includes('Trader Joe&#39;s: 2 of 5 priced here · 3 noted carried') &&
    !htmlVerdictOk32.includes('only at Aron&#39;s') &&
    htmlVerdictOk32.includes('class="shop-store-verdict shop-store-verdict-ok">You only need Trader Joe&#39;s this week.</p>'));

  // Now mark carrots (which has a $1.99 TJ price!) as "not-carried" at Trader Joe's -> blocks verdict, names carrots, and drops TJ total from $5.48 (2 of 5) to $3.49 (1 of 5)!
  await toggleStoreNote('carrot', 'trader joes', 'not-carried');
  const htmlNotCarried32 = shoppingListHTML();
  check('Section 32(f) & 32(g) (not-carried blocks verdict & excludes item from store total): noting carrots not-carried at Trader Joe\'s blocks the verdict, names carrots, and drops the TJ total from $5.48 (2 of 5) to $3.49 (1 of 5)',
    htmlNotCarried32.includes('✗ not at Trader Joe&#39;s') &&
    htmlNotCarried32.includes('Trader Joe&#39;s: 1 of 5 priced here · 3 noted carried · 1 noted not carried') &&
    htmlNotCarried32.includes('1 item noted not carried at Trader Joe&#39;s: carrots') &&
    !htmlNotCarried32.includes('You only need Trader Joe&#39;s this week.') &&
    htmlNotCarried32.includes('Estimated total about $3.49 · 1 of 5 items priced'));

  // All-stores mode and empty activeToBuy suppress both summary and verdict
  setShopStore('all');
  const htmlAllNoVerdict32 = shoppingListHTML();
  setShopStore('trader joes');
  setPlan({ [K32]: { days: blankDays(), shoppingDay: K32, haveGenerated: [], manualItems: [] } });
  const htmlEmptyNoVerdict32 = shoppingListHTML();
  check('Section 32(f) (All stores & empty list suppress summary/verdict): neither .shop-store-summary nor .shop-store-verdict renders on All stores or when activeToBuy is empty',
    !htmlAllNoVerdict32.includes('shop-store-summary') &&
    !htmlAllNoVerdict32.includes('shop-store-verdict') &&
    !htmlEmptyNoVerdict32.includes('shop-store-summary') &&
    !htmlEmptyNoVerdict32.includes('shop-store-verdict'));

  globalThis.ghPut = savedGhPut32;
  globalThis.fetch = savedFetch32;
  globalThis.markShopDirty = savedMarkDirty32;
  globalThis.localStorage = savedLocal32;
  resetStoreNotesSession();

  // 32(h) mergeStoreNotes tombstone LWW unit test
  const mergedNotes32 = mergeStoreNotes(
    {
      kishka: {
        'trader joes': { status: 'carries', updatedAt: 1763220000000 },
        'arons': { status: 'carries', updatedAt: 1763220005000 }
      }
    },
    {
      kishka: {
        'trader joes': { status: null, updatedAt: 1763220010000 }
      }
    }
  );
  check('Section 32(h) (mergeStoreNotes LWW & tombstones): a newer status: null tombstone (t2) beats an older "carries" (t1) for the same store while preserving other stores on the same baseKey',
    mergedNotes32.kishka['trader joes'].status === null &&
    mergedNotes32.kishka['trader joes'].updatedAt === 1763220010000 &&
    mergedNotes32.kishka.arons.status === 'carries' &&
    mergedNotes32.kishka.arons.updatedAt === 1763220005000);

  // 32(i) Bridge git-v13: worker.js /save allowlist (data/store-notes.json allowed, data/other.json 403) + receipts.js per-store by_store & last3[].bought_name
  const workerCandidates32 = [
    path.join(SITE_DIR, 'worker.js'),
    path.join(SITE_DIR, 'bridge-git-v12', 'worker.js'),
    path.join(__dirname, '..', 'worker.js')
  ];
  const workerPath32 = workerCandidates32.find(p => fs.existsSync(p));
  const workerMod32 = await import(pathToFileURL(workerPath32).href);
  const savedWorkerFetch32 = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init && init.method === 'PUT') {
      return new Response(JSON.stringify({ commit: { sha: 'commit-sha-32' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ sha: 'old-sha-32', type: 'file', content: 'e30=' }), { status: 200 });
  };
  const healthRes32 = await workerMod32.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/health'),
    { GITHUB_TOKEN: 'fake-token' }
  );
  const healthJson32 = await healthRes32.json();
  const saveAllowedRes32 = await workerMod32.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'data/store-notes.json', content: '{}\n', message: 'test store notes' })
    }),
    { GITHUB_TOKEN: 'fake-token' }
  );
  const saveAllowedJson32 = await saveAllowedRes32.json();
  const saveBlockedRes32 = await workerMod32.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'data/other.json', content: '{}\n', message: 'blocked path' })
    }),
    { GITHUB_TOKEN: 'fake-token' }
  );
  globalThis.fetch = savedWorkerFetch32;
  check('Section 32(i) (worker git-v13 allowlist & version): worker.js /health reports version "git-v13", /save accepts "data/store-notes.json" (200 ok:true), and /save rejects "data/other.json" with 403',
    healthRes32.status === 200 &&
    healthJson32.version === 'git-v13' &&
    saveAllowedRes32.status === 200 &&
    saveAllowedJson32.ok === true &&
    saveBlockedRes32.status === 403);

  const multiStoreRows32 = [
    // 3 recent Trader Joe's purchases + 1 older Aron's purchase (must survive in by_store.arons even though evicted from last3!)
    { status: 'verified', needs_review: 0, group_key: 'romaine heart', paid_price_cents: 349, store: "Trader Joe's", product_name: 'TJ Romaine 1', raw_line: 'ROMAINE 1', receipt_date: '2026-11-10', receipt_id: 'r4', item_id: 4 },
    { status: 'verified', needs_review: 0, group_key: 'romaine heart', paid_price_cents: 339, store: "Trader Joe's", product_name: 'TJ Romaine 2', raw_line: 'ROMAINE 2', receipt_date: '2026-11-05', receipt_id: 'r3', item_id: 3 },
    { status: 'verified', needs_review: 0, group_key: 'romaine heart', paid_price_cents: 329, store: "Trader Joe's", product_name: 'TJ Romaine 3', raw_line: 'ROMAINE 3', receipt_date: '2026-11-01', receipt_id: 'r2', item_id: 2 },
    { status: 'verified', needs_review: 0, group_key: 'romaine heart', paid_price_cents: 399, store: "Aron's Kissena Farms", product_name: "Aron's Romaine Hearts", raw_line: 'ARONS ROMAINE', receipt_date: '2026-09-29', receipt_id: 'r1', item_id: 1 }
  ];
  const phMultiRes32 = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv(multiStoreRows32),
    { nowMs: new Date('2026-11-15T12:00:00Z').getTime() }
  );
  const phMultiJson32 = await phMultiRes32.json();
  const romMulti32 = phMultiJson32.prices['romaine heart'];
  check('Section 32(i) (worker /price-history by_store & last3[].bought_name): preserves per-store latest in by_store even when 3 newer purchases at another store evict it from last3, includes bought_name on last3 entries, and exposes zero private fields',
    !!romMulti32 &&
    romMulti32.last3.length === 3 &&
    romMulti32.last3.every(x => x.store === "Trader Joe's" && typeof x.bought_name === 'string' && x.bought_name.startsWith('TJ Romaine')) &&
    !!romMulti32.by_store &&
    romMulti32.by_store['trader joes'].price_cents === 349 &&
    romMulti32.by_store['trader joes'].bought_name === 'TJ Romaine 1' &&
    romMulti32.by_store['arons'].price_cents === 399 &&
    romMulti32.by_store['arons'].bought_name === "Aron's Romaine Hearts" &&
    romMulti32.by_store['arons'].receipt_date === '2026-09-29' &&
    Object.keys(romMulti32.by_store['arons']).sort().join(',') === 'bought_name,price_cents,receipt_date,store');

  const failed = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' assertions passed ====');
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error('ERROR', e); process.exitCode = 1; });

