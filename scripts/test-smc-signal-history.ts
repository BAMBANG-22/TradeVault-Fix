/**
 * Unit verification for combined TP/SL signal history helpers (`src/utils/smcSignalHistory.ts`).
 */

import assert from 'node:assert/strict';
import {
  getWibDateKey,
  getWibDateKeyFromIso,
  getSignalHistoryEffectiveDateKey,
  getAvailableHistoryDates,
  filterSignalHistoryRecords,
  groupHistoryRecordsByDate,
  computeSignalHistorySummary,
  recordDeletedActiveSignal,
  reconcileIncomingSignalsWithDeleted,
  type SmcStoredSignalRecord,
  type SmcDeletedSignalRecord,
} from '../src/utils/smcSignalHistory';
import type { SmcLimitOrderSetup } from '../src/utils/confluenceEngine';

function makeRecord(overrides: Partial<SmcStoredSignalRecord> = {}): SmcStoredSignalRecord {
  return {
    uid: 'sig-1',
    dateKey: '2026-11-18',
    createdAtIso: '2026-11-18T02:00:00.000Z',
    createdTimeWib: '09:00 WIB',
    tradingMode: 'SCALP',
    spotPriceAtCapture: 2625.0,
    dominantBias: 'BULLISH',
    pdZone: 'DISCOUNT',
    positionPct: 24,
    recommendedSide: 'BUY',
    direction: 'BUY',
    tier: 'A_PLUS',
    headerTitle: 'BUY LIMIT 1 (SMC A+)',
    entryLimit: 2620.0,
    stopLoss: 2614.8,
    slPips: 50,
    slPoints: 20,
    tp1: 2625.0,
    tp1Pips: 50,
    tp2: 2630.0,
    tpMax: 2638.0,
    tpMaxRrLabel: '1:3.6',
    isTaken: true,
    status: 'HIT_TP2',
    batchStatus: 'ON_GOING',
    promotedDateKey: '2026-11-18',
    closedAtIso: '2026-11-18T05:00:00.000Z',
    closedDateKey: '2026-11-18',
    closedTimeWib: '12:00 WIB',
    resultPips: 100,
    ...overrides,
  };
}

// 1. WIB date key conversion across UTC boundary
assert.equal(
  getWibDateKey(new Date('2026-11-17T20:30:00.000Z')),
  '2026-11-18',
  '20:30 UTC must resolve to next WIB day (03:30 WIB)'
);
assert.equal(
  getWibDateKeyFromIso(null, '2026-11-16'),
  '2026-11-16',
  'Null closedAtIso must fallback to dateKey'
);
assert.equal(
  getWibDateKeyFromIso('not-a-date', '2026-11-16'),
  '2026-11-16',
  'Invalid closedAtIso must fallback to dateKey'
);

// 2. Effective completion date priority (`closedDateKey` > WIB of `closedAtIso` > `dateKey`)
const crossDayExplicit = makeRecord({
  uid: 'cross-day-1',
  dateKey: '2026-11-17',
  createdAtIso: '2026-11-17T06:00:00.000Z',
  closedAtIso: '2026-11-18T03:00:00.000Z',
  closedDateKey: '2026-11-18',
  status: 'HIT_TP_MAX',
  resultPips: 180,
});
assert.equal(getSignalHistoryEffectiveDateKey(crossDayExplicit), '2026-11-18');

const legacyCrossDayNoField = makeRecord({
  uid: 'legacy-utc-wib',
  dateKey: '2026-11-16',
  createdAtIso: '2026-11-16T07:00:00.000Z',
  closedAtIso: '2026-11-17T18:00:00.000Z', // 01:00 WIB on 2026-11-18!
  closedDateKey: undefined,
  status: 'HIT_SL',
  resultPips: -52,
});
assert.equal(getSignalHistoryEffectiveDateKey(legacyCrossDayNoField), '2026-11-18');

const sameDaySlOld = makeRecord({
  uid: 'hist-nov15',
  dateKey: '2026-11-15',
  createdAtIso: '2026-11-15T03:00:00.000Z',
  closedAtIso: '2026-11-15T08:00:00.000Z',
  closedDateKey: '2026-11-15',
  status: 'HIT_SL',
  resultPips: -52,
});

const todayTp1 = makeRecord({
  uid: 'hist-nov18-tp1',
  dateKey: '2026-11-18',
  createdAtIso: '2026-11-18T01:00:00.000Z',
  closedAtIso: '2026-11-18T06:00:00.000Z',
  closedDateKey: '2026-11-18',
  status: 'HIT_TP1',
  resultPips: 50,
});

const activeSignalIgnored = makeRecord({
  uid: 'still-active',
  dateKey: '2026-11-18',
  status: 'ACTIVE',
  closedAtIso: null,
  closedDateKey: null,
  closedTimeWib: null,
  resultPips: null,
});

const swingClosedIgnoredInScalp = makeRecord({
  uid: 'swing-1',
  tradingMode: 'SWING',
  dateKey: '2026-11-15',
  closedAtIso: '2026-11-15T09:00:00.000Z',
  closedDateKey: '2026-11-15',
  status: 'HIT_TP2',
  resultPips: 100,
});

const dataset: SmcStoredSignalRecord[] = [
  crossDayExplicit,
  legacyCrossDayNoField,
  sameDaySlOld,
  todayTp1,
  activeSignalIgnored,
  swingClosedIgnoredInScalp,
];

const TODAY = '2026-11-18';

// 3. ALL mode combines closed SCALP signals across all dates, sorted newest closedAtIso first
const allScalp = filterSignalHistoryRecords({
  records: dataset,
  tradingMode: 'SCALP',
  filterMode: 'ALL',
  customDateKey: '2026-11-15',
  todayDateKey: TODAY,
});
assert.deepEqual(
  allScalp.map((r) => r.uid),
  ['hist-nov18-tp1', 'cross-day-1', 'legacy-utc-wib', 'hist-nov15'],
  'ALL mode should include all closed SCALP signals across dates newest first'
);

// Combined summary across all dates
const allSummary = computeSignalHistorySummary(allScalp);
assert.equal(allSummary.tpCount, 2);
assert.equal(allSummary.slCount, 2);
assert.equal(allSummary.totalClosed, 4);
assert.equal(allSummary.winRate, 50);
assert.equal(allSummary.netPips, 126); // 50 + 180 - 52 - 52

// 4. TODAY mode includes cross-day signals finished today (2026-11-18)
const todayScalp = filterSignalHistoryRecords({
  records: dataset,
  tradingMode: 'SCALP',
  filterMode: 'TODAY',
  customDateKey: '2026-11-15',
  todayDateKey: TODAY,
});
assert.deepEqual(
  todayScalp.map((r) => r.uid),
  ['hist-nov18-tp1', 'cross-day-1', 'legacy-utc-wib']
);
const todaySummary = computeSignalHistorySummary(todayScalp);
assert.equal(todaySummary.tpCount, 2);
assert.equal(todaySummary.slCount, 1);
assert.equal(todaySummary.netPips, 178); // 50 + 180 - 52

// 5. CUSTOM mode isolates a specific chosen date (e.g. 2026-11-15)
const customScalp = filterSignalHistoryRecords({
  records: dataset,
  tradingMode: 'SCALP',
  filterMode: 'CUSTOM',
  customDateKey: '2026-11-15',
  todayDateKey: TODAY,
});
assert.deepEqual(customScalp.map((r) => r.uid), ['hist-nov15']);

// 6. Date grouping & available history dates
const grouped = groupHistoryRecordsByDate(allScalp);
assert.equal(grouped.length, 2);
assert.equal(grouped[0][0], '2026-11-18');
assert.equal(grouped[0][1].length, 3);
assert.equal(grouped[1][0], '2026-11-15');
assert.equal(grouped[1][1].length, 1);

const availableDates = getAvailableHistoryDates(dataset, 'SCALP', TODAY);
assert.deepEqual(availableDates, ['2026-11-18', '2026-11-15']);

// 6b. Direction filter ('ALL' | 'BUY' | 'SELL') in History
const sellClosed = makeRecord({
  uid: 'hist-nov18-sell',
  dateKey: '2026-11-18',
  direction: 'SELL',
  headerTitle: 'Sell Limit A+',
  closedAtIso: '2026-11-18T07:00:00.000Z',
  closedDateKey: '2026-11-18',
  status: 'HIT_TP2',
  resultPips: 100,
});
const dirDataset = [...dataset, sellClosed];
assert.deepEqual(
  filterSignalHistoryRecords({
    records: dirDataset,
    tradingMode: 'SCALP',
    filterMode: 'ALL',
    customDateKey: TODAY,
    todayDateKey: TODAY,
    directionFilter: 'SELL',
  }).map((r) => r.uid),
  ['hist-nov18-sell']
);
assert.deepEqual(
  filterSignalHistoryRecords({
    records: dirDataset,
    tradingMode: 'SCALP',
    filterMode: 'ALL',
    customDateKey: TODAY,
    todayDateKey: TODAY,
    directionFilter: 'BUY',
  }).map((r) => r.uid),
  ['hist-nov18-tp1', 'cross-day-1', 'legacy-utc-wib', 'hist-nov15']
);

// ============================================================================
// 7. Deleted Signal Tracking & Re-surfacing (ON_GOING & PREVIOUS, 1h / 6h later)
// ============================================================================
function makeIncomingSetup(overrides: Partial<SmcLimitOrderSetup> = {}): SmcLimitOrderSetup {
  return {
    id: 'setup-1',
    direction: 'BUY',
    tier: 'A_PLUS',
    headerTitle: 'Buy Limit A+',
    isActiveNow: true,
    entryLimit: 2620.8, // shifted by +0.8 (within < 1.5 USD / 15 pips tolerance of 2620.0)
    stopLoss: 2615.6,
    slPips: 50,
    slPoints: 20,
    tp1: 2625.8,
    tp1Pips: 50,
    tp2: 2630.8,
    tpMax: 2640.8,
    tpMaxRrLabel: '1:4',
    ...overrides,
  };
}

let deletedList: SmcDeletedSignalRecord[] = [];

// 7a. Closed HISTORY items must NOT be recorded for active re-surfacing
deletedList = recordDeletedActiveSignal(deletedList, todayTp1, '2026-11-18T03:00:00.000Z');
assert.equal(deletedList.length, 0, 'Closed HIT_TP/SL signal should not enter deleted active list');

// 7b. Deleting ON_GOING and PREVIOUS active signals records both cleanly
const ongoingBuy = makeRecord({
  uid: 'active-ongoing-buy',
  dateKey: TODAY,
  status: 'ACTIVE',
  batchStatus: 'ON_GOING',
  direction: 'BUY',
  tier: 'A_PLUS',
  headerTitle: 'Buy Limit A+',
  entryLimit: 2620.0,
  closedAtIso: null,
  closedDateKey: null,
  closedTimeWib: null,
  resultPips: null,
});

const previousSell = makeRecord({
  uid: 'active-prev-sell',
  dateKey: '2026-11-17',
  status: 'ACTIVE',
  batchStatus: 'PREVIOUS',
  direction: 'SELL',
  tier: 'B_STANDARD',
  headerTitle: 'Sell Limit B',
  entryLimit: 2665.0,
  closedAtIso: null,
  closedDateKey: null,
  closedTimeWib: null,
  resultPips: null,
});

const untouchedPrevBuy = makeRecord({
  uid: 'untouched-prev',
  dateKey: '2026-11-17',
  status: 'ACTIVE',
  batchStatus: 'PREVIOUS',
  direction: 'BUY',
  tier: 'HIGH_RISK',
  headerTitle: 'Buy Limit High Risk',
  entryLimit: 2605.0,
  closedAtIso: null,
  closedDateKey: null,
  closedTimeWib: null,
  resultPips: null,
});

deletedList = recordDeletedActiveSignal(deletedList, ongoingBuy, '2026-11-18T03:04:50.000Z');
deletedList = recordDeletedActiveSignal(deletedList, previousSell, '2026-11-18T03:05:00.000Z');
assert.equal(deletedList.length, 2);
assert.equal(deletedList[0].originalBatchStatus, 'PREVIOUS');
assert.equal(deletedList[1].originalBatchStatus, 'ON_GOING');

// 7c. Immediate render 10s after deletion must NOT bounce deleted signal right back
const immediateAuto = reconcileIncomingSignalsWithDeleted({
  storedSignals: [untouchedPrevBuy],
  deletedSignals: deletedList,
  incomingGroups: [
    makeIncomingSetup(),
    makeIncomingSetup({
      id: 'setup-sell-b',
      direction: 'SELL',
      tier: 'B_STANDARD',
      headerTitle: 'Sell Limit B',
      entryLimit: 2664.4, // within 0.6 USD of deleted PREVIOUS sell
    }),
  ],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T03:05:10.000Z',
  nowWib: '10:05 WIB',
  spotPrice: 2635.0,
  dominantBias: 'BULLISH',
  pdZone: 'DISCOUNT',
  positionPct: 30,
  recommendedSide: 'BUY',
  resurfaceDeletedSignals: true,
  mode: 'AUTO_RESURFACE_ONLY',
});
assert.equal(immediateAuto.resurfacedCount, 0, 'Must respect grace window immediately after deletion');
assert.equal(immediateAuto.nextSignals.length, 1);

// 7d. 1 hour later, market analysis finds the deleted ON_GOING Buy setup again (option ON)
const oneHourLaterAuto = reconcileIncomingSignalsWithDeleted({
  storedSignals: [untouchedPrevBuy],
  deletedSignals: deletedList,
  incomingGroups: [makeIncomingSetup()],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T04:05:00.000Z',
  nowWib: '11:05 WIB',
  spotPrice: 2628.0,
  dominantBias: 'BULLISH',
  pdZone: 'DISCOUNT',
  positionPct: 28,
  recommendedSide: 'BUY',
  resurfaceDeletedSignals: true,
  mode: 'AUTO_RESURFACE_ONLY',
});
assert.equal(oneHourLaterAuto.resurfacedCount, 1);
assert.equal(oneHourLaterAuto.addedCount, 1);
assert.equal(oneHourLaterAuto.nextDeletedSignals.length, 1, 'Only remaining PREVIOUS deleted signature stays tracked');
const resurfacedBuy = oneHourLaterAuto.nextSignals.find((s) => s.direction === 'BUY' && s.tier === 'A_PLUS');
assert.ok(resurfacedBuy, 'Deleted ON_GOING setup must re-appear in ON_GOING');
assert.equal(resurfacedBuy?.batchStatus, 'ON_GOING');
assert.equal(resurfacedBuy?.resurfacedFromBatch, 'ON_GOING');
assert.equal(
  oneHourLaterAuto.nextSignals.find((s) => s.uid === 'untouched-prev')?.batchStatus,
  'PREVIOUS',
  'Auto-resurface must not alter untouched PREVIOUS signals'
);

// 7e. 6 hours later, market analysis finds the deleted PREVIOUS Sell setup again (option ON)
const sixHoursLaterAuto = reconcileIncomingSignalsWithDeleted({
  storedSignals: oneHourLaterAuto.nextSignals,
  deletedSignals: oneHourLaterAuto.nextDeletedSignals,
  incomingGroups: [
    makeIncomingSetup({
      id: 'setup-sell-b-6h',
      direction: 'SELL',
      tier: 'B_STANDARD',
      headerTitle: 'Sell Limit B',
      entryLimit: 2664.4,
    }),
  ],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T09:05:00.000Z',
  nowWib: '16:05 WIB',
  spotPrice: 2652.0,
  dominantBias: 'BEARISH',
  pdZone: 'PREMIUM',
  positionPct: 72,
  recommendedSide: 'SELL',
  resurfaceDeletedSignals: true,
  mode: 'AUTO_RESURFACE_ONLY',
});
assert.equal(sixHoursLaterAuto.resurfacedCount, 1);
assert.equal(sixHoursLaterAuto.nextDeletedSignals.length, 0);
const resurfacedSell = sixHoursLaterAuto.nextSignals.find((s) => s.direction === 'SELL' && s.tier === 'B_STANDARD');
assert.ok(resurfacedSell, 'Deleted PREVIOUS setup must re-appear in ON_GOING 6h later');
assert.equal(resurfacedSell?.batchStatus, 'ON_GOING');
assert.equal(resurfacedSell?.resurfacedFromBatch, 'PREVIOUS');

// 7f. Option OFF (Sembunyikan Permanen): suppresses deleted setups across both AUTO & manual FULL_PULL
const suppressedPull = reconcileIncomingSignalsWithDeleted({
  storedSignals: [untouchedPrevBuy],
  deletedSignals: deletedList,
  incomingGroups: [makeIncomingSetup()],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T10:00:00.000Z',
  nowWib: '17:00 WIB',
  spotPrice: 2628.0,
  dominantBias: 'BULLISH',
  pdZone: 'DISCOUNT',
  positionPct: 28,
  recommendedSide: 'BUY',
  resurfaceDeletedSignals: false,
  mode: 'FULL_PULL',
  isManualTrigger: true,
});
assert.equal(suppressedPull.resurfacedCount, 0);
assert.equal(suppressedPull.suppressedCount, 1);
assert.equal(suppressedPull.addedCount, 0);
assert.equal(suppressedPull.nextDeletedSignals.length, 2);

// ============================================================================
// 8. Regression: Keep matching signals in ON_GOING (same-tier drift & cross-tier OB shift)
//    + Deleted ON_GOING / PREVIOUS signals return to ON_GOING on FULL_PULL
// ============================================================================
const existingOnGoingAPlus = makeRecord({
  uid: 'ongoing-aplus-2620',
  dateKey: TODAY,
  status: 'ACTIVE',
  batchStatus: 'ON_GOING',
  direction: 'BUY',
  tier: 'A_PLUS',
  headerTitle: 'Buy Limit A+',
  entryLimit: 2620.0,
  isTaken: true,
  closedAtIso: null,
  closedDateKey: null,
  closedTimeWib: null,
  resultPips: null,
});

const existingPrevDuplicateAPlus = makeRecord({
  uid: 'prev-dup-aplus-2620',
  dateKey: '2026-11-17',
  status: 'ACTIVE',
  batchStatus: 'PREVIOUS',
  direction: 'BUY',
  tier: 'A_PLUS',
  headerTitle: 'Buy Limit A+',
  entryLimit: 2620.0,
  isTaken: false,
  closedAtIso: null,
  closedDateKey: null,
  closedTimeWib: null,
  resultPips: null,
});

// 8a. Same-tier intra-zone drift (+2.4 USD < 4.5 USD): MUST keep existing ON_GOING in ON_GOING (NO duplicate, NO move to PREVIOUS)
const driftPull = reconcileIncomingSignalsWithDeleted({
  storedSignals: [existingPrevDuplicateAPlus, existingOnGoingAPlus],
  deletedSignals: [],
  incomingGroups: [
    makeIncomingSetup({
      id: 'buy-a-plus-drift',
      direction: 'BUY',
      tier: 'A_PLUS',
      entryLimit: 2622.4,
    }),
  ],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T11:00:00.000Z',
  nowWib: '18:00 WIB',
  spotPrice: 2636.0,
  dominantBias: 'BULLISH',
  pdZone: 'DISCOUNT',
  positionPct: 32,
  recommendedSide: 'BUY',
  resurfaceDeletedSignals: true,
  mode: 'FULL_PULL',
  isManualTrigger: true,
});
assert.equal(driftPull.addedCount, 0, 'Must NOT add duplicate signal for intra-zone +2.4 USD drift');
assert.equal(driftPull.archivedToPreviousCount, 0, 'Must NOT move existing ON_GOING signal to PREVIOUS');
assert.equal(driftPull.keptInOnGoingCount, 1, 'Must prefer keeping ON_GOING signal over PREVIOUS duplicate');
assert.equal(
  driftPull.nextSignals.find((s) => s.uid === 'ongoing-aplus-2620')?.batchStatus,
  'ON_GOING'
);
assert.equal(
  driftPull.nextSignals.find((s) => s.uid === 'ongoing-aplus-2620')?.isTaken,
  true
);

// 8b. Spot rallies $6 so the exact OB at 2620.0 shifts tier from A_PLUS -> B_STANDARD,
//     while a genuinely new A_PLUS appears at 2626.0 (6.0 USD away):
//     Best-distance pairing must keep existing 2620.0 in ON_GOING (via B_STANDARD match) and add ONLY 2626.0!
const crossTierPull = reconcileIncomingSignalsWithDeleted({
  storedSignals: [existingOnGoingAPlus],
  deletedSignals: [],
  incomingGroups: [
    makeIncomingSetup({
      id: 'buy-a-plus-new',
      direction: 'BUY',
      tier: 'A_PLUS',
      entryLimit: 2626.0,
    }),
    makeIncomingSetup({
      id: 'buy-b-shifted-same-ob',
      direction: 'BUY',
      tier: 'B_STANDARD',
      headerTitle: 'Buy Limit B (Extreme OB)',
      entryLimit: 2620.5, // within <= 2.5 USD cross-tier match of existing 2620.0
    }),
  ],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T12:00:00.000Z',
  nowWib: '19:00 WIB',
  spotPrice: 2641.0,
  dominantBias: 'BULLISH',
  pdZone: 'DISCOUNT',
  positionPct: 30,
  recommendedSide: 'BUY',
  resurfaceDeletedSignals: true,
  mode: 'FULL_PULL',
  isManualTrigger: true,
});
assert.equal(crossTierPull.keptInOnGoingCount, 1);
assert.equal(crossTierPull.archivedToPreviousCount, 0, 'Cross-tier OB at 2620.0 must stay in ON_GOING');
assert.equal(crossTierPull.addedCount, 1, 'Only genuinely new 2626.0 setup should be added');
assert.equal(
  crossTierPull.nextSignals.filter((s) => s.batchStatus === 'ON_GOING').length,
  2
);

// 8c. Manually deleted PREVIOUS / ON_GOING signals return immediately to ON_GOING on FULL_PULL even with +2.0 USD drift
const fullPullResurface = reconcileIncomingSignalsWithDeleted({
  storedSignals: [untouchedPrevBuy],
  deletedSignals: deletedList,
  incomingGroups: [
    makeIncomingSetup({
      id: 'buy-a-plus-reappear',
      direction: 'BUY',
      tier: 'A_PLUS',
      entryLimit: 2622.0, // +2.0 USD from deleted ongoingBuy (2620.0)
    }),
    makeIncomingSetup({
      id: 'sell-b-reappear',
      direction: 'SELL',
      tier: 'B_STANDARD',
      entryLimit: 2663.2, // -1.8 USD from deleted previousSell (2665.0)
    }),
  ],
  tradingMode: 'SCALP',
  currentDayKey: TODAY,
  nowIso: '2026-11-18T13:00:00.000Z',
  nowWib: '20:00 WIB',
  spotPrice: 2638.0,
  dominantBias: 'BULLISH',
  pdZone: 'DISCOUNT',
  positionPct: 35,
  recommendedSide: 'BUY',
  resurfaceDeletedSignals: true,
  mode: 'FULL_PULL',
  isManualTrigger: true,
});
assert.equal(fullPullResurface.resurfacedCount, 2, 'Both deleted ON_GOING and PREVIOUS signals must return to ON_GOING on FULL_PULL');
assert.equal(fullPullResurface.nextDeletedSignals.length, 0);
assert.ok(
  fullPullResurface.nextSignals.some(
    (s) => s.direction === 'BUY' && s.batchStatus === 'ON_GOING' && s.resurfacedFromBatch === 'ON_GOING'
  )
);
assert.ok(
  fullPullResurface.nextSignals.some(
    (s) => s.direction === 'SELL' && s.batchStatus === 'ON_GOING' && s.resurfacedFromBatch === 'PREVIOUS'
  )
);

console.log('✅ test-smc-signal-history passed all assertions (ALL / TODAY / CUSTOM / Cross-day WIB / Deleted Resurface / Keep ON_GOING)');
