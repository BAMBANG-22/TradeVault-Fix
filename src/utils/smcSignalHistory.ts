import type { TradingConfluenceMode, SmcLimitOrderSetup } from './confluenceEngine';

export type SmcSignalOutcomeStatus =
  | 'ACTIVE'
  | 'HIT_TP1'
  | 'HIT_TP2'
  | 'HIT_TP_MAX'
  | 'HIT_SL';

export type SmcSignalBatchStatus = 'ON_GOING' | 'PREVIOUS';

export type SmcHistoryDateFilterMode = 'ALL' | 'TODAY' | 'CUSTOM';
export type SmcHistoryDirectionFilter = 'ALL' | 'BUY' | 'SELL';

export interface SmcStoredSignalRecord {
  uid: string;
  dateKey: string; // YYYY-MM-DD in WIB (Asia/Jakarta) when signal was captured
  createdAtIso: string;
  createdTimeWib: string;
  tradingMode: TradingConfluenceMode;
  spotPriceAtCapture: number;
  dominantBias: 'BULLISH' | 'BEARISH' | 'NETRAL';
  pdZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  positionPct: number;
  recommendedSide: 'BUY' | 'SELL';
  direction: 'BUY' | 'SELL';
  tier: SmcLimitOrderSetup['tier'];
  headerTitle: string;
  entryLimit: number;
  stopLoss: number;
  slPips: number;
  slPoints: number;
  tp1: number;
  tp1Pips: number;
  tp2: number;
  tpMax: number;
  tpMaxRrLabel: string;
  isTaken: boolean;
  status: SmcSignalOutcomeStatus;
  batchStatus?: SmcSignalBatchStatus;
  promotedDateKey?: string | null;
  closedAtIso: string | null;
  closedDateKey?: string | null;
  closedTimeWib: string | null;
  resultPips: number | null;
  resurfacedFromBatch?: SmcSignalBatchStatus | null;
  resurfacedAtIso?: string | null;
}

export interface SmcDeletedSignalRecord {
  signatureKey: string;
  tradingMode: TradingConfluenceMode;
  direction: 'BUY' | 'SELL';
  tier: SmcLimitOrderSetup['tier'];
  headerTitle: string;
  entryLimit: number;
  originalBatchStatus: SmcSignalBatchStatus;
  originalDateKey: string;
  deletedAtIso: string;
}

export const DEFAULT_AUTO_RESURFACE_MIN_ELAPSE_MS = 60 * 1000;
export const SIGNAL_SETUP_MATCH_TOLERANCE_USD = 4.5;
export const SIGNAL_CROSS_TIER_MATCH_TOLERANCE_USD = 2.5;

export function getWibDateKey(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    const wibMs = date.getTime() + 7 * 3600 * 1000;
    return new Date(wibMs).toISOString().slice(0, 10);
  }
}

export function getWibDateKeyFromIso(
  isoStr: string | null | undefined,
  fallbackDateKey: string
): string {
  if (!isoStr) return fallbackDateKey;
  const dt = new Date(isoStr);
  if (!Number.isFinite(dt.getTime())) return fallbackDateKey;
  return getWibDateKey(dt);
}

/**
 * Resolves the effective WIB date key for a closed TP/SL history record:
 * uses explicit `closedDateKey` or derives WIB date from `closedAtIso`, falling back to `dateKey`.
 */
export function getSignalHistoryEffectiveDateKey(record: SmcStoredSignalRecord): string {
  if (record.closedDateKey && /^\d{4}-\d{2}-\d{2}$/.test(record.closedDateKey)) {
    return record.closedDateKey;
  }
  return getWibDateKeyFromIso(record.closedAtIso, record.dateKey);
}

export function getAvailableHistoryDates(
  records: SmcStoredSignalRecord[],
  tradingMode: TradingConfluenceMode,
  todayDateKey: string
): string[] {
  const dateSet = new Set<string>([todayDateKey]);
  for (const r of records) {
    if (r.tradingMode === tradingMode && r.status !== 'ACTIVE') {
      dateSet.add(getSignalHistoryEffectiveDateKey(r));
    }
  }
  return Array.from(dateSet).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

export function filterSignalHistoryRecords(params: {
  records: SmcStoredSignalRecord[];
  tradingMode: TradingConfluenceMode;
  filterMode: SmcHistoryDateFilterMode;
  customDateKey: string;
  todayDateKey: string;
  directionFilter?: SmcHistoryDirectionFilter;
}): SmcStoredSignalRecord[] {
  const {
    records,
    tradingMode,
    filterMode,
    customDateKey,
    todayDateKey,
    directionFilter = 'ALL',
  } = params;
  const closedForMode = records.filter(
    (r) =>
      r.tradingMode === tradingMode &&
      r.status !== 'ACTIVE' &&
      (directionFilter === 'ALL' || r.direction === directionFilter)
  );

  const filtered =
    filterMode === 'ALL'
      ? closedForMode
      : filterMode === 'TODAY'
      ? closedForMode.filter((r) => getSignalHistoryEffectiveDateKey(r) === todayDateKey)
      : closedForMode.filter((r) => getSignalHistoryEffectiveDateKey(r) === customDateKey);

  return [...filtered].sort((a, b) =>
    (b.closedAtIso || b.createdAtIso).localeCompare(a.closedAtIso || a.createdAtIso)
  );
}

export function groupHistoryRecordsByDate(
  records: SmcStoredSignalRecord[]
): Array<[string, SmcStoredSignalRecord[]]> {
  const groups = new Map<string, SmcStoredSignalRecord[]>();
  for (const item of records) {
    const key = getSignalHistoryEffectiveDateKey(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return Array.from(groups.entries()).sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0));
}

export interface SignalHistorySummaryStats {
  tpCount: number;
  slCount: number;
  totalClosed: number;
  winRate: number;
  netPips: number;
}

export function computeSignalHistorySummary(
  records: SmcStoredSignalRecord[]
): SignalHistorySummaryStats {
  let tpCount = 0;
  let slCount = 0;
  let netPips = 0;
  for (const item of records) {
    if (item.status === 'HIT_SL') {
      slCount++;
    } else {
      tpCount++;
    }
    netPips += item.resultPips ?? 0;
  }
  const totalClosed = tpCount + slCount;
  const winRate = totalClosed > 0 ? Math.round((tpCount / totalClosed) * 100) : 0;
  return { tpCount, slCount, totalClosed, winRate, netPips };
}

export function buildDeletedSignalSignatureKey(params: {
  tradingMode: TradingConfluenceMode;
  direction: 'BUY' | 'SELL';
  tier: SmcLimitOrderSetup['tier'];
  entryLimit: number;
}): string {
  return `${params.tradingMode}|${params.direction}|${params.tier}|${params.entryLimit.toFixed(1)}`;
}

export function isMatchingSignalSetup(
  a: {
    tradingMode: TradingConfluenceMode;
    direction: 'BUY' | 'SELL';
    tier: SmcLimitOrderSetup['tier'];
    entryLimit: number;
  },
  b: {
    tradingMode: TradingConfluenceMode;
    direction: 'BUY' | 'SELL';
    tier: SmcLimitOrderSetup['tier'];
    entryLimit: number;
  },
  toleranceUsd: number = SIGNAL_SETUP_MATCH_TOLERANCE_USD,
  crossTierToleranceUsd: number = SIGNAL_CROSS_TIER_MATCH_TOLERANCE_USD
): boolean {
  if (a.tradingMode !== b.tradingMode || a.direction !== b.direction) {
    return false;
  }
  const diff = Math.abs(a.entryLimit - b.entryLimit);
  if (a.tier === b.tier) {
    return diff < toleranceUsd;
  }
  return diff <= crossTierToleranceUsd;
}

/**
 * Records a deleted ACTIVE signal (ON_GOING or PREVIOUS) so later market scans
 * can either re-surface it if the same setup appears again or keep it suppressed.
 * Closed HISTORY items (HIT_TP* / HIT_SL) are intentionally excluded.
 */
export function recordDeletedActiveSignal(
  deletedList: SmcDeletedSignalRecord[],
  record: SmcStoredSignalRecord,
  deletedAtIso: string = new Date().toISOString()
): SmcDeletedSignalRecord[] {
  if (!record || record.status !== 'ACTIVE') {
    return deletedList;
  }
  const originalBatchStatus: SmcSignalBatchStatus =
    record.batchStatus === 'PREVIOUS' ? 'PREVIOUS' : 'ON_GOING';

  const entry: SmcDeletedSignalRecord = {
    signatureKey: buildDeletedSignalSignatureKey({
      tradingMode: record.tradingMode,
      direction: record.direction,
      tier: record.tier,
      entryLimit: record.entryLimit,
    }),
    tradingMode: record.tradingMode,
    direction: record.direction,
    tier: record.tier,
    headerTitle: record.headerTitle,
    entryLimit: record.entryLimit,
    originalBatchStatus,
    originalDateKey: record.dateKey,
    deletedAtIso,
  };

  const filtered = deletedList.filter(
    (d) =>
      !isMatchingSignalSetup(d, {
        tradingMode: record.tradingMode,
        direction: record.direction,
        tier: record.tier,
        entryLimit: record.entryLimit,
      })
  );

  return [entry, ...filtered].slice(0, 120);
}

export interface ReconcileSignalsResult {
  nextSignals: SmcStoredSignalRecord[];
  nextDeletedSignals: SmcDeletedSignalRecord[];
  addedCount: number;
  resurfacedCount: number;
  promotedCount: number;
  keptInOnGoingCount: number;
  promotedFromPreviousCount: number;
  archivedToPreviousCount: number;
  suppressedCount: number;
}

/**
 * Unified pure engine reconciling newly evaluated market setups against stored active signals
 * and previously deleted (ON_GOING / PREVIOUS) signals.
 *
 * Modes:
 * - `'FULL_PULL'` (`+ Tarik Sinyal Baru` or initial daily capture):
 *   Rotates unmatched ON_GOING signals to PREVIOUS, keeps/promotes matching ACTIVE signals in ON_GOING
 *   without duplicating or demoting them, and re-surfaces (or suppresses) matching deleted signals
 *   depending on `resurfaceDeletedSignals`.
 * - `'AUTO_RESURFACE_ONLY'` (background market analysis e.g. 1h/6h later):
 *   Leaves untouched existing ON_GOING / PREVIOUS signals completely intact, and ONLY checks
 *   whether any previously deleted signal re-appeared in the new market scan (when `resurfaceDeletedSignals` is true
 *   and elapsed time since deletion >= `minAutoResurfaceElapseMs`).
 */
export function reconcileIncomingSignalsWithDeleted(params: {
  storedSignals: SmcStoredSignalRecord[];
  deletedSignals: SmcDeletedSignalRecord[];
  incomingGroups: SmcLimitOrderSetup[];
  tradingMode: TradingConfluenceMode;
  currentDayKey: string;
  nowIso: string;
  nowWib: string;
  spotPrice: number;
  dominantBias: 'BULLISH' | 'BEARISH' | 'NETRAL';
  pdZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  positionPct: number;
  recommendedSide: 'BUY' | 'SELL';
  resurfaceDeletedSignals: boolean;
  mode: 'FULL_PULL' | 'AUTO_RESURFACE_ONLY';
  isManualTrigger?: boolean;
  minAutoResurfaceElapseMs?: number;
}): ReconcileSignalsResult {
  const {
    storedSignals,
    deletedSignals,
    incomingGroups,
    tradingMode,
    currentDayKey,
    nowIso,
    nowWib,
    spotPrice,
    dominantBias,
    pdZone,
    positionPct,
    recommendedSide,
    resurfaceDeletedSignals,
    mode,
    isManualTrigger = false,
    minAutoResurfaceElapseMs = DEFAULT_AUTO_RESURFACE_MIN_ELAPSE_MS,
  } = params;

  if (!spotPrice || spotPrice <= 0) {
    return {
      nextSignals: storedSignals,
      nextDeletedSignals: deletedSignals,
      addedCount: 0,
      resurfacedCount: 0,
      promotedCount: 0,
      keptInOnGoingCount: 0,
      promotedFromPreviousCount: 0,
      archivedToPreviousCount: 0,
      suppressedCount: 0,
    };
  }

  const nowMs = new Date(nowIso).getTime();
  const existingForTodayMode = storedSignals.filter(
    (r) => r.dateKey === currentDayKey && r.tradingMode === tradingMode
  );

  if (mode === 'FULL_PULL' && !isManualTrigger && existingForTodayMode.length > 0) {
    return {
      nextSignals: storedSignals,
      nextDeletedSignals: deletedSignals,
      addedCount: 0,
      resurfacedCount: 0,
      promotedCount: 0,
      keptInOnGoingCount: 0,
      promotedFromPreviousCount: 0,
      archivedToPreviousCount: 0,
      suppressedCount: 0,
    };
  }

  if (mode === 'AUTO_RESURFACE_ONLY' && !resurfaceDeletedSignals) {
    return {
      nextSignals: storedSignals,
      nextDeletedSignals: deletedSignals,
      addedCount: 0,
      resurfacedCount: 0,
      promotedCount: 0,
      keptInOnGoingCount: 0,
      promotedFromPreviousCount: 0,
      archivedToPreviousCount: 0,
      suppressedCount: 0,
    };
  }

  const existingActiveForMode = storedSignals.filter(
    (r) => r.tradingMode === tradingMode && r.status === 'ACTIVE'
  );
  const deletedForMode = deletedSignals.filter((d) => d.tradingMode === tradingMode);

  // Best-distance 1-to-1 pairing between valid incoming groups and existing active signals:
  // Ensures closest entry prices match first (including OB tier shifts) and prefers keeping
  // existing ON_GOING / taken setups intact rather than demoting them to PREVIOUS or duplicating them.
  const validIncoming = incomingGroups
    .map((group, idx) => ({ group, idx }))
    .filter(({ group }) => Boolean(group.entryLimit && group.entryLimit > 0));

  interface ActiveMatchCandidate {
    incomingIdx: number;
    existing: SmcStoredSignalRecord;
    priceDiff: number;
    sameTier: boolean;
    isOnGoing: boolean;
  }

  const activePairs: ActiveMatchCandidate[] = [];
  for (const { group, idx } of validIncoming) {
    const incomingCandidate = {
      tradingMode,
      direction: group.direction,
      tier: group.tier,
      entryLimit: group.entryLimit,
    };
    for (const existing of existingActiveForMode) {
      if (isMatchingSignalSetup(existing, incomingCandidate)) {
        activePairs.push({
          incomingIdx: idx,
          existing,
          priceDiff: Math.abs(existing.entryLimit - group.entryLimit),
          sameTier: existing.tier === group.tier,
          isOnGoing: (existing.batchStatus || 'ON_GOING') === 'ON_GOING',
        });
      }
    }
  }

  activePairs.sort((a, b) => {
    if (Math.abs(a.priceDiff - b.priceDiff) > 0.25) {
      return a.priceDiff - b.priceDiff;
    }
    if (a.isOnGoing !== b.isOnGoing) return a.isOnGoing ? -1 : 1;
    if (a.existing.isTaken !== b.existing.isTaken) return a.existing.isTaken ? -1 : 1;
    if (a.sameTier !== b.sameTier) return a.sameTier ? -1 : 1;
    return b.existing.createdAtIso.localeCompare(a.existing.createdAtIso);
  });

  const matchedIncomingIndices = new Set<number>();
  const matchedExistingUids = new Set<string>();
  let promotedCount = 0;
  let keptInOnGoingCount = 0;
  let promotedFromPreviousCount = 0;

  for (const pair of activePairs) {
    if (
      matchedIncomingIndices.has(pair.incomingIdx) ||
      matchedExistingUids.has(pair.existing.uid)
    ) {
      continue;
    }
    matchedIncomingIndices.add(pair.incomingIdx);
    matchedExistingUids.add(pair.existing.uid);
    if (mode === 'FULL_PULL') {
      promotedCount++;
      if (pair.isOnGoing) {
        keptInOnGoingCount++;
      } else {
        promotedFromPreviousCount++;
      }
    }
  }

  // Also absorb any extra active ON_GOING duplicates already matching one of the matched incoming
  // setups so they stay cleanly in ON_GOING rather than being pushed to PREVIOUS if already identical
  if (mode === 'FULL_PULL') {
    for (const pair of activePairs) {
      if (pair.isOnGoing && !matchedExistingUids.has(pair.existing.uid)) {
        matchedExistingUids.add(pair.existing.uid);
        keptInOnGoingCount++;
        promotedCount++;
      }
    }
  }

  // Pair remaining unmatched incoming setups against deleted signals (closest entry first)
  interface DeletedMatchCandidate {
    incomingIdx: number;
    deleted: SmcDeletedSignalRecord;
    priceDiff: number;
    sameTier: boolean;
  }

  const deletedPairs: DeletedMatchCandidate[] = [];
  for (const { group, idx } of validIncoming) {
    if (matchedIncomingIndices.has(idx)) continue;
    const incomingCandidate = {
      tradingMode,
      direction: group.direction,
      tier: group.tier,
      entryLimit: group.entryLimit,
    };
    for (const del of deletedForMode) {
      if (isMatchingSignalSetup(del, incomingCandidate)) {
        deletedPairs.push({
          incomingIdx: idx,
          deleted: del,
          priceDiff: Math.abs(del.entryLimit - group.entryLimit),
          sameTier: del.tier === group.tier,
        });
      }
    }
  }

  deletedPairs.sort((a, b) => {
    if (Math.abs(a.priceDiff - b.priceDiff) > 0.25) {
      return a.priceDiff - b.priceDiff;
    }
    if (a.sameTier !== b.sameTier) return a.sameTier ? -1 : 1;
    return b.deleted.deletedAtIso.localeCompare(a.deleted.deletedAtIso);
  });

  const matchedDeletedByIncomingIdx = new Map<number, SmcDeletedSignalRecord>();
  const usedDeletedKeys = new Set<string>();
  for (const pair of deletedPairs) {
    if (
      matchedDeletedByIncomingIdx.has(pair.incomingIdx) ||
      usedDeletedKeys.has(pair.deleted.signatureKey)
    ) {
      continue;
    }
    matchedDeletedByIncomingIdx.set(pair.incomingIdx, pair.deleted);
    usedDeletedKeys.add(pair.deleted.signatureKey);
  }

  const consumedDeletedSignatures = new Set<string>();
  const newRecords: SmcStoredSignalRecord[] = [];
  let resurfacedCount = 0;
  let suppressedCount = 0;

  for (const { group, idx } of validIncoming) {
    if (matchedIncomingIndices.has(idx)) {
      continue;
    }

    const matchingDeleted = matchedDeletedByIncomingIdx.get(idx);

    if (mode === 'AUTO_RESURFACE_ONLY') {
      if (!matchingDeleted) {
        continue;
      }
      const deletedMs = new Date(matchingDeleted.deletedAtIso).getTime();
      const elapsedOk =
        Number.isFinite(nowMs) && Number.isFinite(deletedMs)
          ? nowMs - deletedMs >= minAutoResurfaceElapseMs
          : true;
      if (!elapsedOk) {
        continue;
      }
    } else if (matchingDeleted && !resurfaceDeletedSignals) {
      suppressedCount++;
      continue;
    }

    const isResurfaced = Boolean(matchingDeleted && resurfaceDeletedSignals);
    if (matchingDeleted && isResurfaced) {
      consumedDeletedSignatures.add(matchingDeleted.signatureKey);
      resurfacedCount++;
    }

    const uidBase = Number.isFinite(nowMs) ? nowMs : Date.now();
    newRecords.push({
      uid: `${currentDayKey}-${tradingMode}-${group.direction}-${group.tier}-${uidBase}-${idx}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      dateKey: currentDayKey,
      createdAtIso: nowIso,
      createdTimeWib: nowWib,
      tradingMode,
      spotPriceAtCapture: spotPrice,
      dominantBias,
      pdZone,
      positionPct,
      recommendedSide,
      direction: group.direction,
      tier: group.tier,
      headerTitle: group.headerTitle,
      entryLimit: group.entryLimit,
      stopLoss: group.stopLoss,
      slPips: group.slPips,
      slPoints: group.slPoints,
      tp1: group.tp1,
      tp1Pips: group.tp1Pips,
      tp2: group.tp2,
      tpMax: group.tpMax,
      tpMaxRrLabel: group.tpMaxRrLabel,
      isTaken: false,
      status: 'ACTIVE',
      batchStatus: 'ON_GOING',
      promotedDateKey: currentDayKey,
      closedAtIso: null,
      closedDateKey: null,
      closedTimeWib: null,
      resultPips: null,
      resurfacedFromBatch: isResurfaced ? matchingDeleted!.originalBatchStatus : null,
      resurfacedAtIso: isResurfaced ? nowIso : null,
    });
  }

  let archivedToPreviousCount = 0;
  const updatedPrev =
    mode === 'FULL_PULL'
      ? storedSignals.map((rec) => {
          if (rec.tradingMode !== tradingMode || rec.status !== 'ACTIVE') {
            return rec;
          }
          if (matchedExistingUids.has(rec.uid)) {
            return {
              ...rec,
              batchStatus: 'ON_GOING' as SmcSignalBatchStatus,
              promotedDateKey: currentDayKey,
              dominantBias,
              pdZone,
              positionPct,
              recommendedSide,
            };
          }
          if ((rec.batchStatus || 'ON_GOING') === 'ON_GOING') {
            archivedToPreviousCount++;
          }
          return {
            ...rec,
            batchStatus: 'PREVIOUS' as SmcSignalBatchStatus,
            promotedDateKey: null,
          };
        })
      : storedSignals;

  const nextDeletedSignals =
    consumedDeletedSignatures.size > 0
      ? deletedSignals.filter((d) => !consumedDeletedSignatures.has(d.signatureKey))
      : deletedSignals;

  return {
    nextSignals: newRecords.length > 0 ? [...newRecords, ...updatedPrev] : updatedPrev,
    nextDeletedSignals,
    addedCount: newRecords.length,
    resurfacedCount,
    promotedCount,
    keptInOnGoingCount,
    promotedFromPreviousCount,
    archivedToPreviousCount,
    suppressedCount,
  };
}
