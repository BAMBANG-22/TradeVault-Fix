import assert from 'node:assert/strict';
import {
  computeMacroThreeSystemState,
  createUnavailableFedWatchState,
  getAllOfflineActualCalendarEvents,
  getWibMonthKey,
  loadMonthlyNewsSpeechArchive,
  loadPostNewsArchive,
  MACRO_ACTUALS_ARCHIVE_STORAGE_KEY,
  MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY,
  MACRO_POST_NEWS_ARCHIVE_KEY,
  MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY,
  recordBreakingNewsToMonthlyArchive,
  recordReleasedActualsToOfflineArchive,
  type BreakingNewsHeadline,
  type MacroCalendarEvent,
  type MacroNewsSnapshot,
} from '../src/utils/macroNewsEngine';

// Minimal in-memory localStorage shim for Node verification
const memoryStore = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
    setItem: (k: string, v: string) => {
      memoryStore.set(k, String(v));
    },
    removeItem: (k: string) => {
      memoryStore.delete(k);
    },
    clear: () => {
      memoryStore.clear();
    },
  },
  configurable: true,
});

function clearAllArchives() {
  localStorage.clear();
  localStorage.removeItem(MACRO_ACTUALS_ARCHIVE_STORAGE_KEY);
  localStorage.removeItem(MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY);
  localStorage.removeItem(MACRO_POST_NEWS_ARCHIVE_KEY);
  localStorage.removeItem(MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY);
}

function makeBaseEvent(overrides: Partial<MacroCalendarEvent>): MacroCalendarEvent {
  return {
    id: 'ev-cpi-nov',
    title: 'CPI m/m',
    country: 'USD',
    date: '2026-11-18T13:30:00.000Z',
    impact: 'High',
    forecast: '0.3%',
    previous: '0.2%',
    actual: '',
    forecastNum: 0.3,
    previousNum: 0.2,
    actualNum: null,
    unit: '%',
    pillar: 'INFLATION',
    isInverseIndicator: true,
    eventBiasForGold: 'SELL',
    biasReasonId: 'Kenaikan forecast inflasi berpotensi menekan emas.',
    biasReasonEn: 'Higher inflation forecast tends to pressure gold.',
    isLiveFeed: true,
    eventCategory: 'PRIMARY_HIGH_IMPACT',
    ...overrides,
  };
}

function makeSnapshot(events: MacroCalendarEvent[], breaking: BreakingNewsHeadline[], analyzedAt: string): MacroNewsSnapshot {
  return {
    id: `snap-${analyzedAt}`,
    instrument: 'XAUUSD',
    dataFingerprint: 'test-fp',
    analyzedAt,
    sourceMode: 'RULE_BASED_FALLBACK',
    modelUsed: 'rule-based-v1',
    impactLevel: 'HIGH',
    dominantBias: 'SELL',
    breakingNews: breaking,
    topBreakingAlert: breaking[0] || null,
    intermarketPulse: {
      dxy: {
        symbol: 'DXY',
        yahooTicker: 'DX-Y.NYB',
        name: 'US Dollar Index',
        price: 105.2,
        previousClose: 105.0,
        change: 0.2,
        changePercent: 0.19,
        direction: 'UP',
        goldCorrelationEffect: 'BEARISH_GOLD',
        summaryId: 'DXY menguat',
        summaryEn: 'DXY stronger',
        updatedAt: analyzedAt,
        isAvailable: true,
      },
      us10y: {
        symbol: 'US10Y',
        yahooTicker: '^TNX',
        name: 'US 10Y Yield',
        price: 4.35,
        previousClose: 4.3,
        change: 0.05,
        changePercent: 1.16,
        direction: 'UP',
        goldCorrelationEffect: 'BEARISH_GOLD',
        summaryId: 'Yield naik',
        summaryEn: 'Yield up',
        updatedAt: analyzedAt,
        isAvailable: true,
      },
      usoil: {
        symbol: 'USOIL',
        yahooTicker: 'CL=F',
        name: 'US Oil',
        price: 72.1,
        previousClose: 72.0,
        change: 0.1,
        changePercent: 0.14,
        direction: 'UP',
        goldCorrelationEffect: 'NEUTRAL',
        summaryId: 'Oil stabil',
        summaryEn: 'Oil flat',
        updatedAt: analyzedAt,
        isAvailable: true,
      },
    },
    cmeFedWatch: createUnavailableFedWatchState(),
    calendarEvents: events,
    scenarioMatrix: {
      primaryEvent: events[0],
      simultaneousEvents: [],
      isSimultaneousRelease: false,
      simultaneousAlignment: 'SINGLE',
      evaluationMode: 'INDIVIDUAL_RELEASE',
      buyProbability: 24,
      sellProbability: 62,
      mixedProbability: 14,
      dominantBias: 'SELL',
      dynamicPivotTriggered: false,
      oilChannelDominance: 'NEUTRAL',
      whipsawWarningId: 'Waspada spike awal.',
      whipsawWarningEn: 'Watch initial spike.',
      actionPlanId: 'Siapkan sell on spike.',
      actionPlanEn: 'Prepare sell on spike.',
      finalTakeId: 'Bias pra-news condong SELL.',
      finalTakeEn: 'Pre-news leans SELL.',
      buyArguments: [],
      sellArguments: [],
    },
  };
}

// ---------------------------------------------------------------------------
// TEST 1: System 1 Pre-News freezes at OFF_RELEASED & never mutates post-actual
// ---------------------------------------------------------------------------
clearAllArchives();
const releaseIso = '2026-11-18T13:30:00.000Z';
const preNowMs = new Date('2026-11-18T13:27:00.000Z').getTime(); // T-3m -> T5M_LOCKED
const preEvent = makeBaseEvent({ date: releaseIso, actual: '', actualNum: null });
const preSnap = makeSnapshot([preEvent], [], '2026-11-18T13:27:00.000Z');

const beforeReleaseState = computeMacroThreeSystemState({
  snapshot: preSnap,
  selectedEventId: preEvent.id,
  nowMs: preNowMs,
});
assert.equal(beforeReleaseState.system1PreNews.phase, 'T5M_LOCKED');
const lockedPreBuy = beforeReleaseState.system1PreNews.buyProbability;
const lockedPreSell = beforeReleaseState.system1PreNews.sellProbability;
const lockedPreBias = beforeReleaseState.system1PreNews.dominantBias;

// Simulate Bad-for-USD Actual release (+10m post-release, e.g. CPI 0.0% vs 0.3% fcst -> BUY XAU)
const postNowMs = new Date('2026-11-18T13:40:00.000Z').getTime();
const postEvent = makeBaseEvent({
  date: releaseIso,
  actual: '0.0%',
  actualNum: 0.0,
  eventBiasForGold: 'BUY',
});
const postSnap = makeSnapshot([postEvent], [], '2026-11-18T13:40:00.000Z');
postSnap.scenarioMatrix.buyProbability = 74;
postSnap.scenarioMatrix.sellProbability = 16;
postSnap.scenarioMatrix.mixedProbability = 10;
postSnap.scenarioMatrix.dominantBias = 'BUY';

const postActiveState = computeMacroThreeSystemState({
  snapshot: postSnap,
  selectedEventId: postEvent.id,
  nowMs: postNowMs,
});
assert.equal(postActiveState.system1PreNews.phase, 'OFF_RELEASED', 'Pre-News MUST switch to OFF_RELEASED after release');
assert.equal(postActiveState.system1PreNews.buyProbability, lockedPreBuy, 'Pre-News BUY% MUST remain frozen');
assert.equal(postActiveState.system1PreNews.sellProbability, lockedPreSell, 'Pre-News SELL% MUST remain frozen');
assert.equal(postActiveState.system1PreNews.dominantBias, lockedPreBias, 'Pre-News Bias MUST remain frozen');

assert.equal(postActiveState.system2PostNews.status, 'ACTIVE_2H', 'Post-News MUST be active within 2 hours');
assert.equal(postActiveState.system2PostNews.dominantBias, 'BUY', 'Post-News evaluates Actual print independently');
assert.equal(postActiveState.system2PostNews.shiftVsPreNews, 'REVERSED_PIVOT');
assert.equal(postActiveState.effectiveSourceSystem, 'SYSTEM_2_POST_NEWS');

// ---------------------------------------------------------------------------
// TEST 2: System 2 expires to OFF_ARCHIVED_2H after >2h & preserves offline archive + cross-month actuals
// ---------------------------------------------------------------------------
const after2hMs = new Date('2026-11-18T16:00:00.000Z').getTime(); // +2h30m
const after2hState = computeMacroThreeSystemState({
  snapshot: postSnap,
  selectedEventId: postEvent.id,
  nowMs: after2hMs,
});
assert.equal(after2hState.system2PostNews.status, 'OFF_ARCHIVED_2H');
assert.equal(after2hState.effectiveSourceSystem, 'SYSTEM_3_LIVE_PULSE');
const savedPostMap = loadPostNewsArchive();
assert.ok(Object.keys(savedPostMap).length >= 1, 'Post-News evaluation should be archived offline');

// Cross-month offline Actuals retention (October event + November event read in December!)
const octActualEvent = makeBaseEvent({
  id: 'ev-oct-ppi',
  title: 'Core PPI m/m',
  date: '2026-10-15T12:30:00.000Z',
  previous: '0.2%',
  forecast: '0.2%',
  actual: '0.4%',
  previousNum: 0.2,
  forecastNum: 0.2,
  actualNum: 0.4,
  eventBiasForGold: 'SELL',
});
recordReleasedActualsToOfflineArchive([octActualEvent, postEvent], 'LIVE_FEED');

const decNowMs = new Date('2026-12-05T10:00:00.000Z').getTime();
const crossMonthActuals = getAllOfflineActualCalendarEvents([], decNowMs);
assert.equal(crossMonthActuals.length, 2, 'Cross-month actuals must NOT reset across months (Oct + Nov visible in Dec)');
assert.ok(crossMonthActuals.some((e) => e.title === 'Core PPI m/m' && e.actual === '0.4%'));
assert.ok(crossMonthActuals.some((e) => e.title === 'CPI m/m' && e.actual === '0.0%'));

// ---------------------------------------------------------------------------
// TEST 3: Berita & Speech 1-month WIB offline archive & automatic month-turnover reset
// ---------------------------------------------------------------------------
assert.equal(getWibMonthKey(new Date('2026-11-30T16:59:00.000Z').getTime()), '2026-11'); // 23:59 WIB Nov 30
assert.equal(getWibMonthKey(new Date('2026-11-30T17:05:00.000Z').getTime()), '2026-12'); // 00:05 WIB Dec 1

const novHeadline: BreakingNewsHeadline = {
  id: 'h-powell-nov',
  title: 'Fed Chair Powell signals patience on additional rate cuts amid sticky services inflation',
  source: 'FinancialJuice',
  pubDate: '2026-11-18T14:00:00.000Z',
  matchedKeywords: ['Fed', 'Powell', 'Inflation'],
  impact: 'HIGH',
  sentimentForGold: 'BEARISH',
  channelType: 'FED_SPEECH',
  aiEvaluationId: 'Nada hawkish menekan emas.',
  aiEvaluationEn: 'Hawkish tone pressures gold.',
};

const novArchive = recordBreakingNewsToMonthlyArchive(
  [novHeadline],
  new Date('2026-11-18T14:05:00.000Z').getTime()
);
assert.equal(novArchive.monthKey, '2026-11');
assert.equal(novArchive.items.length, 1);

const reloadedNov = loadMonthlyNewsSpeechArchive(new Date('2026-11-28T10:00:00.000Z').getTime());
assert.equal(reloadedNov.monthKey, '2026-11');
assert.equal(reloadedNov.items.length, 1, 'Headlines persist offline throughout the full calendar month');

// Month rolls into December WIB -> auto-reset to empty list for Berita & Speech ONLY
const rolledDec = loadMonthlyNewsSpeechArchive(decNowMs);
assert.equal(rolledDec.monthKey, '2026-12');
assert.equal(rolledDec.items.length, 0, 'Berita & Speech monthly archive MUST reset when new calendar month starts');

// Verify Post-News offline Actuals from Oct & Nov are STILL intact after Berita & Speech rolled to Dec!
const actualsStillIntact = getAllOfflineActualCalendarEvents([], decNowMs);
assert.equal(actualsStillIntact.length, 2, 'Actuals archive must remain intact even after Berita & Speech resets on Dec 1');

console.log('ALL_THREE_VIEW_TRADE_NEWS_TESTS_PASSED');
