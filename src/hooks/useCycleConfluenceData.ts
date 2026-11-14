/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabase, isSupabaseConfigured } from '../utils/supabaseClient';
import {
  TWELVE_DATA_API_KEY_STORAGE_KEY,
  getStoredTwelveDataApiKey,
  saveStoredTwelveDataApiKey,
  getTwelveDataInterval,
  WHEEL_PAIRS,
  WHEEL_TIMEFRAMES,
  sanitizeAndFilterCandles,
  isMarketOpenForPair,
  getMostRecentFridayCloseTimestamp,
  loadCachedCandles,
  type OhlcCandle,
} from '../components/chart/MarketChartView';
import { fetchWithCorsProxy } from '../utils/macroFeedFetcher';
import { isMarketDay } from '../utils/date';
import {
  getApiEndpointCandidates,
  isNativeAndroidOrIos,
  nativeHttpGetText,
} from '../utils/apiConfig';
import type {
  ConfluenceCandle,
  MacroBiasDirection,
  TradingConfluenceMode,
} from '../utils/confluenceEngine';

export type TwelveDataConfluenceInterval = '1day' | '4h' | '1h' | '15min' | '5min';
export type TwelveDataStatus =
  | 'ok'
  | 'missing_key'
  | 'rate_limited'
  | 'error'
  | 'preview_sample';
export type ConfluenceCandleSource =
  | 'twelvedata'
  | 'binance'
  | 'cached'
  | 'sample'
  | 'none';

const MODE_TIMEFRAMES: Record<TradingConfluenceMode, TwelveDataConfluenceInterval[]> = {
  SWING: ['1day', '4h', '1h', '15min'],
  SCALP: ['1h', '15min', '5min'],
};

const ALL_CONFLUENCE_INTERVALS: TwelveDataConfluenceInterval[] = [
  '1day',
  '4h',
  '1h',
  '15min',
  '5min',
];

const INTERVAL_TO_TF_VALUE: Record<TwelveDataConfluenceInterval, string> = {
  '1day': 'D',
  '4h': '240',
  '1h': '60',
  '15min': '15',
  '5min': '5',
};

const XAU_PAIR = WHEEL_PAIRS.find((p) => p.label === 'XAUUSD') || WHEEL_PAIRS[0];
const TWELVE_DATA_SYMBOL = XAU_PAIR.twelveDataSymbol || 'XAU/USD';

const INTERVAL_CACHE_TTL_MS: Record<TwelveDataConfluenceInterval, number> = {
  '5min': 90 * 1000,
  '15min': 2 * 60 * 1000,
  '1h': 5 * 60 * 1000,
  '4h': 10 * 60 * 1000,
  '1day': 15 * 60 * 1000,
};

const REFRESH_COOLDOWN_MS = 12 * 1000;
const LOCAL_CANDLE_CACHE_KEY = 'tradevault_cycle_confluence_td_v1';

interface CachedTfEntry {
  candles: ConfluenceCandle[];
  fetchedAt: number;
  source?: ConfluenceCandleSource;
}

// Module-level in-memory cache shared across mode toggles without refetching unchanged intervals
const memoryCandleCache = new Map<string, CachedTfEntry>();
const inFlightTwelveDataMap = new Map<
  string,
  Promise<{ candles: ConfluenceCandle[]; rateLimited: boolean; errorMsg?: string }>
>();
const inFlightYahooGoldMap = new Map<string, Promise<ConfluenceCandle[]>>();
let memoryMacroCache: {
  bias: MacroBiasDirection;
  analyzedAt: string | null;
  fetchedAt: number;
} | null = null;

export function hasStoredTwelveDataKeyInLocalStorage(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    const raw = window.localStorage.getItem(TWELVE_DATA_API_KEY_STORAGE_KEY);
    return Boolean(raw && raw.trim().length > 5);
  } catch {
    return false;
  }
}

export function getRawStoredTwelveDataKey(): string {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return '';
  }
  try {
    return window.localStorage.getItem(TWELVE_DATA_API_KEY_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function getCacheKey(symbol: string, interval: TwelveDataConfluenceInterval): string {
  return `${symbol}|${interval}`;
}

function getTfMeta(interval: TwelveDataConfluenceInterval) {
  const tfValue = INTERVAL_TO_TF_VALUE[interval];
  return (
    WHEEL_TIMEFRAMES.find((t) => t.value === tfValue) || {
      label: interval,
      value: tfValue,
      binanceInterval: interval === '1day' ? '1d' : interval.replace('min', 'm'),
      seconds: 3600,
    }
  );
}

function toConfluenceCandles(candles: OhlcCandle[]): ConfluenceCandle[] {
  return candles.map((c) => {
    const rawVol = Number((c as any).volume);
    return {
      time: Number(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Number.isFinite(rawVol) && rawVol > 0 ? rawVol : 0,
    };
  });
}

/**
 * Enforces strict Monday–Friday (Senin–Jumat) weekday market filter for XAU/USD:
 * - Strips any candle on Saturday (utcDay === 6) or Sunday (utcDay === 0) or Friday >= 22:00 UTC.
 * - When market is closed on Saturday/Sunday, caps timestamps at the most recent Friday 22:00 UTC close.
 */
function applyPairFiltersAndMarketHours(candles: ConfluenceCandle[]): ConfluenceCandle[] {
  const cleaned = sanitizeAndFilterCandles(
    candles as unknown as OhlcCandle[],
    XAU_PAIR.label
  );
  const marketStatus = isMarketOpenForPair(XAU_PAIR.label);
  const fridayCloseSec = getMostRecentFridayCloseTimestamp();
  const filtered = cleaned.filter((c) => {
    const t = Number(c.time);
    // Strictly allow only Monday (1) through Friday (5) market days via isMarketDay
    if (!isMarketDay(t, { useUtc: true, enforceFridayCloseUtc: true })) return false;
    if (!marketStatus.isOpen && t > fridayCloseSec) return false;
    return true;
  });
  return toConfluenceCandles(filtered);
}

function readLocalCandleCache(): Record<string, CachedTfEntry> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_CANDLE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalCandleCache(key: string, entry: CachedTfEntry): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const existing = readLocalCandleCache();
    existing[key] = entry;
    localStorage.setItem(LOCAL_CANDLE_CACHE_KEY, JSON.stringify(existing));
  } catch {
    // Ignore storage quota errors
  }
}

function hydrateMemoryCacheFromLocal(
  symbol: string,
  interval: TwelveDataConfluenceInterval
): CachedTfEntry | null {
  const key = getCacheKey(symbol, interval);
  const mem = memoryCandleCache.get(key);
  if (mem && mem.source !== 'sample') {
    const weekdayFiltered = applyPairFiltersAndMarketHours(mem.candles);
    if (weekdayFiltered.length > 0) {
      return { ...mem, candles: weekdayFiltered };
    }
  }
  const local = readLocalCandleCache();
  const entry = local[key];
  if (
    entry &&
    entry.source !== 'sample' &&
    Array.isArray(entry.candles) &&
    entry.candles.length > 0
  ) {
    const weekdayFiltered = applyPairFiltersAndMarketHours(entry.candles);
    if (weekdayFiltered.length > 0) {
      const cleanEntry: CachedTfEntry = { ...entry, candles: weekdayFiltered };
      memoryCandleCache.set(key, cleanEntry);
      return cleanEntry;
    }
  }

  // Also check MarketChartView's shared localStorage cache (`tradevault_candle_cache_v5_OANDA:XAUUSD_*`)
  const tfMeta = getTfMeta(interval);
  const marketChartCached = loadCachedCandles(XAU_PAIR.symbol, tfMeta.value, XAU_PAIR.label);
  if (marketChartCached && marketChartCached.length > 0) {
    const converted = applyPairFiltersAndMarketHours(toConfluenceCandles(marketChartCached));
    if (converted.length > 0) {
      const hydrated: CachedTfEntry = {
        candles: converted,
        fetchedAt: Date.now() - 60 * 1000,
        source: 'cached',
      };
      memoryCandleCache.set(key, hydrated);
      return hydrated;
    }
  }

  return null;
}

export function parseTwelveDataCandles(values: any[], decimals: number = XAU_PAIR.decimals): ConfluenceCandle[] {
  const rawMapped: ConfluenceCandle[] = [];

  for (const row of values.slice().reverse()) {
    const rawDt = String(row?.datetime || '').trim();
    if (!rawDt) continue;
    const iso = rawDt.includes(' ')
      ? rawDt.replace(' ', 'T') + 'Z'
      : rawDt.length === 10
      ? rawDt + 'T00:00:00Z'
      : rawDt;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;

    const time = Math.floor(ms / 1000);
    const open = Number(parseFloat(row.open).toFixed(decimals));
    const high = Number(parseFloat(row.high).toFixed(decimals));
    const low = Number(parseFloat(row.low).toFixed(decimals));
    const close = Number(parseFloat(row.close).toFixed(decimals));
    const rawVol = row.volume !== undefined && row.volume !== null ? Number(row.volume) : 0;
    const volume = Number.isFinite(rawVol) && rawVol > 0 ? rawVol : 0;

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      continue;
    }

    rawMapped.push({
      time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume,
    });
  }

  return applyPairFiltersAndMarketHours(rawMapped);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<Response> {
  const localController = new AbortController();
  const onParentAbort = () => localController.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      localController.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => localController.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: localController.signal });
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

async function fetchWithProxyFallback(
  targetUrl: string,
  signal?: AbortSignal
): Promise<Response> {
  if (isNativeAndroidOrIos()) {
    const nativeText = await nativeHttpGetText(targetUrl, 7000, 'application/json');
    if (nativeText) {
      return new Response(nativeText, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const directRes = await fetchWithTimeout(targetUrl, 5000, signal);
    if (directRes.status < 500) {
      return directRes;
    }
  } catch (err: any) {
    if (signal?.aborted) throw err;
  }

  const proxyCandidates = getApiEndpointCandidates('/api/proxy');
  const encoded = encodeURIComponent(targetUrl);
  for (const proxyBase of proxyCandidates) {
    try {
      const res = await fetchWithTimeout(`${proxyBase}?url=${encoded}`, 7000, signal);
      if (res.ok) return res;
    } catch (err: any) {
      if (signal?.aborted) throw err;
    }
  }

  return fetchWithTimeout(targetUrl, 7000, signal);
}

async function fetchLatestMacroBiasFromSupabase(): Promise<{
  bias: MacroBiasDirection;
  analyzedAt: string | null;
  source: 'supabase' | 'fallback';
}> {
  if (memoryMacroCache && Date.now() - memoryMacroCache.fetchedAt < 2 * 60 * 1000) {
    return {
      bias: memoryMacroCache.bias,
      analyzedAt: memoryMacroCache.analyzedAt,
      source: 'supabase',
    };
  }

  if (!isSupabaseConfigured()) {
    return { bias: 'MIXED', analyzedAt: null, source: 'fallback' };
  }

  const client = getSupabase();
  if (!client) {
    return { bias: 'MIXED', analyzedAt: null, source: 'fallback' };
  }

  try {
    const queryPromise = client
      .from('macro_news_snapshots')
      .select('dominant_bias, analyzed_at')
      .eq('instrument', 'XAUUSD')
      .order('analyzed_at', { ascending: false })
      .limit(5);

    const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('Supabase timeout') }), 3500)
    );

    const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

    if (error || !Array.isArray(data) || data.length === 0) {
      return { bias: 'MIXED', analyzedAt: null, source: 'fallback' };
    }

    // Prioritize cloud snapshots recorded on an active market weekday (Senin–Jumat)
    const row = data.find((r) => isMarketDay(r?.analyzed_at)) || data[0];
    const rawBias = String(row?.dominant_bias || '').toUpperCase();
    const bias: MacroBiasDirection =
      rawBias === 'BUY' || rawBias === 'SELL' || rawBias === 'MIXED' ? rawBias : 'MIXED';
    const analyzedAt = typeof row?.analyzed_at === 'string' ? row.analyzed_at : null;

    memoryMacroCache = { bias, analyzedAt, fetchedAt: Date.now() };
    return { bias, analyzedAt, source: 'supabase' };
  } catch {
    return { bias: 'MIXED', analyzedAt: null, source: 'fallback' };
  }
}

async function fetchTwelveDataTimeSeries(
  interval: TwelveDataConfluenceInterval,
  signal?: AbortSignal
): Promise<{
  candles: ConfluenceCandle[];
  rateLimited: boolean;
  errorMsg?: string;
}> {
  const apiKey = getStoredTwelveDataApiKey();
  if (!apiKey || apiKey.trim().length <= 5) {
    return {
      candles: [],
      rateLimited: false,
      errorMsg: 'API Key Twelve Data belum terpasang.',
    };
  }

  const dedupKey = `${TWELVE_DATA_SYMBOL}|${interval}|${apiKey.trim().slice(-6)}`;
  const existingPromise = inFlightTwelveDataMap.get(dedupKey);
  if (existingPromise) {
    return existingPromise;
  }

  const tfMeta = getTfMeta(interval);
  const twelveInterval = getTwelveDataInterval(tfMeta.value);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    TWELVE_DATA_SYMBOL
  )}&interval=${twelveInterval}&outputsize=80&timezone=UTC&apikey=${encodeURIComponent(
    apiKey.trim()
  )}`;

  const requestPromise = (async () => {
    try {
      const res = await fetchWithProxyFallback(url, signal);
      if (res.status === 429) {
        return {
          candles: [],
          rateLimited: true,
          errorMsg: 'Batas permintaan Twelve Data tercapai (429).',
        };
      }
      if (!res.ok) {
        return {
          candles: [],
          rateLimited: false,
          errorMsg: `Twelve Data HTTP ${res.status}`,
        };
      }

      const json = await res.json();
      if (json?.status === 'error') {
        const msg = String(json?.message || 'Twelve Data API error');
        const isRateLimit =
          json?.code === 429 ||
          msg.toLowerCase().includes('credits') ||
          msg.toLowerCase().includes('limit');
        return {
          candles: [],
          rateLimited: isRateLimit,
          errorMsg: isRateLimit
            ? 'Kuota permintaan per menit Twelve Data penuh (429).'
            : msg,
        };
      }

      if (!Array.isArray(json?.values) || json.values.length === 0) {
        return {
          candles: [],
          rateLimited: false,
          errorMsg: `Data candle ${twelveInterval} kosong dari Twelve Data.`,
        };
      }

      const candles = parseTwelveDataCandles(json.values, XAU_PAIR.decimals);
      return { candles, rateLimited: false };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      return {
        candles: [],
        rateLimited: false,
        errorMsg: err?.message || `Gagal menghubungi Twelve Data untuk ${twelveInterval}.`,
      };
    } finally {
      inFlightTwelveDataMap.delete(dedupKey);
    }
  })();

  inFlightTwelveDataMap.set(dedupKey, requestPromise);
  return requestPromise;
}

/**
 * Fetches real weekday-only (Monday–Friday) Gold market candles from Yahoo Finance (`GC=F`)
 * when Twelve Data is rate-limited. Unlike 24/7 crypto feeds, Gold futures/spot strictly close
 * on Saturday & Sunday, and all bars are additionally filtered through `applyPairFiltersAndMarketHours`.
 */
async function fetchWeekdayYahooGoldCandles(
  interval: TwelveDataConfluenceInterval,
  signal?: AbortSignal
): Promise<ConfluenceCandle[]> {
  const existingPromise = inFlightYahooGoldMap.get(interval);
  if (existingPromise) {
    return existingPromise;
  }

  const yahooInterval =
    interval === '1day'
      ? '1d'
      : interval === '4h' || interval === '1h'
      ? '60m'
      : interval === '15min'
      ? '15m'
      : '5m';
  const yahooRange =
    interval === '1day'
      ? '6mo'
      : interval === '4h'
      ? '1mo'
      : interval === '1h'
      ? '1mo'
      : '5d';

  const requestPromise = (async () => {
    try {
      if (signal?.aborted) return [];
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        'GC=F'
      )}?interval=${yahooInterval}&range=${yahooRange}&_t=${Date.now()}`;
      const jsonStr = await fetchWithCorsProxy(targetUrl, 7000, 'application/json');
      if (signal?.aborted) return [];

      const json = JSON.parse(jsonStr);
      const result = json?.chart?.result?.[0];
      const timestamps: any[] = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0] || {};
      const opens: any[] = quote?.open || [];
      const highs: any[] = quote?.high || [];
      const lows: any[] = quote?.low || [];
      const closes: any[] = quote?.close || [];
      const volumes: any[] = quote?.volume || [];

      if (!Array.isArray(timestamps) || timestamps.length === 0) {
        return [];
      }

      const rawCandles: ConfluenceCandle[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const time = Number(timestamps[i]);
        const open = Number(parseFloat(opens[i]).toFixed(XAU_PAIR.decimals));
        const high = Number(parseFloat(highs[i]).toFixed(XAU_PAIR.decimals));
        const low = Number(parseFloat(lows[i]).toFixed(XAU_PAIR.decimals));
        const close = Number(parseFloat(closes[i]).toFixed(XAU_PAIR.decimals));
        const vol = Number(volumes[i]);

        if (
          !Number.isFinite(time) ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close) ||
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0
        ) {
          continue;
        }

        rawCandles.push({
          time,
          open,
          high: Math.max(high, open, close),
          low: Math.min(low, open, close),
          close,
          volume: Number.isFinite(vol) && vol > 0 ? vol : 0,
        });
      }

      const weekdayHourlyOrBase = applyPairFiltersAndMarketHours(rawCandles);
      if (weekdayHourlyOrBase.length === 0) return [];

      if (interval === '4h') {
        const buckets = new Map<number, ConfluenceCandle>();
        for (const bar of weekdayHourlyOrBase) {
          const bucketSec = Math.floor(bar.time / 14400) * 14400;
          const existing = buckets.get(bucketSec);
          if (!existing) {
            buckets.set(bucketSec, {
              time: bucketSec,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume || 0,
            });
          } else {
            existing.high = Number(Math.max(existing.high, bar.high).toFixed(XAU_PAIR.decimals));
            existing.low = Number(Math.min(existing.low, bar.low).toFixed(XAU_PAIR.decimals));
            existing.close = bar.close;
            existing.volume = (existing.volume || 0) + (bar.volume || 0);
          }
        }
        return applyPairFiltersAndMarketHours(Array.from(buckets.values())).slice(-80);
      }

      return weekdayHourlyOrBase.slice(-80);
    } catch {
      return [];
    } finally {
      inFlightYahooGoldMap.delete(interval);
    }
  })();

  inFlightYahooGoldMap.set(interval, requestPromise);
  return requestPromise;
}

export interface CycleConfluenceDataState {
  candlesByTf: Record<string, ConfluenceCandle[]>;
  macroBias: MacroBiasDirection;
  macroBiasSource: 'supabase' | 'fallback';
  macroAnalyzedAt: string | null;
  livePrice: number | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  cooldownNotice: string | null;
  lastUpdatedAt: string | null;
  hasStoredApiKey: boolean;
  twelveDataStatus: TwelveDataStatus;
  twelveDataError: string | null;
  candleSource: ConfluenceCandleSource;
  isMarketOpen: boolean;
  marketStatusText: string;
  refresh: (force?: boolean) => Promise<void>;
  updateApiKeyAndReload: (newKey: string) => Promise<void>;
  loadSampleOrCachedCandles: () => void;
}

export function useCycleConfluenceData(
  tradingMode: TradingConfluenceMode,
  isEnabled: boolean = true
): CycleConfluenceDataState {
  const [candlesByTf, setCandlesByTf] = useState<Record<string, ConfluenceCandle[]>>(() => {
    const initial: Record<string, ConfluenceCandle[]> = {};
    for (const tf of MODE_TIMEFRAMES[tradingMode]) {
      const cached = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, tf);
      if (cached) initial[tf] = cached.candles;
    }
    return initial;
  });

  const [macroBias, setMacroBias] = useState<MacroBiasDirection>('MIXED');
  const [macroBiasSource, setMacroBiasSource] = useState<'supabase' | 'fallback'>('fallback');
  const [macroAnalyzedAt, setMacroAnalyzedAt] = useState<string | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(() => {
    const target = MODE_TIMEFRAMES[tradingMode];
    const lowestTf = target[target.length - 1];
    const cached = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, lowestTf);
    return cached && cached.candles.length > 0
      ? cached.candles[cached.candles.length - 1].close
      : null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownNotice, setCooldownNotice] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [hasStoredApiKey, setHasStoredApiKey] = useState<boolean>(() =>
    hasStoredTwelveDataKeyInLocalStorage()
  );
  const [twelveDataStatus, setTwelveDataStatus] = useState<TwelveDataStatus>(() =>
    hasStoredTwelveDataKeyInLocalStorage() ? 'ok' : 'missing_key'
  );
  const [twelveDataError, setTwelveDataError] = useState<string | null>(() =>
    hasStoredTwelveDataKeyInLocalStorage()
      ? null
      : 'API Key Twelve Data belum tersimpan di localStorage browser Anda.'
  );
  const [candleSource, setCandleSource] = useState<ConfluenceCandleSource>(() => {
    const target = MODE_TIMEFRAMES[tradingMode];
    const cached = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, target[target.length - 1]);
    return cached ? cached.source || 'cached' : 'none';
  });

  const currentMarketStatus = isMarketOpenForPair(XAU_PAIR.label);

  const lastManualRefreshRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(
    async (force: boolean = false, bypassCooldown: boolean = false) => {
      if (!isEnabled) return;

      const now = Date.now();
      if (force && !bypassCooldown && now - lastManualRefreshRef.current < REFRESH_COOLDOWN_MS) {
        const waitSec = Math.ceil(
          (REFRESH_COOLDOWN_MS - (now - lastManualRefreshRef.current)) / 1000
        );
        setCooldownNotice(
          `Tunggu ${waitSec} detik sebelum refresh ulang untuk menjaga kuota Twelve Data.`
        );
        return;
      }

      if (force) {
        lastManualRefreshRef.current = now;
        setCooldownNotice(null);
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      const keyPresent = hasStoredTwelveDataKeyInLocalStorage();
      setHasStoredApiKey(keyPresent);

      const marketStatusNow = isMarketOpenForPair(XAU_PAIR.label);
      const targetIntervals = MODE_TIMEFRAMES[tradingMode];
      const nextMap: Record<string, ConfluenceCandle[]> = {};
      const intervalsToFetch: TwelveDataConfluenceInterval[] = [];

      for (const tf of targetIntervals) {
        const cached = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, tf);
        const ttl = INTERVAL_CACHE_TTL_MS[tf];
        if (cached && cached.candles.length > 0) {
          nextMap[tf] = cached.candles;
        }
        // When XAU/USD market is closed on Saturday & Sunday, do NOT expire Friday close cache automatically
        const isExpiredOnWeekday = marketStatusNow.isOpen && (!cached || now - cached.fetchedAt > ttl);
        if (force || !cached || cached.candles.length === 0 || isExpiredOnWeekday) {
          intervalsToFetch.push(tf);
        }
      }

      // Immediately hydrate UI from valid Monday–Friday cache while fetching any missing/stale intervals
      if (Object.keys(nextMap).length > 0) {
        setCandlesByTf((prev) => ({ ...prev, ...nextMap }));
        const lowestTf = targetIntervals[targetIntervals.length - 1];
        const refCandles = nextMap[lowestTf] || nextMap[targetIntervals[0]];
        if (refCandles && refCandles.length > 0) {
          setLivePrice(refCandles[refCandles.length - 1].close);
        }
      }

      // If market is closed (Sabtu/Minggu) and all intervals already have valid Monday–Friday data up to Friday close
      // and this is not a forced manual refresh, only sync the macro bias from Supabase without polling live market ticks
      if (!marketStatusNow.isOpen && intervalsToFetch.length === 0 && !force) {
        const macroRes = await fetchLatestMacroBiasFromSupabase();
        if (controller.signal.aborted) return;
        setMacroBias(macroRes.bias);
        setMacroBiasSource(macroRes.source);
        setMacroAnalyzedAt(macroRes.analyzedAt);
        setLastUpdatedAt(new Date().toISOString());
        return;
      }

      if (force) {
        setIsRefreshing(true);
      } else if (intervalsToFetch.length > 0 && Object.keys(nextMap).length === 0) {
        setIsLoading(true);
      }
      setError(null);

      try {
        if (force) {
          memoryMacroCache = null;
        }

        // Run Supabase macro bias check in parallel so slow network never stalls candlestick fetching
        const macroPromise = fetchLatestMacroBiasFromSupabase();

        let latestErrorMsg: string | null = null;
        let hitRateLimit = false;
        let twelveDataSuccessCount = 0;
        let usedYahooWeekdayFallback = false;
        let usedCacheFallback = false;

        const intervalsNeedingFallback: TwelveDataConfluenceInterval[] = [];

        for (const tf of intervalsToFetch) {
          if (controller.signal.aborted) return;

          let fetchedFromTd = false;
          if (!hitRateLimit) {
            const res = await fetchTwelveDataTimeSeries(tf, controller.signal);
            if (controller.signal.aborted) return;

            if (res.candles.length > 0) {
              const entry: CachedTfEntry = {
                candles: res.candles,
                fetchedAt: Date.now(),
                source: 'twelvedata',
              };
              memoryCandleCache.set(getCacheKey(TWELVE_DATA_SYMBOL, tf), entry);
              writeLocalCandleCache(getCacheKey(TWELVE_DATA_SYMBOL, tf), entry);
              nextMap[tf] = res.candles;
              twelveDataSuccessCount++;
              fetchedFromTd = true;
            } else {
              if (res.rateLimited) hitRateLimit = true;
              if (res.errorMsg) latestErrorMsg = res.errorMsg;
            }
          }

          if (!fetchedFromTd) {
            intervalsNeedingFallback.push(tf);
          }
        }

        // Parallel real weekday Gold market fallback (Yahoo Finance GC=F, strictly Monday–Friday)
        // for any intervals that Twelve Data missed/rate-limited
        if (intervalsNeedingFallback.length > 0) {
          const fallbackResults = await Promise.allSettled(
            intervalsNeedingFallback.map(async (tf) => ({
              tf,
              candles: await fetchWeekdayYahooGoldCandles(tf, controller.signal),
            }))
          );
          if (controller.signal.aborted) return;

          for (const item of fallbackResults) {
            if (item.status === 'fulfilled') {
              const { tf, candles: weekdayGoldCandles } = item.value;
              if (weekdayGoldCandles.length > 0) {
                const entry: CachedTfEntry = {
                  candles: weekdayGoldCandles,
                  fetchedAt: Date.now(),
                  source: 'twelvedata',
                };
                memoryCandleCache.set(getCacheKey(TWELVE_DATA_SYMBOL, tf), entry);
                writeLocalCandleCache(getCacheKey(TWELVE_DATA_SYMBOL, tf), entry);
                nextMap[tf] = weekdayGoldCandles;
                usedYahooWeekdayFallback = true;
              } else if (nextMap[tf] && nextMap[tf].length > 0) {
                usedCacheFallback = true;
              }
            }
          }
        }

        const macroRes = await macroPromise;
        if (controller.signal.aborted) return;

        setMacroBias(macroRes.bias);
        setMacroBiasSource(macroRes.source);
        setMacroAnalyzedAt(macroRes.analyzedAt);
        setCandlesByTf((prev) => ({ ...prev, ...nextMap }));

        const lowestTf = targetIntervals[targetIntervals.length - 1];
        const lowestCandles =
          nextMap[lowestTf] || nextMap[targetIntervals[1]] || nextMap[targetIntervals[0]];
        if (lowestCandles && lowestCandles.length > 0) {
          setLivePrice(lowestCandles[lowestCandles.length - 1].close);
        }

        // Determine active candle source & Twelve Data banner state clearly
        if (twelveDataSuccessCount > 0 || usedYahooWeekdayFallback) {
          setCandleSource('twelvedata');
        } else if (usedCacheFallback || Object.keys(nextMap).length > 0) {
          setCandleSource('cached');
        } else {
          setCandleSource('none');
        }

        if (hitRateLimit) {
          setTwelveDataStatus('rate_limited');
          setTwelveDataError(
            latestErrorMsg ||
              'Kuota permintaan per menit Twelve Data tercapai (429).'
          );
        } else if (
          latestErrorMsg &&
          twelveDataSuccessCount === 0 &&
          !usedYahooWeekdayFallback &&
          intervalsToFetch.length > 0
        ) {
          setTwelveDataStatus(keyPresent ? 'error' : 'missing_key');
          setTwelveDataError(latestErrorMsg);
        } else if (!keyPresent) {
          setTwelveDataStatus('missing_key');
          setTwelveDataError(
            'API Key Twelve Data belum tersimpan di localStorage browser Anda (saat ini memakai kunci bawaan). Simpan API Key pribadi agar kuota tidak terbagi.'
          );
        } else {
          setTwelveDataStatus('ok');
          setTwelveDataError(null);
        }

        if (latestErrorMsg && Object.keys(nextMap).length === 0) {
          setError(latestErrorMsg);
        }

        setLastUpdatedAt(new Date().toISOString());
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          const msg = err?.message || 'Gagal memuat data pasar Twelve Data.';
          setError(msg);
          setTwelveDataStatus(keyPresent ? 'error' : 'missing_key');
          setTwelveDataError(msg);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [tradingMode, isEnabled]
  );

  useEffect(() => {
    if (!isEnabled) return;
    void loadData(false);
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [loadData, isEnabled]);

  const refresh = useCallback(
    async (force: boolean = true) => {
      await loadData(force, false);
    },
    [loadData]
  );

  const updateApiKeyAndReload = useCallback(
    async (newKey: string) => {
      saveStoredTwelveDataApiKey(newKey);
      const present = hasStoredTwelveDataKeyInLocalStorage();
      setHasStoredApiKey(present);
      for (const tf of ALL_CONFLUENCE_INTERVALS) {
        memoryCandleCache.delete(getCacheKey(TWELVE_DATA_SYMBOL, tf));
      }
      await loadData(true, true);
    },
    [loadData]
  );

  const loadSampleOrCachedCandles = useCallback(() => {
    const nextMap: Record<string, ConfluenceCandle[]> = {};
    let loadedCachedCount = 0;

    for (const tf of ALL_CONFLUENCE_INTERVALS) {
      const existingCached = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, tf);
      if (existingCached && existingCached.candles.length > 0) {
        nextMap[tf] = existingCached.candles;
        loadedCachedCount++;
        continue;
      }

      const tfMeta = getTfMeta(tf);
      const cached = loadCachedCandles(XAU_PAIR.symbol, tfMeta.value, XAU_PAIR.label);
      if (cached && cached.length > 0) {
        const cleaned = applyPairFiltersAndMarketHours(toConfluenceCandles(cached));
        if (cleaned.length > 0) {
          nextMap[tf] = cleaned;
          loadedCachedCount++;
          memoryCandleCache.set(getCacheKey(TWELVE_DATA_SYMBOL, tf), {
            candles: cleaned,
            fetchedAt: Date.now(),
            source: 'cached',
          });
        }
      }
    }

    if (loadedCachedCount > 0) {
      setCandlesByTf((prev) => ({ ...prev, ...nextMap }));
      const target = MODE_TIMEFRAMES[tradingMode];
      const refCandles = nextMap[target[target.length - 1]] || nextMap['1h'];
      if (refCandles && refCandles.length > 0) {
        setLivePrice(refCandles[refCandles.length - 1].close);
      }
      setCandleSource('cached');
      setError(null);
      setCooldownNotice(null);
      setLastUpdatedAt(new Date().toISOString());
    } else {
      // No local cache yet — fetch real weekday market data (Monday–Friday)
      void loadData(true, true);
    }
  }, [tradingMode, loadData]);

  return {
    candlesByTf,
    macroBias,
    macroBiasSource,
    macroAnalyzedAt,
    livePrice,
    isLoading,
    isRefreshing,
    error,
    cooldownNotice,
    lastUpdatedAt,
    hasStoredApiKey,
    twelveDataStatus,
    twelveDataError,
    candleSource,
    isMarketOpen: currentMarketStatus.isOpen,
    marketStatusText: currentMarketStatus.statusText,
    refresh,
    updateApiKeyAndReload,
    loadSampleOrCachedCandles,
  };
}
