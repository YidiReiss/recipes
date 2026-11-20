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
['totalTime', 'ymd', 'blankSlot', 'SHOP_STORE_KEY', 'STORE_NOTES_LOCAL_KEY', 'PRICE_PROCESSED_QUALIFIERS'].forEach(n => geval(extractDeclSemi(n)));
['PLAN_RE', 'YIELD_LEFT_VALUES', 'TSP_PER', 'COUNT_TO_TSP', 'SIZE_WORDS',
 'UNCOUNTABLES', 'IRREGULAR_PLURALS', 'IRREGULAR_SINGULARS',
 'UNICODE_FRACTIONS', 'SECTION_GENERIC_WORDS',
  'ITEM_ALIASES', 'UNIT_ALIASES',
  'PRICE_ABBREV_MAP', 'PRICE_MODIFIER_WORDS', 'PRICE_FORM_WORDS', 'PRICE_QUALIFIED_HEADS', 'PRICE_VARIETY_WORDS'].forEach(n => geval(extractDecl(n)));
globalThis.priceDirectMatches = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-direct-matches.json'), 'utf8'));
globalThis.priceConversions = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-conversions.json'), 'utf8'));
globalThis.shelfLifeTable = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shelf-life.json'), 'utf8'));
globalThis.unitConversions = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'unit-conversions.json'), 'utf8'));
globalThis._priceHistoryCache = null;
globalThis._priceHistoryInFlight = null;
globalThis._priceHistoryFetched = false;
globalThis._openPriceDetailKeys = new Set();
globalThis._storeNotesCache = {};
globalThis._storeNotesInFlight = null;
globalThis._storeNotesFetched = false;
globalThis._saveStoreNotesChain = Promise.resolve();
globalThis._saveStoreNotesInFlight = 0;
globalThis.PANTRY_LOCAL_KEY = 'recipe-pantry-local';
globalThis._pantryCache = {};
globalThis._pantryInFlight = null;
globalThis._pantryFetched = false;
globalThis._savePantryChain = Promise.resolve();
globalThis._savePantryInFlight = 0;
 ['RAW_MEAT_POULTRY_FISH_RE', 'COOKED_DELI_CANNED_RE', 'PANTRY_NON_FOOD_RE'].forEach(n => geval(extractDeclSemi(n)));
['PANTRY_GENERIC_MATCH_WORDS'].forEach(n => geval(extractDecl(n)));
globalThis._pantryEditingLotKey = null;
globalThis._pantryEditingTotalKey = null;
globalThis._pantryEditingExpiryKey = null;
globalThis._pantrySearchQuery = '';
globalThis._pantryHighlightTimer = null;
globalThis._pantrySavedLotKey = null;
globalThis._pantrySavedTimer = null;
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
 'priceVarietyGroups', 'priceMatchWords', 'priceHeadNoun', 'isValidPriceEntry', 'mergePriceHistoryEntryPair',
 'entryPriceAtStore', 'entryPriceElsewhere', 'priceMatchFor',
 'getPriceConversionsMap', 'lookupPriceConversion', 'formatPriceWithBasis',
 'normalizeRecipeEstimateUnit', 'parseExtraBucketsFromItem', 'convertBucketToPounds',
 'effectivePriceBasisKey', 'effectiveUnitRateCents', 'compareExpectedVsLast', 'estimateShopItemCents',
 'collectKnownStores',
 'setPriceHistoryCache', 'resetPriceHistorySession', 'ensurePriceHistoryLoaded', 'triggerPriceCheckFlag',
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
 'stopStepSpeech', 'speakRecipeStepText',
 /* Pantry Tracking (v20261119c + Bridge git-v18 + v20261120a Batch 2 + v20261120b Batch 3) */
 'getShelfLifeTable', 'getUnitConversionsMap', 'lookupUnitConversion',
 'isRawMeatPoultryFishKey', 'lookupShelfLife', 'defaultStorageForPantryItem',
 'addDaysYmd', 'todayPantryYmd', 'computeLotExpiry', 'evaluateLotStatus', 'isLotExpiringSoon',
 'normalizePantryUnit', 'parsePantryPackUnit', 'appendPantryLotHistory',
 'normalizePantryLot', 'recomputePantryEntry', 'normalizePantryData', 'mergePantryData',
 'convertPantryQty', 'resolvePantryEntryKey', 'isPantryNonFoodKey', 'mergeReceiptStockIntoPantry',
 'getPantryHaveFor', 'applyPantryToShopItem',
 'deductIngredientFromPantryMap', 'restorePantryDeductionsToMap',
 'setPantryLotQty', 'setPantryTotalQty', 'setPantryLotOpened', 'setPantryLotExpiry',
 'pantryItemSupportsOpened', 'formatPantryLotHistoryEvent',
 'toggleDishCooked',
 'savePantryLocal', 'loadPantryLocal', 'setPantryCache', 'resetPantrySession',
 'bridgeReadPantry', 'fetchBridgePantryStock', 'ensurePantryLoaded', 'savePantry',
 'setPantryManualStock', 'removePantryEntry', 'overridePantryLotStillGood', 'switchPantryLotStorage',
 'buildPantryFlagDialogState', 'applyPantryFlagDialogConfirm', 'fmtPantryDate', 'fmtPantryQty', 'flashPantryLotSaved', 'scrollToPantryCard', 'pantryViewHTML', 'renderPantry', 'wirePantryEvents'
].forEach(n => geval(extract(n) + '\n;globalThis.' + n + ' = ' + n + ';'));
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
  check('Section 26 (estimated cart total): sums one unit per matched To buy line ($4.48) and reports 2 of 4 items priced (manual items count in M since v20261119a; optional items excluded)',
    html26.includes('Estimated total about $4.48 · 2 of 4 items priced'));
  check('Section 26 (estimated cart total): a priced pantry staple hidden by the Hide-staples toggle shows its badge but is excluded from the total (still $4.48 · 2 of 4, not $5.48 · 3 of 5)',
    html26.includes('Domino Sugar 4lb · $1.00 · Bingo · Nov 9') &&
    html26.includes('Estimated total about $4.48 · 2 of 4 items priced'));

  // Move beans to Already have: Already-have rows get NO badge, and cart total updates to $2.99 · 1 of 2 items priced
  wk25.haveGenerated = [{ key: beans25.key, session: 's1', at: 200 }];
  const html26Have = shoppingListHTML();
  check('Section 26 (Already have excluded): moving a priced item to Already have suppresses its badge and updates the cart total to $2.99 · 1 of 3 items priced',
    !html26Have.includes('Goya Black Beans · $1.49 · Bingo · Nov 8') &&
    html26Have.includes('Estimated total about $2.99 · 1 of 3 items priced'));

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
    path.join(SITE_DIR, 'bridge-git-v13', 'worker.js'),
    path.join(SITE_DIR, 'bridge-git-v12', 'worker.js'),
    path.join(SITE_DIR, 'worker.js'),
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

  // ---------------------------------------------------------------------------
  // 33. Price-matching comprehensive fix (v20261116a + Bridge git-v14, Nov 16, 2026):
  //     Part 1 direct-match layer (data/price-direct-matches.json), Part 2 fuzzy
  //     guard fixes (single-word distinctive head at candidate edge + variety-conflict
  //     rule), Part 3 per-unit prices for count ('ea', qty > 1) receipt lines while
  //     keeping weighed ('lb') lines line-total, and 101-key live corpus verification.
  // ---------------------------------------------------------------------------
  const fixtureCandidates33 = [
    path.join(SITE_DIR, 'price-history-fixture-20261116.json'),
    path.join(__dirname, '..', 'price-history-fixture-20261116.json'),
    path.join(__dirname, 'price-history-fixture-20261116.json')
  ];
  const fixturePath33 = fixtureCandidates33.find(p => fs.existsSync(p));
  const fixtureJson33 = JSON.parse(fs.readFileSync(fixturePath33, 'utf8'));
  const fixturePrices33 = fixtureJson33.prices || fixtureJson33;
  globalThis.priceDirectMatches = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-direct-matches.json'), 'utf8'));

  // 33(a) Three reported cases: Eggs, Potatoes, and Per-unit Chicken Broth (plus weighed 'lb' line-total)
  const matchEggDirect33 = priceMatchFor('egg', fixturePrices33);
  const savedDirect33 = globalThis.priceDirectMatches;
  globalThis.priceDirectMatches = null;
  const matchEggFuzzy33 = priceMatchFor('egg', fixturePrices33);
  globalThis.priceDirectMatches = savedDirect33;
  check('Section 33(a) (Case 1 — Eggs): priceMatchFor("egg", fixture101) matches "jacks f x-large egg" ($1.99, X-Large Eggs) via both Step 0 direct map and Step 2(a) single-word edge head rule',
    !!matchEggDirect33 &&
    matchEggDirect33.bought_name === 'X-Large Eggs' &&
    matchEggDirect33.price_cents === 199 &&
    !!matchEggFuzzy33 &&
    matchEggFuzzy33.bought_name === 'X-Large Eggs' &&
    matchEggFuzzy33.price_cents === 199);

  const matchYellowPotato33 = priceMatchFor('yellow potato (the little potato company)', fixturePrices33);
  const matchGoldenPotato33 = priceMatchFor('golden potato', fixturePrices33);
  const idahoOnlyFixture33 = { 'potato idaho loose': fixturePrices33['potato idaho loose'] };
  globalThis.priceDirectMatches = null;
  const yellowVsIdahoNoDirect33 = priceMatchFor('yellow potato (the little potato company)', idahoOnlyFixture33);
  const goldenVsIdahoNoDirect33 = priceMatchFor('golden potato', idahoOnlyFixture33);
  globalThis.priceDirectMatches = savedDirect33;
  const yellowVsIdahoWithDirect33 = priceMatchFor('yellow potato (the little potato company)', idahoOnlyFixture33);
  check('Section 33(a) (Case 2 — Potatoes): "yellow potato (the little potato company)" and "golden potato" match "potato yukon gold loose" ($3.46, Potato Yukon Gold Large - Loose) and never match "potato idaho loose" (blocked by variety-conflict guard even when direct target is absent)',
    !!matchYellowPotato33 &&
    matchYellowPotato33.bought_name === 'Potato Yukon Gold Large - Loose' &&
    matchYellowPotato33.price_cents === 346 &&
    !!matchGoldenPotato33 &&
    matchGoldenPotato33.bought_name === 'Potato Yukon Gold Large - Loose' &&
    matchGoldenPotato33.price_cents === 346 &&
    yellowVsIdahoNoDirect33 === null &&
    goldenVsIdahoNoDirect33 === null &&
    yellowVsIdahoWithDirect33 === null);

  const unitPriceRows33 = [
    // 4 cartons of Tabatchnick Chicken Broth @ $10.00 line total (unit='ea', qty_or_weight=4) -> $2.50 (250 cents) per carton
    { status: 'verified', needs_review: 0, group_key: 'tabatchnick broth chicken', paid_price_cents: 1000, qty_or_weight: 4, unit: 'ea', store: "Aron's Kissena Farms", product_name: 'Broth Chicken', raw_line: 'TABATCHNICK BROTH CHICKEN', receipt_date: '2026-09-29', receipt_id: 'r10', line_no: 1, id: 101 },
    // Older 2 cartons of Tabatchnick Chicken Broth @ $5.20 line total (unit='ea', qty_or_weight=2) -> $2.60 (260 cents) per carton
    { status: 'verified', needs_review: 0, group_key: 'tabatchnick broth chicken', paid_price_cents: 520, qty_or_weight: 2, unit: 'ea', store: 'Bingo', product_name: 'Broth Chicken', raw_line: 'TABATCHNICK BROTH CHICKEN', receipt_date: '2026-08-15', receipt_id: 'r9', line_no: 2, id: 102 },
    // Weighed produce line (unit='lb', qty_or_weight=2.31, paid_price_cents=346) -> stays line-total 346 cents
    { status: 'verified', needs_review: 0, group_key: 'potato yukon gold loose', paid_price_cents: 346, qty_or_weight: 2.31, unit: 'lb', store: "Aron's Kissena Farms", product_name: 'Potato Yukon Gold Large - Loose', raw_line: 'POTATO YUKON GOLD', receipt_date: '2026-11-15', receipt_id: 'r11', line_no: 3, id: 103 },
    // Weighed tomato stem line (unit='lb', qty_or_weight=1.68, paid_price_cents=503) -> stays line-total 503 cents
    { status: 'verified', needs_review: 0, group_key: 'tomato stem', paid_price_cents: 503, qty_or_weight: 1.68, unit: 'lb', store: "Aron's Kissena Farms", product_name: 'Tomato Stem', raw_line: 'TOMATO STEM', receipt_date: '2026-11-15', receipt_id: 'r11', line_no: 4, id: 104 }
  ];
  const phUnitRes33 = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv(unitPriceRows33),
    { nowMs: new Date('2026-11-16T12:00:00Z').getTime() }
  );
  const phUnitJson33 = await phUnitRes33.json();
  const brothEntry33 = phUnitJson33.prices['tabatchnick broth chicken'];
  const weighedPotato33 = phUnitJson33.prices['potato yukon gold loose'];
  const weighedTomato33 = phUnitJson33.prices['tomato stem'];
  check('Section 33(a) (Case 3 — Bridge git-v14 per-unit prices): 4x $10.00 "ea" broth line yields 250 cents ($2.50) across top-level, by_store, last3, and avg12m_cents, while weighed "lb" lines stay line-total (346 and 503 cents)',
    !!brothEntry33 &&
    brothEntry33.price_cents === 250 &&
    brothEntry33.by_store['arons'].price_cents === 250 &&
    brothEntry33.by_store['bingo'].price_cents === 260 &&
    JSON.stringify(brothEntry33.last3.map(x => x.price_cents)) === JSON.stringify([250, 260]) &&
    brothEntry33.avg12m_cents === 255 &&
    !!weighedPotato33 &&
    weighedPotato33.price_cents === 346 &&
    weighedPotato33.by_store['arons'].price_cents === 346 &&
    !!weighedTomato33 &&
    weighedTomato33.price_cents === 503);

  // 33(b) Full-corpus before/after check: 66 live-week items (2026-11-15) x 101-key fixture
  const savedPlan33 = globalThis.mealPlan;
  const savedRecipes33 = globalThis.recipes;
  const savedMetaById33 = globalThis.metaById;
  const savedById33 = globalThis.byId;
  const savedSec33 = globalThis.shoppingSections;
  const savedThisWeekKey33 = globalThis.thisWeekKey;
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
  const liveWeekList33 = buildShoppingList();
  const split33 = splitShopItems(liveWeekList33, getWeek('2026-11-15'));
  const matchedPairs33 = liveWeekList33
    .map(it => {
      const m = priceMatchFor(it, fixturePrices33);
      return m ? { base: it.base, bought_name: m.bought_name, price_cents: m.price_cents } : null;
    })
    .filter(Boolean);
  const matchedToBuy33 = split33.toBuy.filter(it => !!priceMatchFor(it, fixturePrices33));
  const expectedPairs33 = [
    ['apple', 'Apple Gala Small'],
    ['heart of romaine lettuce', 'Romaine Hearts'],
    ['fresh brussel sprout', 'Brussel Sprouts'],
    ['onion', 'Onion Yellow Globe - Loose'],
    ['purple onion', 'Onion Red'],
    ['shallot', 'Onion Shallots'],
    ['white vinegar', 'Distilled White Vinegar 5% Acidity'],
    ['dried parsley', 'Parsley Italian'],
    ['yellow potato (the little potato company)', 'Potato Yukon Gold Large - Loose'],
    ['carrot', 'Carrots Cut & Peeled'],
    ['golden potato', 'Potato Yukon Gold Large - Loose'],
    ['lime juice', 'Limes'],
    ['lemon juice', 'Lemon Small'],
    ['tomato', 'Tomato Stem'],
    ['garlic', 'Garlic Loose'],
    ['fresh parsley', 'Parsley Italian'],
    ['egg', 'X-Large Eggs'],
    ['black bean (15 oz)', 'Black Beans'],
    ['chicken stock', 'Broth Chicken'],
    ['coconut milk', 'Coconut Milk'],
    ['fettuccine pasta', 'Fettuccine']
  ];
  check('Section 33(b) (101-key full-corpus check): 101-key fixture matches 21 of 66 live-week items (8 of 33 To-buy rows, up from 6 with 0 wrong Idaho potato matches) with exact expected bought_name pairs (v20261117b adds lemon juice -> Lemon Small and lime juice -> Limes via direct matches; v20261119a direct-matches onion -> Onion Yellow Globe - Loose)',
    Object.keys(fixturePrices33).length === 101 &&
    liveWeekList33.length === 66 &&
    split33.toBuy.length === 33 &&
    matchedPairs33.length === 21 &&
    matchedToBuy33.length === 8 &&
    JSON.stringify(matchedPairs33.map(p => [p.base, p.bought_name])) === JSON.stringify(expectedPairs33));
  globalThis.thisWeekKey = savedThisWeekKey33;
  globalThis.mealPlan = savedPlan33;
  globalThis.recipes = savedRecipes33;
  globalThis.metaById = savedMetaById33;
  globalThis.byId = savedById33;
  globalThis.shoppingSections = savedSec33;

  // 33(c) Guard checks (no false-positive regressions + variety-conflict vocabulary checks)
  const fixtureWithoutChoco33 = { ...fixturePrices33 };
  delete fixtureWithoutChoco33['liebers semi sweet real choco chip'];
  const lemonJuiceMap33 = {
    'lemon juice': { price_cents: 249, store: 'Bingo', bought_name: 'Lemon Juice', receipt_date: '2026-11-10', avg12m_cents: null, last3: [] }
  };
  check('Section 33(c) (false-positive & single-word guards): bare oil/sugar/honey/vinegar/sauce/pasta match nothing; bare chicken != butterfly chicken cutlet; chicken breast != chicken broth; apple cider vinegar != apple; red pepper != red onion; chocolate chip != potato chip; shredded mozzarella -> Part Skim Mozzarella Cheese; lemon -> Lemon Juice',
    priceMatchFor('oil', fixturePrices33) === null &&
    priceMatchFor('sugar', fixturePrices33) === null &&
    priceMatchFor('honey', fixturePrices33) === null &&
    priceMatchFor('vinegar', fixturePrices33) === null &&
    priceMatchFor('sauce', fixturePrices33) === null &&
    priceMatchFor('pasta', fixturePrices33) === null &&
    priceMatchFor('chicken', fixturePrices33) === null &&
    priceMatchFor('beef', fixturePrices33) === null &&
    priceMatchFor('chicken breast', fixturePrices33) === null &&
    priceMatchFor('boneless skinless chicken breast', fixturePrices33) === null &&
    priceMatchFor('apple cider vinegar', fixturePrices33) === null &&
    priceMatchFor('red pepper', fixturePrices33) === null &&
    priceMatchFor('red bell pepper', fixturePrices33) === null &&
    priceMatchFor('chocolate chip', fixtureWithoutChoco33) === null &&
    priceMatchFor('olive oil', fixturePrices33) === null &&
    priceMatchFor('kosher salt', fixturePrices33) === null &&
    priceMatchFor('shredded mozzarella', fixturePrices33)?.bought_name === 'Part Skim Mozzarella Cheese' &&
    priceMatchFor('lemon', lemonJuiceMap33)?.bought_name === 'Lemon Juice');

  check('Section 33(c) (variety-conflict vocabulary across head nouns): conflicting varieties on potato, onion, apple, tomato, cucumber, and vinegar reject while synonymous varieties (russet==idaho, purple==red) and bare heads still match',
    priceMatchFor('red potato', {
      'potato idaho loose': fixturePrices33['potato idaho loose'],
      'potato yukon gold loose': fixturePrices33['potato yukon gold loose']
    }) === null &&
    priceMatchFor('yellow onion', { 'onion red': fixturePrices33['onion red'] }) === null &&
    priceMatchFor('fuji apple', {
      'apple gala': fixturePrices33['apple gala'],
      'apple granny smith': fixturePrices33['apple granny smith']
    }) === null &&
    priceMatchFor('cherry tomato', { 'tomato stem': fixturePrices33['tomato stem'] }) === null &&
    priceMatchFor('kirby cucumber', {
      'cucumber persian': fixturePrices33['cucumber persian'],
      'cucumber hothouse english': fixturePrices33['cucumber hothouse english']
    }) === null &&
    priceMatchFor('rice vinegar', {
      'boulb distilled white vinegar': fixturePrices33['boulb distilled white vinegar']
    }) === null &&
    priceMatchFor('russet potato', { 'potato idaho loose': fixturePrices33['potato idaho loose'] })?.bought_name === 'Potato Idaho - Loose' &&
    priceMatchFor('purple onion', { 'onion red': fixturePrices33['onion red'] })?.bought_name === 'Onion Red' &&
    priceMatchFor('potato', { 'potato idaho loose': fixturePrices33['potato idaho loose'] })?.bought_name === 'Potato Idaho - Loose');

  // 33(d) Direct-map staleness guard & missing-key fall-through check
  const directMapFile33 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-direct-matches.json'), 'utf8'));
  const directKeys33 = Object.keys(directMapFile33);
  const allDirectValuesInFixture33 = directKeys33.every(k => {
    const v = directMapFile33[k];
    const targets = Array.isArray(v) ? v : [v];
    // 'basmati rice' (v20261119a) is a deliberate forward target: no basmati
    // purchase exists yet; the price check creates its entry, and Step 0
    // falls through harmlessly until then.
    return targets.length > 0 && targets.every(t => t === 'basmati rice' || Object.prototype.hasOwnProperty.call(fixturePrices33, t));
  });
  globalThis.priceDirectMatches = { egg: 'stale-missing-egg-key' };
  const fallThroughEgg33 = priceMatchFor('egg', fixturePrices33);
  globalThis.priceDirectMatches = directMapFile33;
  check('Section 33(d) (direct-map staleness & fall-through guard): data/price-direct-matches.json contains the seed entries (incl. v20261119a onion/spanish onion -> onion yellow globe loose, purple onion -> onion red, tomato -> tomato stem, rice -> basmati rice), every mapped value exists in the 101-key fixture (except the deliberate forward target basmati rice), and a direct entry absent from the price map falls through to fuzzy matching instead of returning null',
    directKeys33.length >= 3 &&
    directMapFile33['egg'] === 'jacks f x-large egg' &&
    directMapFile33['yellow potato (the little potato company)'] === 'potato yukon gold loose' &&
    directMapFile33['chicken stock'] === 'tabatchnick broth chicken' &&
    directMapFile33['onion'] === 'onion yellow globe loose' &&
    directMapFile33['spanish onion'] === 'onion yellow globe loose' &&
    directMapFile33['purple onion'] === 'onion red' &&
    directMapFile33['tomato'] === 'tomato stem' &&
    directMapFile33['rice'] === 'basmati rice' &&
    allDirectValuesInFixture33 &&
    !!fallThroughEgg33 &&
    fallThroughEgg33.bought_name === 'X-Large Eggs' &&
    fallThroughEgg33.price_cents === 199);

  // =========================================================================
  // Section 34. Per-lb / per-unit pricing + conversion tables (v20261117a + Bridge git-v15).
  // =========================================================================

  // 34(a) Bridge git-v15 worker.js /health literal + receipts.js per-lb division & basis/qty/pack_size
  const workerV15Path = path.join(SITE_DIR, 'bridge-git-v15', 'worker.js');
  const workerV15Mod = await import(pathToFileURL(workerV15Path).href);
  const healthRes34 = await workerV15Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/health', { method: 'GET' }),
    {}
  );
  const healthJson34 = await healthRes34.json();
  check('Section 34(a) (worker git-v15 /health): bridge-git-v15/worker.js /health reports version "git-v15"',
    healthRes34.status === 200 &&
    healthJson34.ok === true &&
    healthJson34.version === 'git-v15');

  const rows34 = [
    // Weighed Yukon Gold potatoes: 2.00 lb @ $3.46 line total -> $1.73/lb (173 cents), basis: 'lb', qty: 2
    { status: 'verified', needs_review: 0, group_key: 'potato yukon gold loose', paid_price_cents: 346, qty_or_weight: 2.0, unit: 'lb', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Potato Yukon Gold Large - Loose', raw_line: 'POTATO YUKON GOLD', receipt_date: '2026-11-15', receipt_id: 'r34_1', line_no: 1, id: 3401 },
    // Weighed Tomato Stem: 1.45 lb @ $5.03 line total -> Math.round(503 / 1.45) = 347 cents ($3.47/lb), basis: 'lb', qty: 1.45
    { status: 'verified', needs_review: 0, group_key: 'tomato stem', paid_price_cents: 503, qty_or_weight: 1.45, unit: 'lb', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Tomato Stem', raw_line: 'TOMATO STEM', receipt_date: '2026-11-15', receipt_id: 'r34_1', line_no: 2, id: 3402 },
    // Weighed Garlic Loose: 0.15 lb @ $0.45 line total -> 300 cents ($3.00/lb), basis: 'lb', qty: 0.15
    { status: 'verified', needs_review: 0, group_key: 'garlic loose', paid_price_cents: 45, qty_or_weight: 0.15, unit: 'lb', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Garlic Loose', raw_line: 'GARLIC LOOSE', receipt_date: '2026-11-15', receipt_id: 'r34_1', line_no: 3, id: 3403 },
    // Garlic Sleeve: 1 sleeve @ $3.99 (unit='ea', qty=1, pack_size=null -> inferred 'sleeve' from bought_name) -> basis: 'pack', pack_size: 'sleeve'
    { status: 'verified', needs_review: 0, group_key: 'garlic sleeve', paid_price_cents: 399, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Garlic Sleeve', raw_line: 'GARLIC SLEEVE', receipt_date: '2026-11-15', receipt_id: 'r34_1', line_no: 4, id: 3404 },
    // Eggs: 1 carton @ $1.99 (unit='ea', qty=1, pack_size='dozen') -> basis: 'pack', pack_size: 'dozen'
    { status: 'verified', needs_review: 0, group_key: 'jacks f x-large egg', paid_price_cents: 199, qty_or_weight: 1, unit: 'ea', pack_size: 'dozen', store: "Aron's Kissena Farms", product_name: 'X-Large Eggs', raw_line: 'JACKS F X-LARGE EGGS', receipt_date: '2026-11-15', receipt_id: 'r34_1', line_no: 5, id: 3405 },
    // Multi-unit 'ea' broth: 4 cartons @ $10.00 -> 250 cents each, basis: 'each', qty: 4
    { status: 'verified', needs_review: 0, group_key: 'tabatchnick broth chicken', paid_price_cents: 1000, qty_or_weight: 4, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Broth Chicken', raw_line: 'TABATCHNICK BROTH CHICKEN', receipt_date: '2026-11-15', receipt_id: 'r34_1', line_no: 6, id: 3406 }
  ];
  const phRes34 = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv(rows34),
    { nowMs: new Date('2026-11-17T12:00:00Z').getTime() }
  );
  const phJson34 = await phRes34.json();
  const pPotato34 = phJson34.prices['potato yukon gold loose'];
  const pTomato34 = phJson34.prices['tomato stem'];
  const pGarlicLoose34 = phJson34.prices['garlic loose'];
  const pGarlicSleeve34 = phJson34.prices['garlic sleeve'];
  const pEgg34 = phJson34.prices['jacks f x-large egg'];
  const pBroth34 = phJson34.prices['tabatchnick broth chicken'];
  check('Section 34(a) (Bridge git-v15 /price-history per-lb division & basis fields): divides "lb" line totals by qty_or_weight into per-lb rates, preserves "ea" per-unit division, and attaches basis ("lb" | "pack" | "each"), qty, and pack_size',
    !!pPotato34 && pPotato34.price_cents === 173 && pPotato34.basis === 'lb' && pPotato34.qty === 2 &&
    !!pTomato34 && pTomato34.price_cents === 347 && pTomato34.basis === 'lb' && pTomato34.qty === 1.45 &&
    !!pGarlicLoose34 && pGarlicLoose34.price_cents === 300 && pGarlicLoose34.basis === 'lb' && pGarlicLoose34.qty === 0.15 &&
    !!pGarlicSleeve34 && pGarlicSleeve34.price_cents === 399 && pGarlicSleeve34.basis === 'pack' && pGarlicSleeve34.pack_size === 'sleeve' && pGarlicSleeve34.qty === 1 &&
    !!pEgg34 && pEgg34.price_cents === 199 && pEgg34.basis === 'pack' && pEgg34.pack_size === 'dozen' && pEgg34.qty === 1 &&
    !!pBroth34 && pBroth34.price_cents === 250 && pBroth34.basis === 'each' && pBroth34.qty === 4);

  // 34(b) Conversion table values (Yidi-measured precedence + USDA standard coverage) & lookupPriceConversion
  const convTable34 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-conversions.json'), 'utf8'));
  globalThis.priceConversions = convTable34;
  const convKeys34 = Object.keys(convTable34).filter(k => k !== '_meta');
  check('Section 34(b) (data/price-conversions.json schema & Yidi-measured values): comprehensive table (>= 100 entries) with Yidi-measured tomato (0.29 lb), onion (0.72 lb), avocado (0.44 lb), garlic (5 heads/sleeve, 10 cloves/head, 1 tsp/clove, 0.1 lb/head), egg (12/dozen), and chicken cutlet serving (1.25 lb)',
    convKeys34.length >= 100 &&
    convTable34['tomato']?.lb_per_unit === 0.29 &&
    convTable34['onion']?.lb_per_unit === 0.72 &&
    convTable34['red onion']?.lb_per_unit === 0.72 &&
    convTable34['purple onion']?.lb_per_unit === 0.72 &&
    convTable34['yellow onion']?.lb_per_unit === 0.72 &&
    convTable34['avocado']?.lb_per_unit === 0.44 &&
    convTable34['garlic']?.units_per_pack === 5 &&
    convTable34['garlic']?.pack_name === 'sleeve' &&
    convTable34['garlic']?.pack_unit === 'head' &&
    convTable34['garlic']?.cloves_per_head === 10 &&
    convTable34['garlic']?.tsp_per_clove === 1 &&
    convTable34['garlic']?.lb_per_head === 0.1 &&
    convTable34['egg']?.units_per_pack === 12 &&
    convTable34['egg']?.pack_name === 'dozen' &&
    convTable34['butterfly chicken cutlet']?.lb_per_serving === 1.25 &&
    convTable34['chicken breast']?.lb_per_serving === 1.25 &&
    convKeys34.every(k => typeof convTable34[k].source === 'string' && convTable34[k].source.length > 0));

  check('Section 34(b) (lookupPriceConversion resolution & processed-item guard): resolves produce/meat variants and parenthetical brands while rejecting processed pantry items (garlic powder, apple cider vinegar, tomato paste); lemon juice is NOT rejected — it is a real fresh-squeezed conversion (v20261117b)',
    lookupPriceConversion('yellow potato (the little potato company)')?.lb_per_bag === 5.0 &&
    lookupPriceConversion('fresh brussel sprout')?.lb_per_cup === 0.35 &&
    lookupPriceConversion('heart of romaine lettuce')?.lb_per_unit === 0.5 &&
    lookupPriceConversion('purple onion')?.lb_per_unit === 0.72 &&
    lookupPriceConversion('garlic powder') === null &&
    lookupPriceConversion('apple cider vinegar') === null &&
    lookupPriceConversion('tomato paste') === null &&
    lookupPriceConversion('lemon juice')?.tbsp_juice_per_unit === 3);

  // 34(c) Garlic sleeve preference vs loose fallback + Badge rate + basis formatting
  const garlicMapBoth34 = {
    'garlic sleeve': pGarlicSleeve34,
    'garlic loose': pGarlicLoose34
  };
  const garlicMapLooseOnly34 = {
    'garlic loose': pGarlicLoose34
  };
  const matchedGarlicPref34 = priceMatchFor('garlic', garlicMapBoth34);
  const matchedFreshGarlicPref34 = priceMatchFor('fresh garlic', garlicMapBoth34);
  const matchedGarlicFallback34 = priceMatchFor('garlic', garlicMapLooseOnly34);
  check('Section 34(c) (Garlic sleeve preference & loose fallback): priceMatchFor("garlic") prefers "garlic sleeve" ($3.99 sleeve -> $0.80/head) when present with basis, and falls back to "garlic loose" ($3.00/lb) when sleeve is absent',
    !!matchedGarlicPref34 && matchedGarlicPref34.bought_name === 'Garlic Sleeve' &&
    !!matchedFreshGarlicPref34 && matchedFreshGarlicPref34.bought_name === 'Garlic Sleeve' &&
    !!matchedGarlicFallback34 && matchedGarlicFallback34.bought_name === 'Garlic Loose' &&
    formatPriceWithBasis(matchedGarlicPref34.price_cents, matchedGarlicPref34, 'garlic') === '$0.80/head' &&
    formatPriceWithBasis(matchedGarlicFallback34.price_cents, matchedGarlicFallback34, 'garlic') === '$3.00/lb');

  const bagEntry34 = { price_cents: 499, basis: 'pack', pack_size: 'bag', bought_name: 'Potato Yukon Gold Bag', store: 'Bingo', receipt_date: '2026-11-15' };
  const lbEntry34 = { price_cents: 346, basis: 'lb', qty: 1, bought_name: 'Potato Yukon Gold Large - Loose', store: "Aron's Kissena Farms", receipt_date: '2026-11-15' };
  check('Section 34(c) (Badge rate + basis labels): formatPriceWithBasis produces "$3.46/lb", "$0.80/head", "$1.99/dozen", "$2.50 each", and "$4.99/bag"',
    formatPriceWithBasis(lbEntry34.price_cents, lbEntry34, 'yellow potato') === '$3.46/lb' &&
    formatPriceWithBasis(pGarlicSleeve34.price_cents, pGarlicSleeve34, 'garlic') === '$0.80/head' &&
    formatPriceWithBasis(pEgg34.price_cents, pEgg34, 'egg') === '$1.99/dozen' &&
    formatPriceWithBasis(pBroth34.price_cents, pBroth34, 'chicken stock') === '$2.50 each' &&
    formatPriceWithBasis(bagEntry34.price_cents, bagEntry34, 'potato') === '$4.99/bag');

  // 34(d) Estimate multiplication (converted_qty × rate)
  const estPotatoes34 = estimateShopItemCents(
    { base: 'yellow potato', key: 'yellow potato|lb', qty: 1.5, rawUnit: 'lb', unit: 'lb' },
    { price_cents: 346, basis: 'lb', bought_name: 'Potato Yukon Gold Large - Loose' }
  );
  const estTomato34 = estimateShopItemCents(
    { base: 'tomato', key: 'tomato|', qty: 1, rawUnit: '', unit: '' },
    { price_cents: 347, basis: 'lb', bought_name: 'Tomato Stem' }
  );
  const estOnion34 = estimateShopItemCents(
    { base: 'red onion', key: 'red onion|', qty: 1, rawUnit: '', unit: '' },
    { price_cents: 100, basis: 'lb', bought_name: 'Onion Red' }
  );
  const estAvocado34 = estimateShopItemCents(
    { base: 'avocado', key: 'avocado|', qty: 2, rawUnit: '', unit: '' },
    { price_cents: 250, basis: 'lb', bought_name: 'Avocado' }
  );
  const estEggs34 = estimateShopItemCents(
    { base: 'egg', key: 'egg|', qty: 3, rawUnit: '', unit: '' },
    pEgg34
  );
  const estGarlicSleeve2Cloves34 = estimateShopItemCents(
    { base: 'garlic', key: 'garlic|clove', qty: 2, rawUnit: 'clove', unit: 'cloves' },
    pGarlicSleeve34
  );
  const estGarlicSleeveMultiBucket34 = estimateShopItemCents(
    {
      base: 'garlic',
      key: 'garlic|clove',
      qty: 2,
      rawUnit: 'clove',
      unit: 'cloves',
      buckets: [
        { qty: 2, rawUnit: 'clove', unit: 'cloves' },
        { qty: 1, rawUnit: 'tbsp', unit: 'tbsp' }
      ]
    },
    pGarlicSleeve34
  );
  const estGarlicLoose2Cloves34 = estimateShopItemCents(
    { base: 'garlic', key: 'garlic|clove', qty: 2, rawUnit: 'clove', unit: 'cloves' },
    pGarlicLoose34
  );
  const estChickenServing34 = estimateShopItemCents(
    { base: 'butterfly chicken cutlet', key: 'butterfly chicken cutlet|serving', qty: 1, rawUnit: 'serving', unit: 'serving' },
    { price_cents: 699, basis: 'lb', bought_name: 'Butterfly Chicken Cutlets' }
  );
  check('Section 34(d) (Estimate multiplication — converted_qty × rate): potatoes 1.5 lb × $3.46/lb = $5.19 (519¢); tomato 1 × 0.29 lb × $3.47/lb = $1.01 (101¢); onion 1 × 0.72 lb × $1.00/lb = $0.72 (72¢); avocado 2 × 0.44 lb × $2.50/lb = $2.20 (220¢); eggs 3 × ($1.99/12) = $0.50 (50¢); garlic 2 cloves = 0.2 heads × $0.80 = $0.16 (16¢); garlic 2 cloves + 1 tbsp = 0.5 heads × $0.80 = $0.40 (40¢); garlic 2 cloves loose = 0.02 lb × $3.00/lb = $0.06 (6¢); chicken cutlet 1 serving = 1.25 lb × $6.99/lb = $8.74 (874¢)',
    estPotatoes34.convertible && estPotatoes34.cents === 519 &&
    estTomato34.convertible && estTomato34.cents === 101 &&
    estOnion34.convertible && estOnion34.cents === 72 &&
    estAvocado34.convertible && estAvocado34.cents === 220 &&
    estEggs34.convertible && estEggs34.cents === 50 &&
    estGarlicSleeve2Cloves34.convertible && estGarlicSleeve2Cloves34.cents === 16 &&
    estGarlicSleeveMultiBucket34.convertible && estGarlicSleeveMultiBucket34.cents === 40 &&
    estGarlicLoose2Cloves34.convertible && estGarlicLoose2Cloves34.cents === 6 &&
    estChickenServing34.convertible && estChickenServing34.cents === 874);

  // 34(e) Unconvertible fallback (badge still shows rate + basis, row excluded from total, total line notes "N items not estimated")
  const unconvMissingTable34 = estimateShopItemCents(
    { base: 'dragonfruit', key: 'dragonfruit|', qty: 2, rawUnit: '', unit: '' },
    { price_cents: 499, basis: 'lb', bought_name: 'Dragonfruit Loose' }
  );
  const unconvVolumeNoCup34 = estimateShopItemCents(
    { base: 'lemon', key: 'lemon|tbsp', qty: 2, rawUnit: 'tbsp', unit: 'tbsp' },
    { price_cents: 199, basis: 'lb', bought_name: 'Lemon Loose' }
  );
  check('Section 34(e) (estimateShopItemCents unconvertible guard): returns { convertible: false, cents: 0 } when a per-lb item has no conversion entry or has a volume unit without lb_per_cup',
    unconvMissingTable34.convertible === false && unconvMissingTable34.cents === 0 &&
    unconvVolumeNoCup34.convertible === false && unconvVolumeNoCup34.cents === 0);

  // Render shoppingListHTML with 1 convertible item (1.5 lb yellow potatoes @ $3.46/lb = $5.19) + 1 unconvertible item (2 dragonfruit @ $4.99/lb)
  const savedPlan34e = globalThis.mealPlan;
  const savedRecipes34e = globalThis.recipes;
  const savedMetaById34e = globalThis.metaById;
  const savedById34e = globalThis.byId;
  const savedSec34e = globalThis.shoppingSections;
  const savedStore34e = getShopStore();
  setShopStore('all');
  setMeta([{ id: 'test-unconv-34', title: 'Test Unconvertible Dish', kosher_status: 'pareve', categories: ['main'] }]);
  globalThis.byId = {
    'test-unconv-34': {
      id: 'test-unconv-34',
      title: 'Test Unconvertible Dish',
      ingredients: [{
        section: 'Main',
        items: [
          { qty: '1.5', unit: 'lb', item: 'yellow potatoes' },
          { qty: '2', unit: '', item: 'dragonfruit' }
        ]
      }]
    }
  };
  globalThis.shoppingSections = { departments: ['Fresh Produce'], fallbackDepartment: 'Unsorted' };
  const wkDays34e = blankDays();
  wkDays34e[0].dinner.dishes = [{ recipe: 'test-unconv-34', drafted: false }];
  setPlan({ [thisWeekKey()]: { days: wkDays34e, shoppingDay: thisWeekKey() } });
  setPriceHistoryCache({
    'potato yukon gold loose': { price_cents: 346, basis: 'lb', qty: 1, store: "Aron's", bought_name: 'Potato Yukon Gold Large - Loose', receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] },
    'dragonfruit': { price_cents: 499, basis: 'lb', qty: 1, store: "Aron's", bought_name: 'Dragonfruit Loose', receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] }
  });
  const htmlUnconv34 = shoppingListHTML();
  check('Section 34(e) (shoppingListHTML unconvertible fallback): unconvertible row still renders its "$4.99/lb" badge, is excluded from the $5.19 estimated total, and the total line notes "1 item not estimated"',
    htmlUnconv34.includes('Potato Yukon Gold Large - Loose · $3.46/lb') &&
    htmlUnconv34.includes('Dragonfruit Loose · $4.99/lb') &&
    htmlUnconv34.includes('Estimated total about $5.19 · 1 of 2 items priced · 1 item not estimated'));

  // 34(f) Full-corpus live-week (2026-11-15) before/after verification with basis-aware 101-key fixture
  const parsedFixture34 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'smart-planning', 'price-history-fixture-20261117.json'), 'utf8'));
  const rawFixture34 = parsedFixture34.prices || parsedFixture34;
  // Enrich the 101-key fixture with git-v15 basis + pack_size fields (matching receipts.js rules)
  const fixturePrices34 = {};
  for (const [k, orig] of Object.entries(rawFixture34)) {
    const e = JSON.parse(JSON.stringify(orig));
    const bn = String(e.bought_name || '') + ' ' + k;
    const isLooseProduce = /\b(loose|tomato stem|onion red|onion shallots|apple gala|apple granny|banana|cucumber|avocado|lemon|lime|yam sweet|grape red|plum red|brussel sprouts|parsley italian|cilantro|dill|garlic loose|Cutlets|neck bones|beef patina)\b/i.test(bn) &&
      !/\b(sleeve|bag|box|3pk|pack|egg|juice|vinegar|broth|beans|milk|fettuccine|chips|oil|sugar|salt|flour|sauce|paste|cereal|cookie|cracker|pretzel|cake|bread|roll|pita|bagel|cheese|butter|yogurt|cream|mayo|mustard|ketchup|relish|pickle|olive|tuna|salmon|sardine|gef|herring|choc|cocoa|vanilla|baking|spice|pepper|paprika|cumin|cinnamon|turmeric|oregano|basil|thyme|rosemary|bay|parsley flake|garlic powder|onion powder|soup|noodle|rice|barley|oats|quinoa|lentil|split pea|lemon|lime)\b/i.test(bn);
    const packMatch = bn.match(/\b(sleeve|bag|carton|box|bunch|dozen|doz|\d+\s*(?:pk|pack))\b/i);
    const isEgg = /\beggs?\b/i.test(bn) && !/\b(noodle|pasta|roll|wrap|eggplant)\b/i.test(bn);
    if (isLooseProduce) {
      e.basis = 'lb';
      e.qty = 1;
    } else if (packMatch || isEgg) {
      e.basis = 'pack';
      e.qty = 1;
      e.pack_size = packMatch ? packMatch[1].toLowerCase().replace(/\s+/g, '') : 'dozen';
    } else {
      e.basis = 'each';
      e.qty = 1;
    }
    fixturePrices34[k] = e;
  }

  const savedThisWeekKey34 = globalThis.thisWeekKey;
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
  setPriceHistoryCache(fixturePrices34);
  const liveWeekList34 = buildShoppingList();
  const split34 = splitShopItems(liveWeekList34, getWeek('2026-11-15'));
  const activeToBuy34 = partitionStaples(split34.toBuy, getWeek('2026-11-15')).active;
  const toBuyBreakdown34 = activeToBuy34
    .map(it => {
      const m = priceMatchFor(it, fixturePrices34);
      if (!m) return null;
      const est = estimateShopItemCents(it, m);
      return {
        base: it.base,
        label: it.label,
        bought_name: m.bought_name,
        basis: m.basis,
        badgeRate: formatPriceWithBasis(m.price_cents, m, it),
        beforeCents: m.price_cents,
        afterCents: est.cents,
        convertible: est.convertible
      };
    })
    .filter(Boolean);
  const liveShopHTML34 = shoppingListHTML();

  // Verify the 8 active To-buy matched items on live week 2026-11-15 (v20261117b adds lemon juice):
  // 1. white vinegar (½ cup) -> Distilled White Vinegar 5% Acidity ($2.00 each) -> 200¢ ($2.00)
  // 2. yellow potato (1½ lb) -> Potato Yukon Gold Large - Loose ($3.46/lb) -> 519¢ ($5.19)
  // 3. tomato (1) -> Tomato Stem ($5.03/lb * 0.29 lb) -> 146¢ ($1.46)
  // 4. garlic (2 cloves = 0.2 heads) -> Garlic Sleeve ($0.80/head) -> 16¢ ($0.16)
  // 5. egg (3) -> X-Large Eggs ($1.99/dozen) -> 50¢ ($0.50)
  // 6. black bean (15 oz) (1 can) -> Black Beans ($0.99 each) -> 99¢ ($0.99)
  // 7. chicken stock (1 cup) -> Broth Chicken ($2.50 each) -> 250¢ ($2.50)
  // 8. lemon juice (4 tsp, Burritos only in this week's To-buy) -> Lemon Small ($0.30 each; 4 tsp = 4/9 lemon) -> 13¢ ($0.13)
  // Sum after = 200 + 519 + 146 + 16 + 50 + 99 + 250 + 13 = 1293¢ ($12.93) vs v20261116a sum = 1642¢ ($16.42) and v20261117a sum = 1280¢ ($12.80)
  const sumAfter34 = toBuyBreakdown34.reduce((s, x) => s + x.afterCents, 0);
  check('Section 34(f) (Live-week 2026-11-15 full-corpus before/after check): all 8 priced To-buy items convert cleanly (0 unconvertible), garlic switches from Garlic Loose to Garlic Sleeve ($0.80/head, $0.16 for 2 cloves), eggs scale to 3/12 dozen ($0.50), potatoes scale to 1.5 lb ($5.19), tomato scales by 0.29 lb ($1.46), lemon juice prices from the fruit (4 tsp = 4/9 lemon x $0.30 = $0.13), and rendered total updates from $16.42 to $12.93 (8 of 33 items priced)',
    toBuyBreakdown34.length === 8 &&
    toBuyBreakdown34.every(x => x.convertible) &&
    toBuyBreakdown34.find(x => x.base === 'garlic')?.bought_name === 'Garlic Sleeve' &&
    toBuyBreakdown34.find(x => x.base === 'garlic')?.badgeRate === '$0.80/head' &&
    toBuyBreakdown34.find(x => x.base === 'garlic')?.afterCents === 16 &&
    toBuyBreakdown34.find(x => x.base === 'egg')?.badgeRate === '$1.99/dozen' &&
    toBuyBreakdown34.find(x => x.base === 'egg')?.afterCents === 50 &&
    toBuyBreakdown34.find(x => x.base === 'tomato')?.afterCents === 146 &&
    toBuyBreakdown34.find(x => x.base === 'yellow potato (the little potato company)')?.afterCents === 519 &&
    toBuyBreakdown34.find(x => x.base === 'lemon juice')?.badgeRate === '$0.30 each' &&
    toBuyBreakdown34.find(x => x.base === 'lemon juice')?.afterCents === 13 &&
    sumAfter34 === 1293 &&
    liveShopHTML34.includes('Estimated total about $12.93 · 8 of 33 items priced') &&
    !liveShopHTML34.includes('items not estimated'));

  // 34(g) Lemon / lime juice squeezed from fruit (v20261117b): direct matches
  // (lemon juice -> lemon, lime juice -> lime), juice yields (1 lemon = 3 tbsp,
  // 1 lime = 2 tbsp, USDA), and Case J estimates (volume -> fruit count).
  const pLemon34 = { price_cents: 30, basis: 'each', bought_name: 'Lemon Small' };
  const pLime34 = { price_cents: 30, basis: 'each', bought_name: 'Limes' };
  const matchedLemonJuice34 = priceMatchFor('lemon juice', { 'lemon': pLemon34 });
  const matchedFreshLemonJuice34 = priceMatchFor('fresh lemon juice', { 'lemon': pLemon34 });
  const matchedLimeJuice34 = priceMatchFor('lime juice', { 'lime': pLime34 });
  const estLemonJuiceTbsp34 = estimateShopItemCents(
    { base: 'lemon juice', key: 'lemon juice|tbsp', qty: 1, rawUnit: 'tbsp', unit: 'tbsp' },
    pLemon34
  );
  const estLemonJuiceTsp34 = estimateShopItemCents(
    { base: 'lemon juice', key: 'lemon juice|tsp', qty: 1, rawUnit: 'tsp', unit: 'tsp' },
    pLemon34
  );
  const estLimeJuice2Tsp34 = estimateShopItemCents(
    { base: 'lime juice', key: 'lime juice|tsp', qty: 2, rawUnit: 'tsp', unit: 'tsp' },
    pLime34
  );
  const estFreshLemonJuiceTbsp34 = estimateShopItemCents(
    { base: 'fresh lemon juice', key: 'fresh lemon juice|tbsp', qty: 1, rawUnit: 'tbsp', unit: 'tbsp' },
    pLemon34
  );
  check('Section 34(g) (Lemon / lime juice from fruit — v20261117b): direct matches resolve lemon juice / fresh lemon juice -> lemon and lime juice -> lime; juice yields are 3 tbsp/lemon and 2 tbsp/lime; estimates are 1 tbsp lemon juice = 1/3 lemon x $0.30 = $0.10 (10c), 1 tsp lemon juice = 1/9 lemon x $0.30 = $0.03 (3c), 2 tsp lime juice = 1/3 lime x $0.30 = $0.10 (10c), 1 tbsp fresh lemon juice = $0.10 (10c)',
    !!matchedLemonJuice34 && matchedLemonJuice34.bought_name === 'Lemon Small' &&
    !!matchedFreshLemonJuice34 && matchedFreshLemonJuice34.bought_name === 'Lemon Small' &&
    !!matchedLimeJuice34 && matchedLimeJuice34.bought_name === 'Limes' &&
    lookupPriceConversion('lemon juice')?.tbsp_juice_per_unit === 3 &&
    lookupPriceConversion('lime juice')?.tbsp_juice_per_unit === 2 &&
    lookupPriceConversion('fresh lemon juice')?.tbsp_juice_per_unit === 3 &&
    estLemonJuiceTbsp34.convertible && estLemonJuiceTbsp34.cents === 10 &&
    estLemonJuiceTsp34.convertible && estLemonJuiceTsp34.cents === 3 &&
    estLimeJuice2Tsp34.convertible && estLimeJuice2Tsp34.cents === 10 &&
    estFreshLemonJuiceTbsp34.convertible && estFreshLemonJuiceTbsp34.cents === 10);

  // Restore state after Section 34
  globalThis.thisWeekKey = savedThisWeekKey34;
  globalThis.mealPlan = savedPlan34e;
  globalThis.recipes = savedRecipes34e;
  globalThis.metaById = savedMetaById34e;
  globalThis.byId = savedById34e;
  globalThis.shoppingSections = savedSec34e;
  setShopStore(savedStore34e);
  resetPriceHistorySession();

  // =========================================================================
  // Section 35. Weekly Circular Pipeline + Two-Price Shopping-List Model (PLAN.md).
  // =========================================================================

  // 35(a) Circular data files + current-prices/latest.json + sundayWeekKey UTC math + chicken direct matches
  const circIndex35 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'circulars', 'index.json'), 'utf8'));
  const circItems35 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'circulars', '2026-11-15', 'items.json'), 'utf8'));
  const circRates35 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'circulars', 'rates-by-week.json'), 'utf8'));
  const latestPrices35 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'current-prices', 'latest.json'), 'utf8'));
  const directMatches35 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-direct-matches.json'), 'utf8'));
  const meatLbItems35 = (circItems35.items || []).filter(it => it.section === 'Meat' && it.basis === 'lb');
  const produceItems35 = (circItems35.items || []).filter(it => it.section === 'Produce');
  const multiBuyItems35 = (circItems35.items || []).filter(it => Boolean(it.multi_buy));
  check('Section 35(a) (Circular & current-prices data files + sundayWeekKey UTC math + chicken direct matches): sundayWeekKey computes pure UTC Sunday week keys; data/circulars/2026-11-15/items.json has >=5 Meat /lb items, >=5 Produce items, multi_buy examples, and matches rates-by-week.json; data/price-direct-matches.json maps 4 chicken breast/cutlet keys to "butterfly chicken cutlet"',
    receiptsMod.sundayWeekKey('2026-11-15') === '2026-11-15' &&
    receiptsMod.sundayWeekKey('2026-11-18') === '2026-11-15' &&
    receiptsMod.sundayWeekKey('2026-11-21') === '2026-11-15' &&
    receiptsMod.sundayWeekKey('2026-11-22') === '2026-11-22' &&
    circIndex35.latest_week === '2026-11-15' &&
    meatLbItems35.length >= 5 &&
    produceItems35.length >= 5 &&
    multiBuyItems35.length >= 2 &&
    circRates35['2026-11-15']?.['butterfly chicken cutlet']?.price_cents === 799 &&
    circRates35['2026-11-15']?.['butterfly chicken cutlet']?.basis === 'lb' &&
    circRates35['2026-11-15']?.['butterfly chicken cutlet']?.reg_price_cents === 999 &&
    latestPrices35.week === '2026-11-15' &&
    latestPrices35.items?.['butterfly chicken cutlet']?.price_cents === 999 &&
    directMatches35['chicken breast'] === 'butterfly chicken cutlet' &&
    directMatches35['boneless skinless chicken breast'] === 'butterfly chicken cutlet' &&
    directMatches35['boneless chicken breast'] === 'butterfly chicken cutlet' &&
    directMatches35['chicken cutlet'] === 'butterfly chicken cutlet');

  // 35(b) Worker isolate caching for rates-by-week.json and latest.json (5-min TTL + fail-soft)
  receiptsMod.clearPriceDataCaches();
  let fetchCalls35b = 0;
  const mockFetch35b = async (url) => {
    fetchCalls35b++;
    if (String(url).includes('rates-by-week.json')) {
      return { ok: true, json: async () => circRates35 };
    }
    if (String(url).includes('latest.json')) {
      return { ok: true, json: async () => latestPrices35 };
    }
    return { ok: false };
  };
  const r1_35b = await receiptsMod.getCircularRates({ fetchImpl: mockFetch35b });
  const r2_35b = await receiptsMod.getCircularRates({ fetchImpl: mockFetch35b });
  const c1_35b = await receiptsMod.getCurrentPrices({ fetchImpl: mockFetch35b });
  const c2_35b = await receiptsMod.getCurrentPrices({ fetchImpl: mockFetch35b });
  receiptsMod.clearPriceDataCaches();
  const failSoftRates35b = await receiptsMod.getCircularRates({
    fetchImpl: async () => { throw new Error('network timeout'); }
  });
  const failSoftCurr35b = await receiptsMod.getCurrentPrices({
    fetchImpl: async () => { throw new Error('network timeout'); }
  });
  check('Section 35(b) (Worker isolate caching & fail-soft): getCircularRates and getCurrentPrices cache responses per isolate (1 fetch each across repeated calls within 5-min TTL) and fail-soft to {} / null on network timeout',
    fetchCalls35b === 2 &&
    r1_35b === r2_35b &&
    r1_35b['2026-11-15']?.['butterfly chicken cutlet']?.price_cents === 799 &&
    c1_35b === c2_35b &&
    c1_35b?.week === '2026-11-15' &&
    typeof failSoftRates35b === 'object' && Object.keys(failSoftRates35b).length === 0 &&
    failSoftCurr35b === null);

  // 35(c) Same-week circular backfill + pack_unweighed hard guard in handlePriceHistory
  const rows35c = [
    // Weight-less Aron's chicken cutlet line on 2026-11-15 (week HAS circular $7.99/lb): backfilled to 799¢/lb, implied_qty_lb = 3.76
    { status: 'verified', needs_review: 0, group_key: 'butterfly chicken cutlet', paid_price_cents: 3004, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Butterfly Chicken Cutlets', raw_line: 'BUTTERFLY CHICKEN CUTLETS', receipt_date: '2026-11-15', receipt_id: 'r35_1', line_no: 1, id: 3501 },
    // Weight-less Aron's marrow bone line on 2026-11-08 (week has NO circular entry): must get basis: 'pack_unweighed'
    { status: 'verified', needs_review: 0, group_key: 'marrow bone', paid_price_cents: 1450, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Beef Marrow Bones', raw_line: 'BEEF MARROW BONES', receipt_date: '2026-11-08', receipt_id: 'r35_2', line_no: 1, id: 3502 }
  ];
  const phRes35c = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv(rows35c),
    {
      nowMs: new Date('2026-11-17T12:00:00Z').getTime(),
      currentWeekKey: '2026-11-15',
      circularRates: { '2026-11-15': { 'butterfly chicken cutlet': circRates35['2026-11-15']['butterfly chicken cutlet'] } },
      currentPrices: latestPrices35
    }
  );
  const phJson35c = await phRes35c.json();
  const pChickenBackfilled35c = phJson35c.prices['butterfly chicken cutlet'];
  const pMarrowUnweighed35c = phJson35c.prices['marrow bone'];
  const unweighedChickenOnly35c = {
    price_cents: 3004,
    store: "Aron's Kissena Farms",
    bought_name: 'Butterfly Chicken Cutlets',
    receipt_date: '2026-11-08',
    basis: 'pack_unweighed',
    source: 'receipt',
    receipt_paid_cents: 3004
  };
  const unweighedEst35c = estimateShopItemCents(
    { base: 'boneless skinless chicken breast', key: 'boneless skinless chicken breast|', qty: 4, rawUnit: '', unit: '' },
    unweighedChickenOnly35c
  );
  check('Section 35(c) (Circular backfill & pack_unweighed guard): weight-less Aron\'s chicken cutlet on 2026-11-15 backfills to 799¢/lb (source: "circular", receipt_paid_cents: 3004, implied_qty_lb: 3.76); weight-less meat without circular match gets basis: "pack_unweighed", badges "$30.04 pack", and is excluded from cart estimates (convertible: false)',
    !!pChickenBackfilled35c &&
    pChickenBackfilled35c.price_cents === 799 &&
    pChickenBackfilled35c.basis === 'lb' &&
    pChickenBackfilled35c.source === 'circular' &&
    pChickenBackfilled35c.circular_week === '2026-11-15' &&
    pChickenBackfilled35c.receipt_paid_cents === 3004 &&
    pChickenBackfilled35c.implied_qty_lb === 3.76 &&
    !!pMarrowUnweighed35c &&
    pMarrowUnweighed35c.price_cents === 1450 &&
    pMarrowUnweighed35c.basis === 'pack_unweighed' &&
    pMarrowUnweighed35c.source === 'receipt' &&
    pMarrowUnweighed35c.receipt_paid_cents === 1450 &&
    formatPriceWithBasis(3004, unweighedChickenOnly35c, 'chicken breast') === '$30.04 pack' &&
    unweighedEst35c.convertible === false &&
    unweighedEst35c.cents === 0);

  // 35(d) Guard 2a (Active-week expiry), Guard 2b (reg_price_cents preservation), Rank 1 (Expected-only entries), Rank 2 (stale latest.json)
  const pBrisketExpectedOnly35d = phJson35c.prices['first cut brisket'];
  const pOliveOilExpectedOnly35d = phJson35c.prices['extra virgin olive oil'];
  const matchedBrisket35d = priceMatchFor('brisket', phJson35c.prices);
  const estBrisket35d = estimateShopItemCents(
    { base: 'brisket', key: 'brisket|lb', qty: 3, rawUnit: 'lb', unit: 'lb' },
    matchedBrisket35d
  );
  // Now test week rollover to 2026-11-22 where circularRates only has 2026-11-15 and latestPrices35 has week 2026-11-15:
  const phResExpired35d = await receiptsMod.handlePriceHistory(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
    makeMockEnv(rows35c),
    {
      nowMs: new Date('2026-11-23T12:00:00Z').getTime(),
      currentWeekKey: '2026-11-22',
      circularRates: { '2026-11-15': { 'butterfly chicken cutlet': circRates35['2026-11-15']['butterfly chicken cutlet'] } },
      currentPrices: latestPrices35
    }
  );
  const phJsonExpired35d = await phResExpired35d.json();
  const pChickenExpired35d = phJsonExpired35d.prices['butterfly chicken cutlet'];
  check('Section 35(d) (Guard 2a active-week expiry, Guard 2b reg_price_cents, Rank 1 expected-only entries, Rank 2 stale latest.json): active circular preserves reg_price_cents (999¢); expected-only items (price_cents: null) are emitted for non-receipt items and convert cleanly; when week rolls to 2026-11-22, the 2026-11-15 circular sale expires for expected while keeping historical receipt backfill, and 2026-11-15 online-store is marked stale: true',
    pChickenBackfilled35c.expected?.price_cents === 799 &&
    pChickenBackfilled35c.expected?.source === 'circular' &&
    pChickenBackfilled35c.expected?.week === '2026-11-15' &&
    pChickenBackfilled35c.expected?.reg_price_cents === 999 &&
    !!pBrisketExpectedOnly35d &&
    pBrisketExpectedOnly35d.price_cents === null &&
    pBrisketExpectedOnly35d.expected?.price_cents === 1699 &&
    pBrisketExpectedOnly35d.expected?.source === 'online-store' &&
    !!pOliveOilExpectedOnly35d &&
    pOliveOilExpectedOnly35d.price_cents === null &&
    pOliveOilExpectedOnly35d.expected?.price_cents === 1199 &&
    !!matchedBrisket35d &&
    estBrisket35d.convertible === true &&
    estBrisket35d.cents === 5097 &&
    // On 2026-11-22: historical receipt from 2026-11-15 STILL has circular backfill 799¢/lb,
    // but expected is NO LONGER circular 799¢ — it falls back to online-store 999¢ with stale: true!
    pChickenExpired35d.price_cents === 799 &&
    pChickenExpired35d.source === 'circular' &&
    pChickenExpired35d.expected?.source === 'online-store' &&
    pChickenExpired35d.expected?.price_cents === 999 &&
    pChickenExpired35d.expected?.stale === true);

  // 35(e) Edge 1a (Store-picker isolation) & Edge 1b (Basis-matched deal comparison)
  const multiStoreWithExp35e = {
    price_cents: 249,
    store: "Aron's Kissena Farms",
    bought_name: 'Persian Cucumbers',
    receipt_date: '2026-11-10',
    basis: 'lb',
    by_store: {
      arons: { price_cents: 249, store: "Aron's Kissena Farms", bought_name: 'Persian Cucumbers', receipt_date: '2026-11-10', basis: 'lb' },
      bingo: { price_cents: 179, store: 'Bingo Wholesale', bought_name: 'Persian Cucumbers', receipt_date: '2026-11-05', basis: 'lb' }
    },
    last3: [
      { price_cents: 249, store: "Aron's Kissena Farms", bought_name: 'Persian Cucumbers', receipt_date: '2026-11-10', basis: 'lb' },
      { price_cents: 179, store: 'Bingo Wholesale', bought_name: 'Persian Cucumbers', receipt_date: '2026-11-05', basis: 'lb' }
    ],
    expected: {
      price_cents: 149,
      basis: 'lb',
      source: 'circular',
      store: "Aron's Kissena Farms",
      week: '2026-11-15',
      reg_price_cents: 249
    }
  };
  const hitArons35e = entryPriceAtStore(multiStoreWithExp35e, 'arons');
  const hitBingo35e = entryPriceAtStore(multiStoreWithExp35e, 'bingo');
  const hitExpOnlyArons35e = entryPriceAtStore(pBrisketExpectedOnly35d, 'arons');
  const hitExpOnlyBingo35e = entryPriceAtStore(pBrisketExpectedOnly35d, 'bingo');
  const elseExpOnlyBingo35e = entryPriceElsewhere(pBrisketExpectedOnly35d, 'bingo');

  // Cross-basis garlic: Last purchase is Garlic Sleeve ($3.99 / 5-head sleeve = $0.80/head), Expected is loose garlic ($2.99/lb)
  const crossBasisGarlic35e = {
    price_cents: 399,
    store: "Aron's Kissena Farms",
    bought_name: 'Garlic Sleeve',
    receipt_date: '2026-11-10',
    basis: 'pack',
    pack_size: 'sleeve',
    expected: {
      price_cents: 299,
      basis: 'lb',
      source: 'online-store',
      store: "Aron's Kissena Farms",
      week: '2026-11-15',
      raw_name: 'Garlic Loose'
    }
  };
  const cmpCrossNoQty35e = compareExpectedVsLast('garlic', crossBasisGarlic35e);
  const cmpCrossWithQty35e = compareExpectedVsLast(
    { base: 'garlic', key: 'garlic|clove', qty: 2, rawUnit: 'clove', unit: 'clove' },
    crossBasisGarlic35e
  );
  const cmpSameBasisCheaper35e = compareExpectedVsLast('persian cucumber', multiStoreWithExp35e);
  check('Section 35(e) (Edge 1a store-picker isolation & Edge 1b basis-matched comparison): expected attaches to Aron\'s hits but never to Bingo/TJ\'s; expected-only items return null at Bingo and do NOT synthesize a fake past purchase via entryPriceElsewhere; cross-basis garlic ($0.80/head sleeve vs $2.99/lb loose) returns null when unquantified and compares converted item cents when quantified',
    !!hitArons35e && !!hitArons35e.expected && hitArons35e.expected.price_cents === 149 &&
    !!hitBingo35e && hitBingo35e.expected === undefined && hitBingo35e.price_cents === 179 &&
    !!hitExpOnlyArons35e && hitExpOnlyArons35e.price_cents === null && hitExpOnlyArons35e.expected?.price_cents === 1699 &&
    hitExpOnlyBingo35e === null &&
    elseExpOnlyBingo35e === null &&
    cmpCrossNoQty35e === null &&
    cmpCrossWithQty35e === 'cheaper' &&
    cmpSameBasisCheaper35e === 'cheaper');

  // 35(f) Live-week 2026-11-15 shopping list rendering with two-price model + pack_unweighed safety check
  const savedThisWeekKey35 = globalThis.thisWeekKey;
  const savedPlan35 = globalThis.mealPlan;
  const savedRecipes35 = globalThis.recipes;
  const savedMetaById35 = globalThis.metaById;
  const savedById35 = globalThis.byId;
  const savedSec35 = globalThis.shoppingSections;
  const savedLocal35 = globalThis.localStorage;
  globalThis.localStorage = stubStorage({});
  const savedStore35 = getShopStore();

  globalThis.thisWeekKey = () => '2026-11-15';
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
  setShopStore('all');

  // Case 1: butterfly chicken cutlet has circular backfill ($7.99/lb, paid $30.04, ~3.76 lb) + active circular sale ($7.99/lb, reg $9.99)
  const pricesWithTwoPriceChicken35f = JSON.parse(JSON.stringify(fixturePrices34));
  pricesWithTwoPriceChicken35f['butterfly chicken cutlet'] = {
    price_cents: 799,
    store: "Aron's Kissena Farms",
    bought_name: 'Butterfly Chicken Cutlets',
    receipt_date: '2026-11-15',
    avg12m_cents: 799,
    basis: 'lb',
    source: 'circular',
    circular_week: '2026-11-15',
    receipt_paid_cents: 3004,
    implied_qty_lb: 3.76,
    by_store: {
      arons: {
        price_cents: 799,
        store: "Aron's Kissena Farms",
        bought_name: 'Butterfly Chicken Cutlets',
        receipt_date: '2026-11-15',
        basis: 'lb',
        source: 'circular',
        circular_week: '2026-11-15',
        receipt_paid_cents: 3004,
        implied_qty_lb: 3.76
      }
    },
    last3: [
      {
        price_cents: 799,
        store: "Aron's Kissena Farms",
        bought_name: 'Butterfly Chicken Cutlets',
        receipt_date: '2026-11-15',
        basis: 'lb',
        source: 'circular',
        circular_week: '2026-11-15',
        receipt_paid_cents: 3004,
        implied_qty_lb: 3.76
      }
    ],
    expected: {
      price_cents: 799,
      basis: 'lb',
      source: 'circular',
      store: "Aron's Kissena Farms",
      week: '2026-11-15',
      reg_price_cents: 999,
      raw_name: 'Fresh Family Pack Butterfly Chicken Cutlets'
    }
  };
  setPriceHistoryCache(pricesWithTwoPriceChicken35f);
  const htmlTwoPrice35f = shoppingListHTML();

  // Case 2: butterfly chicken cutlet is pack_unweighed ($30.04) with NO expected
  const pricesWithUnweighedChicken35f = JSON.parse(JSON.stringify(fixturePrices34));
  pricesWithUnweighedChicken35f['butterfly chicken cutlet'] = unweighedChickenOnly35c;
  setPriceHistoryCache(pricesWithUnweighedChicken35f);
  const htmlUnweighed35f = shoppingListHTML();

  // Case 3: Shopping at Bingo with two-price chicken (which only has Aron's history + Aron's expected)
  setShopStore('bingo');
  setPriceHistoryCache(pricesWithTwoPriceChicken35f);
  const htmlBingoIsolation35f = shoppingListHTML();

  globalThis.thisWeekKey = savedThisWeekKey35;
  globalThis.mealPlan = savedPlan35;
  globalThis.recipes = savedRecipes35;
  globalThis.metaById = savedMetaById35;
  globalThis.byId = savedById35;
  globalThis.shoppingSections = savedSec35;
  setShopStore(savedStore35);
  globalThis.localStorage = savedLocal35;
  resetPriceHistorySession();

  check('Section 35(f) (Shopping List two-price badge, detail provenance, pack_unweighed UI guard, & Bingo store isolation): 4 boneless skinless chicken breasts (2.0 lb) with circular sale renders "Butterfly Chicken Cutlets · Now $7.99/lb sale (reg $9.99) · Last $7.99/lb Nov 15", detail shows "(circular rate · paid $30.04, ~3.76 lb)", and total is $28.91 (9 of 33 priced); when pack_unweighed without expected, badges "$30.04 pack" and total stays $12.93 with "1 item not estimated"; when Shopping at Bingo, Aron\'s expected sale never leaks into Bingo',
    htmlTwoPrice35f.includes('Butterfly Chicken Cutlets · Now $7.99/lb sale (reg $9.99) · Last $7.99/lb Nov 15') &&
    htmlTwoPrice35f.includes('circular rate · paid $30.04, ~3.76 lb') &&
    htmlTwoPrice35f.includes('Estimated total about $28.91 · 9 of 33 items priced') &&
    htmlUnweighed35f.includes('Butterfly Chicken Cutlets · $30.04 pack · Aron&#39;s Kissena Farms · Nov 8') &&
    htmlUnweighed35f.includes('Estimated total about $12.93 · 8 of 33 items priced · 1 item not estimated') &&
    !htmlBingoIsolation35f.includes('Now $7.99/lb sale') &&
    htmlBingoIsolation35f.includes('last bought at Aron&#39;s $7.99/lb · Nov 15 — no Bingo price yet'));

  // 35(g) Bridge /price-check-flag endpoint & HARD REQUIREMENT on flag clearing
  const workerV16Mod = await import(pathToFileURL(path.join(SITE_DIR, 'bridge-git-v16', 'worker.js')).href);
  if (typeof workerV16Mod.resetMemoryPriceCheckFlag === 'function') {
    workerV16Mod.resetMemoryPriceCheckFlag();
  }
  const flagGet0_35g = await (await workerV16Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', { method: 'GET' }),
    {}
  )).json();
  const flagSet_35g = await (await workerV16Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requested: true, week: '2026-11-15' })
    }),
    {}
  )).json();
  // Attempt to clear WITHOUT latest_written -> must fail (409) and stay requested: true
  const clearNoLatestRes_35g = await workerV16Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', week: '2026-11-15' })
    }),
    {}
  );
  const clearNoLatest_35g = await clearNoLatestRes_35g.json();
  // Attempt to clear on Turnstile/browser failure -> must fail (409) and stay requested: true
  const clearFailedRes_35g = await workerV16Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', week: '2026-11-15', latest_written: true, turnstile_blocked: true })
    }),
    {}
  );
  const clearFailed_35g = await clearFailedRes_35g.json();
  // Attempt to clear on empty shopping list -> must fail (409) and stay requested: true
  const clearEmptyRes_35g = await workerV16Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', week: '2026-11-15', latest_written: true, item_count: 0 })
    }),
    {}
  );
  const clearEmpty_35g = await clearEmptyRes_35g.json();
  // Valid clear after latest.json written with item_count > 0 -> succeeds (200) and sets requested: false
  const clearOkRes_35g = await workerV16Mod.default.fetch(
    new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', week: '2026-11-15', latest_written: true, item_count: 6 })
    }),
    {}
  );
  const clearOk_35g = await clearOkRes_35g.json();
  check('Section 35(g) (Bridge /price-check-flag & HARD REQUIREMENT on flag clearing): sets flag on POST {requested: true}, refuses to clear without latest_written=true or on failure/Turnstile block or on empty shopping list (409, requested stays true), and clears ONLY after latest.json is written with item_count > 0',
    flagGet0_35g.ok === true && flagGet0_35g.requested === false &&
    flagSet_35g.ok === true && flagSet_35g.requested === true && flagSet_35g.week === '2026-11-15' &&
    clearNoLatestRes_35g.status === 409 && clearNoLatest_35g.requested === true &&
    clearFailedRes_35g.status === 409 && clearFailed_35g.requested === true &&
    clearEmptyRes_35g.status === 409 && clearEmpty_35g.requested === true &&
    clearOkRes_35g.status === 200 && clearOk_35g.ok === true && clearOk_35g.cleared === true &&
    clearOk_35g.requested === false && clearOk_35g.last_checked_week === '2026-11-15');

  // Section 36 — Shopping-list manual-add keyboard bug (v20261118b): the 15s
  // poll rebuilt the whole shopping page on every tick even when nothing
  // changed, destroying the focused #shop-new input (text + keyboard).
  // (a) pollShopServer skips the rebuild when the server content is
  // byte-identical to the last merged copy, and re-renders when it changes
  // (a Nava update always changes the file content, so it still lands).
  const savedFetch36 = globalThis.fetch;
  const savedRenderShopWrap36 = globalThis.renderShopWrap;
  const savedMergeMealPlan36 = globalThis.mergeMealPlan;
  const savedSaveShopLocal36 = globalThis.saveShopLocal;
  const savedMealPlan36 = globalThis.mealPlan;
  const savedSavePlanInFlight36 = globalThis._savePlanInFlight;
  const savedLastShopServerContent36 = globalThis._lastShopServerContent;
  const savedLocation36 = globalThis.location;
  const savedBridge36 = globalThis.BRIDGE;
  geval(extract('pollShopServer'));
  globalThis._savePlanInFlight = 0;
  globalThis._lastShopServerContent = null;
  globalThis.BRIDGE = 'https://bridge.test';
  globalThis.location = { hash: '#/shopping' };
  globalThis.mealPlan = { weeks: {} };
  globalThis.mergeMealPlan = (s, l) => l;
  globalThis.saveShopLocal = () => {};
  let renderCalls36 = 0;
  globalThis.renderShopWrap = () => { renderCalls36++; };
  let serverContent36 = '{"weeks":{}}';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, content: serverContent36 }) });
  await pollShopServer();
  const afterFirstPoll36 = renderCalls36;
  await pollShopServer();
  const afterRepeatPoll36 = renderCalls36;
  serverContent36 = '{"weeks":{"2026-11-15":{"days":[]}}}';
  await pollShopServer();
  const afterChangedPoll36 = renderCalls36;
  check('Section 36(a) (poll skips unchanged server content): first poll renders (1), a repeat poll with identical server content does NOT re-render (still 1), and a poll with changed content re-renders (2) — so Nava updates still land within one tick',
    afterFirstPoll36 === 1 && afterRepeatPoll36 === 1 && afterChangedPoll36 === 2);
  globalThis.fetch = savedFetch36;
  globalThis.renderShopWrap = savedRenderShopWrap36;
  globalThis.mergeMealPlan = savedMergeMealPlan36;
  globalThis.saveShopLocal = savedSaveShopLocal36;
  globalThis.mealPlan = savedMealPlan36;
  globalThis._savePlanInFlight = savedSavePlanInFlight36;
  globalThis._lastShopServerContent = savedLastShopServerContent36;
  globalThis.location = savedLocation36;
  globalThis.BRIDGE = savedBridge36;

  // (b) renderShopWrap preserves the #shop-new draft text, focus, and cursor
  // across the rebuild when the input was focused; (c) when it was NOT
  // focused, the text is still preserved but focus is not stolen.
  const savedDollar36 = globalThis.$;
  const savedDocument36 = globalThis.document;
  const hadShoppingListHTML36 = ('shoppingListHTML' in globalThis);
  const savedShoppingListHTML36 = globalThis.shoppingListHTML;
  geval(extract('renderShopWrap'));
  globalThis.shoppingListHTML = () => '<input id="shop-new">';
  const makeInput36 = (value) => ({
    value,
    selectionStart: 0,
    selectionEnd: 0,
    focused: false,
    focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; }
  });
  let currentInput36 = makeInput36('onions');
  const fakeWrap36 = {
    get innerHTML() { return ''; },
    set innerHTML(v) { currentInput36 = makeInput36(''); },
    querySelector(sel) {
      if (sel === '#shop-new') return currentInput36;
      return null;
    }
  };
  globalThis.$ = (sel) => (sel === '#shop-wrap' ? fakeWrap36 : null);
  // Focused case: text 'onions' with cursor 3-6.
  currentInput36.selectionStart = 3;
  currentInput36.selectionEnd = 6;
  globalThis.document = { activeElement: currentInput36 };
  renderShopWrap();
  const focusedNewInput36 = currentInput36;
  check('Section 36(b) (renderShopWrap preserves focused add-box draft): after a rebuild the new #shop-new still holds "onions", is focused, and the cursor is back at 3-6',
    focusedNewInput36.value === 'onions' && focusedNewInput36.focused === true &&
    focusedNewInput36.selectionStart === 3 && focusedNewInput36.selectionEnd === 6);
  // Unfocused case: text 'milk' typed, then the user tapped elsewhere.
  currentInput36 = makeInput36('milk');
  globalThis.document = { activeElement: null };
  renderShopWrap();
  const unfocusedNewInput36 = currentInput36;
  check('Section 36(c) (renderShopWrap preserves unfocused draft without stealing focus): after a rebuild the new #shop-new still holds "milk" and was NOT focused',
    unfocusedNewInput36.value === 'milk' && unfocusedNewInput36.focused === false);
  globalThis.$ = savedDollar36;
  globalThis.document = savedDocument36;
  if (hadShoppingListHTML36) globalThis.shoppingListHTML = savedShoppingListHTML36;
  else delete globalThis.shoppingListHTML;

  // Section 37 — Add button clears the box (v20261118c): the Add handler used
  // to rely on the rebuild destroying the input to clear it; since Section 36
  // renderShopWrap now restores the draft across rebuilds, the handler must
  // clear the box itself, or the text stays after every add.
  const savedDollar37 = globalThis.$;
  const savedDocument37 = globalThis.document;
  const savedGetWeek37 = globalThis.getWeek;
  const savedThisWeekKey37 = globalThis.thisWeekKey;
  const savedGetSessionId37 = globalThis.getSessionId;
  const savedMarkShopDirty37 = globalThis.markShopDirty;
  const savedRenderShopWrap37 = globalThis.renderShopWrap;
  const hadShoppingListHTML37 = ('shoppingListHTML' in globalThis);
  const savedShoppingListHTML37 = globalThis.shoppingListHTML;
  const savedEnsurePlanned37 = globalThis.ensurePlannedRecipes;
  const savedLoadStoreNotes37 = globalThis.loadStoreNotesLocal;
  const savedEnsurePriceHistory37 = globalThis.ensurePriceHistoryLoaded;
  const savedEnsureStoreNotes37 = globalThis.ensureStoreNotesLoaded;
  const savedShoppingFromLabel37 = globalThis.shoppingFromLabel;
  const savedGetHideStaples37 = globalThis.getHideStaples;
  const savedHelpLinkHTML37 = globalThis.helpLinkHTML;
  geval(extract('renderShopping'));
  geval(extract('renderShopWrap'));
  globalThis.shoppingListHTML = () => '<input id="shop-new">';
  const fakeWeek37 = { manualItems: [] };
  globalThis.getWeek = () => fakeWeek37;
  globalThis.thisWeekKey = () => '2026-11-15';
  globalThis.getSessionId = () => 'test-session';
  globalThis.markShopDirty = () => {};
  globalThis.ensurePlannedRecipes = async () => {};
  globalThis.loadStoreNotesLocal = () => {};
  globalThis.ensurePriceHistoryLoaded = () => {};
  globalThis.ensureStoreNotesLoaded = () => {};
  globalThis.shoppingFromLabel = () => '';
  globalThis.getHideStaples = () => false;
  globalThis.helpLinkHTML = () => '';
  const makeInput37 = (value) => ({
    id: 'shop-new',
    value,
    selectionStart: 0,
    selectionEnd: 0,
    focused: false,
    focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    addEventListener(type, fn) { this['on' + type] = fn; }
  });
  let currentInput37 = makeInput37('cumin');
  const fakeAddBtn37 = { click() { shopClick37({ target: fakeAddTarget37 }); } };
  const fakeAddTarget37 = { closest: (sel) => (sel === '#shop-add' ? fakeAddBtn37 : null) };
  let shopClick37 = null;
  let shopKeydown37 = null;
  const fakeWrap37 = {
    get innerHTML() { return ''; },
    set innerHTML(v) { currentInput37 = makeInput37(''); },
    querySelector(sel) {
      if (sel === '#shop-new') return currentInput37;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { if (type === 'click') shopClick37 = fn; else if (type === 'keydown') shopKeydown37 = fn; }
  };
  globalThis.document = { title: '', activeElement: null, addEventListener() {} };
  globalThis.$ = (sel) => (sel === '#shop-wrap' ? fakeWrap37 : sel === '#shop-new' ? currentInput37 : sel === '#shop-add' ? fakeAddBtn37 : null);
  await renderShopping({ innerHTML: '' });
  // (a) Tap Add with 'cumin' typed: item lands in manualItems, the NEW box is
  // empty, and it stays focused so the next item can be typed right away.
  currentInput37.focus();
  shopClick37({ target: fakeAddTarget37 });
  const afterAdd37 = currentInput37;
  check('Section 37(a) (Add clears the box): after tapping Add, "cumin" is in manualItems, the new #shop-new is empty, and it is focused',
    fakeWeek37.manualItems.length === 1 && fakeWeek37.manualItems[0].text === 'cumin' &&
    afterAdd37.value === '' && afterAdd37.focused === true);
  // (b) Enter key path, delegated on shopWrap so it survives the rebuild:
  // typing 'paprika' + Enter on the NEW input (post-rebuild) adds it and
  // clears the box too. With the old direct binding this did nothing.
  currentInput37.value = 'paprika';
  currentInput37.focus();
  shopKeydown37({ key: 'Enter', target: currentInput37, preventDefault() {} });
  const afterEnter37 = currentInput37;
  check('Section 37(b) (Enter adds and clears after a rebuild): after Enter, "paprika" is in manualItems, the new #shop-new is empty, and it is focused',
    fakeWeek37.manualItems.length === 2 && fakeWeek37.manualItems[1].text === 'paprika' &&
    afterEnter37.value === '' && afterEnter37.focused === true);
  globalThis.$ = savedDollar37;
  globalThis.document = savedDocument37;
  globalThis.getWeek = savedGetWeek37;
  globalThis.thisWeekKey = savedThisWeekKey37;
  globalThis.getSessionId = savedGetSessionId37;
  globalThis.markShopDirty = savedMarkShopDirty37;
  globalThis.renderShopWrap = savedRenderShopWrap37;
  if (hadShoppingListHTML37) globalThis.shoppingListHTML = savedShoppingListHTML37;
  else delete globalThis.shoppingListHTML;
  globalThis.ensurePlannedRecipes = savedEnsurePlanned37;
  globalThis.loadStoreNotesLocal = savedLoadStoreNotes37;
  globalThis.ensurePriceHistoryLoaded = savedEnsurePriceHistory37;
  globalThis.ensureStoreNotesLoaded = savedEnsureStoreNotes37;
  globalThis.shoppingFromLabel = savedShoppingFromLabel37;
  globalThis.getHideStaples = savedGetHideStaples37;
  globalThis.helpLinkHTML = savedHelpLinkHTML37;

  /* ============ 38. Fix Round Regression Tests (Fixes 1A, 1B, 3A, 4A, 5A, 5B, 6, 7) ============ */
  {
    // Fix 1A: SQL SELECT includes ri.receipt_dept & ri.category, and BY_WEIGHT_MEAT_KEYS covers
    // generic 'chicken', 'salmon', 'veal neck bone', 'pastrami', plus receipt_dept='MEAT' with unrecognized key.
    const receiptsSrc37 = fs.readFileSync(path.join(SITE_DIR, 'bridge-git-v16', 'receipts.js'), 'utf8');
    const sqlSelectHasDeptAndCat37 = /SELECT\s+ri\.id[\s\S]*?ri\.receipt_dept,\s*ri\.category,/i.test(receiptsSrc37);
    const rowsFix1A = [
      // (i) receipt_dept = 'MEAT' with an unrecognized group_key ("mystery butcher special")
      { status: 'verified', needs_review: 0, group_key: 'mystery butcher special', receipt_dept: 'MEAT', category: null, paid_price_cents: 2450, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Mystery Butcher Special', raw_line: 'MYSTERY BUTCHER SPECIAL', receipt_date: '2026-11-08', receipt_id: 'r37_1', line_no: 1, id: 3701 },
      // (ii) group_key = 'chicken' without receipt_dept
      { status: 'verified', needs_review: 0, group_key: 'chicken', receipt_dept: null, category: null, paid_price_cents: 1899, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Fresh Chicken Pack', raw_line: 'FRESH CHICKEN PACK', receipt_date: '2026-11-08', receipt_id: 'r37_2', line_no: 2, id: 3702 },
      // (iii) group_key = 'salmon' without receipt_dept
      { status: 'verified', needs_review: 0, group_key: 'salmon', receipt_dept: null, category: null, paid_price_cents: 2200, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Fresh Salmon', raw_line: 'FRESH SALMON', receipt_date: '2026-11-08', receipt_id: 'r37_3', line_no: 3, id: 3703 },
      // (iv) group_key = 'veal neck bone' without receipt_dept
      { status: 'verified', needs_review: 0, group_key: 'veal neck bone', receipt_dept: null, category: null, paid_price_cents: 1599, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Veal Neck Bones', raw_line: 'VEAL NECK BONES', receipt_date: '2026-11-08', receipt_id: 'r37_4', line_no: 4, id: 3704 },
      // (v) group_key = 'pastrami' without receipt_dept
      { status: 'verified', needs_review: 0, group_key: 'pastrami', receipt_dept: null, category: null, paid_price_cents: 1299, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'House Pastrami', raw_line: 'HOUSE PASTRAMI', receipt_date: '2026-11-08', receipt_id: 'r37_5', line_no: 5, id: 3705 }
    ];
    const resFix1A = await receiptsMod.handlePriceHistory(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
      makeMockEnv(rowsFix1A),
      { nowMs: new Date('2026-11-17T12:00:00Z').getTime(), currentWeekKey: '2026-11-15', circularRates: {}, currentPrices: null }
    );
    const jsonFix1A = await resFix1A.json();
    const pMystery1A = jsonFix1A.prices['mystery butcher special'];
    const pChicken1A = jsonFix1A.prices['chicken'];
    const pSalmon1A = jsonFix1A.prices['salmon'];
    const pVealNeck1A = jsonFix1A.prices['veal neck bone'];
    const pPastrami1A = jsonFix1A.prices['pastrami'];
    check('Section 38(a) (Fix 1A — SQL SELECT includes ri.receipt_dept & ri.category + expanded BY_WEIGHT_MEAT_KEYS): weight-less rows with receipt_dept="MEAT" (even unrecognized key) or group_key in {chicken, salmon, veal neck bone, pastrami} all get basis: "pack_unweighed" and never pose as basis: "each"',
      sqlSelectHasDeptAndCat37 &&
      pMystery1A?.basis === 'pack_unweighed' &&
      pChicken1A?.basis === 'pack_unweighed' &&
      pSalmon1A?.basis === 'pack_unweighed' &&
      pVealNeck1A?.basis === 'pack_unweighed' &&
      pPastrami1A?.basis === 'pack_unweighed' &&
      estimateShopItemCents({ base: 'chicken', key: 'chicken|', qty: 2, rawUnit: '', unit: '' }, pChicken1A).convertible === false &&
      estimateShopItemCents({ base: 'salmon', key: 'salmon|lb', qty: 2, rawUnit: 'lb', unit: 'lb' }, pSalmon1A).convertible === false);

    // Fix 1B: Multi-store item where latest row is pack_unweighed at Aron's ($30.04) and older row is weighed 'lb' at Bingo ($6.49/lb)
    // and vice-versa (latest row is weighed 'lb' at Bingo $9.99/lb, older row is pack_unweighed at Aron's $32.50).
    const rowsFix1B = [
      // Item 1 (chicken cutlet): latest at Aron's (2026-11-15) is pack_unweighed ($30.04); older at Bingo (2026-11-10) is weighed lb ($6.49/lb)
      { status: 'verified', needs_review: 0, group_key: 'chicken cutlet', paid_price_cents: 3004, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Chicken Cutlet Family Pack', raw_line: 'CHICKEN CUTLET PACK', receipt_date: '2026-11-15', receipt_id: 'r37_b1', line_no: 1, id: 3711 },
      { status: 'verified', needs_review: 0, group_key: 'chicken cutlet', paid_price_cents: 1298, qty_or_weight: 2, unit: 'lb', pack_size: null, store: 'Bingo Wholesale', product_name: 'Bingo Chicken Cutlet', raw_line: 'BINGO CHICKEN CUTLET', receipt_date: '2026-11-10', receipt_id: 'r37_b2', line_no: 1, id: 3712 },
      // Item 2 (chuck roast): latest at Bingo (2026-11-15) is weighed lb ($9.99/lb); older at Aron's (2026-11-08) is pack_unweighed ($32.50)
      { status: 'verified', needs_review: 0, group_key: 'chuck roast', paid_price_cents: 1998, qty_or_weight: 2, unit: 'lb', pack_size: null, store: 'Bingo Wholesale', product_name: 'Bingo Chuck Roast', raw_line: 'BINGO CHUCK ROAST', receipt_date: '2026-11-15', receipt_id: 'r37_b3', line_no: 1, id: 3713 },
      { status: 'verified', needs_review: 0, group_key: 'chuck roast', paid_price_cents: 3250, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Aron Chuck Roast Pack', raw_line: 'ARON CHUCK ROAST', receipt_date: '2026-11-08', receipt_id: 'r37_b4', line_no: 1, id: 3714 }
    ];
    const resFix1B = await receiptsMod.handlePriceHistory(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
      makeMockEnv(rowsFix1B),
      { nowMs: new Date('2026-11-17T12:00:00Z').getTime(), currentWeekKey: '2026-11-15', circularRates: {}, currentPrices: null }
    );
    const jsonFix1B = await resFix1B.json();
    const pCb1B = jsonFix1B.prices['chicken cutlet'];
    const pCr1B = jsonFix1B.prices['chuck roast'];
    const hitCbAtBingo1B = entryPriceAtStore(pCb1B, 'Bingo Wholesale');
    const hitCbAtArons1B = entryPriceAtStore(pCb1B, "Aron's Kissena Farms");
    const estCbAtBingo1B = estimateShopItemCents({ base: 'chicken cutlet', key: 'chicken cutlet|lb', qty: 2, rawUnit: 'lb', unit: 'lb' }, hitCbAtBingo1B);
    const estCbAtArons1B = estimateShopItemCents({ base: 'chicken cutlet', key: 'chicken cutlet|lb', qty: 2, rawUnit: 'lb', unit: 'lb' }, hitCbAtArons1B);
    const hitCrAtArons1B = entryPriceAtStore(pCr1B, "Aron's Kissena Farms");
    const hitCrAtBingo1B = entryPriceAtStore(pCr1B, 'Bingo Wholesale');
    const estCrAtArons1B = estimateShopItemCents({ base: 'chuck roast', key: 'chuck roast|lb', qty: 2, rawUnit: 'lb', unit: 'lb' }, hitCrAtArons1B);
    const estCrAtBingo1B = estimateShopItemCents({ base: 'chuck roast', key: 'chuck roast|lb', qty: 2, rawUnit: 'lb', unit: 'lb' }, hitCrAtBingo1B);
    check('Section 38(b) (Fix 1B — by_store and last3 always carry their own basis & provenance): when latest is pack_unweighed at Aron\'s ($30.04) and older is weighed lb at Bingo ($6.49/lb), Bingo keeps basis: "lb" and converts 2 lb to $12.98 while Aron\'s stays pack_unweighed (unconvertible); and vice-versa',
      pCb1B.basis === 'pack_unweighed' &&
      pCb1B.by_store?.arons?.basis === 'pack_unweighed' &&
      (pCb1B.by_store?.bingo || pCb1B.by_store?.['bingo wholesale'])?.basis === 'lb' &&
      pCb1B.last3?.[0]?.basis === 'pack_unweighed' &&
      pCb1B.last3?.[1]?.basis === 'lb' &&
      hitCbAtBingo1B?.basis === 'lb' &&
      estCbAtBingo1B.convertible === true && estCbAtBingo1B.cents === 1298 &&
      hitCbAtArons1B?.basis === 'pack_unweighed' &&
      estCbAtArons1B.convertible === false && estCbAtArons1B.cents === 0 &&
      pCr1B.basis === 'lb' &&
      (pCr1B.by_store?.bingo || pCr1B.by_store?.['bingo wholesale'])?.basis === 'lb' &&
      pCr1B.by_store?.arons?.basis === 'pack_unweighed' &&
      hitCrAtArons1B?.basis === 'pack_unweighed' &&
      estCrAtArons1B.convertible === false && estCrAtArons1B.cents === 0 &&
      hitCrAtBingo1B?.basis === 'lb' &&
      estCrAtBingo1B.convertible === true && estCrAtBingo1B.cents === 1998);

    // Fix 3A & Fix 7 (Option A): /price-check-flag requires item_count > 0 on clear (omitted/null/0 all 409),
    // recognizes failed: true and turnstile: true, and surfaces storage: 'kv' | 'memory'.
    workerV16Mod.resetMemoryPriceCheckFlag();
    // Set flag in memory mode (no KV binding in env)
    const setMemRes37 = await workerV16Mod.default.fetch(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requested: true, week: '2026-11-15' })
      }),
      {}
    );
    const setMem37 = await setMemRes37.json();
    // Clear with omitted item_count -> must return 409 and keep requested: true
    const clearOmittedCountRes37 = await workerV16Mod.default.fetch(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', latest_written: true })
      }),
      {}
    );
    const clearOmittedCount37 = await clearOmittedCountRes37.json();
    // Clear with failed: true -> must return 409
    const clearFailedBoolRes37 = await workerV16Mod.default.fetch(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', latest_written: true, item_count: 5, failed: true })
      }),
      {}
    );
    const clearFailedBool37 = await clearFailedBoolRes37.json();
    // Clear with turnstile: true -> must return 409
    const clearTurnstileBoolRes37 = await workerV16Mod.default.fetch(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', latest_written: true, item_count: 5, turnstile: true })
      }),
      {}
    );
    const clearTurnstileBool37 = await clearTurnstileBoolRes37.json();
    // Now test with a mock KV binding in env to verify storage: 'kv'
    const kvStore37 = new Map();
    const mockKvEnv37 = {
      PRICE_CHECK_KV: {
        async get(k) { return kvStore37.has(k) ? kvStore37.get(k) : null; },
        async put(k, v) { kvStore37.set(k, v); }
      }
    };
    const setKv37 = await (await workerV16Mod.default.fetch(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requested: true, week: '2026-11-15' })
      }),
      mockKvEnv37
    )).json();
    const clearKvOkRes37 = await workerV16Mod.default.fetch(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-check-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', latest_written: true, item_count: 5 })
      }),
      mockKvEnv37
    );
    const clearKvOk37 = await clearKvOkRes37.json();
    check('Section 38(c) (Fix 3A & Fix 7 Option A — /price-check-flag strict item_count > 0, failed/turnstile booleans, and storage: "kv" | "memory" indicator): clear with omitted item_count or failed:true or turnstile:true returns 409 and keeps flag set; clear with latest_written:true and item_count:5 returns 200; responses surface storage: "memory" vs "kv"',
      setMem37.storage === 'memory' && setMem37.requested === true &&
      clearOmittedCountRes37.status === 409 && clearOmittedCount37.requested === true && clearOmittedCount37.reason === 'empty_shopping_list_kept_set' &&
      clearFailedBoolRes37.status === 409 && clearFailedBool37.requested === true && clearFailedBool37.reason === 'check_failed_kept_set' &&
      clearTurnstileBoolRes37.status === 409 && clearTurnstileBool37.requested === true && clearTurnstileBool37.reason === 'check_failed_kept_set' &&
      setKv37.storage === 'kv' && setKv37.requested === true &&
      clearKvOkRes37.status === 200 && clearKvOk37.cleared === true && clearKvOk37.requested === false && clearKvOk37.storage === 'kv');

    // Fix 4A: buildExpectedForKey only borrows reg_price_cents from onlineItem when basis matches
    const resFix4A = await receiptsMod.handlePriceHistory(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
      makeMockEnv([]),
      {
        nowMs: new Date('2026-11-17T12:00:00Z').getTime(),
        currentWeekKey: '2026-11-15',
        circularRates: {
          '2026-11-15': {
            // Circular sale is per-lb ($1.99/lb, no reg_price_cents), online item is per-pack ($4.99/pack) -> mismatched basis!
            'roma tomato': { price_cents: 199, basis: 'lb', raw_name: 'Roma Tomatoes' },
            // Circular sale is per-lb ($7.99/lb, no reg_price_cents), online item is also per-lb ($9.99/lb) -> matching basis!
            'butterfly chicken cutlet': { price_cents: 799, basis: 'lb', raw_name: 'Butterfly Chicken Cutlets' }
          }
        },
        currentPrices: {
          week: '2026-11-15',
          store: 'arons',
          items: {
            'roma tomato': { price_cents: 499, basis: 'pack', pack_size: 'box', raw_name: 'Roma Tomato Box' },
            'butterfly chicken cutlet': { price_cents: 999, basis: 'lb', raw_name: 'Butterfly Chicken Cutlets' }
          }
        }
      }
    );
    const jsonFix4A = await resFix4A.json();
    const expTomato4A = jsonFix4A.prices['roma tomato']?.expected;
    const expChicken4A = jsonFix4A.prices['butterfly chicken cutlet']?.expected;
    check('Section 38(d) (Fix 4A — reg_price_cents basis guard in buildExpectedForKey): circular entry with basis "lb" and no reg_price_cents does NOT borrow reg_price_cents from an online entry with basis "pack", while matching basis "lb" DOES preserve reg_price_cents',
      expTomato4A?.price_cents === 199 &&
      expTomato4A?.basis === 'lb' &&
      expTomato4A?.reg_price_cents === undefined &&
      expChicken4A?.price_cents === 799 &&
      expChicken4A?.basis === 'lb' &&
      expChicken4A?.reg_price_cents === 999);

    // Fix 5A & Fix 5B: Shopping list UI tests for expected-only under Bingo (Fix 5A) and stale expected-only under Aron's (Fix 5B)
    const savedThisWeekKey37 = globalThis.thisWeekKey;
    const savedShoppingFromYmd37 = globalThis.shoppingFromYmd;
    const savedPlan37 = globalThis.mealPlan;
    const savedRecipes37 = globalThis.recipes;
    const savedMetaById37 = globalThis.metaById;
    const savedById37 = globalThis.byId;
    const savedSec37 = globalThis.shoppingSections;
    const savedLocal37 = globalThis.localStorage;
    const savedStore37 = getShopStore();

    globalThis.localStorage = stubStorage({});
    globalThis.thisWeekKey = () => '2026-11-15';
    globalThis.shoppingFromYmd = () => '2026-11-15';
    const simpleRecipe37 = {
      id: 'brisket-only-37',
      title: 'Test Brisket 37',
      categories: ['main'],
      kosher_status: 'meat',
      servings: '4',
      ingredients: [
        { section: '', items: [{ qty: '3', unit: 'lb', item: 'brisket' }] }
      ]
    };
    setMeta([simpleRecipe37]);
    globalThis.byId = { 'brisket-only-37': simpleRecipe37 };
    globalThis.shoppingSections = null;
    const days37 = blankDays();
    days37[5].dinner.dishes = [{ recipe: 'brisket-only-37' }];
    setPlan({ '2026-11-15': { days: days37, have: [], manualItems: [] } });

    // (1) Fix 5A: Active expected-only item (price_cents: null, expected active at Aron's), Shopping at Bingo
    const activeExpOnlyMap37 = {
      'first cut brisket': {
        price_cents: null,
        store: "Aron's Kissena Farms",
        bought_name: 'First Cut Brisket',
        receipt_date: null,
        avg12m_cents: null,
        by_store: {},
        last3: [],
        expected: {
          price_cents: 1699,
          basis: 'lb',
          source: 'online-store',
          store: "Aron's Kissena Farms",
          week: '2026-11-15'
        }
      }
    };
    setPriceHistoryCache(activeExpOnlyMap37);
    setShopStore('bingo');
    const htmlBingoExpOnly37 = shoppingListHTML();

    // (2) Fix 5B: Stale expected-only item (price_cents: null, expected.stale: true), Shopping at Aron's
    const staleExpOnlyMap37 = {
      'first cut brisket': {
        price_cents: null,
        store: "Aron's Kissena Farms",
        bought_name: 'First Cut Brisket',
        receipt_date: null,
        avg12m_cents: null,
        by_store: {},
        last3: [],
        expected: {
          price_cents: 1699,
          basis: 'lb',
          source: 'online-store',
          store: "Aron's Kissena Farms",
          week: '2026-11-08',
          stale: true
        }
      }
    };
    setPriceHistoryCache(staleExpOnlyMap37);
    setShopStore('arons');
    const htmlAronsStaleExpOnly37 = shoppingListHTML();

    globalThis.thisWeekKey = savedThisWeekKey37;
    globalThis.shoppingFromYmd = savedShoppingFromYmd37;
    globalThis.mealPlan = savedPlan37;
    globalThis.recipes = savedRecipes37;
    globalThis.metaById = savedMetaById37;
    globalThis.byId = savedById37;
    globalThis.shoppingSections = savedSec37;
    setShopStore(savedStore37);
    globalThis.localStorage = savedLocal37;
    resetPriceHistorySession();

    check('Section 38(e) (Fix 5A — expected-only item under Shopping at Bingo): shows no "last bought at Aron\'s" wording and does NOT increment "only at Aron\'s" in store coverage summary (counts as "1 no price yet")',
      !htmlBingoExpOnly37.includes('last bought') &&
      !htmlBingoExpOnly37.includes('only at Aron') &&
      htmlBingoExpOnly37.includes('Bingo: 0 of 1 priced here · 1 no price yet'));

    check('Section 38(f) (Fix 5B — stale expected-only item under Shopping at Aron\'s): counts as NEITHER priced here ("0 of 1 priced here · 1 no price yet") NOR not-estimated, and detail popup renders no active "Expected at Aron\'s" line',
      htmlAronsStaleExpOnly37.includes('Aron&#39;s: 0 of 1 priced here · 1 no price yet') &&
      !htmlAronsStaleExpOnly37.includes('not estimated') &&
      !htmlAronsStaleExpOnly37.includes('Expected at Aron'));

    // Fix (6) edge note: compareExpectedVsLast Step 1 normalizes multi-unit pack prices by units_per_pack
    // when effective basis is 'head' (e.g. 5-head garlic sleeve at 399¢ = 80¢/head vs single head at 100¢/head)
    const garlicSleeveVsSingleHead37 = {
      price_cents: 399,
      store: "Aron's Kissena Farms",
      bought_name: 'Garlic Sleeve',
      receipt_date: '2026-11-10',
      basis: 'pack',
      pack_size: 'sleeve',
      expected: {
        price_cents: 100,
        basis: 'head',
        source: 'online-store',
        store: "Aron's Kissena Farms",
        week: '2026-11-15',
        raw_name: 'Garlic Head'
      }
    };
    const cmpHeadVsSleevePricier37 = compareExpectedVsLast('garlic', garlicSleeveVsSingleHead37);
    const cmpHeadVsSleeveCheaper37 = compareExpectedVsLast('garlic', {
      ...garlicSleeveVsSingleHead37,
      expected: { ...garlicSleeveVsSingleHead37.expected, price_cents: 65 }
    });
    const cmpHeadVsSleeveSame37 = compareExpectedVsLast('garlic', {
      ...garlicSleeveVsSingleHead37,
      expected: { ...garlicSleeveVsSingleHead37.expected, price_cents: 80 }
    });
    check('Section 38(g) (Fix (6) edge note — compareExpectedVsLast Step 1 unit-pack normalization): a 5-head garlic sleeve at $3.99 (80¢/head) compared against an expected single garlic head (basis: "head") compares per-head rates (100¢/head -> "pricier", 65¢/head -> "cheaper", 80¢/head -> "same") rather than raw 100¢ vs 399¢',
      cmpHeadVsSleevePricier37 === 'pricier' &&
      cmpHeadVsSleeveCheaper37 === 'cheaper' &&
      cmpHeadVsSleeveSame37 === 'same');
  }

  /* ============ 39. v20261119a fix batch (detail close, onion/tomato/rice directs, plum guard, detail names, manual badges, Aron's circular button, romaine pack rule) ============ */
  {
    const fixture39 = JSON.parse(fs.readFileSync(path.join(__dirname, 'price-history-fixture-20261117.json'), 'utf8'));
    const fixturePrices39 = fixture39.prices || fixture39;
    const appSrc39 = fs.readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');

    // 39(a) Plum variety-modifier guard: "dried plums" must NOT price as plum tomatoes;
    // plain "tomato" direct-matches to stem tomatoes.
    const plumMap39 = {
      'plum tomato': { price_cents: 129, basis: 'lb', bought_name: 'Vine Ripe Plum Tomatoes', store: "Aron's Kissena Farms", receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] },
      'tomato stem': { price_cents: 399, basis: 'lb', bought_name: 'Tomato Stem', store: "Aron's Kissena Farms", receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] }
    };
    check('Section 39(a) (plum guard + tomato direct): "dried plums (prunes)" and "dried plums" return null (never plum tomatoes), "plum tomato" still matches Vine Ripe Plum Tomatoes, and plain "tomato" direct-matches to Tomato Stem',
      priceMatchFor('dried plums (prunes)', plumMap39) === null &&
      priceMatchFor('dried plums', plumMap39) === null &&
      priceMatchFor('plum tomato', plumMap39)?.bought_name === 'Vine Ripe Plum Tomatoes' &&
      priceMatchFor('tomato', plumMap39)?.bought_name === 'Tomato Stem' &&
      priceMatchFor('tomato', fixturePrices39)?.bought_name === 'Tomato Stem');

    // 39(b) Onion direct matches against the 101-key fixture.
    check('Section 39(b) (onion directs): "onion" and "spanish onion" price as Onion Yellow Globe - Loose (the large Spanish onions), "purple onion" and "red onion" price as Onion Red',
      priceMatchFor('onion', fixturePrices39)?.bought_name === 'Onion Yellow Globe - Loose' &&
      priceMatchFor('spanish onion', fixturePrices39)?.bought_name === 'Onion Yellow Globe - Loose' &&
      priceMatchFor('purple onion', fixturePrices39)?.bought_name === 'Onion Red' &&
      priceMatchFor('red onion', fixturePrices39)?.bought_name === 'Onion Red');

    // 39(c) Detail card close: badge tap toggles open/closed with +/- indicator flip;
    // tapping the open card itself closes it. Fake-DOM handler test (Section 37 pattern).
    const savedDollar39 = globalThis.$;
    const savedDocument39 = globalThis.document;
    const savedGetWeek39 = globalThis.getWeek;
    const savedThisWeekKey39 = globalThis.thisWeekKey;
    const savedGetSessionId39 = globalThis.getSessionId;
    const savedMarkShopDirty39 = globalThis.markShopDirty;
    const savedRenderShopWrap39 = globalThis.renderShopWrap;
    const hadShoppingListHTML39 = ('shoppingListHTML' in globalThis);
    const savedShoppingListHTML39 = globalThis.shoppingListHTML;
    const savedEnsurePlanned39 = globalThis.ensurePlannedRecipes;
    const savedLoadStoreNotes39 = globalThis.loadStoreNotesLocal;
    const savedEnsurePriceHistory39 = globalThis.ensurePriceHistoryLoaded;
    const savedEnsureStoreNotes39 = globalThis.ensureStoreNotesLoaded;
    const savedShoppingFromLabel39 = globalThis.shoppingFromLabel;
    const savedGetHideStaples39 = globalThis.getHideStaples;
    const savedHelpLinkHTML39 = globalThis.helpLinkHTML;
    geval(extract('renderShopping'));
    geval(extract('renderShopWrap'));
    globalThis.shoppingListHTML = () => '<input id="shop-new">';
    globalThis.getWeek = () => ({ manualItems: [] });
    globalThis.thisWeekKey = () => '2026-11-15';
    globalThis.getSessionId = () => 'test-session';
    globalThis.markShopDirty = () => {};
    globalThis.ensurePlannedRecipes = async () => {};
    globalThis.loadStoreNotesLocal = () => {};
    globalThis.ensurePriceHistoryLoaded = () => {};
    globalThis.ensureStoreNotesLoaded = () => {};
    globalThis.shoppingFromLabel = () => '';
    globalThis.getHideStaples = () => false;
    globalThis.helpLinkHTML = () => '';
    let shopClick39 = null;
    const fakeWrap39 = {
      get innerHTML() { return ''; },
      set innerHTML(v) {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener(type, fn) { if (type === 'click') shopClick39 = fn; }
    };
    globalThis.document = { title: '', activeElement: null, addEventListener() {} };
    globalThis.$ = (sel) => (sel === '#shop-wrap' ? fakeWrap39 : null);
    await renderShopping({ innerHTML: '' });
    const fakeInd39 = { textContent: '+' };
    const fakeDetail39 = { hidden: true, dataset: { priceDetail: 'k39' }, parentElement: null };
    const fakeBtn39 = {
      dataset: { priceToggle: 'k39' },
      attrs: {},
      setAttribute(n, v) { this.attrs[n] = v; },
      querySelector(sel) { return sel === '.shop-price-toggle-ind' ? fakeInd39 : null; },
      parentElement: { querySelector(sel) { return sel === '.shop-price-detail' ? fakeDetail39 : null; } }
    };
    fakeDetail39.parentElement = { querySelector(sel) { return sel === '[data-price-toggle]' ? fakeBtn39 : null; } };
    const badgeTarget39 = { closest: (sel) => (sel === '[data-price-toggle]' ? fakeBtn39 : null) };
    const detailTarget39 = { closest: (sel) => (sel === '.shop-price-detail' ? fakeDetail39 : null) };
    shopClick39({ target: badgeTarget39 });
    const opened39 = fakeDetail39.hidden === false && fakeInd39.textContent === '−' && fakeBtn39.attrs['aria-expanded'] === 'true';
    shopClick39({ target: badgeTarget39 });
    const closedByBadge39 = fakeDetail39.hidden === true && fakeInd39.textContent === '+' && fakeBtn39.attrs['aria-expanded'] === 'false';
    shopClick39({ target: badgeTarget39 });
    shopClick39({ target: detailTarget39 });
    const closedByCard39 = fakeDetail39.hidden === true && fakeInd39.textContent === '+' && fakeBtn39.attrs['aria-expanded'] === 'false';
    check('Section 39(c) (detail card close): badge tap opens (indicator flips to −), badge tap again closes, and tapping the open card itself closes it; badge markup carries the +/- indicator span',
      opened39 && closedByBadge39 && closedByCard39 &&
      appSrc39.includes('shop-price-toggle-ind') &&
      appSrc39.includes("closest('.shop-price-detail')"));
    globalThis.$ = savedDollar39;
    globalThis.document = savedDocument39;
    globalThis.getWeek = savedGetWeek39;
    globalThis.thisWeekKey = savedThisWeekKey39;
    globalThis.getSessionId = savedGetSessionId39;
    globalThis.markShopDirty = savedMarkShopDirty39;
    globalThis.renderShopWrap = savedRenderShopWrap39;
    if (hadShoppingListHTML39) globalThis.shoppingListHTML = savedShoppingListHTML39;
    else delete globalThis.shoppingListHTML;
    globalThis.ensurePlannedRecipes = savedEnsurePlanned39;
    globalThis.loadStoreNotesLocal = savedLoadStoreNotes39;
    globalThis.ensurePriceHistoryLoaded = savedEnsurePriceHistory39;
    globalThis.ensureStoreNotesLoaded = savedEnsureStoreNotes39;
    globalThis.shoppingFromLabel = savedShoppingFromLabel39;
    globalThis.getHideStaples = savedGetHideStaples39;
    globalThis.helpLinkHTML = savedHelpLinkHTML39;

    // 39(d) Product names in the expanded detail (source assertions; visual verified in live QA).
    check('Section 39(d) (detail names): expected line includes the circular/online product name (exp.raw_name) and history lines include the purchased product name (bought_name)',
      appSrc39.includes("(exp.raw_name ? exp.raw_name + ' ' : '')") &&
      /const nStr = String\(h\.bought_name \|\| ''\)\.trim\(\);/.test(appSrc39) &&
      appSrc39.includes('[nStr, dStr, sStr, fmtDollars(h.price_cents)]'));

    // 39(e) Manual items: price badge on manual rows + counted in the All-stores estimate.
    check('Section 39(e) (manual item prices): renderManToBuy renders the price badge via a pseudo-item from the manual text, and the All-stores estimate loop includes manToBuy (1 unit each) in the total and denominator',
      appSrc39.includes('renderPriceBadge(manualPseudoItem(m))') &&
      appSrc39.includes('manToBuy.forEach(m => {') &&
      appSrc39.includes('(activeToBuy.length + manToBuy.length)'));

    // 39(f) Aron's circular button: boot loads circulars/index.json; store bar links the latest pdf_url.
    check('Section 39(f) (Aron\'s circular button): boot fetches data/circulars/index.json and the shopping-list store bar renders an "Aron\'s circular" link to the latest week pdf_url (new tab)',
      appSrc39.includes("fetch('data/circulars/index.json' + cb)") &&
      appSrc39.includes('shop-circular-btn') &&
      appSrc39.includes('target="_blank" rel="noopener"') &&
      appSrc39.includes('idx.weeks.find(x => x && x.week === idx.latest_week)'));

    // 39(g) Bridge git-v17 romaine hearts known-pack rule.
    const rowsRomaine39 = [
      { status: 'verified', needs_review: 0, group_key: 'romaine heart', receipt_dept: null, category: null, paid_price_cents: 349, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Romaine Hearts', raw_line: 'ROMAINE HEARTS', receipt_date: '2026-11-08', receipt_id: 'r39_1', line_no: 1, id: 3901 },
      { status: 'verified', needs_review: 0, group_key: 'romaine lettuce', receipt_dept: null, category: null, paid_price_cents: 250, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Romaine Lettuce', raw_line: 'ROMAINE LETTUCE', receipt_date: '2026-11-08', receipt_id: 'r39_2', line_no: 2, id: 3902 },
      { status: 'verified', needs_review: 0, group_key: 'romaine heart', receipt_dept: null, category: null, paid_price_cents: 499, qty_or_weight: 2, unit: 'lb', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Romaine Hearts Loose', raw_line: 'ROMAINE HEARTS LB', receipt_date: '2026-11-01', receipt_id: 'r39_3', line_no: 3, id: 3903 }
    ];
    const resRomaine39 = await receiptsMod.handlePriceHistory(
      new Request('https://recipe-bridge.leibreiss.workers.dev/price-history'),
      makeMockEnv(rowsRomaine39),
      { nowMs: new Date('2026-11-19T12:00:00Z').getTime(), currentWeekKey: '2026-11-15', circularRates: {}, currentPrices: null }
    );
    const jsonRomaine39 = await resRomaine39.json();
    const pRomaine39 = jsonRomaine39.prices['romaine heart'];
    const pRomaineLettuce39 = jsonRomaine39.prices['romaine lettuce'];
    check('Section 39(g) (bridge git-v17 romaine pack rule): weight-less "Romaine Hearts" rows derive basis "pack" with pack_size "3 ct" (latest row wins), while plain "Romaine Lettuce" stays basis "each"',
      pRomaine39?.basis === 'pack' &&
      pRomaine39?.pack_size === '3 ct' &&
      pRomaine39?.price_cents === 349 &&
      pRomaineLettuce39?.basis === 'each');

    // 40(a) Form-word guard (v20261119b): a Step 2 match must share a
    // specific-product word. "pomegranate seeds" must NOT price as cumin seeds
    // (shared word "seed" only); exact seed matches and distinctive-word
    // overlaps still work.
    const formMap40 = {
      'cumin seed': { price_cents: null, basis: 'pack', bought_name: 'Cumin Seeds', store: "Aron's Kissena Farms", receipt_date: null, avg12m_cents: null, by_store: {}, last3: [], expected: { price_cents: 559, reg_price_cents: null, basis: 'pack', pack_size: '4 oz', source: 'online-store', week: '2026-11-15', raw_name: 'Cumin Seeds' } },
      'sesame seed': { price_cents: 299, basis: 'pack', bought_name: 'Sesame Seeds', store: "Aron's Kissena Farms", receipt_date: '2026-11-01', avg12m_cents: null, by_store: {}, last3: [] },
      'garlic powder': { price_cents: 349, basis: 'pack', bought_name: 'Garlic Powder', store: "Aron's Kissena Farms", receipt_date: '2026-11-01', avg12m_cents: null, by_store: {}, last3: [] },
      'corn flake': { price_cents: 429, basis: 'pack', bought_name: 'Corn Flakes', store: "Aron's Kissena Farms", receipt_date: '2026-11-01', avg12m_cents: null, by_store: {}, last3: [] }
    };
    check('Section 40(a) (form-word guard): "pomegranate seeds" returns null (never cumin seeds), "chili powder" returns null (never garlic powder), "red pepper flakes" returns null (never corn flakes), while exact "cumin seeds"/"sesame seeds"/"garlic powder" and Step 2 "toasted sesame seeds" still match',
      priceMatchFor('pomegranate seeds', formMap40) === null &&
      priceMatchFor('chili powder', formMap40) === null &&
      priceMatchFor('red pepper flakes', formMap40) === null &&
      priceMatchFor('cumin seeds', formMap40)?.bought_name === 'Cumin Seeds' &&
      priceMatchFor('sesame seeds', formMap40)?.bought_name === 'Sesame Seeds' &&
      priceMatchFor('garlic powder', formMap40)?.bought_name === 'Garlic Powder' &&
      priceMatchFor('toasted sesame seeds', formMap40)?.bought_name === 'Sesame Seeds');

    // 40(b) Regression: legit Step 2 word-overlap matches still work.
    const potatoMap40 = {
      'potato yukon gold large loose': { price_cents: 189, basis: 'lb', bought_name: 'Potato Yukon Gold Large - Loose', store: "Aron's Kissena Farms", receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] }
    };
    check('Section 40(b) (form-guard regression): "yellow potatoes" still Step-2-matches Potato Yukon Gold Large - Loose via the potato variety group',
      priceMatchFor('yellow potatoes', potatoMap40)?.bought_name === 'Potato Yukon Gold Large - Loose');

    // 40(c) Source asserts for the guard.
    check('Section 40(c) (form-guard source): PRICE_FORM_WORDS set exists and the Step 2 guard consults it alongside PRICE_MODIFIER_WORDS',
      appSrc39.includes('PRICE_FORM_WORDS') &&
      appSrc39.includes('PRICE_MODIFIER_WORDS.has(w) || PRICE_FORM_WORDS.has(w)'));

    /* ============ 41. Pantry Tracking (v20261119c + Bridge git-v18) ============ */
    {
      globalThis.shelfLifeTable = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shelf-life.json'), 'utf8'));
      globalThis.unitConversions = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'unit-conversions.json'), 'utf8'));
      resetPantrySession();
      globalThis.__pantryTodayYmd = '2026-11-19';

      // 41(a) Bridge git-v18: /health version, /save allowlist for data/pantry.json, and GET /pantry-stock privacy + unconfirmed null-qty + circular meat backfill
      const worker18Path = fs.existsSync(path.join(SITE_DIR, 'bridge-git-v18', 'worker.js'))
        ? path.join(SITE_DIR, 'bridge-git-v18', 'worker.js')
        : path.join(SITE_DIR, 'worker.js');
      const receipts18Path = fs.existsSync(path.join(SITE_DIR, 'bridge-git-v18', 'receipts.js'))
        ? path.join(SITE_DIR, 'bridge-git-v18', 'receipts.js')
        : path.join(SITE_DIR, 'receipts.js');
      const worker18Mod = await import('file://' + worker18Path);
      const worker18 = worker18Mod.default;
      const receipts18Mod = await import('file://' + receipts18Path);

      let savedPath41 = null;
      let savedBody41 = null;
      const prevFetch41 = globalThis.fetch;
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (u.includes('api.github.com/repos/') && u.includes('/contents/')) {
          const m = u.match(/\/contents\/([^?]+)/);
          const p = m ? decodeURIComponent(m[1]) : '';
          if (!init.method || init.method === 'GET') {
            return new Response(JSON.stringify({ sha: 'sha41', content: Buffer.from('{}', 'utf8').toString('base64') }), { status: 200 });
          }
          if (init.method === 'PUT') {
            savedPath41 = p;
            savedBody41 = JSON.parse(init.body);
            return new Response(JSON.stringify({ content: { sha: 'newsha41' } }), { status: 200 });
          }
        }
        return new Response('not found', { status: 404 });
      };

      const env18 = {
        ...makeMockEnv([]),
        GH_TOKEN: 'fake-gh-token',
        GH_REPO: 'YidiReiss/recipes',
        GH_BRANCH: 'main'
      };
      const health18Res = await worker18.fetch(new Request('https://recipe-bridge.leibreiss.workers.dev/health'), env18);
      const health18Json = await health18Res.json();

      const savePantry18Res = await worker18.fetch(
        new Request('https://recipe-bridge.leibreiss.workers.dev/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'data/pantry.json', content: '{"onion":{"lots":[]}}\n', message: 'Test pantry save' })
        }),
        env18
      );
      const savePantry18Json = await savePantry18Res.json();

      const saveDisallowed18Res = await worker18.fetch(
        new Request('https://recipe-bridge.leibreiss.workers.dev/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'data/secret.json', content: '{}' })
        }),
        env18
      );
      globalThis.fetch = prevFetch41;

      check('Section 41(a.1) (bridge git-v18 /health + /save allowlist): /health reports version "git-v18", /save accepts "data/pantry.json" (200 ok:true), and rejects non-allowlisted paths (403)',
        health18Json.ok === true &&
        health18Json.version === 'git-v18' &&
        savePantry18Res.status === 200 &&
        savePantry18Json.ok === true &&
        savedPath41 === 'data/pantry.json' &&
        !!savedBody41 &&
        saveDisallowed18Res.status === 403);

      // Test GET /pantry-stock privacy, verified/non-flagged filtering, null-qty unconfirmed flag, and circular meat weight backfill
      const pantryStockRows41 = [
        // Verified, known qty
        { status: 'verified', needs_review: 0, group_key: 'onion', receipt_dept: 'PRODUCE', category: 'produce', paid_price_cents: 299, qty_or_weight: 3, unit: 'lb', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Yellow Onions', raw_line: 'ONIONS 3LB', receipt_date: '2026-11-16', receipt_id: 'rcpt_secret_1', line_no: 1, id: 4101 },
        // Verified, null qty -> must emit qty: null, unconfirmed: true
        { status: 'verified', needs_review: 0, group_key: 'olive oil', receipt_dept: 'GROCERY', category: 'grocery', paid_price_cents: 1199, qty_or_weight: null, unit: 'bottle', pack_size: null, store: 'Bingo Wholesale', product_name: 'Extra Virgin Olive Oil', raw_line: 'EVOO', receipt_date: '2026-11-16', receipt_id: 'rcpt_secret_2', line_no: 2, id: 4102 },
        // Verified, weight-less Aron's meat WITH circular /lb rate -> backfills weight (1497 / 499 = 3 lb) and is confirmed
        { status: 'verified', needs_review: 0, group_key: 'chicken breast', receipt_dept: 'MEAT', category: 'meat', paid_price_cents: 1497, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Chicken Breast Cutlets', raw_line: 'CHICKEN BREAST', receipt_date: '2026-11-16', receipt_id: 'rcpt_secret_3', line_no: 3, id: 4103 },
        // Verified, weight-less meat WITHOUT circular /lb rate -> unweighed meat must be unconfirmed: true, qty: null
        { status: 'verified', needs_review: 0, group_key: 'beef chuck roast', receipt_dept: 'MEAT', category: 'meat', paid_price_cents: 2450, qty_or_weight: 1, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Beef Chuck Roast', raw_line: 'BEEF CHUCK ROAST', receipt_date: '2026-11-16', receipt_id: 'rcpt_secret_4', line_no: 4, id: 4104 },
        // Unverified receipt -> must be excluded by SQL filter
        { status: 'review', needs_review: 0, group_key: 'garlic', receipt_dept: 'PRODUCE', category: 'produce', paid_price_cents: 199, qty_or_weight: 2, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Garlic', raw_line: 'GARLIC', receipt_date: '2026-11-16', receipt_id: 'rcpt_secret_5', line_no: 5, id: 4105 },
        // Flagged line item (needs_review = 1) -> must be excluded
        { status: 'verified', needs_review: 1, group_key: 'lemon', receipt_dept: 'PRODUCE', category: 'produce', paid_price_cents: 99, qty_or_weight: 4, unit: 'ea', pack_size: null, store: "Aron's Kissena Farms", product_name: 'Lemons', raw_line: 'LEMONS', receipt_date: '2026-11-16', receipt_id: 'rcpt_secret_6', line_no: 6, id: 4106 }
      ];
      const circRates41 = {
        '2026-11-15': {
          'chicken breast': { price_cents: 499, basis: 'lb' }
        }
      };
      const stockRes41 = await receipts18Mod.handlePantryStock(
        new Request('https://recipe-bridge.leibreiss.workers.dev/pantry-stock'),
        makeMockEnv(pantryStockRows41),
        { nowMs: new Date('2026-11-19T12:00:00Z').getTime(), circularRates: circRates41 }
      );
      const stockJson41 = await stockRes41.json();
      const stockRawStr41 = JSON.stringify(stockJson41);
      const PRIVATE_LEAK_RE_41 = /"price_cents"|"paid_price_cents"|"receipt_id"|"store"|"total_cents"|"tax_cents"|"user_email"|"raw_line"|"raw_ocr"|rcpt_secret|Kissena|Bingo/i;

      check('Section 41(a.2) (GET /pantry-stock privacy & derivation): returns only verified non-flagged items, strips all prices/receipt_ids/stores/payment fields, marks null-qty and unweighed meat without circular backfill as qty:null + unconfirmed:true, and backfills Aron\'s meat lb from circular rate',
        stockJson41.ok === true &&
        !PRIVATE_LEAK_RE_41.test(stockRawStr41) &&
        stockJson41.stock['onion']?.total_qty === 3 &&
        stockJson41.stock['onion']?.lots?.[0]?.unit === 'lb' &&
        stockJson41.stock['onion']?.lots?.[0]?.unconfirmed === false &&
        stockJson41.stock['olive oil']?.lots?.[0]?.qty === null &&
        stockJson41.stock['olive oil']?.lots?.[0]?.unconfirmed === true &&
        stockJson41.stock[' olive oil'] === undefined &&
        stockJson41.stock['chicken breast']?.lots?.[0]?.qty === 3 &&
        stockJson41.stock['chicken breast']?.lots?.[0]?.unit === 'lb' &&
        stockJson41.stock['chicken breast']?.lots?.[0]?.unconfirmed === false &&
        stockJson41.stock['beef chuck roast']?.lots?.[0]?.qty === null &&
        stockJson41.stock['beef chuck roast']?.lots?.[0]?.unconfirmed === true &&
        !stockJson41.stock['garlic'] &&
        !stockJson41.stock['lemon']);

      // 41(b) Ingesting /pantry-stock into pantry map: unconfirmed null-qty does NOT count as "have", confirmed lots sum into have, tombstones suppress older receipt lots
      const mergedFromRcpt41 = mergeReceiptStockIntoPantry({}, stockJson41, '2026-11-19');
      setPantryCache(mergedFromRcpt41, '2026-11-19');
      const onionHave41 = getPantryHaveFor('onion', 'lb', { todayYmd: '2026-11-19' });
      const oilHave41 = getPantryHaveFor('olive oil', 'bottle', { todayYmd: '2026-11-19' });
      const chuckHave41 = getPantryHaveFor('beef chuck roast', 'lb', { todayYmd: '2026-11-19' });

      check('Section 41(b) (stock derivation & unconfirmed null-qty): confirmed receipt lots count toward haveQty (3 lb onion), while unconfirmed null-qty lots have haveQty === 0 and hasUnconfirmed === true so they do not auto-cover',
        onionHave41.found === true &&
        onionHave41.haveQty === 3 &&
        oilHave41.found === true &&
        oilHave41.haveQty === 0 &&
        oilHave41.hasUnconfirmed === true &&
        chuckHave41.found === true &&
        chuckHave41.haveQty === 0 &&
        chuckHave41.hasUnconfirmed === true);

      // 41(c) Unit conversions & Romaine lb_per_bag consistency across price-conversions.json and unit-conversions.json
      const priceConvJson41 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'price-conversions.json'), 'utf8'));
      const unitConvJson41 = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'unit-conversions.json'), 'utf8'));
      const pItems41 = priceConvJson41.items || priceConvJson41;
      const uItems41 = unitConvJson41.items || unitConvJson41;

      const checkRomaineConsistency = (itemsObj) => {
        const rom = itemsObj['romaine lettuce'];
        if (!rom || rom.lb_per_bag !== 1.5) return false;
        if (rom.units_per_pack && rom.lb_per_unit && rom.lb_per_bag) {
          if (Math.abs(rom.units_per_pack * rom.lb_per_unit - rom.lb_per_bag) > 1e-6) return false;
        }
        return true;
      };

      const garlicCloveToHead41 = convertPantryQty('garlic', 10, 'clove', 'head');
      const garlicHeadToLb41 = convertPantryQty('garlic', 1, 'head', 'lb');
      const garlicSleeveToHead41 = convertPantryQty('garlic', 1, 'sleeve', 'head');
      const garlicSleeveToLb41 = convertPantryQty('garlic', 1, 'sleeve', 'lb');
      const garlicTspToClove41 = convertPantryQty('garlic', 5, 'tsp', 'clove');
      const chickenServingToLb41 = convertPantryQty('chicken breast', 2, 'serving', 'lb');
      const unconvertiblePair41 = convertPantryQty('ketchup', 1, 'bottle', 'sprig');

      check('Section 41(c) (unit conversions & romaine lb_per_bag fix): romaine lettuce lb_per_bag is 1.5 (== 3 * 0.5) in both price-conversions.json and unit-conversions.json; garlic lb_per_unit is per HEAD (0.1 lb, never divided by units_per_pack 5); chicken lb_per_serving is rejected for pantry conversion; unconvertible pairs return convertible:false',
        checkRomaineConsistency(pItems41) &&
        checkRomaineConsistency(uItems41) &&
        garlicCloveToHead41.convertible === true && Math.abs(garlicCloveToHead41.qty - 1) < 1e-6 &&
        garlicHeadToLb41.convertible === true && Math.abs(garlicHeadToLb41.qty - 0.1) < 1e-6 &&
        garlicSleeveToHead41.convertible === true && Math.abs(garlicSleeveToHead41.qty - 5) < 1e-6 &&
        garlicSleeveToLb41.convertible === true && Math.abs(garlicSleeveToLb41.qty - 0.5) < 1e-6 &&
        garlicTspToClove41.convertible === true && Math.abs(garlicTspToClove41.qty - 5) < 1e-6 &&
        chickenServingToLb41.convertible === false && chickenServingToLb41.qty === null &&
        unconvertiblePair41.convertible === false && unconvertiblePair41.qty === null);

      // 41(d) "Cooked it" deduction + ceiling rounding + partial-lot opened shelf life + variants + leftovers + un-mark restore
      resetPantrySession();
      // Seed pantry with:
      // - 5 whole onions (unit: 'unit')
      // - 2 cartons chicken stock (unit: 'carton', 1 carton = 2 lb = 4 cups)
      // - 4 lb ground beef (unit: 'lb')
      // - 4 lb chicken breast (unit: 'lb')
      await setPantryManualStock('onion', 5, 'unit', { todayYmd: '2026-11-15', skipRemoteSave: true });
      await setPantryManualStock('chicken stock', 2, 'carton', { todayYmd: '2026-11-15', skipRemoteSave: true });
      await setPantryManualStock('ground beef', 4, 'lb', { todayYmd: '2026-11-15', skipRemoteSave: true });
      await setPantryManualStock('chicken breast', 4, 'lb', { todayYmd: '2026-11-15', skipRemoteSave: true });

      const testStewRecipe41 = {
        id: 'pantry-test-stew',
        title: 'Pantry Test Stew',
        categories: ['main'],
        kosher_status: 'meat',
        servings: '4',
        variants: [
          { key: 'beef', label: 'Beef', default: true },
          { key: 'chicken', label: 'Chicken' }
        ],
        ingredients: [
          {
            section: 'Base',
            items: [
              // 1.8 lb onion -> at 0.72 lb/unit = 2.5 onions -> ceiling rounding deducts 3 onions (leaving 2 onions, openedAt set, cut onion fridge expiry = cookDate + 7 days)
              { qty: '1.8', unit: 'lb', item: 'onion' },
              // 2 cups chicken stock -> 1 cup = 0.5 lb, 2 cups = 1 lb = 0.5 carton -> ceiling rounding in carton unit OR let's also test cup stock lot!
              { qty: '1.5', unit: 'lb', item: 'ground beef', variant: 'beef' },
              { qty: '1.5', unit: 'lb', item: 'chicken breast', variant: 'chicken' }
            ]
          }
        ]
      };
      globalThis.byId['pantry-test-stew'] = testStewRecipe41;
      const days41 = blankDays();
      // Sunday dinner: Pantry Test Stew (variant: 'beef')
      days41[0].dinner.dishes = [{ recipe: 'pantry-test-stew', variant: 'beef', scale: 1 }];
      // Monday lunch: Leftovers of Pantry Test Stew (leftovers: true)
      days41[1].lunch.dishes = [{ recipe: 'pantry-test-stew', variant: 'beef', scale: 1, leftovers: true }];
      setPlan({ '2026-11-15': { days: days41 } });

      const cookRes1 = await toggleDishCooked('2026-11-15', 0, 'dinner', 0, {
        todayYmd: '2026-11-19',
        nowMs: 1795089600000,
        skipRemoteSave: true
      });
      const onionAfterCook41 = getPantryHaveFor('onion', 'unit', { todayYmd: '2026-11-19' });
      const beefAfterCook41 = getPantryHaveFor('ground beef', 'lb', { todayYmd: '2026-11-19' });
      const chickenAfterCook41 = getPantryHaveFor('chicken breast', 'lb', { todayYmd: '2026-11-19' });
      const remainingOnionLot41 = onionAfterCook41.activeLots[0];

      check('Section 41(d.1) ("Cooked it" ceiling rounding, partial-lot opened shelf life & variant deduction): 1.8 lb onion (2.5 units) rounds UP via ceiling to deduct 3 onions (leaving 2); remaining onion lot marks openedAt="2026-11-19" and switches to fridge 7-day cut-onion expiry ("2026-11-26"); beef variant (1.5 lb -> ceil 2 lb) deducts while chicken variant (4 lb) is untouched',
        cookRes1?.cooked === true &&
        getWeek('2026-11-15').days[0].dinner.dishes[0].cookedAt === 1795089600000 &&
        onionAfterCook41.stockQty === 2 &&
        remainingOnionLot41?.openedAt === '2026-11-19' &&
        remainingOnionLot41?.storage === 'fridge' &&
        remainingOnionLot41?.expiresAt === '2026-11-26' &&
        beefAfterCook41.stockQty === 2 &&
        chickenAfterCook41.stockQty === 4);

      // Leftovers dish should mark cookedAt without deducting a second time
      const leftoverCookRes41 = await toggleDishCooked('2026-11-15', 1, 'lunch', 0, {
        todayYmd: '2026-11-19',
        nowMs: 1795093200000,
        skipRemoteSave: true
      });
      check('Section 41(d.2) (leftovers no double-deduct): marking a leftovers dish as cooked sets cookedAt without deducting ingredients a second time',
        leftoverCookRes41?.cooked === true &&
        leftoverCookRes41?.deductions?.length === 0 &&
        getPantryHaveFor('onion', 'unit', { todayYmd: '2026-11-19' }).stockQty === 2 &&
        getPantryHaveFor('ground beef', 'lb', { todayYmd: '2026-11-19' }).stockQty === 2);

      // Un-marking the Sunday dinner dish restores deducted stock and original lot state
      const uncookRes41 = await toggleDishCooked('2026-11-15', 0, 'dinner', 0, {
        todayYmd: '2026-11-19',
        skipRemoteSave: true
      });
      const onionAfterUncook41 = getPantryHaveFor('onion', 'unit', { todayYmd: '2026-11-19' });
      const beefAfterUncook41 = getPantryHaveFor('ground beef', 'lb', { todayYmd: '2026-11-19' });
      check('Section 41(d.3) (un-mark cooked restores stock): tapping "Cooked it" again clears cookedAt and restores the deducted quantities (5 onions in pantry storage, 4 lb ground beef)',
        uncookRes41?.cooked === false &&
        !getWeek('2026-11-15').days[0].dinner.dishes[0].cookedAt &&
        onionAfterUncook41.stockQty === 5 &&
        !onionAfterUncook41.activeLots[0]?.openedAt &&
        onionAfterUncook41.activeLots[0]?.storage === 'pantry' &&
        beefAfterUncook41.stockQty === 4);

      // 41(e) Partial-stock flag, dialog math ("This recipe needs X. Your pantry has Y."), full-cover Already Have auto-mark, and exclusion from estimated total
      resetPantrySession();
      // Recipe needs: 3 onions, 2 lb carrots, 1 bottle olive oil
      // Pantry has: 1 onion (partial cover -> shortfall 2 onions + flag), 3 lb carrots (full cover -> moves to Already Have with pantryCovered:true), and unconfirmed olive oil (qty: null -> stays in To Buy with flag)
      const shopTestRecipe41 = {
        id: 'pantry-shop-test',
        title: 'Pantry Shop Test',
        categories: ['main'],
        kosher_status: 'pareve',
        servings: '4',
        ingredients: [
          {
            section: '',
            items: [
              { qty: '3', unit: '', item: 'onion' },
              { qty: '2', unit: 'lb', item: 'carrot' },
              { qty: '1', unit: 'bottle', item: 'olive oil' }
            ]
          }
        ]
      };
      globalThis.byId['pantry-shop-test'] = shopTestRecipe41;
      setMeta([shopTestRecipe41]);
      const shopDays41 = blankDays();
      shopDays41[6].dinner.dishes = [{ recipe: 'pantry-shop-test', scale: 1 }];
      setPlan({ '2026-11-15': { days: shopDays41 } });

      await setPantryManualStock('onion', 1, 'unit', { todayYmd: '2026-11-19', skipRemoteSave: true });
      await setPantryManualStock('carrot', 3, 'lb', { todayYmd: '2026-11-19', skipRemoteSave: true });
      // Add unconfirmed olive oil lot from receipt
      _pantryCache = mergeReceiptStockIntoPantry(_pantryCache, {
        stock: {
          'olive oil': {
            bought_name: 'Extra Virgin Olive Oil',
            total_qty: null,
            unit: 'bottle',
            has_unconfirmed: true,
            lots: [{ lot_key: 'rcpt-oil-1', qty: null, unit: 'bottle', receipt_date: '2026-11-16', bought_name: 'Extra Virgin Olive Oil', unconfirmed: true }]
          }
        }
      }, '2026-11-19');

      const rawShopList41 = buildShoppingList();
      const weekShop41 = getWeek('2026-11-15');
      // Run applyPantryToShopItem through splitShopItems or directly
      const onionRawItem41 = rawShopList41.find(it => it.base === 'onion');
      const carrotRawItem41 = rawShopList41.find(it => it.base === 'carrot');
      const oilRawItem41 = rawShopList41.find(it => it.base === 'olive oil');

      const onionApplied41 = applyPantryToShopItem(onionRawItem41, weekShop41);
      const carrotApplied41 = applyPantryToShopItem(carrotRawItem41, weekShop41);
      const oilApplied41 = applyPantryToShopItem(oilRawItem41, weekShop41);

      const savedThisWeekKey41 = globalThis.thisWeekKey;
      const savedShoppingFromYmd41 = globalThis.shoppingFromYmd;
      globalThis.thisWeekKey = () => '2026-11-15';
      globalThis.shoppingFromYmd = () => '2026-11-15';
      // Rebuild rawShopList41 with shoppingFromYmd = 2026-11-15 so Sunday-Saturday dishes are included
      const fullList41 = buildShoppingList();
      const onionFull41 = fullList41.find(it => it.base === 'onion');
      const carrotFull41 = fullList41.find(it => it.base === 'carrot');
      const oilFull41 = fullList41.find(it => it.base === 'olive oil');

      const onionRes41 = applyPantryToShopItem(onionFull41, weekShop41);
      const carrotRes41 = applyPantryToShopItem(carrotFull41, weekShop41);
      const oilRes41 = applyPantryToShopItem(oilFull41, weekShop41);
      const dialogState41 = buildPantryFlagDialogState(onionFull41.key, weekShop41);

      check('Section 41(e.1) (partial-stock flag, full cover & dialog math): carrot (have 3 lb >= need 2 lb) moves to Already Have with pantryCovered:true; onion (need 3, have 1) stays in To Buy with shortfall qty 2, pantryFlag.kind==="partial", and dialog text "This recipe needs 3. Your pantry has 1."; unconfirmed olive oil triggers pantryFlag.kind==="unconfirmed"',
        carrotRes41.toBuyItem === null &&
        carrotRes41.haveItem?.pantryCovered === true &&
        onionRes41.haveItem === null &&
        onionRes41.toBuyItem?.qty === 2 &&
        onionRes41.toBuyItem?.pantryFlag?.kind === 'partial' &&
        onionRes41.toBuyItem?.pantryFlag?.neededQty === 3 &&
        onionRes41.toBuyItem?.pantryFlag?.haveQty === 1 &&
        onionRes41.toBuyItem?.pantryFlag?.shortfallQty === 2 &&
        dialogState41?.promptText === 'This recipe needs 3. Your pantry has 1.' &&
        dialogState41?.buyQty === 2 &&
        oilRes41.toBuyItem?.pantryFlag?.kind === 'unconfirmed');

      // Confirming an edit in the partial-stock dialog updates data/pantry.json AND overrides the week's buy quantity
      applyPantryFlagDialogConfirm('onion', 2, 'unit', 1, weekShop41, {
        todayYmd: '2026-11-19',
        skipRemoteSave: true
      });
      const onionAfterDialog41 = applyPantryToShopItem(onionFull41, weekShop41);
      check('Section 41(e.2) (dialog confirm updates pantry & week buy qty): editing haveQty to 2 and buyQty to 1 updates pantry stock to 2 and sets To Buy row qty to 1',
        getPantryHaveFor('onion', 'unit', { todayYmd: '2026-11-19' }).stockQty === 2 &&
        onionAfterDialog41.toBuyItem?.qty === 1);

      // 41(e.3) End-to-end splitShopItems + shoppingListHTML with pantry-covered carrot and partial-stock onion
      const savedGetHideStaples41 = globalThis.getHideStaples;
      const savedShoppingFromLabel41 = globalThis.shoppingFromLabel;
      const savedHelpLinkHTML41 = globalThis.helpLinkHTML;
      globalThis.getHideStaples = () => false;
      globalThis.shoppingFromLabel = () => 'Sun–Sat';
      globalThis.helpLinkHTML = () => '';
      setPriceHistoryCache({
        'onion': { price_cents: 100, basis: 'each', bought_name: 'Yellow Onions', store: "Aron's Kissena Farms", receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] },
        'carrot': { price_cents: 150, basis: 'lb', bought_name: 'Carrots', store: "Aron's Kissena Farms", receipt_date: '2026-11-15', avg12m_cents: null, by_store: {}, last3: [] }
      });
      setShopStore('all');
      const splitRes41 = splitShopItems(fullList41, weekShop41);
      const shopHtml41 = shoppingListHTML();
      check('Section 41(e.3) (pantry-covered excluded from estimated total & rendered badges): splitShopItems moves full-covered carrot to haveIts with pantryCovered:true ("from pantry" badge), excludes carrot ($3.00) from estimated total so only the 1 remaining onion ($1.00) is estimated ("Estimated total about $1.00 · 1 of 2 items priced"), and renders .shop-pantry-flag on partial-stock rows',
        splitRes41.haveIts.some(it => it.base === 'carrot' && it.pantryCovered === true) &&
        !splitRes41.toBuy.some(it => it.base === 'carrot') &&
        splitRes41.toBuy.some(it => it.base === 'onion' && it.qty === 1 && !!it.pantryFlag) &&
        shopHtml41.includes('shop-pantry-covered-badge') &&
        shopHtml41.includes('from pantry') &&
        shopHtml41.includes('shop-pantry-flag') &&
        shopHtml41.includes('Estimated total about $1.00 · 1 of 2 items priced'));
      resetPriceHistorySession();
      globalThis.getHideStaples = savedGetHideStaples41;
      globalThis.shoppingFromLabel = savedShoppingFromLabel41;
      globalThis.helpLinkHTML = savedHelpLinkHTML41;

      globalThis.thisWeekKey = savedThisWeekKey41;
      globalThis.shoppingFromYmd = savedShoppingFromYmd41;

      // 41(f) Expiry, raw meat freezer default, storage switch (freezer -> fridge starts fridge clock), and "Still good" override
      resetPantrySession();
      const meatStorage41 = defaultStorageForPantryItem('chicken breast');
      const groundBeefStorage41 = defaultStorageForPantryItem('ground beef');
      const salmonStorage41 = defaultStorageForPantryItem('salmon fillet');

      // Add chicken breast in default freezer storage on 2026-01-01 (more than 180 days before 2026-11-19)
      // Freezer days are QUALITY alerts only — must remain status: 'good' and count in haveQty!
      await setPantryManualStock('chicken breast', 3, 'lb', { todayYmd: '2026-01-01', skipRemoteSave: true });
      const frozenChickenLot41 = JSON.parse(JSON.stringify(_pantryCache['chicken breast']?.lots?.[0]));
      const frozenChickenHave41 = getPantryHaveFor('chicken breast', 'lb', { todayYmd: '2026-11-19' });
      const frozenSoonAlert41 = isLotExpiringSoon('chicken breast', frozenChickenLot41, '2026-11-19');

      // Switch chicken breast lot from freezer -> fridge on 2026-11-19: starts 1-day fridge clock -> expiresAt = 2026-11-20
      await switchPantryLotStorage('chicken breast', frozenChickenLot41.lotId, 'fridge', {
        todayYmd: '2026-11-19',
        skipRemoteSave: true
      });
      const thawedChickenLot41 = JSON.parse(JSON.stringify(_pantryCache['chicken breast']?.lots?.[0]));

      // Add fresh spinach in fridge on 2026-11-01 (leafy greens fridge_days: 3 -> expired by 2026-11-19)
      await setPantryManualStock('spinach', 1, 'bag', { todayYmd: '2026-11-01', skipRemoteSave: true });
      // Re-normalize as of 2026-11-19 so expiry is evaluated against today
      setPantryCache(_pantryCache, '2026-11-19');
      const expiredSpinachHave41 = getPantryHaveFor('spinach', 'bag', { todayYmd: '2026-11-19' });
      const expiredSpinachLot41 = JSON.parse(JSON.stringify(_pantryCache['spinach']?.lots?.[0]));
      const pantryHtmlBeforeOverride41 = pantryViewHTML({ todayYmd: '2026-11-19' });

      // Override expired spinach with "Still good" -> status becomes 'overridden', counts in haveQty again, and stays 'overridden' even in future dates
      await overridePantryLotStillGood('spinach', expiredSpinachLot41.lotId, {
        todayYmd: '2026-11-19',
        skipRemoteSave: true
      });
      const overriddenSpinachHave41 = getPantryHaveFor('spinach', 'bag', { todayYmd: '2026-12-31' });
      const overriddenSpinachLot41 = _pantryCache['spinach']?.lots?.[0];

      check('Section 41(f) (raw meat freezer default, freezer quality-only rule, freezer->fridge switch clock, expired exclusion & "Still good" override): raw meat/poultry/fish defaults to freezer; past-freezer_days lot stays status "good" and counts in have (with quality alert); switching freezer->fridge starts fridge_days clock at switch date (2026-11-19 + 1d = 2026-11-20); expired fridge lot is excluded from have (haveQty===0) but remains in pantry view; "Still good" sets status "overridden", restores haveQty===1, and never auto-expires again',
        meatStorage41 === 'freezer' &&
        groundBeefStorage41 === 'freezer' &&
        salmonStorage41 === 'freezer' &&
        frozenChickenLot41?.storage === 'freezer' &&
        frozenChickenHave41.haveQty === 3 &&
        frozenSoonAlert41 === true &&
        thawedChickenLot41?.storage === 'fridge' &&
        thawedChickenLot41?.switchedAt === '2026-11-19' &&
        thawedChickenLot41?.expiresAt === '2026-11-20' &&
        expiredSpinachLot41?.status === 'expired' &&
        expiredSpinachHave41.haveQty === 0 &&
        expiredSpinachHave41.hasExpired === true &&
        pantryHtmlBeforeOverride41.includes('data-pantry-stillgood="spinach|') &&
        overriddenSpinachLot41?.status === 'overridden' &&
        overriddenSpinachHave41.haveQty === 1);

      // 41(g) Tombstone removal & receipt lot suppression
      await removePantryEntry('spinach', { todayYmd: '2026-11-19', nowMs: new Date('2026-11-19T18:00:00Z').getTime(), skipRemoteSave: true });
      const tombstonedSpinach41 = _pantryCache['spinach'];
      // Attempt to re-merge an older receipt lot from 2026-11-16 for spinach -> tombstone must block resurrection
      const afterReingest41 = mergeReceiptStockIntoPantry(_pantryCache, {
        stock: {
          'spinach': {
            bought_name: 'Baby Spinach',
            total_qty: 1,
            unit: 'bag',
            has_unconfirmed: false,
            lots: [{ lot_key: 'rcpt-spin-old', qty: 1, unit: 'bag', receipt_date: '2026-11-16', bought_name: 'Baby Spinach', unconfirmed: false }]
          }
        }
      }, '2026-11-19');
      check('Section 41(g) (tombstone removal & older receipt suppression): removePantryEntry writes {status:null, updatedAt} tombstone, zeroes haveQty, and prevents older receipt lots from resurrecting the removed item',
        tombstonedSpinach41?.status === null &&
        tombstonedSpinach41?.updatedAt > 0 &&
        getPantryHaveFor('spinach', 'bag', { todayYmd: '2026-11-19', pantryMap: afterReingest41 }).haveQty === 0 &&
        afterReingest41['spinach']?.status === null);

      // Clean up pantry session state
      resetPantrySession();
      delete globalThis.__pantryTodayYmd;
    }
  }

  /* ============ 42. Pantry readability fix batch (v20261119d + Bridge git-v19) ============ */
  {
    globalThis.shelfLifeTable = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shelf-life.json'), 'utf8'));
    globalThis.unitConversions = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'unit-conversions.json'), 'utf8'));
    resetPantrySession();
    globalThis.__pantryTodayYmd = '2026-11-19';

    // 42(a) Shelf-life matcher resolves real receipt group keys that missed before the fix
    const slName = k => { const sl = lookupShelfLife(k, {}); return sl ? (sl.name || '') : null; };
    const matcherCases42 = [
      ['garlic sleeve', /garlic/i], ['garlic loose', /garlic/i],
      ['cucumber hothouse english', /cucumber/i], ['cucumber persian', /cucumber/i],
      ['yam sweet', /sweet potato/i], ['tomato stem', /tomato/i], ['tomatoes on the vine', /tomato/i],
      ['potato yukon gold loose', /potato/i], ['potato idaho loose', /potato/i],
      ['grapes seedless green', /grape/i], ['onion shallot', /onion/i], ['onion red', /onion/i],
      ['onion yellow globe loose', /onion/i], ['apple gala', /apple/i], ['apple granny smith', /apple/i],
      ['pear asian', /pear/i], ['banana organic', /banana/i], ['carrots cut peeled', /carrot/i],
      ['mushrooms sliced white', /mushroom/i], ['galil mushrooms pieces stem', /mushroom/i],
      ['parsley italian', /parsley/i], ['avocado ha', /avocado/i], ['raw pecan', /nut/i],
      ['pardes farms broccoli floret', /broccoli/i], ['mandarin bag', /orange|mandarin/i],
      ['solomons sliced beef pastrami', /deli/i], ['tirat zvi turkey breast smoked', /deli/i],
      ['flaum smoked nova lox', /deli/i], ['polly o twist cheese mozzarella cheddar', /cheese/i],
      ['part skim mozzarella', /cheese/i], ['feta cheese', /cheese/i],
      ['millers sliced orange muenster', /cheese/i], ['milk half gallon low fat', /milk/i],
      ['farms creamery margarine unsalted', /margarine/i], ['tuscanini capers in brine', /pickle/i],
      ['tonnelli marinara sauce', /pasta sauce/i], ['bowl basket fettuccine', /pasta/i],
      ['black bean', /canned/i], ['hearts of palm', /canned/i], ['pasta hearts of palm', /canned/i],
      ['hummus chili onion crunc', /hummus/i], ['pickles sour', /pickle/i],
      ['ungers pie crusts deep dish', /dough/i], ['plain pizza dough', /dough/i],
      ['dyna sea imitation crab stick', /crab/i], ['jj cassone bagels assorted', /bagel/i],
      ['freeze dried raspberry', /dried fruit/i]
    ];
    const matcherMisses42 = matcherCases42.filter(([k, re]) => { const n = slName(k); return !n || !re.test(n); }).map(([k]) => k);
    check('Section 42(a) (shelf-life matcher on real receipt keys): all 47 previously-missed receipt group keys now resolve to the right canonical shelf-life entry (produce, deli, cheese, grocery, frozen)',
      matcherMisses42.length === 0);

    // 42(b) Non-food filter: site merge skip + bridge /pantry-stock exclusion
    const mergedNonFood42 = mergeReceiptStockIntoPantry({}, {
      ok: true,
      stock: {
        'bottle deposit': { bought_name: 'Bottle Deposit', lots: [{ lot_key: 'nf1', qty: 7, unit: 'ea', receipt_date: '2026-11-15', bought_name: 'Bottle Deposit', unconfirmed: false }] },
        'sunscreen spf 30': { bought_name: 'Sunscreen SPF 30', lots: [{ lot_key: 'nf2', qty: 1, unit: 'ea', receipt_date: '2026-11-15', bought_name: 'Sunscreen SPF 30', unconfirmed: false }] },
        'onion': { bought_name: 'Yellow Onions', lots: [{ lot_key: 'nf3', qty: 2, unit: 'lb', receipt_date: '2026-11-15', bought_name: 'Yellow Onions', unconfirmed: false }] }
      }
    }, '2026-11-19');
    const worker19Path = path.join(SITE_DIR, 'bridge-git-v19', 'worker.js');
    const receipts19Path = path.join(SITE_DIR, 'bridge-git-v19', 'receipts.js');
    const worker19Mod = await import('file://' + worker19Path);
    const receipts19Mod = await import('file://' + receipts19Path);
    const health19Res = await worker19Mod.default.fetch(new Request('https://recipe-bridge.leibreiss.workers.dev/health'), makeMockEnv([]));
    const health19Json = await health19Res.json();
    const stockRes42 = await receipts19Mod.handlePantryStock(
      new Request('https://recipe-bridge.leibreiss.workers.dev/pantry-stock'),
      makeMockEnv([
        { status: 'verified', needs_review: 0, group_key: 'bottle deposit', receipt_dept: 'GROCERY', category: 'grocery', paid_price_cents: 35, qty_or_weight: 7, unit: 'ea', pack_size: null, store: 'Trader Joe\'s', product_name: 'Bottle Deposit', raw_line: 'BOTTLE DEPOSIT', receipt_date: '2026-11-15', receipt_id: 'rcpt42_1', line_no: 1, id: 4201 },
        { status: 'verified', needs_review: 0, group_key: 'onion', receipt_dept: 'PRODUCE', category: 'produce', paid_price_cents: 199, qty_or_weight: 2, unit: 'lb', pack_size: null, store: 'Trader Joe\'s', product_name: 'Yellow Onions', raw_line: 'ONIONS', receipt_date: '2026-11-15', receipt_id: 'rcpt42_2', line_no: 2, id: 4202 }
      ]),
      { nowMs: new Date('2026-11-19T12:00:00Z').getTime(), circularRates: {} }
    );
    const stockJson42 = await stockRes42.json();
    check('Section 42(b) (non-food exclusion, bridge git-v19): /health reports "git-v19"; bridge /pantry-stock drops bottle-deposit rows; site mergeReceiptStockIntoPantry skips bottle deposit + sunscreen but keeps real food',
      health19Json.version === 'git-v19' &&
      !stockJson42.stock['bottle deposit'] &&
      !!stockJson42.stock['onion'] &&
      !mergedNonFood42['bottle deposit'] &&
      !mergedNonFood42['sunscreen spf 30'] &&
      !!mergedNonFood42['onion'] &&
      isPantryNonFoodKey('perfection plates white') === true &&
      isPantryNonFoodKey('onion') === false);

    // 42(c) Plain-word formatting helpers
    check('Section 42(c) (plain-word date/qty formatting): fmtPantryDate renders "Nov 8" same-year and "Nov 8, 2025" other-year; fmtPantryQty hides ea/unit, renders measure packs as "2 × 6 oz", pluralizes real units',
      fmtPantryDate('2026-11-08', '2026-11-19') === 'Nov 8' &&
      fmtPantryDate('2025-11-08', '2026-11-19') === 'Nov 8, 2025' &&
      fmtPantryDate('2026-06-03', '2026-11-19') === 'Jun 3' &&
      fmtPantryDate('not-a-date', '2026-11-19') === 'not-a-date' &&
      fmtPantryQty(3, 'ea') === '3' &&
      fmtPantryQty(1, 'unit') === '1' &&
      fmtPantryQty(2, '6 oz') === '2 × 6 oz' &&
      fmtPantryQty(1.5, 'lb') === '1½ lb');

    // 42(d) Pantry view HTML: stacked lot structure, plain dates, no "no expiry", CSS badge class names
    const viewMap42 = mergeReceiptStockIntoPantry({}, {
      ok: true,
      stock: {
        'solomons sliced beef pastrami': { bought_name: 'Sliced Beef Pastrami', lots: [{ lot_key: 'v42a', qty: 2, unit: '6 oz', receipt_date: '2026-11-15', bought_name: 'Sliced Beef Pastrami', unconfirmed: false }] },
        'brussel sprout': { bought_name: 'Brussel Sprouts', lots: [{ lot_key: 'v42b', qty: 1.82, unit: 'lb', receipt_date: '2026-11-01', bought_name: 'Brussel Sprouts', unconfirmed: false }] }
      }
    }, '2026-11-19');
    const viewHTML42 = pantryViewHTML({ pantryMap: viewMap42, todayYmd: '2026-11-19', pricesMap: {} });
    check('Section 42(d) (pantry view readability): lots render in .pantry-lot-top/.pantry-lot-meta blocks with "2 × 6 oz", "bought Nov 15", an "expires"/"expired" phrase in plain words, no "no expiry" text, no raw ISO dates, and expired lots use the pantry-badge-expired class',
      viewHTML42.includes('pantry-lot-top') &&
      viewHTML42.includes('pantry-lot-meta') &&
      viewHTML42.includes('2 × 6 oz') &&
      viewHTML42.includes('bought Nov 15') &&
      /expires [A-Z][a-z]{2} \d+/.test(viewHTML42) &&
      !viewHTML42.includes('no expiry') &&
      !/\d{4}-\d{2}-\d{2}/.test(viewHTML42) &&
      viewHTML42.includes('pantry-badge-expired'));

    // 42(e) Storage defaults follow the table (raw meat freezer; cooked/cured meat fridge)
    check('Section 42(e) (storage defaults): raw chicken breast defaults to freezer, while deli meat and hot dogs default to fridge per the shelf-life table (not forced to freezer by category)',
      defaultStorageForPantryItem('chicken breast', {}) === 'freezer' &&
      defaultStorageForPantryItem('solomons sliced beef pastrami', {}) === 'fridge' &&
      defaultStorageForPantryItem('hot dog', {}) === 'fridge');

    // 42(f) CSS source asserts: header wrap + stacked pantry layout + add-form grid
    const cssSrc42 = fs.readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
    const navWrap42 = /\.main-nav\s*\{[^}]*flex-wrap:\s*wrap/.test(cssSrc42.slice(cssSrc42.indexOf('@media')));
    check('Section 42(f) (CSS source): mobile .main-nav wraps (no cutoff), .pantry-lot-top/.pantry-lot-meta exist, .pantry-add-row is a grid with full-width name field',
      navWrap42 &&
      cssSrc42.includes('.pantry-lot-top') &&
      cssSrc42.includes('.pantry-lot-meta') &&
      /\.pantry-add-row\s*\{[^}]*display:\s*grid/.test(cssSrc42) &&
      cssSrc42.includes('#pantry-add-name'));

    resetPantrySession();
    delete globalThis.__pantryTodayYmd;
  }

  /* ============ 43. Pantry batch 2 (v20261120a): all 9 changes ============ */
  {
    globalThis.__pantryTodayYmd = '2026-11-19';

    // 43(a) Header / Footer / Shopping List History link
    const indexHtml43 = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
    const navMatch43 = indexHtml43.match(/<nav class="main-nav"[\s\S]*?<\/nav>/);
    const navHtml43 = navMatch43 ? navMatch43[0] : '';
    const navLinks43 = navHtml43.match(/<a\b[^>]*>/g) || [];
    const footerMatch43 = indexHtml43.match(/<footer[\s\S]*?<\/footer>/);
    const footerHtml43 = footerMatch43 ? footerMatch43[0] : '';
    check('Section 43(a) (Header/Footer + Shopping History entry point): main-nav has exactly 4 links (Recipes, Meal Planner, Shopping List, Pantry), no #nav-receipts or #nav-guide in header, #nav-guide is in footer, and shoppingListHTML store bar has href="#/receipts"',
      navLinks43.length === 4 &&
      !navHtml43.includes('id="nav-receipts"') &&
      !navHtml43.includes('id="nav-guide"') &&
      footerHtml43.includes('id="nav-guide"') &&
      footerHtml43.includes('href="#/guide"') &&
      SRC.includes('href="#/receipts" id="shop-history-link"') &&
      /v=20261120[ab]/.test(indexHtml43));

    // 43(b) fmtPantryQty with digit-starting units ("3 pk", "6 oz")
    check('Section 43(b) (fmtPantryQty digit-starting units): fmtPantryQty(1, "3 pk") === "1 × 3 pk", fmtPantryQty(2, "6 oz") === "2 × 6 oz", fmtPantryQty(1.5, "lb") === "1½ lb"',
      fmtPantryQty(1, '3 pk') === '1 × 3 pk' &&
      fmtPantryQty(2, '6 oz') === '2 × 6 oz' &&
      fmtPantryQty(1.5, 'lb') === '1½ lb');

    // 43(c) Edit lot qty (setPantryLotQty): updates qty, confirms unconfirmed lots, records 'edit' history, allows 0 (used up), renders inline editor + "Saved ✓"
    const editMap43 = normalizePantryData({
      'garlic': {
        displayName: 'Garlic',
        unit: '3 pk',
        lots: [{ lotId: 'g-lot-1', qty: null, unit: '3 pk', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt', unconfirmed: true }]
      }
    }, '2026-11-19');
    const editRes1 = setPantryLotQty(editMap43, 'garlic', 'g-lot-1', 2, '2026-11-19');
    const lotAfterConfirm = JSON.parse(JSON.stringify(editMap43['garlic'].lots[0]));
    const htmlEditing43 = pantryViewHTML({ pantryMap: editMap43, todayYmd: '2026-11-19', editingKey: 'garlic|g-lot-1', savedKey: 'garlic|g-lot-1', pricesMap: {} });
    const editResZero = setPantryLotQty(editMap43, 'garlic', 'g-lot-1', 0, '2026-11-19');
    const lotAfterZero = JSON.parse(JSON.stringify(editMap43['garlic'].lots[0]));
    const htmlUsedUp43 = pantryViewHTML({ pantryMap: editMap43, todayYmd: '2026-11-19', pricesMap: {} });
    check('Section 43(c) (edit lot qty + visible save confirmation + used-up at 0): setPantryLotQty confirms unconfirmed lot, records edit history, renders inline editor & "Saved ✓", and qty=0 keeps lot visible with "used up" badge',
      editRes1.ok === true &&
      lotAfterConfirm.qty === 2 &&
      lotAfterConfirm.unconfirmed === false &&
      Array.isArray(lotAfterConfirm.history) &&
      lotAfterConfirm.history.length === 1 &&
      lotAfterConfirm.history[0].kind === 'edit' &&
      lotAfterConfirm.history[0].qtyAfter === 2 &&
      htmlEditing43.includes('data-pantry-qty-in="garlic|g-lot-1"') &&
      htmlEditing43.includes('Saved ✓') &&
      editResZero.ok === true &&
      editMap43['garlic'].lots.length === 1 &&
      lotAfterZero.qty === 0 &&
      lotAfterZero.history.length === 2 &&
      lotAfterZero.history[1].delta === -2 &&
      lotAfterZero.history[1].qtyAfter === 0 &&
      htmlUsedUp43.includes('pantry-badge-usedup') &&
      htmlUsedUp43.includes('used up') &&
      htmlUsedUp43.includes('is-used-up'));

    // 43(d) Opened toggle per lot (setPantryLotOpened + pantryItemSupportsOpened)
    const openMap43 = normalizePantryData({
      'solomons sliced beef pastrami': {
        displayName: 'Sliced Beef Pastrami',
        unit: '6 oz',
        lots: [{ lotId: 'pas-1', qty: 2, unit: '6 oz', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }]
      },
      'egg': {
        displayName: 'Eggs',
        unit: 'dozen',
        lots: [{ lotId: 'egg-1', qty: 1, unit: 'dozen', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-19');
    const pasBeforeExp = openMap43['solomons sliced beef pastrami'].lots[0].expiresAt; // unopened_fridge_days = 14 -> 2026-11-29
    const htmlBeforeOpen = pantryViewHTML({ pantryMap: openMap43, todayYmd: '2026-11-19', pricesMap: {} });
    const openRes1 = setPantryLotOpened(openMap43, 'solomons sliced beef pastrami', 'pas-1', '2026-11-19', '2026-11-19');
    const pasAfterOpen = JSON.parse(JSON.stringify(openMap43['solomons sliced beef pastrami'].lots[0])); // opened_fridge_days = 3 -> 2026-11-22
    const htmlAfterOpen = pantryViewHTML({ pantryMap: openMap43, todayYmd: '2026-11-19', pricesMap: {} });
    const openRes2 = setPantryLotOpened(openMap43, 'solomons sliced beef pastrami', 'pas-1', '2026-11-17', '2026-11-19');
    const pasAfterBackdate = JSON.parse(JSON.stringify(openMap43['solomons sliced beef pastrami'].lots[0])); // 2026-11-17 + 3 = 2026-11-20
    const openRes3 = setPantryLotOpened(openMap43, 'solomons sliced beef pastrami', 'pas-1', null, '2026-11-19');
    const pasAfterUnmark = JSON.parse(JSON.stringify(openMap43['solomons sliced beef pastrami'].lots[0]));
    check('Section 43(d) (opened toggle per lot): shown only when shelf-life has opened_*_days; marking opened sets openedAt, shortens expiresAt, records opened history; date adjustment recomputes expiresAt; unmarking restores unopened expiresAt',
      pantryItemSupportsOpened('solomons sliced beef pastrami') === true &&
      pantryItemSupportsOpened('egg') === false &&
      pasBeforeExp === '2026-11-29' &&
      htmlBeforeOpen.includes('data-pantry-mark-opened="solomons sliced beef pastrami|pas-1"') &&
      !htmlBeforeOpen.includes('data-pantry-mark-opened="egg|egg-1"') &&
      openRes1.ok === true &&
      pasAfterOpen.openedAt === '2026-11-19' &&
      pasAfterOpen.expiresAt === '2026-11-22' &&
      pasAfterOpen.history.some(h => h.kind === 'opened') &&
      htmlAfterOpen.includes('data-pantry-opened-date="solomons sliced beef pastrami|pas-1"') &&
      htmlAfterOpen.includes('data-pantry-unmark-opened="solomons sliced beef pastrami|pas-1"') &&
      openRes2.ok === true &&
      pasAfterBackdate.expiresAt === '2026-11-20' &&
      openRes3.ok === true &&
      !pasAfterUnmark.openedAt &&
      pasAfterUnmark.expiresAt === '2026-11-29');

    // 43(e) Black beans: container <-> unit conversion + unit-conversions.json entry
    const bbConv1 = convertPantryQty('black beans', 1, 'can', 'unit');
    const bbConv2 = convertPantryQty('black beans', 2, 'unit', 'can');
    const bbConvLb = convertPantryQty('black bean', 1, 'unit', 'lb');
    const bbDedMap = normalizePantryData({
      'black bean': {
        displayName: 'Black Beans',
        unit: 'unit',
        lots: [{ lotId: 'bb-1', qty: 3, unit: 'unit', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-19');
    const bbDed = deductIngredientFromPantryMap(bbDedMap, 'black beans', 1, 'can', { todayYmd: '2026-11-19', dishTitle: 'Burritos' });
    check('Section 43(e) (black beans container <-> unit conversion): 1 can <-> 1 unit (and black bean in unit-conversions.json), deducting 1 can from 3 unit leaves 2 unit',
      bbConv1.convertible === true && bbConv1.qty === 1 &&
      bbConv2.convertible === true && bbConv2.qty === 2 &&
      bbConvLb.convertible === true && Math.abs(bbConvLb.qty - 0.94) < 0.01 &&
      bbDed.length === 1 &&
      bbDed[0].deductedQty === 1 &&
      bbDedMap['black bean'].lots[0].qty === 2);

    // 43(f) Purge non-food entries at load / normalize / merge
    const dirtyNonFood = {
      'bottle deposit': { displayName: 'Bottle Deposit', qty: 7, unit: 'unit', lots: [{ lotId: 'nf1', qty: 7, unit: 'unit', addedAt: '2026-11-15' }], updatedAt: 100 },
      'perfection plates white': { status: null, updatedAt: 200 },
      'onion': { displayName: 'Onion', unit: 'lb', lots: [{ lotId: 'on1', qty: 2, unit: 'lb', addedAt: '2026-11-15' }], updatedAt: 150 }
    };
    const cleaned43 = normalizePantryData(dirtyNonFood, '2026-11-19');
    const merged43 = mergePantryData(dirtyNonFood, {
      'sunscreen spf 30': { displayName: 'Sunscreen', unit: 'unit', lots: [{ lotId: 'nf2', qty: 1, unit: 'unit', addedAt: '2026-11-15' }], updatedAt: 300 }
    });
    check('Section 43(f) (purge non-food at load/merge): normalizePantryData and mergePantryData drop bottle deposit, perfection plates white (even tombstone), and sunscreen while keeping onion',
      !cleaned43['bottle deposit'] &&
      !cleaned43['perfection plates white'] &&
      !!cleaned43['onion'] &&
      !merged43['bottle deposit'] &&
      !merged43['perfection plates white'] &&
      !merged43['sunscreen spf 30'] &&
      !!merged43['onion']);

    // 43(g) Per-lot deduction history + restore history + plain-word UI
    const histMap43 = normalizePantryData({
      'chicken breast': {
        displayName: 'Chicken Breast',
        unit: 'lb',
        lots: [{ lotId: 'cb-1', qty: 2, unit: 'lb', storage: 'freezer', addedAt: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-19');
    const cbDed = deductIngredientFromPantryMap(histMap43, 'chicken breast', 0.81, 'lb', { todayYmd: '2026-11-19', dishTitle: 'Burritos', noCeiling: true });
    const lotAfterCook = JSON.parse(JSON.stringify(histMap43['chicken breast'].lots[0]));
    restorePantryDeductionsToMap(histMap43, cbDed, { todayYmd: '2026-11-19', dishTitle: 'Burritos' });
    const lotAfterRestore = JSON.parse(JSON.stringify(histMap43['chicken breast'].lots[0]));
    const histViewHTML = pantryViewHTML({ pantryMap: histMap43, todayYmd: '2026-11-19', pricesMap: {} });
    check('Section 43(g) (per-lot deduction history): cooking records kind="cooked" with dish name and negative delta; un-cooking restores qty and appends kind="restore" without wiping history; UI renders <details class="pantry-lot-history"> in plain words',
      lotAfterCook.qty === 1.19 &&
      lotAfterRestore.qty === 2 &&
      lotAfterRestore.history.length === 2 &&
      lotAfterRestore.history[0].kind === 'cooked' &&
      lotAfterRestore.history[0].delta === -0.81 &&
      lotAfterRestore.history[0].dish === 'Burritos' &&
      lotAfterRestore.history[1].kind === 'restore' &&
      lotAfterRestore.history[1].delta === 0.81 &&
      histViewHTML.includes('pantry-lot-history') &&
      histViewHTML.includes('Burritos (cooked)') &&
      histViewHTML.includes('(restored)'));

    // 43(h) Fettuccine name fallback + whole-pack ("16 oz") deduction
    const fettMap43 = normalizePantryData({
      'bowl basket fettuccine': {
        displayName: 'Bowl & Basket Fettuccine',
        unit: '16 oz',
        lots: [{ lotId: 'fett-1', qty: 1, unit: '16 oz', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }]
      },
      'pasta-hearts-of-palm': {
        displayName: 'Hearts of Palm Pasta',
        unit: 'unit',
        lots: [{ lotId: 'hop-1', qty: 2, unit: 'unit', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      },
      'green bean': {
        displayName: 'Green Beans',
        unit: 'lb',
        lots: [{ lotId: 'gb-1', qty: 1, unit: 'lb', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-19');
    const resolvedFett = resolvePantryEntryKey('fettuccine pasta', fettMap43);
    const resolvedBlackBeanNoFalseMatch = resolvePantryEntryKey('black beans', fettMap43);
    const packConv = convertPantryQty('bowl basket fettuccine', 0.75, 'lb', '16 oz');
    const fettDed = deductIngredientFromPantryMap(fettMap43, 'fettuccine pasta', 0.75, 'lb', { todayYmd: '2026-11-19', dishTitle: 'Fettuccine Alfredo' });
    check('Section 43(h) (fettuccine name fallback + whole-pack deduction): "fettuccine pasta" resolves to "bowl basket fettuccine" (not hearts of palm), "black beans" does NOT false-match "green bean", 0.75 lb converts to 0.75 of a "16 oz" pack, and cooking deducts 1 whole pack leaving qty 0 (used up)',
      resolvedFett === 'bowl basket fettuccine' &&
      resolvedBlackBeanNoFalseMatch !== 'green bean' &&
      !fettMap43[resolvedBlackBeanNoFalseMatch] &&
      packConv.convertible === true &&
      Math.abs(packConv.qty - 0.75) < 0.001 &&
      fettDed.length === 1 &&
      fettDed[0].deductedQty === 1 &&
      fettMap43['bowl basket fettuccine'].lots.length === 1 &&
      fettMap43['bowl basket fettuccine'].lots[0].qty === 0 &&
      fettMap43['bowl basket fettuccine'].lots[0].history[0].kind === 'cooked');

    // 43(i) Heal stale storage on saved lots
    const staleStorageMap43 = normalizePantryData({
      'solomons sliced beef pastrami': {
        displayName: 'Sliced Beef Pastrami',
        unit: '6 oz',
        lots: [
          { lotId: 'stale-1', qty: 2, unit: '6 oz', storage: 'freezer', addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' },
          { lotId: 'explicit-1', qty: 1, unit: '6 oz', storage: 'freezer', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' },
          { lotId: 'switched-1', qty: 1, unit: '6 oz', storage: 'freezer', switchedAt: '2026-11-16', addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }
        ]
      }
    }, '2026-11-19');
    const healedLots = staleStorageMap43['solomons sliced beef pastrami'].lots;
    check('Section 43(i) (heal stale storage on saved lots): lot without storageExplicit or switchedAt re-derives default storage ("fridge" for pastrami, expires Nov 29), while lots with storageExplicit or switchedAt keep "freezer"',
      healedLots[0].storage === 'fridge' &&
      healedLots[0].expiresAt === '2026-11-29' &&
      healedLots[1].storage === 'freezer' &&
      healedLots[2].storage === 'freezer');

    // 43(j) Container <-> unit 1:1 fallback with NO conversion-table entry (Muse review addition:
    // 43(e) passes via the lb bridge because "black bean" now has a conv entry, so the fallback
    // itself needs its own coverage with an empty conv map).
    const contFwd = convertPantryQty('test canned widget', 2, 'can', 'unit', {});
    const contRev = convertPantryQty('test canned widget', 3, 'unit', 'jar', {});
    const contNarrow = convertPantryQty('test canned widget', 1, 'can', 'lb', {});
    check('Section 43(j) (container fallback without conv entry): can->unit and unit->jar convert 1:1 with empty conv map, can->lb stays non-convertible',
      contFwd.convertible === true && contFwd.qty === 2 &&
      contRev.convertible === true && contRev.qty === 3 &&
      contNarrow.convertible === false);

    // =========================================================================
    // Section 44 — v20261120b Pantry Batch 3 (8 items: 44a through 44h)
    // =========================================================================

    // 44(a) Item 1: Un-mark cooked restores pantry ONCE (no double-restore across savePantry)
    globalThis.__pantryTodayYmd = '2026-11-20';
    globalThis.shoppingSections = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data', 'shopping-sections.json'), 'utf8'));
    const testBurritos44 = {
      id: 'test-burritos-44',
      title: 'Test Burritos 44',
      categories: ['main'],
      kosher_status: 'meat',
      servings: '4',
      ingredients: [
        {
          section: '',
          items: [
            { qty: '0.81', unit: 'lb', item: 'chicken breast' },
            { qty: '1', unit: 'can', item: 'black beans (15 oz)' }
          ]
        }
      ]
    };
    globalThis.byId['test-burritos-44'] = testBurritos44;
    resetPantrySession();
    const initialCook44 = normalizePantryData({
      'chicken breast': {
        displayName: 'Chicken Breast',
        unit: 'lb',
        lots: [{ lotId: 'cb-44', qty: 3.16, unit: 'lb', storage: 'freezer', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      },
      'black bean': {
        displayName: 'Black Beans',
        unit: 'unit',
        lots: [{ lotId: 'bb-44', qty: 3, unit: 'unit', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-20');
    setPantryCache(initialCook44, '2026-11-20');
    const days44 = blankDays();
    days44[0].dinner.dishes = [{ recipe: 'test-burritos-44', scale: 1 }];
    setPlan({ '2026-11-15': { days: days44 } });

    // Intercept fetch & ghPut for data/pantry.json so savePantry runs its full merge+mutator path!
    let remotePantryJson44 = JSON.stringify(_pantryCache);
    const savedFetch44 = globalThis.fetch;
    const savedGhPut44 = globalThis.ghPut;
    globalThis.fetch = async (url) => {
      if (String(url).includes('data%2Fpantry.json') || String(url).includes('data/pantry.json')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, content: remotePantryJson44 }) };
      }
      return savedFetch44(url);
    };
    globalThis.ghPut = async (p, text) => {
      if (p === 'data/pantry.json') {
        remotePantryJson44 = text;
        return { ok: true };
      }
      return savedGhPut44(p, text);
    };

    // Mark cooked -> deducts 0.81 lb -> ceiling 1 lb chicken breast (3.16 -> 2.16) and 1 unit black bean (3 -> 2)
    await toggleDishCooked('2026-11-15', 0, 'dinner', 0, {
      todayYmd: '2026-11-20',
      nowMs: 1795176000000
    });
    const cbAfterCook44 = JSON.parse(JSON.stringify(_pantryCache['chicken breast'].lots[0]));
    const bbAfterCook44 = JSON.parse(JSON.stringify(_pantryCache['black bean'].lots[0]));

    // Un-mark cooked (with full savePantry execution!) -> must restore ONCE back to 3.16 lb (not 4.16 lb) and 3 unit (not 4 unit)
    await toggleDishCooked('2026-11-15', 0, 'dinner', 0, {
      todayYmd: '2026-11-20'
    });
    const cbAfterUncook44 = JSON.parse(JSON.stringify(_pantryCache['chicken breast'].lots[0]));
    const bbAfterUncook44 = JSON.parse(JSON.stringify(_pantryCache['black bean'].lots[0]));
    const persistedAfterUncook44 = JSON.parse(remotePantryJson44);
    globalThis.fetch = savedFetch44;
    globalThis.ghPut = savedGhPut44;

    check('Section 44(a) (un-mark cooked restores once): marking cooked deducts 3.16->2.16 lb and records 1 cooked event; un-marking cooked restores once to 3.16 lb (not 4.16) in both _pantryCache and persisted data/pantry.json with exactly 1 restore event',
      Math.abs(cbAfterCook44.qty - 2.16) < 0.001 &&
      cbAfterCook44.history.filter(h => h.kind === 'cooked').length === 1 &&
      bbAfterCook44.qty === 2 &&
      Math.abs(cbAfterUncook44.qty - 3.16) < 0.001 &&
      Math.abs(persistedAfterUncook44['chicken breast'].lots[0].qty - 3.16) < 0.001 &&
      cbAfterUncook44.history.filter(h => h.kind === 'cooked').length === 1 &&
      cbAfterUncook44.history.filter(h => h.kind === 'restore').length === 1 &&
      bbAfterUncook44.qty === 3 &&
      persistedAfterUncook44['black bean'].lots[0].qty === 3 &&
      bbAfterUncook44.history.filter(h => h.kind === 'restore').length === 1);

    // 44(b) Item 2: Black beans with parenthetical pack size ("black beans (15 oz)")
    const bbParenMap44 = normalizePantryData({
      'black bean': {
        displayName: 'Black Beans',
        unit: 'unit',
        lots: [{ lotId: 'bb-p1', qty: 3, unit: 'unit', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      },
      'green bean': {
        displayName: 'Green Beans',
        unit: 'lb',
        lots: [{ lotId: 'gb-p1', qty: 1, unit: 'lb', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-20');
    const resolvedParen44 = resolvePantryEntryKey('black beans (15 oz)', bbParenMap44);
    const convParenCan44 = convertPantryQty('black beans (15 oz)', 1, 'can', 'unit');
    const convParenLb44 = convertPantryQty('black beans (15 oz)', 1, 'unit', 'lb');
    const dedParen44 = deductIngredientFromPantryMap(bbParenMap44, 'black beans (15 oz)', 1, 'can', { todayYmd: '2026-11-20', dishTitle: 'Chicken Black Bean Burritos' });
    check('Section 44(b) (parenthetical pack size resolution & deduction): "black beans (15 oz)" resolves to "black bean", converts 1 can -> 1 unit and 1 unit -> 0.94 lb, and deducts 1 unit leaving qty 2 with cooked history',
      resolvedParen44 === 'black bean' &&
      convParenCan44.convertible === true && convParenCan44.qty === 1 &&
      convParenLb44.convertible === true && Math.abs(convParenLb44.qty - 0.94) < 0.01 &&
      dedParen44.length === 1 &&
      dedParen44[0].deductedQty === 1 &&
      bbParenMap44['black bean'].lots[0].qty === 2 &&
      bbParenMap44['black bean'].lots[0].history.length === 1 &&
      bbParenMap44['black bean'].lots[0].history[0].kind === 'cooked' &&
      bbParenMap44['black bean'].lots[0].history[0].dish === 'Chicken Black Bean Burritos');

    // 44(c) Item 3: Editable total quantity in card header (setPantryTotalQty + UI)
    const totMap44 = normalizePantryData({
      'onion': {
        displayName: 'Onion',
        unit: 'lb',
        lots: [
          { lotId: 'on-old', qty: 1, unit: 'lb', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-10', receiptDate: '2026-11-10', source: 'receipt' },
          { lotId: 'on-new', qty: 2, unit: 'lb', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }
        ]
      }
    }, '2026-11-20');
    // Decrease from 3 -> 1.5: drains oldest lot (1 -> 0) and 0.5 from newest lot (2 -> 1.5)
    const totDecRes = setPantryTotalQty(totMap44, 'onion', 1.5, '2026-11-20');
    const lotsAfterDec44 = JSON.parse(JSON.stringify(totMap44['onion'].lots));
    const totAfterDec44 = getPantryHaveFor('onion', 'lb', { todayYmd: '2026-11-20', pantryMap: totMap44 }).stockQty;
    // Increase from 1.5 -> 4: adds +2.5 to newest confirmed lot (on-new: 1.5 -> 4)
    const totIncRes = setPantryTotalQty(totMap44, 'onion', 4, '2026-11-20');
    const lotsAfterInc44 = JSON.parse(JSON.stringify(totMap44['onion'].lots));
    const totAfterInc44 = getPantryHaveFor('onion', 'lb', { todayYmd: '2026-11-20', pantryMap: totMap44 }).stockQty;
    // Set to 0: sets all confirmed lots to 0 (used up)
    const totZeroRes = setPantryTotalQty(totMap44, 'onion', 0, '2026-11-20');
    const lotsAfterZero44 = JSON.parse(JSON.stringify(totMap44['onion'].lots));
    const totAfterZero44 = getPantryHaveFor('onion', 'lb', { todayYmd: '2026-11-20', pantryMap: totMap44 }).stockQty;
    const htmlTotalEdit44 = pantryViewHTML({ pantryMap: totMap44, todayYmd: '2026-11-20', editingTotalKey: 'onion', savedKey: 'total|onion', pricesMap: {} });
    check('Section 44(c) (editable total quantity in card header): decreasing drains FIFO across lots with edit history, increasing adds to newest confirmed lot, 0 marks all lots used-up, and header renders inline total editor & Saved ✓',
      totDecRes.ok === true &&
      totAfterDec44 === 1.5 &&
      lotsAfterDec44.find(l => l.lotId === 'on-old').qty === 0 &&
      lotsAfterDec44.find(l => l.lotId === 'on-old').history.some(h => h.kind === 'edit' && h.delta === -1) &&
      lotsAfterDec44.find(l => l.lotId === 'on-new').qty === 1.5 &&
      lotsAfterDec44.find(l => l.lotId === 'on-new').history.some(h => h.kind === 'edit' && h.delta === -0.5) &&
      totIncRes.ok === true &&
      totAfterInc44 === 4 &&
      lotsAfterInc44.find(l => l.lotId === 'on-new').qty === 4 &&
      totZeroRes.ok === true &&
      totAfterZero44 === 0 &&
      lotsAfterZero44.every(l => l.qty === 0) &&
      htmlTotalEdit44.includes('data-pantry-total-in="onion"') &&
      htmlTotalEdit44.includes('data-pantry-total-save="onion"') &&
      htmlTotalEdit44.includes('Saved ✓'));

    // 44(d) Item 4: Editable expiry date per lot (setPantryLotExpiry + Reset to auto + UI)
    const expMap44 = normalizePantryData({
      'solomons sliced beef pastrami': {
        displayName: 'Sliced Beef Pastrami',
        unit: '6 oz',
        lots: [{ lotId: 'pas-exp-1', qty: 2, unit: '6 oz', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-20');
    const autoExp44 = expMap44['solomons sliced beef pastrami'].lots[0].expiresAt; // 2026-11-15 + 14 = 2026-11-29
    // Set explicit future expiry
    const setExpFuture = setPantryLotExpiry(expMap44, 'solomons sliced beef pastrami', 'pas-exp-1', '2026-12-05', '2026-11-20');
    const lotAfterFutureExp = JSON.parse(JSON.stringify(expMap44['solomons sliced beef pastrami'].lots[0]));
    // Re-normalizing preserves explicit expiresAt
    const renormFuture = normalizePantryData(expMap44, '2026-11-20');
    // Set explicit past expiry -> lot status flips to 'expired' and getPantryHaveFor moves lot to expiredLots
    const setExpPast = setPantryLotExpiry(expMap44, 'solomons sliced beef pastrami', 'pas-exp-1', '2026-11-10', '2026-11-20');
    const lotAfterPastExp = JSON.parse(JSON.stringify(expMap44['solomons sliced beef pastrami'].lots[0]));
    const haveAfterPastExp = getPantryHaveFor('solomons sliced beef pastrami', '6 oz', { todayYmd: '2026-11-20', pantryMap: expMap44 });
    // Reset to auto (null) -> clears expiresAtExplicit, recomputes auto expiry, flips back to 'good'
    const setExpAuto = setPantryLotExpiry(expMap44, 'solomons sliced beef pastrami', 'pas-exp-1', null, '2026-11-20');
    const lotAfterAutoExp = JSON.parse(JSON.stringify(expMap44['solomons sliced beef pastrami'].lots[0]));
    const htmlExpiryClosed44 = pantryViewHTML({ pantryMap: expMap44, todayYmd: '2026-11-20', pricesMap: {} });
    const htmlExpiryOpen44 = pantryViewHTML({ pantryMap: expMap44, todayYmd: '2026-11-20', editingExpiryKey: 'solomons sliced beef pastrami|pas-exp-1', pricesMap: {} });
    check('Section 44(d) (editable lot expiry date + Reset to auto): explicit date persists across normalize, past date flips lot & entry to expired, null resets to auto shelf-life expiry, records expiry history, and UI renders tappable date button & inline date editor',
      autoExp44 === '2026-11-29' &&
      setExpFuture.ok === true &&
      lotAfterFutureExp.expiresAt === '2026-12-05' &&
      lotAfterFutureExp.expiresAtExplicit === true &&
      renormFuture['solomons sliced beef pastrami'].lots[0].expiresAt === '2026-12-05' &&
      lotAfterFutureExp.history.some(h => h.kind === 'expiry' && h.expiresAt === '2026-12-05') &&
      formatPantryLotHistoryEvent(lotAfterFutureExp.history[0], '6 oz', '2026-11-20').includes('expiry set to Dec 5') &&
      setExpPast.ok === true &&
      lotAfterPastExp.status === 'expired' &&
      haveAfterPastExp.activeLots.length === 0 &&
      haveAfterPastExp.expiredLots.length === 1 &&
      setExpAuto.ok === true &&
      !lotAfterAutoExp.expiresAtExplicit &&
      lotAfterAutoExp.expiresAt === '2026-11-29' &&
      lotAfterAutoExp.status === 'good' &&
      formatPantryLotHistoryEvent(lotAfterAutoExp.history[lotAfterAutoExp.history.length - 1], '6 oz', '2026-11-20').includes('expiry reset to auto') &&
      htmlExpiryClosed44.includes('data-pantry-edit-expiry="solomons sliced beef pastrami|pas-exp-1"') &&
      htmlExpiryOpen44.includes('data-pantry-expiry-in="solomons sliced beef pastrami|pas-exp-1"') &&
      htmlExpiryOpen44.includes('data-pantry-expiry-auto="solomons sliced beef pastrami|pas-exp-1"'));

    // 44(e) Item 5: Expiring-soon chip is a tappable button with data-pantry-soon-jump and scrollToPantryCard scrolls/highlights (and opens closed <details> / clears search filter)
    const soonMap44 = normalizePantryData({
      'spinach': {
        displayName: 'Spinach',
        unit: 'bag',
        lots: [{ lotId: 'sp-1', qty: 1, unit: 'bag', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-18', receiptDate: '2026-11-18', source: 'receipt' }]
      }
    }, '2026-11-20'); // leafy greens fridge_days=3 -> expires 2026-11-21 (within 3 days of 2026-11-20)
    const htmlSoon44 = pantryViewHTML({ pantryMap: soonMap44, todayYmd: '2026-11-20', pricesMap: {} });
    let scrolledCalled44 = false;
    const addedClasses44 = new Set();
    const fakeDetails44 = { open: false };
    const fakeCard44 = {
      getAttribute: (attr) => attr === 'data-pantry-item' ? 'spinach' : null,
      closest: (sel) => sel === 'details' ? fakeDetails44 : null,
      scrollIntoView: () => { scrolledCalled44 = true; },
      classList: {
        add: (c) => addedClasses44.add(c),
        remove: (c) => addedClasses44.delete(c)
      }
    };
    const fakeApp44 = {
      querySelector: (sel) => sel === '[data-pantry-item="spinach"]' ? fakeCard44 : null
    };
    const jumpCard44 = scrollToPantryCard('spinach', fakeApp44);
    if (globalThis._pantryHighlightTimer) {
      clearTimeout(globalThis._pantryHighlightTimer);
      globalThis._pantryHighlightTimer = null;
    }
    check('Section 44(e) (expiring-soon chip tap jumps to card): chip renders as <button class="pantry-soon-chip" data-pantry-soon-jump="spinach"> and scrollToPantryCard opens enclosing <details>, calls scrollIntoView, and applies pantry-card-highlight',
      htmlSoon44.includes('<button type="button" class="pantry-soon-chip" data-pantry-soon-jump="spinach">') &&
      jumpCard44 === fakeCard44 &&
      fakeDetails44.open === true &&
      scrolledCalled44 === true &&
      addedClasses44.has('pantry-card-highlight'));

    // 44(f) Item 6: Used-up clarity ("None left" header) + Remove confirmation dialog
    const usedUpMap44 = normalizePantryData({
      'garlic': {
        displayName: 'Garlic',
        unit: '3 pk',
        lots: [{ lotId: 'g-u1', qty: 0, unit: '3 pk', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'receipt' }]
      }
    }, '2026-11-20');
    const htmlNoneLeft44 = pantryViewHTML({ pantryMap: usedUpMap44, todayYmd: '2026-11-20', pricesMap: {} });
    check('Section 44(f) (used-up "None left" header + Remove confirmation): all-used-up item card header reads "None left" (not "0 × 3 pk used up") while lot badge still shows "used up", and wirePantryEvents guards Remove with confirm("Remove <item> from the pantry?")',
      htmlNoneLeft44.includes('>None left</button>') &&
      !htmlNoneLeft44.includes('0 × 3 pk used up') &&
      htmlNoneLeft44.includes('<span class="pantry-badge pantry-badge-usedup">used up</span>') &&
      SRC.includes("confirmFn('Remove ' + dispName + ' from the pantry?')"));

    // 44(g) Item 7: Pantry search filter (filters In Stock & Expired, keeps Expiring soon unfiltered, hides empty dept headers, shows "No matches for ...")
    const searchMap44 = normalizePantryData({
      'apple': {
        displayName: 'Honeycrisp Apples',
        unit: 'lb',
        lots: [{ lotId: 'ap-1', qty: 2, unit: 'lb', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-15', receiptDate: '2026-11-15', source: 'receipt' }]
      },
      'milk': {
        displayName: 'Whole Milk',
        unit: 'gal',
        lots: [{ lotId: 'mk-1', qty: 1, unit: 'gal', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-13', receiptDate: '2026-11-13', openedAt: '2026-11-13', source: 'receipt' }]
      },
      'spinach': {
        displayName: 'Baby Spinach',
        unit: 'bag',
        lots: [{ lotId: 'sp-2', qty: 1, unit: 'bag', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-10', receiptDate: '2026-11-10', source: 'receipt' }]
      }
    }, '2026-11-20'); // opened milk (9d) expires 2026-11-22 (expiring soon), spinach expired 2026-11-13
    const htmlSearchApple44 = pantryViewHTML({ pantryMap: searchMap44, todayYmd: '2026-11-20', query: 'apple', pricesMap: {} });
    const htmlSearchNone44 = pantryViewHTML({ pantryMap: searchMap44, todayYmd: '2026-11-20', query: 'dragonfruit', pricesMap: {} });
    check('Section 44(g) (pantry search): search input filters In Stock and Expired cards case-insensitively, hides empty department headers, leaves Expiring soon chips unfiltered, and shows "No matches for “...”." when nothing matches',
      htmlSearchApple44.includes('id="pantry-search-input"') &&
      htmlSearchApple44.includes('data-pantry-item="apple"') &&
      !htmlSearchApple44.includes('data-pantry-item="milk"') &&
      !htmlSearchApple44.includes('data-pantry-item="spinach"') &&
      htmlSearchApple44.includes('data-pantry-dept="Fresh Produce"') &&
      !htmlSearchApple44.includes('data-pantry-dept="Dairy &amp; Eggs"') &&
      htmlSearchApple44.includes('data-pantry-soon-jump="milk"') &&
      htmlSearchNone44.includes('No matches for “dragonfruit”.'));

    // 44(h) Item 8: Group In Stock items by store department in shopping-sections.json order with "Unsorted" last; Expired stays flat
    const deptMap44 = normalizePantryData({
      'mystery-widget-xyz': {
        displayName: 'Mystery Widget XYZ',
        unit: 'unit',
        lots: [{ lotId: 'mw-1', qty: 1, unit: 'unit', storage: 'pantry', storageExplicit: true, addedAt: '2026-11-15', source: 'manual' }]
      },
      'milk': {
        displayName: 'Whole Milk',
        unit: 'gal',
        lots: [{ lotId: 'mk-2', qty: 1, unit: 'gal', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-18', receiptDate: '2026-11-18', source: 'receipt' }]
      },
      'apple': {
        displayName: 'Apples',
        unit: 'lb',
        lots: [{ lotId: 'ap-2', qty: 3, unit: 'lb', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-18', receiptDate: '2026-11-18', source: 'receipt' }]
      },
      'spinach': {
        displayName: 'Expired Spinach',
        unit: 'bag',
        lots: [{ lotId: 'sp-3', qty: 1, unit: 'bag', storage: 'fridge', storageExplicit: true, addedAt: '2026-11-01', receiptDate: '2026-11-01', source: 'receipt' }]
      }
    }, '2026-11-20');
    const htmlDept44 = pantryViewHTML({ pantryMap: deptMap44, todayYmd: '2026-11-20', pricesMap: {} });
    const prodIdx44 = htmlDept44.indexOf('data-pantry-dept="Fresh Produce"');
    const dairyIdx44 = htmlDept44.indexOf('data-pantry-dept="Dairy &amp; Eggs"');
    const unsortedIdx44 = htmlDept44.indexOf('data-pantry-dept="Unsorted"');
    const expiredSectionPart44 = htmlDept44.split('pantry-expired-section')[1] || '';
    const indexHtml44 = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
    check('Section 44(h) (In Stock grouped by store department + v20261120b cache-buster): In Stock renders Fresh Produce before Dairy & Eggs before Unsorted with item counts, Expired section stays flat without department headers, and index.html uses ?v=20261120b',
      prodIdx44 > -1 &&
      dairyIdx44 > prodIdx44 &&
      unsortedIdx44 > dairyIdx44 &&
      htmlDept44.includes('<span class="pantry-dept-name">Fresh Produce</span> <span class="pantry-dept-count">(1)</span>') &&
      htmlDept44.includes('<span class="pantry-dept-name">Dairy &amp; Eggs</span> <span class="pantry-dept-count">(1)</span>') &&
      htmlDept44.includes('<span class="pantry-dept-name">Unsorted</span> <span class="pantry-dept-count">(1)</span>') &&
      !expiredSectionPart44.includes('data-pantry-dept=') &&
      indexHtml44.includes('styles.css?v=20261120b') &&
      indexHtml44.includes('app.js?v=20261120b'));

    resetPantrySession();
    delete globalThis.__pantryTodayYmd;
  }

  const failed = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' assertions passed ====');
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error('ERROR', e); process.exitCode = 1; });


