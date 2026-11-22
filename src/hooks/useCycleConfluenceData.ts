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
import {
  fetchWithCorsProxy,
  fetchLiveIntermarketPulseBundle,
} from '../utils/macroFeedFetcher';
import { isMarketDay } from '../utils/date';
import {
  getApiEndpointCandidates,
  isNativeAndroidOrIos,
  isNewsCycleOfflineMode,
  nativeHttpGetText,
  NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT,
  NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY,
} from '../utils/apiConfig';
import {
  computeMacroThreeSystemState,
  ensureHistoricalActualsArchiveSeeded,
  loadLocalCachedMacroSnapshotSync,
  loadMonthlyNewsSpeechArchive,
  MACRO_ACTUALS_ARCHIVE_STORAGE_KEY,
  MACRO_LOCAL_SYNC_EVENT,
  MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY,
  MACRO_POST_NEWS_ARCHIVE_KEY,
  MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY,
  MACRO_SNAPSHOT_LOCAL_STORAGE_KEY,
  mergeBreakingHeadlinesForPulse,
  type MacroThreeSystemState,
} from '../utils/macroNewsEngine';
import type {
  ConfluenceCandle,
  MacroBiasDirection,
  RawMacroConfluenceContext,
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
  SCALP: ['4h', '1h', '15min', '5min'],
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
const XAU_GCF_BASIS_STORAGE_KEY = 'tradevault_xau_gcf_basis_v1';
const XAU_GCF_BASIS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedTfEntry {
  candles: ConfluenceCandle[];
  fetchedAt: number;
  source?: ConfluenceCandleSource;
  origin?: 'spot' | 'futures_calibrated' | 'futures_raw';
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
  )}&interval=${twelveInterval}&outputsize=150&timezone=UTC&apikey=${encodeURIComponent(
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
        return applyPairFiltersAndMarketHours(Array.from(buckets.values())).slice(-150);
      }

      return weekdayHourlyOrBase.slice(-150);
    } catch {
      return [];
    } finally {
      inFlightYahooGoldMap.delete(interval);
    }
  })();

  inFlightYahooGoldMap.set(interval, requestPromise);
  return requestPromise;
}

function getMacroSourceLabels(
  sourceSystem?: MacroThreeSystemState['effectiveSourceSystem']
): { id: string; en: string } {
  if (sourceSystem === 'SYSTEM_2_POST_NEWS') {
    return { id: 'Post-News (2J)', en: 'Post-News (2H)' };
  }
  if (sourceSystem === 'SYSTEM_1_PRE_NEWS') {
    return { id: 'Pre-News Lock (T-5M)', en: 'Pre-News Lock (T-5M)' };
  }
  return { id: 'Berita & Speech (Live)', en: 'Live News & Speech' };
}

function buildRawMacroConfluenceContext(
  fundamentalBias: MacroBiasDirection,
  intermarketBundle: Awaited<ReturnType<typeof fetchLiveIntermarketPulseBundle>> | null,
  options?: {
    sourceSystem?: MacroThreeSystemState['effectiveSourceSystem'];
    speechHeadline?: string | null;
    localMacro?: ReturnType<typeof loadLocalCachedMacroSnapshotSync>;
  }
): RawMacroConfluenceContext {
  const localMacro = options?.localMacro ?? loadLocalCachedMacroSnapshotSync();
  const speechHeadlineFromBreaking = localMacro?.breakingNews?.find(
    (b) => b.channelType === 'FED_SPEECH'
  )?.title;
  const fundamentalSpeechHeadline =
    options?.speechHeadline ||
    speechHeadlineFromBreaking ||
    localMacro?.topBreakingAlert?.title ||
    localMacro?.scenarioMatrix?.fedSpeechAlertNoteId ||
    localMacro?.scenarioMatrix?.primaryEvent?.title ||
    (fundamentalBias === 'BUY'
      ? 'Fundamental USD Dovish / Bullish Gold'
      : fundamentalBias === 'SELL'
      ? 'Fundamental USD Hawkish / Bearish Gold'
      : 'Fundamental & Speech Netral / Menunggu Rilis');

  const sourceInter = intermarketBundle || localMacro?.intermarketPulse;
  const dxyRow = sourceInter?.dxy
    ? {
        key: 'DXY',
        lastPrice: sourceInter.dxy.price,
        changePct: sourceInter.dxy.changePercent,
        goldCorrelationEffect: sourceInter.dxy.goldCorrelationEffect,
      }
    : undefined;
  const oilRow = sourceInter?.usoil
    ? {
        key: 'USOIL',
        lastPrice: sourceInter.usoil.price,
        changePct: sourceInter.usoil.changePercent,
        goldCorrelationEffect: sourceInter.usoil.goldCorrelationEffect,
      }
    : undefined;
  const us10yRow = sourceInter?.us10y
    ? {
        key: 'US10Y',
        lastPrice: sourceInter.us10y.price,
        changePct: sourceInter.us10y.changePercent,
        goldCorrelationEffect: sourceInter.us10y.goldCorrelationEffect,
      }
    : undefined;
  const us02yRow = sourceInter?.us02y
    ? {
        key: 'US02Y',
        lastPrice: sourceInter.us02y.price,
        changePct: sourceInter.us02y.changePercent,
        goldCorrelationEffect: sourceInter.us02y.goldCorrelationEffect,
      }
    : undefined;

  const effectiveTickers = [dxyRow, oilRow, us10yRow, us02yRow].filter(
    (r): r is NonNullable<typeof r> => Boolean(r)
  );

  let bullishVotes = 0;
  let bearishVotes = 0;
  for (const t of effectiveTickers) {
    if (t.goldCorrelationEffect === 'BULLISH_GOLD') bullishVotes += t.key === 'DXY' ? 2 : 1;
    else if (t.goldCorrelationEffect === 'BEARISH_GOLD') bearishVotes += t.key === 'DXY' ? 2 : 1;
  }

  const intermarketEffectOnGold: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL' =
    bullishVotes > bearishVotes
      ? 'BULLISH_GOLD'
      : bearishVotes > bullishVotes
      ? 'BEARISH_GOLD'
      : 'NEUTRAL';

  const fundScore = fundamentalBias === 'BUY' ? 78 : fundamentalBias === 'SELL' ? 22 : 50;
  const interScore =
    intermarketEffectOnGold === 'BULLISH_GOLD'
      ? 76
      : intermarketEffectOnGold === 'BEARISH_GOLD'
      ? 24
      : 50;

  const stagflationBonus =
    localMacro?.scenarioMatrix?.preNewsFlow?.marketSentiment?.stagflationDetected ? 4 : 0;
  const rawMacroScore = Math.min(100, Math.round(fundScore * 0.5 + interScore * 0.5) + stagflationBonus);
  const rawMacroBias: MacroBiasDirection =
    rawMacroScore >= 58 ? 'BUY' : rawMacroScore <= 42 ? 'SELL' : 'MIXED';

  const dxyLabel =
    dxyRow && dxyRow.changePct !== null
      ? `DXY ${dxyRow.changePct >= 0 ? '+' : ''}${dxyRow.changePct.toFixed(2)}%`
      : 'DXY —';
  const oilLabel =
    oilRow && oilRow.changePct !== null
      ? `OIL ${oilRow.changePct >= 0 ? '+' : ''}${oilRow.changePct.toFixed(2)}%`
      : 'OIL —';
  const us10yLabel =
    us10yRow && us10yRow.changePct !== null
      ? `US10Y ${us10yRow.changePct >= 0 ? '+' : ''}${us10yRow.changePct.toFixed(2)}%`
      : 'US10Y —';
  const us02yLabel =
    us02yRow && us02yRow.changePct !== null
      ? `US02Y ${us02yRow.changePct >= 0 ? '+' : ''}${us02yRow.changePct.toFixed(2)}%`
      : 'US02Y —';

  const srcLabels = getMacroSourceLabels(options?.sourceSystem);

  return {
    fundamentalBias,
    fundamentalSpeechHeadline,
    dxyPrice: dxyRow?.lastPrice ?? null,
    dxyChangePct: dxyRow?.changePct ?? null,
    oilPrice: oilRow?.lastPrice ?? null,
    oilChangePct: oilRow?.changePct ?? null,
    us10yPrice: us10yRow?.lastPrice ?? null,
    us10yChangePct: us10yRow?.changePct ?? null,
    us02yPrice: us02yRow?.lastPrice ?? null,
    us02yChangePct: us02yRow?.changePct ?? null,
    intermarketEffectOnGold,
    rawMacroBias,
    combinedRawBias: rawMacroBias,
    rawMacroScore,
    rawMacroSummaryId: `Data Mentah: Fundamental (${fundamentalBias} · ${srcLabels.id}) + [${dxyLabel} · ${oilLabel} · ${us10yLabel} · ${us02yLabel}] → Bias Mentah ${rawMacroBias} (Belum 100%, wajib validasi struktur chart).`,
    rawMacroSummaryEn: `Raw Data: Fundamental (${fundamentalBias} · ${srcLabels.en}) + [${dxyLabel} · ${oilLabel} · ${us10yLabel} · ${us02yLabel}] → Raw Bias ${rawMacroBias} (Not 100% until validated by chart structure).`,
    macroSourceSystem: options?.sourceSystem,
    macroSourceLabelId: srcLabels.id,
    macroSourceLabelEn: srcLabels.en,
  };
}

/**
 * Resolves the authoritative macro fundamental context by comparing remote Supabase macro cache
 * against the local 3-System Trade News engine (Pre-News T-5M Lock, Post-News 2H, Live News & Speech 1-month archive).
 * Ensures fresh offline/APK System 2 & System 3 shifts are NEVER overwritten by stale Supabase rows.
 */
export function resolveSyncedMacroContext(
  remoteMacro: {
    bias: MacroBiasDirection;
    analyzedAt: string | null;
    source: 'supabase' | 'fallback';
  } | null,
  intermarketBundle: Awaited<ReturnType<typeof fetchLiveIntermarketPulseBundle>> | null,
  nowMs: number = Date.now()
): {
  macroBias: MacroBiasDirection;
  effectiveFundamentalBias: MacroBiasDirection;
  analyzedAt: string | null;
  source: 'supabase' | 'fallback';
  rawMacroContext: RawMacroConfluenceContext;
} {
  const localMacro = loadLocalCachedMacroSnapshotSync();
  const monthlyArchive = loadMonthlyNewsSpeechArchive(nowMs);
  const mergedBreaking = mergeBreakingHeadlinesForPulse(
    localMacro?.breakingNews || [],
    monthlyArchive.items || []
  );

  let threeSystem: MacroThreeSystemState | null = null;
  if (localMacro) {
    threeSystem = computeMacroThreeSystemState({
      snapshot: {
        ...localMacro,
        breakingNews: mergedBreaking,
        topBreakingAlert: mergedBreaking[0] || localMacro.topBreakingAlert,
      },
      nowMs,
    });
  }

  const localSnapMs = localMacro?.analyzedAt ? Date.parse(localMacro.analyzedAt) : 0;
  const archiveUpdatedMs =
    monthlyArchive.items.length > 0 && monthlyArchive.updatedAt
      ? Date.parse(monthlyArchive.updatedAt)
      : 0;
  const postNewsArchivedMs = threeSystem?.system2PostNews?.archivedAt
    ? Date.parse(threeSystem.system2PostNews.archivedAt)
    : 0;
  const localFreshMs = Math.max(
    Number.isFinite(localSnapMs) ? localSnapMs : 0,
    Number.isFinite(archiveUpdatedMs) ? archiveUpdatedMs : 0,
    Number.isFinite(postNewsArchivedMs) ? postNewsArchivedMs : 0
  );
  const remoteFreshMs = remoteMacro?.analyzedAt ? Date.parse(remoteMacro.analyzedAt) : 0;

  const preferRemote = Boolean(
    remoteMacro &&
      remoteMacro.source === 'supabase' &&
      remoteMacro.bias !== 'MIXED' &&
      (!threeSystem ||
        (threeSystem.effectiveSourceSystem !== 'SYSTEM_2_POST_NEWS' &&
          Number.isFinite(remoteFreshMs) &&
          remoteFreshMs > localFreshMs + 60_000))
  );

  const effectiveFundamentalBias: MacroBiasDirection = preferRemote
    ? remoteMacro!.bias
    : threeSystem
    ? threeSystem.effectiveFundamentalBias
    : localMacro && (localMacro.dominantBias === 'BUY' || localMacro.dominantBias === 'SELL')
    ? localMacro.dominantBias
    : remoteMacro?.bias || 'MIXED';

  const topSpeech =
    mergedBreaking.find((b) => b.channelType === 'FED_SPEECH') ||
    mergedBreaking[0] ||
    null;

  const builtRawMacro = buildRawMacroConfluenceContext(effectiveFundamentalBias, intermarketBundle, {
    sourceSystem: preferRemote ? undefined : threeSystem?.effectiveSourceSystem,
    speechHeadline:
      threeSystem?.system3LivePulse?.topCatalystTitle &&
      threeSystem.effectiveSourceSystem === 'SYSTEM_3_LIVE_PULSE'
        ? threeSystem.system3LivePulse.topCatalystTitle
        : topSpeech?.title || null,
    localMacro,
  });

  const resolvedBias: MacroBiasDirection =
    builtRawMacro.rawMacroBias !== 'MIXED' ? builtRawMacro.rawMacroBias : effectiveFundamentalBias;

  return {
    macroBias: resolvedBias,
    effectiveFundamentalBias,
    analyzedAt: preferRemote
      ? remoteMacro?.analyzedAt || localMacro?.analyzedAt || null
      : localMacro?.analyzedAt || remoteMacro?.analyzedAt || null,
    source: preferRemote ? 'supabase' : remoteMacro?.source || 'fallback',
    rawMacroContext: builtRawMacro,
  };
}

export interface CycleConfluenceDataState {
  candlesByTf: Record<string, ConfluenceCandle[]>;
  macroBias: MacroBiasDirection;
  macroBiasSource: 'supabase' | 'fallback';
  macroAnalyzedAt: string | null;
  rawMacroContext: RawMacroConfluenceContext;
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
  isOfflineMode: boolean;
  refresh: (force?: boolean) => Promise<boolean>;
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

  const initialMacro = resolveSyncedMacroContext(null, null);
  const [macroBias, setMacroBias] = useState<MacroBiasDirection>(() => initialMacro.macroBias);
  const [macroBiasSource, setMacroBiasSource] = useState<'supabase' | 'fallback'>(
    () => initialMacro.source
  );
  const [macroAnalyzedAt, setMacroAnalyzedAt] = useState<string | null>(
    () => initialMacro.analyzedAt
  );
  const [rawMacroContext, setRawMacroContext] = useState<RawMacroConfluenceContext>(
    () => initialMacro.rawMacroContext
  );
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
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() => isNewsCycleOfflineMode());

  const syncMacroFromLocalArchive = useCallback(() => {
    const synced = resolveSyncedMacroContext(null, null);
    setMacroBias(synced.macroBias);
    setMacroAnalyzedAt(synced.analyzedAt);
    setRawMacroContext(synced.rawMacroContext);
  }, []);

  useEffect(() => {
    ensureHistoricalActualsArchiveSeeded();
    const syncOffline = () => setIsOfflineMode(isNewsCycleOfflineMode());
    const handleStorage = (e: StorageEvent) => {
      if (e.key === NEWS_CYCLE_OFFLINE_MODE_STORAGE_KEY) {
        syncOffline();
      } else if (
        e.key === MACRO_SNAPSHOT_LOCAL_STORAGE_KEY ||
        e.key === MACRO_ACTUALS_ARCHIVE_STORAGE_KEY ||
        e.key === MACRO_MONTHLY_NEWS_SPEECH_ARCHIVE_KEY ||
        e.key === MACRO_POST_NEWS_ARCHIVE_KEY ||
        e.key === MACRO_PRE_NEWS_LOCK_ARCHIVE_KEY
      ) {
        syncMacroFromLocalArchive();
      }
    };
    window.addEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, syncOffline);
    window.addEventListener(MACRO_LOCAL_SYNC_EVENT, syncMacroFromLocalArchive);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(NEWS_CYCLE_OFFLINE_MODE_CHANGE_EVENT, syncOffline);
      window.removeEventListener(MACRO_LOCAL_SYNC_EVENT, syncMacroFromLocalArchive);
      window.removeEventListener('storage', handleStorage);
    };
  }, [syncMacroFromLocalArchive]);

  const lastManualRefreshRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(
    async (force: boolean = false, bypassCooldown: boolean = false): Promise<boolean> => {
      if (!isEnabled) return false;

      // Offline Mode (News & Cycle): strictly read local cache only, 0 API/network/Gemini calls
      if (isOfflineMode || isNewsCycleOfflineMode()) {
        const targetIntervals = MODE_TIMEFRAMES[tradingMode];
        const nextMap: Record<string, ConfluenceCandle[]> = {};
        for (const tf of targetIntervals) {
          const cached = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, tf);
          if (cached && cached.candles.length > 0) {
            nextMap[tf] = cached.candles;
          }
        }
        if (Object.keys(nextMap).length > 0) {
          setCandlesByTf((prev) => ({ ...prev, ...nextMap }));
          const lowestTf = targetIntervals[targetIntervals.length - 1];
          const refCandles = nextMap[lowestTf] || nextMap[targetIntervals[0]];
          if (refCandles && refCandles.length > 0) {
            setLivePrice(refCandles[refCandles.length - 1].close);
          }
          setCandleSource('cached');
        } else {
          setCandleSource('none');
        }

        const syncedOfflineMacro = resolveSyncedMacroContext(null, null);
        setMacroBias(syncedOfflineMacro.macroBias);
        setMacroAnalyzedAt(syncedOfflineMacro.analyzedAt);
        setRawMacroContext(syncedOfflineMacro.rawMacroContext);
        setMacroBiasSource('fallback');
        setError(null);
        setTwelveDataError(null);
        setCooldownNotice(
          force
            ? 'Mode Offline aktif: data terbaru tidak diambil. Nonaktifkan Mode Offline untuk sinkronisasi online.'
            : null
        );
        setIsLoading(false);
        setIsRefreshing(false);
        return false;
      }

      const now = Date.now();
      if (force && !bypassCooldown && now - lastManualRefreshRef.current < REFRESH_COOLDOWN_MS) {
        const waitSec = Math.ceil(
          (REFRESH_COOLDOWN_MS - (now - lastManualRefreshRef.current)) / 1000
        );
        setCooldownNotice(
          `Tunggu ${waitSec} detik sebelum refresh ulang untuk menjaga kuota Twelve Data.`
        );
        return false;
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
        const [macroRes, intermarketBundle] = await Promise.all([
          fetchLatestMacroBiasFromSupabase(),
          fetchLiveIntermarketPulseBundle().catch(() => null),
        ]);
        if (controller.signal.aborted) return false;
        const syncedWeekendMacro = resolveSyncedMacroContext(macroRes, intermarketBundle);
        setMacroBias(syncedWeekendMacro.macroBias);
        setMacroBiasSource(syncedWeekendMacro.source);
        setMacroAnalyzedAt(syncedWeekendMacro.analyzedAt);
        setRawMacroContext(syncedWeekendMacro.rawMacroContext);
        setLastUpdatedAt(new Date().toISOString());
        return true;
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

        // Run Supabase macro bias + Live Intermarket (DXY, OIL, US10Y, US02Y) in parallel
        const macroPromise = fetchLatestMacroBiasFromSupabase();
        const intermarketPromise = fetchLiveIntermarketPulseBundle().catch(() => null);

        let latestErrorMsg: string | null = null;
        let hitRateLimit = false;
        let twelveDataSuccessCount = 0;
        let usedYahooWeekdayFallback = false;
        let usedCacheFallback = false;

        const intervalsNeedingFallback: TwelveDataConfluenceInterval[] = [];

        for (const tf of intervalsToFetch) {
          if (controller.signal.aborted) return false;

          let fetchedFromTd = false;
          if (!hitRateLimit) {
            const res = await fetchTwelveDataTimeSeries(tf, controller.signal);
            if (controller.signal.aborted) return false;

            if (res.candles.length > 0) {
              const entry: CachedTfEntry = {
                candles: res.candles,
                fetchedAt: Date.now(),
                source: 'twelvedata',
                origin: 'spot',
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
        // for any intervals that Twelve Data missed/rate-limited, calibrated against Spot XAU/USD basis
        if (intervalsNeedingFallback.length > 0) {
          const fallbackResults = await Promise.allSettled(
            intervalsNeedingFallback.map(async (tf) => ({
              tf,
              candles: await fetchWeekdayYahooGoldCandles(tf, controller.signal),
            }))
          );
          if (controller.signal.aborted) return false;

          // Collect all known Spot XAU/USD candles (either freshly fetched or cached spot) for basis alignment
          const spotRefBars: ConfluenceCandle[] = [];
          for (const tf of ALL_CONFLUENCE_INTERVALS) {
            const cachedEntry = hydrateMemoryCacheFromLocal(TWELVE_DATA_SYMBOL, tf);
            if (
              (cachedEntry?.origin === 'spot' || (!cachedEntry?.origin && cachedEntry?.source === 'twelvedata')) &&
              cachedEntry?.candles?.length
            ) {
              spotRefBars.push(...cachedEntry.candles.slice(-60));
            }
          }

          let resolvedBasisOffset = 0;
          let hasFreshBasis = false;
          if (spotRefBars.length > 0) {
            const diffs: number[] = [];
            for (const item of fallbackResults) {
              if (item.status !== 'fulfilled' || item.value.candles.length === 0) continue;
              const gcBars = item.value.candles;
              for (let i = Math.max(0, gcBars.length - 12); i < gcBars.length; i++) {
                const gc = gcBars[i];
                let nearestSpot: ConfluenceCandle | null = null;
                let nearestDt = Infinity;
                for (const sp of spotRefBars) {
                  const dt = Math.abs(sp.time - gc.time);
                  if (dt < nearestDt && dt <= 7200) {
                    nearestDt = dt;
                    nearestSpot = sp;
                  }
                }
                if (nearestSpot && nearestSpot.close > 0 && gc.close > 0) {
                  const d = nearestSpot.close - gc.close;
                  if (Math.abs(d) <= 80) diffs.push(d);
                }
              }
            }
            if (diffs.length > 0) {
              diffs.sort((a, b) => a - b);
              resolvedBasisOffset = Number(diffs[Math.floor(diffs.length / 2)].toFixed(2));
              hasFreshBasis = true;
              try {
                window.localStorage.setItem(
                  XAU_GCF_BASIS_STORAGE_KEY,
                  JSON.stringify({ offset: resolvedBasisOffset, updatedAt: Date.now() })
                );
              } catch {}
            }
          }

          if (!hasFreshBasis && typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
            try {
              const rawBasis = window.localStorage.getItem(XAU_GCF_BASIS_STORAGE_KEY);
              if (rawBasis) {
                const parsedBasis = JSON.parse(rawBasis);
                if (
                  typeof parsedBasis?.offset === 'number' &&
                  Number.isFinite(parsedBasis.offset) &&
                  Math.abs(parsedBasis.offset) <= 80 &&
                  typeof parsedBasis?.updatedAt === 'number' &&
                  Date.now() - parsedBasis.updatedAt <= XAU_GCF_BASIS_MAX_AGE_MS
                ) {
                  resolvedBasisOffset = parsedBasis.offset;
                  hasFreshBasis = true;
                }
              }
            } catch {}
          }

          for (const item of fallbackResults) {
            if (item.status === 'fulfilled') {
              const { tf, candles: rawGcCandles } = item.value;
              if (rawGcCandles.length > 0) {
                const weekdayGoldCandles =
                  hasFreshBasis && Math.abs(resolvedBasisOffset) > 0.01
                    ? rawGcCandles.map((c) => ({
                        ...c,
                        open: Number((c.open + resolvedBasisOffset).toFixed(XAU_PAIR.decimals)),
                        high: Number((c.high + resolvedBasisOffset).toFixed(XAU_PAIR.decimals)),
                        low: Number((c.low + resolvedBasisOffset).toFixed(XAU_PAIR.decimals)),
                        close: Number((c.close + resolvedBasisOffset).toFixed(XAU_PAIR.decimals)),
                      }))
                    : rawGcCandles;
                const entry: CachedTfEntry = {
                  candles: weekdayGoldCandles,
                  fetchedAt: Date.now(),
                  source: 'twelvedata',
                  origin: hasFreshBasis ? 'futures_calibrated' : 'futures_raw',
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

        const [macroRes, intermarketBundle] = await Promise.all([
          macroPromise,
          intermarketPromise,
        ]);
        if (controller.signal.aborted) return false;

        const syncedMacro = resolveSyncedMacroContext(macroRes, intermarketBundle);
        setMacroBias(syncedMacro.macroBias);
        setMacroBiasSource(syncedMacro.source);
        setMacroAnalyzedAt(syncedMacro.analyzedAt);
        setRawMacroContext(syncedMacro.rawMacroContext);
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
        return true;
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          const msg = err?.message || 'Gagal memuat data pasar Twelve Data.';
          setError(msg);
          setTwelveDataStatus(keyPresent ? 'error' : 'missing_key');
          setTwelveDataError(msg);
        }
        return false;
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [tradingMode, isEnabled, isOfflineMode]
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

  // Real-time auto-refresh for Scalping mode (every 90 seconds when market is open & online)
  useEffect(() => {
    if (!isEnabled || isOfflineMode || tradingMode !== 'SCALP') return;
    const intervalId = window.setInterval(() => {
      const mStatus = isMarketOpenForPair(XAU_PAIR.label);
      if (mStatus.isOpen && !isNewsCycleOfflineMode()) {
        void loadData(false);
      }
    }, 90 * 1000);
    return () => window.clearInterval(intervalId);
  }, [isEnabled, isOfflineMode, tradingMode, loadData]);

  const refresh = useCallback(
    async (force: boolean = true): Promise<boolean> => {
      return await loadData(force, false);
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
    rawMacroContext,
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
    isOfflineMode,
    refresh,
    updateApiKeyAndReload,
    loadSampleOrCachedCandles,
  };
}
