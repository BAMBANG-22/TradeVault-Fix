import {
  Trade,
  TradeLifecycleStatus,
  TradeOrderType,
  TradeCloseType,
  TradeActivityEvent,
  TradeActivityEventType,
  HistoricalExchangeRateSnapshot,
} from '../types/trade';
import { AppSettings } from '../types/settings';
import { encodeUtf8ToBase64Url, decodeBase64UrlToUtf8 } from '../storage/utf8Base64Url';
import { calculateLotBasedOrderMetrics } from './riskCalculator';
import {
  classifyNetProfitOutcome,
  computeNetFromGross,
  computeRealizedRMultiple,
  extractTradeLocalDateKey,
  formatLocalDateKey,
} from './calculations';

export interface TradeLifecycleMeta {
  status?: TradeLifecycleStatus;
  orderType?: TradeOrderType;
  plannedEntry?: number;
  plannedLot?: number;
  plannedStopLoss?: number;
  plannedTakeProfit?: number;
  plannedDateTime?: string;
  actualEntry?: number;
  actualLot?: number;
  actualExit?: number;
  entryTime?: string;
  exitTime?: string;
  closeType?: TradeCloseType;
  closeExchangeRate?: HistoricalExchangeRateSnapshot;
  beforeScreenshotUrl?: string;
  afterScreenshotUrl?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  activityLog?: TradeActivityEvent[];
  mistakeTags?: string[];
  emotionTag?: string;
  accountId?: string;
  playbookId?: string;
  checklistPassed?: boolean;
  ruleCompliant?: boolean;
}

export interface ResolvedTradeLifecycle {
  status: TradeLifecycleStatus;
  orderType: TradeOrderType;
  plannedEntry: number;
  plannedLot: number;
  plannedStopLoss?: number;
  plannedTakeProfit?: number;
  plannedDateTime: string;
  actualEntry?: number;
  actualLot?: number;
  actualExit?: number;
  entryTime?: string;
  exitTime?: string;
  closeType?: TradeCloseType;
  closeExchangeRate?: HistoricalExchangeRateSnapshot;
  beforeScreenshotUrl?: string;
  afterScreenshotUrl?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  activityLog: TradeActivityEvent[];
  mistakeTags?: string[];
  emotionTag?: string;
  accountId?: string;
  playbookId?: string;
  checklistPassed?: boolean;
  ruleCompliant?: boolean;
  isLegacyClosedTrade: boolean;
}

const TV_LIFECYCLE_TAG_REGEX = /\s*\[TV_META:([A-Za-z0-9_-]+)\]\s*$/;

/**
 * Strips any embedded [TV_META:...] payload from executionNotes so compliance and user text remain clean.
 */
export function stripLifecycleMetaFromExecutionNotes(executionNotes?: string | null): string {
  if (!executionNotes || typeof executionNotes !== 'string') return '';
  return executionNotes.replace(TV_LIFECYCLE_TAG_REGEX, '').trim();
}

/**
 * Decodes the [TV_META:<base64url>] block from trade.executionNotes if present.
 */
export function decodeLifecycleMetaFromExecutionNotes(
  executionNotes?: string | null
): TradeLifecycleMeta {
  if (!executionNotes || typeof executionNotes !== 'string') return {};
  const match = executionNotes.match(TV_LIFECYCLE_TAG_REGEX);
  if (!match || !match[1]) return {};
  try {
    const jsonStr = decodeBase64UrlToUtf8(match[1].trim());
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TradeLifecycleMeta;
    }
  } catch {
    // Ignore malformed metadata and fall back to legacy defaults
  }
  return {};
}

/**
 * Encodes TradeLifecycleMeta into executionNotes while preserving any existing compliance prefix and user notes.
 */
export function encodeLifecycleMetaIntoExecutionNotes(
  baseExecutionNotes: string | undefined | null,
  meta: TradeLifecycleMeta
): string {
  const cleanBase = stripLifecycleMetaFromExecutionNotes(baseExecutionNotes);
  const cleanMeta: TradeLifecycleMeta = {};

  if (
    meta.status === 'PLANNED' ||
    meta.status === 'OPEN' ||
    meta.status === 'CLOSED' ||
    meta.status === 'CANCELLED'
  ) {
    cleanMeta.status = meta.status;
  }
  if (meta.orderType === 'Market' || meta.orderType === 'Pending') {
    cleanMeta.orderType = meta.orderType;
  }
  if (typeof meta.plannedEntry === 'number' && Number.isFinite(meta.plannedEntry) && meta.plannedEntry > 0) {
    cleanMeta.plannedEntry = meta.plannedEntry;
  }
  if (typeof meta.plannedLot === 'number' && Number.isFinite(meta.plannedLot) && meta.plannedLot > 0) {
    cleanMeta.plannedLot = meta.plannedLot;
  }
  if (
    typeof meta.plannedStopLoss === 'number' &&
    Number.isFinite(meta.plannedStopLoss) &&
    meta.plannedStopLoss > 0
  ) {
    cleanMeta.plannedStopLoss = meta.plannedStopLoss;
  }
  if (
    typeof meta.plannedTakeProfit === 'number' &&
    Number.isFinite(meta.plannedTakeProfit) &&
    meta.plannedTakeProfit > 0
  ) {
    cleanMeta.plannedTakeProfit = meta.plannedTakeProfit;
  }
  if (typeof meta.plannedDateTime === 'string' && meta.plannedDateTime.trim()) {
    cleanMeta.plannedDateTime = meta.plannedDateTime.trim();
  }
  if (typeof meta.actualEntry === 'number' && Number.isFinite(meta.actualEntry) && meta.actualEntry > 0) {
    cleanMeta.actualEntry = meta.actualEntry;
  }
  if (typeof meta.actualLot === 'number' && Number.isFinite(meta.actualLot) && meta.actualLot > 0) {
    cleanMeta.actualLot = meta.actualLot;
  }
  if (typeof meta.actualExit === 'number' && Number.isFinite(meta.actualExit) && meta.actualExit > 0) {
    cleanMeta.actualExit = meta.actualExit;
  }
  if (typeof meta.entryTime === 'string' && meta.entryTime.trim()) {
    cleanMeta.entryTime = meta.entryTime.trim();
  }
  if (typeof meta.exitTime === 'string' && meta.exitTime.trim()) {
    cleanMeta.exitTime = meta.exitTime.trim();
  }
  if (meta.closeType === 'TP' || meta.closeType === 'SL' || meta.closeType === 'Manual') {
    cleanMeta.closeType = meta.closeType;
  }
  if (meta.closeExchangeRate && typeof meta.closeExchangeRate.rate === 'number') {
    cleanMeta.closeExchangeRate = meta.closeExchangeRate;
  }
  if (typeof meta.beforeScreenshotUrl === 'string' && meta.beforeScreenshotUrl.trim()) {
    cleanMeta.beforeScreenshotUrl = meta.beforeScreenshotUrl.trim();
  }
  if (typeof meta.afterScreenshotUrl === 'string' && meta.afterScreenshotUrl.trim()) {
    cleanMeta.afterScreenshotUrl = meta.afterScreenshotUrl.trim();
  }
  if (typeof meta.cancellationReason === 'string' && meta.cancellationReason.trim()) {
    cleanMeta.cancellationReason = meta.cancellationReason.trim();
  }
  if (typeof meta.cancelledAt === 'string' && meta.cancelledAt.trim()) {
    cleanMeta.cancelledAt = meta.cancelledAt.trim();
  }
  if (Array.isArray(meta.activityLog) && meta.activityLog.length > 0) {
    cleanMeta.activityLog = meta.activityLog;
  }
  if (Array.isArray(meta.mistakeTags) && meta.mistakeTags.length > 0) {
    cleanMeta.mistakeTags = meta.mistakeTags.filter((x) => typeof x === 'string' && x.trim() !== '');
  }
  if (typeof meta.emotionTag === 'string' && meta.emotionTag.trim()) {
    cleanMeta.emotionTag = meta.emotionTag.trim();
  }
  if (typeof meta.accountId === 'string' && meta.accountId.trim()) {
    cleanMeta.accountId = meta.accountId.trim();
  }
  if (typeof meta.playbookId === 'string' && meta.playbookId.trim()) {
    cleanMeta.playbookId = meta.playbookId.trim();
  }
  if (typeof meta.checklistPassed === 'boolean') {
    cleanMeta.checklistPassed = meta.checklistPassed;
  }
  if (typeof meta.ruleCompliant === 'boolean') {
    cleanMeta.ruleCompliant = meta.ruleCompliant;
  }

  if (Object.keys(cleanMeta).length === 0) {
    return cleanBase;
  }

  const encoded = encodeUtf8ToBase64Url(JSON.stringify(cleanMeta));
  return cleanBase ? `${cleanBase} [TV_META:${encoded}]` : `[TV_META:${encoded}]`;
}

/**
 * Resolves the authoritative lifecycle status of any trade.
 * - Legacy trades without explicit [TV_META:...] status are always 'CLOSED' (preserving 100% backward compatibility).
 * - Never fabricates status from WIN/LOSS/BREAKEVEN.
 */
export function getTradeLifecycleStatus(trade: Partial<Trade>): TradeLifecycleStatus {
  const meta = decodeLifecycleMetaFromExecutionNotes(trade?.executionNotes);
  if (
    meta.status === 'PLANNED' ||
    meta.status === 'OPEN' ||
    meta.status === 'CLOSED' ||
    meta.status === 'CANCELLED'
  ) {
    return meta.status;
  }
  return 'CLOSED';
}

/**
 * Returns true if the trade is CLOSED and therefore eligible for realized P/L, Win Rate,
 * Profit Factor, Expectancy, and Drawdown metrics.
 * PLANNED, OPEN, and CANCELLED trades are strictly excluded from realized metrics.
 */
export function isTradeClosedForRealizedMetrics(trade: Partial<Trade>): boolean {
  return getTradeLifecycleStatus(trade) === 'CLOSED';
}

/**
 * Resolves full lifecycle plan, execution, screenshot, and activity log data for a Trade.
 * Preserves initial Trade Plan separately from actual execution values.
 */
export function resolveTradeLifecycle(trade: Trade): ResolvedTradeLifecycle {
  const meta = decodeLifecycleMetaFromExecutionNotes(trade.executionNotes);
  const hasExplicitStatus = Boolean(
    meta.status === 'PLANNED' ||
      meta.status === 'OPEN' ||
      meta.status === 'CLOSED' ||
      meta.status === 'CANCELLED'
  );
  const status: TradeLifecycleStatus = hasExplicitStatus ? meta.status! : 'CLOSED';
  const isLegacyClosedTrade = !hasExplicitStatus;

  const orderType: TradeOrderType =
    meta.orderType === 'Pending' || meta.orderType === 'Market' ? meta.orderType : 'Market';

  const plannedEntry =
    typeof meta.plannedEntry === 'number' && meta.plannedEntry > 0
      ? meta.plannedEntry
      : Number(trade.entryPrice) || 0;
  const plannedLot =
    typeof meta.plannedLot === 'number' && meta.plannedLot > 0
      ? meta.plannedLot
      : Number(trade.lotSize) || 0.01;
  const plannedStopLoss =
    typeof meta.plannedStopLoss === 'number' && meta.plannedStopLoss > 0
      ? meta.plannedStopLoss
      : trade.stopLoss && trade.stopLoss > 0
      ? trade.stopLoss
      : undefined;
  const plannedTakeProfit =
    typeof meta.plannedTakeProfit === 'number' && meta.plannedTakeProfit > 0
      ? meta.plannedTakeProfit
      : trade.takeProfit && trade.takeProfit > 0
      ? trade.takeProfit
      : undefined;
  const plannedDateTime = meta.plannedDateTime || trade.dateTime;

  let actualEntry: number | undefined;
  let actualLot: number | undefined;
  let actualExit: number | undefined;
  let entryTime: string | undefined;
  let exitTime: string | undefined;
  let closeType: TradeCloseType | undefined = meta.closeType;

  if (status === 'OPEN' || status === 'CLOSED') {
    actualEntry =
      typeof meta.actualEntry === 'number' && meta.actualEntry > 0
        ? meta.actualEntry
        : Number(trade.entryPrice) > 0
        ? Number(trade.entryPrice)
        : undefined;
    actualLot =
      typeof meta.actualLot === 'number' && meta.actualLot > 0
        ? meta.actualLot
        : Number(trade.lotSize) > 0
        ? Number(trade.lotSize)
        : undefined;
    entryTime = meta.entryTime || trade.dateTime;
  }

  if (status === 'CLOSED') {
    actualExit =
      typeof meta.actualExit === 'number' && meta.actualExit > 0
        ? meta.actualExit
        : trade.exitPrice && trade.exitPrice > 0
        ? trade.exitPrice
        : undefined;
    exitTime = meta.exitTime || (isLegacyClosedTrade ? trade.updatedAt || trade.dateTime : undefined);
  }

  const beforeScreenshotUrl = meta.beforeScreenshotUrl || trade.screenshotUrl || undefined;
  const afterScreenshotUrl = meta.afterScreenshotUrl || undefined;

  const activityLog: TradeActivityEvent[] = Array.isArray(meta.activityLog)
    ? [...meta.activityLog]
    : [];

  return {
    status,
    orderType,
    plannedEntry,
    plannedLot,
    plannedStopLoss,
    plannedTakeProfit,
    plannedDateTime,
    actualEntry,
    actualLot,
    actualExit,
    entryTime,
    exitTime,
    closeType,
    closeExchangeRate: meta.closeExchangeRate || trade.closeExchangeRate || undefined,
    beforeScreenshotUrl,
    afterScreenshotUrl,
    cancellationReason: meta.cancellationReason,
    cancelledAt: meta.cancelledAt,
    activityLog,
    mistakeTags: Array.isArray(trade.mistakeTags) && trade.mistakeTags.length > 0 ? trade.mistakeTags : meta.mistakeTags,
    emotionTag: trade.emotionTag || meta.emotionTag,
    accountId: trade.accountId || meta.accountId,
    playbookId: trade.playbookId || meta.playbookId,
    checklistPassed: typeof trade.checklistPassed === 'boolean' ? trade.checklistPassed : meta.checklistPassed,
    ruleCompliant: typeof trade.ruleCompliant === 'boolean' ? trade.ruleCompliant : meta.ruleCompliant,
    isLegacyClosedTrade,
  };
}

/**
 * Creates a genuine activity event item with an explicit timestamp.
 */
export function createActivityEvent(
  type: TradeActivityEventType,
  label: string,
  options?: {
    timestamp?: string;
    previousValue?: string;
    newValue?: string;
    note?: string;
  }
): TradeActivityEvent {
  const ts = options?.timestamp || new Date().toISOString();
  return {
    id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    timestamp: ts,
    label,
    previousValue: options?.previousValue,
    newValue: options?.newValue,
    note: options?.note,
  };
}

/**
 * Transitions a PLANNED trade to OPEN after user confirms MT5 execution, actual entry price, and actual lot.
 * Preserves the original Trade Plan values intact while updating execution values.
 */
export function transitionPlannedTradeToOpen(
  trade: Trade,
  params: {
    actualEntryPrice: number;
    actualLotSize: number;
    entryTime?: string;
    settings: AppSettings;
    capitalBasis?: number;
  }
): Trade {
  const current = resolveTradeLifecycle(trade);
  if (current.status !== 'PLANNED') {
    throw new Error('Hanya transaksi berstatus PLANNED yang dapat dikonfirmasi menjadi OPEN.');
  }

  const nowIso = new Date().toISOString();
  const effectiveEntryTime = params.entryTime || nowIso;
  const cleanEntry = Number(params.actualEntryPrice);
  const cleanLot = Number(params.actualLotSize);

  if (!Number.isFinite(cleanEntry) || cleanEntry <= 0) {
    throw new Error('Harga Actual Entry harus berupa angka positif yang valid.');
  }
  if (!Number.isFinite(cleanLot) || cleanLot <= 0) {
    throw new Error('Actual Lot harus berupa angka positif lebih dari 0.');
  }

  const lotMetrics = calculateLotBasedOrderMetrics(
    {
      symbol: trade.instrument,
      position: trade.position,
      lotSize: cleanLot,
      entryPrice: cleanEntry,
      stopLossPrice: trade.stopLoss,
      takeProfitPrice: trade.takeProfit,
      capitalBasis: params.capitalBasis || params.settings.startingBalance,
    },
    params.settings
  );

  const nextLog = [
    ...current.activityLog,
    createActivityEvent('POSITION_OPENED', 'Position Opened (Eksekusi MT5 Dikonfirmasi)', {
      timestamp: effectiveEntryTime,
      previousValue: `Plan: ${current.plannedEntry.toFixed(2)} (${current.plannedLot.toFixed(2)} Lot)`,
      newValue: `Actual: ${cleanEntry.toFixed(2)} (${cleanLot.toFixed(2)} Lot)`,
    }),
  ];

  const nextMeta: TradeLifecycleMeta = {
    status: 'OPEN',
    orderType: current.orderType,
    plannedEntry: current.plannedEntry,
    plannedLot: current.plannedLot,
    plannedStopLoss: current.plannedStopLoss,
    plannedTakeProfit: current.plannedTakeProfit,
    plannedDateTime: current.plannedDateTime,
    actualEntry: cleanEntry,
    actualLot: cleanLot,
    entryTime: effectiveEntryTime,
    beforeScreenshotUrl: current.beforeScreenshotUrl,
    afterScreenshotUrl: current.afterScreenshotUrl,
    activityLog: nextLog,
    mistakeTags: current.mistakeTags,
    emotionTag: current.emotionTag,
    accountId: current.accountId,
    playbookId: current.playbookId,
    checklistPassed: current.checklistPassed,
    ruleCompliant: current.ruleCompliant,
  };

  return {
    ...trade,
    entryPrice: cleanEntry,
    lotSize: cleanLot,
    riskAmount:
      lotMetrics.isSlValid && lotMetrics.riskAmount !== null
        ? lotMetrics.riskAmount
        : trade.riskAmount,
    riskPercentage:
      lotMetrics.isSlValid && lotMetrics.riskPercent !== null
        ? lotMetrics.riskPercent
        : trade.riskPercentage,
    grossProfit: 0,
    netProfit: 0,
    outcome: 'BREAKEVEN',
    executionNotes: encodeLifecycleMetaIntoExecutionNotes(trade.executionNotes, nextMeta),
    updatedAt: nowIso,
  };
}

/**
 * Transitions a PLANNED trade to CANCELLED.
 * Cancelled trades are never counted as LOSS and have 0 realized P/L.
 */
export function transitionPlannedTradeToCancelled(
  trade: Trade,
  reason?: string
): Trade {
  const current = resolveTradeLifecycle(trade);
  if (current.status !== 'PLANNED') {
    throw new Error('Hanya transaksi berstatus PLANNED yang dapat dibatalkan menjadi CANCELLED.');
  }

  const nowIso = new Date().toISOString();
  const cleanReason = reason?.trim() || undefined;

  const nextLog = [
    ...current.activityLog,
    createActivityEvent('TRADE_CANCELLED', 'Trade Cancelled (Order Dibatalkan)', {
      timestamp: nowIso,
      note: cleanReason || 'Setup / pending order dibatalkan sebelum tereksekusi.',
    }),
  ];

  const nextMeta: TradeLifecycleMeta = {
    status: 'CANCELLED',
    orderType: current.orderType,
    plannedEntry: current.plannedEntry,
    plannedLot: current.plannedLot,
    plannedStopLoss: current.plannedStopLoss,
    plannedTakeProfit: current.plannedTakeProfit,
    plannedDateTime: current.plannedDateTime,
    beforeScreenshotUrl: current.beforeScreenshotUrl,
    afterScreenshotUrl: current.afterScreenshotUrl,
    cancellationReason: cleanReason,
    cancelledAt: nowIso,
    activityLog: nextLog,
    mistakeTags: current.mistakeTags,
    emotionTag: current.emotionTag,
    accountId: current.accountId,
    playbookId: current.playbookId,
    checklistPassed: current.checklistPassed,
    ruleCompliant: current.ruleCompliant,
  };

  return {
    ...trade,
    grossProfit: 0,
    netProfit: 0,
    outcome: 'BREAKEVEN',
    rMultiple: undefined,
    executionNotes: encodeLifecycleMetaIntoExecutionNotes(trade.executionNotes, nextMeta),
    updatedAt: nowIso,
  };
}

/**
 * Transitions an OPEN trade to CLOSED with closeType ('TP' | 'SL' | 'Manual'),
 * actualExitPrice, exitTime, and calculated/verified P/L.
 */
export function transitionOpenTradeToClosed(
  trade: Trade,
  params: {
    closeType: TradeCloseType;
    actualExitPrice: number;
    exitTime?: string;
    commission?: number;
    swap?: number;
    overrideNetProfit?: number;
    closeExchangeRate?: HistoricalExchangeRateSnapshot;
    settings: AppSettings;
  }
): Trade {
  const current = resolveTradeLifecycle(trade);
  if (current.status !== 'OPEN') {
    throw new Error('Hanya transaksi berstatus OPEN yang dapat ditutup menjadi CLOSED.');
  }

  const cleanExit = Number(params.actualExitPrice);
  if (!Number.isFinite(cleanExit) || cleanExit <= 0) {
    throw new Error('Harga Actual Exit harus berupa angka positif yang valid.');
  }

  const nowIso = new Date().toISOString();
  const effectiveExitTime = params.exitTime || nowIso;
  const activeEntry = current.actualEntry || trade.entryPrice;
  const activeLot = current.actualLot || trade.lotSize;

  const lotMetrics = calculateLotBasedOrderMetrics(
    {
      symbol: trade.instrument,
      position: trade.position,
      lotSize: activeLot,
      entryPrice: activeEntry,
      stopLossPrice: trade.stopLoss,
      takeProfitPrice: trade.takeProfit,
      exitPrice: cleanExit,
      capitalBasis: params.settings.startingBalance,
    },
    params.settings
  );

  const comm =
    params.commission !== undefined
      ? Math.abs(Number(params.commission) || 0)
      : Math.abs(Number(trade.commission) || 0);
  const swp =
    params.swap !== undefined ? Number(params.swap) || 0 : Number(trade.swap) || 0;

  const estimatedGross =
    lotMetrics.estimatedExitGrossProfit !== null ? lotMetrics.estimatedExitGrossProfit : 0;
  const finalNet =
    params.overrideNetProfit !== undefined && Number.isFinite(params.overrideNetProfit)
      ? Number(params.overrideNetProfit.toFixed(2))
      : computeNetFromGross(estimatedGross, comm, swp);
  const finalGross = Number((finalNet + comm - swp).toFixed(2));
  const finalOutcome = classifyNetProfitOutcome(finalNet);
  const computedR = computeRealizedRMultiple({
    netProfit: finalNet,
    riskAmount: trade.riskAmount,
  });

  const nextLog = [
    ...current.activityLog,
    createActivityEvent('POSITION_CLOSED', `Position Closed (${params.closeType})`, {
      timestamp: effectiveExitTime,
      previousValue: `Entry: ${activeEntry.toFixed(2)}`,
      newValue: `Exit: ${cleanExit.toFixed(2)} • Net P/L: ${finalNet >= 0 ? '+' : ''}${finalNet.toFixed(2)}`,
    }),
  ];

  const nextMeta: TradeLifecycleMeta = {
    status: 'CLOSED',
    orderType: current.orderType,
    plannedEntry: current.plannedEntry,
    plannedLot: current.plannedLot,
    plannedStopLoss: current.plannedStopLoss,
    plannedTakeProfit: current.plannedTakeProfit,
    plannedDateTime: current.plannedDateTime,
    actualEntry: activeEntry,
    actualLot: activeLot,
    actualExit: cleanExit,
    entryTime: current.entryTime || trade.dateTime,
    exitTime: effectiveExitTime,
    closeType: params.closeType,
    closeExchangeRate: params.closeExchangeRate || current.closeExchangeRate || trade.closeExchangeRate,
    beforeScreenshotUrl: current.beforeScreenshotUrl,
    afterScreenshotUrl: current.afterScreenshotUrl,
    activityLog: nextLog,
    mistakeTags: current.mistakeTags,
    emotionTag: current.emotionTag,
    accountId: current.accountId,
    playbookId: current.playbookId,
    checklistPassed: current.checklistPassed,
    ruleCompliant: current.ruleCompliant,
  };

  return {
    ...trade,
    exitPrice: cleanExit,
    commission: comm,
    swap: swp,
    grossProfit: finalGross,
    netProfit: finalNet,
    outcome: finalOutcome,
    rMultiple: computedR !== null ? computedR : undefined,
    closeExchangeRate: params.closeExchangeRate || current.closeExchangeRate || trade.closeExchangeRate,
    executionNotes: encodeLifecycleMetaIntoExecutionNotes(trade.executionNotes, nextMeta),
    updatedAt: nowIso,
  };
}

/**
 * Counts trades across the 4 lifecycle categories: Planned, Open, Closed, Cancelled.
 */
export function computeLifecycleSummaryCounts(trades: Trade[]): {
  planned: number;
  open: number;
  closed: number;
  cancelled: number;
  total: number;
} {
  let planned = 0;
  let open = 0;
  let closed = 0;
  let cancelled = 0;

  for (const t of trades || []) {
    const status = getTradeLifecycleStatus(t);
    if (status === 'PLANNED') planned++;
    else if (status === 'OPEN') open++;
    else if (status === 'CANCELLED') cancelled++;
    else closed++;
  }

  return {
    planned,
    open,
    closed,
    cancelled,
    total: (trades || []).length,
  };
}

export interface DateGroupedTradesSection {
  dateKey: string; // 'YYYY-MM-DD'
  headerLabel: string; // 'TODAY', 'YESTERDAY', or '15 OKT 2026'
  trades: Trade[];
}

const INDONESIAN_MONTHS_SHORT = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MEI',
  'JUN',
  'JUL',
  'AGT',
  'SEP',
  'OKT',
  'NOV',
  'DES',
];

/**
 * Formats a 'YYYY-MM-DD' date key into 'TODAY', 'YESTERDAY', or 'DD MMM YYYY' (e.g. '15 OKT 2026')
 * without mutating original trade timestamps.
 */
export function formatDateGroupHeader(
  dateKey: string,
  referenceDate: Date = new Date()
): string {
  const todayKey = formatLocalDateKey(referenceDate);
  const yesterdayObj = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() - 1
  );
  const yesterdayKey = formatLocalDateKey(yesterdayObj);

  if (dateKey === todayKey) return 'TODAY';
  if (dateKey === yesterdayKey) return 'YESTERDAY';

  const parts = dateKey.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const monthName = INDONESIAN_MONTHS_SHORT[monthIdx] || parts[1];
    if (!isNaN(day)) {
      return `${day} ${monthName} ${year}`;
    }
  }
  return dateKey;
}

/**
 * Groups an ordered list of trades by local calendar date ('YYYY-MM-DD').
 * Preserves the exact order of trades passed in and never mutates trade.dateTime.
 */
export function groupTradesByDate(
  trades: Trade[],
  referenceDate: Date = new Date()
): DateGroupedTradesSection[] {
  const sections: DateGroupedTradesSection[] = [];
  const mapByDate = new Map<string, DateGroupedTradesSection>();

  for (const trade of trades || []) {
    const dateKey = extractTradeLocalDateKey(trade.dateTime || '') || 'UNKNOWN';
    let section = mapByDate.get(dateKey);
    if (!section) {
      section = {
        dateKey,
        headerLabel: formatDateGroupHeader(dateKey, referenceDate),
        trades: [],
      };
      mapByDate.set(dateKey, section);
      sections.push(section);
    }
    section.trades.push(trade);
  }

  return sections;
}
