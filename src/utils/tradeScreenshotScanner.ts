import {
  Trade,
  TradeCloseType,
  TradePosition,
  TradingSession,
} from '../types/trade';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { CHART_PREFS_STORAGE_KEY } from '../components/chart/MarketChartView';
import { getApiEndpointCandidates, nativeAwarePostJson } from './apiConfig';
import {
  classifyNetProfitOutcome,
  computeGrossFromNet,
  normalizeTradeDateTimeLocal,
} from './calculations';
import {
  evaluateTradeCompliance,
  encodeExecutionAdherenceNotes,
} from './complianceRating';
import {
  createActivityEvent,
  encodeLifecycleMetaIntoExecutionNotes,
  TradeLifecycleMeta,
} from './tradeLifecycle';
import {
  getCachedUsdIdrRate,
  getCurrentUsdIdrSnapshot,
} from './currencyRate';
import { getInstrumentPipSpec, validateSlTpDirection } from './riskCalculator';
import {
  preparePrecisionOcrVariants,
  runOfflineTesseractOcr,
} from './offlineMt5Ocr';

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

/**
 * Fetches an external image URL (including TradingView S3 snapshots) into a base64 Data URL.
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
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(imageUrl)}`;
      const proxyRes = await safeFetchApiJson(proxyUrl, { method: 'GET' }, 6500);
      const html = proxyRes.json?.contents || '';
      if (typeof html === 'string' && html.length > 0) {
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
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(pageUrl)}`;
      const proxyRes = await safeFetchApiJson(proxyUrl, { method: 'GET' }, 4500);
      const html = proxyRes.json?.contents || '';
      if (typeof html === 'string' && html.length > 0) {
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

  const candidateUrls = [
    targetImgUrl,
    `https://corsproxy.io/?${encodeURIComponent(targetImgUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetImgUrl)}`,
  ];

  for (const candidate of candidateUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);
      const res = await fetch(candidate, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const cType = (res.headers.get('content-type') || '').toLowerCase();
      if (cType.includes('text/html')) continue;
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
    const timer = setTimeout(() => controller.abort(), 9500);
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
  let lastServerError = '';
  for (const endpoint of scanEndpoints) {
    const serverRes = await nativeAwarePostJson(endpoint, payload, 55000);

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

  // PRIORITY 3: Real-Badge OCR (Online OCR.space -> Local On-Device Tesseract Offline OCR) + 2D Canvas Geometry
  let ocr: OcrExtractionResult = { fullText: '', lines: [], words: [] };
  if (dataUrlToAnalyze && !isNavigatorOffline) {
    ocr = await runOcrSpaceOnDataUrl(dataUrlToAnalyze);
  }
  if (dataUrlToAnalyze && !ocr.fullText.trim()) {
    try {
      const localOcr = await runOfflineTesseractOcr(dataUrlToAnalyze, { psm: '11' });
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
  closeType: TradeCloseType;
  notes: string;
  strategy: string;
  session: TradingSession;
  isDuplicate: boolean;
  duplicateMatchId?: string;
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

const MT5_SCAN_CACHE_STORAGE_KEY = 'tradevault_mt5_scan_cache_v1';
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
  options?: { allowOfflineCache?: boolean }
): Mt5CacheEntry | null {
  const now = Date.now();
  const allowOfflineCache = options?.allowOfflineCache ?? false;
  const candidateKeys = allowOfflineCache ? [`ai:${hash}`, `offline:${hash}`, hash] : [`ai:${hash}`, hash];

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
  const key = `${tier}:${hash}`;
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
  maxHeight = 3200,
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

function buildMt5Fingerprint(item: {
  ticketId?: string | null;
  instrument: string;
  position: TradePosition;
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  netProfit: number;
  closeDateTime?: string | null;
}): string {
  const cleanInst = normalizeScanInstrument(item.instrument);
  const lot = Number(item.lotSize || 0).toFixed(2);
  const entry = Number(item.entryPrice || 0).toFixed(4);
  const exit = Number(item.exitPrice || 0).toFixed(4);
  const net = Number(item.netProfit || 0).toFixed(2);
  const datePart = item.closeDateTime ? item.closeDateTime.slice(0, 10) : '';
  return `${cleanInst}|${item.position}|${lot}|${entry}|${exit}|${net}|${datePart}`;
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
    closeDateTime: string;
  },
  existingTrades: Trade[]
): string | null {
  if (!Array.isArray(existingTrades) || existingTrades.length === 0) return null;

  const candTicket = candidate.ticketId ? candidate.ticketId.trim() : '';
  const candInst = normalizeScanInstrument(candidate.instrument);
  const candDateDay = (candidate.closeDateTime || '').slice(0, 10);
  const priceTolerance =
    candInst === 'BTCUSD' || candInst === 'US30' || candInst === 'NAS100'
      ? 0.5
      : candInst === 'XAUUSD'
      ? 0.15
      : candInst.includes('JPY') || candInst === 'XAGUSD'
      ? 0.01
      : 0.00015;

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

    const tInst = normalizeScanInstrument(t.instrument);
    if (tInst !== candInst || t.position !== candidate.position) continue;

    const sameLot = Math.abs((t.lotSize || 0) - candidate.lotSize) < 0.005;
    const sameNet = Math.abs((t.netProfit || 0) - candidate.netProfit) < 0.05;
    const sameEntry = Math.abs((t.entryPrice || 0) - candidate.entryPrice) <= priceTolerance;
    const sameExit =
      t.exitPrice !== undefined &&
      t.exitPrice !== null &&
      Math.abs(t.exitPrice - candidate.exitPrice) <= priceTolerance;

    if (sameLot && sameNet && sameEntry && sameExit) {
      const tDay = (t.dateTime || '').slice(0, 10);
      if (!candDateDay || !tDay || tDay === candDateDay) {
        return t.id;
      }
    }
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
      closeDateTime: candidate.closeDateTime,
    },
    existingTrades
  );
  return {
    ...candidate,
    isDuplicate: Boolean(dupId),
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
      for (const cs of contractCandidates) {
        const expectedAbs = Math.abs(priceDiff * lot * cs);
        if (expectedAbs <= 0.01) continue;
        const ratio = absReported / expectedAbs;
        const relErr = ratio >= 1 ? ratio : 1 / ratio;
        if (relErr < minRelativeError) {
          minRelativeError = relErr;
        }
      }

      // Allow wide margin (6x) before flagging to avoid false alarms on cent/exotic broker specs
      if (Number.isFinite(minRelativeError) && minRelativeError >= 6.0) {
        issues.push({
          code: 'MAGNITUDE_MISMATCH',
          severity: 'warning',
          messageId: `Estimasi hasil dari (${lot.toFixed(2)} lot · ${entry}→${exit}) tampak jauh berbeda dari Profit ${netProfit.toFixed(2)} — pastikan lot, harga, & angka desimal benar.`,
          messageEn: `Estimated P/L from (${lot.toFixed(2)} lot · ${entry}→${exit}) differs strongly from Profit ${netProfit.toFixed(2)} — verify lot, prices & decimals.`,
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
  const closeDateTime =
    row.closeDateTime && row.closeDateTime.trim()
      ? normalizeTradeDateTimeLocal(row.closeDateTime)
      : row.openDateTime && row.openDateTime.trim()
      ? normalizeTradeDateTimeLocal(row.openDateTime)
      : options.fallbackNow;
  const openDateTime =
    row.openDateTime && row.openDateTime.trim()
      ? normalizeTradeDateTimeLocal(row.openDateTime)
      : null;

  const dupId = detectDuplicateMt5Trade(
    {
      ticketId: row.ticketId,
      instrument: row.instrument,
      position: row.position,
      lotSize: row.lotSize,
      entryPrice: row.entryPrice,
      exitPrice: row.exitPrice,
      netProfit: row.netProfit,
      closeDateTime,
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
    closeType: row.closeType,
    notes: row.notes,
    strategy: options.defaultStrategy,
    session: detectTradingSessionFromDateTime(openDateTime || closeDateTime),
    isDuplicate: Boolean(dupId),
    duplicateMatchId: dupId || undefined,
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

async function runMt5HistoryOcrFallback(imageDataUrl: string): Promise<RawNormalizedMt5Row[]> {
  if (!imageDataUrl.startsWith('data:image/')) return [];

  const variants = await preparePrecisionOcrVariants(imageDataUrl);
  const attempts: Array<{ img: string; psm: '3' | '6' }> = [
    { img: variants[0] || imageDataUrl, psm: '3' },
    { img: variants[0] || imageDataUrl, psm: '6' },
  ];
  if (variants[1]) {
    attempts.push({ img: variants[1], psm: '3' });
  }
  if (variants[0] !== imageDataUrl) {
    attempts.push({ img: imageDataUrl, psm: '3' });
  }

  let bestRows: ReturnType<typeof parseMt5HistoryRowsFromOcrText> = [];
  for (const attempt of attempts) {
    try {
      const ocr = await runOfflineTesseractOcr(attempt.img, { psm: attempt.psm });
      const parsed = parseMt5HistoryRowsFromOcrText(ocr.fullText);
      if (parsed.length > bestRows.length) {
        bestRows = parsed;
      }
      // Once we get clean multi-row / confident extraction on primary pass, skip redundant passes for speed
      if (bestRows.length >= 1 && ocr.confidence >= 68) {
        break;
      }
    } catch {
      // Try next variant / PSM pass
    }
  }

  return bestRows.map((r) => ({
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
    openDateTime: null,
    closeDateTime: r.closeDateTime,
    closeType: r.closeType,
    notes: r.notes,
    ocrSignRecovered: r.ocrSignRecovered,
  }));
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
      ? getCachedMt5ScanResult(hash, { allowOfflineCache: runOfflineOnly })
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
      const ocrRows = await runMt5HistoryOcrFallback(entry.item.imageDataUrl);
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
        outcomesMap.set(entry.item.sourceImageIndex, {
          sourceImageIndex: entry.item.sourceImageIndex,
          status: 'done',
          trades: mapped,
          fromCache: false,
          scanEngine: 'offline-ocr',
          modelUsed: 'offline-ocr-tesseract',
        });
      } else {
        outcomesMap.set(entry.item.sourceImageIndex, {
          sourceImageIndex: entry.item.sourceImageIndex,
          status: 'error',
          trades: [],
          fromCache: false,
          scanEngine: 'error',
          modelUsed: 'offline-ocr-tesseract',
          error:
            'Tidak ada baris transaksi MT5/MT4 yang terbaca secara offline. Pastikan teks posisi (contoh: XAUUSD, buy 0.10 dan 2640.00 -> 2650.00) terlihat tajam & penuh.',
        });
      }
    }
  } else {
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

      for (const endpoint of endpoints) {
        const res = await nativeAwarePostJson(endpoint, payload, chunk.length > 1 ? 58000 : 48000);
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

      // On-Device Offline OCR Fallback when backend AI failed/timed out/exhausted
      if (!chunkHandled) {
        for (const entry of chunk) {
          const ocrRows = await runMt5HistoryOcrFallback(entry.item.imageDataUrl);
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
            outcomesMap.set(entry.item.sourceImageIndex, {
              sourceImageIndex: entry.item.sourceImageIndex,
              status: 'done',
              trades: mapped,
              fromCache: false,
              scanEngine: 'offline-ocr',
              modelUsed: 'offline-ocr-tesseract',
            });
          } else {
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

export function parseMt5HistoryRowsFromOcrText(rawText: string): Array<{
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
  closeDateTime: string | null;
  closeType: TradeCloseType;
  notes: string;
  ocrSignRecovered: boolean;
}> {
  if (!rawText || !rawText.trim()) return [];
  // Normalize unicode dashes, arrow OCR variations (- >, = >, -=, »), and thin punctuation before splitting
  const normalizedRaw = rawText
    .replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-')
    .replace(/[→➜➔›»]/g, ' -> ')
    .replace(/(?:[-=~]\s*>|\s-=\s)/g, ' -> ');

  const lines = normalizedRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

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
    closeDateTime: string | null;
    closeType: TradeCloseType;
    notes: string;
    ocrSignRecovered: boolean;
  }> = [];

  const HEADER_REGEX =
    /(?:^|[\s|])([#A-Za-z0-9._/]{3,16})(?:\s*[,:;]\s*|\.\s+|\s+)(buy|sell|beli|jual)(?:\s+(?:in\/out|in|out))?(?:\s+(\d+(?:[.,]\d{1,2})?))?/i;

  const PRICE_TOKEN_PATTERN =
    '[0-9]{1,3}(?:\\.[0-9]{3})+,[0-9]{1,5}|[0-9]{1,3}(?:[ .][0-9]{3})+[.,][0-9]{1,5}|[0-9]{1,6}[.,][0-9]{1,5}';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip summary / balance ledger lines
    if (
      /^(?:profit|balance|deposit|credit|withdrawal|margin|equity|swap|commission)\s*:/i.test(line) ||
      /\b(?:balance|deposit|credit|withdrawal|canceled|cancelled)\b/i.test(line)
    ) {
      continue;
    }

    const headerMatch = line.match(HEADER_REGEX);
    if (!headerMatch) continue;

    const instrument = normalizeScanInstrument(headerMatch[1]);
    const dirRaw = headerMatch[2].toUpperCase();
    const position: TradePosition = dirRaw === 'SELL' || dirRaw === 'JUAL' ? 'SELL' : 'BUY';

    // Window spans up to 6 following lines until the next trade header or summary row appears
    const windowLines: string[] = [line];
    for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
      if (
        /^(?:profit|balance|deposit|credit|withdrawal|margin|equity)\s*:/i.test(lines[j]) ||
        HEADER_REGEX.test(lines[j])
      ) {
        break;
      }
      windowLines.push(lines[j]);
    }
    const windowText = windowLines.join(' ');

    // Lot size (either right after buy/sell or elsewhere on row)
    let lotSize = headerMatch[3]
      ? parseSignedMt5Number(headerMatch[3], false, 'EURUSD') || 0.01
      : 0.01;
    if (!headerMatch[3]) {
      const lotFallback = windowText.match(/\b(0\.\d{2}|[1-9]\d{0,2}[.,]\d{2})\b/);
      if (lotFallback) {
        const candLot = parseSignedMt5Number(lotFallback[1], false, 'EURUSD');
        if (candLot !== null && candLot >= 0.01 && candLot <= 100) lotSize = candLot;
      }
    }

    // Match "2615.40 -> 2602.10", "91 200.00 -> 90 800.00", "2615.40 > 2602.10", or "2615.40 - 2602.10"
    const arrowRegex = new RegExp(
      `(${PRICE_TOKEN_PATTERN})\\s*(?:->|>)\\s*(${PRICE_TOKEN_PATTERN})`
    );
    const dashArrowRegex = new RegExp(
      `(${PRICE_TOKEN_PATTERN})\\s+-\\s+(${PRICE_TOKEN_PATTERN})`
    );
    const arrowMatch = windowText.match(arrowRegex) || windowText.match(dashArrowRegex);

    let entryPrice: number | null = null;
    let exitPrice: number | null = null;
    let matchedPriceSpanToStrip = '';

    if (arrowMatch) {
      entryPrice = parseSignedMt5Number(arrowMatch[1], true, instrument);
      exitPrice = parseSignedMt5Number(arrowMatch[2], true, instrument);
      matchedPriceSpanToStrip = arrowMatch[0];
    } else {
      // Single-line Desktop MT5 table fallback: EntryPrice [SL TP] CloseDate ExitPrice [Comm Swap] NetProfit
      const afterHeader = line.slice((headerMatch.index || 0) + headerMatch[0].length);
      const desktopDt = afterHeader.match(
        /(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)/
      );
      if (desktopDt && desktopDt.index !== undefined) {
        const beforeDtPrices = extractPriceNumbersFromLine(
          afterHeader.slice(0, desktopDt.index),
          instrument
        );
        const afterDtPrices = extractPriceNumbersFromLine(
          afterHeader.slice(desktopDt.index + desktopDt[0].length),
          instrument
        );
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

    // DateTime (supports both YYYY.MM.DD and DD.MM.YYYY; prefers close time if multiple timestamps exist)
    const allDtMatches = Array.from(
      windowText.matchAll(
        /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s+(\d{1,2}:\d{2})|(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})\s+(\d{1,2}:\d{2})/g
      )
    );
    let closeDateTime: string | null = null;
    if (allDtMatches.length > 0) {
      const m = allDtMatches[allDtMatches.length - 1];
      if (m[1]) {
        closeDateTime = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(5, '0')}`;
      } else if (m[5]) {
        closeDateTime = `${m[7]}-${m[6].padStart(2, '0')}-${m[5].padStart(2, '0')}T${m[8].padStart(5, '0')}`;
      }
    }

    // Expanded details: SL / TP / Swap / Comm / Ticket (non-greedy single number token)
    const slMatch = windowText.match(/S\s*\/\s*L\s*[:=]?\s*((?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d+)?)/i);
    const tpMatch = windowText.match(/T\s*\/\s*P\s*[:=]?\s*((?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d+)?)/i);
    const swapMatch = windowText.match(/\bSwap\s*[:=]?\s*([+-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d+)?)/i);
    const commMatch = windowText.match(/(?:Commission|Fee)\s*[:=]?\s*([+-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d+)?)/i);
    const ticketMatch = windowText.match(/(?:ID\s*[:#]?|#)\s*(\d{5,14})\b/i);

    const stopLoss = slMatch ? parseSignedMt5Number(slMatch[1], true, instrument) : null;
    const takeProfit = tpMatch ? parseSignedMt5Number(tpMatch[1], true, instrument) : null;
    const swap = swapMatch ? parseSignedMt5Number(swapMatch[1], false, 'EURUSD') || 0 : 0;
    const commission = commMatch
      ? Math.abs(parseSignedMt5Number(commMatch[1], false, 'EURUSD') || 0)
      : 0;
    const ticketId = ticketMatch ? ticketMatch[1] : null;

    // Strip header (symbol + lot), arrow prices, dates, tickets, and SL/TP/Swap/Comm so profit regex stays exact
    let strippedForProfit = windowText.replace(headerMatch[0], ' ');
    if (matchedPriceSpanToStrip) {
      strippedForProfit = strippedForProfit.replace(matchedPriceSpanToStrip, ' ');
    }
    if (!arrowMatch) {
      // For desktop table rows, strip known entry/exit numbers too so profit isn't confused with prices
      strippedForProfit = strippedForProfit
        .replace(new RegExp(PRICE_TOKEN_PATTERN, 'g'), (tok) => {
          const val = parseSignedMt5Number(tok, true, instrument);
          if (
            val !== null &&
            (Math.abs(val - entryPrice!) < 1e-6 || Math.abs(val - exitPrice!) < 1e-6)
          ) {
            return ' ';
          }
          return tok;
        });
    }
    strippedForProfit = strippedForProfit
      .replace(/\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
      .replace(/\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
      .replace(/(?:ID\s*[:#]?|#)\s*\d{5,14}\b/gi, ' ')
      .replace(/(?:S\s*\/\s*L|T\s*\/\s*P|Swap|Commission|Fee)\s*[:=]?\s*[+-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d+)?/gi, ' ')
      .replace(/\(\s*([+-]?\s*\d[\d\s.,]*[.,]\d{2})\s*\)/g, ' -$1 ');

    const profitTokens =
      strippedForProfit.match(/(?:[+-]\s*)?(?:\d{1,3}(?:[ .]\d{3})+|\d+)[.,]\d{2}\b/g) || [];
    let netProfit = 0;
    if (profitTokens.length > 0) {
      const candidateStr = profitTokens[profitTokens.length - 1];
      const parsedPnl = parseSignedMt5Number(candidateStr, false, 'EURUSD');
      if (parsedPnl !== null) netProfit = parsedPnl;
    }

    // OCR Sign Recovery: if Entry -> Exit clearly moved into loss but OCR dropped thin red '-' sign
    const priceDelta = position === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
    let ocrSignRecovered = false;
    if (priceDelta < -1e-6 && netProfit > 0.35) {
      netProfit = -Math.abs(netProfit);
      ocrSignRecovered = true;
    }

    // Infer closeType from tags or SL/TP proximity
    let closeType: TradeCloseType = 'Manual';
    if (/\[\s*tp\s*\]|\/\s*tp\b/i.test(windowText)) {
      closeType = 'TP';
    } else if (/\[\s*sl\s*\]|\/\s*sl\b/i.test(windowText)) {
      closeType = 'SL';
    } else if (takeProfit && Math.abs(exitPrice - takeProfit) <= (instrument === 'XAUUSD' ? 0.65 : 0.0005)) {
      closeType = 'TP';
    } else if (stopLoss && Math.abs(exitPrice - stopLoss) <= (instrument === 'XAUUSD' ? 0.65 : 0.0005)) {
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
      closeDateTime,
      closeType,
      notes: 'Offline OCR',
      ocrSignRecovered,
    });
  }
  return results;
}

export function deduplicateBatchMt5Candidates(
  candidates: Mt5HistoryTradeCandidate[]
): Mt5HistoryTradeCandidate[] {
  const seenTickets = new Set<string>();
  const seenFingerprints = new Set<string>();
  const result: Mt5HistoryTradeCandidate[] = [];

  for (const cand of candidates) {
    if (cand.ticketId) {
      const tk = cand.ticketId.trim();
      if (seenTickets.has(tk)) continue;
      seenTickets.add(tk);
    }
    const fp = buildMt5Fingerprint(cand);
    if (seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);
    result.push(cand);
  }
  return result;
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

  const entryTime = normalizeTradeDateTimeLocal(candidate.openDateTime || candidate.closeDateTime);
  const exitTime = normalizeTradeDateTimeLocal(candidate.closeDateTime);
  const cleanSL =
    candidate.stopLoss !== null && candidate.stopLoss > 0 ? candidate.stopLoss : undefined;
  const cleanTP =
    candidate.takeProfit !== null && candidate.takeProfit > 0 ? candidate.takeProfit : undefined;

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
      riskAmount: 0,
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
    dateTime: exitTime,
    instrument: normalizeScanInstrument(candidate.instrument),
    position: candidate.position,
    strategy: candidate.strategy.trim() || 'MT5 History Scan',
    session: candidate.session || detectTradingSessionFromDateTime(entryTime),
    entryPrice: candidate.entryPrice,
    stopLoss: cleanSL,
    takeProfit: cleanTP,
    exitPrice: candidate.exitPrice,
    lotSize: candidate.lotSize,
    riskAmount: 0,
    riskPercentage: 0,
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

