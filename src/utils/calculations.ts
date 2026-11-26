import { Trade, TradeOutcome } from '../types/trade';
import { AppSettings } from '../types/settings';

export interface PerformanceMetrics {
  isEmpty: boolean;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number; // percentage 0-100 (Wins / Total)
  winRateExcludingBE: number; // percentage 0-100 (Wins / (Wins + Losses))
  lossRate: number; // percentage 0-100 (Losses / Total)
  breakevenRate: number; // percentage 0-100 (BE / Total)
  totalNetProfit: number;
  totalGrossProfit: number;
  totalGrossLoss: number;
  totalCommission: number;
  totalSwap: number;
  profitFactor: number; // netWin / netLoss (or 999.99 / Infinity)
  isProfitFactorInfinite: boolean;
  currentEquity: number;
  startingBalance: number;
  totalGainCapital: number;
  totalGainPercent: number;
  hasValidGrowthPercent: boolean;
  averageWin: number;
  averageLoss: number;
  averageRiskReward: number;
  hasValidRiskReward: boolean;
  validRTradesCount: number;
  expectancy: number; // Expected value per trade in currency: totalNetProfit / totalTrades
  maxDrawdownAmount: number;
  maxDrawdownPercent: number;
  consecutiveWinsMax: number;
  consecutiveLossesMax: number;
  currentStreak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number };
  dailyLossToday: number;
  isDailyLossExceeded: boolean;
  isAccountInCriticalDrawdown: boolean;
}

export interface EquityPoint {
  index: number;
  date: string;
  tradeId: string;
  netProfit: number;
  equity: number;
  peak: number;
  drawdownAmount: number;
  drawdownPercent: number;
  growthPercent: number;
  peakGrowthPercent?: number;
  hasValidGrowthPercent?: boolean;
  outcome: string;
}

export interface DailyPerformance {
  date: string; // YYYY-MM-DD
  tradesCount: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  netProfit: number;
  winRate: number;
}

export interface MonthlyPerformance {
  monthKey: string; // YYYY-MM
  label: string; // e.g. "Okt 2026"
  tradesCount: number;
  netProfit: number;
  gainPercent: number;
  winRate: number;
}

export interface RadarIndicators {
  winRateScore: number; // 0 - 100
  profitFactorScore: number; // 0 - 100
  expectancyScore: number; // 0 - 100
  rewardRiskScore: number; // 0 - 100
  returnScore: number; // 0 - 100
  drawdownControlScore: number; // 0 - 100
  // Compatibility aliases
  riskControlScore: number;
  consistencyScore: number;
  disciplineScore: number;
  isDataSufficient: boolean; // true if totalTrades >= 3
  totalTrades: number;
}

/**
 * Format currency with correct symbol and locale, with optional privacy masking
 */
export function formatCurrency(
  amount: number,
  settings: AppSettings,
  isPrivacyMode: boolean = false
): string {
  if (isPrivacyMode) {
    const symbol = settings?.currencySymbol || '$';
    return `${symbol}••••••`;
  }

  if (isNaN(amount) || amount === null || amount === undefined) {
    return `${settings?.currencySymbol || '$'}0.00`;
  }

  if (settings?.currency === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: settings?.currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format profit factor safely, handling infinity or zero loss
 */
export function formatProfitFactor(pf: number, isInfinite: boolean = false): string {
  if (isInfinite || pf >= 999) return '∞';
  if (!Number.isFinite(pf) || pf <= 0) return '0.00';
  return pf.toFixed(2);
}

/**
 * Consistent formula: Net Profit = Gross Profit - |Commission| + Swap
 */
export function computeNetFromGross(
  grossProfit: number,
  commission: number = 0,
  swap: number = 0
): number {
  const gross = Number.isFinite(Number(grossProfit)) ? Number(grossProfit) : 0;
  const comm = Math.abs(Number.isFinite(Number(commission)) ? Number(commission) : 0);
  const swp = Number.isFinite(Number(swap)) ? Number(swap) : 0;
  return Number((gross - comm + swp).toFixed(2));
}

/**
 * Consistent inverse formula: Gross Profit = Net Profit + |Commission| - Swap
 */
export function computeGrossFromNet(
  netProfit: number,
  commission: number = 0,
  swap: number = 0
): number {
  const net = Number.isFinite(Number(netProfit)) ? Number(netProfit) : 0;
  const comm = Math.abs(Number.isFinite(Number(commission)) ? Number(commission) : 0);
  const swp = Number.isFinite(Number(swap)) ? Number(swap) : 0;
  return Number((net + comm - swp).toFixed(2));
}

/**
 * Compute the effective net profit of a trade taking into account gross profit, commission, and swap.
 */
export function computeTradeNetProfit(trade: Partial<Trade>): number {
  if (
    trade.netProfit !== undefined &&
    trade.netProfit !== null &&
    !isNaN(Number(trade.netProfit))
  ) {
    return Number(Number(trade.netProfit).toFixed(2));
  }
  if (
    trade.grossProfit !== undefined &&
    trade.grossProfit !== null &&
    !isNaN(Number(trade.grossProfit))
  ) {
    return computeNetFromGross(
      Number(trade.grossProfit),
      Number(trade.commission) || 0,
      Number(trade.swap) || 0
    );
  }
  return 0;
}

/**
 * Compute the effective gross profit of a trade without mixing net profit and gross profit.
 */
export function computeTradeGrossProfit(trade: Partial<Trade>): number {
  if (
    trade.grossProfit !== undefined &&
    trade.grossProfit !== null &&
    !isNaN(Number(trade.grossProfit))
  ) {
    return Number(Number(trade.grossProfit).toFixed(2));
  }
  if (
    trade.netProfit !== undefined &&
    trade.netProfit !== null &&
    !isNaN(Number(trade.netProfit))
  ) {
    return computeGrossFromNet(
      Number(trade.netProfit),
      Number(trade.commission) || 0,
      Number(trade.swap) || 0
    );
  }
  return 0;
}

/**
 * Centralized outcome classifier based on normalized Net Profit with a strict $0.01 threshold:
 * - Net Profit >= +$0.01 -> 'WIN'
 * - Net Profit <= -$0.01 -> 'LOSS'
 * - -$0.01 < Net Profit < +$0.01 -> 'BREAKEVEN'
 */
export function classifyNetProfitOutcome(netProfit: number): TradeOutcome {
  if (!Number.isFinite(netProfit)) return 'BREAKEVEN';
  const rounded = Number(netProfit.toFixed(2));
  if (rounded >= 0.01) return 'WIN';
  if (rounded <= -0.01) return 'LOSS';
  return 'BREAKEVEN';
}

/**
 * Resolves the authoritative outcome of a trade based on its normalized Net Profit.
 * Falls back to normalized outcome label only if both netProfit and grossProfit are absent.
 */
export function resolveTradeOutcome(trade: Partial<Trade>): TradeOutcome {
  const hasNet =
    trade.netProfit !== undefined &&
    trade.netProfit !== null &&
    !isNaN(Number(trade.netProfit));
  const hasGross =
    trade.grossProfit !== undefined &&
    trade.grossProfit !== null &&
    !isNaN(Number(trade.grossProfit));

  if (hasNet || hasGross) {
    return classifyNetProfitOutcome(computeTradeNetProfit(trade));
  }

  const raw = String(trade.outcome || '').trim().toUpperCase();
  if (raw === 'WIN') return 'WIN';
  if (raw === 'LOSS') return 'LOSS';
  return 'BREAKEVEN';
}

/**
 * Checks whether a trade has a CLOSED lifecycle status for realized performance metrics.
 * Legacy trades without [TV_META:...] are CLOSED.
 * PLANNED, OPEN, and CANCELLED trades are strictly excluded from realized P/L, Win Rate, and Profit Factor.
 */
export function isClosedLifecycleTrade(trade: Partial<Trade>): boolean {
  const execNotes = trade?.executionNotes;
  if (!execNotes || typeof execNotes !== 'string') return true;
  const match = execNotes.match(/\[TV_META:([A-Za-z0-9_-]+)\]\s*$/);
  if (!match || !match[1]) return true;
  try {
    let base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad === 2) base64 += '==';
    else if (pad === 3) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const jsonStr = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(jsonStr);
    if (
      parsed &&
      (parsed.status === 'PLANNED' ||
        parsed.status === 'OPEN' ||
        parsed.status === 'CANCELLED')
    ) {
      return false;
    }
  } catch {
    // Fallback to CLOSED on malformed tag
  }
  return true;
}

/**
 * Computes Planned Risk:Reward ratio strictly from Entry, Stop Loss, and Take Profit prices.
 * Formula: abs(Take Profit - Entry) / abs(Entry - Stop Loss)
 * Returns null if any price is missing/invalid, if SL distance is zero, or if SL/TP direction is invalid for position.
 * Never uses realized trade P/L or outcome as a substitute for Planned RR.
 */
export function computePlannedRiskReward(
  entryPrice?: number | null,
  stopLoss?: number | null,
  takeProfit?: number | null,
  position?: 'BUY' | 'SELL'
): number | null {
  const entry = Number(entryPrice);
  const sl = Number(stopLoss);
  const tp = Number(takeProfit);

  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(sl) ||
    !Number.isFinite(tp) ||
    entry <= 0 ||
    sl <= 0 ||
    tp <= 0
  ) {
    return null;
  }

  if (position === 'BUY') {
    if (sl >= entry || tp <= entry) return null;
  } else if (position === 'SELL') {
    if (sl <= entry || tp >= entry) return null;
  }

  const riskDistance = Math.abs(entry - sl);
  const rewardDistance = Math.abs(tp - entry);

  if (riskDistance <= 0.0001 || rewardDistance <= 0) {
    return null;
  }

  const ratio = rewardDistance / riskDistance;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }

  return Number(ratio.toFixed(2));
}

function resolveFallbackPipSpec(
  symbolRaw?: string,
  settings?: Partial<AppSettings>
): { pipSize: number; pipValuePerStandardLot: number } {
  const cleanSymbol = (symbolRaw || 'XAUUSD').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (
    cleanSymbol.startsWith('EURUSD') ||
    cleanSymbol.startsWith('GBPUSD') ||
    cleanSymbol.startsWith('AUDUSD') ||
    cleanSymbol.startsWith('NZDUSD') ||
    cleanSymbol.startsWith('USDCAD') ||
    cleanSymbol.startsWith('USDCHF')
  ) {
    return { pipSize: 0.0001, pipValuePerStandardLot: 10.0 };
  }
  if (cleanSymbol.startsWith('USDJPY') || cleanSymbol.endsWith('JPY')) {
    return { pipSize: 0.01, pipValuePerStandardLot: 10.0 };
  }
  if (cleanSymbol.startsWith('BTC')) {
    return { pipSize: 1.0, pipValuePerStandardLot: 1.0 };
  }
  if (cleanSymbol.startsWith('US30') || cleanSymbol.startsWith('NAS100')) {
    return { pipSize: 1.0, pipValuePerStandardLot: 10.0 };
  }

  const pipSize =
    typeof settings?.xauusdPipSize === 'number' &&
    Number.isFinite(settings.xauusdPipSize) &&
    settings.xauusdPipSize > 0
      ? settings.xauusdPipSize
      : 0.1;
  const contractSize =
    typeof settings?.xauusdContractSize === 'number' &&
    Number.isFinite(settings.xauusdContractSize) &&
    settings.xauusdContractSize > 0
      ? settings.xauusdContractSize
      : 100;
  const pipVal001 =
    typeof settings?.xauusdPipValuePer001Lot === 'number' &&
    Number.isFinite(settings.xauusdPipValuePer001Lot) &&
    settings.xauusdPipValuePer001Lot > 0
      ? settings.xauusdPipValuePer001Lot
      : 0.1;
  const pipValuePerStandardLot = Number((pipVal001 * contractSize).toFixed(4));
  return { pipSize, pipValuePerStandardLot };
}

/**
 * Derives monetary Risk Amount honestly from Entry Price, Stop Loss, Lot Size, and Position
 * when a trade has valid SL geometry but stored riskAmount is 0/missing (e.g. older scanned trades).
 * Returns null if SL is absent, non-positive, or directionally invalid.
 */
export function deriveHonestRiskAmountFromTrade(
  trade: Partial<Trade>,
  settings?: Partial<AppSettings>
): number | null {
  const entry = Number(trade.entryPrice);
  const sl = Number(trade.stopLoss);
  const lot = Number(trade.lotSize);

  if (
    !Number.isFinite(entry) ||
    entry <= 0 ||
    !Number.isFinite(sl) ||
    sl <= 0 ||
    !Number.isFinite(lot) ||
    lot <= 0
  ) {
    return null;
  }

  const pos = String(trade.position || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  if (pos === 'BUY' && sl >= entry) {
    return null;
  }
  if (pos === 'SELL' && sl <= entry) {
    return null;
  }

  const { pipSize, pipValuePerStandardLot } = resolveFallbackPipSpec(trade.instrument, settings);
  if (!(pipSize > 0) || !(pipValuePerStandardLot > 0)) {
    return null;
  }

  const slDistancePrice = Math.abs(entry - sl);
  const slDistancePips = slDistancePrice / pipSize;
  const derivedRisk = Number((slDistancePips * lot * pipValuePerStandardLot).toFixed(2));
  return Number.isFinite(derivedRisk) && derivedRisk > 0 ? derivedRisk : null;
}

/**
 * Computes Realized R-Multiple for a closed trade.
 * 1. If a valid positive riskAmount (> 0) is available, computes Net Profit / riskAmount.
 *    Losing trades remain negative (e.g. -1R), winning trades positive (+2R), breakeven 0R.
 * 2. If riskAmount is unavailable, falls back to stored trade.rMultiple ONLY after validating
 *    finite numeric value and sign consistency with Net Profit.
 * 3. If both riskAmount and rMultiple are unavailable, honestly derives risk from
 *    valid (entryPrice, stopLoss, lotSize, position) when present.
 * 4. Returns null if no valid R-Multiple can be determined (displayed as N/A).
 */
export function computeRealizedRMultiple(
  trade: Partial<Trade>,
  settings?: Partial<AppSettings>
): number | null {
  const net = computeTradeNetProfit(trade);
  const risk = Number(trade.riskAmount);

  if (
    trade.riskAmount !== undefined &&
    trade.riskAmount !== null &&
    Number.isFinite(risk) &&
    risk > 0
  ) {
    if (Math.abs(net) < 0.01) {
      return 0;
    }
    const r = net / risk;
    return Number.isFinite(r) ? Number(r.toFixed(2)) : null;
  }

  if (trade.rMultiple !== undefined && trade.rMultiple !== null) {
    const storedR = Number(trade.rMultiple);
    if (Number.isFinite(storedR)) {
      if (Math.abs(net) < 0.01) {
        return 0;
      }
      // Enforce sign consistency with realized Net Profit (protects against legacy Math.abs bugs)
      if (storedR !== 0) {
        if (net <= -0.01 && storedR > 0) {
          return Number((-Math.abs(storedR)).toFixed(2));
        }
        if (net >= 0.01 && storedR < 0) {
          return Number(Math.abs(storedR).toFixed(2));
        }
        return Number(storedR.toFixed(2));
      }
    }
  }

  const derivedRisk = deriveHonestRiskAmountFromTrade(trade, settings);
  if (derivedRisk !== null && derivedRisk > 0) {
    if (Math.abs(net) < 0.01) {
      return 0;
    }
    const r = net / derivedRisk;
    return Number.isFinite(r) ? Number(r.toFixed(2)) : null;
  }

  return null;
}

/**
 * Formats a Realized R-Multiple or Average R value for display.
 * Positive values get a '+' prefix (e.g., '+2R', '+0.5R'), negative values keep '-' (e.g., '-1R', '-1.33R'),
 * zero formats as '0R', and unavailable/null values format as 'N/A'.
 */
export function formatRMultiple(
  rValue: number | null | undefined,
  isAvailable: boolean = true
): string {
  if (!isAvailable || rValue === null || rValue === undefined || !Number.isFinite(rValue)) {
    return 'N/A';
  }
  const rounded = Number(rValue.toFixed(2));
  if (Object.is(rounded, -0) || rounded === 0) {
    return '0R';
  }
  return rounded > 0 ? `+${rounded}R` : `${rounded}R`;
}

/**
 * Formats a Planned Risk:Reward ratio as '1 : X' or 'N/A' if unavailable.
 */
export function formatPlannedRR(plannedRR: number | null | undefined): string {
  if (
    plannedRR === null ||
    plannedRR === undefined ||
    !Number.isFinite(plannedRR) ||
    plannedRR <= 0
  ) {
    return 'N/A';
  }
  return `1 : ${Number(plannedRR.toFixed(2))}`;
}

/**
 * Formats a growth percentage safely.
 * Returns 'N/A' when starting balance is non-positive (isValid === false) or value is non-finite.
 */
export function formatGrowthPercent(
  percent: number | null | undefined,
  isValid: boolean = true,
  decimals: number = 2
): string {
  if (!isValid || percent === null || percent === undefined || !Number.isFinite(percent)) {
    return 'N/A';
  }
  const rounded = Number(percent.toFixed(decimals));
  if (Object.is(rounded, -0) || rounded === 0) {
    return `+${(0).toFixed(decimals)}%`;
  }
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(decimals)}%`;
}

export type DashboardPeriodPreset = '1D' | '7D' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const DASHBOARD_PERIOD_OPTIONS: ReadonlyArray<{
  id: DashboardPeriodPreset;
  label: string;
}> = [
  { id: '1D', label: '1 Hari' },
  { id: '7D', label: '7 Hari' },
  { id: '1M', label: '1 Bulan' },
  { id: '3M', label: '3 Bulan' },
  { id: '6M', label: '6 Bulan' },
  { id: '1Y', label: '1 Tahun' },
  { id: 'ALL', label: 'Semua Waktu' },
];

/**
 * Resolves local calendar startDate and endDate ('YYYY-MM-DD') for the 7 Dashboard period presets.
 */
export function resolveDashboardPeriodDates(
  period: DashboardPeriodPreset,
  referenceDate: Date = new Date()
): { startDate: string; endDate: string } {
  if (period === 'ALL') {
    return { startDate: '', endDate: '' };
  }
  const endDate = formatLocalDateKey(referenceDate);
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth();
  const d = referenceDate.getDate();

  let startObj: Date;
  switch (period) {
    case '1D':
      startObj = new Date(y, m, d - 1);
      break;
    case '7D':
      startObj = new Date(y, m, d - 7);
      break;
    case '1M':
      startObj = new Date(y, m - 1, d);
      break;
    case '3M':
      startObj = new Date(y, m - 3, d);
      break;
    case '6M':
      startObj = new Date(y, m - 6, d);
      break;
    case '1Y':
      startObj = new Date(y - 1, m, d);
      break;
    default:
      return { startDate: '', endDate: '' };
  }

  return {
    startDate: formatLocalDateKey(startObj),
    endDate,
  };
}

/**
 * Computes filtered trades for a date period and the true period starting balance
 * (account startingBalance + cumulative net profit of all trades prior to startDate)
 * without artificial clamping such as Math.max(1, ...).
 */
export function computePeriodTradesAndStartingBalance(
  trades: Trade[],
  settings: AppSettings,
  startDate: string = '',
  endDate: string = ''
): {
  filteredTrades: Trade[];
  periodStartingBalance: number;
  hasValidGrowthPercent: boolean;
} {
  const rawBase = Number(settings?.startingBalance);
  const accountStartingBalance = Number.isFinite(rawBase) ? rawBase : 10000;

  const closedTrades = (trades || []).filter((t) => isClosedLifecycleTrade(t));

  if (closedTrades.length === 0) {
    const bal = Number(accountStartingBalance.toFixed(2));
    return {
      filteredTrades: [],
      periodStartingBalance: bal,
      hasValidGrowthPercent: bal > 0,
    };
  }

  const sorted = [...closedTrades].sort((a, b) => {
    const diff = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    if (diff !== 0) return diff;
    return (a.id || '').localeCompare(b.id || '');
  });

  if (!startDate && !endDate) {
    const bal = Number(accountStartingBalance.toFixed(2));
    return {
      filteredTrades: sorted,
      periodStartingBalance: bal,
      hasValidGrowthPercent: bal > 0,
    };
  }

  const filtered: Trade[] = [];
  let cumulativeBeforePeriod = 0;

  sorted.forEach((t) => {
    const tradeDate = extractTradeLocalDateKey(t.dateTime);
    if (startDate && tradeDate < startDate) {
      cumulativeBeforePeriod += computeTradeNetProfit(t);
    } else if (endDate && tradeDate > endDate) {
      // After period
    } else {
      filtered.push(t);
    }
  });

  const startingBalanceForPeriod = Number((accountStartingBalance + cumulativeBeforePeriod).toFixed(2));
  return {
    filteredTrades: filtered,
    periodStartingBalance: startingBalanceForPeriod,
    hasValidGrowthPercent: startingBalanceForPeriod > 0,
  };
}

/**
 * Computes consistent Equity Curve and High Watermark (Peak) series for EquityChart
 * using the single authoritative starting balance of the rendered curve/period.
 */
export function computeEquityChartSeries(
  equityCurve: EquityPoint[],
  settings: AppSettings,
  viewMode: 'equity' | 'growth' = 'equity',
  explicitStartingBalance?: number
): {
  chartStartingBalance: number;
  hasValidGrowth: boolean;
  values: number[];
  peakValues: number[];
} {
  const rawExplicit =
    explicitStartingBalance !== undefined && explicitStartingBalance !== null
      ? Number(explicitStartingBalance)
      : NaN;
  const rawSettingsBal = Number(settings?.startingBalance);
  const fallbackBal = Number.isFinite(rawSettingsBal) ? rawSettingsBal : 10000;

  const chartStartingBalance = Number.isFinite(rawExplicit)
    ? Number(rawExplicit.toFixed(2))
    : equityCurve && equityCurve.length > 0 && Number.isFinite(equityCurve[0].equity)
    ? Number(equityCurve[0].equity.toFixed(2))
    : Number(fallbackBal.toFixed(2));

  const hasValidGrowth = chartStartingBalance > 0;

  const values = (equityCurve || []).map((pt, idx) => {
    if (viewMode === 'equity') {
      return pt.equity;
    }
    if (!hasValidGrowth) {
      return 0;
    }
    if (idx === 0 && Math.abs(pt.equity - chartStartingBalance) < 0.01) {
      return 0;
    }
    const rawPct = ((pt.equity - chartStartingBalance) / chartStartingBalance) * 100;
    if (!Number.isFinite(rawPct)) return 0;
    const rounded = Number(rawPct.toFixed(2));
    return Object.is(rounded, -0) ? 0 : rounded;
  });

  const peakValues = (equityCurve || []).map((pt, idx) => {
    if (viewMode === 'equity') {
      return pt.peak;
    }
    if (!hasValidGrowth) {
      return 0;
    }
    if (idx === 0 && Math.abs(pt.peak - chartStartingBalance) < 0.01) {
      return 0;
    }
    const rawPeakPct = ((pt.peak - chartStartingBalance) / chartStartingBalance) * 100;
    if (!Number.isFinite(rawPeakPct)) return 0;
    const rounded = Number(rawPeakPct.toFixed(2));
    return Object.is(rounded, -0) ? 0 : rounded;
  });

  return {
    chartStartingBalance,
    hasValidGrowth,
    values,
    peakValues,
  };
}

/**
 * Computes Y-axis bounds and 5 grid tick values for EquityChart.
 * - In 'equity' (Nominal $) mode: preserves existing 5% bottom / 8% top buffer.
 * - In 'growth' (Persen %) mode: anchors 0% accurately without subtracting a negative
 *   buffer below 0% when all points are >= 0% (preventing misleading negative Y-axis ticks
 *   such as -11.1% at Trade #0), and guarantees an explicit 0% tick line.
 */
export function computeEquityChartAxis(
  values: number[],
  peakValues: number[],
  viewMode: 'equity' | 'growth'
): {
  minValue: number;
  maxValue: number;
  tickValues: number[];
} {
  const allValues = [...values, ...peakValues];
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;

  if (viewMode === 'equity') {
    const minVal = values.length > 0 ? Math.min(...values) : 0;
    const maxVal = allValues.length > 0 ? Math.max(...allValues) : 100;
    const range = maxVal - minVal || 100;
    const minValue = minVal - range * 0.05;
    const maxValue = maxVal + range * 0.08;
    const tickValues = [0, 0.25, 0.5, 0.75, 1].map(
      (ratio) => minValue + (maxValue - minValue) * ratio
    );
    return { minValue, maxValue, tickValues };
  }

  // viewMode === 'growth'
  let minValue = rawMin;
  let maxValue = rawMax;

  if (rawMin >= 0 && rawMax > 0) {
    minValue = 0;
    maxValue = rawMax;
  } else if (rawMin < 0 && rawMax <= 0) {
    minValue = rawMin;
    maxValue = 0;
  } else if (rawMin === 0 && rawMax === 0) {
    minValue = 0;
    maxValue = 10;
  } else {
    minValue = rawMin;
    maxValue = rawMax;
  }

  const span = maxValue - minValue || 10;
  const tickValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const v = Number((minValue + span * ratio).toFixed(2));
    return Object.is(v, -0) ? 0 : v;
  });

  if (minValue < 0 && maxValue > 0 && !tickValues.some((v) => Math.abs(v) < 0.01)) {
    let closestIdx = 1;
    let minDist = Math.abs(tickValues[1]);
    for (let i = 2; i <= 3; i++) {
      const dist = Math.abs(tickValues[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    tickValues[closestIdx] = 0;
  }

  return { minValue, maxValue, tickValues };
}

/**
 * Formats a Date object as a local calendar date key 'YYYY-MM-DD'
 * (consistent with 'YYYY-MM-DDTHH:mm' local trade dateTime values).
 * Optional timezoneOffsetMinutes (e.g. +420 for WIB UTC+7) allows deterministic
 * testing across timezones regardless of the host runner's system timezone.
 */
export function formatLocalDateKey(
  date: Date = new Date(),
  timezoneOffsetMinutes?: number
): string {
  if (typeof timezoneOffsetMinutes === 'number' && Number.isFinite(timezoneOffsetMinutes)) {
    const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60_000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extracts the local calendar date ('YYYY-MM-DD') from a trade's dateTime string.
 * - For normalized local strings ('YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD') without timezone offset,
 *   returns the date prefix directly.
 * - For ISO strings with explicit timezone suffix ('Z' or '±HH:mm'), converts to the local
 *   calendar date first so midnight/early-morning WIB trades never shift to the wrong UTC day.
 */
export function extractTradeLocalDateKey(
  dateTimeStr: string,
  timezoneOffsetMinutes?: number
): string {
  if (!dateTimeStr || typeof dateTimeStr !== 'string') return '';
  const trimmed = dateTimeStr.trim();
  if (!trimmed) return '';

  const localPattern = /^(\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;
  const localMatch = trimmed.match(localPattern);
  if (localMatch) {
    return localMatch[1];
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return formatLocalDateKey(parsed, timezoneOffsetMinutes);
  }
  return trimmed.slice(0, 10);
}

/**
 * Formats a Date or timestamp string into local "YYYY-MM-DDTHH:mm" format
 * required by <input type="datetime-local" /> without shifting local date-time strings.
 */
export function normalizeTradeDateTimeLocal(rawDate: unknown): string {
  if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    const year = rawDate.getFullYear();
    const month = String(rawDate.getMonth() + 1).padStart(2, '0');
    const day = String(rawDate.getDate()).padStart(2, '0');
    const hours = String(rawDate.getHours()).padStart(2, '0');
    const minutes = String(rawDate.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
  if (typeof rawDate === 'string') {
    const clean = rawDate.trim();
    const localMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (localMatch && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(clean)) {
      return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}T${localMatch[4]}:${localMatch[5]}`;
    }
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      const hours = String(parsed.getHours()).padStart(2, '0');
      const minutes = String(parsed.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}


/**
 * Computes dailyLossToday for trades occurring on the local calendar date of referenceDate.
 * Compares local 'YYYY-MM-DD' instead of UTC toISOString().slice(0, 10).
 */
export function computeDailyLossForLocalDate(
  trades: Trade[],
  referenceDate: Date = new Date(),
  timezoneOffsetMinutes?: number
): number {
  const todayStr = formatLocalDateKey(referenceDate, timezoneOffsetMinutes);
  const todayTrades = (trades || []).filter(
    (t) =>
      isClosedLifecycleTrade(t) &&
      extractTradeLocalDateKey(t.dateTime || '', timezoneOffsetMinutes) === todayStr
  );
  const todayNet = todayTrades.reduce((acc, t) => acc + computeTradeNetProfit(t), 0);
  return todayNet < 0 ? Number(Math.abs(todayNet).toFixed(2)) : 0;
}

/**
 * Resolves the active calendar month ('YYYY-MM') given the current selectedMonth and availableMonths:
 * - Preserves `selectedMonth` when it exists inside `availableMonths` (preserving manual Prev/Next navigation).
 * - Automatically switches to the latest month in `availableMonths` when a period filter change removes
 *   `selectedMonth` from `availableMonths`.
 */
export function resolveActiveCalendarMonth(
  selectedMonth: string,
  availableMonths: string[],
  fallbackDate: Date = new Date()
): string {
  const currentRuntimeMonth = formatLocalDateKey(fallbackDate).slice(0, 7);
  if (!selectedMonth || !selectedMonth.trim()) {
    return currentRuntimeMonth;
  }
  if (Array.isArray(availableMonths) && availableMonths.length > 0) {
    if (availableMonths.includes(selectedMonth)) {
      return selectedMonth;
    }
    return availableMonths[availableMonths.length - 1];
  }
  return currentRuntimeMonth;
}

/**
 * Pure Financial Calculation Engine
 * Strictly connects all metrics to the Trades collection without static figures or NaN errors.
 */
export function calculatePerformance(
  trades: Trade[],
  settings: AppSettings,
  referenceDate: Date = new Date(),
  timezoneOffsetMinutes?: number
): {
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  dailyPerformance: DailyPerformance[];
  monthlyPerformance: MonthlyPerformance[];
  radarIndicators: RadarIndicators;
} {
  const rawStartingBalance = Number(settings?.startingBalance);
  const startingBalance = Number(
    (Number.isFinite(rawStartingBalance) ? rawStartingBalance : 10000).toFixed(2)
  );
  const hasValidGrowthPercent = startingBalance > 0;

  const closedTrades = (trades || []).filter((t) => isClosedLifecycleTrade(t));

  // If closedTrades array is empty, return clear empty state representation
  if (closedTrades.length === 0) {
    const emptyMetrics: PerformanceMetrics = {
      isEmpty: true,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: 0,
      winRateExcludingBE: 0,
      lossRate: 0,
      breakevenRate: 0,
      totalNetProfit: 0,
      totalGrossProfit: 0,
      totalGrossLoss: 0,
      totalCommission: 0,
      totalSwap: 0,
      profitFactor: 0,
      isProfitFactorInfinite: false,
      currentEquity: startingBalance,
      startingBalance,
      totalGainCapital: 0,
      totalGainPercent: 0,
      hasValidGrowthPercent,
      averageWin: 0,
      averageLoss: 0,
      averageRiskReward: 0,
      hasValidRiskReward: false,
      validRTradesCount: 0,
      expectancy: 0,
      maxDrawdownAmount: 0,
      maxDrawdownPercent: 0,
      consecutiveWinsMax: 0,
      consecutiveLossesMax: 0,
      currentStreak: { type: 'NONE', count: 0 },
      dailyLossToday: 0,
      isDailyLossExceeded: false,
      isAccountInCriticalDrawdown: startingBalance <= 0,
    };

    const emptyEquityPoint: EquityPoint = {
      index: 0,
      date: new Date().toISOString(),
      tradeId: 'START',
      netProfit: 0,
      equity: startingBalance,
      peak: startingBalance,
      drawdownAmount: 0,
      drawdownPercent: 0,
      growthPercent: 0,
      peakGrowthPercent: 0,
      hasValidGrowthPercent,
      outcome: 'START',
    };

    return {
      metrics: emptyMetrics,
      equityCurve: [emptyEquityPoint],
      dailyPerformance: [],
      monthlyPerformance: [],
      radarIndicators: {
        winRateScore: 0,
        profitFactorScore: 0,
        expectancyScore: 0,
        rewardRiskScore: 0,
        returnScore: 0,
        drawdownControlScore: 0,
        riskControlScore: 0,
        consistencyScore: 0,
        disciplineScore: 0,
        isDataSufficient: false,
        totalTrades: 0,
      },
    };
  }

  // Sort trades chronologically to accurately track peak and drawdown series
  // Deterministic secondary sort on ID ensures identical timestamps produce consistent ordering
  const sortedTrades = [...closedTrades].sort((a, b) => {
    const diff = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    if (diff !== 0) return diff;
    return (a.id || '').localeCompare(b.id || '');
  });

  const totalTrades = sortedTrades.length;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;

  let totalGrossProfit = 0;
  let totalGrossLoss = 0;
  let totalNetWin = 0;
  let totalNetLoss = 0;
  let totalCommission = 0;
  let totalSwap = 0;
  let totalNetProfit = 0;

  let sumRR = 0;
  let countWithRR = 0;
  let totalDisciplineRating = 0;
  let countWithDiscipline = 0;

  let currentStreakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
  let currentStreakCount = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  sortedTrades.forEach((t) => {
    const net = computeTradeNetProfit(t);
    const gross = computeTradeGrossProfit(t);
    totalNetProfit += net;
    totalCommission += Math.abs(t.commission || 0);
    totalSwap += t.swap || 0;

    // Separate pure Gross Profit and Gross Loss from Net Profit/Loss
    if (gross > 0) {
      totalGrossProfit += gross;
    } else if (gross < 0) {
      totalGrossLoss += Math.abs(gross);
    }

    // Determine outcome categorization strictly from normalized Net Profit ($0.01 threshold)
    const outcomeType = resolveTradeOutcome(t);

    if (outcomeType === 'WIN') {
      winningTrades++;
      totalNetWin += Math.max(0, net);

      if (currentStreakType === 'WIN') {
        currentStreakCount++;
      } else {
        currentStreakType = 'WIN';
        currentStreakCount = 1;
      }
      maxWinStreak = Math.max(maxWinStreak, currentStreakCount);
    } else if (outcomeType === 'LOSS') {
      losingTrades++;
      totalNetLoss += Math.abs(Math.min(0, net));

      if (currentStreakType === 'LOSS') {
        currentStreakCount++;
      } else {
        currentStreakType = 'LOSS';
        currentStreakCount = 1;
      }
      maxLossStreak = Math.max(maxLossStreak, currentStreakCount);
    } else {
      breakevenTrades++;
      currentStreakType = 'NONE';
      currentStreakCount = 0;
    }

    // Realized R-Multiple calculation (prioritizes riskAmount > 0, then stored rMultiple, then valid SL geometry)
    const realizedR = computeRealizedRMultiple(t, settings);
    if (realizedR !== null) {
      sumRR += realizedR;
      countWithRR++;
    }

    if (t.disciplineRating && t.disciplineRating > 0) {
      totalDisciplineRating += t.disciplineRating;
      countWithDiscipline++;
    }
  });

  // Rates calculation with strict division by zero guard
  const winRate = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(2)) : 0;
  const lossRate = totalTrades > 0 ? Number(((losingTrades / totalTrades) * 100).toFixed(2)) : 0;
  const breakevenRate = totalTrades > 0 ? Number(((breakevenTrades / totalTrades) * 100).toFixed(2)) : 0;
  const decisiveTrades = winningTrades + losingTrades;
  const winRateExcludingBE = decisiveTrades > 0 ? Number(((winningTrades / decisiveTrades) * 100).toFixed(2)) : 0;

  // Profit Factor calculation using actual Net Profit of winning trades / |Net Loss of losing trades|
  let profitFactor = 0;
  let isProfitFactorInfinite = false;
  if (totalNetLoss > 0) {
    profitFactor = Number((totalNetWin / totalNetLoss).toFixed(2));
  } else if (totalNetWin > 0) {
    profitFactor = 999.99;
    isProfitFactorInfinite = true;
  } else {
    profitFactor = 0;
  }

  const currentEquity = startingBalance + totalNetProfit;
  const totalGainCapital = totalNetProfit;
  const totalGainPercent = hasValidGrowthPercent
    ? Number(((totalNetProfit / startingBalance) * 100).toFixed(2))
    : 0;

  const averageWin = winningTrades > 0 ? Number((totalNetWin / winningTrades).toFixed(2)) : 0;
  const averageLoss = losingTrades > 0 ? Number((totalNetLoss / losingTrades).toFixed(2)) : 0;
  const hasValidRiskReward = countWithRR > 0;
  const averageRiskReward = hasValidRiskReward ? Number((sumRR / countWithRR).toFixed(2)) : 0;

  // Expectancy (Mathematical Expected Value per trade):
  // Formula: Total Net Profit / Total Trades
  const expectancy = totalTrades > 0 ? Number((totalNetProfit / totalTrades).toFixed(2)) : 0;

  // Build Equity Curve and Drawdown series starting from baseline
  const equityCurve: EquityPoint[] = [];
  let runningEquity = startingBalance;
  let runningPeak = startingBalance;
  let maxDrawdownAmount = 0;
  let maxDrawdownPercent = 0;

  // Step 0: Baseline Point
  const firstDate = sortedTrades.length > 0 ? sortedTrades[0].dateTime : new Date().toISOString();
  equityCurve.push({
    index: 0,
    date: firstDate,
    tradeId: 'START',
    netProfit: 0,
    equity: Number(startingBalance.toFixed(2)),
    peak: Number(startingBalance.toFixed(2)),
    drawdownAmount: 0,
    drawdownPercent: 0,
    growthPercent: 0,
    peakGrowthPercent: 0,
    hasValidGrowthPercent,
    outcome: 'START',
  });

  sortedTrades.forEach((t, i) => {
    const net = computeTradeNetProfit(t);
    runningEquity += net;

    // Peak is highest equity achieved up to this point
    if (runningEquity > runningPeak) {
      runningPeak = runningEquity;
    }

    // Drawdown calculation with safe zero / negative equity protection
    const currentDdAmount = Math.max(0, runningPeak - runningEquity);
    let currentDdPercent = 0;
    if (runningPeak > 0) {
      currentDdPercent = (currentDdAmount / runningPeak) * 100;
    } else {
      currentDdPercent = currentDdAmount > 0 ? 100 : 0;
    }

    if (currentDdAmount > maxDrawdownAmount) {
      maxDrawdownAmount = currentDdAmount;
    }
    if (currentDdPercent > maxDrawdownPercent) {
      maxDrawdownPercent = currentDdPercent;
    }

    const growthPercent = hasValidGrowthPercent
      ? ((runningEquity - startingBalance) / startingBalance) * 100
      : 0;
    const peakGrowthPercent = hasValidGrowthPercent
      ? ((runningPeak - startingBalance) / startingBalance) * 100
      : 0;

    equityCurve.push({
      index: i + 1,
      date: t.dateTime,
      tradeId: t.id,
      netProfit: Number(net.toFixed(2)),
      equity: Number(runningEquity.toFixed(2)),
      peak: Number(runningPeak.toFixed(2)),
      drawdownAmount: Number(currentDdAmount.toFixed(2)),
      drawdownPercent: Number(currentDdPercent.toFixed(2)),
      growthPercent: Number(growthPercent.toFixed(2)),
      peakGrowthPercent: Number(peakGrowthPercent.toFixed(2)),
      hasValidGrowthPercent,
      outcome: resolveTradeOutcome(t),
    });
  });

  // Calculate Daily Performance (only for days with closed trades - non-trading days are not loss days)
  const dailyMap: { [dateStr: string]: { trades: Trade[]; netProfit: number } } = {};
  sortedTrades.forEach((t) => {
    const dayKey = (t.dateTime || '').slice(0, 10);
    if (!dayKey) return;
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = { trades: [], netProfit: 0 };
    }
    const net = computeTradeNetProfit(t);
    dailyMap[dayKey].trades.push(t);
    dailyMap[dayKey].netProfit += net;
  });

  const dailyPerformance: DailyPerformance[] = Object.keys(dailyMap)
    .sort()
    .map((dayKey) => {
      const dayTrades = dailyMap[dayKey].trades;
      const dayWins = dayTrades.filter((t) => resolveTradeOutcome(t) === 'WIN').length;
      const dayLoss = dayTrades.filter((t) => resolveTradeOutcome(t) === 'LOSS').length;
      const dayBe = dayTrades.filter((t) => resolveTradeOutcome(t) === 'BREAKEVEN').length;
      return {
        date: dayKey,
        tradesCount: dayTrades.length,
        winningTrades: dayWins,
        losingTrades: dayLoss,
        breakevenTrades: dayBe,
        netProfit: Number(dailyMap[dayKey].netProfit.toFixed(2)),
        winRate: dayTrades.length > 0 ? Number(((dayWins / dayTrades.length) * 100).toFixed(1)) : 0,
      };
    });

  // Daily Loss Today tracking (strictly based on local calendar date 'YYYY-MM-DD', not UTC)
  const dailyLossToday = computeDailyLossForLocalDate(
    sortedTrades,
    referenceDate,
    timezoneOffsetMinutes
  );
  const isDailyLossExceeded =
    dailyLossToday >= (settings?.maxDailyLossAmount || 300) ||
    (startingBalance > 0 && (dailyLossToday / startingBalance) * 100 >= (settings?.maxDailyLossPercent || 3.0));

  const isAccountInCriticalDrawdown = currentEquity <= 0 || maxDrawdownPercent >= 100;

  // Monthly performance
  const monthMap: { [monthStr: string]: { trades: Trade[]; netProfit: number } } = {};
  sortedTrades.forEach((t) => {
    const monthKey = (t.dateTime || '').slice(0, 7);
    if (!monthKey) return;
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = { trades: [], netProfit: 0 };
    }
    monthMap[monthKey].trades.push(t);
    monthMap[monthKey].netProfit += computeTradeNetProfit(t);
  });

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'
  ];

  const monthlyPerformance: MonthlyPerformance[] = Object.keys(monthMap)
    .sort()
    .map((monthKey) => {
      const [year, monthNum] = monthKey.split('-');
      const label = `${monthNames[parseInt(monthNum, 10) - 1] || monthKey} ${year || ''}`.trim();
      const mTrades = monthMap[monthKey].trades;
      const mWins = mTrades.filter((t) => resolveTradeOutcome(t) === 'WIN').length;
      const net = monthMap[monthKey].netProfit;
      const gainPercent = startingBalance > 0 ? (net / startingBalance) * 100 : 0;
      return {
        monthKey,
        label,
        tradesCount: mTrades.length,
        netProfit: Number(net.toFixed(2)),
        gainPercent: Number(gainPercent.toFixed(2)),
        winRate: mTrades.length > 0 ? Number(((mWins / mTrades.length) * 100).toFixed(1)) : 0,
      };
    });

  // Radar 6 Pillars (0 to 100 score)
  // Requirement: If totalTrades < 3, isDataSufficient = false to avoid artificial scores
  const isDataSufficient = totalTrades >= 3;

  let winRateScore = 0;
  let profitFactorScore = 0;
  let expectancyScore = 0;
  let rewardRiskScore = 0;
  let returnScore = 0;
  let drawdownControlScore = 0;
  let consistencyScore = 0;
  let disciplineScore = 0;

  if (isDataSufficient) {
    // 1. Win Rate Score (Target: 50% = 65 score, 70%+ = 100 score)
    if (winRate >= 70) {
      winRateScore = 100;
    } else if (winRate >= 50) {
      winRateScore = 65 + ((winRate - 50) / 20) * 35;
    } else if (winRate >= 30) {
      winRateScore = 35 + ((winRate - 30) / 20) * 30;
    } else {
      winRateScore = (winRate / 30) * 35;
    }

    // 2. Profit Factor Score (Target: 1.0 = 50, 1.5 = 70, 2.0 = 85, >= 3.0 / no loss = 100)
    if (isProfitFactorInfinite || profitFactor >= 3) {
      profitFactorScore = 100;
    } else if (profitFactor >= 2.0) {
      profitFactorScore = 85 + ((profitFactor - 2.0) / 1.0) * 15;
    } else if (profitFactor >= 1.5) {
      profitFactorScore = 70 + ((profitFactor - 1.5) / 0.5) * 15;
    } else if (profitFactor >= 1.0) {
      profitFactorScore = 50 + ((profitFactor - 1.0) / 0.5) * 20;
    } else {
      profitFactorScore = Math.max(0, profitFactor * 50);
    }

    // 3. Expectancy Score (Target: positive expectancy normalized against account size)
    // 1% starting balance expectancy per trade = 100 score; 0% = 50 score
    const expectancyPercentOfCapital = startingBalance > 0 ? (expectancy / startingBalance) * 100 : 0;
    if (expectancyPercentOfCapital >= 1.0) {
      expectancyScore = 100;
    } else if (expectancyPercentOfCapital >= 0) {
      expectancyScore = 50 + expectancyPercentOfCapital * 50;
    } else if (expectancyPercentOfCapital >= -1.0) {
      expectancyScore = Math.max(0, 50 + expectancyPercentOfCapital * 50);
    } else {
      expectancyScore = 0;
    }

    // 4. Average Realized R-Multiple Score (Strictly uses averageRiskReward when hasValidRiskReward is true; never substitutes averageWin/averageLoss)
    if (!hasValidRiskReward) {
      rewardRiskScore = 0;
    } else if (averageRiskReward >= 2.0) {
      rewardRiskScore = 100;
    } else if (averageRiskReward >= 1.0) {
      rewardRiskScore = 85 + ((averageRiskReward - 1.0) / 1.0) * 15;
    } else if (averageRiskReward >= 0.5) {
      rewardRiskScore = 70 + ((averageRiskReward - 0.5) / 0.5) * 15;
    } else if (averageRiskReward >= 0) {
      rewardRiskScore = 50 + (averageRiskReward / 0.5) * 20;
    } else {
      rewardRiskScore = Math.max(0, 50 + (averageRiskReward / 2.0) * 50);
    }

    // 5. Return Score (Target: 0% = 50, +5% = 70, +10% = 85, >= +15% = 100)
    if (totalGainPercent >= 15.0) {
      returnScore = 100;
    } else if (totalGainPercent >= 0) {
      returnScore = 50 + (totalGainPercent / 15.0) * 50;
    } else if (totalGainPercent >= -15.0) {
      returnScore = Math.max(0, 50 + (totalGainPercent / 15.0) * 50);
    } else {
      returnScore = 0;
    }

    // 6. Risk Control / Drawdown Control Score (Target: Max DD <= 0% = 100, <= 5% = 85, <= 10% = 70, <= 20% = 40, > 35% = 0)
    if (maxDrawdownPercent <= 0) {
      drawdownControlScore = 100;
    } else if (maxDrawdownPercent <= 5.0) {
      drawdownControlScore = 100 - (maxDrawdownPercent / 5.0) * 15;
    } else if (maxDrawdownPercent <= 10.0) {
      drawdownControlScore = 85 - ((maxDrawdownPercent - 5.0) / 5.0) * 15;
    } else if (maxDrawdownPercent <= 20.0) {
      drawdownControlScore = 70 - ((maxDrawdownPercent - 10.0) / 10.0) * 30;
    } else if (maxDrawdownPercent <= 35.0) {
      drawdownControlScore = 40 - ((maxDrawdownPercent - 20.0) / 15.0) * 40;
    } else {
      drawdownControlScore = 0;
    }

    // Consistency Score: Ratio of profitable trading days to total active trading days (0 - 100)
    const profitableDays = dailyPerformance.filter((d) => d.netProfit > 0).length;
    consistencyScore =
      dailyPerformance.length > 0
        ? Math.min(100, Math.round((profitableDays / dailyPerformance.length) * 100))
        : 0;

    const avgDiscipline = countWithDiscipline > 0 ? totalDisciplineRating / countWithDiscipline : 5;
    disciplineScore = Math.min(100, Math.round((avgDiscipline / 5) * 100));
  }

  return {
    metrics: {
      isEmpty: false,
      totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRate,
      winRateExcludingBE,
      lossRate,
      breakevenRate,
      totalNetProfit: Number(totalNetProfit.toFixed(2)),
      totalGrossProfit: Number(totalGrossProfit.toFixed(2)),
      totalGrossLoss: Number(totalGrossLoss.toFixed(2)),
      totalCommission: Number(totalCommission.toFixed(2)),
      totalSwap: Number(totalSwap.toFixed(2)),
      profitFactor,
      isProfitFactorInfinite,
      currentEquity: Number(currentEquity.toFixed(2)),
      startingBalance,
      totalGainCapital: Number(totalGainCapital.toFixed(2)),
      totalGainPercent,
      hasValidGrowthPercent,
      averageWin,
      averageLoss,
      averageRiskReward,
      hasValidRiskReward,
      validRTradesCount: countWithRR,
      expectancy,
      maxDrawdownAmount: Number(maxDrawdownAmount.toFixed(2)),
      maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
      consecutiveWinsMax: maxWinStreak,
      consecutiveLossesMax: maxLossStreak,
      currentStreak: { type: currentStreakType, count: currentStreakCount },
      dailyLossToday: Number(dailyLossToday.toFixed(2)),
      isDailyLossExceeded,
      isAccountInCriticalDrawdown,
    },
    equityCurve,
    dailyPerformance,
    monthlyPerformance,
    radarIndicators: {
      winRateScore: Math.round(winRateScore),
      profitFactorScore: Math.round(profitFactorScore),
      expectancyScore: Math.round(expectancyScore),
      rewardRiskScore: Math.round(rewardRiskScore),
      returnScore: Math.round(returnScore),
      drawdownControlScore: Math.round(drawdownControlScore),
      riskControlScore: Math.round(drawdownControlScore),
      consistencyScore: Math.round(consistencyScore),
      disciplineScore: Math.round(disciplineScore),
      isDataSufficient,
      totalTrades,
    },
  };
}

/**
 * Computes normalized Drawdown Curve series and Y-axis ticks from an EquityPoint[] sequence.
 * - Peak Equity = highest equity reached up to that point
 * - Drawdown Nominal = max(0, Peak Equity - Current Equity)
 * - Drawdown Persentase = Peak Equity > 0 ? (Drawdown Nominal / Peak Equity) * 100 : 0
 * Guarantees zero NaN or Infinity even if starting balance is 0, negative, or dataset is empty.
 */
export function computeDrawdownCurveSeries(
  equityCurve: ReadonlyArray<EquityPoint>,
  settings?: AppSettings
): {
  safeCurve: EquityPoint[];
  hasExecutedTrades: boolean;
  hasValidStartingBalance: boolean;
  maxDrawdownPercent: number;
  maxDrawdownAmount: number;
  yMax: number;
  tickValues: number[];
} {
  const rawStart =
    equityCurve && equityCurve.length > 0 && Number.isFinite(equityCurve[0].equity)
      ? Number(equityCurve[0].equity)
      : Number.isFinite(Number(settings?.startingBalance))
      ? Number(settings?.startingBalance)
      : 0;
  const startEquity = Number.isFinite(rawStart) ? Number(rawStart.toFixed(2)) : 0;
  const hasValidStartingBalance = startEquity > 0;

  if (!equityCurve || equityCurve.length === 0) {
    const fallbackPoint: EquityPoint = {
      index: 0,
      date: new Date().toISOString(),
      tradeId: 'START',
      netProfit: 0,
      equity: startEquity,
      peak: startEquity,
      drawdownAmount: 0,
      drawdownPercent: 0,
      growthPercent: 0,
      peakGrowthPercent: 0,
      hasValidGrowthPercent: hasValidStartingBalance,
      outcome: 'START',
    };
    return {
      safeCurve: [fallbackPoint],
      hasExecutedTrades: false,
      hasValidStartingBalance,
      maxDrawdownPercent: 0,
      maxDrawdownAmount: 0,
      yMax: 5,
      tickValues: [0, 2.5, 5],
    };
  }

  let runningPeak = startEquity;
  let maxDrawdownAmount = 0;
  let maxDrawdownPercent = 0;

  const safeCurve: EquityPoint[] = equityCurve.map((pt, idx) => {
    const currentEquity = Number.isFinite(pt.equity) ? Number(pt.equity.toFixed(2)) : startEquity;
    if (idx === 0) {
      runningPeak = currentEquity;
    } else if (currentEquity > runningPeak) {
      runningPeak = currentEquity;
    }

    const rawNominal = Math.max(0, runningPeak - currentEquity);
    const drawdownAmount = Number.isFinite(rawNominal) ? Number(rawNominal.toFixed(2)) : 0;
    const rawPct = runningPeak > 0 ? (drawdownAmount / runningPeak) * 100 : 0;
    const drawdownPercent =
      Number.isFinite(rawPct) && rawPct >= 0 ? Number(rawPct.toFixed(2)) : 0;

    if (drawdownAmount > maxDrawdownAmount) {
      maxDrawdownAmount = drawdownAmount;
    }
    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
    }

    return {
      ...pt,
      index: idx,
      equity: currentEquity,
      peak: Number(runningPeak.toFixed(2)),
      drawdownAmount,
      drawdownPercent,
    };
  });

  const hasExecutedTrades = safeCurve.length > 1;
  const rawMax = Math.max(maxDrawdownPercent, 0);
  // Compute clean yMax with 15% breathing room (minimum 2% scale when drawdown is 0% so 0% baseline sits cleanly at top)
  const yMax = rawMax > 0 ? Number(Math.max(1, rawMax * 1.15).toFixed(2)) : 5;
  const tickValues = [0, Number((yMax * 0.5).toFixed(2)), yMax];

  return {
    safeCurve,
    hasExecutedTrades,
    hasValidStartingBalance: hasValidStartingBalance || runningPeak > 0,
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxDrawdownAmount: Number(maxDrawdownAmount.toFixed(2)),
    yMax,
    tickValues,
  };
}

/**
 * Adaptive currency formatter for Performance Calendar date cells.
 * Guarantees single-line output, strict sign retention (+ / -), no ellipses,
 * tabular alignment, and consistent abbreviation (K for thousands, M for millions)
 * without mutating underlying financial values.
 */
export function formatCalendarAdaptivePnl(
  amount: number,
  settings: AppSettings,
  isPrivacyMode: boolean = false,
  mode: 'adaptive' | 'compact' | 'full' = 'adaptive'
): string {
  if (isPrivacyMode) {
    if (amount > 0) return '+***';
    if (amount < 0) return '-***';
    return '***';
  }

  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const rounded = Number(safeAmount.toFixed(2));
  const symbol = settings?.currencySymbol || '$';
  const isIdr = settings?.currency === 'IDR' || symbol === 'Rp';

  if (Math.abs(rounded) < 0.01) {
    return isIdr ? 'Rp0' : `${symbol}0`;
  }

  const sign = rounded > 0 ? '+' : '-';
  const abs = Math.abs(rounded);

  if (mode === 'full') {
    return `${sign}${formatCurrency(abs, settings, false)}`;
  }

  if (isIdr) {
    if (abs >= 1_000_000) {
      const mVal = abs / 1_000_000;
      const formattedM = mVal >= 10 ? mVal.toFixed(1) : mVal.toFixed(2);
      const cleanM = parseFloat(formattedM);
      return `${sign}Rp${cleanM}M`;
    }
    if (abs >= 1_000) {
      const kVal = abs / 1_000;
      const formattedK = kVal >= 100 ? kVal.toFixed(0) : kVal >= 10 ? kVal.toFixed(1) : kVal.toFixed(2);
      const cleanK = parseFloat(formattedK);
      return `${sign}Rp${cleanK}K`;
    }
    return `${sign}Rp${Math.round(abs)}`;
  }

  // USD / Standard Currency
  if (abs >= 1_000_000) {
    const mVal = abs / 1_000_000;
    const formattedM = mVal >= 10 ? mVal.toFixed(1) : mVal.toFixed(2);
    const cleanM = parseFloat(formattedM);
    return `${sign}${symbol}${cleanM}M`;
  }

  if (abs >= 1_000) {
    const kVal = abs / 1_000;
    const formattedK = kVal >= 100 ? kVal.toFixed(0) : kVal.toFixed(2);
    const cleanK = parseFloat(formattedK);
    return `${sign}${symbol}${cleanK}K`;
  }

  // abs < 1000
  if (abs >= 999.5) {
    return `${sign}${symbol}1K`;
  }

  if (abs >= 100) {
    if (mode === 'compact') {
      return `${sign}${symbol}${Math.round(abs)}`;
    }
    const roundedTwo = parseFloat(abs.toFixed(2));
    return `${sign}${symbol}${roundedTwo}`;
  }

  // abs < 100
  const roundedTwo = parseFloat(abs.toFixed(2));
  return `${sign}${symbol}${roundedTwo}`;
}
