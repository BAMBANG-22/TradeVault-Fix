import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  MacroCalendarEvent,
  IntermarketAssetPulse,
  VixRiskPulse,
  GoldPositioningPulse,
  BreakingNewsHeadline,
  CmeFedWatchState,
  MacroNewsSnapshot,
  RssFeedHealthStatus,
  RssFeedSourceStatus,
  XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION,
  parseMacroNumeric,
  classifyFomcPillar,
  isInverseUsdIndicator,
  isRelevantUsdMacroEvent,
  isPrimaryHighImpactEvent,
  isFedSpeechEvent,
  getSupportingContextEvents,
  evaluateSingleEventForGold,
  filterAndScoreBreakingHeadlines,
  createUnavailableFedWatchState,
  evaluateCmeFedWatchScoring,
  computeImpliedFedWatchFromMarketQuotes,
  getUpcomingFomcMeetingInfo,
  computeDeterministicMacroSnapshot,
  computeDualHorizonAnalysis,
  isSnapshotFresh,
  mapRawTradingViewEventsToCalendarEvents,
  ExtendedMarketAssetPulse,
  CftcCotGoldState,
  ExternalG10ChinaEvent,
  FundamentalExtendedFeeds,
  FundamentalGoldSnapshot,
  extractExternalG10AndChinaCalendarEvents,
  computeFundamentalGoldSnapshot,
} from './src/utils/macroNewsEngine';
import { isMarketDay } from './src/utils/date';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware for parsing large JSON / base64 payloads & CORS for standalone mobile APK
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, Pragma');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

/**
 * Strictly isolated API key resolver for Scan Kilat (Opsi 1: MT5 History & Opsi 2: Individual MT5/TradingView).
 * Reads ONLY `GEMINI_SCAN_API_KEY` and `GEMINI_API_KEY` (never `GEMINI_NEWS_API_KEY`).
 */
function getScannerGeminiApiKeys(): string[] {
  const raw = [process.env.GEMINI_SCAN_API_KEY || '', process.env.GEMINI_API_KEY || '']
    .join(',')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

/**
 * Strictly isolated API key resolver for Trade News & Macro Analysis.
 * Reads ONLY `GEMINI_NEWS_API_KEY` — NEVER falls back to `GEMINI_API_KEY` so Trade News
 * can never consume or exhaust the Scan Kilat quota.
 */
function getNewsGeminiApiKeys(): string[] {
  const raw = (process.env.GEMINI_NEWS_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

/**
 * Progressive AI Vision model cascade for Scan Kilat (both Opsi 1 & Opsi 2):
 * Starts with Gemini Hydrogen (`gemini-4-hydrogen`), and automatically steps down
 * to lower/lighter versions if quota is exhausted (`429` / `RESOURCE_EXHAUSTED`).
 */
const SCANNER_MODEL_CASCADE = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

const MT5_HISTORY_MODEL_CASCADE = [
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
] as const;

const NEWS_MODEL_CASCADE = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

function isGeminiQuotaError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status || err?.statusCode || 0);
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('limit exceeded')
  );
}

function isGeminiModelUnavailableError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status || err?.statusCode || 0);
  return (
    status === 404 ||
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('is not supported') ||
    msg.includes('unsupported model')
  );
}

function sanitizeGeminiErrMsg(err: any): string {
  return String(err?.message || err || 'Unknown error')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_KEY]')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyGeminiFailure(err: any): {
  code: 'KEY_INVALID' | 'QUOTA_429' | 'MODEL_404' | 'BAD_REQUEST_400' | 'SERVER_503' | 'TIMEOUT' | 'EMPTY_RESPONSE' | 'UNKNOWN';
  summary: string;
} {
  const raw = sanitizeGeminiErrMsg(err);
  const msg = raw.toLowerCase();
  const status = Number(err?.status || err?.statusCode || 0);

  if (
    status === 401 ||
    status === 403 ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('permission_denied') ||
    msg.includes('unauthenticated')
  ) {
    return { code: 'KEY_INVALID', summary: `KEY_INVALID: ${raw.slice(0, 90)}` };
  }
  if (isGeminiQuotaError(err)) {
    return { code: 'QUOTA_429', summary: `QUOTA_429: ${raw.slice(0, 90)}` };
  }
  if (isGeminiModelUnavailableError(err)) {
    return { code: 'MODEL_404', summary: `MODEL_404: ${raw.slice(0, 90)}` };
  }
  if (msg.includes('timed out') || msg.includes('abort')) {
    return { code: 'TIMEOUT', summary: `TIMEOUT: ${raw.slice(0, 90)}` };
  }
  if (
    status === 503 ||
    status === 500 ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('high demand')
  ) {
    return { code: 'SERVER_503', summary: `SERVER_503: ${raw.slice(0, 90)}` };
  }
  if (status === 400 || msg.includes('invalid_argument')) {
    return { code: 'BAD_REQUEST_400', summary: `BAD_REQUEST_400: ${raw.slice(0, 90)}` };
  }
  return { code: 'UNKNOWN', summary: raw.slice(0, 90) };
}

function buildScanFailureResponse(
  failures: Array<{ model: string; code: string; summary: string }>,
  isMt5History: boolean
): { success: false; quotaExhausted: boolean; error: string; diagnostics: string[] } {
  const diagnostics = failures.map((f) => `${f.model} -> ${f.summary}`);
  const shortDiag = failures
    .slice(0, 5)
    .map((f) => `${f.model}: ${f.code}`)
    .join(', ');
  const diagSuffix = shortDiag ? ` [${shortDiag}]` : '';
  const hasKeyInvalid = failures.some((f) => f.code === 'KEY_INVALID');
  const hasQuota429 = failures.some((f) => f.code === 'QUOTA_429');
  const allNonUnsupportedWereQuota =
    hasQuota429 && failures.every((f) => f.code === 'QUOTA_429' || f.code === 'MODEL_404');
  const hasServerOrTimeout = failures.some((f) => f.code === 'TIMEOUT' || f.code === 'SERVER_503');
  const hasOnlyUnsupported =
    failures.length > 0 && failures.every((f) => f.code === 'MODEL_404' || f.code === 'BAD_REQUEST_400');

  if (hasKeyInvalid) {
    return {
      success: false,
      quotaExhausted: false,
      error: `API Key Gemini Scan Kilat tidak valid atau tidak memiliki izin akses. Periksa GEMINI_SCAN_API_KEY / GEMINI_API_KEY di server.${diagSuffix}`,
      diagnostics,
    };
  }
  if (allNonUnsupportedWereQuota) {
    return {
      success: false,
      quotaExhausted: true,
      error: isMt5History
        ? `Kuota AI Scan Kilat penuh sementara (HTTP 429). Jika GEMINI_SCAN_API_KEY dan GEMINI_NEWS_API_KEY dibuat di 1 project Google Cloud yang sama, pisahkan ke 2 project berbeda agar kuota harian tidak terbagi.${diagSuffix}`
        : `Batas kuota harian tier gratis tercapai sementara (HTTP 429); beralih otomatis ke pemindai geometri kanvas & OCR.${diagSuffix}`,
      diagnostics,
    };
  }
  if (hasOnlyUnsupported) {
    return {
      success: false,
      quotaExhausted: false,
      error: `Model AI Scan Kilat tidak didukung oleh API Key saat ini. Pastikan Gemini API aktif di Google Cloud Project key tersebut.${diagSuffix}`,
      diagnostics,
    };
  }
  if (hasServerOrTimeout) {
    return {
      success: false,
      quotaExhausted: false,
      error: isMt5History
        ? `Server AI Gemini sedang sibuk atau lambat merespons (timeout). Silakan coba pindai lagi beberapa saat lagi.${diagSuffix}`
        : `Server AI Gemini timeout sementara; beralih otomatis ke pemindai geometri kanvas & OCR.${diagSuffix}`,
      diagnostics,
    };
  }
  return {
    success: false,
    quotaExhausted: hasQuota429,
    error: isMt5History
      ? `Scan Kilat MT5 belum menerima respons dari AI. Silakan coba lagi.${diagSuffix}`
      : `Pemindai AI gagal merespons; beralih otomatis ke pemindai geometri kanvas & OCR.${diagSuffix}`,
    diagnostics,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function withTimeoutAbort<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    fn(controller.signal).then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Standalone healthcheck endpoint for APK & external server verification
app.get('/api/health', (_req, res) => {
  const scannerKeys = getScannerGeminiApiKeys();
  const newsKeys = getNewsGeminiApiKeys();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.json({
    ok: true,
    service: 'tradevault-standalone-backend',
    geminiConfigured: Boolean(scannerKeys.length > 0 || newsKeys.length > 0),
    scannerGeminiConfigured: scannerKeys.length > 0,
    newsGeminiConfigured: newsKeys.length > 0,
    apiKeysStrictlySeparated: true,
    scannerModelCascade: SCANNER_MODEL_CASCADE,
    isMarketOpen: isMarketOpenToday(),
    timestamp: new Date().toISOString(),
  });
});

function isMarketOpenToday(): boolean {
  return isMarketDay(new Date(), { useUtc: true, enforceFridayCloseUtc: true });
}

const ALLOWED_PROXY_DOMAINS = [
  'faireconomy.media',
  'yahoo.com',
  'financialjuice.com',
  'cnbc.com',
  'dowjones.io',
  'fxstreet.com',
  'news.google.com',
  'twelvedata.com',
  'er-api.com',
  'frankfurter.app',
  'investing.com',
  'cmegroup.com',
  'tradingview.com',
  'forexlive.com',
  'reuters.com',
  'marketwatch.com',
  'dailyfx.com',
  'exchangerate-api.com',
  'stooq.com',
  'stlouisfed.org',
  'treasury.gov',
];

function isAllowedProxyTargetUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_PROXY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// Resilient backend proxy endpoint for public financial feeds
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target url parameter' });
  }
  if (!isAllowedProxyTargetUrl(targetUrl)) {
    return res.status(403).json({ error: 'Target domain is not in the allowed financial feeds list' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const upstreamRes = await fetch(targetUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, text/xml, application/rss+xml, */*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await upstreamRes.text();
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(upstreamRes.status).send(text);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Proxy fetch failed' });
  }
});

interface ExtractScreenshotRequest {
  imageBase64?: string;
  imageUrl?: string;
  canvasHints?: {
    hasPositionBox?: boolean;
    inferredPosition?: 'BUY' | 'SELL' | null;
    inferredRR?: number | null;
    entryYRatio?: number | null;
    tpYRatio?: number | null;
    slYRatio?: number | null;
    boxTopYRatio?: number | null;
    boxBottomYRatio?: number | null;
    profitTheme?: 'GREEN' | 'BLUE_NAVY' | null;
    riskTheme?: 'RED' | 'GREY_SLATE' | null;
    rightAxisGreenBadgeYRatio?: number | null;
    rightAxisRedBadgeYRatio?: number | null;
    rightAxisBlueOrDarkBadgeYRatio?: number | null;
  } | null;
}

/**
 * Fetch an image from an external URL (handles TradingView snapshot redirects/pages)
 */
async function fetchImageBufferFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const parsedUrl = new URL(url);

  // Fast-path: TradingView /x/<ID>/ shortlink maps directly to s3.tradingview.com/snapshots/<firstChar>/<ID>.png
  if (parsedUrl.hostname.toLowerCase().includes('tradingview.com')) {
    const xMatch = parsedUrl.pathname.match(/\/x\/([A-Za-z0-9]+)\/?/i);
    if (xMatch && xMatch[1]) {
      const id = xMatch[1];
      const directS3Url = `https://s3.tradingview.com/snapshots/${id.charAt(0).toLowerCase()}/${id}.png`;
      const s3Res = await fetch(directS3Url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      });
      if (s3Res.ok) {
        const s3Mime = s3Res.headers.get('content-type') || 'image/png';
        const arrayBuf = await s3Res.arrayBuffer();
        return { buffer: Buffer.from(arrayBuf), mimeType: s3Mime.split(';')[0] };
      }
    }
  }

  // If user pasted a TradingView share link (e.g. https://www.tradingview.com/x/abcd/)
  const res = await fetch(parsedUrl.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Gagal mengunduh gambar dari URL (Status ${res.status})`);
  }

  const contentType = res.headers.get('content-type') || '';

  // If HTML returned (e.g. TradingView preview page), scrape og:image
  if (contentType.includes('text/html')) {
    const htmlText = await res.text();
    const ogImageMatch =
      htmlText.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
      htmlText.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
      htmlText.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);

    if (ogImageMatch && ogImageMatch[1]) {
      const realImageUrl = ogImageMatch[1];
      const imgRes = await fetch(realImageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'image/*',
        },
      });
      if (!imgRes.ok) {
        throw new Error(`Gagal mengambil gambar snapshot TradingView dari ${realImageUrl}`);
      }
      const imgMime = imgRes.headers.get('content-type') || 'image/png';
      const arrayBuf = await imgRes.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mimeType: imgMime.split(';')[0] };
    } else {
      throw new Error('URL tidak mengarah langsung ke gambar ataupun snapshot TradingView yang valid.');
    }
  }

  const mimeType = contentType.split(';')[0] || 'image/png';
  const arrayBuf = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuf), mimeType };
}

/**
 * Bulletproof multi-stage JSON parser for AI vision output.
 * Prevents SyntaxError when LLM outputs unescaped quotes, trailing characters, or partial tokens.
 */

function parseNumericValue(
  val: any,
  instrument = 'XAUUSD',
  options?: { isPrice?: boolean }
): number | null {
  const isPrice = options?.isPrice ?? true;
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    if (isNaN(val) || !Number.isFinite(val)) return null;
    if (isPrice && instrument === 'XAUUSD' && val >= 1.5 && val <= 6.5) {
      return Number((val * 1000).toFixed(3));
    }
    return val;
  }
  if (typeof val === 'string') {
    let s = val.trim();
    if (!s) return null;

    // Normalize Unicode minus / dashes (e.g. "−45.20", "–45.20") to ASCII '-' before filtering
    s = s.replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-');

    const contextualMatch = s.match(
      /(?:at|@|entry[:\s]|open[:\s]|price[:\s]|level[:\s])\s*([+-]?[0-9][0-9., ]+)/i
    );
    if (contextualMatch) {
      s = contextualMatch[1].trim();
    }

    const isParenNeg = /^\(.*\)$/.test(s) && !s.startsWith('(-');
    s = s.replace(/[^0-9.,+\- ]/g, '').trim();
    if (!s) return null;

    // Collapse space directly after sign (e.g. "- 45.20" -> "-45.20")
    s = s.replace(/^([+-])\s+(?=\d)/, '$1');

    // Format X.XXX,XXX or X XXX,XXX (Dot/Space thousands, Comma decimal e.g. "4.054,405", "-1 234,50")
    if (/^[+-]?\d{1,3}(?:[.\s]\d{3})+,\d+$/.test(s)) {
      s = s.replace(/[.\s]/g, '').replace(',', '.');
    } else if (/^[+-]?\d{1,3}(?:[ ,\s]\d{3})+\.\d+$/.test(s)) {
      // Format X,XXX.XX or X XXX.XX (Comma/Space thousands, Dot decimal)
      s = s.replace(/[ ,\s]/g, '');
    } else if (s.includes('.') && s.includes(',')) {
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      if (lastComma > lastDot) {
        s = s.replace(/[.\s]/g, '').replace(',', '.');
      } else {
        s = s.replace(/[,\s]/g, '');
      }
    } else if (s.includes(',') && !s.includes('.')) {
      s = s.replace(/\s+/g, '').replace(',', '.');
    } else if ((s.match(/\./g) || []).length >= 2) {
      const lastDot = s.lastIndexOf('.');
      s = s.slice(0, lastDot).replace(/[.\s]/g, '') + '.' + s.slice(lastDot + 1).replace(/\s+/g, '');
    } else {
      s = s.replace(/\s+/g, '');
    }

    let num = parseFloat(s);
    if (isNaN(num) || !Number.isFinite(num)) return null;
    if (isParenNeg && num > 0) {
      num = -num;
    }
    if (isPrice && instrument === 'XAUUSD' && num >= 1.5 && num <= 6.5) {
      return Number((num * 1000).toFixed(3));
    }
    return num;
  }
  return null;
}

function normalizeInstrument(raw: string | null | undefined): string {
  if (!raw) return 'XAUUSD';
  let s = raw.toUpperCase().trim();
  if (!s || s === 'NULL' || s === 'NONE' || s === 'UNKNOWN' || s === 'UNDEFINED' || s === 'N/A' || s === '-') {
    return 'XAUUSD';
  }

  // Strip tradingview exchange prefixes (e.g. BINANCE:BTCUSD -> BTCUSD, FX:EURUSD -> EURUSD)
  if (s.includes(':')) {
    s = s.split(':').pop() || s;
  }

  // Handle common commodities / indices / cryptos
  if (s.includes('GOLD') || s.startsWith('XAU')) return 'XAUUSD';
  if (s.includes('BITCOIN') || s.startsWith('BTC')) return 'BTCUSD';
  if (s.includes('ETHER') || s.startsWith('ETH')) return 'ETHUSD';
  if (s.includes('SOLANA') || s.startsWith('SOL')) return 'SOLUSD';
  if (s.includes('DOW') || s.includes('DJI') || s.includes('US30')) return 'US30';
  if (s.includes('NAS') || s.includes('USTEC') || s.includes('NDX')) return 'NAS100';
  if (s.includes('SPX') || s.includes('US500') || s.includes('S&P')) return 'SPX500';
  if (s.includes('DAX') || s.includes('GER40') || s.includes('DE40')) return 'GER40';

  // Recognized Forex Pairs (direct match before stripping suffixes)
  const KNOWN_FOREX = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
    'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
    'EURAUD', 'EURCAD', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDCAD', 'AUDNZD',
    'CADCHF', 'NZDCAD', 'NZDCHF'
  ];
  for (const pair of KNOWN_FOREX) {
    if (s.includes(pair)) return pair;
  }

  // Strip broker suffixes (.m, .raw, .pro, .std, .ecn, _i, _sb, _c)
  s = s.replace(/(\.M|\.RAW|\.PRO|\.STD|\.ECN|\.B|_I|_SB|_C)$/i, '');
  if (s.length > 6 && (s.endsWith('C') || s.endsWith('M'))) {
    s = s.slice(0, -1);
  }
  s = s.replace(/[^A-Z0-9]/g, '');

  return s || 'XAUUSD';
}

function parseAiJsonResponse(text: string): Record<string, any> {
  if (!text || typeof text !== 'string') return {};

  // 1. Direct JSON parse attempt
  try {
    return JSON.parse(text);
  } catch {}

  // 2. Strip code fences (```json ... ```)
  const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {}

  // 3. Extract the first { ... } block
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = clean.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  // 4. Try auto-closing open brackets/quotes if truncated
  let repaired = clean.trim();
  repaired = repaired.replace(/,\s*$/, '').replace(/:\s*$/, '');
  if (!repaired.endsWith('}')) {
    repaired += '}';
  }
  try {
    return JSON.parse(repaired);
  } catch {}

  // 5. Ultimate Fallback: Deterministic Regex Token Extractor (100% resilient)
  console.warn('[AI Vision] JSON parsing required regex fallback recovery for payload snippet:', clean.slice(0, 150));
  const extractStr = (key: string): string | null => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\r\\n]*)"`, 'i'));
    return m ? m[1].trim() : null;
  };
  const inst = normalizeInstrument(extractStr('instrument'));
  const extractNum = (key: string): number | null => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"?([^",}\\r\\n]+)"?`, 'i'));
    if (m) {
      return parseNumericValue(m[1], inst);
    }
    return null;
  };
  const extractBool = (key: string): boolean => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i'));
    return m ? m[1].toLowerCase() === 'true' : true;
  };

  return {
    detected: extractBool('detected'),
    source: extractStr('source') || 'MT5',
    instrument: inst,
    position: (extractStr('position') || 'BUY').toUpperCase(),
    lotSize: extractNum('lotSize'),
    entryPrice: extractNum('entryPrice'),
    stopLoss: extractNum('stopLoss'),
    takeProfit: extractNum('takeProfit'),
    exitPrice: extractNum('exitPrice'),
    profit: extractNum('profit'),
    plannedRiskReward: extractNum('plannedRiskReward'),
    timeframe: extractStr('timeframe'),
    currentPrice: extractNum('currentPrice'),
    status: extractStr('status') || 'PLANNED',
    notes: extractStr('notes') || '',
  };
}

const quotaCooldownUntilByModel = new Map<
  string,
  { code: 'QUOTA_429' | 'MODEL_404'; until: number }
>();

function buildScannerGeometryHintBlock(canvasHints?: ExtractScreenshotRequest['canvasHints']): string {
  if (!canvasHints || typeof canvasHints !== 'object') return '';
  const lines: string[] = [];

  if (canvasHints.hasPositionBox) {
    lines.push(
      `- TradingView ${canvasHints.inferredPosition || 'BUY/SELL'} Position Box detected (${
        canvasHints.profitTheme === 'BLUE_NAVY' ? 'Dark Blue/Navy Profit' : 'Green Profit'
      } & ${canvasHints.riskTheme === 'GREY_SLATE' ? 'Grey/Slate Risk' : 'Red Risk'}):`
    );
    lines.push(
      `  * Verified Direction: ${canvasHints.inferredPosition || 'UNKNOWN'} (${
        canvasHints.inferredPosition === 'SELL'
          ? 'Risk Zone is at TOP, Profit Zone is at BOTTOM -> SELL (takeProfit < entryPrice < stopLoss)'
          : 'Profit Zone is at TOP, Risk Zone is at BOTTOM -> BUY (stopLoss < entryPrice < takeProfit)'
      })`
    );
    if (canvasHints.boxTopYRatio != null) {
      lines.push(
        `  * Box TOP edge (${canvasHints.inferredPosition === 'SELL' ? 'STOP LOSS' : 'TAKE PROFIT'}): vertical Y = ${(
          Number(canvasHints.boxTopYRatio) * 100
        ).toFixed(1)}% from top`
      );
    }
    if (canvasHints.entryYRatio != null) {
      lines.push(
        `  * Box CENTRAL divider (ENTRY PRICE): vertical Y = ${(
          Number(canvasHints.entryYRatio) * 100
        ).toFixed(1)}% from top`
      );
    }
    if (canvasHints.boxBottomYRatio != null) {
      lines.push(
        `  * Box BOTTOM edge (${canvasHints.inferredPosition === 'SELL' ? 'TAKE PROFIT' : 'STOP LOSS'}): vertical Y = ${(
          Number(canvasHints.boxBottomYRatio) * 100
        ).toFixed(1)}% from top`
      );
    }
    if (canvasHints.tpYRatio != null) {
      lines.push(
        `  * Exact Take Profit Y-level: ${(Number(canvasHints.tpYRatio) * 100).toFixed(1)}% from top`
      );
    }
    if (canvasHints.slYRatio != null) {
      lines.push(
        `  * Exact Stop Loss Y-level: ${(Number(canvasHints.slYRatio) * 100).toFixed(1)}% from top`
      );
    }
  }

  const badgeHints: string[] = [];
  if (canvasHints.rightAxisGreenBadgeYRatio != null) {
    badgeHints.push(
      `Green badge at Y = ${(Number(canvasHints.rightAxisGreenBadgeYRatio) * 100).toFixed(1)}%`
    );
  }
  if (canvasHints.rightAxisRedBadgeYRatio != null) {
    badgeHints.push(
      `Red badge at Y = ${(Number(canvasHints.rightAxisRedBadgeYRatio) * 100).toFixed(1)}%`
    );
  }
  if (canvasHints.rightAxisBlueOrDarkBadgeYRatio != null) {
    badgeHints.push(
      `Blue/Navy badge at Y = ${(Number(canvasHints.rightAxisBlueOrDarkBadgeYRatio) * 100).toFixed(1)}%`
    );
  }
  if (badgeHints.length > 0) {
    lines.push(
      `- Right-hand Y-axis colored price badge positions (remember: smaller Y% = HIGHER price on chart, larger Y% = LOWER price on chart):`
    );
    for (const bh of badgeHints) {
      lines.push(`  * ${bh}`);
    }
  }

  if (lines.length === 0) return '';
  return `\nPIXEL GEOMETRY SCANNER HINTS (VERIFIED FROM IMAGE PIXELS):\n${lines.join('\n')}\n`;
}

// AI Vision Endpoint: Extract trade data from chart screenshot
app.post('/api/extract-trade-screenshot', async (req, res) => {
  try {
    const { imageBase64, imageUrl, canvasHints } = req.body as ExtractScreenshotRequest;

    if (!imageBase64 && !imageUrl) {
      res.status(400).json({
        success: false,
        error: 'Harap sertakan imageBase64 atau imageUrl.',
      });
      return;
    }

    const scannerApiKeys = getScannerGeminiApiKeys();

    if (scannerApiKeys.length === 0) {
      res.status(400).json({
        success: false,
        error:
          'GEMINI_API_KEY (khusus Scan Kilat) belum dikonfigurasi di environment server.',
      });
      return;
    }

    let mimeType = 'image/jpeg';
    let base64Data = '';

    if (imageBase64) {
      const trimmedInput = imageBase64.trim();
      const match = trimmedInput.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,([\s\S]+)$/i);
      if (match) {
        const rawMime = match[1].toLowerCase();
        mimeType =
          rawMime === 'image/png'
            ? 'image/png'
            : rawMime === 'image/webp'
            ? 'image/webp'
            : 'image/jpeg';
        base64Data = match[2].replace(/\s+/g, '');
      } else {
        base64Data = trimmedInput.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
      }
    } else if (imageUrl) {
      const fetched = await fetchImageBufferFromUrl(imageUrl);
      const rawMime = (fetched.mimeType || 'image/jpeg').toLowerCase();
      mimeType =
        rawMime === 'image/png'
          ? 'image/png'
          : rawMime === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg';
      base64Data = fetched.buffer.toString('base64');
    }

    const geometryHintBlock = buildScannerGeometryHintBlock(canvasHints);

    const prompt = `You are an elite financial chart & order OCR specialist for MetaTrader 5 (MT5 / MT4) and TradingView.
Carefully inspect the FULL screenshot from the left edge to the rightmost Y-axis price scale before outputting any number.
Remember: smaller Y% (closer to top of image) = HIGHER price; larger Y% (closer to bottom of image) = LOWER price.
${geometryHintBlock}
1. SPATIAL VISUAL RULES FOR METATRADER 5 (MT5 / MT4):
   - A) CHART VIEW:
     * Read EVERY text label at the LEFT edge of the chart: "TP", "SL", "BUY LIMIT", "SELL LIMIT", "BUY STOP", "SELL STOP", "BUY", "SELL", "BELI", "JUAL" (for example: "TP", "BUY LIMIT 0.12", "SL").
     * Trace each label's exact horizontal dashed/dotted line straight across to the RIGHTMOST Y-AXIS, and extract ONLY the exact price inside the BORDERED / OUTLINED BOX or COLORED TAG sitting ON that exact horizontal line.
     * IGNORE plain unbordered Y-axis tick grid numbers (like "4052.92" or "4030.42").
     * IGNORE the running live candle price badge (often has a bar countdown timer like "00:50" or "04:12") — put that ONLY in currentPrice, NEVER in entryPrice, stopLoss, or takeProfit unless an Entry dashed line is literally at that exact price!
     * STATUS RULE: If the order label contains "LIMIT" or "STOP", set status = "PLANNED". If it says "BUY 0.10" or "SELL 0.10" (without LIMIT/STOP), set status = "ACTIVE".
   - B) MT5 TRADE / HISTORY LIST VIEW (if screenshot shows one or more MT5 trade/history rows instead of candles):
     * Format like "XAUUSD, buy 0.10" or "XAUUSD, beli 0.10" or "XAUUSD, sell 0.05" / "jual 0.05", "2650.12 -> 2662.30", with profit on the right (e.g. "121.80" or "-45.00") and optional "S / L:" and "T / P:" below.
     * Extract: source = "MT5", instrument = symbol (strip suffixes like m/c/pro), position = "BUY" (for buy/beli) or "SELL" (for sell/jual), lotSize = lot number, entryPrice = number BEFORE "->", exitPrice = number AFTER "->", profit = right-side profit number, stopLoss = S/L value (null if 0 or "-" or absent), takeProfit = T/P value (null if 0 or "-" or absent), status = "CLOSED" (if from history / closed position) or "ACTIVE" (if open position).

2. SPATIAL VISUAL RULES FOR TRADINGVIEW CHARTS:
   - Identify the Position Tool's two vertically-adjacent shaded rectangles (either Green/Red OR Dark Blue-Navy/Dark Grey-Slate).
   - IGNORE inner chart labels ("OB m5", "FVG", "BOS", "Liquidity") and IGNORE bottom sub-indicator panels (RSI / MACD / Stochastic scales like 0..100).
   - IGNORE the live running candle price badge (put ONLY in currentPrice).
   - Read the exact Y-axis price tags aligned with:
     (1) TOP outer border of the top zone,
     (2) CENTRAL horizontal dividing line between the two zones (Entry Price),
     (3) BOTTOM outer border of the bottom zone.
   - Direction Rule:
     * Profit Zone (Green or Blue/Navy) at TOP + Risk Zone (Red or Grey/Slate) at BOTTOM => position = "BUY" (stopLoss < entryPrice < takeProfit).
     * Risk Zone (Red or Grey/Slate) at TOP + Profit Zone (Green or Blue/Navy) at BOTTOM => position = "SELL" (takeProfit < entryPrice < stopLoss).
   - NUMBER FORMAT NORMALIZATION: Convert European/Indonesian format like "4.054,405" or "4.099,857" -> 4054.405 and 4099.857.
   - LOT SIZE ON TRADINGVIEW: Always return null for lotSize on TradingView.

3. STRICT GROUNDING & ZERO HALLUCINATION:
   - First populate leftEdgeLabels and rightAxisPriceTags verbatim from what you visually see from top to bottom, THEN assign entryPrice, stopLoss, and takeProfit consistently.
   - NEVER invent, round roughly, or compute synthetic offsets. If a price tag is obscured or absent, return null for that field.`;

    const candidateModels = SCANNER_MODEL_CASCADE;
    let responseText = '';
    let usedModel = '';
    const scanCascadeStartMs = Date.now();
    const MAX_SCAN_WALL_MS = 45_000;
    const scanFailures: Array<{ model: string; code: string; summary: string }> = [];

    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0) {
        const shouldRetryTransient = scanFailures.some(
          (f) => f.code === 'SERVER_503' || f.code === 'TIMEOUT'
        );
        const remainingBeforePass = MAX_SCAN_WALL_MS - (Date.now() - scanCascadeStartMs);
        if (!shouldRetryTransient || remainingBeforePass < 5000) break;
        await new Promise((r) => setTimeout(r, 1200));
      }

      for (const model of candidateModels) {
        if (MAX_SCAN_WALL_MS - (Date.now() - scanCascadeStartMs) < 2500) break;
        for (let keyIdx = 0; keyIdx < scannerApiKeys.length; keyIdx++) {
          const remainingWallMs = MAX_SCAN_WALL_MS - (Date.now() - scanCascadeStartMs);
          if (remainingWallMs < 2500) break;
          const cooldownKey = `${keyIdx}:${model}`;
          const cooldownEntry = quotaCooldownUntilByModel.get(cooldownKey);
          if (cooldownEntry && Date.now() < cooldownEntry.until) {
            scanFailures.push({
              model,
              code: cooldownEntry.code,
              summary: 'Cooldown cache active',
            });
            continue;
          }

          const ai = new GoogleGenAI({
            apiKey: scannerApiKeys[keyIdx],
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              },
              retryOptions: { attempts: 1 },
            },
          });

          try {
            const response = await withTimeoutAbort(
              (abortSignal) =>
                ai.models.generateContent({
                  model,
                  contents: [
                    {
                      inlineData: {
                        mimeType,
                        data: base64Data,
                      },
                    },
                    prompt,
                  ],
                  config: {
                    abortSignal,
                    ...(model === 'gemini-4-hydrogen'
                      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                      : {}),
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        detected: { type: Type.BOOLEAN, description: 'True if trade setup or order is detected' },
                        source: { type: Type.STRING, description: 'MT5, TRADINGVIEW, or CHART' },
                        instrument: { type: Type.STRING, description: 'Clean instrument symbol, e.g. XAUUSD, EURUSD, GBPUSD, USDJPY, BTCUSD, US30, NAS100' },
                        leftEdgeLabels: { type: Type.STRING, description: 'Verbatim order/line labels on left edge (e.g. "TP, BUY LIMIT 0.12, SL") or "TradingView Position Box"' },
                        rightAxisPriceTags: { type: Type.STRING, description: 'Highlighted/bordered Y-axis price badges listed top-to-bottom with colors/borders before assigning prices' },
                        position: { type: Type.STRING, description: 'BUY or SELL' },
                        lotSize: { type: Type.NUMBER, description: 'Lot size ONLY if source is MT5 (e.g. 0.01, 0.12, 0.25). Null for TradingView.' },
                        entryPrice: { type: Type.NUMBER, description: 'Exact entry price from right Y-axis bordered box/badge or MT5 row, or null if not detected' },
                        stopLoss: { type: Type.NUMBER, description: 'Exact Stop Loss price from right Y-axis bordered box/badge or MT5 row, or null if not detected' },
                        takeProfit: { type: Type.NUMBER, description: 'Exact Take Profit price from right Y-axis bordered box/badge or MT5 row, or null if not detected' },
                        exitPrice: { type: Type.NUMBER, description: 'Close/exit price if trade is closed' },
                        profit: { type: Type.NUMBER, description: 'Floating or closed profit/loss amount' },
                        plannedRiskReward: { type: Type.NUMBER, description: 'Risk/Reward ratio number (e.g. 2.0 for 1:2 RR)' },
                        timeframe: { type: Type.STRING, description: 'Chart timeframe (e.g. M1, M5, M15, M30, H1, H4, D1)' },
                        currentPrice: { type: Type.NUMBER, description: 'Current live running market price on the right price scale' },
                        status: { type: Type.STRING, description: 'PLANNED (when LIMIT or STOP is present, or TradingView setup), ACTIVE (open market order), or CLOSED' },
                        notes: { type: Type.STRING, description: 'Brief summary of visual readings including left-edge order labels' },
                      },
                      required: ['detected', 'instrument', 'position'],
                    },
                  },
                }),
              Math.min(18_000, remainingWallMs),
              `Scan Kilat (${model})`
            );

            if (response && response.text) {
              responseText = response.text;
              usedModel = model;
              break;
            }
            scanFailures.push({ model, code: 'EMPTY_RESPONSE', summary: 'Empty response text' });
          } catch (err: any) {
            const classified = classifyGeminiFailure(err);
            scanFailures.push({ model, code: classified.code, summary: classified.summary });
            if (classified.code === 'QUOTA_429' || classified.code === 'MODEL_404') {
              quotaCooldownUntilByModel.set(cooldownKey, {
                code: classified.code,
                until: Date.now() + 20 * 60 * 1000,
              });
            }
          }
        }
        if (responseText) break;
      }
      if (responseText) break;
    }

    if (!responseText) {
      res.status(200).json(buildScanFailureResponse(scanFailures, false));
      return;
    }

    const parsedData = parseAiJsonResponse(responseText);

    // Normalize instrument name & strip broker suffixes
    const cleanInstrument = normalizeInstrument(parsedData.instrument);

    const leftLabelsStr = String(parsedData.leftEdgeLabels || '');
    const notesStr = String(parsedData.notes || '');
    const combinedLabelsText = `${leftLabelsStr} ${notesStr}`;

    const hasExplicitMt5Buy = /\b(?:BUY|BELI)(?:\s+(?:LIMIT|STOP))?\b/i.test(combinedLabelsText);
    const hasExplicitMt5Sell = /\b(?:SELL|JUAL)(?:\s+(?:LIMIT|STOP))?\b/i.test(combinedLabelsText);

    const hasVerifiedDirection = Boolean(
      (canvasHints?.hasPositionBox &&
        (canvasHints.inferredPosition === 'BUY' || canvasHints.inferredPosition === 'SELL')) ||
        (hasExplicitMt5Buy && !hasExplicitMt5Sell) ||
        (hasExplicitMt5Sell && !hasExplicitMt5Buy)
    );

    // Normalize position (prefer verified canvas box or explicit MT5 BUY/SELL label)
    const rawPosUpper = String(parsedData.position || '').toUpperCase();
    let cleanPosition: 'BUY' | 'SELL' =
      canvasHints?.hasPositionBox && (canvasHints.inferredPosition === 'BUY' || canvasHints.inferredPosition === 'SELL')
        ? canvasHints.inferredPosition
        : hasExplicitMt5Sell && !hasExplicitMt5Buy
        ? 'SELL'
        : hasExplicitMt5Buy && !hasExplicitMt5Sell
        ? 'BUY'
        : rawPosUpper === 'SELL' || rawPosUpper === 'JUAL' || rawPosUpper === 'SHORT'
        ? 'SELL'
        : 'BUY';

    // Source detection
    const source: 'MT5' | 'TRADINGVIEW' | 'CHART' =
      parsedData.source === 'MT5'
        ? 'MT5'
        : parsedData.source === 'TRADINGVIEW' || canvasHints?.hasPositionBox
        ? 'TRADINGVIEW'
        : 'CHART';

    // Lifecycle status detection (strictly detect LIMIT / STOP as PLANNED)
    const rawStatusStr = String(parsedData.status || '').toUpperCase();
    const hasPendingKeyword = /\b(BUY\s+LIMIT|SELL\s+LIMIT|BUY\s+STOP|SELL\s+STOP|BELI\s+LIMIT|JUAL\s+LIMIT|LIMIT|STOP|PENDING)\b/i.test(
      combinedLabelsText
    );
    const status: 'PLANNED' | 'ACTIVE' | 'CLOSED' =
      rawStatusStr === 'CLOSED'
        ? 'CLOSED'
        : rawStatusStr === 'PLANNED' || hasPendingKeyword || source === 'TRADINGVIEW'
        ? 'PLANNED'
        : rawStatusStr === 'ACTIVE'
        ? 'ACTIVE'
        : 'PLANNED';

    // Normalize numeric values with robust parseNumericValue (supports "4.054,405" -> 4054.405)
    let entryPrice = parseNumericValue(parsedData.entryPrice, cleanInstrument);
    let stopLoss = parseNumericValue(parsedData.stopLoss, cleanInstrument);
    let takeProfit = parseNumericValue(parsedData.takeProfit, cleanInstrument);
    const exitPrice = parseNumericValue(parsedData.exitPrice, cleanInstrument);
    const profit = parseNumericValue(parsedData.profit, 'EURUSD');
    const rawLotSize = parseNumericValue(parsedData.lotSize, 'EURUSD');
    // Strictly return lotSize ONLY for MT5 (for TradingView, lotSize must be null so client uses standard Equity Auto-Lot)
    const lotSize = source === 'MT5' && rawLotSize !== null && rawLotSize > 0 ? rawLotSize : null;
    let plannedRR = parseNumericValue(parsedData.plannedRiskReward, 'EURUSD');
    const currentPrice = parseNumericValue(parsedData.currentPrice, cleanInstrument);

    const minDistance =
      cleanInstrument === 'XAUUSD'
        ? 1.0
        : cleanInstrument === 'BTCUSD'
        ? 25
        : cleanInstrument.includes('JPY') || cleanInstrument === 'XAGUSD'
        ? 0.03
        : 0.0003;

    // Enforce strict BUY / SELL directional order when all 3 real prices are present (NO synthetic SL/TP calculations!)
    if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
      if (hasVerifiedDirection) {
        if (cleanPosition === 'BUY' && stopLoss > entryPrice && takeProfit < entryPrice) {
          const tmp = stopLoss;
          stopLoss = takeProfit;
          takeProfit = tmp;
        } else if (cleanPosition === 'SELL' && stopLoss < entryPrice && takeProfit > entryPrice) {
          const tmp = stopLoss;
          stopLoss = takeProfit;
          takeProfit = tmp;
        }
      } else {
        if (stopLoss < entryPrice && entryPrice < takeProfit) {
          cleanPosition = 'BUY';
        } else if (takeProfit < entryPrice && entryPrice < stopLoss) {
          cleanPosition = 'SELL';
        } else if (cleanPosition === 'BUY' && stopLoss > takeProfit) {
          const tmp = stopLoss;
          stopLoss = takeProfit;
          takeProfit = tmp;
        } else if (cleanPosition === 'SELL' && stopLoss < takeProfit) {
          const tmp = stopLoss;
          stopLoss = takeProfit;
          takeProfit = tmp;
        }
      }
    }

    // Reject tiny micro-noise or invalid SL/TP (< minDistance, e.g. 0.04 on XAUUSD) -> return null so user can fill manually
    if (
      entryPrice !== null &&
      stopLoss !== null &&
      (Math.abs(entryPrice - stopLoss) < minDistance ||
        (cleanPosition === 'BUY' && stopLoss >= entryPrice) ||
        (cleanPosition === 'SELL' && stopLoss <= entryPrice))
    ) {
      stopLoss = null;
    }
    if (
      entryPrice !== null &&
      takeProfit !== null &&
      (Math.abs(takeProfit - entryPrice) < minDistance ||
        (cleanPosition === 'BUY' && takeProfit <= entryPrice) ||
        (cleanPosition === 'SELL' && takeProfit >= entryPrice))
    ) {
      takeProfit = null;
    }

    if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
      const risk = Math.abs(entryPrice - stopLoss);
      const reward = Math.abs(takeProfit - entryPrice);
      if (risk >= minDistance) {
        plannedRR = parseFloat((reward / risk).toFixed(2));
      }
    }

    res.json({
      success: true,
      data: {
        detected: parsedData.detected !== false,
        source,
        instrument: cleanInstrument,
        position: cleanPosition,
        lotSize,
        entryPrice,
        stopLoss,
        takeProfit,
        exitPrice,
        profit,
        status,
        plannedRiskReward: plannedRR,
        timeframe: parsedData.timeframe || null,
        currentPrice: currentPrice ?? null,
        confidence: parsedData.confidence || 0.95,
        notes: parsedData.notes || parsedData.leftEdgeLabels || '',
        modelUsed: usedModel || 'gemini-4-hydrogen',
      },
    });
  } catch (error: any) {
    const compactMsg = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, 240);
    console.warn('[ScreenshotExtract] Fallback after error:', compactMsg);
    res.status(500).json({
      success: false,
      error: error?.message || 'Terjadi kesalahan saat memproses gambar analisis.',
    });
  }
});

function normalizeMt5DateTimeOutput(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // Match MT5 formats: "2026.11.14 14:22:10", "2026-11-14 14:22", "2026/11/14 14:22", "2026-11-14T14:22"
  const m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  if (m) {
    const yyyy = m[1];
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    const hh = m[4].padStart(2, '0');
    const min = m[5].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
  // Match EU/ID DD.MM.YYYY HH:mm or DD/MM/YYYY HH:mm
  const eu = s.match(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})[T\s]+(\d{1,2}):(\d{2})/);
  if (eu) {
    const dd = eu[1].padStart(2, '0');
    const mm = eu[2].padStart(2, '0');
    const yyyy = eu[3];
    const hh = eu[4].padStart(2, '0');
    const min = eu[5].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
  return null;
}

function inferMt5CloseType(params: {
  rawCloseType?: unknown;
  notes?: string;
  position: 'BUY' | 'SELL';
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  netProfit: number | null;
  instrument: string;
}): 'TP' | 'SL' | 'Manual' {
  const { rawCloseType, notes, exitPrice, stopLoss, takeProfit, netProfit, instrument } = params;
  const rawUpper = String(rawCloseType || '').trim().toUpperCase();
  const notesLower = String(notes || '').toLowerCase();

  const priceTol =
    instrument === 'XAUUSD'
      ? 0.65
      : instrument === 'BTCUSD'
      ? 25
      : instrument === 'US30' || instrument === 'NAS100'
      ? 8
      : instrument.includes('JPY') || instrument === 'XAGUSD'
      ? 0.05
      : 0.0005;

  if (exitPrice !== null && takeProfit !== null && Math.abs(exitPrice - takeProfit) <= priceTol) {
    return 'TP';
  }
  if (exitPrice !== null && stopLoss !== null && Math.abs(exitPrice - stopLoss) <= priceTol) {
    return 'SL';
  }
  if (/\[\s*tp\s*\]|\/\s*tp\b|\btake\s*profit\b/i.test(notesLower)) {
    return 'TP';
  }
  if (/\[\s*sl\s*\]|\/\s*sl\b|\bstop\s*loss\b/i.test(notesLower)) {
    return 'SL';
  }

  if (rawUpper === 'TP') {
    if (netProfit !== null && netProfit < -0.05 && takeProfit === null) return 'Manual';
    return 'TP';
  }
  if (rawUpper === 'SL') {
    if (netProfit !== null && netProfit > 0.05 && stopLoss === null) return 'Manual';
    return 'SL';
  }
  return 'Manual';
}

function parseAndNormalizeMt5HistoryResponse(
  responseText: string,
  maxImageIndex = 0
): {
  parsedValidArray: boolean;
  explicitNoTrades: boolean;
  source: string;
  normalizedTrades: any[];
} {
  let parsedData = parseAiJsonResponse(responseText);
  if (!Array.isArray(parsedData.trades)) {
    const tradesIdx = responseText.indexOf('"trades"');
    if (tradesIdx !== -1) {
      const arrStart = responseText.indexOf('[', tradesIdx);
      if (arrStart !== -1) {
        const recovered: any[] = [];
        const objMatches = responseText.slice(arrStart).match(/\{[^{}]+\}/g) || [];
        for (const rawObj of objMatches) {
          try {
            recovered.push(JSON.parse(rawObj));
          } catch {}
        }
        if (recovered.length > 0) {
          parsedData = { detected: true, source: 'MT5_HISTORY', trades: recovered };
        }
      }
    }
  }

  const parsedValidArray = Array.isArray(parsedData.trades);
  const rawTrades = parsedValidArray ? parsedData.trades : [];

  const normalizedTrades = rawTrades
    .map((row: any) => {
      if (!row || typeof row !== 'object') return null;
      const rawPos = String(row.position || '').trim().toUpperCase();
      const isSell =
        rawPos.includes('SELL') || rawPos.includes('JUAL') || rawPos.includes('SHORT');
      const isBuy =
        rawPos.includes('BUY') || rawPos.includes('BELI') || rawPos.includes('LONG');
      if (!isBuy && !isSell) {
        return null;
      }
      const position: 'BUY' | 'SELL' = isSell && !isBuy ? 'SELL' : isSell ? 'SELL' : 'BUY';
      const instrument = normalizeInstrument(row.instrument);
      const lotRaw = parseNumericValue(row.lotSize, 'EURUSD', { isPrice: false });
      const entryPrice = parseNumericValue(row.entryPrice, instrument, { isPrice: true });
      const exitPrice = parseNumericValue(row.exitPrice, instrument, { isPrice: true });
      const stopLoss = parseNumericValue(row.stopLoss, instrument, { isPrice: true });
      const takeProfit = parseNumericValue(row.takeProfit, instrument, { isPrice: true });
      const rawComm = parseNumericValue(row.commission, 'EURUSD', { isPrice: false });
      const rawSwap = parseNumericValue(row.swap, 'EURUSD', { isPrice: false });
      const rawProfit = parseNumericValue(row.netProfit, 'EURUSD', { isPrice: false });

      if (entryPrice === null && exitPrice === null && rawProfit === null) {
        return null;
      }

      const cleanStr = (v: unknown): string => {
        if (typeof v !== 'string') return '';
        const t = v.trim();
        return /^(null|undefined|none|n\/a)$/i.test(t) ? '' : t;
      };

      const openDateTime = normalizeMt5DateTimeOutput(cleanStr(row.openDateTime));
      const closeDateTime = normalizeMt5DateTimeOutput(cleanStr(row.closeDateTime));
      const notes = cleanStr(row.notes);
      const closeType = inferMt5CloseType({
        rawCloseType: row.closeType,
        notes,
        position,
        exitPrice,
        stopLoss,
        takeProfit,
        netProfit: rawProfit,
        instrument,
      });

      const rawTicket =
        typeof row.ticketId === 'string' || typeof row.ticketId === 'number'
          ? String(row.ticketId).replace(/^#/, '').trim()
          : '';
      const cleanTicket =
        rawTicket && !/^(null|undefined|none|n\/a|-)$/i.test(rawTicket) ? rawTicket : null;

      const rawImgIdx =
        typeof row.imageIndex === 'number' && Number.isFinite(row.imageIndex)
          ? Math.trunc(row.imageIndex)
          : 0;
      const imageIndex = Math.max(0, Math.min(Math.max(0, maxImageIndex), rawImgIdx));

      return {
        imageIndex,
        ticketId: cleanTicket,
        instrument,
        position,
        lotSize: lotRaw !== null && lotRaw > 0 ? Number(lotRaw.toFixed(2)) : 0.01,
        entryPrice: entryPrice !== null && entryPrice > 0 ? entryPrice : exitPrice || 0,
        exitPrice: exitPrice !== null && exitPrice > 0 ? exitPrice : entryPrice || 0,
        stopLoss: stopLoss !== null && stopLoss > 0 ? stopLoss : null,
        takeProfit: takeProfit !== null && takeProfit > 0 ? takeProfit : null,
        commission: rawComm !== null ? Number(Math.abs(rawComm).toFixed(2)) : 0,
        swap: rawSwap !== null ? Number(rawSwap.toFixed(2)) : 0,
        netProfit: rawProfit !== null ? Number(rawProfit.toFixed(2)) : 0,
        openDateTime,
        closeDateTime,
        closeType,
        notes,
      };
    })
    .filter((item: any) => item !== null);

  const explicitNoTrades =
    parsedValidArray && normalizedTrades.length === 0 && parsedData.detected === false;

  return {
    parsedValidArray,
    explicitNoTrades,
    source: String(parsedData.source || 'MT5_HISTORY'),
    normalizedTrades,
  };
}

// AI Vision Endpoint: Batch extract closed MT5/MT4 trade history rows from 1..5 screenshots
app.post('/api/extract-mt5-history', async (req, res) => {
  try {
    const body = (req.body || {}) as ExtractScreenshotRequest & {
      images?: Array<{ imageBase64?: string; imageUrl?: string }>;
    };

    const rawInputs: Array<{ imageBase64?: string; imageUrl?: string }> = Array.isArray(body.images)
      ? body.images.slice(0, 5)
      : body.imageBase64 || body.imageUrl
      ? [{ imageBase64: body.imageBase64, imageUrl: body.imageUrl }]
      : [];

    if (rawInputs.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Harap sertakan imageBase64, imageUrl, atau array images.',
      });
      return;
    }

    const scannerApiKeys = getScannerGeminiApiKeys();

    if (scannerApiKeys.length === 0) {
      res.status(400).json({
        success: false,
        error: 'GEMINI_API_KEY (khusus Scan Kilat) belum dikonfigurasi di environment server.',
      });
      return;
    }

    const resolvedImages: Array<{ index: number; mimeType: string; base64Data: string }> = [];
    for (let idx = 0; idx < rawInputs.length; idx++) {
      const inp = rawInputs[idx];
      let mimeType = 'image/jpeg';
      let base64Data = '';

      if (inp?.imageBase64) {
        const trimmedInput = String(inp.imageBase64).trim();
        const match = trimmedInput.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,([\s\S]+)$/i);
        if (match) {
          const rawMime = match[1].toLowerCase();
          mimeType =
            rawMime === 'image/png'
              ? 'image/png'
              : rawMime === 'image/webp'
              ? 'image/webp'
              : 'image/jpeg';
          base64Data = match[2].replace(/\s+/g, '');
        } else {
          base64Data = trimmedInput.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
        }
      } else if (inp?.imageUrl) {
        const fetched = await fetchImageBufferFromUrl(String(inp.imageUrl));
        const rawMime = (fetched.mimeType || 'image/jpeg').toLowerCase();
        mimeType =
          rawMime === 'image/png'
            ? 'image/png'
            : rawMime === 'image/webp'
            ? 'image/webp'
            : 'image/jpeg';
        base64Data = fetched.buffer.toString('base64');
      }

      if (base64Data) {
        resolvedImages.push({ index: idx, mimeType, base64Data });
      }
    }

    if (resolvedImages.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Tidak ada gambar valid yang dikirim.',
      });
      return;
    }

    const isBatch = resolvedImages.length > 1;
    const prompt = `You are an elite MetaTrader 5 (MT5) & MetaTrader 4 (MT4) Account History OCR & trade-ledger extraction specialist.
Inspect ${
      isBatch
        ? `ALL ${resolvedImages.length} labeled screenshots (imageIndex 0 to ${resolvedImages.length - 1})`
        : 'the FULL screenshot'
    } carefully from top to bottom and extract EVERY closed trade row visible (even if cropped and missing a header).

STRICT EXTRACTION RULES:
1. SUPPORTED SCREENSHOT VIEWS:
   - MT5 / MT4 Mobile "History -> Positions" (e.g. "XAUUSD, sell 0.10", "2615.40 -> 2602.10", timestamp, profit)
   - MT5 Mobile "History -> Deals" (rows showing symbol, buy/sell, "out" / "in/out", volume, price, profit — extract closing/profit deals as closed trades)
   - Indonesian MT5 locale ("beli" = BUY, "jual" = SELL) as well as English ("buy"/"long" = BUY, "sell"/"short" = SELL)
   - MT5 / MT4 Desktop Account History table
   - IGNORE summary header lines ("Profit:", "Deposit:", "Balance:", "Credit:", "Withdrawal:") and non-trade ledger rows ("balance", "deposit", "credit", "withdrawal") and unfilled "canceled" pending orders.
2. EXACT NUMERIC & SIGN FIDELITY (ZERO SILENT ERRORS):
   - Left: symbol + direction + lot, e.g. "XAUUSD, sell 0.10", "XAUUSDm, buy 0.05", "GOLD, beli 0.10"
   - Prices: "2615.40 -> 2602.10" -> entryPrice BEFORE "->", exitPrice AFTER "->". Copy EVERY digit and decimal accurately (never drop a digit or decimal!).
   - Profit Sign: Inspect BOTH the "-" / "−" prefix AND font color (red = negative loss, blue/green = positive profit). If a BUY exited lower than entry (or SELL exited higher than entry) and text is red/loss, netProfit MUST be negative (e.g. -45.20)!
   - Top-right of row: timestamp like "2026.11.14 14:22:10" (closeDateTime)
   - Expanded row details (if visible): "S / L:" -> stopLoss, "T / P:" -> takeProfit, "Open:" -> openDateTime, "Swap:" -> swap, "Commission:"/"Fee:" -> commission, "ID:"/"#12345" -> ticketId.
3. READING DESKTOP MT5 ACCOUNT HISTORY TABLE:
   - Map columns: Time (open), Position/Order/Ticket (ticketId), Symbol (instrument), Type (buy->BUY, sell->SELL), Volume (lotSize), Open Price (entryPrice), S/L (stopLoss), T/P (takeProfit), Close Time (closeDateTime), Close Price (exitPrice), Commission, Swap, Profit (netProfit).
4. CLOSE TYPE DETECTION (TP / SL / Manual):
   - "TP": comment/tag shows "[tp]", OR T/P badge is green/highlighted, OR exitPrice closely matches takeProfit.
   - "SL": comment/tag shows "[sl]", OR S/L badge is red/highlighted, OR exitPrice closely matches stopLoss.
   - "Manual": otherwise (closed manually by trader).
5. FORMATTING${isBatch ? ' & IMAGE ATTRIBUTION' : ''}:
   - ${isBatch ? `Set "imageIndex" strictly to the integer 0..${resolvedImages.length - 1} matching the screenshot containing that trade row.` : 'Set "imageIndex" to 0.'}
   - Return empty string "" (NEVER literal "null") when ticketId, openDateTime, closeDateTime, or notes are not visible.
   - Output openDateTime / closeDateTime in "YYYY-MM-DD HH:mm" if visible.
   - Never invent trades that are not visibly printed on screen.`;

    const contentParts: any[] = [];
    if (isBatch) {
      for (const img of resolvedImages) {
        contentParts.push(`Screenshot [imageIndex=${img.index}]:`);
        contentParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64Data,
          },
        });
      }
    } else {
      contentParts.push({
        inlineData: {
          mimeType: resolvedImages[0].mimeType,
          data: resolvedImages[0].base64Data,
        },
      });
    }
    contentParts.push(prompt);

    const candidateModels = MT5_HISTORY_MODEL_CASCADE;
    let winningResult: ReturnType<typeof parseAndNormalizeMt5HistoryResponse> | null = null;
    let usedModel = '';
    let confirmedEmptyModel = '';
    const mt5CascadeStartMs = Date.now();
    const MAX_MT5_WALL_MS = 45_000;
    const mt5Failures: Array<{ model: string; code: string; summary: string }> = [];

    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0) {
        const shouldRetryTransient = mt5Failures.some(
          (f) => f.code === 'SERVER_503' || f.code === 'TIMEOUT'
        );
        const remainingBeforePass = MAX_MT5_WALL_MS - (Date.now() - mt5CascadeStartMs);
        if (!shouldRetryTransient || remainingBeforePass < 5000) break;
        await new Promise((r) => setTimeout(r, 900));
      }

      for (const model of candidateModels) {
        if (MAX_MT5_WALL_MS - (Date.now() - mt5CascadeStartMs) < 2500) break;
        for (let keyIdx = 0; keyIdx < scannerApiKeys.length; keyIdx++) {
          const remainingWallMs = MAX_MT5_WALL_MS - (Date.now() - mt5CascadeStartMs);
          if (remainingWallMs < 2500) break;
          const cooldownKey = `${keyIdx}:${model}`;
          const cooldownEntry = quotaCooldownUntilByModel.get(cooldownKey);
          if (cooldownEntry && Date.now() < cooldownEntry.until) {
            mt5Failures.push({
              model,
              code: cooldownEntry.code,
              summary: 'Cooldown cache active',
            });
            continue;
          }

          const ai = new GoogleGenAI({
            apiKey: scannerApiKeys[keyIdx],
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              },
              retryOptions: { attempts: 1 },
            },
          });

          try {
            const response = await withTimeoutAbort(
              (abortSignal) =>
                ai.models.generateContent({
                  model,
                  contents: contentParts,
                  config: {
                    abortSignal,
                    ...(model === 'gemini-4-hydrogen'
                      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                      : {}),
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        detected: {
                          type: Type.BOOLEAN,
                          description: 'True if at least one closed MT5/MT4 trade row is visible',
                        },
                        source: {
                          type: Type.STRING,
                          description: 'MT5_HISTORY_MOBILE, MT5_HISTORY_DESKTOP, or MT4_HISTORY',
                        },
                        trades: {
                          type: Type.ARRAY,
                          description: 'All visible closed trade rows ordered top-to-bottom as shown in screenshots',
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              imageIndex: {
                                type: Type.INTEGER,
                                description: '0-based index of the screenshot containing this row (0 for single screenshot)',
                              },
                              ticketId: { type: Type.STRING, description: 'MT5 ticket/deal/position ID if visible, else empty string' },
                              instrument: { type: Type.STRING, description: 'Clean symbol e.g. XAUUSD, EURUSD, BTCUSD' },
                              position: { type: Type.STRING, description: 'BUY or SELL' },
                              lotSize: { type: Type.NUMBER, description: 'Volume / lot size e.g. 0.10' },
                              entryPrice: { type: Type.NUMBER, description: 'Entry / Open price before ->' },
                              exitPrice: { type: Type.NUMBER, description: 'Exit / Close price after ->' },
                              stopLoss: { type: Type.NUMBER, description: 'S/L price if shown, else null' },
                              takeProfit: { type: Type.NUMBER, description: 'T/P price if shown, else null' },
                              commission: { type: Type.NUMBER, description: 'Commission fee amount if shown, else 0' },
                              swap: { type: Type.NUMBER, description: 'Swap amount if shown (signed), else 0' },
                              netProfit: { type: Type.NUMBER, description: 'Realized profit/loss on the row (negative if loss / red)' },
                              openDateTime: { type: Type.STRING, description: 'Open timestamp YYYY-MM-DD HH:mm if visible, else empty string' },
                              closeDateTime: { type: Type.STRING, description: 'Close timestamp YYYY-MM-DD HH:mm if visible, else empty string' },
                              closeType: { type: Type.STRING, description: 'TP, SL, or Manual' },
                              notes: { type: Type.STRING, description: 'Optional visible row tag e.g. [tp], [sl], or empty string' },
                            },
                            required: ['imageIndex', 'instrument', 'position'],
                          },
                        },
                      },
                      required: ['detected', 'trades'],
                    },
                  },
                }),
              Math.min(isBatch ? 22_000 : 15_000, remainingWallMs),
              `MT5 Scan (${model})`
            );

            if (response && response.text) {
              const candidate = parseAndNormalizeMt5HistoryResponse(
                response.text,
                resolvedImages.length - 1
              );
              if (candidate.normalizedTrades.length > 0) {
                winningResult = candidate;
                usedModel = model;
                break;
              }
              if (candidate.explicitNoTrades && !confirmedEmptyModel) {
                confirmedEmptyModel = model;
              }
              mt5Failures.push({
                model,
                code: 'EMPTY_RESPONSE',
                summary: candidate.parsedValidArray ? 'Model returned 0 trade rows' : 'Truncated or invalid JSON output',
              });
            } else {
              mt5Failures.push({ model, code: 'EMPTY_RESPONSE', summary: 'Empty response text' });
            }
          } catch (err: any) {
            const classified = classifyGeminiFailure(err);
            mt5Failures.push({ model, code: classified.code, summary: classified.summary });
            if (classified.code === 'QUOTA_429' || classified.code === 'MODEL_404') {
              quotaCooldownUntilByModel.set(cooldownKey, {
                code: classified.code,
                until: Date.now() + 20 * 60 * 1000,
              });
            }
          }
        }
        if (winningResult) break;
      }
      if (winningResult) break;
    }

    if (!winningResult) {
      const hasRealModelFailure = mt5Failures.some((f) => f.code !== 'EMPTY_RESPONSE');
      if (confirmedEmptyModel && !hasRealModelFailure) {
        res.json({
          success: true,
          data: {
            detected: false,
            source: 'MT5_HISTORY',
            trades: [],
            modelUsed: confirmedEmptyModel,
          },
        });
        return;
      }
      res.status(200).json(buildScanFailureResponse(mt5Failures, true));
      return;
    }

    console.log(
      `[MT5HistoryExtract] model=${usedModel}, images=${resolvedImages.length}, normalized=${winningResult.normalizedTrades.length}`
    );

    res.json({
      success: true,
      data: {
        detected: true,
        source: winningResult.source,
        trades: winningResult.normalizedTrades,
        modelUsed: usedModel || 'gemini-3.1-flash-lite',
      },
    });
  } catch (error: any) {
    const compactMsg = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, 240);
    console.warn('[MT5HistoryExtract] Error:', compactMsg);
    res.status(500).json({
      success: false,
      error: error?.message || 'Terjadi kesalahan saat memindai riwayat MT5.',
    });
  }
});

// ============================================================================
// TRADE NEWS & MACRO BIAS (XAU/USD) — ISOLATED QUOTA & FREE PUBLIC DATA FEEDER
// ============================================================================

const newsQuotaCooldownUntilByModel = new Map<string, number>();
let cachedMacroFeeds: {
  fetchedAt: number;
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
  };
  breakingNews: BreakingNewsHeadline[];
  rssFeedHealth?: RssFeedHealthStatus;
  cmeFedWatch: CmeFedWatchState;
} | null = null;

let lastServerMacroSnapshot: MacroNewsSnapshot | null = null;
let cachedCmeFedWatch: { fetchedAt: number; data: CmeFedWatchState } | null = null;

function getFallbackCalendarEvents(): MacroCalendarEvent[] {
  // Zero-Mock Policy: Never return fake/hardcoded calendar numbers.
  return [];
}

function parseServerForexFactoryXml(xmlText: string): any[] {
  if (!xmlText || !xmlText.includes('<event>')) return [];
  const items: any[] = [];
  const cleanTag = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m || !m[1]) return '';
    return m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
  };

  const eventBlocks = xmlText.match(/<event>[\s\S]*?<\/event>/gi) || [];
  for (const block of eventBlocks) {
    const title = cleanTag(block, 'title');
    const country = cleanTag(block, 'country');
    const datePart = cleanTag(block, 'date');
    const timePart = cleanTag(block, 'time');
    const impact = cleanTag(block, 'impact');
    const forecast = cleanTag(block, 'forecast');
    const previous = cleanTag(block, 'previous');
    const actual = cleanTag(block, 'actual');
    if (!title || !country) continue;

    let isoDate = datePart;
    const dateMatch = datePart.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dateMatch) {
      const [, mm, dd, yyyy] = dateMatch;
      let hours = 13;
      let minutes = 30;
      const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        const ampm = timeMatch[3].toLowerCase();
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
      }
      const pad = (n: number) => String(n).padStart(2, '0');
      isoDate = `${yyyy}-${mm}-${dd}T${pad(hours)}:${pad(minutes)}:00Z`;
    }

    items.push({ title, country, date: isoDate, impact, forecast, previous, actual });
  }
  return items;
}

async function fetchSingleForexFactoryFeed(url: string, xmlUrl?: string): Promise<any[]> {
  // 1. Direct server fetch (fastest in Node.js)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Try multi-proxy fallbacks
  }

  const encoded = encodeURIComponent(url);
  const proxyCandidates = [
    { type: 'raw', target: `https://api.codetabs.com/v1/proxy?quest=${encoded}` },
    { type: 'raw', target: `https://corsproxy.io/?url=${encoded}` },
    { type: 'allorigins_get', target: `https://api.allorigins.win/get?url=${encoded}` },
  ];

  for (const p of proxyCandidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(p.target, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      if (p.type === 'allorigins_get') {
        const wrapper = await res.json();
        if (wrapper && typeof wrapper.contents === 'string') {
          const parsed = JSON.parse(wrapper.contents);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } else {
        const parsed = await res.json();
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Try next proxy
    }
  }

  // XML fallback
  if (xmlUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(xmlUrl, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/xml, text/xml',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const xmlText = await res.text();
        const parsedXml = parseServerForexFactoryXml(xmlText);
        if (parsedXml.length > 0) return parsedXml;
      }
    } catch {
      // ignore
    }
  }

  return [];
}

/**
 * Backup internet fetcher using Gemini Google Search Grounding (`googleSearch`)
 * if all direct and public proxy routes to ForexFactory are rate-limited or blocked.
 * Strictly returns ONLY verified real events from search results (never invents figures).
 */
async function fetchForexFactoryCalendarViaGoogleSearch(): Promise<any[]> {
  const newsApiKey = getNewsGeminiApiKeys()[0] || '';
  if (!newsApiKey) return [];

  const candidateModels = NEWS_MODEL_CASCADE;

  const ai = new GoogleGenAI({
    apiKey: newsApiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
      retryOptions: { attempts: 1 },
    },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const calendarPrompt = `Today is ${todayIso}. Search the live web (ForexFactory / Investing.com US economic calendar for this week and next week) for upcoming and recent USD High-Impact and Medium-Impact economic releases (such as CPI, Core CPI, PPI, Core PPI, NFP, Unemployment Rate, FOMC, PCE, Core PCE, GDP, Retail Sales, ISM PMI, Unemployment Claims).
Return ONLY a valid JSON array (no markdown fences) where each object has:
{ "title": string, "country": "USD", "date": "ISO-8601 UTC timestamp e.g. 2026-11-13T13:30:00Z", "impact": "High" | "Medium", "previous": string, "forecast": string, "actual": string }
CRITICAL RULE: Do NOT invent or fabricate numbers. Only include events whose exact Previous and Forecast (and Actual if released) are verified from live search results. If no verified calendar figures are found, return [].`;

  for (const model of candidateModels) {
    const cooldownUntil = newsQuotaCooldownUntilByModel.get(model) || 0;
    if (Date.now() < cooldownUntil) continue;

    try {
      const response = await withTimeoutAbort(
        (abortSignal) =>
          ai.models.generateContent({
            model,
            contents: calendarPrompt,
            config: {
              abortSignal,
              tools: [{ googleSearch: {} }],
            },
          }),
        12_000,
        `FF Calendar Search (${model})`
      );

      const text = (response?.text || '').trim();
      if (!text) continue;
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) continue;
      const parsed = JSON.parse(clean.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err: any) {
      if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
        newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
      }
      continue;
    }
  }
  return [];
}

async function fetchServerYahooRawQuote(
  yahooTicker: string
): Promise<{ price: number | null; previousClose: number | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const encodedTicker = encodeURIComponent(yahooTicker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=5m&range=5d&_t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta) {
        const regPrice = Number(meta.regularMarketPrice);
        const prev = Number(meta.previousClose ?? meta.chartPreviousClose);
        return {
          price: Number.isFinite(regPrice) && regPrice > 0 ? regPrice : null,
          previousClose: Number.isFinite(prev) && prev > 0 ? prev : null,
        };
      }
    }
  } catch {
    // ignore
  }
  return { price: null, previousClose: null };
}

/**
 * Automatic Real-Time Backup from Bond & Futures Markets (`ZQ=F` 30-Day Fed Funds Futures & `^IRX` 13-Week T-Bill):
 * Calculates `Implied Fed Funds Rate = 100 - harga ZQ=F` and FOMC Desember 2026 probabilities
 * whenever Google Search Grounding for CME FedWatch is rate-limited or web search snippets omit the table.
 */
async function fetchServerYahooFedFundsAndTbillQuotes(
  us10yPulse?: IntermarketAssetPulse
): Promise<CmeFedWatchState> {
  try {
    const [zqQuote, irxQuote, us2yQuote] = await Promise.all([
      fetchServerYahooRawQuote('ZQ=F'),
      fetchServerYahooRawQuote('^IRX'),
      fetchServerYahooRawQuote('2YY=F'),
    ]);

    return computeImpliedFedWatchFromMarketQuotes({
      zqFuturesPrice: zqQuote.price,
      zqPreviousClose: zqQuote.previousClose,
      irxYield: irxQuote.price,
      irxPreviousClose: irxQuote.previousClose,
      us2yYield: us2yQuote.price,
      us10yYield: us10yPulse?.isAvailable !== false ? (us10yPulse?.price ?? null) : null,
      us10yChangePercent: us10yPulse?.isAvailable !== false ? (us10yPulse?.changePercent ?? 0) : 0,
    });
  } catch {
    return createUnavailableFedWatchState();
  }
}

/**
 * Live CME FedWatch Tool fetcher via Gemini Google Search Grounding (`googleSearch`)
 * specifically targeting the December 2026 FOMC meeting ("FOMC Desember 2026"),
 * with automatic real-time fallback to live 30-Day Fed Funds Futures (`ZQ=F`, `100 - price`)
 * and 13-Week T-Bill (`^IRX`) quotes so FOMC Desember 2026 probabilities are never empty.
 */
async function fetchLiveCmeFedWatchWithGrounding(
  forceRefresh = false,
  us10yPulse?: IntermarketAssetPulse
): Promise<CmeFedWatchState> {
  if (
    cachedCmeFedWatch &&
    cachedCmeFedWatch.data.isAvailable &&
    ((!forceRefresh && Date.now() - cachedCmeFedWatch.fetchedAt < 4 * 60 * 60 * 1000) ||
      (forceRefresh && Date.now() - cachedCmeFedWatch.fetchedAt < 15 * 60 * 1000))
  ) {
    return cachedCmeFedWatch.data;
  }

  // Pull live ZQ=F & ^IRX quotes in parallel as automatic real-time bond/futures backup
  const futuresBackupPromise = fetchServerYahooFedFundsAndTbillQuotes(us10yPulse);

  const newsApiKey = getNewsGeminiApiKeys()[0] || '';

  if (!newsApiKey) {
    const backup = await futuresBackupPromise;
    if (backup.isAvailable) {
      cachedCmeFedWatch = { fetchedAt: Date.now(), data: backup };
      return backup;
    }
    return cachedCmeFedWatch?.data?.isAvailable ? cachedCmeFedWatch.data : backup;
  }

  const candidateModels = NEWS_MODEL_CASCADE;

  const ai = new GoogleGenAI({
    apiKey: newsApiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
      retryOptions: { attempts: 1 },
    },
  });

  const upcomingFomc = getUpcomingFomcMeetingInfo();
  const todayIso = new Date().toISOString().slice(0, 10);
  const fedWatchPrompt = `Today is ${todayIso}. Search for the latest CME FedWatch Tool target rate probabilities for the next upcoming FOMC meeting (${upcomingFomc.searchPhraseEn} / ${upcomingFomc.labelId}).
Extract the exact percentages (with 1 decimal place, e.g. XX.X) for:
- Rate Hike (+25 bps or more): hikeProbability
- Hold (Unchanged): holdProbability
- Rate Cut (-25 bps or more): cutProbability
- Target Meeting: "${upcomingFomc.labelId}" (or the exact upcoming FOMC meeting month found in CME FedWatch Tool)

Return ONLY a valid JSON object (no markdown fences) with these exact fields:
{
  "isAvailable": boolean,
  "fomcMeetingDate": "string (e.g. '${upcomingFomc.labelId}')",
  "targetRateRange": "string (current or target federal funds rate range e.g. '450-475 bps' or '')",
  "hikeProbability": number or null (0 to 100, probability of Rate Hike +25 bps or more, e.g. 90.0),
  "holdProbability": number or null (0 to 100, probability of Hold / Unchanged, e.g. 10.0),
  "cutProbability": number or null (0 to 100, probability of Rate Cut -25 bps or more, e.g. 0.0),
  "hawkishShiftDetected": boolean (true if probabilities shifted toward Rate Hike / Hold)
}
CRITICAL RULE: Do not invent numbers. If search results do not contain the exact percentage figures, set "isAvailable": false so our live 30-Day Fed Funds Futures (ZQ=F) and ^IRX calculator provides the real-time implied rate probabilities.`;

  for (const model of candidateModels) {
    const cooldownUntil = newsQuotaCooldownUntilByModel.get(model) || 0;
    if (Date.now() < cooldownUntil) continue;

    try {
      const response = await withTimeoutAbort(
        (abortSignal) =>
          ai.models.generateContent({
            model,
            contents: fedWatchPrompt,
            config: {
              abortSignal,
              tools: [{ googleSearch: {} }],
            },
          }),
        12_000,
        `CME FedWatch Grounding (${model})`
      );

      const rawText = (response?.text || '').trim();
      if (rawText) {
        const parsed = parseAiJsonResponse(rawText);
        const cutVal =
          parsed.cutProbability !== null && parsed.cutProbability !== undefined
            ? Number(parsed.cutProbability)
            : null;
        const holdVal =
          parsed.holdProbability !== null && parsed.holdProbability !== undefined
            ? Number(parsed.holdProbability)
            : null;
        const hikeVal =
          parsed.hikeProbability !== null && parsed.hikeProbability !== undefined
            ? Number(parsed.hikeProbability)
            : 0;

        if (
          parsed.isAvailable !== false &&
          cutVal !== null &&
          holdVal !== null &&
          Number.isFinite(cutVal) &&
          Number.isFinite(holdVal) &&
          cutVal + holdVal + (Number.isFinite(hikeVal) ? hikeVal : 0) > 0
        ) {
          const futuresData = await futuresBackupPromise;
          const resolvedMeetingLabel =
            typeof parsed.fomcMeetingDate === 'string' && parsed.fomcMeetingDate.trim()
              ? parsed.fomcMeetingDate.trim()
              : upcomingFomc.labelId;
          const evaluated = evaluateCmeFedWatchScoring({
            isAvailable: true,
            fomcMeetingDate: resolvedMeetingLabel,
            targetRateRange: String(
              parsed.targetRateRange || parsed.targetRateBps || futuresData.targetRateRange || ''
            ),
            cutProbability: cutVal,
            holdProbability: holdVal,
            hikeProbability: Number.isFinite(hikeVal) ? hikeVal : 0,
            hawkishShiftDetected: Boolean(parsed.hawkishShiftDetected || (hikeVal ?? 0) >= 50),
            sourceLabel: `Sumber: CME FedWatch Grounding (${upcomingFomc.shortId})`,
            impliedFedFundsRate: futuresData.impliedFedFundsRate ?? null,
            zqFuturesPrice: futuresData.zqFuturesPrice ?? null,
            irxTbillYield: futuresData.irxTbillYield ?? null,
          });

          cachedCmeFedWatch = {
            fetchedAt: Date.now(),
            data: evaluated,
          };

          return evaluated;
        }
      }
    } catch (err: any) {
      if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
        newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
      }
      continue;
    }
  }

  const backup = await futuresBackupPromise;
  if (backup.isAvailable) {
    cachedCmeFedWatch = {
      fetchedAt: Date.now(),
      data: backup,
    };
    return backup;
  }
  return cachedCmeFedWatch?.data?.isAvailable ? cachedCmeFedWatch.data : backup;
}

interface TradingViewCalEvent {
  title?: string;
  indicator?: string;
  date?: string;
  actual?: number | null;
  forecast?: number | null;
  previous?: number | null;
  unit?: string;
  scale?: string;
}

let cachedTradingViewUsEvents: { fetchedAt: number; events: TradingViewCalEvent[] } | null = null;

async function fetchTradingViewUsEventsWindow(minMs: number, maxMs: number): Promise<TradingViewCalEvent[]> {
  if (cachedTradingViewUsEvents && Date.now() - cachedTradingViewUsEvents.fetchedAt < 2 * 60 * 1000) {
    return cachedTradingViewUsEvents.events;
  }
  try {
    const fromIso = new Date(minMs - 24 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(maxMs + 24 * 60 * 60 * 1000).toISOString();
    const tvUrl = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&countries=US`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(tvUrl, {
      cache: 'no-store',
      headers: {
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return cachedTradingViewUsEvents?.events || [];
    const json = await res.json();
    const list: TradingViewCalEvent[] = Array.isArray(json?.result) ? json.result : [];
    if (list.length > 0) {
      cachedTradingViewUsEvents = { fetchedAt: Date.now(), events: list };
    }
    return list;
  } catch {
    return cachedTradingViewUsEvents?.events || [];
  }
}

function formatTradingViewActualString(
  rawActual: number,
  tvItem: TradingViewCalEvent,
  ffUnit: string
): { formatted: string; numericVal: number; unit: string } {
  const tvUnit = String(tvItem.unit || '').trim();
  const tvScale = String(tvItem.scale || '').trim();

  if (ffUnit === 'K' && !tvScale && Math.abs(rawActual) >= 1000) {
    const kVal = Number((rawActual / 1000).toFixed(1));
    return { formatted: `${kVal}K`, numericVal: kVal, unit: 'K' };
  }

  const effectiveUnit =
    tvUnit === '%'
      ? '%'
      : tvScale === 'K' || tvScale === 'M' || tvScale === 'B'
      ? tvScale
      : ffUnit || tvUnit || tvScale || '';

  return {
    formatted: `${rawActual}${effectiveUnit}`,
    numericVal: rawActual,
    unit: effectiveUnit,
  };
}

function matchTradingViewActualForEvent(
  ffTitle: string,
  ffDateIso: string,
  ffPreviousNum: number | null,
  ffUnit: string,
  tvEvents: TradingViewCalEvent[]
): { formatted: string; numericVal: number; unit: string } | null {
  const evMs = new Date(ffDateIso).getTime();
  if (!Number.isFinite(evMs) || evMs > Date.now() - 2 * 60 * 1000) return null;

  const t = ffTitle.toLowerCase();
  if (isFedSpeechEvent(ffTitle) || /bank holiday|speaks|press conference|minutes|statement/i.test(t)) {
    return null;
  }

  const ffIsCore = /\bcore\b/i.test(t);
  const ffIsMom = /\bm\/m\b/i.test(t);
  const ffIsYoy = /\by\/y\b/i.test(t);
  const ffIsQoq = /\bq\/q\b/i.test(t);

  let bestScore = 0;
  let bestCandidate: TradingViewCalEvent | null = null;

  for (const tv of tvEvents) {
    if (tv.actual === null || tv.actual === undefined || !Number.isFinite(Number(tv.actual))) continue;
    const tvMs = new Date(String(tv.date || '')).getTime();
    if (!Number.isFinite(tvMs) || Math.abs(tvMs - evMs) > 35 * 60 * 1000) continue;

    const tvTitle = String(tv.title || '').toLowerCase();
    const tvInd = String(tv.indicator || '').toLowerCase();
    const tvText = `${tvTitle} ${tvInd}`;
    const tvUnit = String(tv.unit || '').trim();
    const tvScale = String(tv.scale || '').trim();

    // Strict unit & scale compatibility
    if (ffUnit === '%' && tvUnit !== '%') continue;
    if ((ffUnit === 'K' || ffUnit === 'M' || ffUnit === 'B') && tvUnit === '%') continue;

    // Strict period compatibility
    const tvIsMom = /\bmom\b|\bmm\b|\bm\/m\b/i.test(tvText);
    const tvIsYoy = /\byoy\b|\byy\b|\by\/y\b/i.test(tvText);
    const tvIsQoq = /\bqoq\b|\bqq\b|\bq\/q\b/i.test(tvText);
    if (ffIsMom && !tvIsMom) continue;
    if (ffIsYoy && !tvIsYoy) continue;
    if (ffIsQoq && !tvIsQoq) continue;

    // Strict Core vs Headline distinction
    const tvIsCore = /\bcore\b|ex\s*food|exfood|ex\s*autos/i.test(tvText);
    if (ffIsCore !== tvIsCore) continue;

    let score = 0;
    if (/\bcpi\b/i.test(t)) {
      if (tvText.includes('cleveland') || tvText.includes('cpi-w') || tvText.includes('nsa')) continue;
      if (tvText.includes('inflation rate') || tvText.includes('cpi')) score += 60;
    } else if (/\bppi\b/i.test(t)) {
      if (tvText.includes('machinery') || tvText.includes('trade services')) continue;
      if (tvText.includes('ppi') || tvText.includes('producer price')) score += 60;
    } else if (/\bpce\b/i.test(t)) {
      if (tvText.includes('pce') || tvText.includes('personal consumption')) score += 60;
    } else if (t.includes('unemployment claims') || t.includes('initial jobless claims')) {
      if (tvText.includes('continuing') || tvText.includes('4-week')) continue;
      if (tvText.includes('initial jobless')) score += 70;
    } else if (t.includes('non-farm employment change') || t === 'nfp') {
      if (tvText.includes('non farm payrolls') || tvText.includes('nonfarm')) score += 70;
    } else if (t.includes('adp weekly')) {
      if (tvText.includes('adp') && tvText.includes('weekly')) score += 65;
    } else if (t.includes('adp non-farm')) {
      if (!tvText.includes('weekly') && tvText.includes('adp employment')) score += 65;
    } else if (t.includes('unemployment rate')) {
      if (tvText.includes('unemployment rate')) score += 70;
    } else if (t.includes('average hourly earnings')) {
      if (tvText.includes('average hourly earnings')) score += 65;
    } else if (t.includes('retail sales')) {
      if (tvText.includes('retail sales')) score += 60;
    } else if (t.includes('gdp price index')) {
      if (tvText.includes('gdp price')) score += 65;
    } else if (/\bgdp\b/i.test(t)) {
      if (tvText.includes('gdp growth')) score += 65;
    } else if (t.includes('ism manufacturing pmi')) {
      if (tvText.includes('ism manufacturing pmi')) score += 70;
    } else if (t.includes('ism services pmi')) {
      if (tvText.includes('ism services pmi')) score += 70;
    } else if (t.includes('existing home sales')) {
      if (tvText.includes('existing home sales')) score += 65;
    } else if (t.includes('new home sales')) {
      if (tvText.includes('new home sales')) score += 65;
    } else if (t.includes('federal budget balance')) {
      if (tvText.includes('monthly budget') || tvText.includes('federal budget')) score += 65;
    } else if (t.includes('crude oil inventories')) {
      if (tvText.includes('eia crude oil stocks change')) score += 65;
    } else if (t.includes('natural gas storage')) {
      if (tvText.includes('eia natural gas storage')) score += 65;
    } else if (t.includes('jolts job openings')) {
      if (tvText.includes('jolts job openings')) score += 65;
    } else {
      const stopWords = new Set(['m/m', 'y/y', 'q/q', 'us', 'final', 'prelim', 'advance', 'revised']);
      const ffTokens = t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
      const overlap = ffTokens.filter((w) => tvText.includes(w)).length;
      if (ffTokens.length > 0 && overlap >= Math.min(2, ffTokens.length)) {
        score += overlap * 20;
      }
    }

    if (score === 0) continue;

    // Bonus for exact timestamp and close previous number
    if (Math.abs(tvMs - evMs) <= 5 * 60 * 1000) score += 15;
    if (
      ffPreviousNum !== null &&
      tv.previous !== null &&
      tv.previous !== undefined &&
      Number.isFinite(Number(tv.previous))
    ) {
      const tvPrevNorm =
        ffUnit === 'K' && !tvScale && Math.abs(Number(tv.previous)) >= 1000
          ? Number(tv.previous) / 1000
          : Number(tv.previous);
      if (Math.abs(tvPrevNorm - ffPreviousNum) <= Math.max(0.2, Math.abs(ffPreviousNum) * 0.08)) {
        score += 15;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = tv;
    }
  }

  if (!bestCandidate || bestScore < 50) return null;
  return formatTradingViewActualString(Number(bestCandidate.actual), bestCandidate, ffUnit);
}

async function enrichEventsWithTradingViewActuals(events: MacroCalendarEvent[]): Promise<MacroCalendarEvent[]> {
  if (!events || events.length === 0) return events;
  const nowMs = Date.now();
  const needsEnrich = events.some(
    (ev) =>
      (!ev.actual || !ev.actual.trim()) &&
      !isFedSpeechEvent(ev.title) &&
      (ev.forecastNum !== null || ev.previousNum !== null) &&
      new Date(ev.date).getTime() < nowMs - 2 * 60 * 1000
  );
  if (!needsEnrich) return events;

  const times = events.map((e) => new Date(e.date).getTime()).filter((t) => Number.isFinite(t));
  const minMs = times.length > 0 ? Math.min(...times) : nowMs - 7 * 86400000;
  const maxMs = times.length > 0 ? Math.max(...times) : nowMs + 7 * 86400000;
  const tvEvents = await fetchTradingViewUsEventsWindow(minMs, maxMs);
  if (tvEvents.length === 0) return events;

  return events.map((ev) => {
    if (ev.actual && ev.actual.trim()) return ev;
    const matched = matchTradingViewActualForEvent(
      ev.title,
      ev.date,
      ev.previousNum,
      ev.unit,
      tvEvents
    );
    if (!matched) return ev;

    const evalResult = evaluateSingleEventForGold(
      ev.title,
      matched.numericVal,
      ev.forecastNum,
      ev.previousNum
    );
    return {
      ...ev,
      actual: matched.formatted,
      actualNum: matched.numericVal,
      unit: matched.unit || ev.unit,
      eventBiasForGold: evalResult.bias,
      biasReasonId: evalResult.reasonId,
      biasReasonEn: evalResult.reasonEn,
    };
  });
}

async function fetchForexFactoryUsdCalendar(): Promise<MacroCalendarEvent[]> {
  try {
    const [thisWeekList, nextWeekList] = await Promise.all([
      fetchSingleForexFactoryFeed(
        'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
        'https://nfs.faireconomy.media/ff_calendar_thisweek.xml'
      ),
      fetchSingleForexFactoryFeed(
        'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
        'https://nfs.faireconomy.media/ff_calendar_nextweek.xml'
      ),
    ]);

    let combinedRaw = [...thisWeekList, ...nextWeekList];
    const nowTs = Date.now();

    // Step A: Enrich missing past actuals using free public TradingView Economic Calendar API first (0 Gemini tokens)
    if (combinedRaw.length > 0) {
      const rawTimes = combinedRaw.map((i: any) => new Date(i.date || 0).getTime()).filter((t) => Number.isFinite(t));
      const tvEvents =
        rawTimes.length > 0
          ? await fetchTradingViewUsEventsWindow(Math.min(...rawTimes), Math.max(...rawTimes))
          : [];
      if (tvEvents.length > 0) {
        combinedRaw = combinedRaw.map((item: any) => {
          const currentAct = String(item.actual ?? '').trim();
          if (currentAct) return item;
          const prevParsed = parseMacroNumeric(String(item.previous ?? item.prev ?? ''));
          const fcstParsed = parseMacroNumeric(String(item.forecast ?? ''));
          const unit = fcstParsed.unit || prevParsed.unit || '';
          const matched = matchTradingViewActualForEvent(
            String(item.title || ''),
            String(item.date || ''),
            prevParsed.value,
            unit,
            tvEvents
          );
          return matched ? { ...item, actual: matched.formatted } : item;
        });
      }
    }

    const hasMissingPastActual = combinedRaw.some((item: any) => {
      const impact = String(item.impact || "").toLowerCase();
      const act = String(item.actual ?? "").trim();
      const evTs = new Date(item.date || 0).getTime();
      const hasNums = String(item.forecast ?? "").trim() || String(item.previous ?? item.prev ?? "").trim();
      return impact === "high" && !act && Boolean(hasNums) && !isFedSpeechEvent(String(item.title || "")) && !isNaN(evTs) && evTs < nowTs - 5 * 60 * 1000;
    });

    if (combinedRaw.length === 0) {
      // Fallback to Gemini Google Search Grounding if all direct & proxy feeds are blocked
      combinedRaw = await fetchForexFactoryCalendarViaGoogleSearch();
    } else if (hasMissingPastActual) {
      // Enrich past High-Impact releases whose actual values are still empty after TradingView
      const enrichedRaw = await fetchForexFactoryCalendarViaGoogleSearch();
      if (Array.isArray(enrichedRaw) && enrichedRaw.length > 0) {
        const enrichedMap = new Map<string, string>();
        for (const eItem of enrichedRaw) {
          const eAct = String(eItem.actual ?? "").trim();
          if (eAct) {
            enrichedMap.set(String(eItem.title || "").trim().toLowerCase(), eAct);
          }
        }
        combinedRaw = combinedRaw.map((item: any) => {
          const currentAct = String(item.actual ?? "").trim();
          if (!currentAct) {
            const matchedAct = enrichedMap.get(String(item.title || "").trim().toLowerCase());
            if (matchedAct) {
              return { ...item, actual: matchedAct };
            }
          }
          return item;
        });
      }
    }
    if (combinedRaw.length === 0) {
      return [];
    }

    const filtered = combinedRaw.filter((item: any) => isRelevantUsdMacroEvent(item));
    if (filtered.length === 0) {
      return [];
    }

    const seenKeys = new Set<string>();
    const dedupedRaw: any[] = [];
    for (const item of filtered) {
      const titleKey = String(item.title || '').trim().toLowerCase();
      let isoKey = String(item.date || '');
      try {
        const d = new Date(item.date);
        if (!isNaN(d.getTime())) {
          isoKey = d.toISOString().slice(0, 16);
        }
      } catch {
        // ignore
      }
      const uniqueKey = `${titleKey}|${isoKey}`;
      if (!seenKeys.has(uniqueKey)) {
        seenKeys.add(uniqueKey);
        dedupedRaw.push(item);
      }
    }

    dedupedRaw.sort((a: any, b: any) => {
      const ta = new Date(a.date || 0).getTime();
      const tb = new Date(b.date || 0).getTime();
      return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
    });

    return dedupedRaw.slice(0, 90).map((item: any, idx: number) => {
      const title = String(item.title || '').trim();
      const previous = String(item.previous ?? item.prev ?? '').trim();
      const forecast = String(item.forecast ?? '').trim();
      const actual = String(item.actual ?? '').trim();

      const prevParsed = parseMacroNumeric(previous);
      const fcstParsed = parseMacroNumeric(forecast);
      const actParsed = parseMacroNumeric(actual);

      const evalResult = evaluateSingleEventForGold(
        title,
        actParsed.value,
        fcstParsed.value,
        prevParsed.value
      );

      const rawImpact = String(item.impact || 'Medium').trim();
      const impact: 'High' | 'Medium' | 'Low' =
        rawImpact === 'High' ? 'High' : rawImpact === 'Low' ? 'Low' : 'Medium';

      let isoDate = new Date().toISOString();
      if (item.date) {
        try {
          const parsed = new Date(item.date);
          if (!isNaN(parsed.getTime())) {
            isoDate = parsed.toISOString();
          }
        } catch {
          isoDate = String(item.date);
        }
      }

      const isPrimary = isPrimaryHighImpactEvent({
        title,
        impact,
        country: 'USD',
      });

      return {
        id: `ff-live-${idx + 1}-${title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}`,
        title,
        country: 'USD',
        date: isoDate,
        impact,
        previous: previous || '—',
        forecast: forecast || '—',
        actual: actual || '',
        previousNum: prevParsed.value,
        forecastNum: fcstParsed.value,
        actualNum: actParsed.value,
        unit: fcstParsed.unit || prevParsed.unit || actParsed.unit || '',
        pillar: classifyFomcPillar(title),
        isInverseIndicator: isInverseUsdIndicator(title),
        eventBiasForGold: evalResult.bias,
        biasReasonId: evalResult.reasonId,
        biasReasonEn: evalResult.reasonEn,
        isLiveFeed: true,
        eventCategory: isPrimary ? 'PRIMARY_HIGH_IMPACT' : 'SUPPORTING_REFERENCE',
      };
    });
  } catch {
    return [];
  }
}

async function fetchYahooAssetPulse(
  symbol: 'DXY' | 'USOIL' | 'US10Y' | 'US02Y',
  yahooTicker: string,
  name: string,
  _fallbackPrice: number,
  _fallbackPrevClose: number
): Promise<IntermarketAssetPulse> {
  let price = 0;
  let previousClose = 0;
  let hasLivePrice = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const encodedTicker = encodeURIComponent(yahooTicker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=5m&range=5d&_t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const meta = result?.meta;
      if (meta) {
        const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
        const rawCloses: any[] = result?.indicators?.quote?.[0]?.close || [];
        const validCloses = rawCloses
          .map((c, idx) => ({ close: Number(c), ts: timestamps[idx] }))
          .filter(
            (item) =>
              Number.isFinite(item.close) &&
              item.close > 0 &&
              (typeof item.ts !== 'number' ||
                isMarketDay(item.ts, { useUtc: true, enforceFridayCloseUtc: true }))
          )
          .map((item) => item.close);
        const latestCandleClose = validCloses.length > 0 ? validCloses[validCloses.length - 1] : NaN;
        const regPrice = Number(meta.regularMarketPrice);
        const effectivePrice =
          Number.isFinite(regPrice) && regPrice > 0 ? regPrice : latestCandleClose;

        // Prioritize daily previousClose over 5-day chartPreviousClose for accurate intraday change
        const dailyPrev = Number(meta.previousClose ?? meta.regularMarketPreviousClose);
        const chartPrev = Number(meta.chartPreviousClose);
        const prev =
          Number.isFinite(dailyPrev) && dailyPrev > 0
            ? dailyPrev
            : Number.isFinite(chartPrev) && chartPrev > 0
            ? chartPrev
            : effectivePrice;

        if (Number.isFinite(effectivePrice) && effectivePrice > 0) {
          price = effectivePrice;
          hasLivePrice = true;
          previousClose =
            Number.isFinite(prev) && prev > 0 && Math.abs(effectivePrice - prev) > 1e-6
              ? prev
              : Number.isFinite(chartPrev) && chartPrev > 0
              ? chartPrev
              : effectivePrice;
        }
      }
    }
  } catch {
    // Feed unavailable
  }

  if (!hasLivePrice) {
    return {
      symbol,
      yahooTicker,
      name,
      price: 0,
      previousClose: 0,
      change: 0,
      changePercent: 0,
      direction: 'FLAT',
      goldCorrelationEffect: 'NEUTRAL',
      summaryId: `${name} sementara tidak tersedia — skor netral`,
      summaryEn: `${name} temporarily unavailable — neutral score`,
      updatedAt: new Date().toISOString(),
      isAvailable: false,
    };
  }

  const change = Number((price - previousClose).toFixed(3));
  const changePercent =
    previousClose > 0 ? Number(((change / previousClose) * 100).toFixed(2)) : 0;

  const direction: 'UP' | 'DOWN' | 'FLAT' =
    changePercent > 0.03 ? 'UP' : changePercent < -0.03 ? 'DOWN' : 'FLAT';

  let goldCorrelationEffect: IntermarketAssetPulse['goldCorrelationEffect'] = 'NEUTRAL';
  let summaryId = '';
  let summaryEn = '';

  if (symbol === 'DXY') {
    goldCorrelationEffect =
      direction === 'UP' ? 'BEARISH_GOLD' : direction === 'DOWN' ? 'BULLISH_GOLD' : 'NEUTRAL';
    summaryId =
      direction === 'UP'
        ? 'Dolar AS menguat → Tekanan korelasi negatif (SELL XAU/USD)'
        : direction === 'DOWN'
        ? 'Dolar AS melemah → Dukungan korelasi positif (BUY XAU/USD)'
        : 'DXY bergerak mendatar menjelang rilis data';
    summaryEn =
      direction === 'UP'
        ? 'US Dollar strengthening → Inverse headwind (SELL XAU/USD)'
        : direction === 'DOWN'
        ? 'US Dollar softening → Inverse tailwind (BUY XAU/USD)'
        : 'DXY consolidating ahead of macro release';
  } else if (symbol === 'US02Y') {
    goldCorrelationEffect =
      direction === 'UP' ? 'BEARISH_GOLD' : direction === 'DOWN' ? 'BULLISH_GOLD' : 'NEUTRAL';
    summaryId =
      direction === 'UP'
        ? 'Imbal hasil Treasury 2Y naik → Sensitivitas suku bunga Fed Hawkish (SELL XAU/USD)'
        : direction === 'DOWN'
        ? 'Imbal hasil Treasury 2Y turun → Pelonggaran ekspektasi suku bunga Fed (BUY XAU/USD)'
        : 'Yield 2Y stabil menunggu keputusan suku bunga Fed';
    summaryEn =
      direction === 'UP'
        ? '2Y Treasury Yield rising → Front-end Fed Hawkish sensitivity (SELL XAU/USD)'
        : direction === 'DOWN'
        ? '2Y Treasury Yield falling → Front-end rate easing expectation (BUY XAU/USD)'
        : '2Y Yield flat awaiting Fed interest rate decision';
  } else if (symbol === 'US10Y') {
    goldCorrelationEffect =
      direction === 'UP' ? 'BEARISH_GOLD' : direction === 'DOWN' ? 'BULLISH_GOLD' : 'NEUTRAL';
    summaryId =
      direction === 'UP'
        ? 'Imbal hasil Treasury 10Y naik → Konfirmasi tekanan SELL XAU/USD'
        : direction === 'DOWN'
        ? 'Imbal hasil Treasury 10Y turun → Konfirmasi dorongan BUY XAU/USD'
        : 'Yield 10Y stabil menunggu katalis Fed';
    summaryEn =
      direction === 'UP'
        ? '10Y Treasury Yield rising → Confirms SELL XAU/USD pressure'
        : direction === 'DOWN'
        ? '10Y Treasury Yield falling → Confirms BUY XAU/USD support'
        : '10Y Yield flat awaiting Fed catalyst';
  } else {
    // USOIL Dual-Channel Rule
    goldCorrelationEffect =
      changePercent >= 1.0
        ? 'BEARISH_GOLD'
        : changePercent <= -1.0
        ? 'BULLISH_GOLD'
        : 'NEUTRAL';
    summaryId =
      changePercent >= 1.0
        ? 'Oil melonjak → Inflation Channel (Fed Hawkish / Tekanan SELL Gold)'
        : changePercent <= -1.0
        ? 'Oil melandai → Tekanan inflasi energi mereda (Dukungan BUY Gold)'
        : 'Harga WTI stabil; pantau eskalasi Selat Hormuz / Timur Tengah';
    summaryEn =
      changePercent >= 1.0
        ? 'Oil surging → Inflation Channel active (Hawkish Fed / SELL Gold)'
        : changePercent <= -1.0
        ? 'Oil cooling → Energy inflation pressure eases (BUY Gold support)'
        : 'WTI Crude stable; monitor Strait of Hormuz / Middle East headlines';
  }

  const decimals = symbol === 'USOIL' ? 2 : 3;

  return {
    symbol,
    yahooTicker,
    name,
    price: Number(price.toFixed(decimals)),
    previousClose: Number(previousClose.toFixed(decimals)),
    change,
    changePercent,
    direction,
    goldCorrelationEffect,
    summaryId,
    summaryEn,
    updatedAt: new Date().toISOString(),
    isAvailable: true,
  };
}

async function fetchServerVixPulse(): Promise<VixRiskPulse> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('^VIX')}?interval=5m&range=5d&_t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta) {
        const regPrice = Number(meta.regularMarketPrice);
        const prev = Number(meta.previousClose ?? meta.chartPreviousClose);
        if (Number.isFinite(regPrice) && regPrice > 0) {
          const previousClose = Number.isFinite(prev) && prev > 0 ? prev : regPrice;
          const changePercent =
            previousClose > 0 ? Number((((regPrice - previousClose) / previousClose) * 100).toFixed(2)) : 0;
          const direction: 'UP' | 'DOWN' | 'FLAT' =
            changePercent > 1.0 ? 'UP' : changePercent < -1.0 ? 'DOWN' : 'FLAT';
          return {
            yahooTicker: '^VIX',
            price: Number(regPrice.toFixed(2)),
            changePercent,
            direction,
            isAvailable: true,
          };
        }
      }
    }
  } catch {
    // Feed unavailable
  }

  return {
    yahooTicker: '^VIX',
    price: 0,
    changePercent: 0,
    direction: 'FLAT',
    isAvailable: false,
  };
}

async function fetchServerGoldPositioning(): Promise<GoldPositioningPulse> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('GC=F')}?interval=60m&range=5d&_t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const meta = result?.meta;
      const quote = result?.indicators?.quote?.[0] || {};
      const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
      const rawCloses: any[] = quote?.close || [];
      const rawHighs: any[] = quote?.high || [];
      const rawLows: any[] = quote?.low || [];

      const bars: Array<{ high: number; low: number; close: number }> = [];
      for (let i = 0; i < rawCloses.length; i++) {
        const ts = timestamps[i];
        if (
          typeof ts === 'number' &&
          !isMarketDay(ts, { useUtc: true, enforceFridayCloseUtc: true })
        ) {
          continue;
        }
        const c = Number(rawCloses[i]);
        const h = Number(rawHighs[i] ?? c);
        const l = Number(rawLows[i] ?? c);
        if (Number.isFinite(c) && c > 0) {
          bars.push({
            high: Number.isFinite(h) && h > 0 ? h : c,
            low: Number.isFinite(l) && l > 0 ? l : c,
            close: c,
          });
        }
      }

      const validCloses = bars.map((b) => b.close);
      const regPrice = Number(meta?.regularMarketPrice ?? validCloses[validCloses.length - 1]);

      if (Number.isFinite(regPrice) && regPrice > 0) {
        const idx3dAgo = validCloses.length >= 24 ? Math.max(0, validCloses.length - 72) : Math.max(0, validCloses.length - 4);
        const baseClose =
          validCloses.length >= 3
            ? validCloses[idx3dAgo]
            : Number(meta?.chartPreviousClose ?? meta?.previousClose ?? regPrice);
        const change3dPercent =
          Number.isFinite(baseClose) && baseClose > 0
            ? Number((((regPrice - baseClose) / baseClose) * 100).toFixed(2))
            : 0;

        const base6hClose =
          validCloses.length >= 7
            ? validCloses[validCloses.length - 7]
            : validCloses.length > 0
            ? validCloses[0]
            : regPrice;
        const change6hUsd =
          Number.isFinite(base6hClose) && base6hClose > 0
            ? Number((regPrice - base6hClose).toFixed(2))
            : 0;
        const change6hPercent =
          Number.isFinite(base6hClose) && base6hClose > 0
            ? Number((((regPrice - base6hClose) / base6hClose) * 100).toFixed(2))
            : 0;

        let atr14_1h = 12.0;
        if (bars.length >= 3) {
          const trs: number[] = [];
          const startIdx = Math.max(1, bars.length - 14);
          for (let i = startIdx; i < bars.length; i++) {
            const cur = bars[i];
            const prev = bars[i - 1];
            const tr = Math.max(
              cur.high - cur.low,
              Math.abs(cur.high - prev.close),
              Math.abs(cur.low - prev.close)
            );
            if (Number.isFinite(tr) && tr > 0) {
              trs.push(tr);
            }
          }
          if (trs.length > 0) {
            atr14_1h = Number((trs.reduce((a, b) => a + b, 0) / trs.length).toFixed(2));
          }
        }

        const state: GoldPositioningPulse['state'] =
          change3dPercent >= 1.8 ? 'CROWDED_HIGH' : change3dPercent <= -1.8 ? 'OVERSOLD_LOW' : 'NEUTRAL';

        const noteId =
          state === 'CROWDED_HIGH'
            ? `Emas (GC=F) sudah reli +${change3dPercent}% dalam 3–4 hari — posisi long ramai (waspada profit-taking / sell-the-fact).`
            : state === 'OVERSOLD_LOW'
            ? `Emas (GC=F) sudah terkoreksi ${change3dPercent}% dalam 3–4 hari — posisi oversold (waspada short squeeze saat rilis).`
            : `Posisi 3 hari GC=F netral (${change3dPercent >= 0 ? '+' : ''}${change3dPercent}%) — belum ada ekstrem run-up.`;
        const noteEn =
          state === 'CROWDED_HIGH'
            ? `Gold (GC=F) rallied +${change3dPercent}% over 3–4 days — crowded longs (watch for profit-taking / sell-the-fact).`
            : state === 'OVERSOLD_LOW'
            ? `Gold (GC=F) dropped ${change3dPercent}% over 3–4 days — oversold positioning (watch for short-covering squeeze).`
            : `GC=F 3-day positioning is balanced (${change3dPercent >= 0 ? '+' : ''}${change3dPercent}%) — no extreme run-up.`;

        return {
          yahooTicker: 'GC=F',
          price: Number(regPrice.toFixed(2)),
          change3dPercent,
          change6hUsd,
          change6hPercent,
          atr14_1h,
          state,
          isAvailable: true,
          noteId,
          noteEn,
        };
      }
    }
  } catch {
    // Feed unavailable
  }

  return {
    yahooTicker: 'GC=F',
    price: 0,
    change3dPercent: 0,
    change6hUsd: 0,
    change6hPercent: 0,
    atr14_1h: 12.0,
    state: 'NEUTRAL',
    isAvailable: false,
    noteId: 'Data posisi 3 hari GC=F tidak tersedia',
    noteEn: 'GC=F 3-day positioning unavailable',
  };
}

function parseRssXmlItems(
  xmlText: string,
  sourceName: string
): Array<{ title: string; source: string; pubDate: string; link?: string; description?: string }> {
  const items: Array<{
    title: string;
    source: string;
    pubDate: string;
    link?: string;
    description?: string;
  }> = [];
  if (!xmlText) return items;

  const itemMatches = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches.slice(0, 35)) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pubDateMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    if (titleMatch && titleMatch[1]) {
      items.push({
        title: titleMatch[1],
        source: sourceName,
        pubDate: pubDateMatch?.[1]?.trim() || new Date().toISOString(),
        link: linkMatch?.[1]?.trim(),
        description: descMatch?.[1]?.trim(),
      });
    }
  }
  return items;
}

function getFallbackBreakingHeadlines(): BreakingNewsHeadline[] {
  // Zero-Mock Policy: Never return fake/hardcoded headlines or fabricated FedWatch figures.
  return [];
}

async function fetchXmlTextFromUrls(urls: string[], timeoutMs = 5000): Promise<string> {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const xml = await res.text();
      if (xml && xml.includes('<item')) {
        return xml;
      }
    } catch {
      // Try next fallback URL for this source
    }
  }
  return '';
}

async function fetchPublicBreakingHeadlines(): Promise<{
  headlines: BreakingNewsHeadline[];
  rssFeedHealth: RssFeedHealthStatus;
}> {
  const feedConfigs: Array<{
    id: RssFeedSourceStatus['id'];
    name: string;
    urls: string[];
  }> = [
    {
      id: 'FINANCIAL_JUICE',
      name: 'FinancialJuice',
      urls: ['https://www.financialjuice.com/feed.ashx?xy=rss'],
    },
    {
      id: 'CNBC',
      name: 'CNBC Fed/Econ',
      urls: [
        'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
        'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
      ],
    },
    {
      id: 'MARKETWATCH',
      name: 'MarketWatch',
      urls: [
        'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
        'https://feeds.content.dowjones.io/public/rss/mw_topstories',
      ],
    },
    {
      id: 'FXSTREET',
      name: 'FXStreet',
      urls: [
        'https://www.fxstreet.com/rss/news',
        'https://news.google.com/rss/search?q=site:fxstreet.com+(gold+OR+XAUUSD+OR+Fed+OR+FOMC+OR+CPI+OR+PPI+OR+dollar+OR+yield)+when:1d&hl=en-US&gl=US&ceid=US:en',
      ],
    },
  ];

  const sourceStatuses: RssFeedSourceStatus[] = [];
  const combined: Array<{ title: string; source: string; pubDate: string; link?: string }> = [];

  try {
    const responses = await Promise.allSettled(
      feedConfigs.map(async (cfg) => {
        const xml = await fetchXmlTextFromUrls(cfg.urls, 5000);
        const parsed = parseRssXmlItems(xml, cfg.name);
        return { cfg, parsed };
      })
    );

    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      const cfg = feedConfigs[i];
      if (r.status === 'fulfilled' && Array.isArray(r.value.parsed) && r.value.parsed.length > 0) {
        combined.push(...r.value.parsed);
        sourceStatuses.push({
          id: cfg.id,
          name: cfg.name,
          active: true,
          itemCount: r.value.parsed.length,
        });
      } else {
        sourceStatuses.push({
          id: cfg.id,
          name: cfg.name,
          active: false,
          itemCount: 0,
        });
      }
    }

    const activeCount = sourceStatuses.filter((s) => s.active).length;
    const rssFeedHealth: RssFeedHealthStatus = {
      activeCount,
      totalCount: feedConfigs.length,
      sources: sourceStatuses,
      updatedAt: new Date().toISOString(),
    };

    const filtered = filterAndScoreBreakingHeadlines(combined);
    return {
      headlines: filtered.length > 0 ? filtered : getFallbackBreakingHeadlines(),
      rssFeedHealth,
    };
  } catch {
    return {
      headlines: getFallbackBreakingHeadlines(),
      rssFeedHealth: {
        activeCount: 0,
        totalCount: feedConfigs.length,
        sources: feedConfigs.map((c) => ({ id: c.id, name: c.name, active: false, itemCount: 0 })),
        updatedAt: new Date().toISOString(),
      },
    };
  }
}

function isIntermarketAssetLive(asset?: IntermarketAssetPulse | null): asset is IntermarketAssetPulse {
  return Boolean(asset && asset.isAvailable !== false && Number.isFinite(asset.price) && asset.price > 0);
}

function mergeIntermarketPulseSet(
  primary: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
  },
  secondary?: {
    dxy?: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil?: IntermarketAssetPulse;
    us10y?: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
  } | null,
  tertiary?: {
    dxy?: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil?: IntermarketAssetPulse;
    us10y?: IntermarketAssetPulse;
    vix?: VixRiskPulse;
    goldPositioning?: GoldPositioningPulse;
  } | null
): {
  dxy: IntermarketAssetPulse;
  us02y?: IntermarketAssetPulse;
  usoil: IntermarketAssetPulse;
  us10y: IntermarketAssetPulse;
  vix?: VixRiskPulse;
  goldPositioning?: GoldPositioningPulse;
} {
  const pickAsset = <T extends IntermarketAssetPulse | undefined>(a: T, b?: IntermarketAssetPulse, c?: IntermarketAssetPulse): T => {
    if (isIntermarketAssetLive(a)) return a;
    if (isIntermarketAssetLive(b)) return b as T;
    if (isIntermarketAssetLive(c)) return c as T;
    return a;
  };
  const pickAvailable = <T extends { isAvailable: boolean; price: number }>(a?: T, b?: T, c?: T): T | undefined => {
    if (a && a.isAvailable && Number.isFinite(a.price) && a.price > 0) return a;
    if (b && b.isAvailable && Number.isFinite(b.price) && b.price > 0) return b;
    if (c && c.isAvailable && Number.isFinite(c.price) && c.price > 0) return c;
    return a ?? b ?? c;
  };
  return {
    dxy: pickAsset(primary.dxy, secondary?.dxy, tertiary?.dxy),
    us02y: pickAsset(primary.us02y, secondary?.us02y, tertiary?.us02y),
    usoil: pickAsset(primary.usoil, secondary?.usoil, tertiary?.usoil),
    us10y: pickAsset(primary.us10y, secondary?.us10y, tertiary?.us10y),
    vix: pickAvailable(primary.vix, secondary?.vix, tertiary?.vix),
    goldPositioning: pickAvailable(primary.goldPositioning, secondary?.goldPositioning, tertiary?.goldPositioning),
  };
}

async function gatherMacroPublicFeeds(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedMacroFeeds &&
    cachedMacroFeeds.calendarEvents.length > 0 &&
    Date.now() - cachedMacroFeeds.fetchedAt < 60 * 1000
  ) {
    return cachedMacroFeeds;
  }

  const prevFeeds = cachedMacroFeeds;

  const [calendarEvents, dxy, us02y, usoil, us10y, vix, goldPositioning, rssBundle] = await Promise.all([
    fetchForexFactoryUsdCalendar(),
    fetchYahooAssetPulse('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 0, 0),
    fetchYahooAssetPulse('US02Y', '2YY=F', 'US 2Y Treasury Yield', 0, 0),
    fetchYahooAssetPulse('USOIL', 'CL=F', 'US Oil WTI Crude', 0, 0),
    fetchYahooAssetPulse('US10Y', '^TNX', 'US 10Y Treasury Yield', 0, 0),
    fetchServerVixPulse(),
    fetchServerGoldPositioning(),
    fetchPublicBreakingHeadlines(),
  ]);

  const breakingNews = rssBundle.headlines;
  const rssFeedHealth = rssBundle.rssFeedHealth;

  const mergedPulse = mergeIntermarketPulseSet(
    { dxy, us02y, usoil, us10y, vix, goldPositioning },
    prevFeeds?.intermarketPulse
  );

  const rawFedWatch = await fetchLiveCmeFedWatchWithGrounding(forceRefresh, mergedPulse.us10y);
  const resolvedFedWatch = rawFedWatch.isAvailable
    ? rawFedWatch
    : prevFeeds?.cmeFedWatch?.isAvailable
    ? prevFeeds.cmeFedWatch
    : rawFedWatch;

  const resolvedCalendar =
    calendarEvents.length > 0 ? calendarEvents : prevFeeds?.calendarEvents || [];
  const resolvedBreakingNews =
    breakingNews.length > 0 ? breakingNews : prevFeeds?.breakingNews || [];
  const resolvedRssHealth =
    rssFeedHealth.activeCount > 0 ? rssFeedHealth : prevFeeds?.rssFeedHealth || rssFeedHealth;

  const nextFeeds = {
    fetchedAt:
      calendarEvents.length > 0 ? Date.now() : (prevFeeds?.fetchedAt ?? Date.now()),
    calendarEvents: resolvedCalendar,
    intermarketPulse: mergedPulse,
    breakingNews: resolvedBreakingNews,
    rssFeedHealth: resolvedRssHealth,
    cmeFedWatch: resolvedFedWatch,
  };

  if (
    resolvedCalendar.length > 0 ||
    resolvedFedWatch.isAvailable ||
    isIntermarketAssetLive(mergedPulse.dxy) ||
    isIntermarketAssetLive(mergedPulse.us10y) ||
    isIntermarketAssetLive(mergedPulse.usoil) ||
    isIntermarketAssetLive(mergedPulse.us02y)
  ) {
    cachedMacroFeeds = nextFeeds;
  }

  return nextFeeds;
}

// Multi-Source Server-Side Anti-CORS RSS Aggregator endpoint
app.get('/api/macro-news/rss', async (_req, res) => {
  try {
    const rssBundle = await fetchPublicBreakingHeadlines();
    if (cachedMacroFeeds) {
      if (rssBundle.headlines.length > 0) {
        cachedMacroFeeds.breakingNews = rssBundle.headlines;
      }
      cachedMacroFeeds.rssFeedHealth = rssBundle.rssFeedHealth;
    }
    res.json({
      success: true,
      headlines: rssBundle.headlines,
      rssFeedHealth: rssBundle.rssFeedHealth,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Gagal mengambil RSS multi-sumber.',
    });
  }
});

// Real-Time Intermarket Pulse endpoint (0 Gemini tokens, always bypasses feed cache)
app.get('/api/macro-news/intermarket-live', async (_req, res) => {
  try {
    const [dxy, us02y, usoil, us10y, vix, goldPositioning] = await Promise.all([
      fetchYahooAssetPulse('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 0, 0),
      fetchYahooAssetPulse('US02Y', '2YY=F', 'US 2Y Treasury Yield', 0, 0),
      fetchYahooAssetPulse('USOIL', 'CL=F', 'US Oil WTI Crude', 0, 0),
      fetchYahooAssetPulse('US10Y', '^TNX', 'US 10Y Treasury Yield', 0, 0),
      fetchServerVixPulse(),
      fetchServerGoldPositioning(),
    ]);

    const mergedPulse = mergeIntermarketPulseSet(
      { dxy, us02y, usoil, us10y, vix, goldPositioning },
      cachedMacroFeeds?.intermarketPulse
    );

    if (cachedMacroFeeds) {
      cachedMacroFeeds.intermarketPulse = mergedPulse;
    }
    if (lastServerMacroSnapshot) {
      lastServerMacroSnapshot.intermarketPulse = mergedPulse;
    }

    res.json({
      success: true,
      intermarketPulse: mergedPulse,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Gagal mengambil kuotasi intermarket live.',
    });
  }
});

// Passive public feed check endpoint (0 Gemini tokens consumed)
app.get('/api/macro-news/feeds', async (_req, res) => {
  try {
    const feeds = await gatherMacroPublicFeeds(false);
    const deterministicSnap = computeDeterministicMacroSnapshot({
      calendarEvents: feeds.calendarEvents,
      intermarketPulse: feeds.intermarketPulse,
      breakingNews: feeds.breakingNews,
      cmeFedWatch: feeds.cmeFedWatch,
      sourceMode: lastServerMacroSnapshot ? lastServerMacroSnapshot.sourceMode : 'RULE_BASED_FALLBACK',
      modelUsed: lastServerMacroSnapshot ? lastServerMacroSnapshot.modelUsed : 'deterministic-playbook-v1',
    });
    deterministicSnap.isCalendarLiveFeed =
      feeds.calendarEvents.length > 0 && feeds.calendarEvents.every((e) => e.isLiveFeed === true);
    deterministicSnap.rssFeedHealth = feeds.rssFeedHealth;

    res.json({
      success: true,
      dataFingerprint: deterministicSnap.dataFingerprint,
      rssFeedHealth: feeds.rssFeedHealth,
      snapshot:
        lastServerMacroSnapshot &&
        lastServerMacroSnapshot.isCalendarLiveFeed &&
        lastServerMacroSnapshot.dataFingerprint === deterministicSnap.dataFingerprint &&
        isSnapshotFresh(lastServerMacroSnapshot, 30)
          ? {
              ...lastServerMacroSnapshot,
              intermarketPulse: feeds.intermarketPulse,
              rssFeedHealth: feeds.rssFeedHealth,
            }
          : deterministicSnap,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Gagal mengambil feed makro publik.',
    });
  }
});

// 90-day USD released actuals backfill endpoint (0 Gemini tokens)
let cachedHistoryBackfill: { fetchedAt: number; days: number; events: MacroCalendarEvent[] } | null = null;

app.get('/api/macro-news/history-backfill', async (req, res) => {
  try {
    const rawDays = Number(req.query.days ?? 90);
    const days = Number.isFinite(rawDays) ? Math.min(180, Math.max(7, Math.round(rawDays))) : 90;

    if (
      cachedHistoryBackfill &&
      cachedHistoryBackfill.days >= days &&
      Date.now() - cachedHistoryBackfill.fetchedAt < 15 * 60 * 1000 &&
      cachedHistoryBackfill.events.length > 0
    ) {
      return res.json({
        success: true,
        days,
        count: cachedHistoryBackfill.events.length,
        events: cachedHistoryBackfill.events,
      });
    }

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + 60 * 60 * 1000).toISOString();
    const tvUrl = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&countries=US`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const tvRes = await fetch(tvUrl, {
      cache: 'no-store',
      headers: {
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!tvRes.ok) {
      return res.json({
        success: cachedHistoryBackfill ? true : false,
        days,
        count: cachedHistoryBackfill?.events.length || 0,
        events: cachedHistoryBackfill?.events || [],
      });
    }

    const json = await tvRes.json();
    const rawList = Array.isArray(json?.result) ? json.result : [];
    const mappedEvents = mapRawTradingViewEventsToCalendarEvents(rawList, nowMs);
    if (mappedEvents.length > 0) {
      cachedHistoryBackfill = {
        fetchedAt: Date.now(),
        days,
        events: mappedEvents,
      };
    }

    res.json({
      success: true,
      days,
      count: mappedEvents.length,
      events: mappedEvents,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      events: [],
      error: err?.message || 'Gagal mengambil backfill arsip historis USD.',
    });
  }
});

// Full Macro News & Pre-News Scenario Matrix Analyzer

async function fetchPastActualsViaGoogleSearch(missingEvents: MacroCalendarEvent[], apiKey: string): Promise<Record<string, string>> {
  if (!apiKey || missingEvents.length === 0) return {};
  const listDesc = missingEvents
    .map((e) => `- "${e.title}" (Scheduled: ${e.date}, Forecast: ${e.forecast || "N/A"}, Previous: ${e.previous || "N/A"})`)
    .join("\n");
  const prompt = `Search the web for the official released ACTUAL economic data values for these US USD economic indicators that have already been published:\n${listDesc}\n\nReturn ONLY a raw JSON object mapping the exact event title to its released actual value string (for example: {"Core CPI m/m": "0.3%", "CPI m/m": "0.2%"}). If an event has genuinely not been released yet, omit it. Do not include markdown fences or explanation.`;

  const candidateModels = NEWS_MODEL_CASCADE;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
      retryOptions: { attempts: 1 },
    },
  });

  for (const model of candidateModels) {
    const cooldownUntil = newsQuotaCooldownUntilByModel.get(model) || 0;
    if (Date.now() < cooldownUntil) continue;

    try {
      const response = await withTimeoutAbort(
        (abortSignal) =>
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              abortSignal,
              tools: [{ googleSearch: {} }],
            },
          }),
        12_000,
        `Past Actuals Search (${model})`
      );

      const rawText = (response?.text || '').trim();
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim() && v.trim() !== "-" && !/menunggu|pending|n\/a/i.test(v)) {
          out[k.trim().toLowerCase()] = v.trim();
        }
      }
      return out;
    } catch (err: any) {
      if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
        newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
      }
      continue;
    }
  }
  return {};
}

app.post('/api/macro-news/analyze', async (req, res) => {
  try {
    const {
      forceRefresh = false,
      selectedEventId,
      clientFeeds,
    } = (req.body || {}) as {
      forceRefresh?: boolean;
      selectedEventId?: string;
      clientFeeds?: {
        calendarEvents?: MacroCalendarEvent[];
        intermarketPulse?: {
          dxy: IntermarketAssetPulse;
          us02y?: IntermarketAssetPulse;
          usoil: IntermarketAssetPulse;
          us10y: IntermarketAssetPulse;
          vix?: VixRiskPulse;
          goldPositioning?: GoldPositioningPulse;
        };
        breakingNews?: BreakingNewsHeadline[];
        rssFeedHealth?: RssFeedHealthStatus;
        cmeFedWatch?: CmeFedWatchState;
      };
    };

    let feeds: {
      calendarEvents: MacroCalendarEvent[];
      intermarketPulse: {
        dxy: IntermarketAssetPulse;
        usoil: IntermarketAssetPulse;
        us10y: IntermarketAssetPulse;
        us02y?: IntermarketAssetPulse;
        vix?: VixRiskPulse;
        goldPositioning?: GoldPositioningPulse;
      };
      breakingNews: BreakingNewsHeadline[];
      rssFeedHealth?: RssFeedHealthStatus;
      cmeFedWatch: CmeFedWatchState;
    };

    const hasVerifiedClientLiveCalendar =
      clientFeeds &&
      Array.isArray(clientFeeds.calendarEvents) &&
      clientFeeds.calendarEvents.length > 0 &&
      clientFeeds.calendarEvents.every(
        (e) => e.isLiveFeed === true && !String(e.id || '').startsWith('ff-usd-')
      );

    if (hasVerifiedClientLiveCalendar && isIntermarketAssetLive(clientFeeds?.intermarketPulse?.dxy) && !forceRefresh) {
      const needServerRss = !clientFeeds.breakingNews || clientFeeds.breakingNews.length === 0 || !clientFeeds.rssFeedHealth;
      const [serverFedWatch, enrichedClientCalendar, serverRssResult] = await Promise.all([
        fetchLiveCmeFedWatchWithGrounding(false, clientFeeds.intermarketPulse.us10y),
        enrichEventsWithTradingViewActuals(clientFeeds.calendarEvents!),
        needServerRss ? fetchPublicBreakingHeadlines() : Promise.resolve(null),
      ]);
      const cmeFedWatch = serverFedWatch.isAvailable
        ? serverFedWatch
        : clientFeeds.cmeFedWatch?.isAvailable
        ? evaluateCmeFedWatchScoring(clientFeeds.cmeFedWatch)
        : serverFedWatch;
      feeds = {
        calendarEvents: enrichedClientCalendar,
        intermarketPulse: clientFeeds.intermarketPulse,
        breakingNews:
          clientFeeds.breakingNews && clientFeeds.breakingNews.length > 0
            ? clientFeeds.breakingNews
            : serverRssResult?.headlines || [],
        rssFeedHealth: clientFeeds.rssFeedHealth || serverRssResult?.rssFeedHealth,
        cmeFedWatch,
      };
    } else {
      const serverFeeds = await gatherMacroPublicFeeds(Boolean(forceRefresh));
      // Wajib lengkapi actual rilis yang sudah lewat via TradingView terlebih dahulu, lalu Google Search jika masih ada High-Impact kosong
      const enrichPastMissingActuals = async (events: MacroCalendarEvent[]): Promise<MacroCalendarEvent[]> => {
        const tvEnriched = await enrichEventsWithTradingViewActuals(events);
        const nowMs = Date.now();
        const missing = tvEnriched.some(
          (ev) =>
            ev.impact === 'High' &&
            !isFedSpeechEvent(ev.title) &&
            (ev.forecastNum !== null || ev.previousNum !== null) &&
            (!ev.actual || !ev.actual.trim()) &&
            new Date(ev.date).getTime() < nowMs - 5 * 60 * 1000
        );
        if (!missing) return tvEnriched;
        try {
          const searched = await fetchForexFactoryCalendarViaGoogleSearch();
          if (!Array.isArray(searched) || searched.length === 0) return tvEnriched;
          const map = new Map<string, string>();
          for (const item of searched) {
            const a = String(item.actual ?? '').trim();
            if (a) map.set(String(item.title || '').trim().toLowerCase(), a);
          }
          return tvEnriched.map((ev) => {
            if (!ev.actual || !ev.actual.trim()) {
              const found = map.get(ev.title.trim().toLowerCase());
              if (found) {
                const parsed = parseMacroNumeric(found);
                const evalResult = evaluateSingleEventForGold(
                  ev.title,
                  parsed.value,
                  ev.forecastNum,
                  ev.previousNum
                );
                return {
                  ...ev,
                  actual: found,
                  actualNum: parsed.value,
                  unit: parsed.unit || ev.unit,
                  eventBiasForGold: evalResult.bias,
                  biasReasonId: evalResult.reasonId,
                  biasReasonEn: evalResult.reasonEn,
                };
              }
            }
            return ev;
          });
        } catch (err: any) {
          console.warn('[MacroEnrich] Gagal enrich actual:', String(err?.message || err).replace(/\s+/g, ' ').slice(0, 180));
          return tvEnriched;
        }
      };

      const cmeFedWatch = serverFeeds.cmeFedWatch.isAvailable
        ? serverFeeds.cmeFedWatch
        : clientFeeds?.cmeFedWatch?.isAvailable
        ? evaluateCmeFedWatchScoring(clientFeeds.cmeFedWatch)
        : cachedCmeFedWatch?.data?.isAvailable
        ? cachedCmeFedWatch.data
        : serverFeeds.cmeFedWatch;

      const resolvedCalendar = await enrichPastMissingActuals(
        serverFeeds.calendarEvents.length > 0
          ? serverFeeds.calendarEvents
          : Array.isArray(clientFeeds?.calendarEvents) && clientFeeds!.calendarEvents!.length > 0
          ? clientFeeds!.calendarEvents!
          : cachedMacroFeeds?.calendarEvents || []
      );

      const resolvedIntermarket = mergeIntermarketPulseSet(
        serverFeeds.intermarketPulse,
        clientFeeds?.intermarketPulse,
        cachedMacroFeeds?.intermarketPulse
      );

      feeds = {
        calendarEvents: resolvedCalendar,
        intermarketPulse: resolvedIntermarket,
        breakingNews:
          serverFeeds.breakingNews.length > 0
            ? serverFeeds.breakingNews
            : clientFeeds?.breakingNews && clientFeeds.breakingNews.length > 0
            ? clientFeeds.breakingNews
            : cachedMacroFeeds?.breakingNews || [],
        rssFeedHealth:
          serverFeeds.rssFeedHealth ||
          clientFeeds?.rssFeedHealth ||
          cachedMacroFeeds?.rssFeedHealth,
        cmeFedWatch,
      };
    }

    const resolvedNewsKey = getNewsGeminiApiKeys()[0] || '';
    const nowCutoffMs = Date.now() - 5 * 60 * 1000;
    const pastMissing = (feeds.calendarEvents || []).filter(
      (ev) =>
        (!ev.actual || !ev.actual.trim()) &&
        !isFedSpeechEvent(ev.title) &&
        (ev.forecastNum !== null || ev.previousNum !== null) &&
        new Date(ev.date).getTime() < nowCutoffMs
    );
    if (pastMissing.length > 0 && resolvedNewsKey) {
      const actualMap = await fetchPastActualsViaGoogleSearch(pastMissing, resolvedNewsKey);
      if (Object.keys(actualMap).length > 0) {
        feeds.calendarEvents = feeds.calendarEvents.map((ev) => {
          if (!ev.actual || !ev.actual.trim()) {
            const found = actualMap[ev.title.trim().toLowerCase()];
            if (found) {
              const parsed = parseMacroNumeric(found);
              const evalResult = evaluateSingleEventForGold(
                ev.title,
                parsed.value,
                ev.forecastNum,
                ev.previousNum
              );
              return {
                ...ev,
                actual: found,
                actualNum: parsed.value,
                unit: parsed.unit || ev.unit,
                eventBiasForGold: evalResult.bias,
                biasReasonId: evalResult.reasonId,
                biasReasonEn: evalResult.reasonEn,
              };
            }
          }
          return ev;
        });
      }
    }

    // Step 1: Always compute the deterministic Master Playbook baseline first
    const baselineSnapshot = computeDeterministicMacroSnapshot({
      calendarEvents: feeds.calendarEvents,
      intermarketPulse: feeds.intermarketPulse,
      breakingNews: feeds.breakingNews,
      cmeFedWatch: feeds.cmeFedWatch,
      selectedEventId,
      sourceMode: 'RULE_BASED_FALLBACK',
      modelUsed: 'deterministic-playbook-v1',
      priorCalendarEvents: cachedMacroFeeds?.calendarEvents,
    });
    baselineSnapshot.isCalendarLiveFeed =
      feeds.calendarEvents.length > 0 && feeds.calendarEvents.every((e) => e.isLiveFeed === true);
    baselineSnapshot.analyzedAt = new Date().toISOString();
    baselineSnapshot.rssFeedHealth = feeds.rssFeedHealth;

    // Step 2: If not forced and we already have a fresh server AI snapshot (< 30 mins) with matching fingerprint & event, return it with fresh intermarketPulse (0 Gemini tokens)
    if (
      !forceRefresh &&
      lastServerMacroSnapshot &&
      isSnapshotFresh(lastServerMacroSnapshot, 30) &&
      lastServerMacroSnapshot.dataFingerprint === baselineSnapshot.dataFingerprint &&
      (!selectedEventId ||
        lastServerMacroSnapshot.scenarioMatrix.primaryEvent.id === selectedEventId)
    ) {
      res.json({
        success: true,
        cached: true,
        snapshot: {
          ...lastServerMacroSnapshot,
          intermarketPulse: feeds.intermarketPulse,
          rssFeedHealth: feeds.rssFeedHealth || lastServerMacroSnapshot.rssFeedHealth,
        },
      });
      return;
    }

    // Step 3: Strictly Isolated API Key Lookup (ONLY GEMINI_NEWS_API_KEY — never touches GEMINI_API_KEY used by Scan Kilat!)
    const newsApiKey = getNewsGeminiApiKeys()[0] || '';

    if (!newsApiKey) {
      lastServerMacroSnapshot = baselineSnapshot;
      res.json({
        success: true,
        fallbackUsed: true,
        snapshot: baselineSnapshot,
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: newsApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
        retryOptions: { attempts: 1 },
      },
    });

    const candidateModels = NEWS_MODEL_CASCADE;

    const recentReleasedActuals = feeds.calendarEvents
      .filter(
        (ev) =>
          ev.id !== baselineSnapshot.scenarioMatrix.primaryEvent.id &&
          ev.actualNum !== null &&
          new Date(ev.date).getTime() <= Date.now()
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);
    const mergedSupportMap = new Map<string, MacroCalendarEvent>();
    for (const ev of [...recentReleasedActuals, ...getSupportingContextEvents(feeds.calendarEvents)]) {
      const k = ev.id || `${ev.title}|${ev.date}`;
      if (!mergedSupportMap.has(k)) mergedSupportMap.set(k, ev);
    }

    const promptPayload = {
      primaryEvent: baselineSnapshot.scenarioMatrix.primaryEvent,
      simultaneousEvents: baselineSnapshot.scenarioMatrix.simultaneousEvents,
      supportingContextEvents: Array.from(mergedSupportMap.values())
        .slice(0, 14)
        .map((ev) => ({
          title: ev.title,
          date: ev.date,
          impact: ev.impact,
          previous: ev.previous,
          forecast: ev.forecast,
          actual: ev.actual,
          eventBiasForGold: ev.eventBiasForGold,
          biasReasonId: ev.biasReasonId,
        })),
      cmeFedWatch: feeds.cmeFedWatch,
      intermarketPulse: {
        dxy: {
          price: feeds.intermarketPulse.dxy.price,
          changePercent: feeds.intermarketPulse.dxy.changePercent,
          direction: feeds.intermarketPulse.dxy.direction,
        },
        usoil: {
          price: feeds.intermarketPulse.usoil.price,
          changePercent: feeds.intermarketPulse.usoil.changePercent,
          direction: feeds.intermarketPulse.usoil.direction,
        },
        us10y: {
          price: feeds.intermarketPulse.us10y.price,
          changePercent: feeds.intermarketPulse.us10y.changePercent,
          direction: feeds.intermarketPulse.us10y.direction,
        },
        us02y: feeds.intermarketPulse.us02y ? {
          price: feeds.intermarketPulse.us02y.price,
          changePercent: feeds.intermarketPulse.us02y.changePercent,
          direction: feeds.intermarketPulse.us02y.direction,
        } : undefined,
        vix: feeds.intermarketPulse.vix?.isAvailable ? feeds.intermarketPulse.vix : undefined,
        goldPositioning: feeds.intermarketPulse.goldPositioning?.isAvailable ? feeds.intermarketPulse.goldPositioning : undefined,
      },
      preNewsFlow: baselineSnapshot.scenarioMatrix.preNewsFlow,
      breakingHeadlines: feeds.breakingNews.slice(0, 10).map((h) => ({
        title: h.title,
        keywords: h.matchedKeywords,
        channel: h.channelType,
      })),
      deterministicBaseline: {
        buyProbability: baselineSnapshot.scenarioMatrix.buyProbability,
        sellProbability: baselineSnapshot.scenarioMatrix.sellProbability,
        mixedProbability: baselineSnapshot.scenarioMatrix.mixedProbability,
        dominantBias: baselineSnapshot.scenarioMatrix.dominantBias,
        dynamicPivotTriggered: baselineSnapshot.scenarioMatrix.dynamicPivotTriggered,
        evaluationMode: baselineSnapshot.scenarioMatrix.evaluationMode || 'INDIVIDUAL_RELEASE',
        hasSpeechEvent: baselineSnapshot.scenarioMatrix.dualHorizon?.hasSpeechEvent ?? false,
        speechEventsNearby: baselineSnapshot.scenarioMatrix.dualHorizon?.speechEventsNearby ?? [],
        isPricedIn: baselineSnapshot.scenarioMatrix.dualHorizon?.isPricedIn ?? false,
        move6hUsd: baselineSnapshot.scenarioMatrix.dualHorizon?.move6hUsd ?? 0,
        atr14_1h: baselineSnapshot.scenarioMatrix.dualHorizon?.atr14_1h ?? 12.0,
        movementType: baselineSnapshot.scenarioMatrix.dualHorizon?.movementType ?? 'TWO_WAY_SWEEP_FIRST',
        movementBadgeId: baselineSnapshot.scenarioMatrix.dualHorizon?.movementBadgeId ?? 'TIPE PERGERAKAN: [2 ARAH — SWEEP FIRST]',
      },
    };

    let aiResponseText = '';
    let usedModel = '';

    for (const model of candidateModels) {
      const cooldownUntil = newsQuotaCooldownUntilByModel.get(model) || 0;
      if (Date.now() < cooldownUntil) continue;

      try {
        const response = await withTimeoutAbort(
          (abortSignal) =>
            ai.models.generateContent({
              model,
              contents: `Analyze this real-time XAU/USD macro dataset (including CME FedWatch probabilities, simultaneous USD High-Impact events, and preNewsFlow intelligence such as Leading Indicator Chain, Consensus Tightness, 2s10s Yield Curve Spread, VIX risk regime, Gold 3-day GC=F positioning, and FOMC Blackout window while strictly preserving Master Playbook rules) and return the structured JSON Scenario Matrix in both Bahasa Indonesia (Id) and English (En):\n${JSON.stringify(
                promptPayload
              )}`,
              config: {
                abortSignal,
                systemInstruction: XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    impactLevel: {
                      type: Type.STRING,
                      description: 'HIGH, MEDIUM, or LOW',
                    },
                    dominantBias: {
                      type: Type.STRING,
                      description: 'BUY, SELL, or MIXED',
                    },
                    buyProbability: {
                      type: Type.INTEGER,
                      description: 'Estimated BUY XAU/USD probability percentage (0-100)',
                    },
                    sellProbability: {
                      type: Type.INTEGER,
                      description: 'Estimated SELL XAU/USD probability percentage (0-100)',
                    },
                    mixedProbability: {
                      type: Type.INTEGER,
                      description: 'Estimated MIXED/WHIPSAW probability percentage (0-100)',
                    },
                    dynamicPivotTriggered: {
                      type: Type.BOOLEAN,
                      description: 'True if Dynamic Pivot Rule (Aturan Pindah Haluan) flipped bias to 1-Way SELL',
                    },
                    topBreakingEvalId: {
                      type: Type.STRING,
                      description: 'Concise Bahasa Indonesia AI evaluation of the top breaking news headline',
                    },
                    topBreakingEvalEn: {
                      type: Type.STRING,
                      description: 'Concise English AI evaluation of the top breaking news headline',
                    },
                    finalTakeId: {
                      type: Type.STRING,
                      description: 'Decisive Bahasa Indonesia final conclusion for XAU/USD based on the 3 FOMC Pillars, CME FedWatch, and Intermarket correlation',
                    },
                    finalTakeEn: {
                      type: Type.STRING,
                      description: 'Decisive English final conclusion for XAU/USD based on the 3 FOMC Pillars, CME FedWatch, and Intermarket correlation',
                    },
                    actionPlanId: {
                      type: Type.STRING,
                      description: 'Step-by-step tactical execution plan in Bahasa Indonesia',
                    },
                    actionPlanEn: {
                      type: Type.STRING,
                      description: 'Step-by-step tactical execution plan in English',
                    },
                    whipsawWarningId: {
                      type: Type.STRING,
                      description: 'Whipsaw / fake move risk warning in Bahasa Indonesia',
                    },
                    whipsawWarningEn: {
                      type: Type.STRING,
                      description: 'Whipsaw / fake move risk warning in English',
                    },
                    institutionalDeskThesisId: {
                      type: Type.STRING,
                      description: 'Concise Institutional Desk Thesis in Bahasa Indonesia covering cross-asset confirmation (DXY, US02Y, US10Y, USOIL), priced-in positioning, and pivot condition',
                    },
                    institutionalDeskThesisEn: {
                      type: Type.STRING,
                      description: 'Concise Institutional Desk Thesis in English covering cross-asset confirmation (DXY, US02Y, US10Y, USOIL), priced-in positioning, and pivot condition',
                    },
                    phase1Minute0to5Id: {
                      type: Type.STRING,
                      description: 'Fase 1 (Menit 0–5 Rilis): Initial sweep/push direction in Bahasa Indonesia, including warnings if IS_PRICED_IN or HAS_SPEECH_EVENT is active',
                    },
                    phase1Minute0to5En: {
                      type: Type.STRING,
                      description: 'Phase 1 (Minute 0–5 Release): Initial sweep/push direction in English, including warnings if IS_PRICED_IN or HAS_SPEECH_EVENT is active',
                    },
                    phase2Minute15PlusId: {
                      type: Type.STRING,
                      description: 'Fase 2 (Menit 15+ / Lanjutan): Primary institutional expansion direction in Bahasa Indonesia after intraday liquidity is swept',
                    },
                    phase2Minute15PlusEn: {
                      type: Type.STRING,
                      description: 'Phase 2 (Minute 15+ / Continuation): Primary institutional expansion direction in English after intraday liquidity is swept',
                    },
                  },
                  required: [
                    'impactLevel',
                    'dominantBias',
                    'buyProbability',
                    'sellProbability',
                    'mixedProbability',
                    'finalTakeId',
                    'finalTakeEn',
                    'actionPlanId',
                    'actionPlanEn',
                  ],
                },
              },
            }),
          16_000,
          `Macro AI (${model})`
        );

        if (response && response.text) {
          aiResponseText = response.text;
          usedModel = model;
          break;
        }
      } catch (err: any) {
        if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
          newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
        }
        continue;
      }
    }

    // If Gemini hit 429 or failed, silently return the deterministic rule-based snapshot (zero user-facing error)
    if (!aiResponseText) {
      lastServerMacroSnapshot = baselineSnapshot;
      res.json({
        success: true,
        fallbackUsed: true,
        snapshot: baselineSnapshot,
      });
      return;
    }

    const aiParsed = parseAiJsonResponse(aiResponseText);
    let buyProb = Number(aiParsed.buyProbability);
    let sellProb = Number(aiParsed.sellProbability);
    let mixedProb = Number(aiParsed.mixedProbability);

    if (
      !Number.isFinite(buyProb) ||
      !Number.isFinite(sellProb) ||
      !Number.isFinite(mixedProb) ||
      buyProb + sellProb + mixedProb <= 0
    ) {
      buyProb = baselineSnapshot.scenarioMatrix.buyProbability;
      sellProb = baselineSnapshot.scenarioMatrix.sellProbability;
      mixedProb = baselineSnapshot.scenarioMatrix.mixedProbability;
    } else {
      const sum = buyProb + sellProb + mixedProb;
      buyProb = Math.round((buyProb / sum) * 100);
      sellProb = Math.round((sellProb / sum) * 100);
      mixedProb = Math.max(0, 100 - buyProb - sellProb);
    }

    const rawBias = String(aiParsed.dominantBias || '').toUpperCase();
    const dominantBias: 'BUY' | 'SELL' | 'MIXED' =
      rawBias === 'BUY' || rawBias === 'SELL' || rawBias === 'MIXED'
        ? rawBias
        : baselineSnapshot.dominantBias;

    const rawImpact = String(aiParsed.impactLevel || '').toUpperCase();
    const impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' =
      rawImpact === 'HIGH' || rawImpact === 'MEDIUM' || rawImpact === 'LOW'
        ? rawImpact
        : baselineSnapshot.impactLevel;

    const updatedTopAlert = baselineSnapshot.topBreakingAlert
      ? {
          ...baselineSnapshot.topBreakingAlert,
          aiEvaluationId:
            aiParsed.topBreakingEvalId || baselineSnapshot.topBreakingAlert.aiEvaluationId,
          aiEvaluationEn:
            aiParsed.topBreakingEvalEn || baselineSnapshot.topBreakingAlert.aiEvaluationEn,
        }
      : null;

    const isStrongOneWayBias = buyProb >= 60 || sellProb >= 60;
    const t5ExecutionTacticId = isStrongOneWayBias
      ? 'BIAS 1 ARAH KUAT (FINAL T-5M) — Siapkan setup dan kalkulasi lot di area struktur M1/M5 sebelum detik rilis, gunakan SL ketat.'
      : 'POTENSI SPIKE 2 ARAH / WHIPSAW (FINAL T-5M) — Tahan entry sebelum rilis; biarkan likuiditas 1–2 menit pertama tersapu terlebih dahulu.';
    const t5ExecutionTacticEn = isStrongOneWayBias
      ? 'STRONG 1-WAY BIAS (FINAL T-5M) — Prepare setup and lot calculation at M1/M5 structure zones before release second, use tight SL.'
      : 'TWO-WAY SPIKE / WHIPSAW RISK (FINAL T-5M) — Hold entry before release; let the first 1–2 minutes of liquidity sweep settle first.';

    const baseDualHorizon = computeDualHorizonAnalysis({
      breakingNews: feeds.breakingNews,
      goldPositioning:
        baselineSnapshot.scenarioMatrix.preNewsFlow?.goldPositioning ||
        feeds.intermarketPulse.goldPositioning,
      dominantBias,
      buyProbability: buyProb,
      sellProbability: sellProb,
      mixedProbability: mixedProb,
      cmeFedWatch: feeds.cmeFedWatch,
      dxy: feeds.intermarketPulse.dxy,
      us02y: feeds.intermarketPulse.us02y,
      us10y: feeds.intermarketPulse.us10y,
      primaryEvent: baselineSnapshot.scenarioMatrix.primaryEvent,
      isSimultaneousRelease: baselineSnapshot.scenarioMatrix.isSimultaneousRelease,
      simultaneousAlignment: baselineSnapshot.scenarioMatrix.simultaneousAlignment,
      calendarEvents: feeds.calendarEvents,
    });

    const updatedDualHorizon = {
      ...baseDualHorizon,
      phase1Minute0to5Id:
        typeof aiParsed.phase1Minute0to5Id === 'string' && aiParsed.phase1Minute0to5Id.trim()
          ? aiParsed.phase1Minute0to5Id.trim()
          : baseDualHorizon.phase1Minute0to5Id,
      phase1Minute0to5En:
        typeof aiParsed.phase1Minute0to5En === 'string' && aiParsed.phase1Minute0to5En.trim()
          ? aiParsed.phase1Minute0to5En.trim()
          : baseDualHorizon.phase1Minute0to5En,
      phase2Minute15PlusId:
        typeof aiParsed.phase2Minute15PlusId === 'string' && aiParsed.phase2Minute15PlusId.trim()
          ? aiParsed.phase2Minute15PlusId.trim()
          : baseDualHorizon.phase2Minute15PlusId,
      phase2Minute15PlusEn:
        typeof aiParsed.phase2Minute15PlusEn === 'string' && aiParsed.phase2Minute15PlusEn.trim()
          ? aiParsed.phase2Minute15PlusEn.trim()
          : baseDualHorizon.phase2Minute15PlusEn,
    };

    const enrichedSnapshot: MacroNewsSnapshot = {
      ...baselineSnapshot,
      analyzedAt: new Date().toISOString(),
      sourceMode: 'GEMINI_AI',
      modelUsed: usedModel || 'gemini-4-hydrogen',
      impactLevel,
      dominantBias,
      cmeFedWatch: feeds.cmeFedWatch,
      rssFeedHealth: feeds.rssFeedHealth,
      topBreakingAlert: updatedTopAlert,
      scenarioMatrix: {
        ...baselineSnapshot.scenarioMatrix,
        buyProbability: buyProb,
        sellProbability: sellProb,
        mixedProbability: mixedProb,
        dominantBias,
        dualHorizon: updatedDualHorizon,
        dynamicPivotTriggered:
          typeof aiParsed.dynamicPivotTriggered === 'boolean'
            ? aiParsed.dynamicPivotTriggered
            : baselineSnapshot.scenarioMatrix.dynamicPivotTriggered,
        finalTakeId: aiParsed.finalTakeId || baselineSnapshot.scenarioMatrix.finalTakeId,
        finalTakeEn: aiParsed.finalTakeEn || baselineSnapshot.scenarioMatrix.finalTakeEn,
        actionPlanId: aiParsed.actionPlanId || baselineSnapshot.scenarioMatrix.actionPlanId,
        actionPlanEn: aiParsed.actionPlanEn || baselineSnapshot.scenarioMatrix.actionPlanEn,
        whipsawWarningId:
          aiParsed.whipsawWarningId || baselineSnapshot.scenarioMatrix.whipsawWarningId,
        whipsawWarningEn: aiParsed.whipsawWarningEn || baselineSnapshot.scenarioMatrix.whipsawWarningEn,
        institutionalDeskThesisId: aiParsed.institutionalDeskThesisId || baselineSnapshot.scenarioMatrix.institutionalDeskThesisId,
        institutionalDeskThesisEn: aiParsed.institutionalDeskThesisEn || baselineSnapshot.scenarioMatrix.institutionalDeskThesisEn,
        t5ExecutionTacticId,
        t5ExecutionTacticEn,
        isStrongOneWayBias,
        cmeFedWatch: feeds.cmeFedWatch,
      },
    };

    lastServerMacroSnapshot = enrichedSnapshot;

    res.json({
      success: true,
      fallbackUsed: false,
      snapshot: enrichedSnapshot,
    });
  } catch (err: any) {
    // Even on unexpected server error, return deterministic fallback so the user never sees an error screen
    const fallbackFeeds = await gatherMacroPublicFeeds(false);
    const fallbackSnap = computeDeterministicMacroSnapshot({
      calendarEvents: fallbackFeeds.calendarEvents,
      intermarketPulse: fallbackFeeds.intermarketPulse,
      breakingNews: fallbackFeeds.breakingNews,
      cmeFedWatch: fallbackFeeds.cmeFedWatch,
      sourceMode: 'RULE_BASED_FALLBACK',
      modelUsed: 'deterministic-playbook-v1',
    });
    res.json({
      success: true,
      fallbackUsed: true,
      snapshot: fallbackSnap,
    });
  }
});

// ==========================================
// FUNDAMENTAL GOLD STRUCTURAL ENGINE ENDPOINTS
// ==========================================

let cachedFundamentalFeeds: { fetchedAt: number; feeds: FundamentalExtendedFeeds } | null = null;
let lastServerFundamentalGoldSnapshot: FundamentalGoldSnapshot | null = null;

function sanitizeNoBuySellServer(text: string): string {
  if (!text) return '';
  return text
    .replace(/\bSTRONG\s+BUY\b/gi, 'Strong Bullish')
    .replace(/\bSTRONG\s+SELL\b/gi, 'Strong Bearish')
    .replace(/\bBUY\b/g, 'Bullish')
    .replace(/\bbuy\b/g, 'bullish')
    .replace(/\bSELL\b/g, 'Bearish')
    .replace(/\bsell\b/g, 'bearish');
}

async function fetchServerExtendedYahooAsset(params: {
  symbol: string;
  yahooTicker: string;
  name: string;
  category: ExtendedMarketAssetPulse['category'];
  bullishWhenUp?: boolean;
}): Promise<ExtendedMarketAssetPulse> {
  const { symbol, yahooTicker, name, category, bullishWhenUp = false } = params;
  const unavailable = (): ExtendedMarketAssetPulse => ({
    symbol,
    yahooTicker,
    name,
    category,
    price: 0,
    previousClose: 0,
    changePercent: 0,
    change5dPercent: 0,
    change20dPercent: 0,
    direction: 'FLAT',
    effectOnGold: 'NEUTRAL',
    noteId: `${name} sementara tidak tersedia`,
    noteEn: `${name} temporarily unavailable`,
    isAvailable: false,
    updatedAt: new Date().toISOString(),
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1mo&_t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return unavailable();

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const rawCloses: any[] = result?.indicators?.quote?.[0]?.close || [];
    const closes = rawCloses.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const regPrice = Number(meta?.regularMarketPrice ?? closes[closes.length - 1]);
    if (!Number.isFinite(regPrice) || regPrice <= 0) return unavailable();

    const prevDaily = Number(
      meta?.previousClose ??
        meta?.regularMarketPreviousClose ??
        (closes.length >= 2 ? closes[closes.length - 2] : regPrice)
    );
    const previousClose = Number.isFinite(prevDaily) && prevDaily > 0 ? prevDaily : regPrice;
    const changePercent = Number((((regPrice - previousClose) / previousClose) * 100).toFixed(2));
    const idx5d = closes.length >= 6 ? closes[closes.length - 6] : closes[0] ?? previousClose;
    const change5dPercent =
      Number.isFinite(idx5d) && idx5d > 0
        ? Number((((regPrice - idx5d) / idx5d) * 100).toFixed(2))
        : 0;
    const idx20d = closes.length >= 1 ? closes[0] : previousClose;
    const change20dPercent =
      Number.isFinite(idx20d) && idx20d > 0
        ? Number((((regPrice - idx20d) / idx20d) * 100).toFixed(2))
        : 0;

    const direction: ExtendedMarketAssetPulse['direction'] =
      changePercent > 0.12 ? 'UP' : changePercent < -0.12 ? 'DOWN' : 'FLAT';

    const effectOnGold: ExtendedMarketAssetPulse['effectOnGold'] =
      direction === 'FLAT'
        ? 'NEUTRAL'
        : bullishWhenUp
        ? direction === 'UP'
          ? 'BULLISH'
          : 'BEARISH'
        : direction === 'UP'
        ? 'BEARISH'
        : 'BULLISH';

    return {
      symbol,
      yahooTicker,
      name,
      category,
      price: Number(regPrice.toFixed(regPrice >= 100 ? 2 : 3)),
      previousClose: Number(previousClose.toFixed(previousClose >= 100 ? 2 : 3)),
      changePercent,
      change5dPercent,
      change20dPercent,
      direction,
      effectOnGold,
      noteId: `${name}: ${changePercent >= 0 ? '+' : ''}${changePercent}% (1D), ${change5dPercent >= 0 ? '+' : ''}${change5dPercent}% (5D)`,
      noteEn: `${name}: ${changePercent >= 0 ? '+' : ''}${changePercent}% (1D), ${change5dPercent >= 0 ? '+' : ''}${change5dPercent}% (5D)`,
      isAvailable: true,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return unavailable();
  }
}

async function fetchServerCftcCotGold(): Promise<CftcCotGoldState> {
  const unavailable: CftcCotGoldState = {
    isAvailable: false,
    reportDate: '—',
    managedMoneyLong: 0,
    managedMoneyShort: 0,
    netSpeculativeContracts: 0,
    netPercentile1y: 50,
    crowdingState: 'NEUTRAL',
    noteId: 'Data CFTC COT mingguan sementara tidak tersedia',
    noteEn: 'Weekly CFTC COT positioning temporarily unavailable',
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    const url =
      'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=commodity_name=%27GOLD%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=52';
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return unavailable;

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return unavailable;

    const nets = rows.map(
      (r: any) =>
        (Number(r.noncomm_positions_long_all ?? r.m_money_positions_long_all ?? 0) || 0) -
        (Number(r.noncomm_positions_short_all ?? r.m_money_positions_short_all ?? 0) || 0)
    );
    const latest = rows[0];
    const latestLong = Math.round(
      Number(latest.noncomm_positions_long_all ?? latest.m_money_positions_long_all ?? 0) || 0
    );
    const latestShort = Math.round(
      Number(latest.noncomm_positions_short_all ?? latest.m_money_positions_short_all ?? 0) || 0
    );
    const latestNet = latestLong - latestShort;
    const minNet = Math.min(...nets);
    const maxNet = Math.max(...nets);
    const netPercentile1y =
      maxNet > minNet ? Math.round(((latestNet - minNet) / (maxNet - minNet)) * 100) : 50;
    const crowdingState: CftcCotGoldState['crowdingState'] =
      netPercentile1y >= 85
        ? 'EXTREME_LONG'
        : netPercentile1y >= 65
        ? 'ELEVATED_LONG'
        : netPercentile1y <= 25
        ? 'WASHED_OUT_SHORT'
        : 'NEUTRAL';
    const latestDate = String(latest.report_date_as_yyyy_mm_dd || '').slice(0, 10) || '—';

    return {
      isAvailable: true,
      reportDate: latestDate,
      managedMoneyLong: latestLong,
      managedMoneyShort: latestShort,
      netSpeculativeContracts: latestNet,
      netPercentile1y,
      crowdingState,
      noteId: `CFTC COT (${latestDate}): Posisi bersih institusi ${latestNet.toLocaleString()} kontrak (persentil ${netPercentile1y}/100 dalam 1 tahun).`,
      noteEn: `CFTC COT (${latestDate}): Institutional net position at ${latestNet.toLocaleString()} contracts (${netPercentile1y}th percentile over 1Y).`,
    };
  } catch {
    return unavailable;
  }
}

async function fetchServerExternalG10ChinaEvents(): Promise<ExternalG10ChinaEvent[]> {
  try {
    const raw = await fetchSingleForexFactoryFeed(
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      'https://nfs.faireconomy.media/ff_calendar_thisweek.xml'
    );
    return extractExternalG10AndChinaCalendarEvents(raw);
  } catch {
    return [];
  }
}

async function gatherServerFundamentalExtendedFeeds(
  forceRefresh = false
): Promise<FundamentalExtendedFeeds> {
  if (
    !forceRefresh &&
    cachedFundamentalFeeds &&
    Date.now() - cachedFundamentalFeeds.fetchedAt < 10 * 60 * 1000
  ) {
    return cachedFundamentalFeeds.feeds;
  }

  const [
    tipEtf,
    iefEtf,
    esFutures,
    nqFutures,
    moveIndex,
    gvzIndex,
    hygEtf,
    gldEtf,
    silverFutures,
    copperFutures,
    usdCnh,
    usdJpy,
    btcUsd,
    cotGold,
    externalEvents,
  ] = await Promise.all([
    fetchServerExtendedYahooAsset({ symbol: 'TIP', yahooTicker: 'TIP', name: 'TIPS Inflation-Protected Bond', category: 'REAL_YIELD', bullishWhenUp: true }),
    fetchServerExtendedYahooAsset({ symbol: 'IEF', yahooTicker: 'IEF', name: '7-10Y US Treasury ETF', category: 'REAL_YIELD', bullishWhenUp: true }),
    fetchServerExtendedYahooAsset({ symbol: 'ES', yahooTicker: 'ES=F', name: 'S&P 500 E-Mini Futures', category: 'EQUITY', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'NQ', yahooTicker: 'NQ=F', name: 'Nasdaq-100 Futures', category: 'EQUITY', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'MOVE', yahooTicker: '^MOVE', name: 'Treasury Bond Volatility (MOVE)', category: 'VOLATILITY', bullishWhenUp: true }),
    fetchServerExtendedYahooAsset({ symbol: 'GVZ', yahooTicker: '^GVZ', name: 'Gold ETF Volatility (GVZ)', category: 'VOLATILITY', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'HYG', yahooTicker: 'HYG', name: 'High-Yield Corporate Credit ETF', category: 'CREDIT_STRESS', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'GLD', yahooTicker: 'GLD', name: 'SPDR Gold Trust ETF', category: 'METALS_FLOW', bullishWhenUp: true }),
    fetchServerExtendedYahooAsset({ symbol: 'SILVER', yahooTicker: 'SI=F', name: 'Silver Futures', category: 'METALS_FLOW', bullishWhenUp: true }),
    fetchServerExtendedYahooAsset({ symbol: 'COPPER', yahooTicker: 'HG=F', name: 'Copper Futures', category: 'METALS_FLOW', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'USDCNH', yahooTicker: 'USDCNH=X', name: 'USD/CNH Offshore Yuan', category: 'FX_G10', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'USDJPY', yahooTicker: 'JPY=X', name: 'USD/JPY', category: 'FX_G10', bullishWhenUp: false }),
    fetchServerExtendedYahooAsset({ symbol: 'BTCUSD', yahooTicker: 'BTC-USD', name: 'Bitcoin USD', category: 'LIQUIDITY', bullishWhenUp: false }),
    fetchServerCftcCotGold(),
    fetchServerExternalG10ChinaEvents(),
  ]);

  const feeds: FundamentalExtendedFeeds = {
    tipEtf,
    iefEtf,
    esFutures,
    nqFutures,
    moveIndex,
    gvzIndex,
    hygEtf,
    gldEtf,
    silverFutures,
    copperFutures,
    usdCnh,
    usdJpy,
    btcUsd,
    cotGold,
    externalEvents,
    fetchedAt: new Date().toISOString(),
  };

  cachedFundamentalFeeds = { fetchedAt: Date.now(), feeds };
  return feeds;
}

// Extended Cross-Asset Fundamental Feeds endpoint (0 Gemini tokens)
app.get('/api/macro-news/fundamental-feeds', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const feeds = await gatherServerFundamentalExtendedFeeds(force);
    res.json({
      success: true,
      feeds,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Gagal mengambil data lintas-aset Fundamental Gold.',
    });
  }
});

// Fundamental Gold (XAU/USD) Structural AI Narrative Synthesis endpoint
app.post('/api/macro-news/fundamental', async (req, res) => {
  try {
    const {
      forceRefresh = false,
      baselineSnapshot: clientBaseline,
      cmeFedWatch: clientFedWatch,
      previousSnapshot,
      contextSummary,
    } = req.body || {};

    let baselineSnapshot: FundamentalGoldSnapshot | null = clientBaseline || null;
    let resolvedFedWatch: CmeFedWatchState | undefined = clientFedWatch;

    if (!baselineSnapshot || !baselineSnapshot.horizons) {
      const [macroFeeds, extendedFeeds] = await Promise.all([
        gatherMacroPublicFeeds(Boolean(forceRefresh)),
        gatherServerFundamentalExtendedFeeds(Boolean(forceRefresh)),
      ]);
      resolvedFedWatch = macroFeeds.cmeFedWatch;
      baselineSnapshot = computeFundamentalGoldSnapshot({
        calendarEvents: macroFeeds.calendarEvents,
        intermarketPulse: macroFeeds.intermarketPulse,
        breakingNews: macroFeeds.breakingNews,
        cmeFedWatch: macroFeeds.cmeFedWatch,
        extendedFeeds,
        previousSnapshot: previousSnapshot || lastServerFundamentalGoldSnapshot,
      });
    } else {
      try {
        const grounded = await fetchLiveCmeFedWatchWithGrounding(Boolean(forceRefresh));
        if (grounded?.isAvailable) {
          resolvedFedWatch = {
            ...grounded,
            impliedFedFundsRate:
              grounded.impliedFedFundsRate ?? clientFedWatch?.impliedFedFundsRate ?? null,
            zqFuturesPrice: grounded.zqFuturesPrice ?? clientFedWatch?.zqFuturesPrice ?? null,
            irxTbillYield: grounded.irxTbillYield ?? clientFedWatch?.irxTbillYield ?? null,
          };
          baselineSnapshot = {
            ...baselineSnapshot,
            evidenceSummary: {
              ...baselineSnapshot.evidenceSummary,
              fedWatchDominant: resolvedFedWatch.dominantOutcome,
              fedWatchCutPct: resolvedFedWatch.cutProbability,
              fedWatchHoldPct: resolvedFedWatch.holdProbability,
              fedWatchHikePct: resolvedFedWatch.hikeProbability,
              fedWatchMeeting: resolvedFedWatch.fomcMeetingDate,
              fedWatchSourceLabel: resolvedFedWatch.sourceLabel,
              fedWatchImpliedRate: resolvedFedWatch.impliedFedFundsRate,
            },
          };
        }
      } catch {
        // Non-blocking: keep client FedWatch baseline
      }
    }

    if (
      !forceRefresh &&
      lastServerFundamentalGoldSnapshot &&
      lastServerFundamentalGoldSnapshot.sourceMode === 'GEMINI_AI' &&
      lastServerFundamentalGoldSnapshot.fundamentalFingerprint ===
        baselineSnapshot.fundamentalFingerprint
    ) {
      res.json({
        success: true,
        cached: true,
        cmeFedWatch: resolvedFedWatch,
        snapshot: {
          ...baselineSnapshot,
          sourceMode: 'GEMINI_AI',
          modelUsed: lastServerFundamentalGoldSnapshot.modelUsed,
          narrative: lastServerFundamentalGoldSnapshot.narrative,
        },
      });
      return;
    }

    const newsApiKey = getNewsGeminiApiKeys()[0] || '';
    if (!newsApiKey) {
      lastServerFundamentalGoldSnapshot = baselineSnapshot;
      res.json({
        success: true,
        fallbackUsed: true,
        cmeFedWatch: resolvedFedWatch,
        snapshot: baselineSnapshot,
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: newsApiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
        retryOptions: { attempts: 1 },
      },
    });

    const isUnchanged = Boolean(
      previousSnapshot &&
        previousSnapshot.fundamentalFingerprint === baselineSnapshot.fundamentalFingerprint
    );

    const promptData = {
      overallBias: baselineSnapshot.overallBias,
      bullishProbability: baselineSnapshot.bullishProbability,
      bearishProbability: baselineSnapshot.bearishProbability,
      horizons: {
        daily1D: baselineSnapshot.horizons.daily1D,
        weekly1W: baselineSnapshot.horizons.weekly1W,
        monthly1M: baselineSnapshot.horizons.monthly1M,
      },
      marketRegime: baselineSnapshot.marketRegime,
      regimeLabelEn: baselineSnapshot.regimeLabelEn,
      isDataUnchangedFromLastCheck: isUnchanged,
      changeDetection: baselineSnapshot.changeDetection,
      topDrivers: baselineSnapshot.drivers.slice(0, 7),
      evidenceSummary: baselineSnapshot.evidenceSummary,
      topHeadlines: Array.isArray(contextSummary?.topHeadlines)
        ? contextSummary.topHeadlines.slice(0, 8)
        : [],
      externalEvents: Array.isArray(contextSummary?.externalEvents)
        ? contextSummary.externalEvents.slice(0, 6)
        : [],
    };

    const fundamentalSystemInstruction = `You are a sharp, trusted Senior Global Macro Desk Strategist writing a crisp, high-conviction daily Macro Desk Brief on XAU/USD (Gold) for serious active traders.
CRITICAL RULES:
1. NEVER use trading signal action words like "BUY" or "SELL" anywhere in your output! Strictly describe market direction as "BULLISH" (naik/menguat), "BEARISH" (turun/melemah), or "NEUTRAL" (seimbang/konsolidasi).
2. Write in clean, authoritative, flowing editorial Indonesian (Id) and English (En) — like a Bloomberg / institutional morning desk note that stays effortless to grasp. Avoid stiff textbook phrasing, robotic translationese, or forced filler (e.g. do not force IPO mentions unless an actual major market event is present). Cite concrete numbers from evidenceSummary/topDrivers and immediately connect each indicator (DXY, US10Y, Real Yield, VIX, GLD, CFTC COT) to its direct impact on Gold.
3. Preserve the mathematical probabilities computed in baselineSnapshot — explain WHY those probabilities lean Bullish, Bearish, or Neutral with causal clarity.
4. HONESTY RULE: If isDataUnchangedFromLastCheck is true, explicitly open headline/dataStatusNote/sectionA stating honestly that core fundamental drivers have not shifted since the last check (zero manufactured drama).
5. Connect the full A-to-Z macro picture seamlessly: (A) Macro Regime & what shifted, (B) Fed rates, Real Yields, US10Y & DXY opportunity-cost engine, (C) Cross-market capital flows (Wall Street risk appetite, VIX / Dash-for-Cash risk, GLD ETF, CFTC COT, Asia/China FX & oil), and (D) Clear 1-Day vs 1-Week vs 1-Month roadmap plus concrete invalidation triggers that would flip the thesis.`;

    let aiResponseText = '';
    let usedModel = '';

    for (const model of NEWS_MODEL_CASCADE) {
      const cooldownUntil = newsQuotaCooldownUntilByModel.get(model) || 0;
      if (Date.now() < cooldownUntil) continue;

      try {
        const response = await withTimeoutAbort(
          (abortSignal) =>
            ai.models.generateContent({
              model,
              contents: `Synthesize this verified XAU/USD multi-horizon dataset into a crisp, authoritative A-Z Macro Desk Brief in Bahasa Indonesia (Id) and English (En):\n${JSON.stringify(
                promptData
              )}`,
              config: {
                abortSignal,
                systemInstruction: fundamentalSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    headlineSummaryId: {
                      type: Type.STRING,
                      description: '1 crisp, high-conviction Macro Desk Brief sentence in Bahasa Indonesia summarizing Gold Bullish/Bearish/Neutral direction',
                    },
                    headlineSummaryEn: {
                      type: Type.STRING,
                      description: '1 crisp, high-conviction Macro Desk Brief sentence in English summarizing Gold Bullish/Bearish/Neutral direction',
                    },
                    dataStatusNoteId: {
                      type: Type.STRING,
                      description: '1 direct sentence in Bahasa Indonesia stating whether fundamental drivers shifted or remained intact',
                    },
                    dataStatusNoteEn: {
                      type: Type.STRING,
                      description: '1 direct sentence in English stating whether fundamental drivers shifted or remained intact',
                    },
                    sectionA_Id: {
                      type: Type.STRING,
                      description: 'Section A (Bahasa Indonesia): Current macro regime, dominant driver, and what shifted or stayed intact',
                    },
                    sectionA_En: {
                      type: Type.STRING,
                      description: 'Section A (English): Current macro regime, dominant driver, and what shifted or stayed intact',
                    },
                    sectionB_Id: {
                      type: Type.STRING,
                      description: 'Section B (Bahasa Indonesia): Fed rate pricing, Real Yields, US10Y & DXY opportunity-cost impact on Gold with live figures',
                    },
                    sectionB_En: {
                      type: Type.STRING,
                      description: 'Section B (English): Fed rate pricing, Real Yields, US10Y & DXY opportunity-cost impact on Gold with live figures',
                    },
                    sectionC_Id: {
                      type: Type.STRING,
                      description: 'Section C (Bahasa Indonesia): Wall Street risk appetite, VIX, GLD/CFTC institutional positioning, Asia FX, oil & geopolitical flows',
                    },
                    sectionC_En: {
                      type: Type.STRING,
                      description: 'Section C (English): Wall Street risk appetite, VIX, GLD/CFTC institutional positioning, Asia FX, oil & geopolitical flows',
                    },
                    sectionD_Id: {
                      type: Type.STRING,
                      description: 'Section D (Bahasa Indonesia): Structured 1-Day, 1-Week, 1-Month roadmap plus concrete invalidation triggers',
                    },
                    sectionD_En: {
                      type: Type.STRING,
                      description: 'Section D (English): Structured 1-Day, 1-Week, 1-Month roadmap plus concrete invalidation triggers',
                    },
                  },
                  required: [
                    'headlineSummaryId',
                    'headlineSummaryEn',
                    'dataStatusNoteId',
                    'dataStatusNoteEn',
                    'sectionA_Id',
                    'sectionA_En',
                    'sectionB_Id',
                    'sectionB_En',
                    'sectionC_Id',
                    'sectionC_En',
                    'sectionD_Id',
                    'sectionD_En',
                  ],
                },
              },
            }),
          20_000,
          `Fundamental Gold AI (${model})`
        );

        if (response && response.text) {
          aiResponseText = response.text;
          usedModel = model;
          break;
        }
      } catch (err: any) {
        if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
          newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
        }
        continue;
      }
    }

    if (!aiResponseText) {
      lastServerFundamentalGoldSnapshot = baselineSnapshot;
      res.json({
        success: true,
        fallbackUsed: true,
        cmeFedWatch: resolvedFedWatch,
        snapshot: baselineSnapshot,
      });
      return;
    }

    const aiParsed = parseAiJsonResponse(aiResponseText);
    const enrichedSnapshot: FundamentalGoldSnapshot = {
      ...baselineSnapshot,
      analyzedAt: new Date().toISOString(),
      sourceMode: 'GEMINI_AI',
      modelUsed: usedModel || 'gemini-4-hydrogen',
      narrative: {
        id: {
          headlineSummary: sanitizeNoBuySellServer(
            aiParsed.headlineSummaryId || baselineSnapshot.narrative.id.headlineSummary
          ),
          dataStatusNote: sanitizeNoBuySellServer(
            aiParsed.dataStatusNoteId || baselineSnapshot.narrative.id.dataStatusNote
          ),
          sectionA_StatusAndChange: sanitizeNoBuySellServer(
            aiParsed.sectionA_Id || baselineSnapshot.narrative.id.sectionA_StatusAndChange
          ),
          sectionB_RatesInflationAndGrowth: sanitizeNoBuySellServer(
            aiParsed.sectionB_Id ||
              baselineSnapshot.narrative.id.sectionB_RatesInflationAndGrowth
          ),
          sectionC_CrossMarketEquitiesCentralBanks: sanitizeNoBuySellServer(
            aiParsed.sectionC_Id ||
              baselineSnapshot.narrative.id.sectionC_CrossMarketEquitiesCentralBanks
          ),
          sectionD_HorizonOutlookAndRisks: sanitizeNoBuySellServer(
            aiParsed.sectionD_Id ||
              baselineSnapshot.narrative.id.sectionD_HorizonOutlookAndRisks
          ),
        },
        en: {
          headlineSummary: sanitizeNoBuySellServer(
            aiParsed.headlineSummaryEn || baselineSnapshot.narrative.en.headlineSummary
          ),
          dataStatusNote: sanitizeNoBuySellServer(
            aiParsed.dataStatusNoteEn || baselineSnapshot.narrative.en.dataStatusNote
          ),
          sectionA_StatusAndChange: sanitizeNoBuySellServer(
            aiParsed.sectionA_En || baselineSnapshot.narrative.en.sectionA_StatusAndChange
          ),
          sectionB_RatesInflationAndGrowth: sanitizeNoBuySellServer(
            aiParsed.sectionB_En ||
              baselineSnapshot.narrative.en.sectionB_RatesInflationAndGrowth
          ),
          sectionC_CrossMarketEquitiesCentralBanks: sanitizeNoBuySellServer(
            aiParsed.sectionC_En ||
              baselineSnapshot.narrative.en.sectionC_CrossMarketEquitiesCentralBanks
          ),
          sectionD_HorizonOutlookAndRisks: sanitizeNoBuySellServer(
            aiParsed.sectionD_En ||
              baselineSnapshot.narrative.en.sectionD_HorizonOutlookAndRisks
          ),
        },
      },
    };

    lastServerFundamentalGoldSnapshot = enrichedSnapshot;
    res.json({
      success: true,
      fallbackUsed: false,
      cmeFedWatch: resolvedFedWatch,
      snapshot: enrichedSnapshot,
    });
  } catch {
    res.status(500).json({
      success: false,
      error: 'Gagal menyusun analisis Fundamental Gold.',
    });
  }
});

const httpServer = http.createServer(app);
let viteServer: { close: () => Promise<void> } | null = null;

// Vite dev server vs Production static server
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const disableHmr =
    process.env.DISABLE_HMR === 'true' ||
    Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_TIMEOUT_SECONDS);
  const vite = await createServer({
    server: {
      middlewareMode: true,
      allowedHosts: true,
      ws: disableHmr ? (false as const) : undefined,
      hmr: disableHmr ? false : { server: httpServer },
      watch: disableHmr ? null : undefined,
    },
    appType: 'spa',
  });
  viteServer = vite;
  if (disableHmr) {
    const NOOP_VITE_CLIENT_ESM = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== "undefined") {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
const cspNonce = typeof document !== "undefined"
  ? document.querySelector("meta[property=csp-nonce]")?.getAttribute("nonce") || undefined
  : undefined;
let lastInsertedStyle;
function updateStyle(id, content) {
  if (typeof document === "undefined" || linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (cspNonce) style.setAttribute("nonce", cspNonce);
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => {
        lastInsertedStyle = void 0;
      }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
function removeStyle(id) {
  if (typeof document === "undefined") return;
  if (linkSheetsMap.has(id)) {
    document
      .querySelectorAll(\`link[rel="stylesheet"][data-vite-dev-id="\${CSS.escape(id)}"]\`)
      .forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};
class ErrorOverlay extends BaseElement {}
export { ErrorOverlay, createHotContext, injectQuery, removeStyle, updateStyle };
`.trimStart();

    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(NOOP_VITE_CLIENT_ESM);
    });
  }
  app.use(vite.middlewares);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[TradeVault Server] Running at http://localhost:${PORT}`);
});

let isShuttingDown = false;
const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  Promise.resolve(viteServer?.close())
    .catch(() => {})
    .finally(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  setTimeout(() => process.exit(0), 500).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
