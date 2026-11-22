import assert from 'node:assert/strict';
import {
  ensureHistoricalActualsArchiveSeeded,
  getAllOfflineActualCalendarEvents,
  hydrateEventsWithOfflineArchive,
  loadOfflineActualsArchive,
  MACRO_ACTUALS_ARCHIVE_STORAGE_KEY,
  mapRawTradingViewEventsToCalendarEvents,
  recordReleasedActualsToOfflineArchive,
  type MacroCalendarEvent,
  type RawTradingViewCalendarEvent,
} from '../src/utils/macroNewsEngine';
import { HISTORICAL_MACRO_ACTUALS_SEED } from '../src/data/historicalMacroActualsSeed';

// Minimal in-memory localStorage shim for deterministic Node verification
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

function clearArchive() {
  localStorage.clear();
  localStorage.removeItem(MACRO_ACTUALS_ARCHIVE_STORAGE_KEY);
}

// =========================================================================
// TEST 1: Seeding empty APK localStorage populates verified Sep–Nov 2026 history
// =========================================================================
clearArchive();
assert.equal(loadOfflineActualsArchive().length, 0, 'Fresh storage must start empty');

const seededRecords = ensureHistoricalActualsArchiveSeeded();
assert.ok(
  seededRecords.length >= 40 && seededRecords.length === HISTORICAL_MACRO_ACTUALS_SEED.length,
  `Expected all ${HISTORICAL_MACRO_ACTUALS_SEED.length} verified seed records, got ${seededRecords.length}`
);

const hasCpi = seededRecords.some((r) => r.title === 'CPI m/m' && r.date.startsWith('2026-11-10'));
const hasCoreCpi = seededRecords.some((r) => r.title === 'Core CPI m/m' && r.date.startsWith('2026-11-10'));
const hasPpi = seededRecords.some((r) => r.title === 'PPI m/m' && r.date.startsWith('2026-11-13'));
const hasNfp = seededRecords.some((r) => r.title === 'Non-Farm Employment Change' && r.date.startsWith('2026-11-06'));
const hasFomc = seededRecords.some((r) => r.title === 'Federal Funds Rate' && r.date.startsWith('2026-10-28'));
const hasSepGdp = seededRecords.some((r) => r.title === 'Final GDP q/q' && r.date.startsWith('2026-09-30'));
assert.ok(hasCpi && hasCoreCpi && hasPpi && hasNfp && hasFomc && hasSepGdp, 'Key Sep–Nov High-Impact releases must exist');

// Idempotency: calling ensureHistoricalActualsArchiveSeeded again does not duplicate
const seededAgain = ensureHistoricalActualsArchiveSeeded();
assert.equal(seededAgain.length, seededRecords.length, 'Re-running seed must remain idempotent');

// =========================================================================
// TEST 2: Non-overwriting & alias-dedupe guarantee for LIVE_FEED / TV_ENRICH
// =========================================================================
clearArchive();
const liveEvents: MacroCalendarEvent[] = [
  {
    id: 'live-retail-nov',
    title: 'Retail Sales m/m',
    country: 'USD',
    date: '2026-11-17T13:30:00.000Z',
    impact: 'High',
    previous: '0.1%',
    forecast: '0.2%',
    actual: '0.3%',
    previousNum: 0.1,
    forecastNum: 0.2,
    actualNum: 0.3,
    unit: '%',
    pillar: 'GROWTH',
    isInverseIndicator: false,
    eventBiasForGold: 'SELL',
    biasReasonId: 'Live feed test',
    biasReasonEn: 'Live feed test',
    actualSource: 'LIVE_FEED',
  },
  {
    id: 'tv-alias-core-cpi-nov',
    title: 'Core Inflation Rate MoM',
    country: 'USD',
    date: '2026-11-10T13:30:00.000Z',
    impact: 'High',
    previous: '0.3%',
    forecast: '0.3%',
    actual: '0.3%',
    previousNum: 0.3,
    forecastNum: 0.3,
    actualNum: 0.3,
    unit: '%',
    pillar: 'INFLATION',
    isInverseIndicator: false,
    eventBiasForGold: 'MIXED',
    biasReasonId: 'TV alias test',
    biasReasonEn: 'TV alias test',
    actualSource: 'TV_ENRICH',
  },
];
recordReleasedActualsToOfflineArchive(liveEvents, 'LIVE_FEED');

const mergedAfterLive = ensureHistoricalActualsArchiveSeeded();
const retailEntries = mergedAfterLive.filter(
  (r) => r.title === 'Retail Sales m/m' && r.date.startsWith('2026-11-17')
);
assert.equal(retailEntries.length, 1, 'Retail Sales Nov 17 must appear once without duplication');
assert.equal(retailEntries[0].actualSource, 'LIVE_FEED', 'Existing LIVE_FEED source must NOT be overwritten by seed');

const coreCpiNovEntries = mergedAfterLive.filter(
  (r) =>
    r.date.startsWith('2026-11-10') &&
    (r.title === 'Core CPI m/m' || r.title === 'Core Inflation Rate MoM')
);
assert.equal(coreCpiNovEntries.length, 1, 'Alias "Core Inflation Rate MoM" must prevent duplicate "Core CPI m/m" seed');
assert.equal(coreCpiNovEntries[0].actualSource, 'TV_ENRICH', 'Existing TV_ENRICH record must be preserved');

// =========================================================================
// TEST 3: mapRawTradingViewEventsToCalendarEvents canonical mapping & noise filtering
// =========================================================================
const fixedNowMs = Date.parse('2026-11-18T12:00:00.000Z');
const rawTvPayload: RawTradingViewCalendarEvent[] = [
  {
    id: 1001,
    title: 'Core Inflation Rate MoM',
    country: 'US',
    date: '2026-11-10T13:30:00.000Z',
    actual: 0.3,
    forecast: 0.3,
    previous: 0.3,
    unit: '%',
    importance: 1,
  },
  {
    id: 1002,
    title: 'Non Farm Payrolls',
    country: 'US',
    date: '2026-11-06T13:30:00.000Z',
    actual: 227,
    forecast: 200,
    previous: 254,
    scale: 'K',
    importance: 1,
  },
  {
    id: 1003,
    title: 'Redbook YoY',
    country: 'US',
    date: '2026-11-17T13:55:00.000Z',
    actual: 5.1,
    forecast: null,
    previous: 4.9,
    unit: '%',
    importance: 0,
  },
  {
    id: 1004,
    title: 'Inflation Rate MoM',
    country: 'EU', // non-US -> skipped
    date: '2026-11-18T10:00:00.000Z',
    actual: 0.2,
    forecast: 0.2,
    previous: 0.1,
    unit: '%',
    importance: 1,
  },
  {
    id: 1005,
    title: 'PPI MoM',
    country: 'US',
    date: '2026-11-25T13:30:00.000Z', // future -> skipped
    actual: 0.4,
    forecast: 0.2,
    previous: 0.1,
    unit: '%',
    importance: 1,
  },
  {
    id: 1006,
    title: 'Initial Jobless Claims',
    country: 'US',
    date: '2026-11-12T13:30:00.000Z',
    actual: 215000,
    forecast: 220000,
    previous: 219000,
    unit: '',
    importance: 0,
  },
];

const mappedTv = mapRawTradingViewEventsToCalendarEvents(rawTvPayload, fixedNowMs);
assert.equal(mappedTv.length, 3, 'Should map only 3 valid released US primary/supporting events');

const mappedCoreCpi = mappedTv.find((e) => e.title === 'Core CPI m/m');
assert.ok(mappedCoreCpi, 'Core Inflation Rate MoM must map cleanly to Core CPI m/m');
assert.equal(mappedCoreCpi?.actual, '0.3%');
assert.equal(mappedCoreCpi?.impact, 'High');

const mappedNfp = mappedTv.find((e) => e.title === 'Non-Farm Employment Change');
assert.ok(mappedNfp, 'Non Farm Payrolls must map cleanly to Non-Farm Employment Change');
assert.equal(mappedNfp?.actual, '227K');
assert.equal(mappedNfp?.eventBiasForGold, 'SELL');

const mappedClaims = mappedTv.find((e) => e.title === 'Initial Jobless Claims');
assert.ok(mappedClaims, 'Initial Jobless Claims without scale should normalize >1000 numbers into K');
assert.equal(mappedClaims?.actual, '215K');
assert.equal(mappedClaims?.isInverseIndicator, true);
assert.equal(mappedClaims?.eventBiasForGold, 'SELL');

// =========================================================================
// TEST 4: Cross-month offline retention & hydration into December
// =========================================================================
clearArchive();
ensureHistoricalActualsArchiveSeeded();

const decemberNowMs = Date.parse('2026-12-05T12:00:00.000Z');
const allOfflineDec = getAllOfflineActualCalendarEvents([], decemberNowMs);
assert.ok(allOfflineDec.length >= 40, 'Post-News offline archive must survive month turnover into December');
assert.ok(
  allOfflineDec.some((e) => e.title === 'CPI m/m' && e.date.startsWith('2026-11-10')),
  'November CPI must remain visible offline in December'
);
assert.ok(
  allOfflineDec.some((e) => e.title === 'PPI m/m' && e.date.startsWith('2026-10-15')),
  'October PPI must remain visible offline in December'
);

const hydrated = hydrateEventsWithOfflineArchive([], decemberNowMs, undefined, 90);
assert.ok(
  hydrated.some((e) => e.title === 'CPI m/m' && e.date.startsWith('2026-11-10')),
  '90-day hydration must surface prior-month High-Impact events cleanly'
);

console.log('✅ test-historical-actuals-backfill.ts PASSED (all assertions verified)');
