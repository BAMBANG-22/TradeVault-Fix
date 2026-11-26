/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Market Chart preferences, instrument catalog, candle sanitization/cache helpers,
 * and viewport layout math used across MarketChartView and CycleConfluence.
 */

export type ChartDisplayMode = 'normal' | 'full' | 'landscape';
export type CandleColorStyle = 'monochrome' | 'classic';
export type ChartEngineMode = 'live_oanda' | 'vela_replay';

export interface OhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketChartPreferences {
  symbol: string;
  interval: string;
  studies: string[];
  tradingViewChartUrl: string;
  theme: 'dark' | 'light';
  backgroundColor: string;
  gridColorHex: string;
  gridOpacity: number;
  hideTopToolbar: boolean;
  hideSideToolbar: boolean;
  hideVolume: boolean;
  withDateRanges: boolean;
  hideLegend: boolean;
  candleColorStyle?: CandleColorStyle;
  updatedAt?: string;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface WorkspaceBounds {
  top: number;
  bottom: number;
  left: number;
}

export interface ComputedChartWorkspaceLayout {
  mode: ChartDisplayMode;
  top: string;
  left: string;
  width: number;
  height: number;
  zIndex: number;
  isImmersive: boolean;
}

export const CHART_PREFS_STORAGE_KEY = 'tradevault_market_chart_prefs_v1';
export const CHART_DISPLAY_MODE_STORAGE_KEY = 'tradevault_market_chart_display_mode_v2';
export const CHART_AUTO_FULLSCREEN_STORAGE_KEY = 'tradevault_market_chart_auto_fullscreen_v1';
export const CHART_ENGINE_MODE_STORAGE_KEY = 'tradevault_chart_engine_mode_v2';
export const TWELVE_DATA_API_KEY_STORAGE_KEY = 'tradevault_twelve_data_api_key_v1';
export const TWELVE_DATA_KEY_CHANGE_EVENT = 'tradevault:twelvedata-key-change';

const CANDLE_CACHE_PREFIX = 'tradevault_candle_cache_v5_';

export const DEFAULT_TWELVE_DATA_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TWELVE_DATA_API_KEY) ||
  'cb5797ff73ff4ab79260ef8202a66739';

export function getStoredTwelveDataApiKey(): string {
  if (typeof window === 'undefined') return DEFAULT_TWELVE_DATA_API_KEY;
  try {
    const stored = window.localStorage.getItem(TWELVE_DATA_API_KEY_STORAGE_KEY);
    return stored && stored.trim().length > 5 ? stored.trim() : DEFAULT_TWELVE_DATA_API_KEY;
  } catch {
    return DEFAULT_TWELVE_DATA_API_KEY;
  }
}

export function saveStoredTwelveDataApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!key || !key.trim()) {
      window.localStorage.removeItem(TWELVE_DATA_API_KEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TWELVE_DATA_API_KEY_STORAGE_KEY, key.trim());
    }
    window.dispatchEvent(new CustomEvent(TWELVE_DATA_KEY_CHANGE_EVENT));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Loads stored engine mode and transparently migrates legacy 'replay_studio' or 'vela_beta'
 * values to 'vela_replay'.
 */
export function loadStoredChartEngineMode(): ChartEngineMode {
  if (typeof window === 'undefined') return 'live_oanda';
  try {
    const raw = window.localStorage.getItem(CHART_ENGINE_MODE_STORAGE_KEY);
    if (raw === 'live_oanda') return 'live_oanda';
    if (raw === 'vela_replay' || raw === 'vela_beta' || raw === 'replay_studio') {
      return 'vela_replay';
    }
    return 'live_oanda';
  } catch {
    return 'live_oanda';
  }
}

export function saveStoredChartEngineMode(mode: ChartEngineMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_ENGINE_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadStoredAutoFullscreen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(CHART_AUTO_FULLSCREEN_STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
    return true;
  } catch {
    return true;
  }
}

export function saveStoredAutoFullscreen(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_AUTO_FULLSCREEN_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota errors
  }
}

export function getTwelveDataInterval(value: string): string {
  switch (value) {
    case '1':
      return '1min';
    case '3':
      return '5min';
    case '5':
      return '5min';
    case '15':
      return '15min';
    case '60':
      return '1h';
    case '240':
      return '4h';
    case 'D':
    case '1d':
      return '1day';
    default:
      return '15min';
  }
}

export const DEFAULT_CHART_PREFS: MarketChartPreferences = {
  symbol: 'OANDA:XAUUSD',
  interval: '15',
  studies: [],
  tradingViewChartUrl: '',
  theme: 'dark',
  backgroundColor: '#000000',
  gridColorHex: '#000000',
  gridOpacity: 0,
  hideTopToolbar: true,
  hideSideToolbar: true,
  hideVolume: true,
  withDateRanges: false,
  hideLegend: false,
  candleColorStyle: 'monochrome',
};

export const WHEEL_PAIRS: Array<{
  label: string;
  symbol: string;
  binanceSymbol: string | null;
  twelveDataSymbol: string | null;
  decimals: number;
  basePrice: number;
  volatility: number;
  sourceLabel: string;
}> = [
  {
    label: 'XAUUSD',
    symbol: 'OANDA:XAUUSD',
    binanceSymbol: 'PAXGUSDT',
    twelveDataSymbol: 'XAU/USD',
    decimals: 2,
    basePrice: 4065.0,
    volatility: 3.5,
    sourceLabel: 'Gold Spot',
  },
  {
    label: 'BTCUSD',
    symbol: 'BINANCE:BTCUSDT',
    binanceSymbol: 'BTCUSDT',
    twelveDataSymbol: 'BTC/USD',
    decimals: 2,
    basePrice: 88500.0,
    volatility: 95.0,
    sourceLabel: 'Bitcoin Spot',
  },
  {
    label: 'EURUSD',
    symbol: 'OANDA:EURUSD',
    binanceSymbol: 'EURUSDT',
    twelveDataSymbol: 'EUR/USD',
    decimals: 5,
    basePrice: 1.1143,
    volatility: 0.0006,
    sourceLabel: 'Euro / USD',
  },
  {
    label: 'GBPUSD',
    symbol: 'OANDA:GBPUSD',
    binanceSymbol: 'GBPUSDT',
    twelveDataSymbol: 'GBP/USD',
    decimals: 5,
    basePrice: 1.1805,
    volatility: 0.0008,
    sourceLabel: 'Pound / USD',
  },
  {
    label: 'USDIDR',
    symbol: 'FX_IDC:USDIDR',
    binanceSymbol: null,
    twelveDataSymbol: 'USD/IDR',
    decimals: 0,
    basePrice: 18100,
    volatility: 25,
    sourceLabel: 'USD / Rupiah',
  },
];

export const WHEEL_TIMEFRAMES: Array<{
  label: string;
  value: string;
  binanceInterval: string;
  seconds: number;
}> = [
  { label: '1m', value: '1', binanceInterval: '1m', seconds: 60 },
  { label: '3m', value: '3', binanceInterval: '3m', seconds: 180 },
  { label: '5m', value: '5', binanceInterval: '5m', seconds: 300 },
  { label: '15m', value: '15', binanceInterval: '15m', seconds: 900 },
  { label: '1h', value: '60', binanceInterval: '1h', seconds: 3600 },
  { label: '4h', value: '240', binanceInterval: '4h', seconds: 14400 },
  { label: '1D', value: 'D', binanceInterval: '1d', seconds: 86400 },
];

export const SYMBOL_PRESETS = WHEEL_PAIRS.map((p) => ({
  label: p.label,
  shortName: p.label,
  broker: p.symbol.split(':')[0] || 'SPOT',
  symbol: p.symbol,
}));

export const INTERVAL_PRESETS = WHEEL_TIMEFRAMES.map((tf) => ({
  label: tf.label,
  value: tf.value,
}));

export function isValidDisplayMode(value: unknown): value is ChartDisplayMode {
  return value === 'normal' || value === 'full' || value === 'landscape';
}

export function loadStoredDisplayMode(): ChartDisplayMode {
  if (typeof window === 'undefined') return 'normal';
  try {
    const raw = window.localStorage.getItem(CHART_DISPLAY_MODE_STORAGE_KEY);
    return isValidDisplayMode(raw) ? raw : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveStoredDisplayMode(mode: ChartDisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHART_DISPLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota errors safely
  }
}

export function getScopedChartPrefsKey(userId?: string | null): string {
  const cleanId = typeof userId === 'string' ? userId.trim() : '';
  return cleanId ? `${CHART_PREFS_STORAGE_KEY}_user_${cleanId}` : CHART_PREFS_STORAGE_KEY;
}

export function sanitizeChartPreferences(raw: unknown): MarketChartPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CHART_PREFS };
  const parsed = raw as Record<string, unknown>;

  const cleanSymbol =
    typeof parsed.symbol === 'string' && /^[A-Za-z0-9_.:-]{2,40}$/.test(parsed.symbol.trim())
      ? parsed.symbol.trim().toUpperCase()
      : DEFAULT_CHART_PREFS.symbol;

  const validIntervals = new Set(['1', '3', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M']);
  const cleanInterval =
    typeof parsed.interval === 'string' && validIntervals.has(parsed.interval.trim())
      ? parsed.interval.trim()
      : DEFAULT_CHART_PREFS.interval;

  const cleanStudies = Array.isArray(parsed.studies)
    ? parsed.studies
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && !/volume/i.test(s))
        .slice(0, 8)
    : DEFAULT_CHART_PREFS.studies;

  return {
    symbol: cleanSymbol,
    interval: cleanInterval,
    studies: cleanStudies,
    tradingViewChartUrl: '',
    theme: 'dark',
    backgroundColor: '#000000',
    gridColorHex: '#000000',
    gridOpacity: 0,
    hideTopToolbar: true,
    hideSideToolbar:
      typeof parsed.hideSideToolbar === 'boolean'
        ? parsed.hideSideToolbar
        : DEFAULT_CHART_PREFS.hideSideToolbar,
    hideVolume: true,
    withDateRanges: false,
    hideLegend: false,
    candleColorStyle:
      parsed.candleColorStyle === 'classic' && parsed.updatedAt ? 'classic' : 'monochrome',
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
  };
}

export function loadStoredChartPreferences(userId?: string | null): MarketChartPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_CHART_PREFS };
  try {
    const scopedKey = getScopedChartPrefsKey(userId);
    const raw =
      window.localStorage.getItem(scopedKey) ||
      window.localStorage.getItem(CHART_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHART_PREFS };
    return sanitizeChartPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHART_PREFS };
  }
}

export function saveStoredChartPreferences(
  prefs: MarketChartPreferences,
  userId?: string | null
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify(prefs);
    window.localStorage.setItem(getScopedChartPrefsKey(userId), payload);
    window.localStorage.setItem(CHART_PREFS_STORAGE_KEY, payload);
  } catch {
    // Ignore storage quota errors safely
  }
}

export function readActualViewportSize(): ViewportSize {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { width: 390, height: 844 };
  }
  const width = Math.round(
    window.innerWidth ||
      document.documentElement.clientWidth ||
      window.visualViewport?.width ||
      390
  );
  const height = Math.round(
    window.innerHeight ||
      document.documentElement.clientHeight ||
      window.visualViewport?.height ||
      844
  );
  return { width, height };
}

export function computeChartWorkspaceLayout(
  mode: ChartDisplayMode,
  viewport: ViewportSize,
  bounds: WorkspaceBounds
): ComputedChartWorkspaceLayout {
  const vw = Math.max(240, Math.round(viewport.width));
  const vh = Math.max(240, Math.round(viewport.height));

  if (mode === 'full' || mode === 'landscape') {
    return {
      mode,
      top: '0px',
      left: '0px',
      width: vw,
      height: vh,
      zIndex: 55,
      isImmersive: true,
    };
  }

  const safeTop = Math.max(0, Math.round(bounds.top));
  const safeBottom = Math.max(0, Math.round(bounds.bottom));
  const safeLeft = Math.max(0, Math.round(bounds.left));

  return {
    mode: 'normal',
    top: `${safeTop}px`,
    left: `${safeLeft}px`,
    width: Math.max(200, vw - safeLeft),
    height: Math.max(180, vh - safeTop - safeBottom),
    zIndex: 20,
    isImmersive: false,
  };
}

export function isMarketOpenForPair(
  pairLabel: string,
  date = new Date()
): { isOpen: boolean; statusText: string } {
  const clean = pairLabel.toUpperCase();
  if (
    clean.includes('BTC') ||
    clean.includes('ETH') ||
    clean.includes('SOL') ||
    clean.includes('CRYPTO')
  ) {
    return { isOpen: true, statusText: 'Live' };
  }

  const utcDay = date.getUTCDay();
  const utcHour = date.getUTCHours();

  if (utcDay === 6 || utcDay === 0) {
    return { isOpen: false, statusText: 'Tutup (Akhir Pekan)' };
  }

  if (utcDay === 5 && utcHour >= 22) {
    return { isOpen: false, statusText: 'Tutup (Akhir Pekan)' };
  }

  return { isOpen: true, statusText: 'Live' };
}

export function getMostRecentFridayCloseTimestamp(now = new Date()): number {
  const date = new Date(now.getTime());
  const utcDay = date.getUTCDay();
  const utcHour = date.getUTCHours();

  let daysBack = 0;
  if (utcDay === 6) {
    daysBack = 1;
  } else if (utcDay === 0) {
    daysBack = 2;
  } else if (utcDay === 5 && utcHour >= 22) {
    daysBack = 0;
  } else {
    return Math.floor(now.getTime() / 1000);
  }

  const friday = new Date(date.getTime() - daysBack * 86400000);
  friday.setUTCHours(22, 0, 0, 0);
  return Math.floor(friday.getTime() / 1000);
}

export function sanitizeAndFilterCandles(candles: OhlcCandle[], pairLabel: string): OhlcCandle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const cleanPair = (pairLabel || '').toUpperCase();
  const isCrypto =
    cleanPair.includes('BTC') ||
    cleanPair.includes('ETH') ||
    cleanPair.includes('SOL') ||
    cleanPair.includes('CRYPTO');

  const valid = candles.filter((c) => {
    if (
      !c ||
      isNaN(Number(c.time)) ||
      isNaN(Number(c.open)) ||
      isNaN(Number(c.high)) ||
      isNaN(Number(c.low)) ||
      isNaN(Number(c.close))
    ) {
      return false;
    }

    if (c.open === c.high && c.high === c.low && c.low === c.close) {
      return false;
    }

    if (!isCrypto) {
      const d = new Date(Number(c.time) * 1000);
      const utcDay = d.getUTCDay();
      const utcHour = d.getUTCHours();
      if (utcDay === 6 || utcDay === 0) return false;
      if (utcDay === 5 && utcHour >= 22) return false;
    }

    return true;
  });

  valid.sort((a, b) => Number(a.time) - Number(b.time));

  const deduped: OhlcCandle[] = [];
  const seenTimes = new Set<number>();
  for (const item of valid) {
    const t = Number(item.time);
    if (!seenTimes.has(t)) {
      seenTimes.add(t);
      deduped.push(item);
    }
  }

  return deduped;
}

export function loadCachedCandles(
  symbol: string,
  interval: string,
  pairLabel = 'XAUUSD'
): OhlcCandle[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CANDLE_CACHE_PREFIX}${symbol.toUpperCase()}_${interval}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const cleaned = sanitizeAndFilterCandles(parsed, pairLabel);
      return cleaned.length > 0 ? cleaned : null;
    }
  } catch {
    // Ignore parse error
  }
  return null;
}

export function formatBarCountdown(intervalSeconds: number, nowMs = Date.now()): string {
  const safeInterval = Math.max(60, Math.floor(intervalSeconds));
  const nowSec = Math.floor(nowMs / 1000);
  const remaining = Math.max(0, safeInterval - (nowSec % safeInterval));
  const hrs = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
