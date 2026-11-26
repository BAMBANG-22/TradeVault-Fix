/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BarRange,
  DataProvider,
  OHLCV,
  ProviderInfo,
  SymbolDescriptor,
  SymbolInfo,
} from '@luxalgo/vela';
import {
  buildBackendAuthHeaders,
  getApiEndpointCandidates,
  isNativeAndroidOrIos,
  isNewsCycleOfflineMode,
  nativeHttpGetText,
} from './apiConfig';

export type VelaFeedSourceKind = 'binance' | 'twelvedata' | 'cache' | 'unavailable';
export type VelaFeedPreference = 'twelvedata' | 'binance';

export interface VelaFeedStatus {
  source: VelaFeedSourceKind;
  ticker: string;
  timeframe: string;
  barCount: number;
  updatedAt: number;
  note?: string;
}

interface TradeVaultVelaSymbolMeta {
  ticker: string;
  description: string;
  type: 'commodity' | 'crypto' | 'forex';
  tradeVaultSymbol: string;
  binanceSymbol: string | null;
  twelveDataSymbol: string | null;
  decimals: number;
  is24x7: boolean;
}

export const TRADEVAULT_VELA_SYMBOLS: readonly TradeVaultVelaSymbolMeta[] = [
  {
    ticker: 'XAUUSD',
    description: 'Gold / US Dollar (Twelve Data Spot / PAXG Fallback)',
    type: 'commodity',
    tradeVaultSymbol: 'OANDA:XAUUSD',
    binanceSymbol: 'PAXGUSDT',
    twelveDataSymbol: 'XAU/USD',
    decimals: 2,
    is24x7: false,
  },
  {
    ticker: 'BTCUSD',
    description: 'Bitcoin / US Dollar (Binance / Twelve Data)',
    type: 'crypto',
    tradeVaultSymbol: 'BINANCE:BTCUSDT',
    binanceSymbol: 'BTCUSDT',
    twelveDataSymbol: 'BTC/USD',
    decimals: 2,
    is24x7: true,
  },
  {
    ticker: 'ETHUSD',
    description: 'Ethereum / US Dollar (Binance / Twelve Data)',
    type: 'crypto',
    tradeVaultSymbol: 'BINANCE:ETHUSDT',
    binanceSymbol: 'ETHUSDT',
    twelveDataSymbol: 'ETH/USD',
    decimals: 2,
    is24x7: true,
  },
  {
    ticker: 'EURUSD',
    description: 'Euro / US Dollar (Twelve Data Spot)',
    type: 'forex',
    tradeVaultSymbol: 'OANDA:EURUSD',
    binanceSymbol: 'EURUSDT',
    twelveDataSymbol: 'EUR/USD',
    decimals: 5,
    is24x7: false,
  },
  {
    ticker: 'GBPUSD',
    description: 'British Pound / US Dollar (Twelve Data Spot)',
    type: 'forex',
    tradeVaultSymbol: 'OANDA:GBPUSD',
    binanceSymbol: 'GBPUSDT',
    twelveDataSymbol: 'GBP/USD',
    decimals: 5,
    is24x7: false,
  },
  {
    ticker: 'USDIDR',
    description: 'US Dollar / Indonesian Rupiah (Twelve Data Spot)',
    type: 'forex',
    tradeVaultSymbol: 'FX_IDC:USDIDR',
    binanceSymbol: null,
    twelveDataSymbol: 'USD/IDR',
    decimals: 0,
    is24x7: false,
  },
];

const SUPPORTED_VELA_TIMEFRAMES = ['1', '3', '5', '15', '30', '60', '240', '1D'] as const;

const TWELVE_DATA_KEY_STORAGE = 'tradevault_twelve_data_api_key_v1';
const CANDLE_CACHE_PREFIX = 'tradevault_candle_cache_v5_';
const MEMORY_CACHE_TTL_MS = 45_000;

interface MemoryBarsEntry {
  bars: OHLCV[];
  source: 'binance' | 'twelvedata';
  savedAt: number;
  note?: string;
}

function getTwelveDataKey(): string {
  const envKey =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TWELVE_DATA_API_KEY) ||
    'cb5797ff73ff4ab79260ef8202a66739';
  if (typeof window === 'undefined') return String(envKey || '');
  try {
    const stored = window.localStorage.getItem(TWELVE_DATA_KEY_STORAGE);
    if (stored && stored.trim().length > 5) return stored.trim();
  } catch {
    // ignore storage errors
  }
  return String(envKey || '');
}

function normalizeVelaTimeframe(raw: string): {
  velaTf: string;
  binanceInterval: string;
  twelveDataInterval: string;
  cacheInterval: string;
} {
  const upper = String(raw || '60').trim().toUpperCase();
  if (upper === '1' || upper === '1M') {
    return { velaTf: '1', binanceInterval: '1m', twelveDataInterval: '1min', cacheInterval: '1' };
  }
  if (upper === '3' || upper === '3M') {
    return { velaTf: '3', binanceInterval: '3m', twelveDataInterval: '5min', cacheInterval: '3' };
  }
  if (upper === '5' || upper === '5M') {
    return { velaTf: '5', binanceInterval: '5m', twelveDataInterval: '5min', cacheInterval: '5' };
  }
  if (upper === '15' || upper === '15M') {
    return { velaTf: '15', binanceInterval: '15m', twelveDataInterval: '15min', cacheInterval: '15' };
  }
  if (upper === '30' || upper === '30M') {
    return { velaTf: '30', binanceInterval: '30m', twelveDataInterval: '30min', cacheInterval: '30' };
  }
  if (upper === '60' || upper === '1H') {
    return { velaTf: '60', binanceInterval: '1h', twelveDataInterval: '1h', cacheInterval: '60' };
  }
  if (upper === '240' || upper === '4H') {
    return { velaTf: '240', binanceInterval: '4h', twelveDataInterval: '4h', cacheInterval: '240' };
  }
  if (upper === '1D' || upper === 'D') {
    return { velaTf: '1D', binanceInterval: '1d', twelveDataInterval: '1day', cacheInterval: 'D' };
  }
  if (upper === '1W' || upper === 'W') {
    return { velaTf: '1W', binanceInterval: '1w', twelveDataInterval: '1week', cacheInterval: 'W' };
  }
  return { velaTf: '60', binanceInterval: '1h', twelveDataInterval: '1h', cacheInterval: '60' };
}

export function mapTradeVaultSymbolToVela(rawSymbol: string): string {
  const cleaned = String(rawSymbol || 'XAUUSD')
    .trim()
    .toUpperCase()
    .replace(/^.*:/, '');
  if (cleaned === 'BTCUSDT' || cleaned === 'BTCUSD') return 'tradevault:BTCUSD';
  if (cleaned === 'ETHUSDT' || cleaned === 'ETHUSD') return 'tradevault:ETHUSD';
  if (cleaned === 'EURUSD' || cleaned === 'EURUSDT') return 'tradevault:EURUSD';
  if (cleaned === 'GBPUSD' || cleaned === 'GBPUSDT') return 'tradevault:GBPUSD';
  if (cleaned === 'USDIDR') return 'tradevault:USDIDR';
  if (cleaned === 'XAUUSD' || cleaned === 'PAXGUSDT') return 'tradevault:XAUUSD';
  return `tradevault:${cleaned || 'XAUUSD'}`;
}

export function mapTradeVaultIntervalToVela(rawInterval: string): string {
  return normalizeVelaTimeframe(rawInterval).velaTf;
}

function findSymbolMeta(ticker: string): TradeVaultVelaSymbolMeta {
  const clean = String(ticker || 'XAUUSD')
    .trim()
    .toUpperCase()
    .replace(/^.*:/, '');

  const exact = TRADEVAULT_VELA_SYMBOLS.find(
    (item) =>
      item.ticker === clean ||
      item.binanceSymbol === clean ||
      item.tradeVaultSymbol.toUpperCase().endsWith(`:${clean}`)
  );
  if (exact) return exact;

  return {
    ticker: clean || 'XAUUSD',
    description: `${clean || 'XAUUSD'} Market`,
    type: clean.endsWith('USDT') ? 'crypto' : 'forex',
    tradeVaultSymbol: `OANDA:${clean || 'XAUUSD'}`,
    binanceSymbol: clean.endsWith('USDT') ? clean : null,
    twelveDataSymbol:
      clean.length === 6 ? `${clean.slice(0, 3)}/${clean.slice(3)}` : null,
    decimals: clean.includes('JPY') || clean.includes('XAU') ? 2 : clean.includes('IDR') ? 0 : 5,
    is24x7: clean.includes('BTC') || clean.includes('ETH') || clean.includes('SOL') || clean.endsWith('USDT'),
  };
}

function isWeekendBar(timeMs: number, is24x7: boolean): boolean {
  if (is24x7) return false;
  const d = new Date(timeMs);
  const utcDay = d.getUTCDay();
  const utcHour = d.getUTCHours();
  if (utcDay === 6 || utcDay === 0) return true;
  if (utcDay === 5 && utcHour >= 22) return true;
  return false;
}

function sanitizeVelaBars(bars: OHLCV[], is24x7: boolean, range?: BarRange): OHLCV[] {
  const filtered: OHLCV[] = [];
  for (const bar of bars) {
    if (
      !bar ||
      !Number.isFinite(bar.time) ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      continue;
    }
    if (bar.open === bar.high && bar.high === bar.low && bar.low === bar.close) {
      continue;
    }
    if (isWeekendBar(bar.time, is24x7)) {
      continue;
    }
    if (range?.from !== undefined && Number.isFinite(range.from) && bar.time < range.from) {
      continue;
    }
    if (range?.to !== undefined && Number.isFinite(range.to) && bar.time > range.to) {
      continue;
    }
    filtered.push(bar);
  }

  filtered.sort((a, b) => a.time - b.time);

  const deduped: OHLCV[] = [];
  let lastTime = -1;
  for (const bar of filtered) {
    if (bar.time !== lastTime) {
      deduped.push(bar);
      lastTime = bar.time;
    } else if (deduped.length > 0) {
      deduped[deduped.length - 1] = bar;
    }
  }

  if (range?.limit && range.limit > 0 && deduped.length > range.limit) {
    return deduped.slice(-range.limit);
  }

  return deduped;
}

async function fetchJsonNativeSafe<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const proxyCandidates = getApiEndpointCandidates('/api/proxy').map(
    (base) => `${base}?url=${encodeURIComponent(url)}`
  );

  // 1. Native Android/iOS APK: direct CapacitorHttp first (zero CORS), then /api/proxy fallback
  //    (bypasses ISP DNS blocks on api.binance.com or flaky mobile carrier routes).
  if (isNativeAndroidOrIos()) {
    const directText = await nativeHttpGetText(url, timeoutMs, 'application/json, */*');
    if (directText) {
      try {
        return JSON.parse(directText) as T;
      } catch {
        // fall through to proxy candidates
      }
    }

    for (const proxyUrl of proxyCandidates) {
      const proxyText = await nativeHttpGetText(proxyUrl, timeoutMs, 'application/json, */*');
      if (!proxyText) continue;
      try {
        return JSON.parse(proxyText) as T;
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  // 2. Web browser: try direct fetch first, then backend /api/proxy fallback
  const tryWebFetch = async (target: string, headers?: Record<string, string>): Promise<T | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json', ...(headers || {}) },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const directJson = await tryWebFetch(url);
  if (directJson !== null) return directJson;

  for (const proxyUrl of proxyCandidates) {
    const proxyJson = await tryWebFetch(proxyUrl, buildBackendAuthHeaders(proxyUrl));
    if (proxyJson !== null) return proxyJson;
  }

  return null;
}

function readTradeVaultCandleCache(meta: TradeVaultVelaSymbolMeta, cacheInterval: string): OHLCV[] {
  if (typeof window === 'undefined') return [];
  try {
    const cacheKey = `${CANDLE_CACHE_PREFIX}${meta.tradeVaultSymbol.toUpperCase()}_${cacheInterval}`;
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const bars: OHLCV[] = [];
    for (const row of parsed) {
      const tSec = Number(row?.time);
      const o = Number(row?.open);
      const h = Number(row?.high);
      const l = Number(row?.low);
      const c = Number(row?.close);
      if (
        !Number.isFinite(tSec) ||
        !Number.isFinite(o) ||
        !Number.isFinite(h) ||
        !Number.isFinite(l) ||
        !Number.isFinite(c)
      ) {
        continue;
      }
      // TradeVault cache stores UTCTimestamp in seconds; Vela requires epoch milliseconds.
      const timeMs = tSec > 1e12 ? Math.floor(tSec) : Math.floor(tSec * 1000);
      bars.push({ time: timeMs, open: o, high: h, low: l, close: c });
    }
    return bars;
  } catch {
    return [];
  }
}

function writeTradeVaultCandleCache(
  meta: TradeVaultVelaSymbolMeta,
  cacheInterval: string,
  bars: OHLCV[]
): void {
  if (typeof window === 'undefined' || bars.length === 0) return;
  try {
    const cacheKey = `${CANDLE_CACHE_PREFIX}${meta.tradeVaultSymbol.toUpperCase()}_${cacheInterval}`;
    const slice = bars.slice(-1000).map((b) => ({
      time: Math.floor(b.time / 1000),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    window.localStorage.setItem(cacheKey, JSON.stringify(slice));
  } catch {
    // ignore quota errors
  }
}

export function getCachedLatestXauUsdQuoteSync(): {
  price: number;
  open: number;
  high: number;
  low: number;
  barTimeMs: number;
  timeframe: string;
} | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  const meta = findSymbolMeta('XAUUSD');
  const intervals = ['15', '5', '60', '1'];
  let best: {
    price: number;
    open: number;
    high: number;
    low: number;
    barTimeMs: number;
    timeframe: string;
  } | null = null;

  for (const tf of intervals) {
    const bars = readTradeVaultCandleCache(meta, tf);
    if (bars.length === 0) continue;
    const last = bars[bars.length - 1];
    if (!best || last.time > best.barTimeMs) {
      best = {
        price: Number(last.close.toFixed(2)),
        open: Number(last.open.toFixed(2)),
        high: Number(last.high.toFixed(2)),
        low: Number(last.low.toFixed(2)),
        barTimeMs: last.time,
        timeframe: tf,
      };
    }
  }
  return best;
}

export class TradeVaultVelaProvider implements DataProvider {
  private readonly onStatus?: (status: VelaFeedStatus) => void;
  private readonly preferredFeed: VelaFeedPreference;
  private readonly memoryCache = new Map<string, MemoryBarsEntry>();

  constructor(opts?: {
    preferredFeed?: VelaFeedPreference;
    onStatus?: (status: VelaFeedStatus) => void;
  }) {
    this.preferredFeed = opts?.preferredFeed ?? 'twelvedata';
    this.onStatus = opts?.onStatus;
  }

  info(): ProviderInfo {
    return {
      name: 'tradevault',
      displayName:
        this.preferredFeed === 'twelvedata'
          ? 'TradeVault (Twelve Data)'
          : 'TradeVault (Binance)',
      supportedTimeframes: [...SUPPORTED_VELA_TIMEFRAMES],
      capabilities: {
        enumerate: true,
        stream: false,
        symbolInfo: true,
      },
    };
  }

  async listSymbols(): Promise<SymbolDescriptor[]> {
    return TRADEVAULT_VELA_SYMBOLS.map((item) => ({
      ticker: item.ticker,
      description: item.description,
      type: item.type,
    }));
  }

  async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
    const meta = findSymbolMeta(ticker);
    return {
      ticker: meta.ticker,
      timezone: 'Etc/UTC',
      session: meta.is24x7 ? '24x7' : undefined,
      ohlc: true,
      volume: Boolean(meta.binanceSymbol),
      mintick: meta.decimals > 0 ? Number((1 / Math.pow(10, meta.decimals)).toFixed(meta.decimals)) : 1,
      timeframes: {
        finest: '1',
        default: '60',
        list: [...SUPPORTED_VELA_TIMEFRAMES],
      },
    };
  }

  private async fetchFromTwelveData(
    meta: TradeVaultVelaSymbolMeta,
    tf: ReturnType<typeof normalizeVelaTimeframe>,
    limit: number,
    range: BarRange
  ): Promise<{ bars: OHLCV[]; errorNote?: string }> {
    if (!meta.twelveDataSymbol) return { bars: [] };
    const apiKey = getTwelveDataKey();
    if (apiKey.length <= 5) return { bars: [], errorNote: 'TwelveData API key kosong' };

    const qs = new URLSearchParams({
      symbol: meta.twelveDataSymbol,
      interval: tf.twelveDataInterval,
      outputsize: String(Math.min(limit, 1000)),
      timezone: 'UTC',
      apikey: apiKey,
    });
    if (range?.to !== undefined && Number.isFinite(range.to)) {
      const dt = new Date(range.to).toISOString().replace('T', ' ').slice(0, 19);
      qs.set('end_date', dt);
    }

    const twelveUrl = `https://api.twelvedata.com/time_series?${qs.toString()}`;
    const data = await fetchJsonNativeSafe<any>(twelveUrl, 9000);
    if (!data) {
      return { bars: [], errorNote: 'TwelveData timeout / offline' };
    }
    if (data.status === 'error') {
      const msg = String(data.message || 'TwelveData limit/error');
      const isRateLimit = data.code === 429 || /credit|limit|minute/i.test(msg);
      return {
        bars: [],
        errorNote: isRateLimit ? 'Kuota TwelveData penuh — fallback aktif' : msg.slice(0, 80),
      };
    }
    if (data.status === 'ok' && Array.isArray(data.values) && data.values.length > 0) {
      const mapped: OHLCV[] = data.values
        .slice()
        .reverse()
        .map((row: any) => {
          const rawDt = String(row.datetime || '');
          const iso = rawDt.includes(' ')
            ? `${rawDt.replace(' ', 'T')}Z`
            : rawDt.length === 10
              ? `${rawDt}T00:00:00Z`
              : rawDt;
          const timeMs = new Date(iso).getTime();
          const vol = row.volume !== undefined ? parseFloat(row.volume) : NaN;
          return {
            time: timeMs,
            open: Number(parseFloat(row.open).toFixed(meta.decimals)),
            high: Number(parseFloat(row.high).toFixed(meta.decimals)),
            low: Number(parseFloat(row.low).toFixed(meta.decimals)),
            close: Number(parseFloat(row.close).toFixed(meta.decimals)),
            volume: Number.isFinite(vol) ? vol : undefined,
          };
        });

      return { bars: sanitizeVelaBars(mapped, meta.is24x7, range) };
    }

    return { bars: [] };
  }

  private async fetchFromBinance(
    meta: TradeVaultVelaSymbolMeta,
    tf: ReturnType<typeof normalizeVelaTimeframe>,
    limit: number,
    range: BarRange
  ): Promise<OHLCV[]> {
    if (!meta.binanceSymbol) return [];
    const qs = new URLSearchParams({
      symbol: meta.binanceSymbol,
      interval: tf.binanceInterval,
      limit: String(limit),
    });
    if (range?.to !== undefined && Number.isFinite(range.to)) {
      qs.set('endTime', String(Math.floor(range.to)));
    }
    if (range?.from !== undefined && Number.isFinite(range.from)) {
      qs.set('startTime', String(Math.floor(range.from)));
    }

    const endpoints = [
      `https://data-api.binance.vision/api/v3/klines?${qs.toString()}`,
      `https://api.binance.com/api/v3/klines?${qs.toString()}`,
    ];

    for (const url of endpoints) {
      const raw = await fetchJsonNativeSafe<any[]>(url, 8000);
      if (Array.isArray(raw) && raw.length > 0) {
        const mapped: OHLCV[] = raw.map((row: any[]) => ({
          time: Math.floor(Number(row[0])),
          open: Number(parseFloat(row[1]).toFixed(meta.decimals)),
          high: Number(parseFloat(row[2]).toFixed(meta.decimals)),
          low: Number(parseFloat(row[3]).toFixed(meta.decimals)),
          close: Number(parseFloat(row[4]).toFixed(meta.decimals)),
          volume: Number.isFinite(parseFloat(row[5])) ? parseFloat(row[5]) : undefined,
        }));
        const sanitized = sanitizeVelaBars(mapped, meta.is24x7, range);
        if (sanitized.length > 0) return sanitized;
      }
    }
    return [];
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const meta = findSymbolMeta(ticker);
    const tf = normalizeVelaTimeframe(timeframe);
    const limit = Math.min(Math.max(Number(range?.limit) || 600, 50), 1000);

    // Strictly respect Offline Mode & offline device state — never hang on network timeouts
    const isOffline =
      isNewsCycleOfflineMode() || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (isOffline) {
      const cachedOffline = sanitizeVelaBars(
        readTradeVaultCandleCache(meta, tf.cacheInterval),
        meta.is24x7,
        range
      );
      if (cachedOffline.length > 0) {
        this.onStatus?.({
          source: 'cache',
          ticker: meta.ticker,
          timeframe: tf.velaTf,
          barCount: cachedOffline.length,
          updatedAt: Date.now(),
          note: isNewsCycleOfflineMode()
            ? 'Mode Offline aktif — menampilkan cache candle lokal'
            : 'Perangkat offline — menampilkan cache candle lokal',
        });
        return cachedOffline;
      }
      this.onStatus?.({
        source: 'unavailable',
        ticker: meta.ticker,
        timeframe: tf.velaTf,
        barCount: 0,
        updatedAt: Date.now(),
        note: 'Mode Offline aktif & belum ada cache candle lokal untuk pair ini',
      });
      return [];
    }

    // Short in-memory cache prevents burning Twelve Data 8 req/min free quota on redundant refreshes
    const memKey = `${this.preferredFeed}|${meta.ticker}|${tf.velaTf}|${range?.from ?? ''}|${range?.to ?? ''}|${limit}`;
    const memHit = this.memoryCache.get(memKey);
    if (memHit && Date.now() - memHit.savedAt < MEMORY_CACHE_TTL_MS) {
      this.onStatus?.({
        source: memHit.source,
        ticker: meta.ticker,
        timeframe: tf.velaTf,
        barCount: memHit.bars.length,
        updatedAt: memHit.savedAt,
        note: memHit.note,
      });
      return memHit.bars;
    }

    // Order live feeds according to user preference (default: Twelve Data primary for FX/Gold)
    const order: Array<'twelvedata' | 'binance'> =
      this.preferredFeed === 'twelvedata'
        ? ['twelvedata', 'binance']
        : ['binance', 'twelvedata'];

    let fallbackNote: string | undefined;

    for (const providerKind of order) {
      if (providerKind === 'twelvedata') {
        const td = await this.fetchFromTwelveData(meta, tf, limit, range);
        if (td.bars.length > 0) {
          if (!range?.to) {
            writeTradeVaultCandleCache(meta, tf.cacheInterval, td.bars);
          }
          const now = Date.now();
          this.memoryCache.set(memKey, {
            bars: td.bars,
            source: 'twelvedata',
            savedAt: now,
            note: fallbackNote,
          });
          this.onStatus?.({
            source: 'twelvedata',
            ticker: meta.ticker,
            timeframe: tf.velaTf,
            barCount: td.bars.length,
            updatedAt: now,
            note: fallbackNote,
          });
          return td.bars;
        }
        if (td.errorNote) {
          fallbackNote = td.errorNote;
        }
      } else {
        const binBars = await this.fetchFromBinance(meta, tf, limit, range);
        if (binBars.length > 0) {
          if (!range?.to) {
            writeTradeVaultCandleCache(meta, tf.cacheInterval, binBars);
          }
          const now = Date.now();
          this.memoryCache.set(memKey, {
            bars: binBars,
            source: 'binance',
            savedAt: now,
            note: fallbackNote,
          });
          this.onStatus?.({
            source: 'binance',
            ticker: meta.ticker,
            timeframe: tf.velaTf,
            barCount: binBars.length,
            updatedAt: now,
            note: fallbackNote,
          });
          return binBars;
        }
      }
    }

    // Honest offline cache fallback (shared TradeVault candle cache)
    const cached = sanitizeVelaBars(
      readTradeVaultCandleCache(meta, tf.cacheInterval),
      meta.is24x7,
      range
    );
    if (cached.length > 0) {
      this.onStatus?.({
        source: 'cache',
        ticker: meta.ticker,
        timeframe: tf.velaTf,
        barCount: cached.length,
        updatedAt: Date.now(),
        note: fallbackNote,
      });
      return cached;
    }

    // Honest unavailable state — never fabricate fake candles silently
    this.onStatus?.({
      source: 'unavailable',
      ticker: meta.ticker,
      timeframe: tf.velaTf,
      barCount: 0,
      updatedAt: Date.now(),
      note: fallbackNote || 'Feed offline & cache belum tersedia',
    });
    return [];
  }
}
