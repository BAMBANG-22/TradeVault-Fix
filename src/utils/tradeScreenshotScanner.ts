import {
  Trade,
  TradeCloseType,
  TradePosition,
  TradingSession,
} from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { CHART_PREFS_STORAGE_KEY } from '../components/chart/MarketChartView';
import {
  buildBackendAuthHeaders,
  getApiEndpointCandidates,
  isNativeAndroidOrIos,
  nativeAwarePostJson,
  nativeHttpGetImageDataUrl,
  nativeHttpGetText,
} from './apiConfig';
import {
  classifyNetProfitOutcome,
  computeGrossFromNet,
  computeRealizedRMultiple,
  normalizeTradeDateTimeLocal,
} from './calculations';
import {
  evaluateTradeCompliance,
  encodeExecutionAdherenceNotes,
} from './complianceRating';
import {
  createActivityEvent,
  encodeLifecycleMetaIntoExecutionNotes,
  resolveTradeLifecycle,
  TradeLifecycleMeta,
} from './tradeLifecycle';
import {
  getCachedUsdIdrRate,
  getCurrentUsdIdrSnapshot,
} from './currencyRate';
import {
  calculateLotBasedOrderMetrics,
  getInstrumentPipSpec,
  validateSlTpDirection,
} from './riskCalculator';
import {
  Mt5OcrScanDiagnostic,
  OcrPassDiagnostic,
  OfflineOcrLine,
  OfflineOcrWordBox,
  PrecisionOcrVariantMode,
  getRuntimePlatformSnapshot,
  preparePrecisionOcrVariant,
  preparePrecisionOcrVariantWithTelemetry,
  prewarmOfflineTesseractWorker,
  recordMt5OcrScanDiagnostic,
  runOfflineTesseractOcr,
} from './offlineMt5Ocr';
import { getAppBuildIdentity, OCR_PIPELINE_VERSION } from '../config/appVersion';

export interface ExtractedTradeScanData {
  detected: boolean;
  source: 'MT5' | 'TRADINGVIEW' | 'CHART';
  instrument: string;
  position: TradePosition;
  lotSize: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  exitPrice: number | null;
  profit: number | null;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  plannedRiskReward: number | null;
  timeframe: string | null;
  currentPrice: number | null;
  confidence: number;
  notes: string;
  modelUsed: string;
  resolvedImageUrl?: string;
}

export interface CanvasZoneAnalysis {
  hasPositionBox: boolean;
  inferredPosition: TradePosition | null;
  inferredRR: number | null;
  entryYRatio: number | null;
  tpYRatio: number | null;
  slYRatio: number | null;
  boxTopYRatio: number | null;
  boxBottomYRatio: number | null;
  profitTheme?: 'GREEN' | 'BLUE_NAVY' | null;
  riskTheme?: 'RED' | 'GREY_SLATE' | null;
  rightAxisGreenBadgeYRatio?: number | null;
  rightAxisRedBadgeYRatio?: number | null;
  rightAxisBlueOrDarkBadgeYRatio?: number | null;
  horizontalLineYRatios?: number[];
  imageWidth: number;
  imageHeight: number;
}

export interface OcrWordBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerY: number;
  centerX: number;
}

export interface OcrExtractionResult {
  fullText: string;
  lines: Array<{ text: string; centerY: number; minX: number; maxX: number }>;
  words: OcrWordBox[];
}

/**
 * Valid price ranges and minimum SL/TP point distance per instrument.
 * Note: No synthetic fallback pip steps are allowed.
 */
export const INSTRUMENT_PRICE_RANGES: Record<
  string,
  { min: number; max: number; decimals: number; minSlTpDistance: number }
> = {
  XAUUSD: { min: 1500, max: 6500, decimals: 3, minSlTpDistance: 1.0 },
  XAGUSD: { min: 15, max: 90, decimals: 3, minSlTpDistance: 0.05 },
  BTCUSD: { min: 15000, max: 250000, decimals: 2, minSlTpDistance: 25 },
  ETHUSD: { min: 800, max: 12000, decimals: 2, minSlTpDistance: 2 },
  SOLUSD: { min: 20, max: 1000, decimals: 2, minSlTpDistance: 0.2 },
  EURUSD: { min: 0.85, max: 1.35, decimals: 5, minSlTpDistance: 0.0003 },
  GBPUSD: { min: 1.05, max: 1.65, decimals: 5, minSlTpDistance: 0.0003 },
  AUDUSD: { min: 0.5, max: 0.95, decimals: 5, minSlTpDistance: 0.0003 },
  NZDUSD: { min: 0.45, max: 0.85, decimals: 5, minSlTpDistance: 0.0003 },
  USDCAD: { min: 1.15, max: 1.6, decimals: 5, minSlTpDistance: 0.0003 },
  USDCHF: { min: 0.7, max: 1.2, decimals: 5, minSlTpDistance: 0.0003 },
  EURGBP: { min: 0.7, max: 1.0, decimals: 5, minSlTpDistance: 0.0003 },
  USDJPY: { min: 95, max: 200, decimals: 3, minSlTpDistance: 0.03 },
  EURJPY: { min: 110, max: 220, decimals: 3, minSlTpDistance: 0.03 },
  GBPJPY: { min: 130, max: 250, decimals: 3, minSlTpDistance: 0.03 },
  AUDJPY: { min: 70, max: 140, decimals: 3, minSlTpDistance: 0.03 },
  US30: { min: 25000, max: 65000, decimals: 2, minSlTpDistance: 15 },
  NAS100: { min: 10000, max: 35000, decimals: 2, minSlTpDistance: 10 },
  SPX500: { min: 3000, max: 9000, decimals: 2, minSlTpDistance: 3 },
  GER40: { min: 12000, max: 30000, decimals: 2, minSlTpDistance: 5 },
};

/**
 * Normalizes TradingView and MT5 price strings, specifically handling:
 * - European/Indonesian format `X.XXX,XXX` (e.g. `4.054,405` -> `4054.405`, `4.099,857` -> `4099.857`, `4.105,735` -> `4105.735`)
 * - International format `X,XXX.XXX` or space-separated `96 250.00` (`4,054.405` -> `4054.405`)
 * - Comma decimal format (`4054,405` -> `4054.405`)
 * - Misread dot-thousands on XAUUSD where `4.054` or `4.054405` was parsed as ~4.05 instead of `4054.405`
 */
export function normalizeChartPriceNumber(
  raw: unknown,
  instrument = 'XAUUSD'
): number | null {
  if (raw === null || raw === undefined || raw === '') return null;

  const cleanInst = normalizeScanInstrument(instrument);
  const spec = INSTRUMENT_PRICE_RANGES[cleanInst] || INSTRUMENT_PRICE_RANGES.XAUUSD;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    // Fix XAUUSD dot-thousands misread (e.g. 4.054405 instead of 4054.405)
    if (cleanInst === 'XAUUSD' && raw >= 1.5 && raw <= 6.5) {
      return Number((raw * 1000).toFixed(3));
    }
    return raw;
  }

  let s = String(raw).trim();
  if (!s) return null;

  // Strip surrounding non-numeric characters except sign, digits, dot, comma, space
  s = s.replace(/[^0-9.,+\- ]/g, '').trim();
  if (!s) return null;

  // Case 1: Format `X.XXX,XXX` or `XX.XXX,XX` (Dot as thousands separator, Comma as decimal separator)
  // Example: "4.054,405" -> "4054.405", "4.099,857" -> "4099.857"
  if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // Case 2: Format `X,XXX.XXX` or `XX XXX.XX` (Comma/Space as thousands separator, Dot as decimal)
  // Example: "4,054.405" -> "4054.405", "96 250.00" -> "96250.00"
  else if (/^[+-]?\d{1,3}(?:[ ,]\d{3})+\.\d+$/.test(s)) {
    s = s.replace(/[ ,]/g, '');
  }
  // Case 3: Both dot and comma exist in other positions
  else if (s.includes('.') && s.includes(',')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Comma is the decimal separator (e.g. "4.054,405")
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Dot is the decimal separator (e.g. "4,054.405")
      s = s.replace(/,/g, '');
    }
  }
  // Case 4: Only comma exists (e.g. "4054,405" or "1,08520" or "4,054")
  else if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    if (
      parts.length === 2 &&
      parts[1].length === 3 &&
      (cleanInst === 'XAUUSD' || cleanInst === 'BTCUSD' || cleanInst === 'US30' || cleanInst === 'NAS100')
    ) {
      // Check if replacing comma with dot gives ~4.054 on XAUUSD (which is actually 4054)
      const asDecimal = parseFloat(s.replace(',', '.'));
      if (asDecimal >= spec.min && asDecimal <= spec.max) {
        s = s.replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else {
      s = s.replace(',', '.');
    }
  }
  // Case 5: Multiple dots (e.g. "4.054.405")
  else if ((s.match(/\./g) || []).length >= 2) {
    const lastDot = s.lastIndexOf('.');
    s = s.slice(0, lastDot).replace(/\./g, '') + '.' + s.slice(lastDot + 1);
  } else {
    s = s.replace(/ /g, '');
  }

  const parsed = parseFloat(s);
  if (isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) return null;

  // If XAUUSD price was written as "4.054" or "4.099857" (1.5..6.5) because dot was thousands separator
  if (cleanInst === 'XAUUSD' && parsed >= 1.5 && parsed <= 6.5) {
    return Number((parsed * 1000).toFixed(3));
  }

  return parsed;
}

/**
 * Extracts all price-formatted numbers from a line of text, supporting both
 * `4.054,405` (dot thousands + comma decimals) and `4074.43` / `4,074.43`.
 */
export function extractPriceNumbersFromLine(
  lineText: string,
  instrument = 'XAUUSD'
): Array<{ raw: string; val: number }> {
  const results: Array<{ raw: string; val: number }> = [];
  if (!lineText) return results;

  // Match:
  // 1) Dot-thousands with comma-decimals: e.g. 4.054,405 or 4.099,857
  // 2) Comma/space-thousands with dot-decimals: e.g. 4,054.405 or 96 250.00
  // 3) Standard decimal with dot or comma: e.g. 4074.43 or 4054,405 or 1.08500
  const regex =
    /\b([0-9]{1,3}(?:\.[0-9]{3})+,[0-9]{1,5}|[0-9]{1,3}(?:[ ,][0-9]{3})+\.[0-9]{1,5}|[0-9]{1,6}[.,][0-9]{1,5})\b/g;

  for (const m of lineText.matchAll(regex)) {
    const rawToken = m[1];
    const normalized = normalizeChartPriceNumber(rawToken, instrument);
    if (normalized !== null && normalized > 0) {
      results.push({ raw: rawToken, val: normalized });
    }
  }
  return results;
}

/**
 * Resolves any TradingView share URL (e.g. https://www.tradingview.com/x/ABCD1234/)
 * into its direct S3 snapshot PNG image URL so both <img> preview and APK scanner work without a backend.
 */
export function resolveTradingViewSnapshotUrl(rawUrl: string): {
  isTradingViewUrl: boolean;
  directImageUrl: string;
  snapshotId: string | null;
  symbolFromUrl: string | null;
  timeframeFromUrl: string | null;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return {
      isTradingViewUrl: false,
      directImageUrl: trimmed,
      snapshotId: null,
      symbolFromUrl: null,
      timeframeFromUrl: null,
    };
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isTv = host.includes('tradingview.com');

    if (!isTv) {
      return {
        isTradingViewUrl: false,
        directImageUrl: trimmed,
        snapshotId: null,
        symbolFromUrl: null,
        timeframeFromUrl: null,
      };
    }

    let symbolFromUrl: string | null = null;
    const querySymbol = parsed.searchParams.get('symbol');
    if (querySymbol) {
      symbolFromUrl = normalizeScanInstrument(querySymbol);
    } else {
      const chartPathMatch = parsed.pathname.match(/\/chart\/([A-Za-z0-9_.:-]+)\//i);
      if (chartPathMatch && chartPathMatch[1] && chartPathMatch[1].length <= 15) {
        const candidate = chartPathMatch[1].toUpperCase();
        if (/[A-Z]{3,}/.test(candidate)) {
          symbolFromUrl = normalizeScanInstrument(candidate);
        }
      }
      const symbolsPathMatch = parsed.pathname.match(/\/symbols\/([A-Za-z0-9_.:-]+)\/?/i);
      if (symbolsPathMatch && symbolsPathMatch[1]) {
        symbolFromUrl = normalizeScanInstrument(symbolsPathMatch[1]);
      }
    }

    const queryInterval = parsed.searchParams.get('interval');
    let timeframeFromUrl: string | null = null;
    if (queryInterval) {
      timeframeFromUrl = normalizeTimeframeLabel(queryInterval);
    }

    const s3Match = parsed.pathname.match(/\/snapshots\/[a-z0-9]\/([A-Za-z0-9]+)\.(?:png|jpg|webp)/i);
    if (s3Match && s3Match[1]) {
      return {
        isTradingViewUrl: true,
        directImageUrl: trimmed,
        snapshotId: s3Match[1],
        symbolFromUrl,
        timeframeFromUrl,
      };
    }

    const xMatch = parsed.pathname.match(/\/x\/([A-Za-z0-9]+)\/?/i);
    if (xMatch && xMatch[1]) {
      const id = xMatch[1];
      const firstChar = id.charAt(0).toLowerCase();
      const directImageUrl = `https://s3.tradingview.com/snapshots/${firstChar}/${id}.png`;
      return {
        isTradingViewUrl: true,
        directImageUrl,
        snapshotId: id,
        symbolFromUrl,
        timeframeFromUrl,
      };
    }

    return {
      isTradingViewUrl: true,
      directImageUrl: trimmed,
      snapshotId: null,
      symbolFromUrl,
      timeframeFromUrl,
    };
  } catch {
    return {
      isTradingViewUrl: false,
      directImageUrl: trimmed,
      snapshotId: null,
      symbolFromUrl: null,
      timeframeFromUrl: null,
    };
  }
}

export function normalizeScanInstrument(raw: string | null | undefined): string {
  if (!raw) return 'XAUUSD';
  let s = raw.toUpperCase().trim();
  if (!s || s === 'NULL' || s === 'NONE' || s === 'UNKNOWN' || s === 'UNDEFINED' || s === 'N/A' || s === '-') {
    return 'XAUUSD';
  }

  if (s.includes(':')) {
    s = s.split(':').pop() || s;
  }

  if (s.includes('GOLD') || s.includes('XAU/USD') || s.includes('XAUUSD') || s.startsWith('XAU')) return 'XAUUSD';
  if (s.includes('SILVER') || s.startsWith('XAG')) return 'XAGUSD';
  if (s.includes('BITCOIN') || s.includes('BTC/USD') || s.startsWith('BTC')) return 'BTCUSD';
  if (s.includes('ETHER') || s.includes('ETH/USD') || s.startsWith('ETH')) return 'ETHUSD';
  if (s.includes('SOLANA') || s.startsWith('SOL')) return 'SOLUSD';
  if (s.includes('DOW') || s.includes('DJI') || s.includes('US30')) return 'US30';
  if (s.includes('NAS100') || s.includes('USTEC') || s.includes('NDX') || s.includes('NASDAQ')) return 'NAS100';
  if (s.includes('SPX') || s.includes('US500') || s.includes('S&P')) return 'SPX500';
  if (s.includes('DAX') || s.includes('GER40') || s.includes('DE40')) return 'GER40';

  const KNOWN_FOREX = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
    'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
    'EURAUD', 'EURCAD', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDCAD', 'AUDNZD',
    'CADCHF', 'NZDCAD', 'NZDCHF',
  ];
  const compact = s.replace(/[^A-Z0-9]/g, '');
  for (const pair of KNOWN_FOREX) {
    if (compact.includes(pair)) return pair;
  }

  s = s.replace(/(\.M|\.RAW|\.PRO|\.STD|\.ECN|\.B|_I|_SB|_C)$/i, '');
  if (s.length > 6 && (s.endsWith('C') || s.endsWith('M'))) {
    s = s.slice(0, -1);
  }
  s = s.replace(/[^A-Z0-9]/g, '');

  return INSTRUMENT_PRICE_RANGES[s] ? s : 'XAUUSD';
}

function normalizeTimeframeLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().trim();
  if (s === '1' || s === '1M' || s === 'M1') return 'M1';
  if (s === '3' || s === '3M' || s === 'M3') return 'M3';
  if (s === '5' || s === '5M' || s === 'M5') return 'M5';
  if (s === '15' || s === '15M' || s === 'M15') return 'M15';
  if (s === '30' || s === '30M' || s === 'M30') return 'M30';
  if (s === '60' || s === '1H' || s === 'H1') return 'H1';
  if (s === '240' || s === '4H' || s === 'H4') return 'H4';
  if (s === 'D' || s === '1D' || s === 'D1' || s === 'DAILY') return 'D1';
  return null;
}

/**
 * Safe JSON fetch that NEVER throws `Unexpected token '<', "<!doctype"... is not valid JSON`
 */
async function safeFetchApiJson(
  url: string,
  options: RequestInit,
  timeoutMs = 11000
): Promise<{ ok: boolean; isHtmlFallback: boolean; status: number; json: any | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text();
    const trimmed = rawText.trim();

    if (
      contentType.includes('text/html') ||
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<')
    ) {
      return { ok: false, isHtmlFallback: true, status: res.status, json: null };
    }

    if (!trimmed) {
      return { ok: false, isHtmlFallback: false, status: res.status, json: null };
    }

    const parsed = JSON.parse(trimmed);
    return { ok: res.ok, isHtmlFallback: false, status: res.status, json: parsed };
  } catch {
    return { ok: false, isHtmlFallback: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageHtmlViaNativeOrProxy(pageUrl: string, timeoutMs = 5500): Promise<string> {
  if (isNativeAndroidOrIos()) {
    const nativeHtml = await nativeHttpGetText(pageUrl, timeoutMs, 'text/html,application/xhtml+xml,*/*');
    if (nativeHtml) return nativeHtml;
  }

  const proxyCandidates = getApiEndpointCandidates('/api/proxy');
  const encoded = encodeURIComponent(pageUrl);
  for (const proxyBase of proxyCandidates) {
    try {
      const proxyUrl = `${proxyBase}?url=${encoded}`;
      if (isNativeAndroidOrIos() && /^https?:\/\//i.test(proxyUrl)) {
        const raw = await nativeHttpGetText(proxyUrl, timeoutMs, 'text/html,*/*');
        if (raw) return raw;
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(proxyUrl, {
          method: 'GET',
          headers: { Accept: 'text/html,*/*', ...buildBackendAuthHeaders(proxyUrl) },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const text = await res.text();
          if (text) return text;
        }
      }
    } catch {
      // Try next proxy
    }
  }
  return '';
}

/**
 * Fetches an external image URL (including TradingView S3 snapshots) into a base64 Data URL.
 * Uses native CapacitorHttp on Android/iOS APK and configured TradeVault /api/proxy (no dead public proxies).
 */
async function fetchImageUrlAsDataUrl(imageUrl: string): Promise<{
  dataUrl: string | null;
  pageTitle: string;
  pageDescription: string;
}> {
  let pageTitle = '';
  let pageDescription = '';
  const tvResolved = resolveTradingViewSnapshotUrl(imageUrl);
  let targetImgUrl = tvResolved.directImageUrl;

  if (tvResolved.isTradingViewUrl && !tvResolved.snapshotId && !targetImgUrl.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)) {
    try {
      const html = await fetchPageHtmlViaNativeOrProxy(imageUrl, 6000);
      if (html.length > 0) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch?.[1]) pageTitle = titleMatch[1].trim();
        const descMatch =
          html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
          html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
        if (descMatch?.[1]) pageDescription = descMatch[1].trim();
        const ogImgMatch =
          html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
          html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
          html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
        if (ogImgMatch?.[1]) {
          targetImgUrl = ogImgMatch[1].trim();
        }
      }
    } catch {
      // Ignore metadata proxy errors
    }
  } else if (tvResolved.isTradingViewUrl && tvResolved.snapshotId) {
    try {
      const pageUrl = `https://www.tradingview.com/x/${tvResolved.snapshotId}/`;
      const html = await fetchPageHtmlViaNativeOrProxy(pageUrl, 4500);
      if (html.length > 0) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch?.[1]) pageTitle = titleMatch[1].trim();
        const descMatch =
          html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
          html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
        if (descMatch?.[1]) pageDescription = descMatch[1].trim();
      }
    } catch {
      // Ignore optional title fetch failure
    }
  }

  // Fast path on native Android/iOS APK: CORS-free binary download via CapacitorHttp
  if (isNativeAndroidOrIos()) {
    const nativeDataUrl = await nativeHttpGetImageDataUrl(targetImgUrl, 8500);
    if (nativeDataUrl) {
      return { dataUrl: nativeDataUrl, pageTitle, pageDescription };
    }
  }

  const proxyCandidates = getApiEndpointCandidates('/api/proxy').map(
    (proxyBase) => `${proxyBase}?url=${encodeURIComponent(targetImgUrl)}`
  );
  const candidateUrls = [targetImgUrl, ...proxyCandidates];

  for (const candidate of candidateUrls) {
    try {
      if (isNativeAndroidOrIos() && /^https?:\/\//i.test(candidate) && candidate !== targetImgUrl) {
        const nativeProxiedDataUrl = await nativeHttpGetImageDataUrl(candidate, 8000);
        if (nativeProxiedDataUrl) {
          return { dataUrl: nativeProxiedDataUrl, pageTitle, pageDescription };
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(candidate, {
        headers: buildBackendAuthHeaders(candidate),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const cType = (res.headers.get('content-type') || '').toLowerCase();
      if (cType.includes('text/html') || cType.includes('application/json')) continue;
      const blob = await res.blob();
      if (blob.size < 200) continue;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Read failed'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.startsWith('data:image/')) {
        return { dataUrl, pageTitle, pageDescription };
      }
    } catch {
      // Try next candidate
    }
  }

  return { dataUrl: null, pageTitle, pageDescription };
}

interface VerticalSegment {
  top: number;
  bottom: number;
  height: number;
  avgScore: number;
  medianLeftX?: number;
  medianRightX?: number;
}

function extractContiguousSegments(
  rowScores: Float32Array,
  minY: number,
  maxY: number,
  maxGapRows = 4,
  rowLeftX?: Int16Array,
  rowRightX?: Int16Array
): VerticalSegment[] {
  const rawSegments: VerticalSegment[] = [];
  let curTop = -1;
  let curBottom = -1;
  let curSum = 0;
  let gapCount = 0;

  const finalizeSegment = (top: number, bottom: number, sum: number) => {
    const h = bottom - top + 1;
    if (h < 6) return;
    let medianLeftX = 0;
    let medianRightX = 0;
    if (rowLeftX && rowRightX) {
      const lefts: number[] = [];
      const rights: number[] = [];
      for (let y = top; y <= bottom; y++) {
        if (rowScores[y] > 0 && rowRightX[y] > rowLeftX[y]) {
          lefts.push(rowLeftX[y]);
          rights.push(rowRightX[y]);
        }
      }
      if (lefts.length > 0) {
        lefts.sort((a, b) => a - b);
        rights.sort((a, b) => a - b);
        medianLeftX = lefts[Math.floor(lefts.length / 2)];
        medianRightX = rights[Math.floor(rights.length / 2)];
      }
    }
    rawSegments.push({
      top,
      bottom,
      height: h,
      avgScore: sum / h,
      medianLeftX,
      medianRightX,
    });
  };

  for (let y = minY; y <= maxY; y++) {
    const val = rowScores[y];
    if (val > 0) {
      if (curTop === -1) {
        curTop = y;
        curSum = 0;
      }
      curBottom = y;
      curSum += val;
      gapCount = 0;
    } else if (curTop !== -1) {
      gapCount++;
      if (gapCount > maxGapRows) {
        finalizeSegment(curTop, curBottom, curSum);
        curTop = -1;
        curBottom = -1;
        curSum = 0;
        gapCount = 0;
      }
    }
  }
  if (curTop !== -1) {
    finalizeSegment(curTop, curBottom, curSum);
  }
  return rawSegments;
}

/**
 * 2D Rectangle-Aware Canvas Geometry Analyzer supporting BOTH:
 * - Standard TradingView Theme: Green/Teal Profit Zone (TP) + Red/Crimson Risk Zone (SL)
 * - Custom TradingView Theme: Dark Blue / Navy / Cyan Profit Zone (TP) + Grey / Slate Risk Zone (SL)
 *
 * Ensures that if the Blue/Navy (Profit) box is BELOW the Grey/Slate (Risk) box,
 * the direction is deterministically SELL (TP at bottom < Entry in middle < SL at top).
 */
export async function analyzeChartCanvasGeometry(dataUrl: string): Promise<CanvasZoneAnalysis> {
  const empty: CanvasZoneAnalysis = {
    hasPositionBox: false,
    inferredPosition: null,
    inferredRR: null,
    entryYRatio: null,
    tpYRatio: null,
    slYRatio: null,
    boxTopYRatio: null,
    boxBottomYRatio: null,
    profitTheme: null,
    riskTheme: null,
    rightAxisGreenBadgeYRatio: null,
    rightAxisRedBadgeYRatio: null,
    rightAxisBlueOrDarkBadgeYRatio: null,
    horizontalLineYRatios: [],
    imageWidth: 0,
    imageHeight: 0,
  };

  if (typeof document === 'undefined') return empty;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(empty);
    img.onload = () => {
      const sampleW = 600;
      const sampleH = 800;
      const canvas = document.createElement('canvas');
      canvas.width = sampleW;
      canvas.height = sampleH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ ...empty, imageWidth: img.width, imageHeight: img.height });
        return;
      }

      ctx.drawImage(img, 0, 0, sampleW, sampleH);
      const imgData = ctx.getImageData(0, 0, sampleW, sampleH).data;
      canvas.width = 0;
      canvas.height = 0;

      const plotMinX = Math.floor(sampleW * 0.06);
      const plotMaxX = Math.floor(sampleW * 0.78);
      const plotMinY = Math.floor(sampleH * 0.06);
      const plotMaxY = Math.floor(sampleH * 0.88);

      // Estimate background luminance & RGB median from left edge of plot
      const bgR: number[] = [];
      const bgG: number[] = [];
      const bgB: number[] = [];
      for (let y = plotMinY; y <= plotMaxY; y += 10) {
        const idx = (y * sampleW + plotMinX + 4) * 4;
        bgR.push(imgData[idx]);
        bgG.push(imgData[idx + 1]);
        bgB.push(imgData[idx + 2]);
      }
      bgR.sort((a, b) => a - b);
      bgG.sort((a, b) => a - b);
      bgB.sort((a, b) => a - b);
      const medBgR = bgR[Math.floor(bgR.length / 2)] ?? 15;
      const medBgG = bgG[Math.floor(bgG.length / 2)] ?? 18;
      const medBgB = bgB[Math.floor(bgB.length / 2)] ?? 24;
      const isDarkChartBg = (medBgR + medBgG + medBgB) / 3 < 128;

      // 1A. Profit Zone Option 1: Standard Green / Teal
      const isGreenProfitPixel = (r: number, g: number, b: number): boolean => {
        const isDarkGreenZone = g > r + 10 && g >= 26 && b >= 20 && r < 145;
        const isLightGreenZone = g > r + 9 && g >= 180 && r < 238 && b >= 170;
        return isDarkGreenZone || isLightGreenZone;
      };

      // 1B. Profit Zone Option 2: Custom Dark Blue / Navy / Cyan
      const isBlueNavyProfitPixel = (r: number, g: number, b: number): boolean => {
        if (isDarkChartBg) {
          // Navy / Dark Blue / Cyan tint over dark background: B channel is elevated above R and background B
          return b > r + 8 && b >= medBgB + 7 && b >= 28 && r < 140 && b >= g - 10;
        }
        // Light background blue/navy tint
        return b > r + 10 && b >= g && r < 230 && b >= 120;
      };

      // 2A. Risk Zone Option 1: Standard Red / Crimson
      const isRedRiskPixel = (r: number, g: number, b: number): boolean => {
        const isDarkRedZone = r > g + 12 && r > b + 10 && r >= 34 && g < 135;
        const isLightRedZone = r > g + 11 && r > b + 9 && r >= 195 && g < 235;
        return isDarkRedZone || isLightRedZone;
      };

      // 2B. Risk Zone Option 2: Custom Dark Grey / Slate / Translucent White-Grey
      const isGreySlateRiskPixel = (r: number, g: number, b: number): boolean => {
        const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        if (maxDiff > 22) return false; // Must be neutral grey/slate, not strongly saturated
        const avg = (r + g + b) / 3;
        const bgAvg = (medBgR + medBgG + medBgB) / 3;
        if (isDarkChartBg) {
          // Translucent dark grey/slate box over dark background is noticeably brighter than background
          return avg >= bgAvg + 8 && avg >= 28 && avg <= 185;
        }
        // Translucent grey/slate box over light background is noticeably darker than white background
        return avg <= bgAvg - 8 && avg >= 80 && avg <= 235;
      };

      const findLongestHorizontalRun = (
        y: number,
        minX: number,
        maxX: number,
        predicate: (r: number, g: number, b: number) => boolean
      ): { width: number; leftX: number; rightX: number; matchCount: number } => {
        let bestW = 0;
        let bestL = 0;
        let bestR = 0;
        let bestMatches = 0;

        let curL = -1;
        let curR = -1;
        let curMatches = 0;
        let gap = 0;

        for (let x = minX; x <= maxX; x++) {
          const idx = (y * sampleW + x) * 4;
          if (predicate(imgData[idx], imgData[idx + 1], imgData[idx + 2])) {
            if (curL === -1) {
              curL = x;
              curMatches = 0;
            }
            curR = x;
            curMatches++;
            gap = 0;
          } else if (curL !== -1) {
            gap++;
            if (gap > 6) {
              const w = curR - curL + 1;
              if (w > bestW && curMatches >= w * 0.55) {
                bestW = w;
                bestL = curL;
                bestR = curR;
                bestMatches = curMatches;
              }
              curL = -1;
              curR = -1;
              curMatches = 0;
              gap = 0;
            }
          }
        }
        if (curL !== -1) {
          const w = curR - curL + 1;
          if (w > bestW && curMatches >= w * 0.55) {
            bestW = w;
            bestL = curL;
            bestR = curR;
            bestMatches = curMatches;
          }
        }
        return { width: bestW, leftX: bestL, rightX: bestR, matchCount: bestMatches };
      };

      const minBoxRunWidth = 48; // >= 8% of chart width, ignoring small candlesticks & tiny OB tags

      const greenRowScore = new Float32Array(sampleH);
      const greenRowLeftX = new Int16Array(sampleH);
      const greenRowRightX = new Int16Array(sampleH);

      const blueRowScore = new Float32Array(sampleH);
      const blueRowLeftX = new Int16Array(sampleH);
      const blueRowRightX = new Int16Array(sampleH);

      const redRowScore = new Float32Array(sampleH);
      const redRowLeftX = new Int16Array(sampleH);
      const redRowRightX = new Int16Array(sampleH);

      const greyRowScore = new Float32Array(sampleH);
      const greyRowLeftX = new Int16Array(sampleH);
      const greyRowRightX = new Int16Array(sampleH);

      for (let y = plotMinY; y <= plotMaxY; y++) {
        const gRun = findLongestHorizontalRun(y, plotMinX, plotMaxX, isGreenProfitPixel);
        if (gRun.width >= minBoxRunWidth) {
          greenRowScore[y] = gRun.matchCount;
          greenRowLeftX[y] = gRun.leftX;
          greenRowRightX[y] = gRun.rightX;
        }

        const bRun = findLongestHorizontalRun(y, plotMinX, plotMaxX, isBlueNavyProfitPixel);
        if (bRun.width >= minBoxRunWidth) {
          blueRowScore[y] = bRun.matchCount;
          blueRowLeftX[y] = bRun.leftX;
          blueRowRightX[y] = bRun.rightX;
        }

        const rRun = findLongestHorizontalRun(y, plotMinX, plotMaxX, isRedRiskPixel);
        if (rRun.width >= minBoxRunWidth) {
          redRowScore[y] = rRun.matchCount;
          redRowLeftX[y] = rRun.leftX;
          redRowRightX[y] = rRun.rightX;
        }

        const grRun = findLongestHorizontalRun(y, plotMinX, plotMaxX, isGreySlateRiskPixel);
        if (grRun.width >= minBoxRunWidth) {
          greyRowScore[y] = grRun.matchCount;
          greyRowLeftX[y] = grRun.leftX;
          greyRowRightX[y] = grRun.rightX;
        }
      }

      // Scan Right-Hand Price Axis (x: 77% to 99%) for Colored Price Badges
      const axisMinX = Math.floor(sampleW * 0.77);
      const axisMaxX = Math.floor(sampleW * 0.99);
      const axisGreenRows = new Float32Array(sampleH);
      const axisRedRows = new Float32Array(sampleH);
      const axisBlueRows = new Float32Array(sampleH);

      for (let y = plotMinY; y <= plotMaxY; y++) {
        let gBadge = 0;
        let rBadge = 0;
        let bBadge = 0;
        for (let x = axisMinX; x <= axisMaxX; x++) {
          const idx = (y * sampleW + x) * 4;
          const r = imgData[idx];
          const g = imgData[idx + 1];
          const b = imgData[idx + 2];

          if (g > r + 22 && g >= 75 && r < 135) gBadge++;
          if (r > g + 25 && r > b + 18 && r >= 95 && g < 125) rBadge++;
          if (b > r + 20 && b >= 75 && r < 135) bBadge++;
        }
        if (gBadge >= 12) axisGreenRows[y] = gBadge;
        if (rBadge >= 12) axisRedRows[y] = rBadge;
        if (bBadge >= 12) axisBlueRows[y] = bBadge;
      }

      const findStrongestBadgeCenterRatio = (rows: Float32Array): number | null => {
        const segs = extractContiguousSegments(rows, plotMinY, plotMaxY, 3).filter(
          (s) => s.height >= 6 && s.height <= 45
        );
        if (segs.length === 0) return null;
        segs.sort((a, b) => b.avgScore * b.height - a.avgScore * a.height);
        const best = segs[0];
        return (best.top + best.bottom) / 2 / sampleH;
      };

      const rightAxisGreenBadgeYRatio = findStrongestBadgeCenterRatio(axisGreenRows);
      const rightAxisRedBadgeYRatio = findStrongestBadgeCenterRatio(axisRedRows);
      const rightAxisBlueOrDarkBadgeYRatio = findStrongestBadgeCenterRatio(axisBlueRows);

      // Extract candidate Profit segments (Green OR Blue/Navy) and Risk segments (Red OR Grey/Slate)
      const profitCandidates: Array<{
        seg: VerticalSegment;
        theme: 'GREEN' | 'BLUE_NAVY';
        predicate: (r: number, g: number, b: number) => boolean;
      }> = [
        ...extractContiguousSegments(greenRowScore, plotMinY, plotMaxY, 5, greenRowLeftX, greenRowRightX)
          .filter((s) => s.height >= 12)
          .map((seg) => ({ seg, theme: 'GREEN' as const, predicate: isGreenProfitPixel })),
        ...extractContiguousSegments(blueRowScore, plotMinY, plotMaxY, 5, blueRowLeftX, blueRowRightX)
          .filter((s) => s.height >= 12)
          .map((seg) => ({ seg, theme: 'BLUE_NAVY' as const, predicate: isBlueNavyProfitPixel })),
      ];

      const riskCandidates: Array<{
        seg: VerticalSegment;
        theme: 'RED' | 'GREY_SLATE';
        predicate: (r: number, g: number, b: number) => boolean;
      }> = [
        ...extractContiguousSegments(redRowScore, plotMinY, plotMaxY, 5, redRowLeftX, redRowRightX)
          .filter((s) => s.height >= 10)
          .map((seg) => ({ seg, theme: 'RED' as const, predicate: isRedRiskPixel })),
        ...extractContiguousSegments(greyRowScore, plotMinY, plotMaxY, 5, greyRowLeftX, greyRowRightX)
          .filter((s) => s.height >= 10)
          .map((seg) => ({ seg, theme: 'GREY_SLATE' as const, predicate: isGreySlateRiskPixel })),
      ];

      let bestPair: {
        profitSeg: VerticalSegment;
        riskSeg: VerticalSegment;
        profitTheme: 'GREEN' | 'BLUE_NAVY';
        riskTheme: 'RED' | 'GREY_SLATE';
        profitPred: (r: number, g: number, b: number) => boolean;
        riskPred: (r: number, g: number, b: number) => boolean;
        isLong: boolean;
        boxLeftX: number;
        boxRightX: number;
        score: number;
      } | null = null;

      for (const pCand of profitCandidates) {
        for (const rCand of riskCandidates) {
          const p = pCand.seg;
          const r = rCand.seg;
          const pL = p.medianLeftX ?? plotMinX;
          const pR = p.medianRightX ?? plotMaxX;
          const rL = r.medianLeftX ?? plotMinX;
          const rR = r.medianRightX ?? plotMaxX;

          const overlapL = Math.max(pL, rL);
          const overlapR = Math.min(pR, rR);
          const overlapW = Math.max(0, overlapR - overlapL);
          const minSpanW = Math.max(1, Math.min(pR - pL, rR - rL));
          const horizOverlapRatio = overlapW / minSpanW;

          // Both Profit and Risk rectangles must share the same horizontal span (filters out small "OB m5" inner boxes!)
          if (horizOverlapRatio < 0.55 || overlapW < minBoxRunWidth) continue;

          // Total vertical height must be at least 30px on 800px canvas to ignore tiny annotations
          if (p.height + r.height < 30) continue;

          // Case 1: BUY (Long) -> Profit Zone (Green or Blue/Navy) is ABOVE Risk Zone (Red or Grey/Slate)
          const gapBuy = Math.abs(r.top - p.bottom);
          if (gapBuy <= sampleH * 0.045 && p.top < r.bottom) {
            const score =
              ((p.height + r.height) * (p.avgScore + r.avgScore) * horizOverlapRatio) /
              (1 + gapBuy * 2.5);
            if (!bestPair || score > bestPair.score) {
              bestPair = {
                profitSeg: p,
                riskSeg: r,
                profitTheme: pCand.theme,
                riskTheme: rCand.theme,
                profitPred: pCand.predicate,
                riskPred: rCand.predicate,
                isLong: true,
                boxLeftX: overlapL,
                boxRightX: overlapR,
                score,
              };
            }
          }

          // Case 2: SELL (Short) -> Risk Zone (Red or Grey/Slate) is ABOVE Profit Zone (Green or Blue/Navy)
          const gapSell = Math.abs(p.top - r.bottom);
          if (gapSell <= sampleH * 0.045 && r.top < p.bottom) {
            const score =
              ((p.height + r.height) * (p.avgScore + r.avgScore) * horizOverlapRatio) /
              (1 + gapSell * 2.5);
            if (!bestPair || score > bestPair.score) {
              bestPair = {
                profitSeg: p,
                riskSeg: r,
                profitTheme: pCand.theme,
                riskTheme: rCand.theme,
                profitPred: pCand.predicate,
                riskPred: rCand.predicate,
                isLong: false,
                boxLeftX: overlapL,
                boxRightX: overlapR,
                score,
              };
            }
          }
        }
      }

      if (bestPair) {
        const { profitSeg, riskSeg, profitTheme, riskTheme, profitPred, riskPred, isLong, boxLeftX, boxRightX } =
          bestPair;
        const boxW = Math.max(1, boxRightX - boxLeftX);

        let refinedProfitTop = profitSeg.top;
        let refinedProfitBottom = profitSeg.bottom;
        for (let y = Math.max(plotMinY, profitSeg.top - 4); y <= Math.min(plotMaxY, profitSeg.bottom + 4); y++) {
          let cnt = 0;
          for (let x = boxLeftX; x <= boxRightX; x++) {
            const idx = (y * sampleW + x) * 4;
            if (profitPred(imgData[idx], imgData[idx + 1], imgData[idx + 2])) cnt++;
          }
          if (cnt >= boxW * 0.52) {
            if (y < refinedProfitTop) refinedProfitTop = y;
            if (y > refinedProfitBottom) refinedProfitBottom = y;
          }
        }

        let refinedRiskTop = riskSeg.top;
        let refinedRiskBottom = riskSeg.bottom;
        for (let y = Math.max(plotMinY, riskSeg.top - 4); y <= Math.min(plotMaxY, riskSeg.bottom + 4); y++) {
          let cnt = 0;
          for (let x = boxLeftX; x <= boxRightX; x++) {
            const idx = (y * sampleW + x) * 4;
            if (riskPred(imgData[idx], imgData[idx + 1], imgData[idx + 2])) cnt++;
          }
          if (cnt >= boxW * 0.52) {
            if (y < refinedRiskTop) refinedRiskTop = y;
            if (y > refinedRiskBottom) refinedRiskBottom = y;
          }
        }

        const profitH = Math.max(4, refinedProfitBottom - refinedProfitTop);
        const riskH = Math.max(4, refinedRiskBottom - refinedRiskTop);
        const inferredPosition: TradePosition = isLong ? 'BUY' : 'SELL';
        const inferredRR = Math.max(0.15, Math.min(30, Number((profitH / riskH).toFixed(2))));

        // For BUY: Profit is on top (tpY = refinedProfitTop), Entry is middle divider, SL is bottom of Risk (refinedRiskBottom)
        // For SELL: Risk (Grey/Red) is on top (slY = refinedRiskTop), Entry is middle divider, Profit (Blue/Green) is bottom (tpY = refinedProfitBottom)
        const entryY = isLong
          ? (refinedProfitBottom + refinedRiskTop) / 2
          : (refinedRiskBottom + refinedProfitTop) / 2;
        const tpY = isLong ? refinedProfitTop : refinedProfitBottom;
        const slY = isLong ? refinedRiskBottom : refinedRiskTop;

        resolve({
          hasPositionBox: true,
          inferredPosition,
          inferredRR,
          entryYRatio: entryY / sampleH,
          tpYRatio: tpY / sampleH,
          slYRatio: slY / sampleH,
          boxTopYRatio: Math.min(refinedProfitTop, refinedRiskTop) / sampleH,
          boxBottomYRatio: Math.max(refinedProfitBottom, refinedRiskBottom) / sampleH,
          profitTheme,
          riskTheme,
          rightAxisGreenBadgeYRatio,
          rightAxisRedBadgeYRatio,
          rightAxisBlueOrDarkBadgeYRatio,
          horizontalLineYRatios: [],
          imageWidth: img.width,
          imageHeight: img.height,
        });
        return;
      }

      resolve({
        ...empty,
        rightAxisGreenBadgeYRatio,
        rightAxisRedBadgeYRatio,
        rightAxisBlueOrDarkBadgeYRatio,
        imageWidth: img.width,
        imageHeight: img.height,
      });
    };
    img.src = dataUrl;
  });
}

/**
 * Builds the unified Gemini Vision prompt incorporating the exact visual rules for MT5 and TradingView.
 */
export function buildGeminiScreenshotPrompt(canvasHints?: CanvasZoneAnalysis | null): string {
  const geometryHintBlock =
    canvasHints && canvasHints.hasPositionBox
      ? `\nPIXEL GEOMETRY SCANNER HINTS (VERIFIED FROM IMAGE):
- Detected a TradingView ${canvasHints.inferredPosition || 'BUY/SELL'} Position Box (${
          canvasHints.profitTheme === 'BLUE_NAVY' ? 'Dark Blue/Navy Profit Zone' : 'Green Profit Zone'
        } & ${
          canvasHints.riskTheme === 'GREY_SLATE' ? 'Grey/Slate Risk Zone' : 'Red Risk Zone'
        }):
  * Verified Direction: ${canvasHints.inferredPosition} (${
          canvasHints.inferredPosition === 'SELL'
            ? 'Risk Zone is at the TOP, Profit Zone is at the BOTTOM -> SELL'
            : 'Profit Zone is at the TOP, Risk Zone is at the BOTTOM -> BUY'
        })
  * Top of Position Box (${canvasHints.inferredPosition === 'SELL' ? 'STOP LOSS' : 'TAKE PROFIT'}) is at vertical Y = ${
          canvasHints.boxTopYRatio != null ? (canvasHints.boxTopYRatio * 100).toFixed(1) + '%' : 'N/A'
        } from top of image.
  * Central Dividing Line between the two blocks (ENTRY PRICE) is at vertical Y = ${
          canvasHints.entryYRatio != null ? (canvasHints.entryYRatio * 100).toFixed(1) + '%' : 'N/A'
        } from top of image.
  * Bottom of Position Box (${canvasHints.inferredPosition === 'SELL' ? 'TAKE PROFIT' : 'STOP LOSS'}) is at vertical Y = ${
          canvasHints.boxBottomYRatio != null ? (canvasHints.boxBottomYRatio * 100).toFixed(1) + '%' : 'N/A'
        } from top of image.\n`
      : '';

  return `You are an elite financial chart & order OCR specialist for MetaTrader 5 (MT5 / MT4) and TradingView.
Carefully inspect the full, uncropped screenshot from the left edge to the right-hand Y-axis price scale.
${geometryHintBlock}
1. RULES FOR METATRADER 5 (MT5) CHARTS:
   - Read the text labels at the LEFT edge of the chart: "TP", "SL", "BUY LIMIT", "SELL LIMIT", "BUY STOP", "SELL STOP", "BUY", "SELL" (for example: "TP", "BUY LIMIT 0.12", "SL").
   - Follow each label's horizontal dashed line straight across to the RIGHT-HAND Y-AXIS, and ONLY extract the price number that is inside a THIN OUTLINED BOX (kotak berbingkai tipis) aligned with that horizontal line:
     * Example: "TP" line -> outlined box "4074.43" on right Y-axis -> takeProfit = 4074.43
     * Example: "BUY LIMIT 0.12" line -> outlined box "4042.74" on right Y-axis -> entryPrice = 4042.74, lotSize = 0.12, position = "BUY"
     * Example: "SL" line -> outlined box "4031.97" on right Y-axis -> stopLoss = 4031.97
   - IGNORE unframed plain background grid numbers on the Y-axis (such as "4052.92" or "4030.42").
   - IGNORE the bright blue/colored running price badge that has a countdown timer next to/below it (such as "4050.87 / 00:50") — put that ONLY in currentPrice, NEVER in entryPrice, stopLoss, or takeProfit!
   - CRITICAL STATUS RULE: If the order label contains "LIMIT" or "STOP" (e.g. "BUY LIMIT 0.12", "SELL LIMIT", "BUY STOP"), you MUST set status = "PLANNED" (NOT "ACTIVE")!

2. RULES FOR TRADINGVIEW CHARTS:
   - Look for the TWO LARGE VERTICALLY-ADJACENT COLORED BLOCKS of the Position Tool — these can be either:
     * Standard Green (Profit) & Red (Risk), OR
     * Custom Dark Blue / Navy (Profit Zone) & Grey / Slate (Risk Zone)!
   - Direction Rule:
     * If the Grey/Slate or Red Risk block is at the TOP and the Dark Blue/Navy or Green Profit block is at the BOTTOM, the position is SELL (takeProfit < entryPrice < stopLoss).
     * If the Green or Dark Blue/Navy Profit block is at the TOP and the Red or Grey/Slate Risk block is at the BOTTOM, the position is BUY (stopLoss < entryPrice < takeProfit).
   - IGNORE small inner annotation boxes in the middle of the chart (such as boxes labeled "OB m5", "FVG", "BOS", etc.) and ignore the live market candle price badge (e.g. "4.105,780" or "4.105,735").
   - Read the exact price labels on the RIGHT-HAND Y-AXIS aligned with:
     (1) The outer TOP edge of the top block (for SELL: stopLoss, e.g. "4.099,857" -> 4099.857),
     (2) The CENTRAL HORIZONTAL DIVIDING LINE where the two blocks meet (entryPrice, e.g. "4.093,045" -> 4093.045),
     (3) The outer BOTTOM edge of the bottom block (for SELL: takeProfit, e.g. the blue badge "4.054,405" -> 4054.405).
   - NUMBER FORMAT NORMALIZATION: If the Y-axis uses dot thousands and comma decimals (e.g. "4.099,857", "4.093,045", "4.054,405"), remove the thousands dot (.) and convert the comma (,) to a decimal point -> 4099.857, 4093.045, 4054.405.
   - LOT SIZE ON TRADINGVIEW: Always return null for lotSize on TradingView.

3. MANDATORY VALIDATION (NO FAKE NUMBERS):
   - Never invent or calculate synthetic SL/TP prices with arbitrary offsets!
   - For BUY: stopLoss < entryPrice < takeProfit.
   - For SELL: takeProfit < entryPrice < stopLoss.
   - On XAUUSD, the distance |entryPrice - stopLoss| and |takeProfit - entryPrice| must be at least >= 1.00 point (never tiny 0.04 noise).`;
}

/**
 * Parses and validates raw JSON returned by Gemini Vision (client-side or server-side),
 * applying `normalizeChartPriceNumber` and strict BUY/SELL & LIMIT/STOP rules without any fake synthetic formulas.
 */
export function normalizeGeminiScanResponse(
  parsedData: any,
  canvasHints?: CanvasZoneAnalysis | null,
  modelUsed = 'gemini-4-hydrogen',
  resolvedImageUrl?: string
): ExtractedTradeScanData {
  const cleanInstrument = normalizeScanInstrument(parsedData?.instrument);
  const spec = INSTRUMENT_PRICE_RANGES[cleanInstrument] || INSTRUMENT_PRICE_RANGES.XAUUSD;

  const rawSource = String(parsedData?.source || '').toUpperCase();
  const source: 'MT5' | 'TRADINGVIEW' | 'CHART' =
    rawSource === 'MT5'
      ? 'MT5'
      : rawSource === 'TRADINGVIEW' || canvasHints?.hasPositionBox
      ? 'TRADINGVIEW'
      : 'CHART';

  const leftLabelsStr = String(parsedData?.leftEdgeLabels || '');
  const notesText = String(parsedData?.notes || '');
  const combinedLabelsText = `${leftLabelsStr} ${notesText}`;

  const hasExplicitMt5Buy = /\b(?:BUY|BELI)(?:\s+(?:LIMIT|STOP))?\b/i.test(combinedLabelsText);
  const hasExplicitMt5Sell = /\b(?:SELL|JUAL)(?:\s+(?:LIMIT|STOP))?\b/i.test(combinedLabelsText);

  const hasVerifiedDirection = Boolean(
    (source === 'TRADINGVIEW' &&
      canvasHints?.hasPositionBox &&
      (canvasHints.inferredPosition === 'BUY' || canvasHints.inferredPosition === 'SELL')) ||
      (hasExplicitMt5Buy && !hasExplicitMt5Sell) ||
      (hasExplicitMt5Sell && !hasExplicitMt5Buy)
  );

  const rawPosUpper = String(parsedData?.position || '').toUpperCase();
  let position: TradePosition =
    source === 'TRADINGVIEW' &&
    canvasHints?.hasPositionBox &&
    (canvasHints.inferredPosition === 'BUY' || canvasHints.inferredPosition === 'SELL')
      ? canvasHints.inferredPosition
      : hasExplicitMt5Sell && !hasExplicitMt5Buy
      ? 'SELL'
      : hasExplicitMt5Buy && !hasExplicitMt5Sell
      ? 'BUY'
      : rawPosUpper === 'SELL' || rawPosUpper === 'JUAL' || rawPosUpper === 'SHORT'
      ? 'SELL'
      : 'BUY';

  let entryPrice = normalizeChartPriceNumber(parsedData?.entryPrice, cleanInstrument);
  let stopLoss = normalizeChartPriceNumber(parsedData?.stopLoss, cleanInstrument);
  let takeProfit = normalizeChartPriceNumber(parsedData?.takeProfit, cleanInstrument);
  const exitPrice = normalizeChartPriceNumber(parsedData?.exitPrice, cleanInstrument);
  const currentPrice = normalizeChartPriceNumber(parsedData?.currentPrice, cleanInstrument);
  const profit =
    parsedData?.profit !== null && parsedData?.profit !== undefined
      ? Number(parsedData.profit)
      : null;

  const rawLot = normalizeChartPriceNumber(parsedData?.lotSize, 'EURUSD');
  const lotSize = source === 'MT5' && rawLot !== null && rawLot > 0 && rawLot <= 200 ? rawLot : null;

  // Enforce directional ordering when all 3 real prices are present
  if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
    if (hasVerifiedDirection) {
      if (position === 'BUY' && stopLoss > entryPrice && takeProfit < entryPrice) {
        const tmp = stopLoss;
        stopLoss = takeProfit;
        takeProfit = tmp;
      } else if (position === 'SELL' && stopLoss < entryPrice && takeProfit > entryPrice) {
        const tmp = stopLoss;
        stopLoss = takeProfit;
        takeProfit = tmp;
      }
    } else {
      if (stopLoss < entryPrice && entryPrice < takeProfit) {
        position = 'BUY';
      } else if (takeProfit < entryPrice && entryPrice < stopLoss) {
        position = 'SELL';
      } else if (position === 'BUY' && stopLoss > takeProfit) {
        const tmp = stopLoss;
        stopLoss = takeProfit;
        takeProfit = tmp;
      } else if (position === 'SELL' && stopLoss < takeProfit) {
        const tmp = stopLoss;
        stopLoss = takeProfit;
        takeProfit = tmp;
      }
    }
  }

  // Reject tiny fake/micro-noise or wrong-side SL/TP
  if (
    entryPrice !== null &&
    stopLoss !== null &&
    (Math.abs(entryPrice - stopLoss) < spec.minSlTpDistance ||
      (position === 'BUY' && stopLoss >= entryPrice) ||
      (position === 'SELL' && stopLoss <= entryPrice))
  ) {
    stopLoss = null;
  }
  if (
    entryPrice !== null &&
    takeProfit !== null &&
    (Math.abs(takeProfit - entryPrice) < spec.minSlTpDistance ||
      (position === 'BUY' && takeProfit <= entryPrice) ||
      (position === 'SELL' && takeProfit >= entryPrice))
  ) {
    takeProfit = null;
  }

  // Detect PENDING / LIMIT / STOP status
  const rawStatus = String(parsedData?.status || '').toUpperCase();
  const hasLimitOrStopKeyword = /\b(BUY\s+LIMIT|SELL\s+LIMIT|BUY\s+STOP|SELL\s+STOP|BELI\s+LIMIT|JUAL\s+LIMIT|LIMIT|PENDING)\b/i.test(
    combinedLabelsText
  );

  let status: 'PLANNED' | 'ACTIVE' | 'CLOSED' =
    rawStatus === 'CLOSED'
      ? 'CLOSED'
      : rawStatus === 'PLANNED' || hasLimitOrStopKeyword
      ? 'PLANNED'
      : rawStatus === 'ACTIVE'
      ? 'ACTIVE'
      : 'PLANNED';

  if (source === 'TRADINGVIEW' && status !== 'CLOSED') {
    status = 'PLANNED';
  }

  let plannedRiskReward = normalizeChartPriceNumber(parsedData?.plannedRiskReward, 'EURUSD');
  if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk >= spec.minSlTpDistance) {
      plannedRiskReward = Number((reward / risk).toFixed(2));
    }
  }

  const hasAnyValidLevel =
    entryPrice !== null ||
    stopLoss !== null ||
    takeProfit !== null ||
    exitPrice !== null ||
    (profit !== null && Number.isFinite(profit));

  return {
    detected: parsedData?.detected !== false && hasAnyValidLevel,
    source,
    instrument: cleanInstrument,
    position,
    lotSize,
    entryPrice,
    stopLoss,
    takeProfit,
    exitPrice,
    profit: profit !== null && Number.isFinite(profit) ? profit : null,
    status,
    plannedRiskReward,
    timeframe: normalizeTimeframeLabel(parsedData?.timeframe),
    currentPrice,
    confidence: 0.96,
    notes: notesText || leftLabelsStr || `${cleanInstrument} ${position}`,
    modelUsed,
    resolvedImageUrl,
  };
}

async function runOcrSpaceOnDataUrl(
  base64DataUrl: string
): Promise<OcrExtractionResult> {
  const words: OcrWordBox[] = [];
  const lines: Array<{ text: string; centerY: number; minX: number; maxX: number }> = [];
  let fullText = '';

  try {
    const formData = new FormData();
    formData.append('apikey', 'helloworld');
    formData.append('base64Image', base64DataUrl);
    formData.append('OCREngine', '2');
    formData.append('scale', 'true');
    formData.append('isOverlayRequired', 'true');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      const parsedResult = json?.ParsedResults?.[0];
      if (parsedResult) {
        fullText = String(parsedResult.ParsedText || '');
        const rawLines = parsedResult.TextOverlay?.Lines;
        if (Array.isArray(rawLines)) {
          for (const line of rawLines) {
            const lineWords: OcrWordBox[] = [];
            if (Array.isArray(line.Words)) {
              for (const w of line.Words) {
                const wt = String(w.WordText || '').trim();
                if (!wt) continue;
                const left = Number(w.Left) || 0;
                const top = Number(w.Top) || 0;
                const width = Number(w.Width) || 0;
                const height = Number(w.Height) || 0;
                const box: OcrWordBox = {
                  text: wt,
                  left,
                  top,
                  width,
                  height,
                  centerX: left + width / 2,
                  centerY: top + height / 2,
                };
                words.push(box);
                lineWords.push(box);
              }
            }
            if (lineWords.length > 0) {
              const avgY = lineWords.reduce((acc, item) => acc + item.centerY, 0) / lineWords.length;
              const minX = Math.min(...lineWords.map((item) => item.left));
              const maxX = Math.max(...lineWords.map((item) => item.left + item.width));
              lines.push({
                text: String(line.LineText || lineWords.map((item) => item.text).join(' ')).trim(),
                centerY: avgY,
                minX,
                maxX,
              });
            }
          }
        }
      }
    }
  } catch {
    // ignore OCR network errors
  }

  return { fullText, lines, words };
}

function getActiveChartSymbolFallback(): string {
  if (typeof window === 'undefined') return 'XAUUSD';
  try {
    const rawPrefs = window.localStorage.getItem(CHART_PREFS_STORAGE_KEY);
    if (rawPrefs) {
      const prefs = JSON.parse(rawPrefs);
      if (prefs?.symbol) {
        return normalizeScanInstrument(prefs.symbol);
      }
    }
  } catch {
    // ignore
  }
  return 'XAUUSD';
}

/**
 * Parses OCR text + spatial Y-coordinates + Canvas geometry into a complete ExtractedTradeScanData object.
 * STRICT RULES:
 * - ZERO synthetic/fake SL/TP formulas or linear Y-axis guessing!
 * - Only real numbers read from OCR badges/labels are used.
 * - Supports European/Indonesian TradingView price format (`4.054,405` -> `4054.405`).
 * - Detects `BUY LIMIT` / `SELL LIMIT` / `BUY STOP` / `SELL STOP` as `status: 'PLANNED'`.
 */
export function synthesizeTradeScanFromSignals(params: {
  ocr: OcrExtractionResult;
  canvasGeom?: CanvasZoneAnalysis | null;
  urlMeta?: {
    isTradingViewUrl: boolean;
    symbolFromUrl: string | null;
    timeframeFromUrl: string | null;
    pageTitle: string;
    pageDescription: string;
    directImageUrl: string;
  } | null;
}): ExtractedTradeScanData {
  const { ocr } = params;
  const canvasGeom: CanvasZoneAnalysis = params.canvasGeom || {
    hasPositionBox: false,
    inferredPosition: null,
    inferredRR: null,
    entryYRatio: null,
    tpYRatio: null,
    slYRatio: null,
    boxTopYRatio: null,
    boxBottomYRatio: null,
    rightAxisGreenBadgeYRatio: null,
    rightAxisRedBadgeYRatio: null,
    rightAxisBlueOrDarkBadgeYRatio: null,
    horizontalLineYRatios: [],
    imageWidth: 1000,
    imageHeight: 600,
  };
  const urlMeta = params.urlMeta || {
    isTradingViewUrl: false,
    symbolFromUrl: null,
    timeframeFromUrl: null,
    pageTitle: '',
    pageDescription: '',
    directImageUrl: '',
  };
  const combinedText = `${urlMeta.pageTitle}\n${urlMeta.pageDescription}\n${ocr.fullText}`;
  const upperText = combinedText.toUpperCase();

  const imgW = canvasGeom.imageWidth || 1000;
  const imgH = canvasGeom.imageHeight || 600;

  // 1. Detect Instrument / Pair first so number normalization knows the instrument
  let instrument = urlMeta.symbolFromUrl || '';
  if (!instrument) {
    const symbolRegex =
      /\b(XAUUSD|GOLD|XAU\/USD|BTCUSD|BTCUSDT|ETHUSD|ETHUSDT|SOLUSD|EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD|AUDUSD|NZDUSD|EURGBP|EURJPY|GBPJPY|AUDJPY|US30|NAS100|USTEC|SPX500|US500|GER40)\b/i;
    const m = combinedText.match(symbolRegex);
    if (m && m[1]) {
      instrument = normalizeScanInstrument(m[1]);
    }
  }
  if (!instrument) {
    instrument = getActiveChartSymbolFallback();
  }

  let priceSpec = INSTRUMENT_PRICE_RANGES[instrument] || INSTRUMENT_PRICE_RANGES.XAUUSD;

  // 2. Detect MT5 Order Lines & Labels with their exact Y-coordinates and LIMIT/STOP pending status
  let mt5OrderDirection: TradePosition | null = null;
  let mt5IsPendingOrder = false;
  let mt5DetectedLot: number | null = null;
  let mt5EntryFromText: number | null = null;
  let mt5CurrentFromArrow: number | null = null;
  let mt5OrderLineY: number | null = null;
  let mt5SlLineY: number | null = null;
  let mt5TpLineY: number | null = null;

  for (const line of ocr.lines) {
    const t = line.text.trim();
    // Match MT5 chart order line: e.g. "BUY LIMIT 0.12", "#123456 buy 0.10", "sell stop 0.25 at 2650.00"
    const orderMatch = t.match(
      /\b(buy|sell)(?:\s+(limit|stop))?\s+(\d+(?:[.,]\d{1,2})?)(?:\s*(?:at|@)\s*([0-9][0-9., ]+))?/i
    );
    if (orderMatch) {
      mt5OrderDirection = orderMatch[1].toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
      if (orderMatch[2]) {
        mt5IsPendingOrder = true;
      }
      const parsedLot = parseFloat(orderMatch[3].replace(',', '.'));
      if (!isNaN(parsedLot) && parsedLot >= 0.01 && parsedLot <= 200) {
        mt5DetectedLot = parsedLot;
      }
      if (orderMatch[4]) {
        const p = normalizeChartPriceNumber(orderMatch[4], instrument);
        if (p !== null && p >= priceSpec.min && p <= priceSpec.max) {
          mt5EntryFromText = p;
        }
      }
      mt5OrderLineY = line.centerY;
    }

    // Match MT5 Trade/History Tab "<entryPrice> -> <currentPrice>" arrow syntax
    const arrowMatch = t.match(
      /\b([0-9]{1,6}(?:[ .,][0-9]{3})*[.,][0-9]{1,5})\s*(?:->|→|-›|=>)\s*([0-9]{1,6}(?:[ .,][0-9]{3})*[.,][0-9]{1,5})\b/
    );
    if (arrowMatch) {
      const p1 = normalizeChartPriceNumber(arrowMatch[1], instrument);
      const p2 = normalizeChartPriceNumber(arrowMatch[2], instrument);
      if (p1 !== null && p1 >= priceSpec.min && p1 <= priceSpec.max) mt5EntryFromText = p1;
      if (p2 !== null && p2 >= priceSpec.min && p2 <= priceSpec.max) mt5CurrentFromArrow = p2;
    }

    // Match MT5 "SL" / "S/L" label on horizontal line
    if (/^(?:s\/l|sl)\b/i.test(t) || /\bsl\s*[:=]?\s*\d/i.test(t)) {
      mt5SlLineY = line.centerY;
    }
    // Match MT5 "TP" / "T/P" label on horizontal line
    if (/^(?:t\/p|tp)\b/i.test(t) || /\btp\s*[:=]?\s*\d/i.test(t)) {
      mt5TpLineY = line.centerY;
    }
  }

  if (!mt5OrderDirection) {
    const fullOrderMatch = combinedText.match(
      /\b(buy|sell)(?:\s+(limit|stop))?\s+(\d+[.,]\d{2})(?:\s*(?:at|@)\s*([0-9][0-9., ]+))?/i
    );
    if (fullOrderMatch) {
      mt5OrderDirection = fullOrderMatch[1].toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
      if (fullOrderMatch[2]) mt5IsPendingOrder = true;
      const parsedLot = parseFloat(fullOrderMatch[3].replace(',', '.'));
      if (!isNaN(parsedLot) && parsedLot >= 0.01 && parsedLot <= 200) {
        mt5DetectedLot = parsedLot;
      }
      if (fullOrderMatch[4]) {
        const p = normalizeChartPriceNumber(fullOrderMatch[4], instrument);
        if (p !== null && p >= priceSpec.min && p <= priceSpec.max) {
          mt5EntryFromText = p;
        }
      }
    }
  }

  // 3. Determine Source ('MT5' vs 'TRADINGVIEW')
  let source: 'MT5' | 'TRADINGVIEW' | 'CHART' = 'TRADINGVIEW';
  const hasTvMarkers =
    urlMeta.isTradingViewUrl ||
    canvasGeom.hasPositionBox ||
    upperText.includes('TRADINGVIEW') ||
    upperText.includes('OANDA:') ||
    upperText.includes('FX:') ||
    upperText.includes('RISK/REWARD') ||
    upperText.includes('OPEN P&L');

  const hasMt5Markers =
    upperText.includes('METATRADER') ||
    upperText.includes('MT5') ||
    upperText.includes('MT4') ||
    mt5DetectedLot !== null;

  if (hasMt5Markers && !canvasGeom.hasPositionBox && !urlMeta.isTradingViewUrl) {
    source = 'MT5';
  } else if (hasTvMarkers) {
    source = 'TRADINGVIEW';
  } else if (mt5DetectedLot !== null) {
    source = 'MT5';
  }

  let timeframe = urlMeta.timeframeFromUrl;
  if (!timeframe) {
    const tfMatch = combinedText.match(/\b(M1|M3|M5|M15|M30|H1|H4|D1|1M|5M|15M|30M|1H|4H|1D|DAILY)\b/i);
    if (tfMatch?.[1]) {
      timeframe = normalizeTimeframeLabel(tfMatch[1]);
    }
  }

  // 4. Collect all price tokens from OCR lines using `extractPriceNumbersFromLine` (supports 4.054,405!)
  const allDecimalTokens: Array<{
    raw: string;
    val: number;
    y: number;
    x: number;
    isRightAxis: boolean;
  }> = [];

  for (const line of ocr.lines) {
    const tokens = extractPriceNumbersFromLine(line.text, instrument);
    for (const tok of tokens) {
      allDecimalTokens.push({
        raw: tok.raw,
        val: tok.val,
        y: line.centerY,
        x: line.maxX,
        isRightAxis: line.maxX >= imgW * 0.65 || line.minX >= imgW * 0.6,
      });
    }
  }

  if (allDecimalTokens.length === 0 && combinedText) {
    const tokens = extractPriceNumbersFromLine(combinedText, instrument);
    tokens.forEach((tok, idx) => {
      allDecimalTokens.push({
        raw: tok.raw,
        val: tok.val,
        y: idx * 25,
        x: imgW * 0.85,
        isRightAxis: true,
      });
    });
  }

  // Auto-correct instrument if Y-axis numbers clearly belong to another instrument range
  const matchingInitialRange = allDecimalTokens.filter(
    (t) => t.val >= priceSpec.min && t.val <= priceSpec.max
  );
  if (!urlMeta.symbolFromUrl && matchingInitialRange.length < 2) {
    const btcTokens = allDecimalTokens.filter((t) => t.val >= 40000 && t.val <= 180000);
    const eurTokens = allDecimalTokens.filter((t) => t.val >= 1.01 && t.val <= 1.18);
    const gbpTokens = allDecimalTokens.filter((t) => t.val >= 1.2 && t.val <= 1.42);
    const jpyTokens = allDecimalTokens.filter((t) => t.val >= 130 && t.val <= 175);

    if (btcTokens.length >= 2) instrument = 'BTCUSD';
    else if (eurTokens.length >= 2) instrument = 'EURUSD';
    else if (gbpTokens.length >= 2) instrument = 'GBPUSD';
    else if (jpyTokens.length >= 2) instrument = 'USDJPY';

    priceSpec = INSTRUMENT_PRICE_RANGES[instrument] || priceSpec;
  }

  const validPriceTokens = allDecimalTokens.filter((t) => {
    if (t.val < priceSpec.min || t.val > priceSpec.max) return false;
    if (priceSpec.decimals === 5 && (t.raw === '1.00' || t.raw === '1.0')) return false;
    return true;
  });

  // 5. Extract Explicit Labeled Prices (Target/TP, Stop/SL, Entry)
  let explicitEntry: number | null = mt5EntryFromText;
  let explicitSL: number | null = null;
  let explicitTP: number | null = null;
  let explicitRR: number | null = null;

  const entryMatch = combinedText.match(
    /(?:entry\s*price|open\s*price|harga\s*entry|\bentry\s*[:=@])\s*([0-9][0-9., ]+)/i
  );
  if (entryMatch?.[1] && explicitEntry === null) {
    const v = normalizeChartPriceNumber(entryMatch[1], instrument);
    if (v !== null && v >= priceSpec.min && v <= priceSpec.max) explicitEntry = v;
  }

  const slMatch = combinedText.match(
    /(?:stop\s*loss|\bstop\s*[:=]|\bs\/l\s*[:=]?|\bsl\s*[:=])\s*([0-9][0-9., ]+)/i
  );
  if (slMatch?.[1]) {
    const v = normalizeChartPriceNumber(slMatch[1], instrument);
    if (v !== null && v >= priceSpec.min && v <= priceSpec.max) explicitSL = v;
  }

  const tpMatch = combinedText.match(
    /(?:take\s*profit|\btarget\s*[:=]|\bt\/p\s*[:=]?|\btp\s*[:=])\s*([0-9][0-9., ]+)/i
  );
  if (tpMatch?.[1]) {
    const v = normalizeChartPriceNumber(tpMatch[1], instrument);
    if (v !== null && v >= priceSpec.min && v <= priceSpec.max) explicitTP = v;
  }

  const rrMatch = combinedText.match(
    /(?:risk\/reward(?:\s*ratio)?|r:r|\brr\b|1\s*:)\s*[:=]?\s*(\d+(?:[.,]\d{1,2})?)/i
  );
  if (rrMatch?.[1]) {
    const v = parseFloat(rrMatch[1].replace(',', '.'));
    if (!isNaN(v) && v >= 0.15 && v <= 30) explicitRR = v;
  }

  // 6. Determine Position Direction (BUY vs SELL)
  let position: TradePosition = 'BUY';
  if (canvasGeom.hasPositionBox && canvasGeom.inferredPosition) {
    position = canvasGeom.inferredPosition;
  } else if (mt5OrderDirection) {
    position = mt5OrderDirection;
  } else if (explicitTP !== null && explicitSL !== null && explicitTP !== explicitSL) {
    position = explicitTP > explicitSL ? 'BUY' : 'SELL';
  } else if (mt5TpLineY !== null && mt5SlLineY !== null && mt5TpLineY !== mt5SlLineY) {
    position = mt5TpLineY < mt5SlLineY ? 'BUY' : 'SELL';
  } else if (/\b(SHORT|SELL)\b/i.test(combinedText) && !/\b(LONG|BUY)\b/i.test(combinedText)) {
    position = 'SELL';
  }

  // 7. Match REAL OCR Price Badges at Target Y-Coordinates (NO synthetic linear interpolation!)
  let entryPrice = explicitEntry;
  let takeProfit = explicitTP;
  let stopLoss = explicitSL;

  const badgeTolerancePx = Math.max(18, imgH * 0.045);

  const findRealBadgePriceAtY = (targetY: number | null): number | null => {
    if (targetY === null || !Number.isFinite(targetY)) return null;
    const candidates = validPriceTokens.filter((t) => t.isRightAxis);
    const pool = candidates.length > 0 ? candidates : validPriceTokens;
    let closest: { val: number; dist: number } | null = null;
    for (const tok of pool) {
      const d = Math.abs(tok.y - targetY);
      if (d <= badgeTolerancePx && (!closest || d < closest.dist)) {
        closest = { val: tok.val, dist: d };
      }
    }
    return closest ? closest.val : null;
  };

  const targetEntryY =
    canvasGeom.entryYRatio !== null && canvasGeom.entryYRatio !== undefined
      ? canvasGeom.entryYRatio * imgH
      : mt5OrderLineY !== null
      ? mt5OrderLineY
      : canvasGeom.rightAxisBlueOrDarkBadgeYRatio !== null &&
        canvasGeom.rightAxisBlueOrDarkBadgeYRatio !== undefined
      ? canvasGeom.rightAxisBlueOrDarkBadgeYRatio * imgH
      : null;

  const targetTpY =
    canvasGeom.tpYRatio !== null && canvasGeom.tpYRatio !== undefined
      ? canvasGeom.tpYRatio * imgH
      : mt5TpLineY !== null
      ? mt5TpLineY
      : canvasGeom.rightAxisGreenBadgeYRatio !== null &&
        canvasGeom.rightAxisGreenBadgeYRatio !== undefined
      ? canvasGeom.rightAxisGreenBadgeYRatio * imgH
      : null;

  const targetSlY =
    canvasGeom.slYRatio !== null && canvasGeom.slYRatio !== undefined
      ? canvasGeom.slYRatio * imgH
      : mt5SlLineY !== null
      ? mt5SlLineY
      : canvasGeom.rightAxisRedBadgeYRatio !== null &&
        canvasGeom.rightAxisRedBadgeYRatio !== undefined
      ? canvasGeom.rightAxisRedBadgeYRatio * imgH
      : null;

  if (takeProfit === null) takeProfit = findRealBadgePriceAtY(targetTpY);
  if (stopLoss === null) stopLoss = findRealBadgePriceAtY(targetSlY);
  if (entryPrice === null) entryPrice = findRealBadgePriceAtY(targetEntryY);

  // Strictly NO synthetic/interpolated fallback: if any level is not detected at its label or Y-coordinate, keep it null!

  // Enforce directional consistency & minimum point distance (reject 0.04 micro-noise, NEVER invent fake prices!)
  if (stopLoss !== null && takeProfit !== null && stopLoss !== takeProfit) {
    if (!canvasGeom.hasPositionBox && !mt5OrderDirection) {
      position = takeProfit > stopLoss ? 'BUY' : 'SELL';
    } else if (
      (position === 'BUY' && takeProfit < stopLoss) ||
      (position === 'SELL' && takeProfit > stopLoss)
    ) {
      const temp = stopLoss;
      stopLoss = takeProfit;
      takeProfit = temp;
    }
  }

  if (entryPrice !== null && stopLoss !== null) {
    if (
      Math.abs(entryPrice - stopLoss) < priceSpec.minSlTpDistance ||
      (position === 'BUY' && stopLoss >= entryPrice) ||
      (position === 'SELL' && stopLoss <= entryPrice)
    ) {
      stopLoss = null;
    }
  }

  if (entryPrice !== null && takeProfit !== null) {
    if (
      Math.abs(takeProfit - entryPrice) < priceSpec.minSlTpDistance ||
      (position === 'BUY' && takeProfit <= entryPrice) ||
      (position === 'SELL' && takeProfit >= entryPrice)
    ) {
      takeProfit = null;
    }
  }

  // Strict Lot Size & Status Rule:
  // - MT5: Use the identified MT5 lot size; if BUY LIMIT / SELL LIMIT / BUY STOP / SELL STOP, status is 'PLANNED'.
  // - TradingView: Set lotSize = null so TradeForm calculates lot automatically from Equity & Risk %.
  const finalLotSize: number | null = source === 'MT5' ? mt5DetectedLot : null;
  const hasLimitKeywordInFullText = /\b(BUY\s+LIMIT|SELL\s+LIMIT|BUY\s+STOP|SELL\s+STOP)\b/i.test(
    combinedText
  );
  const finalStatus: 'PLANNED' | 'ACTIVE' | 'CLOSED' =
    source === 'MT5' && finalLotSize !== null && !mt5IsPendingOrder && !hasLimitKeywordInFullText
      ? 'ACTIVE'
      : 'PLANNED';

  let plannedRiskReward = explicitRR || canvasGeom.inferredRR || null;
  if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk >= priceSpec.minSlTpDistance) {
      plannedRiskReward = Number((reward / risk).toFixed(2));
    }
  }

  const summaryParts: string[] = [`${instrument} ${position}`];
  if (source === 'MT5' && finalLotSize !== null) summaryParts.push(`Lot ${finalLotSize}`);
  if (timeframe) summaryParts.push(`TF ${timeframe}`);
  if (entryPrice !== null) summaryParts.push(`Entry ${entryPrice}`);
  if (stopLoss !== null) summaryParts.push(`SL ${stopLoss}`);
  if (takeProfit !== null) summaryParts.push(`TP ${takeProfit}`);
  if (plannedRiskReward !== null) summaryParts.push(`R:R 1:${plannedRiskReward}`);

  return {
    detected: entryPrice !== null || canvasGeom.hasPositionBox || Boolean(urlMeta.symbolFromUrl),
    source,
    instrument,
    position,
    lotSize: finalLotSize,
    entryPrice,
    stopLoss,
    takeProfit,
    exitPrice: null,
    profit: null,
    status: finalStatus,
    plannedRiskReward,
    timeframe,
    currentPrice: mt5CurrentFromArrow ?? entryPrice,
    confidence: 0.95,
    notes: `Terdeteksi otomatis (${summaryParts.join(' · ')})`,
    modelUsed: 'hybrid-apk-vision-v4',
    resolvedImageUrl: urlMeta.directImageUrl || undefined,
  };
}

/**
 * Main entry point for scanning a trade screenshot (Data URL or TradingView/Chart Image URL).
 * PRIORITY 1: Direct Client-Side Gemini Vision API Call (works directly inside the Android APK without needing Express server).
 * PRIORITY 2: Server-Side `/api/extract-trade-screenshot` endpoint.
 * PRIORITY 3: Real-Badge OCR + 2D Multi-Theme Canvas Geometry (zero fake/synthetic numbers).
 */
export async function scanTradeScreenshotOrUrl(inputSource: string): Promise<ExtractedTradeScanData> {
  const trimmed = (inputSource || '').trim();
  if (!trimmed) {
    throw new Error('Unggah gambar atau masukkan tautan screenshot terlebih dahulu.');
  }

  const isDataUrl = trimmed.startsWith('data:image/');
  const tvResolved = resolveTradingViewSnapshotUrl(trimmed);

  let dataUrlToAnalyze: string | null = isDataUrl ? trimmed : null;
  let pageTitle = '';
  let pageDescription = '';

  if (!isDataUrl) {
    const fetched = await fetchImageUrlAsDataUrl(trimmed);
    dataUrlToAnalyze = fetched.dataUrl;
    pageTitle = fetched.pageTitle;
    pageDescription = fetched.pageDescription;
  }

  // Run fast (~15ms) 2D Multi-Theme Canvas Geometry Analysis (supports Green/Red AND Dark Blue/Navy + Grey/Slate)
  const canvasGeom: CanvasZoneAnalysis = dataUrlToAnalyze
    ? await analyzeChartCanvasGeometry(dataUrlToAnalyze)
    : {
        hasPositionBox: false,
        inferredPosition: null,
        inferredRR: null,
        entryYRatio: null,
        tpYRatio: null,
        slYRatio: null,
        boxTopYRatio: null,
        boxBottomYRatio: null,
        imageWidth: 0,
        imageHeight: 0,
      };

  const isNavigatorOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;

  // PRIORITY 1: Server-Side Gemini Vision API (`/api/extract-trade-screenshot`)
  const payload: {
    imageBase64?: string;
    imageUrl?: string;
    canvasHints?: CanvasZoneAnalysis;
  } = {
    canvasHints: canvasGeom,
  };
  if (dataUrlToAnalyze) {
    payload.imageBase64 = dataUrlToAnalyze;
  } else {
    payload.imageUrl = tvResolved.directImageUrl || trimmed;
  }

  const scanEndpoints = isNavigatorOffline
    ? []
    : getApiEndpointCandidates('/api/extract-trade-screenshot');
  const parallelOcrSpacePromise: Promise<OcrExtractionResult> =
    dataUrlToAnalyze && !isNavigatorOffline
      ? runOcrSpaceOnDataUrl(dataUrlToAnalyze)
      : Promise.resolve({ fullText: '', lines: [], words: [] });
  if (dataUrlToAnalyze) {
    prewarmOfflineTesseractWorker();
  }

  let lastServerError = '';
  for (const endpoint of scanEndpoints) {
    const serverRes = await nativeAwarePostJson(endpoint, payload, 22000);

    if (serverRes.ok && serverRes.json?.success && serverRes.json?.data) {
      const normalized = normalizeGeminiScanResponse(
        serverRes.json.data,
        canvasGeom,
        serverRes.json.data.modelUsed || 'gemini-4-hydrogen',
        !isDataUrl ? tvResolved.directImageUrl : undefined
      );
      if (
        (normalized.entryPrice !== null && normalized.entryPrice > 0) ||
        normalized.stopLoss !== null ||
        normalized.takeProfit !== null ||
        (normalized.exitPrice !== null && normalized.exitPrice > 0) ||
        normalized.profit !== null
      ) {
        return normalized;
      }
    } else if (serverRes.json?.error) {
      lastServerError = String(serverRes.json.error);
    } else if (serverRes.errorMessage) {
      lastServerError = serverRes.errorMessage;
    } else if (serverRes.status) {
      lastServerError = `HTTP ${serverRes.status} dari backend Scan Kilat.`;
    }
  }

  // PRIORITY 3: Real-Badge OCR (Parallel Online OCR.space -> Local On-Device Tesseract Offline OCR) + 2D Canvas Geometry
  let ocr: OcrExtractionResult = await parallelOcrSpacePromise;
  if (dataUrlToAnalyze && !ocr.fullText.trim()) {
    try {
      const precisionDataUrl = await preparePrecisionOcrVariant(dataUrlToAnalyze, 'chromatic_sharp');
      const localOcr = await runOfflineTesseractOcr(precisionDataUrl, { psm: '11' });
      ocr = {
        fullText: localOcr.fullText,
        lines: localOcr.lines,
        words: localOcr.words,
      };
    } catch {
      // Keep empty OCR and allow canvas hints / URL metadata fallback if present
    }
  }

  const fallbackResult = synthesizeTradeScanFromSignals({
    ocr,
    canvasGeom,
    urlMeta: {
      isTradingViewUrl: tvResolved.isTradingViewUrl,
      symbolFromUrl: tvResolved.symbolFromUrl,
      timeframeFromUrl: tvResolved.timeframeFromUrl,
      pageTitle,
      pageDescription,
      directImageUrl: !isDataUrl ? tvResolved.directImageUrl : '',
    },
  });

  const hasFallbackPrice =
    (fallbackResult.entryPrice !== null && fallbackResult.entryPrice > 0) ||
    fallbackResult.stopLoss !== null ||
    fallbackResult.takeProfit !== null ||
    (fallbackResult.exitPrice !== null && fallbackResult.exitPrice > 0);

  if (!hasFallbackPrice) {
    throw new Error(
      lastServerError ||
        'Harga Entry, SL, atau TP tidak terbaca pada gambar. Pastikan angka harga di sisi kanan chart (Y-axis) atau baris posisi MT5 terlihat jelas.'
    );
  }

  return fallbackResult;
}

// ============================================================================
// BATCH MT5 HISTORY SCREENSHOT SCANNER (CLOSED TRADES AUTO-LOGGER)
// ============================================================================

export type Mt5DuplicateReason =
  | 'EXACT_TICKET'
  | 'EXACT_JOURNAL_MATCH'
  | 'SIMILAR_JOURNAL_MATCH'
  | 'BATCH_OVERLAP';

export interface Mt5HistoryTradeCandidate {
  tempId: string;
  ticketId: string | null;
  instrument: string;
  position: TradePosition;
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  netProfit: number;
  openDateTime: string | null;
  closeDateTime: string; // YYYY-MM-DDTHH:mm
  exactOpenDateTime?: string | null; // YYYY-MM-DDTHH:mm:ss when seconds available
  exactCloseDateTime?: string | null; // YYYY-MM-DDTHH:mm:ss when seconds available
  closeType: TradeCloseType;
  notes: string;
  strategy: string;
  session: TradingSession;
  isDuplicate: boolean;
  duplicateReason?: Mt5DuplicateReason | null;
  duplicateMatchId?: string;
  isDoubleEntry?: boolean;
  selected: boolean;
  sourceImageIndex?: number;
  ocrSignRecovered?: boolean;
}

export type Mt5AuditIssueCode =
  | 'SIGN_MISMATCH'
  | 'PRICE_JUMP_EXTREME'
  | 'MAGNITUDE_MISMATCH'
  | 'SL_TP_INVALID'
  | 'CLOSE_TYPE_PROFIT_CONFLICT'
  | 'AUTO_SIGN_FIXED';

export interface Mt5AuditIssue {
  code: Mt5AuditIssueCode;
  severity: 'error' | 'warning' | 'info';
  messageId: string;
  messageEn: string;
  suggestedNetProfit?: number;
  suggestedPosition?: TradePosition;
  canSwapEntryExit?: boolean;
}

export interface Mt5CandidateAuditResult {
  status: 'OK' | 'WARNING' | 'ERROR';
  issues: Mt5AuditIssue[];
  estimatedStandardGross: number | null;
}

interface RawNormalizedMt5Row {
  ticketId: string | null;
  instrument: string;
  position: TradePosition;
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  netProfit: number;
  openDateTime: string | null;
  closeDateTime: string | null;
  closeType: TradeCloseType;
  notes: string;
  ocrSignRecovered?: boolean;
}

interface Mt5CacheEntry {
  rows: RawNormalizedMt5Row[];
  modelUsed: string;
  source: string;
  cachedAt: number;
}

const MT5_SCAN_CACHE_STORAGE_KEY = 'tradevault_mt5_scan_cache_v3';
const MT5_SCAN_CACHE_MAX_ENTRIES = 24;
const MT5_SCAN_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const mt5MemoryScanCache = new Map<string, Mt5CacheEntry>();

function readMt5SessionCache(): Record<string, Mt5CacheEntry> {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(MT5_SCAN_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMt5SessionCache(record: Record<string, Mt5CacheEntry>): void {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return;
  try {
    const entries = Object.entries(record)
      .filter(([, v]) => v && Array.isArray(v.rows))
      .sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0))
      .slice(0, MT5_SCAN_CACHE_MAX_ENTRIES);
    window.sessionStorage.setItem(
      MT5_SCAN_CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // ignore quota errors on sessionStorage
  }
}

async function computeImageContentHash(dataUrl: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const encoded = new TextEncoder().encode(dataUrl);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // fallback below
  }
  let h1 = 0x811c9dc5;
  for (let i = 0; i < dataUrl.length; i++) {
    h1 ^= dataUrl.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `fnv_${(h1 >>> 0).toString(16)}_${dataUrl.length}`;
}

function getCachedMt5ScanResult(
  hash: string,
  options?: { allowOfflineCache?: boolean; strictOfflineOnly?: boolean }
): Mt5CacheEntry | null {
  const now = Date.now();
  const allowOfflineCache = options?.allowOfflineCache ?? false;
  const strictOfflineOnly = options?.strictOfflineOnly ?? false;
  const offlineKey = `offline:${OCR_PIPELINE_VERSION}:${hash}`;
  const candidateKeys = strictOfflineOnly
    ? [offlineKey]
    : allowOfflineCache
    ? [`ai:${hash}`, offlineKey]
    : [`ai:${hash}`, hash];

  const disk = readMt5SessionCache();
  for (const key of candidateKeys) {
    const mem = mt5MemoryScanCache.get(key);
    if (mem && now - mem.cachedAt < MT5_SCAN_CACHE_TTL_MS) {
      return mem;
    }
    const entry = disk[key];
    if (entry && now - (entry.cachedAt || 0) < MT5_SCAN_CACHE_TTL_MS) {
      mt5MemoryScanCache.set(key, entry);
      return entry;
    }
  }
  return null;
}

function setCachedMt5ScanResult(
  hash: string,
  tier: 'ai' | 'offline',
  entry: Mt5CacheEntry
): void {
  const key = tier === 'offline' ? `offline:${OCR_PIPELINE_VERSION}:${hash}` : `ai:${hash}`;
  mt5MemoryScanCache.set(key, entry);
  if (mt5MemoryScanCache.size > MT5_SCAN_CACHE_MAX_ENTRIES) {
    const oldestKey = mt5MemoryScanCache.keys().next().value;
    if (oldestKey) mt5MemoryScanCache.delete(oldestKey);
  }
  const disk = readMt5SessionCache();
  disk[key] = entry;
  writeMt5SessionCache(disk);
}

export function clearMt5HistoryScanCache(): void {
  mt5MemoryScanCache.clear();
  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      window.sessionStorage.removeItem(MT5_SCAN_CACHE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Prepares a crisp, text-sharp image Data URL optimized specifically for MT5 ledger/digit OCR.
 * Prefers WebP at high quality (0.92) to eliminate JPEG ringing around thin red '-' minus signs and '.' vs ',' decimals.
 */
export const prepareCrispMt5Screenshot = (
  file: File | Blob,
  maxWidth = 1600,
  maxHeight = 4800,
  quality = 0.92
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.onload = (event) => {
      const originalDataUrl = String(event.target?.result || '');
      if (!originalDataUrl) {
        reject(new Error('Data gambar kosong'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width / maxWidth > height / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          let outUrl = canvas.toDataURL('image/webp', quality);
          if (!outUrl.startsWith('data:image/webp')) {
            outUrl = canvas.toDataURL('image/jpeg', quality);
          }
          canvas.width = 0;
          canvas.height = 0;
          resolve(outUrl);
        } else {
          resolve(originalDataUrl);
        }
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });
};



export function parseSignedMt5Number(
  raw: unknown,
  isPrice = false,
  instrument = 'XAUUSD'
): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    if (isPrice) {
      return normalizeChartPriceNumber(raw, instrument);
    }
    return raw;
  }

  let s = String(raw).trim();
  if (!s) return null;
  // Normalize Unicode minus/dashes to ASCII '-'
  s = s.replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-');

  const isParenNeg = /^\(.*\)$/.test(s) && !s.startsWith('(-');
  s = s.replace(/[^0-9.,+\- ]/g, '').trim();
  if (!s) return null;
  s = s.replace(/^([+-])\s+(?=\d)/, '$1');

  if (isPrice) {
    const clean = normalizeChartPriceNumber(s, instrument);
    return clean;
  }

  if (/^[+-]?\d{1,3}(?:[.\s]\d{3})+,\d+$/.test(s)) {
    s = s.replace(/[.\s]/g, '').replace(',', '.');
  } else if (/^[+-]?\d{1,3}(?:[ ,\s]\d{3})+\.\d+$/.test(s)) {
    s = s.replace(/[ ,\s]/g, '');
  } else if (s.includes('.') && s.includes(',')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    s = lastComma > lastDot ? s.replace(/[.\s]/g, '').replace(',', '.') : s.replace(/[,\s]/g, '');
  } else if (s.includes(',') && !s.includes('.')) {
    s = s.replace(/\s+/g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length >= 2) {
    const lastDot = s.lastIndexOf('.');
    s = s.slice(0, lastDot).replace(/[.\s]/g, '') + '.' + s.slice(lastDot + 1).replace(/\s+/g, '');
  } else {
    s = s.replace(/\s+/g, '');
  }

  let parsed = parseFloat(s);
  if (!Number.isFinite(parsed)) return null;
  if (isParenNeg && parsed > 0) parsed = -parsed;
  return parsed;
}

export function detectTradingSessionFromDateTime(dateTimeLocal: string): TradingSession {
  const m = String(dateTimeLocal || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return 'London';
  const hour = parseInt(m[1], 10);
  if (!Number.isFinite(hour)) return 'London';
  // WIB-aligned trading session defaults (user remains free to override per trade)
  if (hour >= 6 && hour <= 13) return 'Asian';
  if (hour >= 14 && hour <= 18) return 'London';
  if (hour >= 19 && hour <= 22) return 'Overlap';
  return 'New York';
}

export function normalizeMt5PrecisionTimestamp(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const ymdMatch = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (ymdMatch && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const yyyy = ymdMatch[1];
    const mm = ymdMatch[2].padStart(2, '0');
    const dd = ymdMatch[3].padStart(2, '0');
    const hh = ymdMatch[4].padStart(2, '0');
    const min = ymdMatch[5].padStart(2, '0');
    const sec = ymdMatch[6] ? `:${ymdMatch[6].padStart(2, '0')}` : '';
    return `${yyyy}-${mm}-${dd}T${hh}:${min}${sec}`;
  }
  const euMatch = s.match(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (euMatch) {
    const dd = euMatch[1].padStart(2, '0');
    const mm = euMatch[2].padStart(2, '0');
    const yyyy = euMatch[3];
    const hh = euMatch[4].padStart(2, '0');
    const min = euMatch[5].padStart(2, '0');
    const sec = euMatch[6] ? `:${euMatch[6].padStart(2, '0')}` : '';
    return `${yyyy}-${mm}-${dd}T${hh}:${min}${sec}`;
  }
  return normalizeTradeDateTimeLocal(s);
}

type TimestampMatchLevel = 'EXACT_SECOND' | 'EXACT_MINUTE' | 'DIFFER' | 'UNCERTAIN';

function compareMt5Timestamps(tsA?: string | null, tsB?: string | null): TimestampMatchLevel {
  const normA = tsA ? normalizeMt5PrecisionTimestamp(tsA) : null;
  const normB = tsB ? normalizeMt5PrecisionTimestamp(tsB) : null;
  if (!normA || !normB || normA.length < 16 || normB.length < 16) {
    const dayA = normA ? normA.slice(0, 10) : '';
    const dayB = normB ? normB.slice(0, 10) : '';
    if (dayA && dayB && dayA !== dayB) return 'DIFFER';
    return 'UNCERTAIN';
  }

  const minA = normA.slice(0, 16);
  const minB = normB.slice(0, 16);
  if (minA !== minB) return 'DIFFER';

  const hasSecA = normA.length >= 19;
  const hasSecB = normB.length >= 19;
  if (hasSecA && hasSecB) {
    return normA.slice(0, 19) === normB.slice(0, 19) ? 'EXACT_SECOND' : 'DIFFER';
  }
  return hasSecA !== hasSecB ? 'UNCERTAIN' : 'EXACT_MINUTE';
}

function getMt5PriceTolerance(instrument: string): number {
  const candInst = normalizeScanInstrument(instrument);
  if (candInst === 'BTCUSD' || candInst === 'US30' || candInst === 'NAS100') return 0.5;
  if (candInst === 'XAUUSD') return 0.15;
  if (candInst.includes('JPY') || candInst === 'XAGUSD') return 0.01;
  return 0.00015;
}

function areMt5SpecsSimilar(
  a: {
    instrument: string;
    position: TradePosition;
    lotSize: number;
    entryPrice: number;
    exitPrice?: number | null;
    netProfit: number;
    closeDateTime?: string | null;
  },
  b: {
    instrument: string;
    position: TradePosition;
    lotSize: number;
    entryPrice: number;
    exitPrice?: number | null;
    netProfit: number;
    closeDateTime?: string | null;
  }
): boolean {
  const instA = normalizeScanInstrument(a.instrument);
  const instB = normalizeScanInstrument(b.instrument);
  if (instA !== instB || a.position !== b.position) return false;

  const priceTolerance = getMt5PriceTolerance(instA);
  const sameLot = Math.abs((a.lotSize || 0) - (b.lotSize || 0)) < 0.005;
  const sameNet = Math.abs((a.netProfit || 0) - (b.netProfit || 0)) < 0.05;
  const sameEntry = Math.abs((a.entryPrice || 0) - (b.entryPrice || 0)) <= priceTolerance;
  const sameExit =
    b.exitPrice !== undefined &&
    b.exitPrice !== null &&
    a.exitPrice !== undefined &&
    a.exitPrice !== null &&
    Math.abs(a.exitPrice - b.exitPrice) <= priceTolerance;

  if (!(sameLot && sameNet && sameEntry && sameExit)) return false;

  const dayA = (a.closeDateTime || '').slice(0, 10);
  const dayB = (b.closeDateTime || '').slice(0, 10);
  return !dayA || !dayB || dayA === dayB;
}

export function detectDuplicateMt5Trade(
  candidate: {
    ticketId: string | null;
    instrument: string;
    position: TradePosition;
    lotSize: number;
    entryPrice: number;
    exitPrice: number;
    netProfit: number;
    openDateTime?: string | null;
    closeDateTime: string;
    exactOpenDateTime?: string | null;
    exactCloseDateTime?: string | null;
  },
  existingTrades: Trade[]
): string | null {
  if (!Array.isArray(existingTrades) || existingTrades.length === 0) return null;

  const candTicket = candidate.ticketId ? candidate.ticketId.trim() : '';
  const candCloseTs = candidate.exactCloseDateTime || candidate.closeDateTime;
  const candOpenTs = candidate.exactOpenDateTime || candidate.openDateTime || null;

  for (const t of existingTrades) {
    if (candTicket) {
      if (
        t.id === `MT5-${candTicket}` ||
        (t.notes && t.notes.includes(`#${candTicket}`)) ||
        (t.executionNotes && t.executionNotes.includes(`#${candTicket}`))
      ) {
        return t.id;
      }
    }

    if (
      !areMt5SpecsSimilar(candidate, {
        instrument: t.instrument,
        position: t.position,
        lotSize: t.lotSize,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        netProfit: t.netProfit,
        closeDateTime: t.dateTime,
      })
    ) {
      continue;
    }

    const lifecycle = resolveTradeLifecycle(t);
    const tCloseTs = lifecycle.exitTime || t.dateTime;
    const closeCmp = compareMt5Timestamps(candCloseTs, tCloseTs);
    if (closeCmp === 'DIFFER') continue;

    if (candOpenTs && lifecycle.entryTime) {
      const openCmp = compareMt5Timestamps(candOpenTs, lifecycle.entryTime);
      if (openCmp === 'DIFFER') continue;
    }

    return t.id;
  }

  return null;
}

export function recheckDuplicateMt5Candidate(
  candidate: Mt5HistoryTradeCandidate,
  existingTrades: Trade[]
): Mt5HistoryTradeCandidate {
  const dupId = detectDuplicateMt5Trade(
    {
      ticketId: candidate.ticketId,
      instrument: candidate.instrument,
      position: candidate.position,
      lotSize: candidate.lotSize,
      entryPrice: candidate.entryPrice,
      exitPrice: candidate.exitPrice,
      netProfit: candidate.netProfit,
      openDateTime: candidate.openDateTime,
      closeDateTime: candidate.closeDateTime,
      exactOpenDateTime: candidate.exactOpenDateTime,
      exactCloseDateTime: candidate.exactCloseDateTime,
    },
    existingTrades
  );
  return {
    ...candidate,
    isDuplicate: Boolean(dupId),
    duplicateReason: dupId ? (candidate.ticketId ? 'EXACT_TICKET' : 'SIMILAR_JOURNAL_MATCH') : null,
    duplicateMatchId: dupId || undefined,
  };
}

/**
 * Deterministic Mathematical Consistency Auditor for MT5/MT4 History Candidates.
 * Uses TradeVault instrument specs (`getInstrumentPipSpec`) and directional SL/TP validation
 * (`validateSlTpDirection`) to flag dropped minus signs, flipped BUY/SELL, cut digits, or lot shifts.
 */
export function auditMt5HistoryCandidate(
  candidate: {
    instrument: string;
    position: TradePosition;
    lotSize: number;
    entryPrice: number;
    exitPrice: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    commission?: number;
    swap?: number;
    netProfit: number;
    closeType?: TradeCloseType;
    ocrSignRecovered?: boolean;
  },
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): Mt5CandidateAuditResult {
  const issues: Mt5AuditIssue[] = [];
  const cleanInst = normalizeScanInstrument(candidate.instrument);
  const spec = getInstrumentPipSpec(cleanInst, settings);
  const lot = Number(candidate.lotSize || 0);
  const entry = Number(candidate.entryPrice || 0);
  const exit = Number(candidate.exitPrice || 0);
  const netProfit = Number(candidate.netProfit || 0);
  const comm = Math.abs(Number(candidate.commission || 0));
  const swap = Number(candidate.swap || 0);
  const reportedGross = computeGrossFromNet(netProfit, comm, swap);

  let estimatedStandardGross: number | null = null;

  if (candidate.ocrSignRecovered) {
    issues.push({
      code: 'AUTO_SIGN_FIXED',
      severity: 'info',
      messageId: 'Tanda minus (-) profit otomatis dipulihkan dari arah Entry→Exit (cek kesesuaian).',
      messageEn: 'Negative (-) sign was auto-recovered from Entry→Exit direction (please verify).',
    });
  }

  if (entry > 0 && exit > 0) {
    const priceDiff = candidate.position === 'BUY' ? exit - entry : entry - exit;
    const absDiff = Math.abs(exit - entry);

    // 1. Extreme Jump Check (catches missing/extra leading digit like 2650 -> 265 or 1.085 -> 10.85)
    const maxPlausibleMovePct =
      cleanInst === 'BTCUSD' || cleanInst === 'ETHUSD' || cleanInst === 'SOLUSD'
        ? 0.45
        : cleanInst === 'XAUUSD' || cleanInst === 'XAGUSD' || cleanInst === 'US30' || cleanInst === 'NAS100'
        ? 0.22
        : 0.14;
    if (absDiff / Math.max(entry, exit) > maxPlausibleMovePct) {
      issues.push({
        code: 'PRICE_JUMP_EXTREME',
        severity: 'error',
        messageId: `Selisih Entry (${entry}) dan Exit (${exit}) terlalu ekstrem — cek apakah ada digit harga yang terpotong/lebih.`,
        messageEn: `Gap between Entry (${entry}) and Exit (${exit}) is extreme — check for missing or extra digits.`,
      });
    }

    // 2. Directional Sign Audit: Price move direction vs Gross Profit sign
    const minDirectionalMove =
      cleanInst === 'XAUUSD'
        ? 0.05
        : cleanInst === 'BTCUSD' || cleanInst === 'US30' || cleanInst === 'NAS100'
        ? 1.0
        : cleanInst.includes('JPY') || cleanInst === 'XAGUSD'
        ? 0.005
        : 0.00005;

    if (Math.abs(priceDiff) >= minDirectionalMove) {
      if (priceDiff < 0 && reportedGross > 0.35) {
        issues.push({
          code: 'SIGN_MISMATCH',
          severity: 'error',
          messageId: `${candidate.position} dari ${entry} → ${exit} seharusnya rugi, tapi Profit terbaca positif (+${netProfit.toFixed(2)}). Tanda minus (-) mungkin terlewat.`,
          messageEn: `${candidate.position} from ${entry} → ${exit} moved against trade, yet Profit is positive (+${netProfit.toFixed(2)}). Check missing minus sign.`,
          suggestedNetProfit: Number((-Math.abs(netProfit)).toFixed(2)),
          suggestedPosition: candidate.position === 'BUY' ? 'SELL' : 'BUY',
          canSwapEntryExit: true,
        });
      } else if (priceDiff > 0 && reportedGross < -0.35) {
        issues.push({
          code: 'SIGN_MISMATCH',
          severity: 'error',
          messageId: `${candidate.position} dari ${entry} → ${exit} seharusnya untung, tapi Profit terbaca negatif (${netProfit.toFixed(2)}). Cek arah atau tanda (+/-).`,
          messageEn: `${candidate.position} from ${entry} → ${exit} moved in profit, yet Profit is negative (${netProfit.toFixed(2)}). Check direction or (+/-) sign.`,
          suggestedNetProfit: Number(Math.abs(netProfit).toFixed(2)),
          suggestedPosition: candidate.position === 'BUY' ? 'SELL' : 'BUY',
          canSwapEntryExit: true,
        });
      }
    }

    // 3. Broker-Safe Magnitude Audit (catches 10x lot or decimal shifts)
    if (lot > 0 && Math.abs(priceDiff) >= minDirectionalMove && Math.abs(reportedGross) >= 2.0) {
      let contractCandidates: number[] = [];
      if (cleanInst === 'XAUUSD') {
        contractCandidates = [100, 10, 1];
        estimatedStandardGross = Number((priceDiff * lot * 100).toFixed(2));
      } else if (cleanInst === 'XAGUSD') {
        contractCandidates = [5000, 1000, 100];
        estimatedStandardGross = Number((priceDiff * lot * 5000).toFixed(2));
      } else if (['BTCUSD', 'ETHUSD', 'SOLUSD'].includes(cleanInst)) {
        contractCandidates = [1, 10, 0.1];
        estimatedStandardGross = Number((priceDiff * lot * 1).toFixed(2));
      } else if (['US30', 'NAS100', 'SPX500', 'GER40'].includes(cleanInst)) {
        contractCandidates = [1, 10, 20, 100];
        estimatedStandardGross = Number((priceDiff * lot * 1).toFixed(2));
      } else if (cleanInst.endsWith('USD')) {
        contractCandidates = [100000, 10000, 1000];
        estimatedStandardGross = Number((priceDiff * lot * 100000).toFixed(2));
      } else if (cleanInst.includes('JPY')) {
        // Approximate JPY quote USD conversion (~110..170) -> unit per 1.00 lot per 1.0 price ~ 600..900 USD
        contractCandidates = [650, 800, 1000, 65];
        estimatedStandardGross = Number((priceDiff * lot * 670).toFixed(2));
      } else {
        contractCandidates = [100000, 80000, 130000, 10000];
        estimatedStandardGross = Number(((priceDiff / spec.pipSize) * lot * spec.pipValuePerStandardLot).toFixed(2));
      }

      const absReported = Math.abs(reportedGross);
      let minRelativeError = Infinity;
      let closestExpectedAbs: number | null = null;
      let closestSignedExpected: number | null = null;
      for (const cs of contractCandidates) {
        const expectedSigned = priceDiff * lot * cs;
        const expectedAbs = Math.abs(expectedSigned);
        if (expectedAbs <= 0.01) continue;
        const ratio = absReported / expectedAbs;
        const relErr = ratio >= 1 ? ratio : 1 / ratio;
        if (relErr < minRelativeError) {
          minRelativeError = relErr;
          closestExpectedAbs = Number(expectedAbs.toFixed(2));
          closestSignedExpected = Number(expectedSigned.toFixed(2));
        }
      }

      const isExactContractSpecInstrument =
        cleanInst === 'XAUUSD' ||
        cleanInst === 'XAGUSD' ||
        (cleanInst.endsWith('USD') && !['BTCUSD', 'ETHUSD', 'SOLUSD'].includes(cleanInst));
      const relThreshold = isExactContractSpecInstrument ? 1.65 : 2.5;
      const minAbsDelta = isExactContractSpecInstrument ? 2.0 : 3.0;

      if (
        Number.isFinite(minRelativeError) &&
        closestExpectedAbs !== null &&
        closestSignedExpected !== null &&
        minRelativeError >= relThreshold &&
        Math.abs(absReported - closestExpectedAbs) >= minAbsDelta
      ) {
        issues.push({
          code: 'MAGNITUDE_MISMATCH',
          severity: 'warning',
          messageId: `Estimasi hasil (${lot.toFixed(2)} lot · ${entry}→${exit}): ~${closestSignedExpected >= 0 ? '+' : ''}${closestSignedExpected.toFixed(2)}, sedangkan terbaca ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} — cek digit Profit/Lot.`,
          messageEn: `Estimated P/L (${lot.toFixed(2)} lot · ${entry}→${exit}): ~${closestSignedExpected >= 0 ? '+' : ''}${closestSignedExpected.toFixed(2)}, scanned ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} — verify Profit/Lot digits.`,
        });
      }
    }

    // 4. SL / TP Directional Check
    const slTpCheck = validateSlTpDirection(
      candidate.position,
      entry,
      candidate.stopLoss,
      candidate.takeProfit
    );
    if (!slTpCheck.isValid && slTpCheck.errorMessage) {
      issues.push({
        code: 'SL_TP_INVALID',
        severity: 'warning',
        messageId: slTpCheck.errorMessage,
        messageEn: `Invalid SL/TP side for ${candidate.position} relative to Entry ${entry}.`,
      });
    }
  }

  // 5. Close Type vs Profit Conflict
  if (candidate.closeType === 'TP' && reportedGross < -0.5) {
    issues.push({
      code: 'CLOSE_TYPE_PROFIT_CONFLICT',
      severity: 'warning',
      messageId: 'Tipe penutupan tercatat TP namun Gross Profit negatif — periksa apakah seharusnya SL atau Manual.',
      messageEn: 'Close type is TP but Gross Profit is negative — verify if SL or Manual.',
    });
  }

  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarning = issues.some((i) => i.severity === 'warning');
  return {
    status: hasError ? 'ERROR' : hasWarning ? 'WARNING' : 'OK',
    issues,
    estimatedStandardGross,
  };
}

function mapRawRowToCandidate(
  row: RawNormalizedMt5Row,
  idx: number,
  options: {
    existingTrades: Trade[];
    sourceImageIndex: number;
    defaultStrategy: string;
    fallbackNow: string;
  }
): Mt5HistoryTradeCandidate {
  const exactCloseDateTime =
    (row.closeDateTime && row.closeDateTime.trim()
      ? normalizeMt5PrecisionTimestamp(row.closeDateTime)
      : row.openDateTime && row.openDateTime.trim()
      ? normalizeMt5PrecisionTimestamp(row.openDateTime)
      : options.fallbackNow) || options.fallbackNow;
  const exactOpenDateTime =
    row.openDateTime && row.openDateTime.trim()
      ? normalizeMt5PrecisionTimestamp(row.openDateTime)
      : null;

  const closeDateTime = normalizeTradeDateTimeLocal(exactCloseDateTime);
  const openDateTime = exactOpenDateTime ? normalizeTradeDateTimeLocal(exactOpenDateTime) : null;

  const dupId = detectDuplicateMt5Trade(
    {
      ticketId: row.ticketId,
      instrument: row.instrument,
      position: row.position,
      lotSize: row.lotSize,
      entryPrice: row.entryPrice,
      exitPrice: row.exitPrice,
      netProfit: row.netProfit,
      openDateTime,
      closeDateTime,
      exactOpenDateTime,
      exactCloseDateTime,
    },
    options.existingTrades
  );

  return {
    tempId: `mt5_${Date.now()}_${options.sourceImageIndex}_${idx}_${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    ticketId: row.ticketId,
    instrument: row.instrument,
    position: row.position,
    lotSize: row.lotSize,
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    commission: row.commission,
    swap: row.swap,
    netProfit: row.netProfit,
    openDateTime,
    closeDateTime,
    exactOpenDateTime,
    exactCloseDateTime,
    closeType: row.closeType,
    notes: row.notes,
    strategy: options.defaultStrategy,
    session: detectTradingSessionFromDateTime(openDateTime || closeDateTime),
    isDuplicate: Boolean(dupId),
    duplicateReason: dupId ? (row.ticketId ? 'EXACT_TICKET' : 'SIMILAR_JOURNAL_MATCH') : null,
    duplicateMatchId: dupId || undefined,
    isDoubleEntry: false,
    selected: !dupId,
    sourceImageIndex: options.sourceImageIndex,
    ocrSignRecovered: row.ocrSignRecovered,
  };
}

function normalizeBackendMt5Row(rawRow: any): RawNormalizedMt5Row {
  const instrument = normalizeScanInstrument(rawRow.instrument);
  const rawPosStr = String(rawRow.position || '').trim().toUpperCase();
  const position: TradePosition =
    rawPosStr.includes('SELL') || rawPosStr.includes('JUAL') || rawPosStr.includes('SHORT')
      ? 'SELL'
      : 'BUY';
  const lotParsed = parseSignedMt5Number(rawRow.lotSize, false, 'EURUSD');
  const lotSize = lotParsed !== null && lotParsed > 0 ? Number(lotParsed.toFixed(2)) : 0.01;
  const entryParsed = parseSignedMt5Number(rawRow.entryPrice, true, instrument);
  const exitParsed = parseSignedMt5Number(rawRow.exitPrice, true, instrument);
  const entryPrice = entryParsed !== null && entryParsed > 0 ? entryParsed : exitParsed || 0;
  const exitPrice = exitParsed !== null && exitParsed > 0 ? exitParsed : entryPrice;
  const slParsed = parseSignedMt5Number(rawRow.stopLoss, true, instrument);
  const tpParsed = parseSignedMt5Number(rawRow.takeProfit, true, instrument);
  const stopLoss = slParsed !== null && slParsed > 0 ? slParsed : null;
  const takeProfit = tpParsed !== null && tpParsed > 0 ? tpParsed : null;
  const commParsed = parseSignedMt5Number(rawRow.commission, false, 'EURUSD');
  const swapParsed = parseSignedMt5Number(rawRow.swap, false, 'EURUSD');
  const profitParsed = parseSignedMt5Number(rawRow.netProfit, false, 'EURUSD');
  const commission = commParsed !== null ? Number(Math.abs(commParsed).toFixed(2)) : 0;
  const swap = swapParsed !== null ? Number(swapParsed.toFixed(2)) : 0;
  const netProfit = profitParsed !== null ? Number(profitParsed.toFixed(2)) : 0;
  const rawCloseType = String(rawRow.closeType || '').toUpperCase();
  const closeType: TradeCloseType =
    rawCloseType === 'TP' ? 'TP' : rawCloseType === 'SL' ? 'SL' : 'Manual';
  const rawTicketStr =
    rawRow.ticketId !== null && rawRow.ticketId !== undefined
      ? String(rawRow.ticketId).replace(/^#/, '').trim()
      : '';
  const ticketId =
    rawTicketStr && !/^(null|undefined|none|n\/a|-)$/i.test(rawTicketStr) ? rawTicketStr : null;

  return {
    ticketId,
    instrument,
    position,
    lotSize,
    entryPrice,
    exitPrice,
    stopLoss,
    takeProfit,
    commission,
    swap,
    netProfit,
    openDateTime:
      typeof rawRow.openDateTime === 'string' && rawRow.openDateTime.trim()
        ? rawRow.openDateTime.trim()
        : null,
    closeDateTime:
      typeof rawRow.closeDateTime === 'string' && rawRow.closeDateTime.trim()
        ? rawRow.closeDateTime.trim()
        : null,
    closeType,
    notes: typeof rawRow.notes === 'string' ? rawRow.notes.trim() : '',
  };
}

type ParsedOcrMt5Row = ReturnType<typeof parseMt5HistoryRowsFromOcrText>[number];

function scoreMt5OcrParsedRows(rows: ParsedOcrMt5Row[]): number {
  return rows.reduce((sum, r) => {
    let s = 100;
    if (r.entryPrice > 0 && r.exitPrice > 0 && Math.abs(r.entryPrice - r.exitPrice) > 1e-6) {
      s += 32;
    }
    if (r.stopLoss !== null && r.stopLoss > 0) s += 30;
    if (r.takeProfit !== null && r.takeProfit > 0) s += 16;
    if (r.netProfit !== 0) s += 25;
    if (r.closeDateTime) s += 8;
    if (r.openDateTime) s += 5;
    if (r.ticketId) s += 5;
    return sum + s;
  }, 0);
}

function mergeComplementaryMt5OcrRows(
  primary: ParsedOcrMt5Row[],
  secondary: ParsedOcrMt5Row[]
): ParsedOcrMt5Row[] {
  if (primary.length === 0 || primary.length !== secondary.length) return primary;
  return primary.map((row, idx) => {
    const alt = secondary[idx];
    if (!alt) return row;
    if (row.instrument !== alt.instrument || row.position !== alt.position) return row;
    return {
      ...row,
      stopLoss: row.stopLoss ?? alt.stopLoss,
      takeProfit: row.takeProfit ?? alt.takeProfit,
      openDateTime: row.openDateTime ?? alt.openDateTime,
      closeDateTime: row.closeDateTime ?? alt.closeDateTime,
      ticketId: row.ticketId ?? alt.ticketId,
      commission: row.commission > 0 ? row.commission : alt.commission,
      swap: row.swap !== 0 ? row.swap : alt.swap,
      netProfit: row.netProfit !== 0 ? row.netProfit : alt.netProfit,
      closeType:
        row.closeType !== 'Manual'
          ? row.closeType
          : alt.closeType !== 'Manual'
          ? alt.closeType
          : 'Manual',
    };
  });
}

function countActionableSlTpLabels(ocrText: string): { slLabels: number; tpLabels: number } {
  if (!ocrText) return { slLabels: 0, tpLabels: 0 };
  let slLabels = 0;
  let tpLabels = 0;
  const lines = ocrText.split(/\r?\n/);
  const slRe =
    /(?:^|[\s|])(?:S\s*[\/|\\!l1I.]\s*[L1]\s*[:=]?|5\s*[\/|\\!lI]\s*L\s*[:=]?|(?:SL|S\s+L)\s*[:=]|Stop\s*Loss\s*[:=]?)\s*([^\n]*)/gi;
  const tpRe =
    /(?:^|[\s|])(?:[T7]\s*[\/|\\!l1I.]\s*P\s*[:=]?|(?:TP|T\s+P)\s*[:=]|Take\s*Profit\s*[:=]?)\s*([^\n]*)/gi;
  const actionablePositivePriceRe = /^(?:[1-9]\d*(?:[.,]\d+)?|0[.,]\d*[1-9]\d*)\b/;

  for (const line of lines) {
    for (const m of line.matchAll(slRe)) {
      const tail = (m[1] || '').trim();
      if (actionablePositivePriceRe.test(tail)) slLabels++;
    }
    for (const m of line.matchAll(tpRe)) {
      const tail = (m[1] || '').trim();
      if (actionablePositivePriceRe.test(tail)) tpLabels++;
    }
  }
  return { slLabels, tpLabels };
}

function isOcrPassCompleteEnough(
  rows: ParsedOcrMt5Row[],
  ocrText: string,
  confidence: number
): boolean {
  if (rows.length === 0 || confidence < 28) return false;
  const allHaveDistinctPrices = rows.every(
    (r) =>
      r.entryPrice > 0 &&
      r.exitPrice > 0 &&
      Math.abs(r.entryPrice - r.exitPrice) > 1e-6
  );
  if (!allHaveDistinctPrices) return false;

  // Ensure Profit/Loss was also read for rows that moved away from entry price
  const allHaveProfitOrFlat = rows.every(
    (r) => Math.abs(r.netProfit) >= 0.01 || Math.abs(r.exitPrice - r.entryPrice) <= 1e-6
  );
  if (!allHaveProfitOrFlat) return false;

  const { slLabels, tpLabels } = countActionableSlTpLabels(ocrText);
  const extractedSl = rows.filter((r) => r.stopLoss !== null && r.stopLoss > 0).length;
  const extractedTp = rows.filter((r) => r.takeProfit !== null && r.takeProfit > 0).length;

  return extractedSl >= slLabels && extractedTp >= tpLabels;
}

interface Mt5OcrFallbackExecutionResult {
  rows: RawNormalizedMt5Row[];
  passes: OcrPassDiagnostic[];
  inputDimensions: { width: number; height: number } | null;
  finalRawText: string;
  finalConfidence: number;
  finalWordBoxCount: number;
  invokedFallbackPass: boolean;
  durationMs: number;
  error?: string;
}

async function runMt5HistoryOcrFallback(
  imageDataUrl: string
): Promise<Mt5OcrFallbackExecutionResult> {
  const totalStart = Date.now();
  if (!imageDataUrl.startsWith('data:image/')) {
    return {
      rows: [],
      passes: [],
      inputDimensions: null,
      finalRawText: '',
      finalConfidence: 0,
      finalWordBoxCount: 0,
      invokedFallbackPass: false,
      durationMs: Date.now() - totalStart,
      error: 'Input is not a valid image Data URL.',
    };
  }

  // Render ONLY primary chromatic variant up front; generate soft_luma lazily only if needed
  const primaryVariant = await preparePrecisionOcrVariantWithTelemetry(
    imageDataUrl,
    'chromatic_sharp'
  );
  const inputDimensions = primaryVariant.telemetry
    ? {
        width: primaryVariant.telemetry.sourceWidth,
        height: primaryVariant.telemetry.sourceHeight,
      }
    : null;

  let bestRows: ParsedOcrMt5Row[] = [];
  let bestScore = -1;
  let bestRawText = '';
  let bestConfidence = 0;
  let bestWordBoxCount = 0;
  const allEqualCountCandidates: ParsedOcrMt5Row[][] = [];
  const passDiagnostics: OcrPassDiagnostic[] = [];
  let isComplete = false;
  let lastError: string | undefined;

  const runPass = async (
    passIndex: number,
    variantMode: PrecisionOcrVariantMode,
    img: string,
    preprocess: OcrPassDiagnostic['preprocess'],
    psm: '3' | '6'
  ) => {
    try {
      const ocr = await runOfflineTesseractOcr(img, { psm });
      const parsed = parseMt5HistoryRowsFromOcrText(ocr.fullText, {
        lines: ocr.lines,
        words: ocr.words,
      });
      const score = scoreMt5OcrParsedRows(parsed);
      passDiagnostics.push({
        passIndex,
        variantMode,
        psm,
        preprocess,
        workerInitMs: ocr.telemetry?.workerInitMs ?? 0,
        workerReused: ocr.telemetry?.workerReused ?? false,
        recognizeMs: ocr.telemetry?.recognizeMs ?? 0,
        confidence: Number.isFinite(ocr.confidence) ? Number(ocr.confidence.toFixed(1)) : 0,
        wordBoxCount: ocr.words.length,
        lineCount: ocr.lines.length,
        parsedRowsCount: parsed.length,
        score,
        rawText: ocr.fullText.slice(0, 4000),
        sampleBoxes: ocr.words.slice(0, 24).map((w) => ({
          text: w.text,
          left: Math.round(w.left),
          top: Math.round(w.top),
          width: Math.round(w.width),
          height: Math.round(w.height),
        })),
      });
      if (parsed.length > 0) {
        allEqualCountCandidates.push(parsed);
      }
      if (score > bestScore || (bestScore < 0 && !bestRawText)) {
        bestScore = score;
        bestRows = parsed;
        bestRawText = ocr.fullText;
        bestConfidence = ocr.confidence;
        bestWordBoxCount = ocr.words.length;
      }
      // Strict completeness gate: only skip Pass 2 when every row has distinct Entry/Exit,
      // non-zero Profit/Loss (for moved trades), all visible S/L & T/P labels, and confidence >= 28.
      if (isOcrPassCompleteEnough(bestRows, ocr.fullText, ocr.confidence)) {
        isComplete = true;
      }
    } catch (err: any) {
      const errMsg = err?.message ? String(err.message) : 'Offline OCR pass failed';
      lastError = errMsg;
      passDiagnostics.push({
        passIndex,
        variantMode,
        psm,
        preprocess,
        workerInitMs: 0,
        workerReused: false,
        recognizeMs: 0,
        confidence: 0,
        wordBoxCount: 0,
        lineCount: 0,
        parsedRowsCount: 0,
        score: -1,
        rawText: '',
        sampleBoxes: [],
        error: errMsg,
      });
    }
  };

  // Pass 1 (Fastest & avoids column-splitting): SINGLE_BLOCK on chromatic_sharp
  await runPass(1, 'chromatic_sharp', primaryVariant.dataUrl, primaryVariant.telemetry, '6');

  // Pass 2 (Run whenever Pass 1 was incomplete — missing profit, S/L, T/P, low confidence, or 0 rows):
  // AUTO layout segmentation on chromatic_sharp, then merged with Pass 1 via mergeComplementaryMt5OcrRows
  if (!isComplete) {
    await runPass(2, 'chromatic_sharp', primaryVariant.dataUrl, primaryVariant.telemetry, '3');
  }

  // Pass 3 (Lazy soft_luma fallback ONLY when both primary passes found 0 rows)
  if (!isComplete && bestRows.length === 0) {
    const softVariant = await preparePrecisionOcrVariantWithTelemetry(imageDataUrl, 'soft_luma');
    if (softVariant.dataUrl !== primaryVariant.dataUrl) {
      await runPass(3, 'soft_luma', softVariant.dataUrl, softVariant.telemetry, '6');
    }
  }

  for (const cand of allEqualCountCandidates) {
    bestRows = mergeComplementaryMt5OcrRows(bestRows, cand);
  }

  const normalizedRows: RawNormalizedMt5Row[] = bestRows.map((r) => ({
    ticketId: r.ticketId,
    instrument: r.instrument,
    position: r.position,
    lotSize: r.lotSize,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    stopLoss: r.stopLoss,
    takeProfit: r.takeProfit,
    commission: r.commission,
    swap: r.swap,
    netProfit: r.netProfit,
    openDateTime: r.openDateTime,
    closeDateTime: r.closeDateTime,
    closeType: r.closeType,
    notes: r.notes,
    ocrSignRecovered: r.ocrSignRecovered,
  }));

  return {
    rows: normalizedRows,
    passes: passDiagnostics,
    inputDimensions,
    finalRawText: bestRawText.slice(0, 5000),
    finalConfidence: Number.isFinite(bestConfidence) ? Number(bestConfidence.toFixed(1)) : 0,
    finalWordBoxCount: bestWordBoxCount,
    invokedFallbackPass: passDiagnostics.length > 1,
    durationMs: Date.now() - totalStart,
    error: normalizedRows.length === 0 ? lastError : undefined,
  };
}

function buildMt5OcrDiagnosticRecord(params: {
  requestedMode: 'auto' | 'offline';
  resolvedEngine: 'gemini' | 'offline-ocr' | 'cache' | 'error';
  invokedFallback: boolean;
  fallbackReason?: string;
  imageIndex: number;
  ocrExec?: Mt5OcrFallbackExecutionResult | null;
  mappedCandidates: Mt5HistoryTradeCandidate[];
  totalDurationMs?: number;
  error?: string;
}): Mt5OcrScanDiagnostic {
  const validationFailures: string[] = [];
  for (const cand of params.mappedCandidates) {
    const audit = auditMt5HistoryCandidate(cand);
    for (const issue of audit.issues) {
      if (issue.severity === 'error' || issue.severity === 'warning') {
        validationFailures.push(
          `[${issue.severity.toUpperCase()}] ${cand.instrument} (${cand.position}): ${issue.code} - ${issue.messageEn}`
        );
      }
    }
  }
  return {
    id: `ocr_diag_${Date.now()}_${params.imageIndex}_${Math.random().toString(36).slice(2, 6)}`,
    timestampIso: new Date().toISOString(),
    build: getAppBuildIdentity(),
    platform: getRuntimePlatformSnapshot(),
    requestedMode: params.requestedMode,
    resolvedEngine: params.resolvedEngine,
    invokedFallback: params.invokedFallback,
    fallbackReason: params.fallbackReason,
    imageIndex: params.imageIndex,
    inputDimensions: params.ocrExec?.inputDimensions ?? null,
    totalDurationMs: params.totalDurationMs ?? params.ocrExec?.durationMs ?? 0,
    passes: params.ocrExec?.passes ?? [],
    finalRawText: params.ocrExec?.finalRawText ?? '',
    finalConfidence: params.ocrExec?.finalConfidence ?? 0,
    finalWordBoxCount: params.ocrExec?.finalWordBoxCount ?? 0,
    parserOutputSummary: params.mappedCandidates.map((c) => ({
      instrument: c.instrument,
      position: c.position,
      lotSize: c.lotSize,
      entryPrice: c.entryPrice,
      exitPrice: c.exitPrice,
      stopLoss: c.stopLoss,
      takeProfit: c.takeProfit,
      netProfit: c.netProfit,
      closeType: c.closeType,
      closeDateTime: c.closeDateTime || null,
      ocrSignRecovered: c.ocrSignRecovered,
    })),
    validationFailures,
    error: params.error || params.ocrExec?.error,
  };
}

export type Mt5ScanExecutionMode = 'auto' | 'offline';

export interface Mt5BatchScreenshotInput {
  imageDataUrl: string;
  sourceImageIndex: number;
}

export interface Mt5BatchPerImageOutcome {
  sourceImageIndex: number;
  status: 'done' | 'error';
  trades: Mt5HistoryTradeCandidate[];
  fromCache: boolean;
  scanEngine: 'gemini' | 'offline-ocr' | 'cache' | 'error';
  modelUsed: string;
  error?: string;
}

/**
 * High-speed Hybrid Batch MT5 History Screenshot Scanner:
 * 1. Resolves instant SHA-256 cache hits (<10ms, 0 quota) unless forceRefresh is set.
 * 2. When `mode === 'offline'` or device has no internet connection, skips network calls and runs
 *    100% local on-device Tesseract LSTM OCR (`public/ocr/`).
 * 3. When online in `'auto'` mode, batches up to 4 screenshots per Gemini request and seamlessly falls
 *    back to On-Device Offline OCR if Gemini is busy, timed out, or quota-exhausted.
 */
export async function scanBatchMt5HistoryScreenshots(
  items: Mt5BatchScreenshotInput[],
  options?: {
    existingTrades?: Trade[];
    defaultStrategy?: string;
    forceRefresh?: boolean;
    mode?: Mt5ScanExecutionMode;
  }
): Promise<{
  trades: Mt5HistoryTradeCandidate[];
  perImageOutcomes: Mt5BatchPerImageOutcome[];
  cacheHitsCount: number;
  modelUsed: string;
  source: string;
}> {
  const existingTrades = options?.existingTrades || [];
  const defaultStrategy = options?.defaultStrategy || 'MT5 History Scan';
  const forceRefresh = Boolean(options?.forceRefresh);
  const requestedMode: Mt5ScanExecutionMode = options?.mode || 'auto';
  const isNavigatorOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const runOfflineOnly = requestedMode === 'offline' || isNavigatorOffline;
  const fallbackNow = normalizeTradeDateTimeLocal(new Date());

  const outcomesMap = new Map<number, Mt5BatchPerImageOutcome>();
  const uncached: Array<{ item: Mt5BatchScreenshotInput; hash: string }> = [];
  let cacheHitsCount = 0;

  for (const item of items) {
    const trimmed = (item.imageDataUrl || '').trim();
    if (!trimmed) {
      outcomesMap.set(item.sourceImageIndex, {
        sourceImageIndex: item.sourceImageIndex,
        status: 'error',
        trades: [],
        fromCache: false,
        scanEngine: 'error',
        modelUsed: 'none',
        error: 'Gambar screenshot MT5 kosong.',
      });
      continue;
    }

    const hash = await computeImageContentHash(trimmed);
    const cached = !forceRefresh
      ? getCachedMt5ScanResult(hash, {
          allowOfflineCache: runOfflineOnly,
          strictOfflineOnly: requestedMode === 'offline',
        })
      : null;
    if (cached) {
      cacheHitsCount++;
      const mapped = cached.rows.map((r, idx) =>
        mapRawRowToCandidate(r, idx, {
          existingTrades,
          sourceImageIndex: item.sourceImageIndex,
          defaultStrategy,
          fallbackNow,
        })
      );
      if (runOfflineOnly) {
        recordMt5OcrScanDiagnostic(
          buildMt5OcrDiagnosticRecord({
            requestedMode,
            resolvedEngine: 'cache',
            invokedFallback: false,
            fallbackReason: `Served from sessionStorage offline cache (${cached.modelUsed})`,
            imageIndex: item.sourceImageIndex,
            mappedCandidates: mapped,
            totalDurationMs: 1,
          })
        );
      }
      outcomesMap.set(item.sourceImageIndex, {
        sourceImageIndex: item.sourceImageIndex,
        status: 'done',
        trades: mapped,
        fromCache: true,
        scanEngine: 'cache',
        modelUsed: `${cached.modelUsed} (cache)`,
      });
    } else {
      uncached.push({ item: { ...item, imageDataUrl: trimmed }, hash });
    }
  }

  let lastModelUsed = '';
  let lastSource = runOfflineOnly ? 'MT5_HISTORY_OFFLINE' : 'MT5_HISTORY';

  if (runOfflineOnly) {
    for (const entry of uncached) {
      const ocrExec = await runMt5HistoryOcrFallback(entry.item.imageDataUrl);
      const ocrRows = ocrExec.rows;
      if (ocrRows.length > 0) {
        lastModelUsed = 'offline-ocr-tesseract';
        lastSource = 'MT5_HISTORY_OFFLINE';
        setCachedMt5ScanResult(entry.hash, 'offline', {
          rows: ocrRows,
          modelUsed: 'offline-ocr-tesseract',
          source: 'MT5_HISTORY_OFFLINE',
          cachedAt: Date.now(),
        });
        const mapped = ocrRows.map((r, rIdx) =>
          mapRawRowToCandidate(r, rIdx, {
            existingTrades,
            sourceImageIndex: entry.item.sourceImageIndex,
            defaultStrategy,
            fallbackNow,
          })
        );
        recordMt5OcrScanDiagnostic(
          buildMt5OcrDiagnosticRecord({
            requestedMode,
            resolvedEngine: 'offline-ocr',
            invokedFallback: ocrExec.invokedFallbackPass,
            fallbackReason: ocrExec.invokedFallbackPass
              ? `Multi-pass OCR executed (${ocrExec.passes.length} passes)`
              : undefined,
            imageIndex: entry.item.sourceImageIndex,
            ocrExec,
            mappedCandidates: mapped,
          })
        );
        outcomesMap.set(entry.item.sourceImageIndex, {
          sourceImageIndex: entry.item.sourceImageIndex,
          status: 'done',
          trades: mapped,
          fromCache: false,
          scanEngine: 'offline-ocr',
          modelUsed: 'offline-ocr-tesseract',
        });
      } else {
        const errText =
          ocrExec.error ||
          'Tidak ada baris transaksi MT5/MT4 yang terbaca secara offline. Pastikan teks posisi (contoh: XAUUSD, buy 0.10 dan 2640.00 -> 2650.00) terlihat tajam & penuh.';
        recordMt5OcrScanDiagnostic(
          buildMt5OcrDiagnosticRecord({
            requestedMode,
            resolvedEngine: 'error',
            invokedFallback: ocrExec.invokedFallbackPass,
            fallbackReason: ocrExec.invokedFallbackPass
              ? `All ${ocrExec.passes.length} offline OCR passes returned 0 trade rows`
              : 'Primary offline OCR pass returned 0 trade rows',
            imageIndex: entry.item.sourceImageIndex,
            ocrExec,
            mappedCandidates: [],
            error: errText,
          })
        );
        outcomesMap.set(entry.item.sourceImageIndex, {
          sourceImageIndex: entry.item.sourceImageIndex,
          status: 'error',
          trades: [],
          fromCache: false,
          scanEngine: 'error',
          modelUsed: 'offline-ocr-tesseract',
          error: errText,
        });
      }
    }
  } else {
    prewarmOfflineTesseractWorker();
    const endpoints = getApiEndpointCandidates('/api/extract-mt5-history');
    const CHUNK_SIZE = 4;

    for (let start = 0; start < uncached.length; start += CHUNK_SIZE) {
      const chunk = uncached.slice(start, start + CHUNK_SIZE);
      const payload =
        chunk.length === 1
          ? { imageBase64: chunk[0].item.imageDataUrl }
          : { images: chunk.map((c) => ({ imageBase64: c.item.imageDataUrl })) };

      let chunkHandled = false;
      let lastChunkError = 'Gagal menghubungi layanan AI Scan Kilat MT5.';
      let chunkQuotaExhausted = false;

      // Start local on-device OCR in parallel so if Gemini is busy (503) or slow,
      // fallback results are already computed with 0ms additional waiting.
      const parallelOcrByIndexPromise: Promise<Mt5OcrFallbackExecutionResult[]> = Promise.all(
        chunk.map((entry) => runMt5HistoryOcrFallback(entry.item.imageDataUrl))
      );

      for (const endpoint of endpoints) {
        const res = await nativeAwarePostJson(endpoint, payload, 22000);
        if (res.ok && res.json?.success && res.json?.data) {
          const rawTrades: any[] = Array.isArray(res.json.data.trades) ? res.json.data.trades : [];
          lastModelUsed = String(res.json.data.modelUsed || 'gemini-3.1-flash-lite');
          lastSource = String(res.json.data.source || 'MT5_HISTORY');

          const rowsByLocalIdx = new Map<number, RawNormalizedMt5Row[]>();
          for (let ci = 0; ci < chunk.length; ci++) {
            rowsByLocalIdx.set(ci, []);
          }

          for (const rawRow of rawTrades) {
            const localIdx =
              typeof rawRow.imageIndex === 'number' && Number.isFinite(rawRow.imageIndex)
                ? Math.max(0, Math.min(chunk.length - 1, Math.trunc(rawRow.imageIndex)))
                : 0;
            rowsByLocalIdx.get(localIdx)!.push(normalizeBackendMt5Row(rawRow));
          }

          for (let ci = 0; ci < chunk.length; ci++) {
            const entry = chunk[ci];
            const rawRows = rowsByLocalIdx.get(ci) || [];
            if (rawRows.length > 0) {
              setCachedMt5ScanResult(entry.hash, 'ai', {
                rows: rawRows,
                modelUsed: lastModelUsed,
                source: lastSource,
                cachedAt: Date.now(),
              });
            }
            const mapped = rawRows.map((r, rIdx) =>
              mapRawRowToCandidate(r, rIdx, {
                existingTrades,
                sourceImageIndex: entry.item.sourceImageIndex,
                defaultStrategy,
                fallbackNow,
              })
            );
            outcomesMap.set(entry.item.sourceImageIndex, {
              sourceImageIndex: entry.item.sourceImageIndex,
              status: 'done',
              trades: mapped,
              fromCache: false,
              scanEngine: 'gemini',
              modelUsed: lastModelUsed,
            });
          }

          chunkHandled = true;
          break;
        }

        if (res.json?.quotaExhausted) {
          chunkQuotaExhausted = true;
        }
        if (res.json?.error) {
          lastChunkError = String(res.json.error);
        } else if (res.errorMessage) {
          lastChunkError = res.errorMessage;
        } else if (res.status) {
          lastChunkError = `HTTP ${res.status} dari backend Scan MT5.`;
        }
      }

      // Use parallel On-Device Offline OCR result when backend AI failed/timed out/exhausted
      if (!chunkHandled) {
        const parallelOcrResults = await parallelOcrByIndexPromise;
        for (let ci = 0; ci < chunk.length; ci++) {
          const entry = chunk[ci];
          const ocrExec = parallelOcrResults[ci];
          const ocrRows = ocrExec?.rows || [];
          if (ocrRows.length > 0) {
            lastModelUsed = lastModelUsed || 'offline-ocr-tesseract';
            lastSource = 'MT5_HISTORY_OFFLINE';
            setCachedMt5ScanResult(entry.hash, 'offline', {
              rows: ocrRows,
              modelUsed: 'offline-ocr-tesseract',
              source: 'MT5_HISTORY_OFFLINE',
              cachedAt: Date.now(),
            });
            const mapped = ocrRows.map((r, rIdx) =>
              mapRawRowToCandidate(r, rIdx, {
                existingTrades,
                sourceImageIndex: entry.item.sourceImageIndex,
                defaultStrategy,
                fallbackNow,
              })
            );
            recordMt5OcrScanDiagnostic(
              buildMt5OcrDiagnosticRecord({
                requestedMode,
                resolvedEngine: 'offline-ocr',
                invokedFallback: true,
                fallbackReason: `Auto mode fallback to Offline OCR: ${lastChunkError}`,
                imageIndex: entry.item.sourceImageIndex,
                ocrExec,
                mappedCandidates: mapped,
              })
            );
            outcomesMap.set(entry.item.sourceImageIndex, {
              sourceImageIndex: entry.item.sourceImageIndex,
              status: 'done',
              trades: mapped,
              fromCache: false,
              scanEngine: 'offline-ocr',
              modelUsed: 'offline-ocr-tesseract',
            });
          } else {
            recordMt5OcrScanDiagnostic(
              buildMt5OcrDiagnosticRecord({
                requestedMode,
                resolvedEngine: 'error',
                invokedFallback: true,
                fallbackReason: `Auto mode AI + Offline OCR fallback failed: ${lastChunkError}`,
                imageIndex: entry.item.sourceImageIndex,
                ocrExec,
                mappedCandidates: [],
                error: lastChunkError,
              })
            );
            outcomesMap.set(entry.item.sourceImageIndex, {
              sourceImageIndex: entry.item.sourceImageIndex,
              status: 'error',
              trades: [],
              fromCache: false,
              scanEngine: 'error',
              modelUsed: chunkQuotaExhausted ? 'quota-exhausted' : 'error',
              error: lastChunkError,
            });
          }
        }
      }
    }
  }

  const perImageOutcomes = items.map(
    (it) =>
      outcomesMap.get(it.sourceImageIndex) || {
        sourceImageIndex: it.sourceImageIndex,
        status: 'error' as const,
        trades: [],
        fromCache: false,
        scanEngine: 'error' as const,
        modelUsed: 'unknown',
        error: 'Status screenshot tidak diketahui.',
      }
  );
  const trades = perImageOutcomes.flatMap((o) => o.trades);

  return {
    trades,
    perImageOutcomes,
    cacheHitsCount,
    modelUsed: lastModelUsed || (cacheHitsCount > 0 ? 'cache' : 'gemini-3.1-flash-lite'),
    source: lastSource,
  };
}

export async function scanSingleMt5HistoryScreenshot(
  imageDataUrl: string,
  options?: {
    existingTrades?: Trade[];
    sourceImageIndex?: number;
    defaultStrategy?: string;
    forceRefresh?: boolean;
    mode?: Mt5ScanExecutionMode;
  }
): Promise<{
  trades: Mt5HistoryTradeCandidate[];
  modelUsed: string;
  source: string;
  fromCache?: boolean;
  scanEngine?: 'gemini' | 'offline-ocr' | 'cache' | 'error';
}> {
  const sourceImageIndex = options?.sourceImageIndex ?? 0;
  const batchRes = await scanBatchMt5HistoryScreenshots(
    [{ imageDataUrl, sourceImageIndex }],
    options
  );
  const outcome = batchRes.perImageOutcomes[0];
  if (outcome && outcome.status === 'error') {
    throw new Error(outcome.error || 'Gagal memindai screenshot MT5.');
  }
  return {
    trades: batchRes.trades,
    modelUsed: outcome?.modelUsed || batchRes.modelUsed,
    source: batchRes.source,
    fromCache: outcome?.fromCache,
    scanEngine: outcome?.scanEngine,
  };
}

export function parseMt5HistoryRowsFromOcrText(
  rawText: string,
  ocrMeta?: { lines?: OfflineOcrLine[]; words?: OfflineOcrWordBox[] }
): Array<{
  ticketId: string | null;
  instrument: string;
  position: TradePosition;
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  netProfit: number;
  openDateTime: string | null;
  closeDateTime: string | null;
  closeType: TradeCloseType;
  notes: string;
  ocrSignRecovered: boolean;
}> {
  if (!rawText || !rawText.trim()) return [];
  // Normalize unicode dashes, arrow OCR variations (- >, = >, -=, »), and thin punctuation before splitting
  const normalizeLineText = (txt: string): string =>
    txt
      .replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-')
      .replace(/[→➜➔➡➞▶⇢›»]/g, ' -> ')
      .replace(/(?:[-=~]\s*>|\s-=\s)/g, ' -> ');

  const normalizedRaw = normalizeLineText(rawText);

  const lines = normalizedRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Spatial right-column word metadata (when supplied by Tesseract word bounding boxes)
  const metaLines = Array.isArray(ocrMeta?.lines) ? ocrMeta.lines : [];
  const metaWords = Array.isArray(ocrMeta?.words) ? ocrMeta.words : [];
  let pageMinX = Infinity;
  let pageMaxX = -Infinity;
  for (const w of metaWords) {
    if (w.left < pageMinX) pageMinX = w.left;
    const right = w.left + w.width;
    if (right > pageMaxX) pageMaxX = right;
  }
  const hasSpatialWords =
    metaWords.length > 0 && Number.isFinite(pageMinX) && Number.isFinite(pageMaxX) && pageMaxX > pageMinX + 40;
  const rightColMinX = hasSpatialWords ? pageMinX + (pageMaxX - pageMinX) * 0.62 : Infinity;

  const lineToCenterY = new Map<number, number>();
  if (metaLines.length > 0) {
    let metaCursor = 0;
    for (let li = 0; li < lines.length; li++) {
      const targetCompact = lines[li].replace(/\s+/g, '');
      for (let mi = metaCursor; mi < metaLines.length; mi++) {
        const candCompact = normalizeLineText(metaLines[mi].text).replace(/\s+/g, '');
        if (candCompact === targetCompact) {
          lineToCenterY.set(li, metaLines[mi].centerY);
          metaCursor = mi + 1;
          break;
        }
      }
    }
  }

  const results: Array<{
    ticketId: string | null;
    instrument: string;
    position: TradePosition;
    lotSize: number;
    entryPrice: number;
    exitPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    commission: number;
    swap: number;
    netProfit: number;
    openDateTime: string | null;
    closeDateTime: string | null;
    closeType: TradeCloseType;
    notes: string;
    ocrSignRecovered: boolean;
  }> = [];

  const HEADER_REGEX =
    /(?:^|[\s|])([#A-Za-z0-9._+/]{3,16})(?:\s*[,:;.]\s*|\s+)(buy|sell|beli|jual)(?:\s+(?:limit|stop))?(?:\s+(?:in\/out|in|out))?(?:\s+([0-9Oo][0-9Oo.,]*))?/i;

  const NON_INSTRUMENT_WORDS = new Set([
    'COMMENT',
    'ORDER',
    'CLOSE',
    'OPEN',
    'PROFIT',
    'SWAP',
    'CHARGES',
    'COMMISSION',
    'TAXES',
    'DEAL',
    'BALANCE',
    'TOTAL',
    'MAGIC',
    'CREDIT',
    'DEPOSIT',
    'EQUITY',
    'MARGIN',
    'WITHDRAWAL',
  ]);

  const DETAIL_LINE_PREFIX_RE =
    /^\s*(?:[S5]\s*[\/|\\!l1I.]\s*[L1]|[T7]\s*[\/|\\!l1I.]\s*P|\b(?:SL|TP|Stop\s*Loss|Take\s*Profit|Swap|Commission|Comm|Charges|Fee|Taxes|Open|Close|Profit|Magic|Comment|ID|Order|Deal|Time)\b)\s*[:=#]?/i;

  const SL_LABEL_RE =
    /(?:^|[\s|])(?:S\s*[\/|\\!l1I.]\s*[L1]\s*[:=]?|5\s*[\/|\\!lI]\s*L\s*[:=]?|(?:SL|S\s+L)\s*[:=]|Stop\s*Loss\s*[:=]?)/i;
  const TP_LABEL_RE =
    /(?:^|[\s|])(?:[T7]\s*[\/|\\!l1I.]\s*P\s*[:=]?|(?:TP|T\s+P)\s*[:=]|Take\s*Profit\s*[:=]?)/i;
  const SWAP_LABEL_RE = /\bSwap\s*[:=]?/i;
  const COMM_LABEL_RE = /\b(?:Commission|Comm|Charges|Fee|Taxes)\s*[:=]?/i;
  const FIELD_BOUNDARY_RE =
    /(?:(?:^|[\s|])S\s*[\/|\\!l1I.]\s*[L1]\s*[:=]?|(?:^|[\s|])5\s*[\/|\\!lI]\s*L\s*[:=]?|(?:^|[\s|])[T7]\s*[\/|\\!l1I.]\s*P\s*[:=]?|\b(?:SL|TP|Stop\s*Loss|Take\s*Profit|Swap|Commission|Comm|Charges|Fee|Taxes|Open|Close|Profit|Magic|Comment|ID|Order|Deal|Time)\b(?:\s*[:=])?)/i;

  const PRICE_TOKEN_PATTERN =
    '[0-9]{1,3}(?:\\.[0-9]{3})+,[0-9]{1,5}|[0-9]{1,3}(?:[ .][0-9]{3})+[.,][0-9]{1,5}|[0-9]{1,6}[.,][0-9]{1,5}';

  const DATETIME_GLOBAL_RE =
    /\b((?:19|20)\d{2})([.\-\/])(\d{1,2})\2(\d{1,2})\s+(\d{1,2}:\d{2})(?::(\d{2}))?|\b(\d{1,2})([.\-\/])(\d{1,2})\7((?:19|20)\d{2})\s+(\d{1,2}:\d{2})(?::(\d{2}))?/g;

  const stripDatesAndTickets = (txt: string): string =>
    txt
      .replace(
        /\b(?:19|20)\d{2}([.\-\/])(?:0?[1-9]|1[0-2])\1(?:0?[1-9]|[12]\d|3[01])(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g,
        ' '
      )
      .replace(
        /\b(?:0?[1-9]|[12]\d|3[01])([.\-\/])(?:0?[1-9]|1[0-2])\1(?:19|20)\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g,
        ' '
      )
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
      .replace(/(?:ID\s*[:#]?|Order\s*[:#]?|Deal\s*[:#]?|#)\s*\d{4,15}\b/gi, ' ');

  const sanitizeNumericOcrNoise = (txt: string): string =>
    txt
      .replace(/(?<=\d)[Oo](?=\d|[.,])|(?<=[.,])[Oo](?=\d)|\b[Oo](?=\.\d)/g, '0')
      .replace(/(?<=\d)[lI|](?=\d|[.,])|(?<=[.,])[lI|](?=\d)/g, '1')
      .replace(/(?<=\d)[lI|]\b/g, '1')
      .replace(/(\d)[.,]\s+(?=\d{2,5}\b)/g, '$1.')
      .replace(/(\d)\s+[.,](\d{1,5}\b)/g, '$1.$2');

  const repairHeaderDirectionTypos = (rawLine: string): string =>
    rawLine
      .replace(
        /(\b[A-Za-z0-9._+/]{3,16}(?:\s*[,:;.]\s*|\s+))(?:se[l1I]{2}|5e[l1I]{2}|seii)(?=\s+(?:limit|stop|in|out|[0-9Oo]))/gi,
        '$1sell'
      )
      .replace(
        /(\b[A-Za-z0-9._+/]{3,16}(?:\s*[,:;.]\s*|\s+))(?:b[uv][yv]|huy)(?=\s+(?:limit|stop|in|out|[0-9Oo]))/gi,
        '$1buy'
      );

  const isPlausiblePrice = (
    val: number | null,
    instrument: string,
    referencePrice?: number | null
  ): val is number => {
    if (val === null || !Number.isFinite(val) || val <= 0) return false;
    const spec = INSTRUMENT_PRICE_RANGES[instrument];
    if (spec) {
      if (val < spec.min * 0.5 || val > spec.max * 2.0) return false;
    }
    if (referencePrice && referencePrice > 0) {
      if (val < referencePrice * 0.45 || val > referencePrice * 2.2) return false;
    }
    return true;
  };

  const matchHeaderLine = (candidateLine: string): RegExpMatchArray | null => {
    if (
      /^(?:profit|balance|deposit|credit|withdrawal|margin|equity|swap|commission|charges|taxes)\s*:/i.test(
        candidateLine
      ) ||
      /\b(?:balance|deposit|credit|withdrawal|canceled|cancelled)\b/i.test(candidateLine) ||
      DETAIL_LINE_PREFIX_RE.test(candidateLine)
    ) {
      return null;
    }
    const repaired = repairHeaderDirectionTypos(candidateLine);
    const m = repaired.match(HEADER_REGEX);
    if (!m) return null;
    const rawSym = m[1].replace(/^#/, '').toUpperCase();
    if (!/[A-Za-z]{2,}/.test(rawSym) || NON_INSTRUMENT_WORDS.has(rawSym)) {
      return null;
    }
    return m;
  };

  const parseDateToken = (m: RegExpMatchArray): string | null => {
    if (m[1]) {
      const sec = m[6] ? `:${m[6].padStart(2, '0')}` : '';
      return `${m[1]}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}T${m[5].padStart(5, '0')}${sec}`;
    }
    if (m[7]) {
      const sec = m[12] ? `:${m[12].padStart(2, '0')}` : '';
      return `${m[10]}-${m[9].padStart(2, '0')}-${m[7].padStart(2, '0')}T${m[11].padStart(5, '0')}${sec}`;
    }
    return null;
  };

  const quickArrowCheckRe = new RegExp(
    `(${PRICE_TOKEN_PATTERN})\\s*(?:->|>|~|\\bto\\b|-)\\s*(${PRICE_TOKEN_PATTERN})`,
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = matchHeaderLine(line);
    if (!headerMatch) continue;

    const instrument = normalizeScanInstrument(headerMatch[1]);
    const dirRaw = headerMatch[2].toUpperCase();
    const position: TradePosition = dirRaw === 'SELL' || dirRaw === 'JUAL' ? 'SELL' : 'BUY';

    // Window spans up to 17 following lines for expanded MT5 details until next trade header, summary row, or second price-pair boundary
    const windowLines: string[] = [line];
    let seenNonDetailPricePairInWindow = false;
    let nextHeaderIndex: number | null = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 18); j++) {
      if (/^(?:profit|balance|deposit|credit|withdrawal|margin|equity)\s*:/i.test(lines[j])) {
        break;
      }
      if (matchHeaderLine(lines[j])) {
        nextHeaderIndex = j;
        break;
      }
      const isDetailLine = DETAIL_LINE_PREFIX_RE.test(lines[j]);
      if (!isDetailLine && quickArrowCheckRe.test(stripDatesAndTickets(lines[j]))) {
        if (seenNonDetailPricePairInWindow) {
          // Safeguard: another trade's Entry->Exit line appeared (its header was likely dropped/garbled)
          break;
        }
        seenNonDetailPricePairInWindow = true;
      }
      windowLines.push(lines[j]);
    }
    const windowText = windowLines.join(' ');

    // Lot size (either right after buy/sell or elsewhere on header/row, tolerating 'O.10' OCR slip)
    const normalizedHeaderLot = headerMatch[3]
      ? headerMatch[3].replace(/[Oo]/g, '0')
      : '';
    let lotSize = normalizedHeaderLot
      ? parseSignedMt5Number(normalizedHeaderLot, false, 'EURUSD') || 0.01
      : 0.01;
    if (!normalizedHeaderLot) {
      const lotLineClean = sanitizeNumericOcrNoise(line.slice((headerMatch.index || 0) + headerMatch[0].length));
      const lotFallback = lotLineClean.match(/\b(0\.\d{2}|[1-9]\d{0,2}[.,]\d{2})\b/);
      if (lotFallback) {
        const candLot = parseSignedMt5Number(lotFallback[1], false, 'EURUSD');
        if (candLot !== null && candLot >= 0.01 && candLot <= 100) lotSize = candLot;
      }
    }

    // 1) Timestamps: prefer explicit Open: / Close: labels, otherwise earliest/latest in window
    let openDateTime: string | null = null;
    let closeDateTime: string | null = null;
    const allDtList: string[] = [];

    for (const wl of windowLines) {
      const openLineMatch = wl.match(
        /\bOpen\s*[:=]?\s*(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)/i
      );
      if (openLineMatch) {
        const parsedOpen = Array.from(openLineMatch[1].matchAll(DATETIME_GLOBAL_RE))
          .map(parseDateToken)
          .find(Boolean);
        if (parsedOpen) openDateTime = parsedOpen;
      }

      const closeLineMatch = wl.match(
        /\bClose\s*[:=]?\s*(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)/i
      );
      if (closeLineMatch) {
        const parsedClose = Array.from(closeLineMatch[1].matchAll(DATETIME_GLOBAL_RE))
          .map(parseDateToken)
          .find(Boolean);
        if (parsedClose) closeDateTime = parsedClose;
      }

      // Skip Open: line when collecting fallback close timestamps so closeDateTime prefers execution close time
      if (!/^\s*Open\s*[:=]/i.test(wl)) {
        for (const m of wl.matchAll(DATETIME_GLOBAL_RE)) {
          const dt = parseDateToken(m);
          if (dt) allDtList.push(dt);
        }
      }
    }
    if (!closeDateTime && allDtList.length > 0) {
      closeDateTime = allDtList[0];
    }
    if (!closeDateTime) {
      const anyDts = Array.from(windowText.matchAll(DATETIME_GLOBAL_RE))
        .map(parseDateToken)
        .filter((d): d is string => Boolean(d));
      if (anyDts.length > 0) {
        closeDateTime = anyDts[anyDts.length - 1];
        if (!openDateTime && anyDts.length >= 2) {
          openDateTime = anyDts[0];
        }
      }
    }

    // 2) Expanded fields extraction (SL / TP / Swap / Commission / Ticket ID)
    // Supports inline ("S / L: 2653.40  Swap: 0.00"), unset dashes ("S / L: -  Swap: 0.00"),
    // and Tesseract two-column stacked splits ("S / L:  Swap:\n2653.40  0.00").
    type FieldKind = 'SL' | 'TP' | 'SWAP' | 'COMM';
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;
    let swap = 0;
    let commission = 0;
    let swapMatched = false;
    const consumedAsStackedDetailLines = new Set<number>();

    const extractNumberTokens = (seg: string): string[] => {
      const cleaned = sanitizeNumericOcrNoise(stripDatesAndTickets(seg));
      return (
        cleaned.match(
          /[+-]?\s*(?:\d{1,3}(?:\.\d{3})+,\d{1,5}|\d{1,3}(?:[ ,]\d{3})+\.\d{1,5}|\d+[.,]\d{1,5}|\d+)/g
        ) || []
      );
    };

    const assignFieldValue = (kind: FieldKind, rawNumToken: string): boolean => {
      if (kind === 'SL' || kind === 'TP') {
        const val = parseSignedMt5Number(rawNumToken, true, instrument);
        if (!isPlausiblePrice(val, instrument)) return false;
        if (kind === 'SL' && stopLoss === null) {
          stopLoss = val;
          return true;
        }
        if (kind === 'TP' && takeProfit === null) {
          takeProfit = val;
          return true;
        }
        return false;
      }
      if (kind === 'SWAP') {
        const val = parseSignedMt5Number(rawNumToken, false, 'EURUSD');
        if (val === null) return false;
        if (!swapMatched) {
          swap = val;
          swapMatched = true;
        }
        return true;
      }
      if (kind === 'COMM') {
        const val = parseSignedMt5Number(rawNumToken, false, 'EURUSD');
        if (val === null) return false;
        commission += Math.abs(val);
        return true;
      }
      return false;
    };

    for (let li = 0; li < windowLines.length; li++) {
      const wl = windowLines[li];
      const matches: Array<{ kind: FieldKind; index: number; endIndex: number }> = [];

      const findFieldMatches = (re: RegExp, kind: FieldKind) => {
        const gre = new RegExp(re.source, 'gi');
        for (const m of wl.matchAll(gre)) {
          if (m.index !== undefined) {
            matches.push({ kind, index: m.index, endIndex: m.index + m[0].length });
          }
        }
      };
      findFieldMatches(SL_LABEL_RE, 'SL');
      findFieldMatches(TP_LABEL_RE, 'TP');
      findFieldMatches(SWAP_LABEL_RE, 'SWAP');
      findFieldMatches(COMM_LABEL_RE, 'COMM');

      if (matches.length === 0) continue;
      matches.sort((a, b) => a.index - b.index);

      const pendingStackedFields: FieldKind[] = [];
      for (let mi = 0; mi < matches.length; mi++) {
        const cur = matches[mi];
        const nextMatchStart =
          mi + 1 < matches.length ? matches[mi + 1].index : wl.length;
        // Also stop at unrelated boundary labels like Open:, Close:, Taxes:, ID:
        const afterCur = wl.slice(cur.endIndex, nextMatchStart);
        const otherBoundary = afterCur.match(FIELD_BOUNDARY_RE);
        const sliceStr =
          otherBoundary && otherBoundary.index !== undefined
            ? afterCur.slice(0, otherBoundary.index)
            : afterCur;

        const trimmedSlice = sliceStr
          .replace(/^[:=\s]+|[:=\s]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        // Explicit MT5 empty dash means intentionally unset -> never grab next line's number
        if (/^[-—–]+$/.test(trimmedSlice)) {
          continue;
        }

        const toks = extractNumberTokens(sliceStr);
        if (toks.length > 0) {
          let assigned = false;
          for (const tk of toks) {
            if (assignFieldValue(cur.kind, tk)) {
              assigned = true;
              break;
            }
          }
          if (!assigned && !trimmedSlice) {
            pendingStackedFields.push(cur.kind);
          }
        } else if (!trimmedSlice) {
          pendingStackedFields.push(cur.kind);
        }
      }

      // If labels had no inline values and next line holds raw column values without field labels
      if (
        pendingStackedFields.length > 0 &&
        li + 1 < windowLines.length &&
        !FIELD_BOUNDARY_RE.test(windowLines[li + 1])
      ) {
        const nextToks = extractNumberTokens(windowLines[li + 1]);
        if (nextToks.length > 0) {
          consumedAsStackedDetailLines.add(li + 1);
        }
        let tokCursor = 0;
        for (const pendingKind of pendingStackedFields) {
          while (tokCursor < nextToks.length) {
            const consumed = assignFieldValue(pendingKind, nextToks[tokCursor]);
            tokCursor++;
            if (consumed) break;
          }
        }
      }
    }

    const ticketMatch = windowText.match(/(?:ID\s*[:#]?|Order\s*[:#]?|Deal\s*[:#]?|#)\s*(\d{5,15})\b/i);
    const ticketId = ticketMatch ? ticketMatch[1] : null;

    // 3) Entry & Exit Price Extraction (Prioritized for Expanded MT5 Views)
    const cleanLineForPrices = (rawLine: string, stripHeaderAndProfit = false): string => {
      let s = stripDatesAndTickets(rawLine);
      if (stripHeaderAndProfit) {
        s = s.replace(headerMatch[0], ' ');
      }
      const boundary = s.match(FIELD_BOUNDARY_RE);
      if (boundary && boundary.index !== undefined) {
        s = s.slice(0, boundary.index);
      }
      return sanitizeNumericOcrNoise(s);
    };

    const arrowRegex = new RegExp(
      `(${PRICE_TOKEN_PATTERN})\\s*(?:->|>|~|\\bto\\b)\\s*(${PRICE_TOKEN_PATTERN})`,
      'i'
    );
    const dashArrowRegex = new RegExp(
      `(${PRICE_TOKEN_PATTERN})\\s*-\\s*(${PRICE_TOKEN_PATTERN})`
    );

    let entryPrice: number | null = null;
    let exitPrice: number | null = null;
    let matchedPriceSpanToStrip = '';

    // Pass A: Explicit arrow ("2650.00 -> 2653.40", "2650.00 - 2653.40", "2650.00 > 2653.40", even tight without spaces)
    // Check sub-lines first (idx >= 1) so header profit/lot numbers never interfere, then header line
    const subLineIndices = windowLines.map((_, idx) => idx).filter((idx) => idx >= 1);
    for (const idx of [...subLineIndices, 0]) {
      if (idx > 0 && (DETAIL_LINE_PREFIX_RE.test(windowLines[idx]) || consumedAsStackedDetailLines.has(idx))) continue;
      const cleaned = cleanLineForPrices(windowLines[idx], idx === 0);
      const am = cleaned.match(arrowRegex) || cleaned.match(dashArrowRegex);
      if (am) {
        const p1 = parseSignedMt5Number(am[1], true, instrument);
        const p2 = parseSignedMt5Number(am[2], true, instrument);
        if (isPlausiblePrice(p1, instrument) && isPlausiblePrice(p2, instrument)) {
          entryPrice = p1;
          exitPrice = p2;
          matchedPriceSpanToStrip = am[0];
          break;
        }
      }
    }

    // Pass B: Arrow glyph completely dropped by OCR on a price sub-line ("2650.00   2653.40   2026.11.23 14:22:10")
    if (entryPrice === null || exitPrice === null) {
      for (const idx of subLineIndices) {
        if (DETAIL_LINE_PREFIX_RE.test(windowLines[idx]) || consumedAsStackedDetailLines.has(idx)) continue;
        const cleaned = cleanLineForPrices(windowLines[idx], false);
        const candidates = extractPriceNumbersFromLine(cleaned, instrument).filter((c) =>
          isPlausiblePrice(c.val, instrument)
        );
        if (candidates.length >= 2) {
          entryPrice = candidates[0].val;
          exitPrice = candidates[1].val;
          matchedPriceSpanToStrip = `${candidates[0].raw} ${candidates[1].raw}`;
          break;
        }
      }
    }

    // Pass C: Entry and Exit split across consecutive pre-detail sub-lines before SL/TP lines
    if (entryPrice === null || exitPrice === null) {
      const preDetailPrices: Array<{ raw: string; val: number }> = [];
      for (const idx of subLineIndices) {
        if (DETAIL_LINE_PREFIX_RE.test(windowLines[idx]) || consumedAsStackedDetailLines.has(idx)) break;
        const cleaned = cleanLineForPrices(windowLines[idx], false);
        const candidates = extractPriceNumbersFromLine(cleaned, instrument).filter((c) =>
          isPlausiblePrice(c.val, instrument)
        );
        for (const c of candidates) {
          preDetailPrices.push(c);
        }
        if (preDetailPrices.length >= 2) break;
      }
      if (preDetailPrices.length >= 2) {
        entryPrice = preDetailPrices[0].val;
        exitPrice = preDetailPrices[1].val;
        matchedPriceSpanToStrip = `${preDetailPrices[0].raw} ${preDetailPrices[1].raw}`;
      }
    }

    // Pass D: Single-line Desktop MT5 table fallback: EntryPrice [SL TP] CloseDate ExitPrice [Comm Swap] NetProfit
    if (entryPrice === null || exitPrice === null) {
      const afterHeader = sanitizeNumericOcrNoise(line.slice((headerMatch.index || 0) + headerMatch[0].length));
      const desktopDt = afterHeader.match(
        /(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)/
      );
      if (desktopDt && desktopDt.index !== undefined) {
        const beforeDtPrices = extractPriceNumbersFromLine(
          afterHeader.slice(0, desktopDt.index),
          instrument
        ).filter((c) => isPlausiblePrice(c.val, instrument));
        const afterDtPrices = extractPriceNumbersFromLine(
          afterHeader.slice(desktopDt.index + desktopDt[0].length),
          instrument
        ).filter((c) => isPlausiblePrice(c.val, instrument));
        if (beforeDtPrices.length >= 1 && afterDtPrices.length >= 1) {
          entryPrice = beforeDtPrices[0].val;
          exitPrice = afterDtPrices[0].val;
          matchedPriceSpanToStrip = `${beforeDtPrices[0].raw} ${afterDtPrices[0].raw}`;
        }
      }
    }

    if (entryPrice === null || exitPrice === null || entryPrice <= 0 || exitPrice <= 0) {
      continue;
    }

    // Re-validate SL & TP relative to discovered EntryPrice so extreme OCR artifacts are never accepted
    if (stopLoss !== null && !isPlausiblePrice(stopLoss, instrument, entryPrice)) {
      stopLoss = null;
    }
    if (takeProfit !== null && !isPlausiblePrice(takeProfit, instrument, entryPrice)) {
      takeProfit = null;
    }

    // 4) Net Profit Extraction
    // Supports MT5 layouts where P/L sits on:
    // - Explicit `Profit:` line
    // - Line 0 (top-right of trade header)
    // - Line 1 or 2 (between row 0 and row 1, or beside Entry -> Exit when vertically offset)
    // - Non-detail fallback lines (explicitly ignoring Swap/Comm/Charges/Taxes/SL/TP stacked lines)
    let netProfit = 0;
    let foundProfit = false;

    const knownPriceSet = [entryPrice, exitPrice, stopLoss, takeProfit].filter(
      (v): v is number => v !== null && v > 0
    );
    const PROFIT_TOKEN_RE =
      /(?:[+-]\s*)?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:[ ,]\d{3})+\.\d{2}|\d+[.,]\d{2})\b/g;

    const extractProfitTokensFromLine = (rawSegment: string): string[] => {
      let s = stripDatesAndTickets(rawSegment);
      if (matchedPriceSpanToStrip) {
        s = s.replace(matchedPriceSpanToStrip, ' ');
      }
      s = s
        .replace(
          /(?:(?:^|[\s|])S\s*[\/|\\!l1I.]\s*[L1]\s*[:=]?|(?:^|[\s|])5\s*[\/|\\!lI]\s*L\s*[:=]?|(?:^|[\s|])[T7]\s*[\/|\\!l1I.]\s*P\s*[:=]?|\b(?:SL|TP|Stop\s*Loss|Take\s*Profit|Swap|Commission|Comm|Charges|Fee|Taxes|Magic))\s*[:=]?\s*[+-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d+)?/gi,
          ' '
        )
        .replace(/\(\s*([+-]?\s*\d[\d\s.,]*[.,]\d{2})\s*\)/g, ' -$1 ')
        .replace(/(?:^|\s)[~_]\s*(?=\d)/g, ' -')
        .replace(/([+-])\s+(?=\d)/g, '$1');
      s = sanitizeNumericOcrNoise(s);
      s = s.replace(new RegExp(PRICE_TOKEN_PATTERN, 'g'), (tok) => {
        const val = parseSignedMt5Number(tok, true, instrument);
        if (val !== null && knownPriceSet.some((kp) => Math.abs(val - kp) < 1e-6)) {
          return ' ';
        }
        return tok;
      });
      return s.match(PROFIT_TOKEN_RE) || [];
    };

    const explicitProfitLine = windowLines.find((wl) => /\bProfit\s*[:=]/i.test(wl));
    if (explicitProfitLine) {
      const afterProfit = explicitProfitLine.replace(/^.*?\bProfit\s*[:=]?\s*/i, '');
      const toks = extractProfitTokensFromLine(afterProfit);
      if (toks.length > 0) {
        const parsedPnl = parseSignedMt5Number(toks[0], false, 'EURUSD');
        if (parsedPnl !== null) {
          netProfit = parsedPnl;
          foundProfit = true;
        }
      }
    }

    // Spatial Right-Column Profit Lookup (uses Tesseract word X/Y boxes when available so P/L is never confused with left/mid columns)
    if (!foundProfit && hasSpatialWords) {
      const headerY = lineToCenterY.get(i);
      const nextY = nextHeaderIndex !== null ? lineToCenterY.get(nextHeaderIndex) : undefined;
      if (headerY !== undefined) {
        const bandTopY = headerY - 14;
        const bandBotY = nextY !== undefined ? Math.min(nextY - 8, headerY + 150) : headerY + 115;
        const rightWords = metaWords
          .filter(
            (w) =>
              w.centerX >= rightColMinX &&
              w.centerY >= bandTopY &&
              w.centerY <= bandBotY
          )
          .sort((a, b) => a.centerY - b.centerY || a.left - b.left);

        if (rightWords.length > 0) {
          const rightBands: Array<{ y: number; text: string }> = [];
          for (const rw of rightWords) {
            const cleanTok = normalizeLineText(rw.text).trim();
            if (!cleanTok) continue;
            const prevBand = rightBands[rightBands.length - 1];
            if (prevBand && Math.abs(rw.centerY - prevBand.y) <= Math.max(8, rw.height * 0.65)) {
              prevBand.text += ` ${cleanTok}`;
            } else {
              rightBands.push({ y: rw.centerY, text: cleanTok });
            }
          }

          for (const rb of rightBands) {
            if (DETAIL_LINE_PREFIX_RE.test(rb.text)) continue;
            const alignedFullLine = metaLines.find((ml) => Math.abs(ml.centerY - rb.y) <= 12);
            if (
              alignedFullLine &&
              !/\bProfit\s*[:=]/i.test(alignedFullLine.text) &&
              /(?:\b(?:Swap|Commission|Comm|Charges|Fee|Taxes|Magic|Stop\s*Loss|Take\s*Profit)\b|[S5]\s*[\/|\\!l1I.]\s*[L1]|[T7]\s*[\/|\\!l1I.]\s*P|\b(?:SL|TP)\s*[:=])/i.test(
                alignedFullLine.text
              )
            ) {
              continue;
            }
            // Skip timestamp-only bands on the top-right (e.g. "2026.11.03 14:22:10")
            if (/^(?:19|20)\d{2}[.\-\/]\d{1,2}|\b\d{1,2}:\d{2}/.test(rb.text.trim()) && !/[+-]?\d+[.,]\d{2}$/.test(rb.text.trim())) {
              const strippedTime = stripDatesAndTickets(rb.text).trim();
              if (!strippedTime) continue;
            }
            const spatialToks = extractProfitTokensFromLine(rb.text);
            if (spatialToks.length > 0) {
              const parsedPnl = parseSignedMt5Number(
                spatialToks[spatialToks.length - 1],
                false,
                'EURUSD'
              );
              if (parsedPnl !== null) {
                netProfit = parsedPnl;
                foundProfit = true;
                break;
              }
            } else {
              // Recover space-split decimal on right-hand profit column (e.g. "-12 50" -> "-12.50")
              const cleanSp = sanitizeNumericOcrNoise(stripDatesAndTickets(rb.text)).replace(
                /([+-])\s+(?=\d)/g,
                '$1'
              );
              const splitDecMatch = cleanSp.match(/(?:^|\s)([+-]?\d{1,5})\s+(\d{2})(?=\s|$)/);
              if (splitDecMatch) {
                const recovered = parseSignedMt5Number(
                  `${splitDecMatch[1]}.${splitDecMatch[2]}`,
                  false,
                  'EURUSD'
                );
                if (recovered !== null) {
                  netProfit = recovered;
                  foundProfit = true;
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Check Header Line 0
    if (!foundProfit) {
      const headerRest = line.slice((headerMatch.index || 0) + headerMatch[0].length);
      const headerTokens = extractProfitTokensFromLine(headerRest);
      if (headerTokens.length > 0) {
        const parsedPnl = parseSignedMt5Number(
          headerTokens[headerTokens.length - 1],
          false,
          'EURUSD'
        );
        if (parsedPnl !== null) {
          netProfit = parsedPnl;
          foundProfit = true;
        }
      } else {
        // Explicit signed whole-number fallback on header (e.g. "+120" or "-34" if OCR dropped ".00")
        const cleanSignedInt = sanitizeNumericOcrNoise(stripDatesAndTickets(headerRest))
          .replace(/([+-])\s+(?=\d)/g, '$1')
          .match(/(?:^|\s)([+-]\d{1,6})(?=\s*(?:USD|EUR|IDR|Rp)?(?:\s|$))/i);
        if (cleanSignedInt) {
          const parsedInt = parseSignedMt5Number(cleanSignedInt[1], false, 'EURUSD');
          if (parsedInt !== null) {
            netProfit = parsedInt;
            foundProfit = true;
          }
        }
      }
    }

    // Check immediate sub-lines (Line 1..2 before any S/L, T/P, Swap, Comm, Open detail rows)
    // Handles MT5 layouts where P/L sits on the price row or splits to its own band between Line 0 and Line 1
    if (!foundProfit) {
      for (const idx of subLineIndices) {
        if (idx > 3) break;
        if (DETAIL_LINE_PREFIX_RE.test(windowLines[idx]) || consumedAsStackedDetailLines.has(idx)) {
          continue;
        }
        const subTokens = extractProfitTokensFromLine(windowLines[idx]);
        if (subTokens.length > 0) {
          const parsedPnl = parseSignedMt5Number(
            subTokens[subTokens.length - 1],
            false,
            'EURUSD'
          );
          if (parsedPnl !== null) {
            netProfit = parsedPnl;
            foundProfit = true;
            break;
          }
        }
      }
    }

    // Final non-detail fallback across remaining window lines (skipping all stacked & labeled detail rows)
    if (!foundProfit) {
      const nonDetailJoined = windowLines
        .map((wl, idx) => {
          if (idx === 0) return wl.slice((headerMatch.index || 0) + headerMatch[0].length);
          if (DETAIL_LINE_PREFIX_RE.test(wl) || consumedAsStackedDetailLines.has(idx)) return '';
          return wl;
        })
        .filter(Boolean)
        .join(' ');
      const fallbackTokens = extractProfitTokensFromLine(nonDetailJoined);
      if (fallbackTokens.length > 0) {
        const parsedValues = fallbackTokens
          .map((tk) => parseSignedMt5Number(tk, false, 'EURUSD'))
          .filter((v): v is number => v !== null);
        const firstNonZero = parsedValues.find((v) => Math.abs(v) >= 0.01);
        if (firstNonZero !== undefined) {
          netProfit = firstNonZero;
          foundProfit = true;
        } else if (parsedValues.length > 0) {
          netProfit = parsedValues[0];
        }
      }
    }

    // Bidirectional OCR Sign Recovery from Entry -> Exit direction
    const priceDelta = position === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
    const minDirMove =
      instrument === 'XAUUSD'
        ? 0.05
        : instrument.includes('JPY') || instrument === 'XAGUSD'
        ? 0.005
        : ['BTCUSD', 'US30', 'NAS100', 'SPX500', 'GER40'].includes(instrument)
        ? 1.0
        : 0.00005;

    let ocrSignRecovered = false;
    if (priceDelta <= -minDirMove && netProfit > 0.01) {
      netProfit = -Math.abs(netProfit);
      ocrSignRecovered = true;
    } else if (
      priceDelta >= minDirMove &&
      netProfit < -((commission + Math.abs(swap)) * 2 + 1.5)
    ) {
      netProfit = Math.abs(netProfit);
      ocrSignRecovered = true;
    }

    // Infer closeType from tags or SL/TP proximity
    let closeType: TradeCloseType = 'Manual';
    if (/\[\s*tp\s*\]|\/\s*tp\b/i.test(windowText)) {
      closeType = 'TP';
    } else if (/\[\s*sl\s*\]|\/\s*sl\b/i.test(windowText)) {
      closeType = 'SL';
    } else if (
      takeProfit &&
      Math.abs(exitPrice - takeProfit) <= (instrument === 'XAUUSD' ? 0.65 : 0.0005)
    ) {
      closeType = 'TP';
    } else if (
      stopLoss &&
      Math.abs(exitPrice - stopLoss) <= (instrument === 'XAUUSD' ? 0.65 : 0.0005)
    ) {
      closeType = 'SL';
    }

    results.push({
      ticketId,
      instrument,
      position,
      lotSize: Number(lotSize.toFixed(2)),
      entryPrice,
      exitPrice,
      stopLoss: stopLoss && stopLoss > 0 ? stopLoss : null,
      takeProfit: takeProfit && takeProfit > 0 ? takeProfit : null,
      commission: Number(commission.toFixed(2)),
      swap: Number(swap.toFixed(2)),
      netProfit: Number(netProfit.toFixed(2)),
      openDateTime,
      closeDateTime,
      closeType,
      notes: 'Offline OCR',
      ocrSignRecovered,
    });
  }
  return results;
}

/**
 * Non-destructive, count-aware MT5 batch reconciler (Option 1):
 * - NEVER silently deletes any row from a screenshot (all tap-tap / double entries stay visible).
 * - Preserves every entry inside the same screenshot (`sourceImageIndex` match), labeling repeated specs as `isDoubleEntry`.
 * - Compares 1-to-1 against existing Journal trades (with second-level timestamp awareness) and against earlier
 *   different screenshots (`sourceImageIndex` mismatch) to flag scroll overlaps without hiding them.
 */
export function reconcileMt5BatchCandidates(
  candidates: Mt5HistoryTradeCandidate[],
  existingTrades: Trade[] = [],
  options?: { preserveSelectionForTempIds?: Set<string> }
): Mt5HistoryTradeCandidate[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const usedJournalIds = new Set<string>();
  const usedBatchOverlapTempIds = new Set<string>();
  const seenNonDupBatchSpecs: Mt5HistoryTradeCandidate[] = [];

  const preparedJournal = (existingTrades || []).map((t) => {
    const lc = resolveTradeLifecycle(t);
    return {
      trade: t,
      closeTs: lc.exitTime || t.dateTime,
      openTs: lc.entryTime || null,
    };
  });

  const journalMatchScore = (
    cand: Mt5HistoryTradeCandidate,
    entry: { trade: Trade; closeTs: string; openTs: string | null }
  ): number => {
    const t = entry.trade;
    const candTicket = cand.ticketId ? cand.ticketId.trim() : '';
    if (
      candTicket &&
      (t.id === `MT5-${candTicket}` ||
        (t.notes && t.notes.includes(`#${candTicket}`)) ||
        (t.executionNotes && t.executionNotes.includes(`#${candTicket}`)))
    ) {
      return 100;
    }

    if (
      !areMt5SpecsSimilar(cand, {
        instrument: t.instrument,
        position: t.position,
        lotSize: t.lotSize,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        netProfit: t.netProfit,
        closeDateTime: t.dateTime,
      })
    ) {
      return -1;
    }

    const candClose = cand.exactCloseDateTime || cand.closeDateTime;
    const closeCmp = compareMt5Timestamps(candClose, entry.closeTs);
    if (closeCmp === 'DIFFER') return -1;

    const candOpen = cand.exactOpenDateTime || cand.openDateTime || null;
    if (candOpen && entry.openTs) {
      const openCmp = compareMt5Timestamps(candOpen, entry.openTs);
      if (openCmp === 'DIFFER') return -1;
      if (closeCmp === 'EXACT_SECOND' && openCmp === 'EXACT_SECOND') return 90;
    }

    if (closeCmp === 'EXACT_SECOND') return 80;
    if (closeCmp === 'EXACT_MINUTE') return 60;
    return 40;
  };

  const results: Mt5HistoryTradeCandidate[] = [];

  for (const cand of candidates) {
    let isDuplicate = false;
    let duplicateReason: Mt5DuplicateReason | null = null;
    let duplicateMatchId: string | undefined = undefined;
    let isDoubleEntry = false;

    // 1. Count-aware 1-to-1 Journal check (second-precision aware)
    let bestJournalMatch: { trade: Trade; score: number } | null = null;
    for (const jEntry of preparedJournal) {
      if (usedJournalIds.has(jEntry.trade.id)) continue;
      const sc = journalMatchScore(cand, jEntry);
      if (sc > 0 && (!bestJournalMatch || sc > bestJournalMatch.score)) {
        bestJournalMatch = { trade: jEntry.trade, score: sc };
      }
    }

    if (bestJournalMatch) {
      usedJournalIds.add(bestJournalMatch.trade.id);
      isDuplicate = true;
      duplicateMatchId = bestJournalMatch.trade.id;
      duplicateReason =
        bestJournalMatch.score === 100
          ? 'EXACT_TICKET'
          : bestJournalMatch.score >= 60
          ? 'EXACT_JOURNAL_MATCH'
          : 'SIMILAR_JOURNAL_MATCH';
    } else {
      // 2. Count-aware cross-screenshot scroll overlap check (only compares across DIFFERENT screenshots)
      const candClose = cand.exactCloseDateTime || cand.closeDateTime;
      const candOpen = cand.exactOpenDateTime || cand.openDateTime || null;

      let matchedOverlap: Mt5HistoryTradeCandidate | null = null;
      for (const prev of seenNonDupBatchSpecs) {
        if (usedBatchOverlapTempIds.has(prev.tempId)) continue;
        // NEVER flag two entries from the SAME screenshot as scroll overlap unless identical Ticket ID
        const sameImage =
          cand.sourceImageIndex !== undefined &&
          prev.sourceImageIndex !== undefined &&
          cand.sourceImageIndex === prev.sourceImageIndex;

        const sameTicket =
          Boolean(cand.ticketId && prev.ticketId) &&
          cand.ticketId!.trim() === prev.ticketId!.trim();

        if (sameImage && !sameTicket) continue;

        if (sameTicket) {
          matchedOverlap = prev;
          break;
        }

        if (!areMt5SpecsSimilar(cand, prev)) continue;

        const prevClose = prev.exactCloseDateTime || prev.closeDateTime;
        const closeCmp = compareMt5Timestamps(candClose, prevClose);
        if (closeCmp === 'DIFFER') continue;

        const prevOpen = prev.exactOpenDateTime || prev.openDateTime || null;
        if (candOpen && prevOpen && compareMt5Timestamps(candOpen, prevOpen) === 'DIFFER') {
          continue;
        }

        matchedOverlap = prev;
        break;
      }

      if (matchedOverlap) {
        usedBatchOverlapTempIds.add(matchedOverlap.tempId);
        isDuplicate = true;
        duplicateReason = 'BATCH_OVERLAP';
        duplicateMatchId =
          matchedOverlap.sourceImageIndex !== undefined
            ? `Foto #${matchedOverlap.sourceImageIndex + 1}`
            : 'Foto Sebelumnya';
      }
    }

    // 3. Double-Entry badge detection for distinct kept rows sharing same-day specs with another trade
    if (!isDuplicate) {
      const sameDaySimilarBatch = seenNonDupBatchSpecs.some((prev) =>
        areMt5SpecsSimilar(cand, prev)
      );
      const sameDaySimilarJournal = preparedJournal.some((jEntry) =>
        areMt5SpecsSimilar(cand, {
          instrument: jEntry.trade.instrument,
          position: jEntry.trade.position,
          lotSize: jEntry.trade.lotSize,
          entryPrice: jEntry.trade.entryPrice,
          exitPrice: jEntry.trade.exitPrice,
          netProfit: jEntry.trade.netProfit,
          closeDateTime: jEntry.trade.dateTime,
        })
      );
      if (sameDaySimilarBatch || sameDaySimilarJournal) {
        isDoubleEntry = true;
      }
      seenNonDupBatchSpecs.push(cand);
    }

    const preserveChoice = options?.preserveSelectionForTempIds?.has(cand.tempId) ?? false;
    results.push({
      ...cand,
      isDuplicate,
      duplicateReason,
      duplicateMatchId,
      isDoubleEntry,
      selected: preserveChoice ? cand.selected : !isDuplicate,
    });
  }

  return results;
}

export function deduplicateBatchMt5Candidates(
  candidates: Mt5HistoryTradeCandidate[]
): Mt5HistoryTradeCandidate[] {
  return reconcileMt5BatchCandidates(candidates, []);
}

export interface Mt5CandidateRiskPreview {
  hasValidSl: boolean;
  riskAmount: number;
  riskPercentage: number;
  realizedR: number | null;
}

/**
 * Pure, honest risk & Realized R calculator for MT5 History scan candidates.
 * Computes riskAmount / riskPercentage / realizedR strictly when a valid Stop Loss is present;
 * when Stop Loss is missing or invalid, returns riskAmount = 0 and realizedR = null (honestly N/A).
 */
export function computeMt5CandidateRiskPreview(
  candidate: {
    instrument: string;
    position: TradePosition;
    lotSize: number;
    entryPrice: number;
    exitPrice?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    netProfit?: number;
  },
  settings: Partial<AppSettings> = DEFAULT_SETTINGS
): Mt5CandidateRiskPreview {
  const cleanSL =
    candidate.stopLoss !== null &&
    candidate.stopLoss !== undefined &&
    Number.isFinite(Number(candidate.stopLoss)) &&
    Number(candidate.stopLoss) > 0
      ? Number(candidate.stopLoss)
      : undefined;

  if (!cleanSL || !(Number(candidate.entryPrice) > 0) || !(Number(candidate.lotSize) > 0)) {
    return { hasValidSl: false, riskAmount: 0, riskPercentage: 0, realizedR: null };
  }

  const cleanTP =
    candidate.takeProfit !== null &&
    candidate.takeProfit !== undefined &&
    Number.isFinite(Number(candidate.takeProfit)) &&
    Number(candidate.takeProfit) > 0
      ? Number(candidate.takeProfit)
      : undefined;

  const cleanInstrument = normalizeScanInstrument(candidate.instrument);
  const capitalBasisAmount =
    typeof settings.startingBalance === 'number' && settings.startingBalance > 0
      ? settings.startingBalance
      : DEFAULT_SETTINGS.startingBalance;

  const riskMetrics = calculateLotBasedOrderMetrics(
    {
      symbol: cleanInstrument,
      position: candidate.position,
      lotSize: candidate.lotSize,
      entryPrice: candidate.entryPrice,
      stopLossPrice: cleanSL,
      takeProfitPrice: cleanTP,
      exitPrice: candidate.exitPrice,
      capitalBasisAmount,
    },
    settings
  );

  if (
    !riskMetrics.isSlValid ||
    riskMetrics.riskAmount === null ||
    !Number.isFinite(riskMetrics.riskAmount) ||
    riskMetrics.riskAmount <= 0
  ) {
    return { hasValidSl: false, riskAmount: 0, riskPercentage: 0, realizedR: null };
  }

  const riskAmount = Number(riskMetrics.riskAmount.toFixed(2));
  const riskPercentage =
    riskMetrics.riskPercentage !== null && Number.isFinite(riskMetrics.riskPercentage)
      ? Number(riskMetrics.riskPercentage.toFixed(2))
      : 0;
  const normalizedNet = Number((Number(candidate.netProfit) || 0).toFixed(2));
  const realizedR = computeRealizedRMultiple({
    netProfit: normalizedNet,
    riskAmount,
  });

  return {
    hasValidSl: true,
    riskAmount,
    riskPercentage,
    realizedR,
  };
}

export function buildClosedTradeFromMt5Candidate(
  candidate: Mt5HistoryTradeCandidate,
  usedIds: Set<string>,
  settings: AppSettings
): Trade {
  let finalId = candidate.ticketId ? `MT5-${candidate.ticketId}` : '';
  if (!finalId || usedIds.has(finalId.toLowerCase())) {
    do {
      finalId = `TRD-${Math.floor(100000 + Math.random() * 900000)}`;
    } while (usedIds.has(finalId.toLowerCase()));
  }
  usedIds.add(finalId.toLowerCase());

  const nowIso = new Date().toISOString();
  const normalizedComm = Number(Math.abs(candidate.commission || 0).toFixed(2));
  const normalizedSwap = Number((candidate.swap || 0).toFixed(2));
  const normalizedNet = Number((candidate.netProfit || 0).toFixed(2));
  const grossProfit = computeGrossFromNet(normalizedNet, normalizedComm, normalizedSwap);
  const outcome = classifyNetProfitOutcome(normalizedNet);

  const entryTime =
    candidate.exactOpenDateTime ||
    candidate.openDateTime ||
    candidate.exactCloseDateTime ||
    normalizeTradeDateTimeLocal(candidate.closeDateTime);
  const exitTime =
    candidate.exactCloseDateTime || normalizeTradeDateTimeLocal(candidate.closeDateTime);
  const journalDateTime = normalizeTradeDateTimeLocal(candidate.closeDateTime);
  const cleanSL =
    candidate.stopLoss !== null && candidate.stopLoss > 0 ? candidate.stopLoss : undefined;
  const cleanTP =
    candidate.takeProfit !== null && candidate.takeProfit > 0 ? candidate.takeProfit : undefined;

  const riskPreview = computeMt5CandidateRiskPreview(
    {
      instrument: candidate.instrument,
      position: candidate.position,
      lotSize: candidate.lotSize,
      entryPrice: candidate.entryPrice,
      exitPrice: candidate.exitPrice,
      stopLoss: cleanSL,
      takeProfit: cleanTP,
      netProfit: normalizedNet,
    },
    settings
  );

  const notesParts: string[] = [];
  if (candidate.ticketId) notesParts.push(`MT5 Ticket #${candidate.ticketId}`);
  if (candidate.notes) notesParts.push(candidate.notes);
  const humanNote = notesParts.join(' · ') || 'Diimpor otomatis via Scan Kilat Riwayat MT5';

  const baseExecutionNotes = encodeExecutionAdherenceNotes('AUTO', '');
  const compliance = evaluateTradeCompliance(
    {
      instrument: candidate.instrument,
      position: candidate.position,
      lotSize: candidate.lotSize,
      entryPrice: candidate.entryPrice,
      stopLoss: cleanSL,
      takeProfit: cleanTP,
      exitPrice: candidate.exitPrice,
      riskAmount: riskPreview.riskAmount,
      netProfit: normalizedNet,
      executionNotes: baseExecutionNotes || undefined,
    },
    settings
  );

  const closeExchangeRate = getCurrentUsdIdrSnapshot(getCachedUsdIdrRate());

  const activityLog = [
    createActivityEvent('TRADE_CREATED', 'Trade Logged via MT5 History Scan', {
      timestamp: nowIso,
      newValue: `${candidate.instrument} ${candidate.position} ${candidate.lotSize.toFixed(2)} Lot @ ${candidate.entryPrice}`,
    }),
    createActivityEvent('POSITION_OPENED', 'Position Opened (MT5)', {
      timestamp: entryTime,
      newValue: `Entry: ${candidate.entryPrice} (${candidate.lotSize.toFixed(2)} Lot)`,
    }),
    createActivityEvent('POSITION_CLOSED', `Position Closed (${candidate.closeType})`, {
      timestamp: exitTime,
      newValue: `Exit: ${candidate.exitPrice} · Net P/L: ${normalizedNet >= 0 ? '+' : ''}${normalizedNet.toFixed(2)}`,
    }),
  ];

  const lifecycleMeta: TradeLifecycleMeta = {
    status: 'CLOSED',
    orderType: 'Market',
    plannedEntry: candidate.entryPrice,
    plannedLot: candidate.lotSize,
    plannedStopLoss: cleanSL,
    plannedTakeProfit: cleanTP,
    plannedDateTime: entryTime,
    actualEntry: candidate.entryPrice,
    actualLot: candidate.lotSize,
    actualExit: candidate.exitPrice,
    entryTime,
    exitTime,
    closeType: candidate.closeType,
    closeExchangeRate,
    activityLog,
  };

  const finalExecutionNotes = encodeLifecycleMetaIntoExecutionNotes(
    baseExecutionNotes,
    lifecycleMeta
  );

  return {
    id: finalId,
    dateTime: journalDateTime,
    instrument: normalizeScanInstrument(candidate.instrument),
    position: candidate.position,
    strategy: candidate.strategy.trim() || 'MT5 History Scan',
    session: candidate.session || detectTradingSessionFromDateTime(entryTime),
    entryPrice: candidate.entryPrice,
    stopLoss: cleanSL,
    takeProfit: cleanTP,
    exitPrice: candidate.exitPrice,
    lotSize: candidate.lotSize,
    riskAmount: riskPreview.riskAmount,
    riskPercentage: riskPreview.riskPercentage,
    rMultiple: riskPreview.realizedR !== null ? riskPreview.realizedR : undefined,
    outcome,
    grossProfit,
    commission: normalizedComm,
    swap: normalizedSwap,
    netProfit: normalizedNet,
    screenshotUrl: undefined,
    notes: humanNote,
    disciplineRating: compliance.rating !== null ? compliance.rating : undefined,
    executionNotes: finalExecutionNotes || undefined,
    closeExchangeRate,
    isDemo: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

