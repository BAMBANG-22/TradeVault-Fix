import { useState, useEffect, useCallback } from 'react';
import { AppSettings } from '../types/settings';
import { Trade, HistoricalExchangeRateSnapshot } from '../types/trade';
import { isNativeAndroidOrIos, nativeHttpGetText } from './apiConfig';

export const USD_IDR_CACHE_KEY = 'tradevault_usd_idr_rate_v1';
export const PRIVACY_MODE_STORAGE_KEY = 'tradevault_privacy_mode';
export const DASHBOARD_CURRENCY_PREF_KEY = 'tradevault_dashboard_currency_pref';

export interface UsdIdrRateRecord {
  /** 1 USD in IDR (e.g., 16250) */
  rate: number;
  /** ISO 8601 timestamp when the rate was fetched from the live provider */
  updatedAt: string;
  /** Source provider identifier */
  provider: string;
  /** Whether the current state is from live network fetch, cached localStorage, or uninitialized offline state */
  status: 'LIVE' | 'CACHED_OFFLINE' | 'UNAVAILABLE';
}

export interface DualBalancePresentation {
  primaryCurrency: 'USD' | 'IDR';
  secondaryCurrency: 'USD' | 'IDR';
  primaryAmount: number | null;
  secondaryAmount: number | null;
  primaryFormatted: string;
  secondaryFormatted: string;
  isRateAvailable: boolean;
  rateStatus: UsdIdrRateRecord['status'];
  rateValue: number | null;
  updatedAt: string | null;
}

export interface CapitalGrowthBreakdown {
  startingBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  /** Net external capital contributed = startingBalance + totalDeposits - totalWithdrawals */
  netContributedCapital: number;
  /** Realized net profit purely from trading (excludes deposits/withdrawals) */
  netTradingProfit: number;
  /** Total account balance = netContributedCapital + netTradingProfit */
  currentBalance: number;
  /** Equity change vs starting balance = currentBalance - startingBalance */
  equityChangeFromInitial: number;
  /** Pure trading balance growth (%) = (netTradingProfit / netContributedCapital) * 100 */
  balanceGrowthPercent: number;
  /** Total equity change (%) vs initial startingBalance */
  equityChangePercent: number;
}

function roundToTwo(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function isValidRate(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 1000 && val <= 100000;
}

/**
 * Reads the last verified USD/IDR rate cached in localStorage.
 * Never fabricates a fake live rate if no rate has been cached yet.
 */
export function getCachedUsdIdrRate(): UsdIdrRateRecord | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(USD_IDR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UsdIdrRateRecord>;
    if (!isValidRate(parsed.rate) || typeof parsed.updatedAt !== 'string') {
      return null;
    }
    return {
      rate: parsed.rate,
      updatedAt: parsed.updatedAt,
      provider: typeof parsed.provider === 'string' ? parsed.provider : 'open.er-api.com',
      status: 'CACHED_OFFLINE',
    };
  } catch {
    return null;
  }
}

export function saveCachedUsdIdrRate(rate: number, updatedAt: string, provider: string): UsdIdrRateRecord {
  const record: UsdIdrRateRecord = {
    rate: roundToTwo(rate),
    updatedAt,
    provider,
    status: 'LIVE',
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(USD_IDR_CACHE_KEY, JSON.stringify(record));
    }
  } catch {
    // Ignore quota errors
  }
  return record;
}

/**
 * Fetches live USD -> IDR rate from trusted public FX APIs:
 * Primary: ExchangeRate-API Open Access (https://open.er-api.com/v6/latest/USD)
 * Secondary fallback: Frankfurter ECB API (https://api.frankfurter.app/latest?from=USD&to=IDR)
 * If offline or both fail, returns cached rate with status 'CACHED_OFFLINE' or 'UNAVAILABLE'.
 */
async function fetchRateJsonWithTimeout(
  url: string,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<any | null> {
  if (parentSignal?.aborted) return null;

  if (isNativeAndroidOrIos()) {
    const nativeText = await nativeHttpGetText(url, timeoutMs, 'application/json');
    if (nativeText) {
      try {
        return JSON.parse(nativeText);
      } catch {
        // Fall through to WebView fetch
      }
    }
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Handled by caller fallback
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
  return null;
}

export async function fetchLiveUsdIdrRate(signal?: AbortSignal): Promise<UsdIdrRateRecord> {
  // 1. Primary provider: open.er-api.com
  const primaryData = await fetchRateJsonWithTimeout('https://open.er-api.com/v6/latest/USD', 6000, signal);
  const primaryIdrRate = primaryData?.rates?.IDR;
  if (isValidRate(primaryIdrRate)) {
    const updatedAt =
      typeof primaryData?.time_last_update_utc === 'string'
        ? new Date(primaryData.time_last_update_utc).toISOString()
        : new Date().toISOString();
    return saveCachedUsdIdrRate(primaryIdrRate, updatedAt, 'ExchangeRate-API');
  }

  // 2. Secondary provider: api.frankfurter.app (European Central Bank reference rates)
  const fallbackData = await fetchRateJsonWithTimeout(
    'https://api.frankfurter.app/latest?from=USD&to=IDR',
    6000,
    signal
  );
  const fallbackIdrRate = fallbackData?.rates?.IDR;
  if (isValidRate(fallbackIdrRate)) {
    const updatedAt = new Date().toISOString();
    return saveCachedUsdIdrRate(fallbackIdrRate, updatedAt, 'ECB / Frankfurter');
  }

  // 3. Cached offline rate
  const cached = getCachedUsdIdrRate();
  if (cached) {
    return {
      ...cached,
      status: 'CACHED_OFFLINE',
    };
  }

  return {
    rate: 0,
    updatedAt: '',
    provider: 'Unavailable',
    status: 'UNAVAILABLE',
  };
}

export function formatExactCurrency(amount: number, currency: 'USD' | 'IDR' | 'EUR'): string {
  const safeVal = Number.isFinite(amount) ? amount : 0;
  if (currency === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .format(Math.round(safeVal))
      .replace(/\u00a0/g, ' ');
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(safeVal)
    .replace(/\u00a0/g, ' ');
}

/**
 * Computes the Dashboard dual-currency presentation (strictly USD and IDR).
 * - If user currency is IDR: Primary = IDR, Secondary = USD.
 * - If user currency is USD (or EUR): Primary = USD, Secondary = IDR.
 * - Never mutates underlying stored values.
 * - Masks both values with '******' when isPrivacyMode is true.
 */
export function computeDualCurrencyDisplay(
  amountInBaseCurrency: number,
  baseCurrency: AppSettings['currency'],
  rateRecord: UsdIdrRateRecord | null,
  isPrivacyMode: boolean = false,
  preferredPrimaryCurrency?: 'USD' | 'IDR'
): DualBalancePresentation {
  const safeBaseAmount = Number.isFinite(amountInBaseCurrency) ? amountInBaseCurrency : 0;
  const hasValidRate = Boolean(rateRecord && isValidRate(rateRecord.rate));
  const rate = hasValidRate && rateRecord ? rateRecord.rate : null;

  // If a swap preference is set, honour it; otherwise fallback to baseCurrency setting
  const effectivePrimary: 'USD' | 'IDR' =
    preferredPrimaryCurrency || (baseCurrency === 'IDR' ? 'IDR' : 'USD');
  const isIdrPrimary = effectivePrimary === 'IDR';
  const primaryCurrency: 'USD' | 'IDR' = isIdrPrimary ? 'IDR' : 'USD';
  const secondaryCurrency: 'USD' | 'IDR' = isIdrPrimary ? 'USD' : 'IDR';

  // Base account currency is invariant (USD original balance)
  const baseIsUsd = baseCurrency !== 'IDR';

  let primaryAmount: number | null = null;
  let secondaryAmount: number | null = null;

  if (baseIsUsd) {
    const originalUsd = roundToTwo(safeBaseAmount);
    const convertedIdr = rate ? Math.round(originalUsd * rate) : null;
    if (isIdrPrimary) {
      primaryAmount = convertedIdr;
      secondaryAmount = originalUsd;
    } else {
      primaryAmount = originalUsd;
      secondaryAmount = convertedIdr;
    }
  } else {
    // Original balance is IDR
    const originalIdr = Math.round(safeBaseAmount);
    const convertedUsd = rate ? roundToTwo(originalIdr / rate) : null;
    if (isIdrPrimary) {
      primaryAmount = originalIdr;
      secondaryAmount = convertedUsd;
    } else {
      primaryAmount = convertedUsd;
      secondaryAmount = originalIdr;
    }
  }

  if (isPrivacyMode) {
    return {
      primaryCurrency,
      secondaryCurrency,
      primaryAmount,
      secondaryAmount,
      primaryFormatted: '******',
      secondaryFormatted: '******',
      isRateAvailable: hasValidRate,
      rateStatus: rateRecord?.status ?? 'UNAVAILABLE',
      rateValue: rate,
      updatedAt: rateRecord?.updatedAt || null,
    };
  }

  const primaryFormatted =
    primaryAmount !== null
      ? formatExactCurrency(primaryAmount, primaryCurrency)
      : `Kurs ${primaryCurrency} belum tersedia`;
  const secondaryFormatted =
    secondaryAmount !== null
      ? `≈ ${formatExactCurrency(secondaryAmount, secondaryCurrency)}`
      : `Kurs ${secondaryCurrency} belum tersedia (Offline)`;

  return {
    primaryCurrency,
    secondaryCurrency,
    primaryAmount,
    secondaryAmount,
    primaryFormatted,
    secondaryFormatted,
    isRateAvailable: hasValidRate,
    rateStatus: rateRecord?.status ?? 'UNAVAILABLE',
    rateValue: rate,
    updatedAt: rateRecord?.updatedAt || null,
  };
}

/**
 * Creates a snapshot of the current USD/IDR exchange rate to lock on trade close.
 */
export function getCurrentUsdIdrSnapshot(
  rateRecord: UsdIdrRateRecord | null
): HistoricalExchangeRateSnapshot {
  const hasRate = Boolean(rateRecord && isValidRate(rateRecord.rate));
  const cached = getCachedUsdIdrRate();
  const rate = hasRate
    ? rateRecord!.rate
    : cached && isValidRate(cached.rate)
    ? cached.rate
    : 16000;
  const status: HistoricalExchangeRateSnapshot['status'] =
    rateRecord?.status === 'LIVE' ? 'LIVE' : 'CACHED_OFFLINE';
  const source = rateRecord?.provider || cached?.provider || 'ExchangeRate-API';

  return {
    rate: roundToTwo(rate),
    baseCurrency: 'USD',
    quoteCurrency: 'IDR',
    timestamp: new Date().toISOString(),
    source,
    status,
  };
}

/**
 * Retrieves the historical IDR net profit for a trade.
 * For closed trades with closeExchangeRate snapshot: locks in historical value.
 * For unverified legacy trades: preserves raw USD and marks status.
 */
export function getHistoricalTradeProfitIdr(
  trade: Trade,
  fallbackLiveRate?: number
): {
  idrAmount: number | null;
  rateUsed: number;
  isHistoricalSnapshot: boolean;
  snapshotStatus: HistoricalExchangeRateSnapshot['status'];
} {
  const netUsd = Number(trade.netProfit) || 0;
  if (trade.closeExchangeRate && isValidRate(trade.closeExchangeRate.rate)) {
    return {
      idrAmount: Math.round(netUsd * trade.closeExchangeRate.rate),
      rateUsed: trade.closeExchangeRate.rate,
      isHistoricalSnapshot: true,
      snapshotStatus: trade.closeExchangeRate.status,
    };
  }

  const cached = getCachedUsdIdrRate();
  const rate =
    fallbackLiveRate && isValidRate(fallbackLiveRate)
      ? fallbackLiveRate
      : cached && isValidRate(cached.rate)
      ? cached.rate
      : 16000;

  return {
    idrAmount: Math.round(netUsd * rate),
    rateUsed: rate,
    isHistoricalSnapshot: false,
    snapshotStatus: 'UNVERIFIED_LEGACY',
  };
}

/**
 * Calculates Balance Growth (%) while strictly separating:
 * 1. Net Trading Profit (pure realized P/L from trades)
 * 2. Net Contributed Capital (startingBalance + totalDeposits - totalWithdrawals)
 * 3. Balance Growth % = (netTradingProfit / netContributedCapital) * 100
 * Deposits are never treated as trading profit, and withdrawals are never treated as trading losses.
 */
export function calculateCapitalGrowthBreakdown(
  settings: AppSettings,
  netTradingProfit: number
): CapitalGrowthBreakdown {
  const startingBalance =
    Number.isFinite(settings.startingBalance) && settings.startingBalance >= 0
      ? settings.startingBalance
      : 0;
  const totalDeposits =
    Number.isFinite(settings.totalDeposits) && (settings.totalDeposits as number) >= 0
      ? (settings.totalDeposits as number)
      : 0;
  const totalWithdrawals =
    Number.isFinite(settings.totalWithdrawals) && (settings.totalWithdrawals as number) >= 0
      ? (settings.totalWithdrawals as number)
      : 0;
  const safeNetProfit = Number.isFinite(netTradingProfit) ? roundToTwo(netTradingProfit) : 0;

  const netContributedCapital = roundToTwo(startingBalance + totalDeposits - totalWithdrawals);
  const currentBalance = roundToTwo(netContributedCapital + safeNetProfit);
  const equityChangeFromInitial = roundToTwo(currentBalance - startingBalance);

  const capitalDenominator = netContributedCapital > 0 ? netContributedCapital : startingBalance;
  const balanceGrowthPercent =
    capitalDenominator > 0 ? roundToTwo((safeNetProfit / capitalDenominator) * 100) : 0;

  const equityChangePercent =
    startingBalance > 0 ? roundToTwo((equityChangeFromInitial / startingBalance) * 100) : 0;

  return {
    startingBalance,
    totalDeposits,
    totalWithdrawals,
    netContributedCapital,
    netTradingProfit: safeNetProfit,
    currentBalance,
    equityChangeFromInitial,
    balanceGrowthPercent,
    equityChangePercent,
  };
}

/**
 * Reads the user's active global currency preference ('USD' | 'IDR').
 * Persisted in localStorage and synchronized across all views.
 */
export function getGlobalCurrencyPreference(): 'USD' | 'IDR' {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(DASHBOARD_CURRENCY_PREF_KEY);
      if (stored === 'USD' || stored === 'IDR') return stored;
    }
  } catch {
    // fallback
  }
  return 'USD';
}

/**
 * Persists the user's active global currency preference ('USD' | 'IDR')
 * and dispatches a window event so all mounted views update reactively.
 */
export function setGlobalCurrencyPreference(pref: 'USD' | 'IDR'): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DASHBOARD_CURRENCY_PREF_KEY, pref);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('tradevault-currency-pref-change'));
    }
  } catch {
    // ignore
  }
}

/**
 * Returns the effective live or cached USD/IDR exchange rate.
 * Guarantees a safe fallback rate (e.g. 18000) if no network rate exists yet.
 */
export function getEffectiveUsdIdrRate(rateRecord?: UsdIdrRateRecord | null): number {
  if (rateRecord && isValidRate(rateRecord.rate)) {
    return rateRecord.rate;
  }
  const cached = getCachedUsdIdrRate();
  if (cached && isValidRate(cached.rate)) {
    return cached.rate;
  }
  return 18000;
}

/**
 * Converts dynamic / floating USD amount to the target currency (USD or IDR).
 * Used for: Account Balance, Planned Risk, Open Trade Floating P/L, Daily Loss Limit, Max Drawdown.
 */
export function convertDynamicUsdAmount(
  amountUsd: number,
  targetCurrency: 'USD' | 'IDR',
  rateRecord?: UsdIdrRateRecord | null
): number {
  const safeUsd = Number.isFinite(amountUsd) ? amountUsd : 0;
  if (targetCurrency === 'USD') {
    return roundToTwo(safeUsd);
  }
  const rate = getEffectiveUsdIdrRate(rateRecord);
  return Math.round(safeUsd * rate);
}

/**
 * Formats dynamic / floating USD amount into currency string ($1,000.00 or Rp18.000.000).
 * Handles privacy masking.
 */
export function formatDynamicAmount(
  amountUsd: number,
  targetCurrency: 'USD' | 'IDR',
  rateRecord?: UsdIdrRateRecord | null,
  isPrivacyMode: boolean = false,
  withPlusSign: boolean = false
): string {
  if (isPrivacyMode) {
    return targetCurrency === 'IDR' ? 'Rp••••••' : '$••••••';
  }
  const safe = Number.isFinite(amountUsd) ? amountUsd : 0;
  if (targetCurrency === 'USD') {
    const rounded = Number(safe.toFixed(2));
    if (Math.abs(rounded) < 0.001) return '$0.00';
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(rounded));
    const prefix = rounded > 0 ? (withPlusSign ? '+' : '') : '-';
    return `${prefix}${formatted}`;
  }

  // IDR
  const rate = getEffectiveUsdIdrRate(rateRecord);
  const idrVal = Math.round(safe * rate);
  if (Math.abs(idrVal) === 0) return 'Rp 0';
  const formatted = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(Math.abs(idrVal))
    .replace(/\u00a0/g, ' ');
  const prefix = idrVal > 0 ? (withPlusSign ? '+' : '') : '-';
  return `${prefix}${formatted}`;
}

/**
 * Converts a closed trade metric (netProfit, grossProfit, commission, swap)
 * strictly preserving the Historical Exchange Rate snapshot locked when the trade was closed.
 * Never recalculates closed trades using today's live rate!
 */
export function convertHistoricalTradeMetric(
  trade: Trade,
  metricKey: 'netProfit' | 'grossProfit' | 'commission' | 'swap',
  targetCurrency: 'USD' | 'IDR',
  fallbackRateRecord?: UsdIdrRateRecord | null
): {
  amount: number;
  rateUsed: number;
  isHistoricalLocked: boolean;
  snapshotStatus: HistoricalExchangeRateSnapshot['status'];
} {
  const rawUsd = Number(trade[metricKey]) || 0;
  if (targetCurrency === 'USD') {
    return {
      amount: roundToTwo(rawUsd),
      rateUsed: 1,
      isHistoricalLocked: true,
      snapshotStatus: 'LIVE',
    };
  }

  // Target currency is IDR
  // 1. Check if closed trade has verified snapshot
  if (trade.closeExchangeRate && isValidRate(trade.closeExchangeRate.rate)) {
    return {
      amount: Math.round(rawUsd * trade.closeExchangeRate.rate),
      rateUsed: trade.closeExchangeRate.rate,
      isHistoricalLocked: true,
      snapshotStatus: trade.closeExchangeRate.status,
    };
  }

  // 2. Unverified legacy trade fallback
  const fallbackRate = getEffectiveUsdIdrRate(fallbackRateRecord);
  return {
    amount: Math.round(rawUsd * fallbackRate),
    rateUsed: fallbackRate,
    isHistoricalLocked: false,
    snapshotStatus: 'UNVERIFIED_LEGACY',
  };
}

/**
 * Formats a trade financial metric (Net P/L, Gross P/L, Commission, Swap, Risk Amount)
 * applying historical lock for closed trades, and dynamic conversion for planned/open trades.
 */
export function formatTradeFinancialValue(
  trade: Trade,
  metricKey: 'netProfit' | 'grossProfit' | 'commission' | 'swap' | 'riskAmount',
  targetCurrency: 'USD' | 'IDR',
  rateRecord?: UsdIdrRateRecord | null,
  isPrivacyMode: boolean = false,
  withPlusSign: boolean = false
): string {
  if (isPrivacyMode) {
    return targetCurrency === 'IDR' ? 'Rp••••••' : '$••••••';
  }

  // Planned / Open riskAmount is always dynamic (unrealized)
  if (metricKey === 'riskAmount') {
    return formatDynamicAmount(
      Number(trade.riskAmount) || 0,
      targetCurrency,
      rateRecord,
      false,
      false
    );
  }

  if (targetCurrency === 'USD') {
    const rawVal = Number(trade[metricKey]) || 0;
    const rounded = Number(rawVal.toFixed(2));
    if (Math.abs(rounded) < 0.001) return '$0.00';
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(Math.abs(rounded))
      .replace(/\u00a0/g, ' ');
    const prefix = rounded > 0 ? (withPlusSign ? '+' : '') : '-';
    return `${prefix}${formatted}`;
  }

  // IDR: apply historical lock for closed trades
  const converted = convertHistoricalTradeMetric(trade, metricKey, 'IDR', rateRecord);
  if (Math.abs(converted.amount) === 0) return 'Rp 0';
  const formatted = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(Math.abs(converted.amount))
    .replace(/\u00a0/g, ' ');
  const prefix = converted.amount > 0 ? (withPlusSign ? '+' : '') : '-';
  return `${prefix}${formatted}`;
}

/**
 * Calculates cumulative realized profit/loss across closed trades in display currency.
 * When IDR is active, sums the individually locked historical IDR amounts.
 */
export function computeCumulativeProfitInDisplayCurrency(
  trades: Trade[],
  targetCurrency: 'USD' | 'IDR',
  rateRecord?: UsdIdrRateRecord | null
): number {
  if (targetCurrency === 'USD') {
    const totalUsd = trades.reduce((acc, t) => acc + (Number(t.netProfit) || 0), 0);
    return roundToTwo(totalUsd);
  }

  // IDR: Sum each closed trade's historical locked IDR amount
  return trades.reduce((acc, t) => {
    const hist = convertHistoricalTradeMetric(t, 'netProfit', 'IDR', rateRecord);
    return acc + hist.amount;
  }, 0);
}

/**
 * Universal React hook for Global Currency Display across TradeVault.
 * Automatically synchronizes when preferred currency changes anywhere in the app.
 */
export function useGlobalCurrency() {
  const [preferredCurrency, setPreferredCurrencyState] = useState<'USD' | 'IDR'>(() =>
    getGlobalCurrencyPreference()
  );
  const [rateRecord, setRateRecord] = useState<UsdIdrRateRecord | null>(() =>
    getCachedUsdIdrRate()
  );

  useEffect(() => {
    let isMounted = true;
    fetchLiveUsdIdrRate().then((rec) => {
      if (isMounted) setRateRecord(rec);
    });

    const onPrefChange = () => {
      setPreferredCurrencyState(getGlobalCurrencyPreference());
    };
    window.addEventListener('tradevault-currency-pref-change', onPrefChange);
    return () => {
      isMounted = false;
      window.removeEventListener('tradevault-currency-pref-change', onPrefChange);
    };
  }, []);

  const setPreferredCurrency = useCallback((pref: 'USD' | 'IDR') => {
    setPreferredCurrencyState(pref);
    setGlobalCurrencyPreference(pref);
  }, []);

  const swapCurrency = useCallback(() => {
    const next = preferredCurrency === 'USD' ? 'IDR' : 'USD';
    setPreferredCurrency(next);
  }, [preferredCurrency, setPreferredCurrency]);

  return {
    preferredCurrency,
    setPreferredCurrency,
    swapCurrency,
    rateRecord,
    effectiveRate: getEffectiveUsdIdrRate(rateRecord),
    formatDynamic: useCallback(
      (amountUsd: number, isPrivacyMode: boolean = false, withPlusSign: boolean = false) =>
        formatDynamicAmount(amountUsd, preferredCurrency, rateRecord, isPrivacyMode, withPlusSign),
      [preferredCurrency, rateRecord]
    ),
    formatTradeFinancial: useCallback(
      (
        trade: Trade,
        metricKey: 'netProfit' | 'grossProfit' | 'commission' | 'swap' | 'riskAmount',
        isPrivacyMode: boolean = false,
        withPlusSign: boolean = false
      ) =>
        formatTradeFinancialValue(
          trade,
          metricKey,
          preferredCurrency,
          rateRecord,
          isPrivacyMode,
          withPlusSign
        ),
      [preferredCurrency, rateRecord]
    ),
  };
}

