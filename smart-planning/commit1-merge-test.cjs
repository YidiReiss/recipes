/* Commit 1 (Smart Meal Planning v1, Step 0) — offline simulation tests.
   Extracts the REAL functions from the modified site/app.js (brace-matched
   source slices, eval'd against stubs) and proves the spec's merge + save
   semantics. No network: fetch/ghPut are fakes backed by an in-memory
   "server" object. Run: node commit1-merge-test.cjs */
const fs = require('fs');
const path = require('path');

const APP_PATH = fs.existsSync(path.join(__dirname, 'app.js'))
  ? path.join(__dirname, 'app.js')
  : path.join(__dirname, '..', 'site', 'app.js');
const SRC = fs.readFileSync(APP_PATH, 'utf8');

function extract(name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\s*\\(').exec(SRC);
  if (!m) throw new Error('extract: function not found in app.js: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return SRC.slice(m.index, j);
}

/* ---------------- stubs (globals the extracted code resolves) ---------------- */
let serverState = { weeks: {} };      // what the fake bridge /read returns; ghPut overwrites
let events = [];                      // read/write event log (serialization proof)
let reads = 0, writeAttempts = 0, failPuts = 0;
let hangPuts = false, releasePut = null;   // (g) in-flight test: park ghPut until released
let hangReads = false, releaseRead = null; // (i) read-phase test: park bridgeReadMealPlan until released
const sleep = ms => new Promise(r => setTimeout(r, ms));

globalThis.BRIDGE = 'fake://bridge';
globalThis.location = { hash: '#/' };
globalThis.mealPlan = { weeks: {} };
globalThis._savePlanChain = Promise.resolve();
globalThis.saveShopLocal = () => {};
globalThis.fetch = async () => {
  events.push('read-start'); reads++;
  if (hangReads) { await new Promise(res => { releaseRead = res; }); }
  await sleep(3);
  events.push('read-end');
  return { ok: true, json: async () => ({ ok: true, content: JSON.stringify(serverState) }) };
};
globalThis.ghPut = async (p, text) => {
  events.push('write-start'); writeAttempts++;
  if (hangPuts) { await new Promise(res => { releasePut = res; }); }
  await sleep(3);
  if (failPuts > 0) { failPuts--; events.push('write-fail'); throw new Error('fake 409'); }
  serverState = JSON.parse(text);
  events.push('write-end');
  return { ok: true };
};
/* persistWeek / loadShopLocal stubs */
globalThis.toast = () => {};
let lsStore = {};
globalThis.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; },
};
globalThis.SHOP_LOCAL_KEY = 'recipe-shop-local';
/* weekStrip stubs */
const META = { brisket: { title: 'Brisket' }, 'soup-x': { title: 'Soup X' } };
globalThis.recipeMeta = id => META[id] || null;
globalThis.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
globalThis.ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
globalThis.getWeek = key => globalThis.mealPlan.weeks[key];

/* ---------------- load the real functions from app.js ----------------
   Indirect eval -> global scope, so the declarations bind on globalThis and
   stay visible after the loop (a direct eval inside forEach would scope
   them to the callback). */
const geval = (0, eval);
/* The in-flight counter is a `let`, not a function: a bare `let` evaluated on
   its own does not persist across separate indirect evals, so eval the real
   declaration TOGETHER with the real saveMealPlan in one eval — the function
   then closes over that binding — and expose the counter through a getter in
   the same eval scope (its observable equivalent for the assertions). */
const inflightDecl = SRC.match(/let _savePlanInFlight = 0;/);
if (!inflightDecl) throw new Error('_savePlanInFlight declaration not found in app.js');
const shopDirtyDecls = [
  SRC.match(/let _shopSyncTimer = null;/)[0],
  SRC.match(/let _shopDirty = false;/)[0],
  SRC.match(/let _shopDirtyGen = 0;/)[0]
].join('\n');
geval(inflightDecl[0] + '\n' + shopDirtyDecls + '\n' +
      extract('saveMealPlan') + '\n' +
      extract('attemptSaveMealPlan') + '\n' +
      extract('saveShopLocal') + '\n' +
      extract('markShopDirty') + '\n' +
      extract('syncShopSoon') + '\n' +
      extract('syncShop') +
      '\n;globalThis.__getSavePlanInFlight = () => _savePlanInFlight;' +
      '\n;globalThis.__getShopDirtyState = () => ({ dirty: _shopDirty, gen: _shopDirtyGen, timer: _shopSyncTimer });' +
      '\n;globalThis.__clearShopSyncTimer = () => { if (_shopSyncTimer) { clearTimeout(_shopSyncTimer); _shopSyncTimer = null; } };');
['normalizeHaveMarks', 'mergeHaveMarks', 'mergeManualItems', 'normalizePromotedList',
 'mergePromoted', 'mergeWeekState', 'mergeMealPlan', 'bridgeReadMealPlan',
 'persistWeek', 'loadShopLocal',
 'normalizeSlot', 'sundayOf',
 'weekDayYmd', 'thisWeekKey', 'weekStripHTML',
].forEach(n => geval(extract(n)));

/* ---------------- tiny assertion harness ---------------- */
const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : ''));
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* Key-order-insensitive deep compare (merge helpers rebuild objects). */
const sortDeep = v => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]))
      : v);
const canonEq = (a, b) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
const canonArrEq = (a, b) => canonEq(
  [...(a || [])].sort((x, y) => JSON.stringify(sortDeep(x)) < JSON.stringify(sortDeep(y)) ? -1 : 1),
  [...(b || [])].sort((x, y) => JSON.stringify(sortDeep(x)) < JSON.stringify(sortDeep(y)) ? -1 : 1));

async function main() {
  if (typeof mergeMealPlan !== 'function' || typeof saveMealPlan !== 'function') {
    throw new Error('extracted functions did not load');
  }

  /* ===== (a) stale-tab days never overwrite fresh days ===== */
  const K = '2026-10-25';
  const freshDays = [{ lunch: { dishes: [{ custom: 'FRESH' }] }, dinner: { dishes: [] } }];
  const staleDays = [{ lunch: { dishes: [{ custom: 'STALE' }] }, dinner: { dishes: [] } }];
  const fresh = { weeks: { [K]: {
    days: freshDays, shoppingDay: '2026-10-26', dismissedWarnings: ['w1'],
    haveGenerated: [{ key: 'milk|', session: 's2', at: 50 },
                     { key: 'egg|', session: 's1', at: 100 }],
  } } };
  const local = { weeks: { [K]: {
    days: staleDays, shoppingDay: null, dismissedWarnings: [],
    haveGenerated: [{ key: 'egg|', session: 's1', at: 200, removed: true },
                    { key: 'butter|', session: 's1', at: 150 }],
    manualItems: [{ id: 'm1', text: 'Milk', have: false, updatedAt: 5 }],
    conflictAcked: { 'egg|': true },
    optionalPromoted: ['flour|'],
  }, '2026-12-06': { days: [{ tag: 'local-only' }] } } };
  const merged = mergeMealPlan(fresh, local);
  check('(a) merged days are the FRESH days', eq(merged.weeks[K].days, freshDays));
  check('(a) shoppingDay from fresh', merged.weeks[K].shoppingDay === '2026-10-26');
  check('(a) dismissedWarnings from fresh', eq(merged.weeks[K].dismissedWarnings, ['w1']));
  check('(a) local-only week preserved', eq(merged.weeks['2026-12-06'].days, [{ tag: 'local-only' }]));

  /* ===== (b) shopping keys still merge ===== */
  const marks = merged.weeks[K].haveGenerated || [];
  const egg = marks.find(m => m.key === 'egg|' && m.session === 's1');
  check('(b) have-marks union: server-only mark kept', marks.some(m => m.key === 'milk|'));
  check('(b) have-marks union: local-only mark kept', marks.some(m => m.key === 'butter|'));
  check('(b) uncheck tombstone (newer at) beats older checked copy', !!egg && egg.removed === true && egg.at === 200);
  check('(b) manualItems merged in', (merged.weeks[K].manualItems || []).some(i => i.id === 'm1'));
  check('(b) conflictAcked merged in', !!(merged.weeks[K].conflictAcked || {})['egg|']);
  check('(b) optionalPromoted merged in (legacy string normalized)',
    (merged.weeks[K].optionalPromoted || []).some(p => (typeof p === 'string' ? p : p.key) === 'flour|'));

  /* ===== (c) recipePrefs last-writer-wins ===== */
  const mp2 = mergeMealPlan(
    { weeks: {}, recipePrefs: { a: { rating: 'fine', updatedAt: 100 },
                                b: { rating: 'skip', updatedAt: 300 },
                                c: { rating: 'favorite', updatedAt: 50 } } },
    { weeks: {}, recipePrefs: { a: { rating: 'favorite', updatedAt: 200 },
                                b: { rating: 'fine', updatedAt: 150 },
                                d: { rating: 'fine', updatedAt: 10 } } });
  check('(c) local newer pref wins', mp2.recipePrefs.a.rating === 'favorite');
  check('(c) fresh newer pref wins', mp2.recipePrefs.b.rating === 'skip');
  check('(c) fresh-only pref kept', mp2.recipePrefs.c.rating === 'favorite');
  check('(c) local-only pref kept', mp2.recipePrefs.d.rating === 'fine');

  /* ===== (d) yieldLog union capped at latest 200 ===== */
  const day = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const fLog = Array.from({ length: 150 }, (_, i) => ({ id: 'f' + i, recipe: 'r', scale: 1, left: 'a lot', date: day(i) }));
  const lLog = [
    ...Array.from({ length: 50 }, (_, i) => ({ id: 'f' + (100 + i), recipe: 'r', scale: 1, left: 'most', date: day(100 + i) })),
    ...Array.from({ length: 100 }, (_, i) => ({ id: 'l' + i, recipe: 'r', scale: 1, left: 'a little', date: day(200 + i) })),
  ];
  const mp3 = mergeMealPlan({ weeks: {}, yieldLog: fLog }, { weeks: {}, yieldLog: lLog });
  const ids = new Set(mp3.yieldLog.map(e => e.id));
  check('(d) union deduped by id (250 -> capped 200)', mp3.yieldLog.length === 200 && ids.size === 200,
    'len=' + mp3.yieldLog.length);
  check('(d) earliest entries dropped', !ids.has('f0') && !ids.has('f49'));
  check('(d) boundary + all local entries kept', ids.has('f50') && ids.has('l0') && ids.has('l99'));

  /* ===== framework LWW ===== */
  const fw1 = mergeMealPlan({ weeks: {}, framework: { name: 'F', updatedAt: 100 } },
                            { weeks: {}, framework: { name: 'L', updatedAt: 200 } });
  const fw2 = mergeMealPlan({ weeks: {}, framework: { name: 'F', updatedAt: 300 } },
                            { weeks: {}, framework: { name: 'L', updatedAt: 200 } });
  check('(extra) framework: local newer wins', fw1.framework.name === 'L');
  check('(extra) framework: fresh newer wins', fw2.framework.name === 'F');

  /* ===== (e) saveMealPlan serialization: rapid sequential mutators ===== */
  serverState = { weeks: {}, recipePrefs: {} };
  globalThis.mealPlan = { weeks: {}, recipePrefs: {} };
  events = []; reads = 0; writeAttempts = 0; failPuts = 0;
  const saves = [];
  for (let i = 0; i < 5; i++) {
    saves.push(saveMealPlan(m => {
      m.weeks['2026-11-0' + (i + 1)] = { days: [], marker: i };
      (m.recipePrefs = m.recipePrefs || {})['r' + i] = { rating: 'fine', updatedAt: 1000 + i };
    }, 'test save ' + i));
  }
  await Promise.all(saves);
  const alt = events.join(',');
  const expectAlt = Array(5).fill('read-start,read-end,write-start,write-end').join(',');
  check('(e) 5 rapid saves strictly serialized (no interleaved read/write)', alt === expectAlt, alt);
  check('(e) exactly 1 read + 1 write per save (no verify-read)', reads === 5 && writeAttempts === 5,
    'reads=' + reads + ' writes=' + writeAttempts);
  check('(e) all 5 mutators landed on the server',
    [0, 1, 2, 3, 4].every(i => serverState.weeks['2026-11-0' + (i + 1)] &&
                              serverState.weeks['2026-11-0' + (i + 1)].marker === i &&
                              serverState.recipePrefs['r' + i].rating === 'fine'));
  check('(e) local mealPlan matches final server state', eq(globalThis.mealPlan, serverState));

  /* ===== retry only on failure; failure does not poison the chain ===== */
  events = []; reads = 0; writeAttempts = 0; failPuts = 2;   // fail twice, succeed on 3rd attempt
  await saveMealPlan(m => { m.weeks['retry-week'] = { days: [], marker: 'ok' }; }, 'retry test');
  check('(retry) save succeeds on 3rd attempt after 2 failures',
    serverState.weeks['retry-week'] && serverState.weeks['retry-week'].marker === 'ok' &&
    writeAttempts === 3 && reads === 3, 'reads=' + reads + ' writes=' + writeAttempts);

  failPuts = 99; reads = 0; writeAttempts = 0;
  let rejected = false;
  await saveMealPlan(m => { m.weeks['never'] = { days: [] }; }, 'doomed test').catch(() => { rejected = true; });
  check('(retry) permanent failure rejects after exactly 3 attempts', rejected && writeAttempts === 3 && reads === 3,
    'reads=' + reads + ' writes=' + writeAttempts);
  check('(retry) failed save wrote nothing', !serverState.weeks['never']);
  failPuts = 0;
  await saveMealPlan(m => { m.weeks['after-failure'] = { days: [], marker: 1 }; }, 'recovery test');
  check('(retry) chain not poisoned: next save succeeds',
    serverState.weeks['after-failure'] && serverState.weeks['after-failure'].marker === 1);

  /* ===== weekStripHTML fix: dishes-format slots render titles ===== */
  const wkKey = thisWeekKey();
  const blank = () => ({ dishes: [], skipped: false, note: '' });
  const days = Array.from({ length: 7 }, () => ({ lunch: blank(), dinner: blank() }));
  days[0].dinner = { dishes: [{ recipe: 'brisket' }, { custom: 'Pizza Night' }], skipped: false, note: '' };
  days[1].lunch = { recipe: 'soup-x', custom: null, skipped: false, note: '' };   // legacy format
  globalThis.mealPlan = { weeks: { [wkKey]: { days, shoppingDay: null } } };
  const html = weekStripHTML();
  check('(strip) dishes-format slot shows recipe title', html.includes('Brisket'));
  check('(strip) dishes-format slot shows custom dish', html.includes('Pizza Night'));
  check('(strip) legacy-format slot still shows title', html.includes('Soup X'));
  check('(strip) populated Sunday cell has no em-dash placeholder',
    !/<span class="wd-meals"><em>—<\/em><\/span>/.test(html.split('</a>')[0]));

  /* ===== (f) persistWeek mutator: concurrent shopping marks survive =====
     The Argon required-fix scenario: Phone B's newer shopping marks land on
     the server while Phone A edits a dinner slot on the same week. The real
     persistWeek runs with saveMealPlan stubbed to hand its mutator the same
     `merged` object attemptSaveMealPlan would build (mergeMealPlan(fresh,
     local)) — the mutator must keep the snapshot's days/shoppingDay AND the
     merged (Phone B) shopping keys. */
  const KF = '2026-11-08';
  const aDays = [{ lunch: { dishes: [] }, dinner: { dishes: [{ custom: 'A-EDITED DINNER' }] } }];
  const serverDaysF = [{ lunch: { dishes: [] }, dinner: { dishes: [{ custom: 'SERVER DINNER' }] } }];
  const snapshotWeek = {
    days: aDays, shoppingDay: '2026-11-09', dismissedWarnings: [],
    haveGenerated: [{ key: 'egg|', session: 'sA', at: 100 }],
    manualItems: [{ id: 'a1', text: 'Eggs', have: true, updatedAt: 5 }],
    conflictAcked: {}, optionalPromoted: [],
  };
  const freshF = { weeks: { [KF]: {
    days: serverDaysF, shoppingDay: '2026-11-10', dismissedWarnings: ['server-w'],
    haveGenerated: [{ key: 'milk|', session: 'sB', at: 300 },
                    { key: 'egg|', session: 'sA', at: 100 }],
    manualItems: [{ id: 'b1', text: 'Milk', have: false, updatedAt: 50 },
                  { id: 'a1', text: 'Eggs', have: true, updatedAt: 5 }],
    conflictAcked: { 'milk|': true },
    optionalPromoted: [{ key: 'flour|', promotedAt: 400, removedAt: null }],
  } } };
  globalThis.mealPlan = { weeks: { [KF]: snapshotWeek } };
  let resultWeek = null, expectedShop = null, doneCalled = false;
  const realSaveMealPlan = globalThis.saveMealPlan;
  globalThis.saveMealPlan = async (mutator, msg) => {
    const mergedArg = mergeMealPlan(freshF, globalThis.mealPlan);
    const mw = mergedArg.weeks[KF];
    expectedShop = JSON.parse(JSON.stringify({
      haveGenerated: mw.haveGenerated, manualItems: mw.manualItems,
      optionalPromoted: mw.optionalPromoted, conflictAcked: mw.conflictAcked,
    }));
    mutator(mergedArg);
    resultWeek = mergedArg.weeks[KF];
    return mergedArg;
  };
  await persistWeek(KF, null, () => { doneCalled = true; });
  globalThis.saveMealPlan = realSaveMealPlan;
  check('(f) persistWeek completed (done callback fired)', doneCalled && !!resultWeek);
  check('(f) result days are the SNAPSHOT (Phone A edit) days', !!resultWeek && eq(resultWeek.days, aDays));
  check('(f) result shoppingDay is the snapshot\u2019s', !!resultWeek && resultWeek.shoppingDay === '2026-11-09');
  check('(f) haveGenerated equals the merged (Phone B) marks — nothing wiped',
    !!resultWeek && canonArrEq(resultWeek.haveGenerated, expectedShop.haveGenerated) &&
    resultWeek.haveGenerated.some(m => m.key === 'milk|' && m.session === 'sB'));
  check('(f) manualItems equals the merged (Phone B) items',
    !!resultWeek && canonArrEq(resultWeek.manualItems, expectedShop.manualItems) &&
    resultWeek.manualItems.some(i => i.id === 'b1'));
  check('(f) optionalPromoted equals the merged (Phone B) value',
    !!resultWeek && canonArrEq(resultWeek.optionalPromoted, expectedShop.optionalPromoted) &&
    resultWeek.optionalPromoted.some(p => p.key === 'flour|'));
  check('(f) conflictAcked equals the merged (Phone B) value',
    !!resultWeek && canonEq(resultWeek.conflictAcked, expectedShop.conflictAcked) &&
    resultWeek.conflictAcked['milk|'] === true);

  /* ===== (g) _savePlanInFlight counter ===== */
  serverState = { weeks: {} };
  globalThis.mealPlan = { weeks: {} };
  events = []; reads = 0; writeAttempts = 0; failPuts = 0; hangPuts = true;
  const pendingSave = saveMealPlan(m => { m.weeks['inflight-week'] = { days: [], marker: 1 }; }, 'in-flight test');
  await sleep(60);   // let the read finish and ghPut park on the hang
  check('(g) counter > 0 while a save is in flight', __getSavePlanInFlight() > 0, 'value=' + __getSavePlanInFlight());
  releasePut();
  hangPuts = false;
  await pendingSave;
  check('(g) counter returns to 0 after the save settles', __getSavePlanInFlight() === 0, 'value=' + __getSavePlanInFlight());
  check('(g) the parked save still landed', !!(serverState.weeks['inflight-week'] && serverState.weeks['inflight-week'].marker === 1));
  failPuts = 99;
  await saveMealPlan(m => { m.weeks['doomed-inflight'] = { days: [] }; }, 'in-flight fail test').catch(() => {});
  failPuts = 0;
  check('(g) counter returns to 0 after a FAILED save too', __getSavePlanInFlight() === 0, 'value=' + __getSavePlanInFlight());

  /* ===== (h) loadShopLocal recovers top-level + local-only state ===== */
  const KH = '2026-11-15';
  const serverDaysH = [{ lunch: { dishes: [] }, dinner: { dishes: [{ custom: 'SERVER' }] } }];
  globalThis.mealPlan = { weeks: { [KH]: { days: serverDaysH, shoppingDay: '2026-11-16', haveGenerated: [] } } };
  lsStore = {};
  lsStore['recipe-shop-local'] = JSON.stringify({
    weeks: {
      [KH]: { days: [{ tag: 'lp days must not win' }],
              haveGenerated: [{ key: 'bread|', session: 'sL', at: 10 }] },
      '2027-01-03': { days: [{ tag: 'lp-only-week' }], haveGenerated: [] },
    },
    recipePrefs: { 'recipe-x': { rating: 'favorite', updatedAt: 500 } },
  });
  loadShopLocal();
  check('(h) stored recipePrefs entry recovered into mealPlan',
    !!globalThis.mealPlan.recipePrefs && globalThis.mealPlan.recipePrefs['recipe-x'].rating === 'favorite');
  check('(h) local-only week recovered into mealPlan',
    !!globalThis.mealPlan.weeks['2027-01-03']);
  check('(h) stored week\u2019s have-marks unioned into the server week',
    (globalThis.mealPlan.weeks[KH].haveGenerated || []).some(m => m.key === 'bread|'));
  check('(h) server days still win for the shared week',
    eq(globalThis.mealPlan.weeks[KH].days, serverDaysH));
  check('(h) merged state persisted back to localStorage',
    (JSON.parse(lsStore['recipe-shop-local']).recipePrefs || {})['recipe-x'] !== undefined);

  /* ===== (i) Shopping-list pop-back regression: tap during ghPut vs tap during read ===== */
  const KI = '2026-11-22';
  serverState = { weeks: { [KI]: { days: [], haveGenerated: [{ key: 'onion|', session: 's1', at: 100, qty: '1', unit: '' }] } } };
  globalThis.mealPlan = JSON.parse(JSON.stringify(serverState));
  lsStore = {};
  __clearShopSyncTimer();

  // Part 1: Tap landing during a pending ghPut
  // 1) First mark ("garlic|") triggers syncShop
  globalThis.mealPlan.weeks[KI].haveGenerated.push({ key: 'garlic|', session: 's1', at: 200, qty: '2', unit: 'cloves' });
  markShopDirty();
  __clearShopSyncTimer(); // fire syncShop immediately as if debounce elapsed
  hangPuts = true;
  const inFlightSync = syncShop();
  await sleep(30); // let bridgeReadMealPlan finish and park inside ghPut

  // 2) While ghPut is in flight, user taps a second item ("lemon|")
  globalThis.mealPlan.weeks[KI].haveGenerated.push({ key: 'lemon|', session: 's1', at: 300, qty: '1', unit: '' });
  markShopDirty();
  // Simulate the 2s timer having fired or been cleared before ghPut returns so only attemptSaveMealPlan's post-put check re-arms it
  __clearShopSyncTimer();

  // 3) Resolve the in-flight ghPut
  releasePut();
  hangPuts = false;
  await inFlightSync;

  const postPutMarks = (globalThis.mealPlan.weeks[KI].haveGenerated || []).map(m => m.key);
  const lsPostPutMarks = ((JSON.parse(lsStore['recipe-shop-local'] || '{}').weeks || {})[KI]?.haveGenerated || []).map(m => m.key);
  const stAfterPut = __getShopDirtyState();
  check('(i) tap during ghPut survives in mealPlan after save settles',
    postPutMarks.includes('onion|') && postPutMarks.includes('garlic|') && postPutMarks.includes('lemon|'),
    JSON.stringify(postPutMarks));
  check('(i) tap during ghPut survives in localStorage (saveShopLocal not overwritten with pre-tap merged)',
    lsPostPutMarks.includes('lemon|'),
    JSON.stringify(lsPostPutMarks));
  check('(i) _shopDirty stays true when a tap landed during ghPut (_shopDirtyGen advanced)',
    stAfterPut.dirty === true);
  check('(i) a follow-up syncShopSoon timer is scheduled when a tap landed during ghPut',
    stAfterPut.timer !== null);
  __clearShopSyncTimer();

  // Let the follow-up sync run and confirm it pushes the mid-save tap to the server and clears _shopDirty
  await syncShop();
  const serverMarksAfterResync = (serverState.weeks[KI].haveGenerated || []).map(m => m.key);
  const stAfterResync = __getShopDirtyState();
  check('(i) follow-up sync pushes the mid-save tap to the server and clears _shopDirty',
    serverMarksAfterResync.includes('lemon|') && stAfterResync.dirty === false && stAfterResync.timer === null,
    JSON.stringify(serverMarksAfterResync));

  // Part 2: Tap landing during the read phase (before the merge point) is already included in that save
  hangReads = true;
  const readPhaseSync = syncShop();
  await sleep(15); // parked inside bridgeReadMealPlan
  globalThis.mealPlan.weeks[KI].haveGenerated.push({ key: 'carrot|', session: 's1', at: 400, qty: '3', unit: '' });
  markShopDirty();
  __clearShopSyncTimer(); // clear the tap's own debounce timer; attemptSaveMealPlan has NOT reached savedGen yet
  releaseRead();
  hangReads = false;
  await readPhaseSync;

  const serverMarksAfterReadTap = (serverState.weeks[KI].haveGenerated || []).map(m => m.key);
  const localMarksAfterReadTap = (globalThis.mealPlan.weeks[KI].haveGenerated || []).map(m => m.key);
  const stAfterReadTap = __getShopDirtyState();
  check('(i) tap during bridgeReadMealPlan lands in the same save (both server + local mealPlan) and clears _shopDirty',
    serverMarksAfterReadTap.includes('carrot|') &&
    localMarksAfterReadTap.includes('carrot|') &&
    stAfterReadTap.dirty === false &&
    stAfterReadTap.timer === null,
    JSON.stringify(serverMarksAfterReadTap));

  /* ============ (j) Card single-writer handoff (Nov 4, 2026) ============ */
  {
    const saveRecSrc = extract('saveRecipe');
    const saveNewSrc = extract('saveNewRecipe');
    const setNeedsSrc = extract('setNeedsSide');
    const delSrc = extract('renderDelete');
    check('(j) saveRecipe, saveNewRecipe, and setNeedsSide do not ghPut data/recipes/meta.json from browser',
      !saveRecSrc.includes("ghPut('data/recipes/meta.json'") &&
      !saveNewSrc.includes("ghPut('data/recipes/meta.json'") &&
      !setNeedsSrc.includes("ghPut('data/recipes/meta.json'"));
    check('(j) saveRecipe, saveNewRecipe, and setNeedsSide consume saveResult.card and check meta_write_failed',
      saveRecSrc.includes('saveResult.card') && saveRecSrc.includes('meta_write_failed') &&
      saveNewSrc.includes('saveResult.card') && saveNewSrc.includes('meta_write_failed') &&
      setNeedsSrc.includes('saveResult.card') && setNeedsSrc.includes('meta_write_failed'));
    check('(j) renderDelete retains meta.json cleanup on recipe deletion',
      delSrc.includes("data/recipes/meta.json") && delSrc.includes("Remove ' + r.id + ' from meta via site"));
  }

  const failed = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' assertions passed ====');
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error('ERROR', e); process.exit(2); });

