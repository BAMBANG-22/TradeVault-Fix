// @ts-nocheck
import { GoogleGenAI, ThinkingLevel, Type } from 'npm:@google/genai@3.3.0';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, apikey, x-client-info, Cache-Control, Pragma',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

function isMarketDayUtc(date = new Date()): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (day === 5 && date.getUTCHours() >= 22) return false;
  return day >= 1 && day <= 5;
}

const XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION = `You are the Senior Institutional Macro Strategist & Head of XAU/USD Fundamental Trading Desk for TradeVault.
Your mission is to synthesize the provided real-time USD Economic Calendar, 2x2 Intermarket Pulse (DXY, US02Y Yield, US10Y Yield, US Oil WTI), Filtered Breaking News headlines, and CME FedWatch Tool probabilities to construct a high-conviction institutional scenario matrix and a concise "Tesis Meja Institusi (Institutional Desk Thesis)".

YOU MUST STRICTLY ENFORCE THE 12 HUKUM BANG NAEL & CROSS-ASSET TRANSMISSION PRINCIPLES:

1. CROSS-ASSET TRANSMISSION CHAIN (RANTAI SEBAB-AKIBAT LINTAS ASET):
   - Track the deterministic capital flow: Macro Momentum (Growth/Labor/Inflation) -> Fed Policy Expectations (CME FedWatch & FOMC Speeches) -> Front-End Rate Sensitivity (US02Y) -> Long-End Inflation & Real Yields (US10Y) -> US Dollar Currency Valuation (DXY) -> Institutional Demand & Liquidity in XAU/USD.
   - US02Y (2-Year Treasury Yield): Primary barometer of near-term Fed policy expectations. A sharp spike in US02Y signals immediate hawkish repricing and provides direct downward pressure on XAU/USD (SELL Gold).
   - US10Y (10-Year Treasury Yield): Reflects long-term inflation & real cost of capital. Rising US10Y increases the opportunity cost of holding non-yielding Gold.
   - DXY (US Dollar Index): Inversely correlated with Gold as a global reserve benchmark.
   - USOIL (WTI Crude): Evaluated via the Dual-Channel mechanism (Safe-Haven vs Inflation Channel).

2. EVALUASI PRICED-IN VS SURPRISE (KEJENUHAN PASAR & ASIMETRI REPRICING):
   - Compare calendar consensus (Forecast vs Previous) against market positioning in CME FedWatch and US02Y.
   - If market expectation is already heavily skewed (CME FedWatch >= 80% for Hike/Hold/Cut, or US02Y strongly extended), evaluate whether the upcoming data can deliver an incremental surprise or will trigger a sharp counter-reaction (asymmetric repricing shock).
   - Clean 1-Way Breakout (BUY or SELL) occurs when calendar data aligns with an unpriced catalyst.
   - Conflicting releases or priced-in saturation without new catalyst produce a Whipsaw / Fake Move trap (MIXED).

3. PROPORTIONAL FOCUS FOR 3 FOMC PILLARS (MODE A VS MODE B):
   - Mode A — Individual Economic Releases (CPI, Core CPI, PPI, Core PPI, NFP, Unemployment Rate, PCE, Core PCE, GDP, Retail Sales, ISM PMI):
     * Anchor the primary evaluation tightly to the SPECIFIC PILLAR of the releasing indicator (e.g., Inflation Pillar for Core PPI/PPI).
     * The broader 3 FOMC Pillars recap serves as Background Macro Momentum.
   - Mode B — Federal Reserve Meetings (FOMC Rate Decision, FOMC Statement, FOMC Economic Projections / Dot Plot):
     * Activate the FULL RECAPITULATION OF ALL 3 FOMC PILLARS (Inflation + Labor + Growth) combined with CME FedWatch and US02Y to deduce the Fed's overarching policy stance (Hawkish vs Dovish).

4. INVERSE INDICATORS & SUB-COMPONENT RULES:
   - Unemployment Claims (Initial & Continuing) and Challenger Job Cuts: Actual < Forecast (fewer layoffs) = Strong Labor = Bullish USD = SELL XAU/USD. Actual > Forecast = Weak Labor = BUY XAU/USD.
   - Unemployment Rate: Actual < Forecast = Strong Labor = SELL XAU/USD. Actual > Forecast = BUY XAU/USD.
   - "GDP Price Index" MUST be classified under the INFLATION pillar, NEVER under Economic Growth.
   - ISM Prices Paid >= 70 transmits upstream inflationary pressure into headline CPI.
   - ISM PMI > 50 = Expansion (Hawkish USD / SELL Gold). Watch for sharp volatility spikes if ISM PMI drops below 55.

5. DUAL-CHANNEL GEOPOLITICS & US OIL (WTI):
   - If geopolitical tensions surge while US inflation is sticky (> 2%), the INFLATION CHANNEL DOMINATES: energy spikes lift inflation expectations, locking the Fed into a hawkish stance and pushing US02Y/US10Y higher -> SELL XAU/USD once initial safe-haven panic subsides.

6. DYNAMIC PIVOT RULE ("ATURAN PINDAH HALUAN BANG NAEL"):
   - If consensus favors BUY Gold (e.g. softer CPI forecast), but breaking commentary reveals a Fed official (Waller, Warsh, Powell) advocating rate hikes or tighter policy AND NFP is resilient, immediately flip the bias to 1-WAY SELL XAU/USD.

7. INSTITUTIONAL DESK THESIS OUTPUT (TESIS MEJA INSTITUSI):
   - Formulate 2 to 3 dense, decisive sentences detailing:
     (1) Institutional positioning toward the US Dollar based on the cross-asset transmission (US02Y, US10Y, DXY, USOIL, CME FedWatch),
     (2) The most logical directional path for XAU/USD ahead of release, and
     (3) The exact trigger condition for an intraday "Pindah Haluan".

8. AUTOMATIC DETECTION OF "1 ARAH (DIRECT EXPANSION)" VS "2 ARAH (SWEEP FIRST)", SPEECH EVENTS, & PRICED-IN EXHAUSTION:
   - Evaluate the pre-computed flags HAS_SPEECH_EVENT (Speech/Speaks/Testimony/Press Conference/FOMC within -1h to +2h of primary release) and IS_PRICED_IN (6-hour XAU/USD move > 1.5x ATR(14) 1H in the direction of data forecast).
   - "2 ARAH (SWEEP FIRST)" is active if ANY of the following hold: HAS_SPEECH_EVENT = true, IS_PRICED_IN = true, directional divergence between DXY vs US02Y/US10Y, >= 2 simultaneous High-Impact releases with conflicting signals, or GC=F 3D positioning in extreme zone (<= -2.5% or >= +2.5%).
   - "1 ARAH (DIRECT EXPANSION)" is active ONLY when intermarket signals (DXY, US02Y), data catalyst, and session bias are aligned without speech schedule conflicts or extreme 6H priced-in exhaustion.
   - Structure the intraday manipulation scenario into 2 crisp time phases:
     * Fase 1 (Menit 0–5 Rilis): Initial sweep/push direction (explicitly warn if IS_PRICED_IN profit-taking or HAS_SPEECH_EVENT two-way trap is active).
     * Fase 2 (Menit 15+ / Lanjutan): Primary institutional expansion direction after intraday BSL/SSL or 1H/15M POI (capped at 1.8x ATR 1H) is swept.`;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchImageBase64FromUrl(url: string): Promise<{ base64: string; mimeType: string }> {
  const parsedUrl = new URL(url);

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
        return {
          base64: bytesToBase64(new Uint8Array(arrayBuf)),
          mimeType: s3Mime.split(';')[0],
        };
      }
    }
  }

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
  if (contentType.includes('text/html')) {
    const htmlText = await res.text();
    const ogImageMatch =
      htmlText.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
      htmlText.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
      htmlText.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);

    if (ogImageMatch && ogImageMatch[1]) {
      const imgRes = await fetch(ogImageMatch[1], {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      });
      if (!imgRes.ok) {
        throw new Error(`Gagal mengambil gambar snapshot TradingView`);
      }
      const imgMime = imgRes.headers.get('content-type') || 'image/png';
      const arrayBuf = await imgRes.arrayBuffer();
      return {
        base64: bytesToBase64(new Uint8Array(arrayBuf)),
        mimeType: imgMime.split(';')[0],
      };
    }
    throw new Error('URL tidak mengarah langsung ke gambar ataupun snapshot TradingView yang valid.');
  }

  const arrayBuf = await res.arrayBuffer();
  return {
    base64: bytesToBase64(new Uint8Array(arrayBuf)),
    mimeType: (contentType || 'image/png').split(';')[0],
  };
}

function normalizeInstrument(raw: string | null | undefined): string {
  if (!raw) return 'XAUUSD';
  let s = raw.toUpperCase().trim();
  if (!s || s === 'NULL' || s === 'NONE' || s === 'UNKNOWN' || s === 'UNDEFINED' || s === 'N/A' || s === '-') {
    return 'XAUUSD';
  }
  if (s.includes(':')) s = s.split(':').pop() || s;
  if (s.includes('GOLD') || s.startsWith('XAU')) return 'XAUUSD';
  if (s.includes('BITCOIN') || s.startsWith('BTC')) return 'BTCUSD';
  if (s.includes('ETHER') || s.startsWith('ETH')) return 'ETHUSD';
  if (s.includes('SOLANA') || s.startsWith('SOL')) return 'SOLUSD';
  if (s.includes('DOW') || s.includes('DJI') || s.includes('US30')) return 'US30';
  if (s.includes('NAS') || s.includes('USTEC') || s.includes('NDX')) return 'NAS100';
  if (s.includes('SPX') || s.includes('US500') || s.includes('S&P')) return 'SPX500';
  if (s.includes('DAX') || s.includes('GER40') || s.includes('DE40')) return 'GER40';

  const KNOWN_FOREX = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
    'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
    'EURAUD', 'EURCAD', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDCAD', 'AUDNZD',
    'CADCHF', 'NZDCAD', 'NZDCHF',
  ];
  for (const pair of KNOWN_FOREX) {
    if (s.includes(pair)) return pair;
  }

  s = s.replace(/(\.M|\.RAW|\.PRO|\.STD|\.ECN|\.B|_I|_SB|_C)$/i, '');
  if (s.length > 6 && (s.endsWith('C') || s.endsWith('M'))) {
    s = s.slice(0, -1);
  }
  s = s.replace(/[^A-Z0-9]/g, '');
  return s || 'XAUUSD';
}

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
    s = s.replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-');
    const contextualMatch = s.match(
      /(?:at|@|entry[:\s]|open[:\s]|price[:\s]|level[:\s])\s*([+-]?[0-9][0-9., ]+)/i
    );
    if (contextualMatch) s = contextualMatch[1].trim();
    const isParenNeg = /^\(.*\)$/.test(s) && !s.startsWith('(-');
    s = s.replace(/[^0-9.,+\- ]/g, '').trim();
    if (!s) return null;
    s = s.replace(/^([+-])\s+(?=\d)/, '$1');
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
    let num = parseFloat(s);
    if (isNaN(num) || !Number.isFinite(num)) return null;
    if (isParenNeg && num > 0) num = -num;
    if (isPrice && instrument === 'XAUUSD' && num >= 1.5 && num <= 6.5) {
      return Number((num * 1000).toFixed(3));
    }
    return num;
  }
  return null;
}

function parseAiJsonResponse(text: string): Record<string, any> {
  if (!text || typeof text !== 'string') return {};
  try {
    return JSON.parse(text);
  } catch {}
  const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {}
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  let repaired = clean.trim().replace(/,\s*$/, '').replace(/:\s*$/, '');
  if (!repaired.endsWith('}')) repaired += '}';
  try {
    return JSON.parse(repaired);
  } catch {}
  return {};
}

/**
 * Strictly isolated API key resolver for Scan Kilat (Opsi 1: MT5 History & Opsi 2: Individual MT5/TradingView).
 * Reads ONLY `GEMINI_SCAN_API_KEY` and `GEMINI_API_KEY` (never `GEMINI_NEWS_API_KEY`).
 */
function getScannerGeminiApiKeys(): string[] {
  const raw = [Deno.env.get('GEMINI_SCAN_API_KEY') || '', Deno.env.get('GEMINI_API_KEY') || '']
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
  const raw = (Deno.env.get('GEMINI_NEWS_API_KEY') || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

const SCANNER_MODEL_CASCADE = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
];

const MT5_HISTORY_MODEL_CASCADE = [
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
];

const NEWS_MODEL_CASCADE = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
];

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
      error: `API Key Gemini Scan Kilat tidak valid atau tidak memiliki izin akses. Periksa secret GEMINI_SCAN_API_KEY di Supabase.${diagSuffix}`,
      diagnostics,
    };
  }
  if (allNonUnsupportedWereQuota) {
    return {
      success: false,
      quotaExhausted: true,
      error: isMt5History
        ? `Kuota AI Scan Kilat penuh sementara (HTTP 429). Jika GEMINI_SCAN_API_KEY dan GEMINI_NEWS_API_KEY dibuat di 1 project Google Cloud yang sama, pisahkan ke 2 project berbeda agar kuota harian tidak terbagi.${diagSuffix}`
        : `Batas kuota tier gratis tercapai sementara (HTTP 429); beralih otomatis ke pemindai geometri kanvas & OCR.${diagSuffix}`,
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

const scanQuotaCooldownByKeyModel = new Map<
  string,
  { code: 'QUOTA_429' | 'MODEL_404' | 'SERVER_503' | 'TIMEOUT'; until: number }
>();
const newsQuotaCooldownByModel = new Map<string, number>();
// Separate cooldown map for googleSearch grounding calls so grounding 429s never block generateContent synthesis
const newsGroundingQuotaCooldownByModel = new Map<string, number>();

type SanitizedNewsAiErrorCode =
  | 'NO_API_KEY'
  | 'KEY_INVALID'
  | 'QUOTA_429'
  | 'MODEL_404'
  | 'TIMEOUT'
  | 'SERVER_503'
  | 'BAD_REQUEST_400'
  | 'INVALID_JSON'
  | 'EMPTY_RESPONSE'
  | 'COOLDOWN_ACTIVE'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

function resolveNewsAiErrorCode(
  failures: Array<{ model: string; code: string }>,
  skippedByCooldownCount: number
): SanitizedNewsAiErrorCode {
  if (failures.length === 0) {
    return skippedByCooldownCount > 0 ? 'COOLDOWN_ACTIVE' : 'EMPTY_RESPONSE';
  }
  const priority: SanitizedNewsAiErrorCode[] = [
    'KEY_INVALID',
    'QUOTA_429',
    'MODEL_404',
    'TIMEOUT',
    'SERVER_503',
    'BAD_REQUEST_400',
    'INVALID_JSON',
    'EMPTY_RESPONSE',
  ];
  for (const code of priority) {
    if (failures.some((f) => f.code === code)) return code;
  }
  return 'UNKNOWN';
}

let cachedEdgeFedWatch: { fetchedAt: number; data: any } | null = null;
let cachedEdgeTradingViewEvents: { fetchedAt: number; events: any[] } | null = null;
let lastEdgeMacroSnapshot: { fetchedAt: number; snapshot: any } | null = null;

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

function buildScannerGeometryHintBlock(canvasHints: any): string {
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
    lines.push(`- Right-hand Y-axis colored price badge positions (remember: smaller Y% = HIGHER price on chart, larger Y% = LOWER price on chart):`);
    for (const bh of badgeHints) {
      lines.push(`  * ${bh}`);
    }
  }

  if (lines.length === 0) return '';
  return `\nPIXEL GEOMETRY SCANNER HINTS (VERIFIED FROM IMAGE PIXELS):\n${lines.join('\n')}\n`;
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
  'cftc.gov',
  'gamma-api.polymarket.com',
  'binance.com',
  'binance.vision',
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

async function handleProxy(reqUrl: URL): Promise<Response> {
  const targetUrl = reqUrl.searchParams.get('url');
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing target url parameter' }, 400);
  }
  if (!isAllowedProxyTargetUrl(targetUrl)) {
    return jsonResponse({ error: 'Target domain is not in the allowed financial feeds list' }, 403);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const isTradingViewTarget = /tradingview\.com/i.test(targetUrl);
    const upstreamRes = await fetch(targetUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, text/xml, application/rss+xml, image/*, */*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        ...(isTradingViewTarget
          ? {
              Origin: 'https://www.tradingview.com',
              Referer: 'https://www.tradingview.com/',
            }
          : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const contentType = upstreamRes.headers.get('content-type') || 'application/json';
    if (/^image\//i.test(contentType)) {
      const bytes = await upstreamRes.arrayBuffer();
      return new Response(bytes, {
        status: upstreamRes.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }
    const text = await upstreamRes.text();
    return new Response(text, {
      status: upstreamRes.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || 'Proxy fetch failed' }, 502);
  }
}

async function handleExtractTradeScreenshot(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { imageBase64, imageUrl, canvasHints } = body || {};

    if (!imageBase64 && !imageUrl) {
      return jsonResponse({ success: false, error: 'Harap sertakan imageBase64 atau imageUrl.' }, 400);
    }

    const scannerApiKeys = getScannerGeminiApiKeys();

    if (scannerApiKeys.length === 0) {
      return jsonResponse(
        {
          success: false,
          error: 'GEMINI_API_KEY (khusus Scan Kilat) belum dikonfigurasi di Supabase Edge Function Secrets.',
        },
        400
      );
    }

    let mimeType = 'image/jpeg';
    let base64Data = '';

    if (imageBase64) {
      const trimmedInput = String(imageBase64).trim();
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
      const fetched = await fetchImageBase64FromUrl(String(imageUrl));
      const rawMime = (fetched.mimeType || 'image/jpeg').toLowerCase();
      mimeType =
        rawMime === 'image/png'
          ? 'image/png'
          : rawMime === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg';
      base64Data = fetched.base64;
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

    let responseText = '';
    let usedModel = '';
    const scanCascadeStartMs = Date.now();
    const MAX_SCAN_WALL_MS = 20_000;
    const scanFailures: Array<{ model: string; code: string; summary: string }> = [];

    for (let pass = 0; pass < 1; pass++) {

      for (const model of SCANNER_MODEL_CASCADE) {
        if (MAX_SCAN_WALL_MS - (Date.now() - scanCascadeStartMs) < 2500) break;
        for (let keyIdx = 0; keyIdx < scannerApiKeys.length; keyIdx++) {
          const remainingWallMs = MAX_SCAN_WALL_MS - (Date.now() - scanCascadeStartMs);
          if (remainingWallMs < 2500) break;
          const cooldownKey = `${keyIdx}:${model}`;
          const cooldownEntry = scanQuotaCooldownByKeyModel.get(cooldownKey);
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
              headers: { 'User-Agent': 'aistudio-build' },
              retryOptions: { attempts: 1 },
            },
          });

          try {
            const response = await withTimeoutAbort(
              (abortSignal) =>
                ai.models.generateContent({
                  model,
                  contents: [
                    { inlineData: { mimeType, data: base64Data } },
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
                        detected: { type: Type.BOOLEAN },
                        source: { type: Type.STRING },
                        instrument: { type: Type.STRING },
                        leftEdgeLabels: {
                          type: Type.STRING,
                          description: 'Verbatim order/line labels on left edge (e.g. "TP, BUY LIMIT 0.12, SL") or "TradingView Position Box"',
                        },
                        rightAxisPriceTags: {
                          type: Type.STRING,
                          description: 'Highlighted/bordered Y-axis price badges listed top-to-bottom with colors/borders before assigning prices',
                        },
                        position: { type: Type.STRING },
                        lotSize: { type: Type.NUMBER },
                        entryPrice: { type: Type.NUMBER },
                        stopLoss: { type: Type.NUMBER },
                        takeProfit: { type: Type.NUMBER },
                        exitPrice: { type: Type.NUMBER },
                        profit: { type: Type.NUMBER },
                        plannedRiskReward: { type: Type.NUMBER },
                        timeframe: { type: Type.STRING },
                        currentPrice: { type: Type.NUMBER },
                        status: { type: Type.STRING },
                        notes: { type: Type.STRING },
                      },
                      required: ['detected', 'instrument', 'position'],
                    },
                  },
                }),
              Math.min(7_500, remainingWallMs),
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
              scanQuotaCooldownByKeyModel.set(cooldownKey, {
                code: classified.code,
                until: Date.now() + 20 * 60 * 1000,
              });
            } else if (classified.code === 'SERVER_503' || classified.code === 'TIMEOUT') {
              for (let k = 0; k < scannerApiKeys.length; k++) {
                scanQuotaCooldownByKeyModel.set(`${k}:${model}`, {
                  code: classified.code,
                  until: Date.now() + 30 * 1000,
                });
              }
              break;
            }
          }
        }
        if (responseText) break;
      }
      if (responseText) break;
    }

    if (!responseText) {
      return jsonResponse(buildScanFailureResponse(scanFailures, false));
    }

    const parsedData = parseAiJsonResponse(responseText);
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

    const rawPosUpper = String(parsedData.position || '').toUpperCase();
    let cleanPosition: 'BUY' | 'SELL' =
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

    const source: 'MT5' | 'TRADINGVIEW' | 'CHART' =
      parsedData.source === 'MT5'
        ? 'MT5'
        : parsedData.source === 'TRADINGVIEW' || canvasHints?.hasPositionBox
        ? 'TRADINGVIEW'
        : 'CHART';

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

    let entryPrice = parseNumericValue(parsedData.entryPrice, cleanInstrument);
    let stopLoss = parseNumericValue(parsedData.stopLoss, cleanInstrument);
    let takeProfit = parseNumericValue(parsedData.takeProfit, cleanInstrument);
    const exitPrice = parseNumericValue(parsedData.exitPrice, cleanInstrument);
    const profit = parseNumericValue(parsedData.profit, 'EURUSD');
    const rawLotSize = parseNumericValue(parsedData.lotSize, 'EURUSD');
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

    return jsonResponse({
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
  } catch (err: any) {
    return jsonResponse(
      {
        success: false,
        error: err?.message || 'Terjadi kesalahan saat memproses gambar analisis.',
      },
      500
    );
  }
}

function normalizeMt5DateTimeOutput(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const yyyy = m[1];
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    const hh = m[4].padStart(2, '0');
    const min = m[5].padStart(2, '0');
    const sec = m[6] ? `:${m[6].padStart(2, '0')}` : '';
    return `${yyyy}-${mm}-${dd}T${hh}:${min}${sec}`;
  }
  const eu = s.match(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (eu) {
    const dd = eu[1].padStart(2, '0');
    const mm = eu[2].padStart(2, '0');
    const yyyy = eu[3];
    const hh = eu[4].padStart(2, '0');
    const min = eu[5].padStart(2, '0');
    const sec = eu[6] ? `:${eu[6].padStart(2, '0')}` : '';
    return `${yyyy}-${mm}-${dd}T${hh}:${min}${sec}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    const secNum = parsed.getSeconds();
    const sec = secNum > 0 ? `:${String(secNum).padStart(2, '0')}` : '';
    return `${yyyy}-${mm}-${dd}T${hh}:${min}${sec}`;
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

async function handleExtractMt5History(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) || {};
    const rawInputs: Array<{ imageBase64?: string; imageUrl?: string }> = Array.isArray(body.images)
      ? body.images.slice(0, 5)
      : body.imageBase64 || body.imageUrl
      ? [{ imageBase64: body.imageBase64, imageUrl: body.imageUrl }]
      : [];

    if (rawInputs.length === 0) {
      return jsonResponse({ success: false, error: 'Harap sertakan imageBase64, imageUrl, atau array images.' }, 400);
    }

    const scannerApiKeys = getScannerGeminiApiKeys();
    if (scannerApiKeys.length === 0) {
      return jsonResponse(
        { success: false, error: 'GEMINI_API_KEY (khusus Scan Kilat) belum dikonfigurasi di Supabase Secret.' },
        400
      );
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
        const fetched = await fetchImageBase64FromUrl(String(inp.imageUrl));
        const rawMime = (fetched.mimeType || 'image/jpeg').toLowerCase();
        mimeType =
          rawMime === 'image/png'
            ? 'image/png'
            : rawMime === 'image/webp'
            ? 'image/webp'
            : 'image/jpeg';
        base64Data = fetched.base64;
      }

      if (base64Data) {
        resolvedImages.push({ index: idx, mimeType, base64Data });
      }
    }

    if (resolvedImages.length === 0) {
      return jsonResponse({ success: false, error: 'Tidak ada gambar valid yang dikirim.' }, 400);
    }

    const isBatch = resolvedImages.length > 1;
    const prompt = `You are an elite MetaTrader 5 (MT5) & MetaTrader 4 (MT4) Account History OCR & trade-ledger extraction specialist.
Inspect ${
      isBatch
        ? `ALL ${resolvedImages.length} labeled screenshots (imageIndex 0 to ${resolvedImages.length - 1})`
        : 'the FULL screenshot'
    } carefully from top to bottom and extract EVERY closed trade row visible (even if cropped and missing a header).

STRICT EXTRACTION RULES:
1. SUPPORTED SCREENSHOT VIEWS & DOUBLE ENTRIES:
   - MT5 / MT4 Mobile "History -> Positions" (e.g. "XAUUSD, sell 0.10", "2615.40 -> 2602.10", timestamp, profit)
   - MT5 Mobile "History -> Deals" (rows showing symbol, buy/sell, "out" / "in/out", volume, price, profit — extract closing/profit deals as closed trades)
   - Indonesian MT5 locale ("beli" = BUY, "jual" = SELL) as well as English ("buy"/"long" = BUY, "sell"/"short" = SELL)
   - MT5 / MT4 Desktop Account History table
   - CRITICAL DOUBLE-ENTRY RULE: Traders often open multiple rapid positions ("tap-tap" / layering) with IDENTICAL or near-identical symbol, lotSize, entryPrice, stopLoss, takeProfit, exitPrice, and netProfit! Extract EVERY visible trade row separately in top-to-bottom order — NEVER merge, collapse, or skip duplicate-looking rows within a screenshot or across screenshots!
   - IGNORE summary header lines ("Profit:", "Deposit:", "Balance:", "Credit:", "Withdrawal:") and non-trade ledger rows ("balance", "deposit", "credit", "withdrawal") and unfilled "canceled" pending orders.
2. EXACT NUMERIC & SIGN FIDELITY (ZERO SILENT ERRORS):
   - Left: symbol + direction + lot, e.g. "XAUUSD, sell 0.10", "XAUUSDm, buy 0.05", "GOLD, beli 0.10"
   - Prices: "2615.40 -> 2602.10" -> entryPrice BEFORE "->", exitPrice AFTER "->". Copy EVERY digit and decimal accurately (never drop a digit or decimal!).
   - Profit Sign: Inspect BOTH the "-" / "−" prefix AND font color (red = negative loss, blue/green = positive profit). If a BUY exited lower than entry (or SELL exited higher than entry) and text is red/loss, netProfit MUST be negative (e.g. -45.20)!
   - Top-right of row: timestamp like "2026.11.14 14:22:10" (closeDateTime — ALWAYS include seconds ":ss" when visible!).
   - Expanded row details (if visible): "S / L:" -> stopLoss, "T / P:" -> takeProfit, "Open:" -> openDateTime (include ":ss" if visible), "Swap:" -> swap, "Commission:"/"Fee:" -> commission, "ID:"/"#12345" -> ticketId.
3. READING DESKTOP MT5 ACCOUNT HISTORY TABLE:
   - Map columns: Time (open), Position/Order/Ticket (ticketId), Symbol (instrument), Type (buy->BUY, sell->SELL), Volume (lotSize), Open Price (entryPrice), S/L (stopLoss), T/P (takeProfit), Close Time (closeDateTime), Close Price (exitPrice), Commission, Swap, Profit (netProfit).
4. CLOSE TYPE DETECTION (TP / SL / Manual):
   - "TP": comment/tag shows "[tp]", OR T/P badge is green/highlighted, OR exitPrice closely matches takeProfit.
   - "SL": comment/tag shows "[sl]", OR S/L badge is red/highlighted, OR exitPrice closely matches stopLoss.
   - "Manual": otherwise (closed manually by trader).
5. FORMATTING${isBatch ? ' & IMAGE ATTRIBUTION' : ''}:
   - ${isBatch ? `Set "imageIndex" strictly to the integer 0..${resolvedImages.length - 1} matching the screenshot containing that trade row.` : 'Set "imageIndex" to 0.'}
   - Return empty string "" (NEVER literal "null") when ticketId, openDateTime, closeDateTime, or notes are not visible.
   - Output openDateTime / closeDateTime in "YYYY-MM-DD HH:mm:ss" when seconds are visible (or "YYYY-MM-DD HH:mm" if seconds are not shown).
   - Never invent trades that are not visibly printed on screen.`;

    const contentParts: any[] = [];
    if (isBatch) {
      for (const img of resolvedImages) {
        contentParts.push(`Screenshot [imageIndex=${img.index}]:`);
        contentParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64Data } });
      }
    } else {
      contentParts.push({ inlineData: { mimeType: resolvedImages[0].mimeType, data: resolvedImages[0].base64Data } });
    }
    contentParts.push(prompt);

    let winningResult: ReturnType<typeof parseAndNormalizeMt5HistoryResponse> | null = null;
    let usedModel = '';
    let confirmedEmptyModel = '';
    const mt5CascadeStartMs = Date.now();
    const MAX_MT5_WALL_MS = 15_000;
    const mt5Failures: Array<{ model: string; code: string; summary: string }> = [];

    for (let pass = 0; pass < 1; pass++) {

      for (const model of MT5_HISTORY_MODEL_CASCADE) {
        if (MAX_MT5_WALL_MS - (Date.now() - mt5CascadeStartMs) < 2500) break;
        for (let keyIdx = 0; keyIdx < scannerApiKeys.length; keyIdx++) {
          const remainingWallMs = MAX_MT5_WALL_MS - (Date.now() - mt5CascadeStartMs);
          if (remainingWallMs < 2500) break;
          const cooldownKey = `${keyIdx}:${model}`;
          const cooldownEntry = scanQuotaCooldownByKeyModel.get(cooldownKey);
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
              headers: { 'User-Agent': 'aistudio-build' },
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
                        detected: { type: Type.BOOLEAN },
                        source: { type: Type.STRING },
                        trades: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              imageIndex: { type: Type.INTEGER },
                              ticketId: { type: Type.STRING },
                              instrument: { type: Type.STRING },
                              position: { type: Type.STRING },
                              lotSize: { type: Type.NUMBER },
                              entryPrice: { type: Type.NUMBER },
                              exitPrice: { type: Type.NUMBER },
                              stopLoss: { type: Type.NUMBER },
                              takeProfit: { type: Type.NUMBER },
                              commission: { type: Type.NUMBER },
                              swap: { type: Type.NUMBER },
                              netProfit: { type: Type.NUMBER },
                              openDateTime: { type: Type.STRING },
                              closeDateTime: { type: Type.STRING },
                              closeType: { type: Type.STRING },
                              notes: { type: Type.STRING },
                            },
                            required: ['imageIndex', 'instrument', 'position'],
                          },
                        },
                      },
                      required: ['detected', 'trades'],
                    },
                  },
                }),
              Math.min(isBatch ? 12_000 : 7_500, remainingWallMs),
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
              scanQuotaCooldownByKeyModel.set(cooldownKey, {
                code: classified.code,
                until: Date.now() + 20 * 60 * 1000,
              });
            } else if (classified.code === 'SERVER_503' || classified.code === 'TIMEOUT') {
              for (let k = 0; k < scannerApiKeys.length; k++) {
                scanQuotaCooldownByKeyModel.set(`${k}:${model}`, {
                  code: classified.code,
                  until: Date.now() + 30 * 1000,
                });
              }
              break;
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
        return jsonResponse({
          success: true,
          data: {
            detected: false,
            source: 'MT5_HISTORY',
            trades: [],
            modelUsed: confirmedEmptyModel,
          },
        });
      }
      return jsonResponse(buildScanFailureResponse(mt5Failures, true));
    }

    return jsonResponse({
      success: true,
      data: {
        detected: true,
        source: winningResult.source,
        trades: winningResult.normalizedTrades,
        modelUsed: usedModel || 'gemini-3.1-flash-lite',
      },
    });
  } catch (err: any) {
    return jsonResponse(
      {
        success: false,
        error: err?.message || 'Terjadi kesalahan saat memindai riwayat MT5.',
      },
      500
    );
  }
}

async function fetchEdgeTradingViewUsEventsWindow(minMs: number, maxMs: number): Promise<any[]> {
  if (
    cachedEdgeTradingViewEvents &&
    Date.now() - cachedEdgeTradingViewEvents.fetchedAt < 2 * 60 * 1000
  ) {
    return cachedEdgeTradingViewEvents.events;
  }
  try {
    const fromIso = new Date(minMs - 24 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(maxMs + 24 * 60 * 60 * 1000).toISOString();
    const tvUrl = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(
      fromIso
    )}&to=${encodeURIComponent(toIso)}&countries=US`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(tvUrl, {
      headers: {
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/',
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return cachedEdgeTradingViewEvents?.events || [];
    const json = await res.json();
    const list = Array.isArray(json?.result) ? json.result : [];
    if (list.length > 0) {
      cachedEdgeTradingViewEvents = { fetchedAt: Date.now(), events: list };
    }
    return list;
  } catch {
    return cachedEdgeTradingViewEvents?.events || [];
  }
}

function formatEdgeTradingViewActualString(
  rawActual: number,
  tvItem: any,
  ffUnit: string
): { formatted: string; numericVal: number; unit: string } {
  const tvUnit = String(tvItem?.unit || '').trim();
  const tvScale = String(tvItem?.scale || '').trim();

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

function matchEdgeTradingViewActualForEvent(
  ffTitle: string,
  ffDateIso: string,
  ffPreviousNum: number | null,
  ffUnit: string,
  tvEvents: any[]
): { formatted: string; numericVal: number; unit: string } | null {
  const evMs = new Date(ffDateIso).getTime();
  if (!Number.isFinite(evMs) || evMs > Date.now() - 30 * 1000) return null;

  const t = ffTitle.toLowerCase();
  if (/speech|speaks|press conference|minutes|statement|bank holiday|testimony/i.test(t)) {
    return null;
  }

  const ffIsCore = /\bcore\b/i.test(t);
  const ffIsMom = /\bm\/m\b/i.test(t);
  const ffIsYoy = /\by\/y\b/i.test(t);
  const ffIsQoq = /\bq\/q\b/i.test(t);

  let bestScore = 0;
  let bestCandidate: any = null;

  for (const tv of tvEvents) {
    if (tv.actual === null || tv.actual === undefined || !Number.isFinite(Number(tv.actual))) continue;
    const tvMs = new Date(String(tv.date || '')).getTime();
    if (!Number.isFinite(tvMs) || Math.abs(tvMs - evMs) > 90 * 60 * 1000) continue;

    const tvTitle = String(tv.title || '').toLowerCase();
    const tvInd = String(tv.indicator || '').toLowerCase();
    const tvText = `${tvTitle} ${tvInd}`;
    const tvUnit = String(tv.unit || '').trim();
    const tvScale = String(tv.scale || '').trim();

    if (ffUnit === '%' && tvUnit !== '%') continue;
    if ((ffUnit === 'K' || ffUnit === 'M' || ffUnit === 'B') && tvUnit === '%') continue;

    const tvIsMom = /\bmom\b|\bmm\b|\bm\/m\b/i.test(tvText);
    const tvIsYoy = /\byoy\b|\byy\b|\by\/y\b/i.test(tvText);
    const tvIsQoq = /\bqoq\b|\bqq\b|\bq\/q\b/i.test(tvText);
    if (ffIsMom && !tvIsMom) continue;
    if (ffIsYoy && !tvIsYoy) continue;
    if (ffIsQoq && !tvIsQoq) continue;

    const tvIsCore = /\bcore\b|ex\s*food|exfood|ex\s*autos|ex\s*transp/i.test(tvText);
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
      if (tvText.includes('initial jobless') || tvText.includes('unemployment claims')) score += 70;
    } else if (t.includes('continuing claims') || t.includes('continuing jobless claims')) {
      if (tvText.includes('continuing jobless')) score += 70;
    } else if (t.includes('non-farm employment change') || t === 'nfp') {
      if (tvText.includes('non farm payrolls') || tvText.includes('nonfarm')) score += 70;
    } else if (t.includes('adp weekly')) {
      if (tvText.includes('adp') && tvText.includes('weekly')) score += 65;
    } else if (t.includes('adp non-farm') || t.includes('adp employment')) {
      if (!tvText.includes('weekly') && tvText.includes('adp')) score += 65;
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
    } else if (t.includes('ism services pmi') || t.includes('ism non-manufacturing pmi')) {
      if (tvText.includes('ism services pmi') || tvText.includes('ism non-manufacturing pmi')) score += 70;
    } else if (t.includes('ism manufacturing prices')) {
      if (tvText.includes('ism manufacturing prices')) score += 70;
    } else if (t.includes('ism services prices')) {
      if (tvText.includes('ism services prices')) score += 70;
    } else if (t.includes('flash manufacturing pmi') || t.includes('s&p global manufacturing pmi')) {
      if (!tvText.includes('ism') && tvText.includes('manufacturing') && tvText.includes('pmi')) score += 70;
    } else if (t.includes('flash services pmi') || t.includes('s&p global services pmi')) {
      if (!tvText.includes('ism') && tvText.includes('services') && tvText.includes('pmi')) score += 70;
    } else if (t.includes('flash composite pmi') || t.includes('s&p global composite pmi')) {
      if (!tvText.includes('ism') && tvText.includes('composite') && tvText.includes('pmi')) score += 70;
    } else if (t.includes('chicago pmi')) {
      if (tvText.includes('chicago pmi')) score += 70;
    } else if (t.includes('philly fed') || t.includes('philadelphia fed')) {
      if ((tvText.includes('philadelphia fed') || tvText.includes('philly fed')) && tvText.includes('manufacturing')) score += 70;
    } else if (t.includes('empire state')) {
      if (tvText.includes('empire state') && tvText.includes('manufacturing')) score += 70;
    } else if (t.includes('richmond') && t.includes('manufacturing')) {
      if (tvText.includes('richmond') && tvText.includes('manufacturing')) score += 70;
    } else if (t.includes('cb consumer confidence') || t === 'consumer confidence') {
      if (tvText.includes('consumer confidence')) score += 70;
    } else if (t.includes('uom consumer sentiment') || t.includes('michigan consumer sentiment')) {
      if (tvText.includes('michigan consumer sentiment') || tvText.includes('uom consumer sentiment')) score += 70;
    } else if (t.includes('uom inflation expectations') || t.includes('michigan inflation expectations')) {
      if (tvText.includes('michigan inflation') || tvText.includes('uom inflation')) score += 70;
    } else if (t.includes('durable goods')) {
      if (tvText.includes('durable goods')) score += 65;
    } else if (t.includes('factory orders')) {
      if (tvText.includes('factory orders')) score += 65;
    } else if (t.includes('existing home sales')) {
      if (tvText.includes('existing home sales')) score += 65;
    } else if (t.includes('new home sales')) {
      if (tvText.includes('new home sales')) score += 65;
    } else if (t.includes('pending home sales')) {
      if (tvText.includes('pending home sales')) score += 65;
    } else if (t.includes('building permits')) {
      if (tvText.includes('building permits')) score += 65;
    } else if (t.includes('housing starts')) {
      if (tvText.includes('housing starts')) score += 65;
    } else if (t.includes('trade balance')) {
      if (tvText.includes('balance of trade') || tvText.includes('trade balance')) score += 65;
    } else if (t.includes('industrial production')) {
      if (tvText.includes('industrial production')) score += 65;
    } else if (t.includes('capacity utilization')) {
      if (tvText.includes('capacity utilization')) score += 65;
    } else if (t.includes('jolts job openings')) {
      if (tvText.includes('jolts job openings')) score += 65;
    } else {
      const stopWords = new Set(['m/m', 'y/y', 'q/q', 'us', 'final', 'prelim', 'advance', 'revised']);
      const ffTokens = t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
      const overlap = ffTokens.filter((w) => tvText.includes(w)).length;
      if (ffTokens.length > 0 && overlap >= Math.min(2, ffTokens.length)) {
        score += overlap * 26;
      }
    }

    if (score === 0) continue;

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
  return formatEdgeTradingViewActualString(Number(bestCandidate.actual), bestCandidate, ffUnit);
}

async function enrichEdgeEventsWithTradingViewActuals(calendarEvents: any[]): Promise<any[]> {
  if (!Array.isArray(calendarEvents) || calendarEvents.length === 0) return calendarEvents || [];
  const nowMs = Date.now();
  const times = calendarEvents
    .map((e) => new Date(e.date).getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return calendarEvents;
  const tvEvents = await fetchEdgeTradingViewUsEventsWindow(Math.min(...times), Math.max(...times));

  let tvEnriched = calendarEvents;
  if (tvEvents && tvEvents.length > 0) {
    tvEnriched = calendarEvents.map((ev) => {
      const evMs = new Date(ev.date).getTime();
      const hasAct = Boolean(ev.actual && String(ev.actual).trim() && !/menunggu|pending|-|—/i.test(String(ev.actual).trim()));
      if (hasAct || !Number.isFinite(evMs) || evMs > nowMs - 30 * 1000) return ev;

      const matched = matchEdgeTradingViewActualForEvent(
        String(ev.title || ''),
        String(ev.date || ''),
        ev.previousNum ?? null,
        String(ev.unit || ''),
        tvEvents
      );
      if (!matched) return ev;
      return {
        ...ev,
        actual: matched.formatted,
        actualNum: matched.numericVal,
        unit: matched.unit || ev.unit,
        actualSource: 'TV_ENRICH',
      };
    });
  }

  // Secondary 0-token enrichment: Google News RSS wire consensus for S&P Global Flash PMI / indicators where TradingView JSON leaves actual: null
  const missingPmiEvents = tvEnriched.filter((ev) => {
    const evMs = new Date(ev.date).getTime();
    const hasAct = Boolean(ev.actual && String(ev.actual).trim() && !/menunggu|pending|-|—/i.test(String(ev.actual).trim()));
    const t = String(ev.title || '').toLowerCase();
    return (
      !hasAct &&
      t.includes('pmi') &&
      Number.isFinite(evMs) &&
      evMs <= nowMs - 30 * 1000 &&
      nowMs - evMs <= 72 * 60 * 60 * 1000
    );
  });

  if (missingPmiEvents.length > 0) {
    try {
      const q = '"Flash Manufacturing PMI" OR "S&P Global Manufacturing PMI" OR "Flash Services PMI" OR "Services PMI" US';
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const xml = await res.text();
        const items = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/gi)].map(
          (m) => ({
            title: m[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
            pubMs: new Date(m[2].trim()).getTime(),
          })
        );
        tvEnriched = tvEnriched.map((ev) => {
          const hasAct = Boolean(ev.actual && String(ev.actual).trim() && !/menunggu|pending|-|—/i.test(String(ev.actual).trim()));
          if (hasAct) return ev;
          const evMs = new Date(ev.date).getTime();
          if (!Number.isFinite(evMs) || evMs > nowMs - 30 * 1000) return ev;
          const t = String(ev.title || '').toLowerCase();
          if (!t.includes('pmi')) return ev;
          const isMfg = t.includes('manufacturing');
          const isSvc = t.includes('services');
          if (!isMfg && !isSvc) return ev;
          const hits: number[] = [];
          for (const item of items) {
            if (!Number.isFinite(item.pubMs) || item.pubMs < evMs - 5 * 60_000 || item.pubMs > evMs + 48 * 3600_000) continue;
            if (/\b(germany|german|uk|united kingdom|eurozone|france|australia|japan|canada)\b/i.test(item.title)) continue;
            const rx = isMfg
              ? /manufacturing\s+pmi(?:\s+flash)?\s+(?:at|to|of|is|retreats\s+to|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|comes\s+in\s+at|hits|reaches)?\s*(\d{2}(?:\.\d{1,2})?)/i
              : /services\s+pmi(?:\s+flash)?\s+(?:at|to|of|is|retreats\s+to|falls\s+to|drops\s+to|slips\s+to|declines\s+to|eases\s+to|rises\s+to|climbs\s+to|comes\s+in\s+at|hits|reaches)?\s*(\d{2}(?:\.\d{1,2})?)/i;
            const m = item.title.match(rx);
            if (m && m[1]) {
              const v = Number(m[1]);
              if (v >= 25 && v <= 80) hits.push(v);
            }
          }
          if (hits.length > 0) {
            const best = hits[0];
            return {
              ...ev,
              actual: Number.isInteger(best) ? best.toFixed(1) : String(best),
              actualNum: best,
              actualSource: 'TV_ENRICH',
            };
          }
          return ev;
        });
      }
    } catch {
      // ignore RSS fallback error
    }
  }

  return tvEnriched;
}

async function fetchPastActualsViaGoogleSearch(
  missingEvents: any[],
  ai: GoogleGenAI
): Promise<Record<string, string>> {
  if (missingEvents.length === 0) return {};
  const listDesc = missingEvents
    .slice(0, 8)
    .map(
      (e) =>
        `- "${e.title}" (Scheduled: ${e.date}, Forecast: ${e.forecast || 'N/A'}, Previous: ${
          e.previous || 'N/A'
        })`
    )
    .join('\n');
  const prompt = `Search the web for the official released ACTUAL economic data values for these US USD economic indicators that have already been published:\n${listDesc}\n\nReturn ONLY a raw JSON object mapping the exact event title to its released actual value string (for example: {"Core CPI m/m": "0.3%", "CPI m/m": "0.2%"}). If an event has genuinely not been released yet, omit it. Do not include markdown fences or explanation.`;

  for (const model of NEWS_MODEL_CASCADE) {
    const cooldownUntil = newsGroundingQuotaCooldownByModel.get(model) || 0;
    if (Date.now() < cooldownUntil) continue;
    try {
      const response = await withTimeoutAbort(
        (abortSignal) =>
          ai.models.generateContent({
            model,
            contents: prompt,
            config: { abortSignal, tools: [{ googleSearch: {} }] },
          }),
        12_000,
        `Past Actuals Search (${model})`
      );
      const parsed = parseAiJsonResponse(response?.text || '');
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (
          typeof v === 'string' &&
          v.trim() &&
          v.trim() !== '-' &&
          !/menunggu|pending|n\/a/i.test(v)
        ) {
          out[k.trim().toLowerCase()] = v.trim();
        }
      }
      if (Object.keys(out).length > 0) return out;
    } catch (err: any) {
      if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
        newsGroundingQuotaCooldownByModel.set(model, Date.now() + 30 * 60 * 1000);
      }
      continue;
    }
  }
  return {};
}

function getEdgeUpcomingFomcMeetingInfo(nowMs: number = Date.now()) {
  const schedule = [
    { cutoffIso: '2026-12-17T00:00:00Z', labelId: 'FOMC Desember 2026', shortId: 'Des 2026', searchPhraseEn: 'December 2026 FOMC meeting' },
    { cutoffIso: '2027-01-28T00:00:00Z', labelId: 'FOMC Januari 2027', shortId: 'Jan 2027', searchPhraseEn: 'January 2027 FOMC meeting' },
    { cutoffIso: '2027-03-18T00:00:00Z', labelId: 'FOMC Maret 2027', shortId: 'Mar 2027', searchPhraseEn: 'March 2027 FOMC meeting' },
    { cutoffIso: '2027-04-29T00:00:00Z', labelId: 'FOMC April 2027', shortId: 'Apr 2027', searchPhraseEn: 'April 2027 FOMC meeting' },
    { cutoffIso: '2027-06-10T00:00:00Z', labelId: 'FOMC Juni 2027', shortId: 'Jun 2027', searchPhraseEn: 'June 2027 FOMC meeting' },
    { cutoffIso: '2027-07-29T00:00:00Z', labelId: 'FOMC Juli 2027', shortId: 'Jul 2027', searchPhraseEn: 'July 2027 FOMC meeting' },
    { cutoffIso: '2027-09-16T00:00:00Z', labelId: 'FOMC September 2027', shortId: 'Sep 2027', searchPhraseEn: 'September 2027 FOMC meeting' },
    { cutoffIso: '2027-11-04T00:00:00Z', labelId: 'FOMC November 2027', shortId: 'Nov 2027', searchPhraseEn: 'November 2027 FOMC meeting' },
    { cutoffIso: '2027-12-16T00:00:00Z', labelId: 'FOMC Desember 2027', shortId: 'Des 2027', searchPhraseEn: 'December 2027 FOMC meeting' },
  ];
  const hit = schedule.find((item) => nowMs < new Date(item.cutoffIso).getTime());
  if (hit) return hit;
  const dt = new Date(nowMs);
  const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
  const mId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const sId = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const mEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const m = target.getUTCMonth();
  const y = target.getUTCFullYear();
  return {
    labelId: `FOMC ${mId[m]} ${y}`,
    shortId: `${sId[m]} ${y}`,
    searchPhraseEn: `${mEn[m]} ${y} FOMC meeting`,
  };
}

async function fetchCmeFedWatchWithGrounding(
  ai: GoogleGenAI,
  existingFedWatch: any,
  forceRefresh = false
): Promise<any> {
  if (
    cachedEdgeFedWatch &&
    cachedEdgeFedWatch.data?.isAvailable &&
    ((!forceRefresh && Date.now() - cachedEdgeFedWatch.fetchedAt < 4 * 60 * 60 * 1000) ||
      (forceRefresh && Date.now() - cachedEdgeFedWatch.fetchedAt < 15 * 60 * 1000))
  ) {
    return cachedEdgeFedWatch.data;
  }

  if (
    !forceRefresh &&
    existingFedWatch?.isAvailable &&
    typeof existingFedWatch?.sourceLabel === 'string' &&
    existingFedWatch.sourceLabel.includes('Grounding')
  ) {
    return existingFedWatch;
  }

  const upcomingFomc = getEdgeUpcomingFomcMeetingInfo();
  const todayIso = new Date().toISOString().slice(0, 10);
  const fedWatchPrompt = `Today is ${todayIso}. Search for the latest CME FedWatch Tool target rate probabilities for the next upcoming FOMC meeting (${upcomingFomc.searchPhraseEn} / ${upcomingFomc.labelId}).
Return ONLY a valid JSON object (no markdown fences) with these exact fields:
{
  "isAvailable": boolean,
  "fomcMeetingDate": "string (e.g. '${upcomingFomc.labelId}')",
  "targetRateRange": "string (e.g. '450-475 bps' or '')",
  "hikeProbability": number or null,
  "holdProbability": number or null,
  "cutProbability": number or null,
  "hawkishShiftDetected": boolean
}
CRITICAL RULE: Do not invent numbers. If search results do not contain exact figures, set "isAvailable": false.`;

  for (const model of NEWS_MODEL_CASCADE) {
    const cooldownUntil = newsGroundingQuotaCooldownByModel.get(model) || 0;
    if (Date.now() < cooldownUntil) continue;
    try {
      const response = await withTimeoutAbort(
        (abortSignal) =>
          ai.models.generateContent({
            model,
            contents: fedWatchPrompt,
            config: { abortSignal, tools: [{ googleSearch: {} }] },
          }),
        12_000,
        `CME FedWatch Grounding (${model})`
      );
      const parsed = parseAiJsonResponse(response?.text || '');
      const cutRaw = parsed.cutProbability != null ? Number(parsed.cutProbability) : null;
      const holdRaw = parsed.holdProbability != null ? Number(parsed.holdProbability) : null;
      const hikeRaw = parsed.hikeProbability != null ? Number(parsed.hikeProbability) : 0;

      if (
        parsed.isAvailable !== false &&
        cutRaw !== null &&
        holdRaw !== null &&
        Number.isFinite(cutRaw) &&
        Number.isFinite(holdRaw) &&
        cutRaw >= 0 &&
        holdRaw >= 0 &&
        cutRaw + holdRaw + (Number.isFinite(hikeRaw) && hikeRaw > 0 ? hikeRaw : 0) > 0
      ) {
        const safeHike = Number.isFinite(hikeRaw) && hikeRaw >= 0 ? hikeRaw : 0;
        const total = cutRaw + holdRaw + safeHike;
        const cutProbability = Number(((cutRaw / total) * 100).toFixed(1));
        const holdProbability = Number(((holdRaw / total) * 100).toFixed(1));
        const hikeProbability = Number(Math.max(0, 100 - cutProbability - holdProbability).toFixed(1));
        const dominantOutcome =
          hikeProbability >= holdProbability && hikeProbability >= cutProbability && hikeProbability > 0
            ? 'HIKE'
            : cutProbability >= holdProbability && cutProbability >= hikeProbability
            ? 'CUT'
            : 'HOLD';
        const saturationScenario =
          hikeProbability >= 80
            ? 'HIKE'
            : cutProbability >= 80
            ? 'CUT'
            : holdProbability >= 80
            ? 'HOLD'
            : undefined;
        const resolvedMeeting =
          typeof parsed.fomcMeetingDate === 'string' && parsed.fomcMeetingDate.trim()
            ? parsed.fomcMeetingDate.trim()
            : upcomingFomc.labelId;

        const out = {
          ...(existingFedWatch || {}),
          isAvailable: true,
          fomcMeetingDate: resolvedMeeting,
          targetRateRange: String(parsed.targetRateRange || existingFedWatch?.targetRateRange || ''),
          cutProbability,
          holdProbability,
          hikeProbability,
          dominantOutcome,
          isPricedInSaturated: Boolean(saturationScenario),
          saturationScenario,
          hawkishShiftDetected: Boolean(parsed.hawkishShiftDetected || hikeProbability >= 25),
          sourceLabel: `Sumber: CME FedWatch Grounding (${upcomingFomc.shortId})`,
          updatedAt: new Date().toISOString(),
        };
        cachedEdgeFedWatch = { fetchedAt: Date.now(), data: out };
        return out;
      }
    } catch (err: any) {
      if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
        newsGroundingQuotaCooldownByModel.set(model, Date.now() + 30 * 60 * 1000);
      }
      continue;
    }
  }
  return cachedEdgeFedWatch?.data?.isAvailable ? cachedEdgeFedWatch.data : existingFedWatch;
}

function selectEdgeSupportingContextEvents(events: any[], primaryEventId?: string): any[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const nowMs = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const recentReleasedHigh: any[] = [];
  const nearSupportingOrUpcoming: any[] = [];

  for (const ev of events) {
    if (!ev || (primaryEventId && ev.id === primaryEventId)) continue;
    const tMs = new Date(ev.date || '').getTime();
    const hasActual = Boolean(
      ev.actual && String(ev.actual).trim() && !/menunggu|pending|-|—/i.test(String(ev.actual).trim())
    );
    const isSpeech = /speech|speaks|press conference|minutes|statement|testimony|beige\s+book/i.test(
      String(ev.title || '')
    );
    if (hasActual && !isSpeech && (!Number.isFinite(tMs) || tMs <= nowMs)) {
      recentReleasedHigh.push(ev);
    } else if (!Number.isFinite(tMs) || tMs >= nowMs - THREE_DAYS_MS) {
      nearSupportingOrUpcoming.push(ev);
    }
  }

  recentReleasedHigh.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  nearSupportingOrUpcoming.sort(
    (a, b) => Math.abs(new Date(a.date).getTime() - nowMs) - Math.abs(new Date(b.date).getTime() - nowMs)
  );

  const combined: any[] = [];
  const seenIds = new Set<string>();
  for (const ev of [...recentReleasedHigh.slice(0, 8), ...nearSupportingOrUpcoming.slice(0, 8)]) {
    const key = String(ev.id || `${ev.title}|${ev.date}`);
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    combined.push(ev);
    if (combined.length >= 14) break;
  }
  return combined;
}

async function handleMacroNewsAnalyze(req: Request): Promise<Response> {
  let baselineSnapshot: any = null;
  let enrichedCalendar: any[] = [];
  let groundedFedWatch: any = null;
  try {
    const body = await req.json();
    const {
      forceRefresh = false,
      selectedEventId,
      clientFeeds,
      baselineSnapshot: clientBaseline,
    } = body || {};
    baselineSnapshot = clientBaseline || null;
    groundedFedWatch = clientFeeds?.cmeFedWatch || baselineSnapshot?.cmeFedWatch || null;

    if (!baselineSnapshot || !baselineSnapshot.scenarioMatrix) {
      return jsonResponse(
        {
          success: false,
          error: 'baselineSnapshot wajib disertakan dari klien TradeVault.',
        },
        400
      );
    }

    const calendarEvents = Array.isArray(clientFeeds?.calendarEvents)
      ? clientFeeds.calendarEvents
      : Array.isArray(baselineSnapshot.calendarEvents)
      ? baselineSnapshot.calendarEvents
      : [];
    const intermarketPulse = clientFeeds?.intermarketPulse || baselineSnapshot.intermarketPulse || {};
    const breakingNews = Array.isArray(clientFeeds?.breakingNews)
      ? clientFeeds.breakingNews
      : Array.isArray(baselineSnapshot.breakingNews)
      ? baselineSnapshot.breakingNews
      : [];

    // Enrich missing past actuals from TradingView (0 Gemini tokens) before fingerprint cache check
    const nowCutoffMs = Date.now() - 30 * 1000;
    const hasPastMissing = calendarEvents.some(
      (ev: any) =>
        (!ev.actual || !String(ev.actual).trim() || /menunggu|pending|-|—/i.test(String(ev.actual).trim())) &&
        !/speech|speaks|testimony|fomc\s+press|beige\s+book/i.test(String(ev.title || '')) &&
        (ev.forecastNum !== null || ev.previousNum !== null) &&
        new Date(ev.date).getTime() < nowCutoffMs
    );
    enrichedCalendar = hasPastMissing
      ? await enrichEdgeEventsWithTradingViewActuals(calendarEvents)
      : calendarEvents;

    // Fingerprint cache check (30 min TTL when !forceRefresh) -> saves 100% Gemini News tokens on routine refreshes
    if (
      !forceRefresh &&
      lastEdgeMacroSnapshot &&
      Date.now() - lastEdgeMacroSnapshot.fetchedAt < 30 * 60 * 1000 &&
      lastEdgeMacroSnapshot.snapshot?.sourceMode === 'GEMINI_AI' &&
      lastEdgeMacroSnapshot.snapshot?.dataFingerprint === baselineSnapshot.dataFingerprint &&
      (!selectedEventId ||
        lastEdgeMacroSnapshot.snapshot?.scenarioMatrix?.primaryEvent?.id === selectedEventId)
    ) {
      const cachedFedWatch = lastEdgeMacroSnapshot.snapshot?.cmeFedWatch || groundedFedWatch;
      return jsonResponse({
        success: true,
        cached: true,
        fallbackUsed: false,
        sourceMode: 'GEMINI_AI',
        modelUsed: lastEdgeMacroSnapshot.snapshot.modelUsed,
        cmeFedWatch: cachedFedWatch,
        snapshot: {
          ...lastEdgeMacroSnapshot.snapshot,
          intermarketPulse,
          calendarEvents: enrichedCalendar,
          cmeFedWatch: cachedFedWatch,
          rssFeedHealth: clientFeeds?.rssFeedHealth || lastEdgeMacroSnapshot.snapshot.rssFeedHealth,
        },
      });
    }

    // Strictly isolated Trade News API Key (ONLY GEMINI_NEWS_API_KEY — never touches GEMINI_API_KEY used by Scan Kilat!)
    const newsApiKey = getNewsGeminiApiKeys()[0] || '';

    if (!newsApiKey) {
      const fallbackSnapshot = {
        ...baselineSnapshot,
        sourceMode: 'RULE_BASED_FALLBACK',
        modelUsed: 'deterministic-playbook-v1',
        calendarEvents: enrichedCalendar,
        cmeFedWatch: groundedFedWatch,
      };
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        sourceMode: 'CLIENT_FALLBACK',
        aiErrorCode: 'NO_API_KEY',
        cmeFedWatch: groundedFedWatch,
        snapshot: fallbackSnapshot,
      });
    }

    const ai = new GoogleGenAI({
      apiKey: newsApiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
        retryOptions: { attempts: 1 },
      },
    });

    groundedFedWatch = await fetchCmeFedWatchWithGrounding(
      ai,
      groundedFedWatch,
      Boolean(forceRefresh)
    );

    const stillMissing = enrichedCalendar.filter((ev: any) => {
      const evMs = new Date(ev.date).getTime();
      const isEligibleImpact =
        ev.impact === 'High' ||
        (ev.impact === 'Medium' && Number.isFinite(evMs) && nowCutoffMs - evMs <= 48 * 60 * 60 * 1000);
      return (
        (!ev.actual || !String(ev.actual).trim() || /menunggu|pending|-|—/i.test(String(ev.actual).trim())) &&
        !/speech|speaks|testimony|fomc\s+press|beige\s+book/i.test(String(ev.title || '')) &&
        isEligibleImpact &&
        (ev.forecastNum !== null || ev.previousNum !== null) &&
        Number.isFinite(evMs) &&
        evMs < nowCutoffMs
      );
    });

    if (stillMissing.length > 0) {
      const searchActuals = await fetchPastActualsViaGoogleSearch(stillMissing, ai);
      if (Object.keys(searchActuals).length > 0) {
        enrichedCalendar = enrichedCalendar.map((ev: any) => {
          const evMs = new Date(ev.date).getTime();
          if (!Number.isFinite(evMs) || evMs >= nowCutoffMs) {
            return ev;
          }
          if (!ev.actual || !String(ev.actual).trim()) {
            const found = searchActuals[String(ev.title || '').trim().toLowerCase()];
            if (found) return { ...ev, actual: found, actualSource: 'GOOGLE_GROUNDING' };
          }
          return ev;
        });
      }
    }

    const promptPayload = {
      primaryEvent: baselineSnapshot.scenarioMatrix.primaryEvent,
      simultaneousEvents: baselineSnapshot.scenarioMatrix.simultaneousEvents || [],
      supportingContextEvents: selectEdgeSupportingContextEvents(
        enrichedCalendar,
        baselineSnapshot.scenarioMatrix.primaryEvent?.id
      ).map((ev: any) => ({
        title: ev.title,
        date: ev.date,
        impact: ev.impact,
        previous: ev.previous,
        forecast: ev.forecast,
        actual: ev.actual,
        eventBiasForGold: ev.eventBiasForGold,
        biasReasonId: ev.biasReasonId,
      })),
      cmeFedWatch: groundedFedWatch,
      intermarketPulse: {
        dxy: intermarketPulse.dxy
          ? {
              price: intermarketPulse.dxy.price,
              changePercent: intermarketPulse.dxy.changePercent,
              direction: intermarketPulse.dxy.direction,
            }
          : undefined,
        usoil: intermarketPulse.usoil
          ? {
              price: intermarketPulse.usoil.price,
              changePercent: intermarketPulse.usoil.changePercent,
              direction: intermarketPulse.usoil.direction,
            }
          : undefined,
        us10y: intermarketPulse.us10y
          ? {
              price: intermarketPulse.us10y.price,
              changePercent: intermarketPulse.us10y.changePercent,
              direction: intermarketPulse.us10y.direction,
            }
          : undefined,
        us02y: intermarketPulse.us02y
          ? {
              price: intermarketPulse.us02y.price,
              changePercent: intermarketPulse.us02y.changePercent,
              direction: intermarketPulse.us02y.direction,
            }
          : undefined,
        vix: intermarketPulse.vix?.isAvailable ? intermarketPulse.vix : undefined,
        goldPositioning: intermarketPulse.goldPositioning?.isAvailable
          ? intermarketPulse.goldPositioning
          : undefined,
      },
      preNewsFlow: baselineSnapshot.scenarioMatrix.preNewsFlow,
      breakingHeadlines: breakingNews.slice(0, 10).map((h: any) => ({
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
        movementType:
          baselineSnapshot.scenarioMatrix.dualHorizon?.movementType ?? 'TWO_WAY_SWEEP_FIRST',
        movementBadgeId:
          baselineSnapshot.scenarioMatrix.dualHorizon?.movementBadgeId ??
          'TIPE PERGERAKAN: [2 ARAH — SWEEP FIRST]',
      },
    };

    let aiResponseText = '';
    let usedModel = '';
    const modelFailures: Array<{ model: string; code: string }> = [];
    let skippedByCooldownCount = 0;

    const macroStaffDraft = await edgeRunSpecialistNewsDraft({
      division: 'TRADE_NEWS',
      dataset: promptPayload,
    });
    const macroStaffDraftBlock = macroStaffDraft.used
      ? `\n\n[DRAFT MEMO DIVISI BERITA (${macroStaffDraft.provider?.toUpperCase()} / ${macroStaffDraft.model}) — AUDIT & ACC OLEH BOSS GEMINI: Periksa terhadap dataset mentah di atas; perbaiki jika ada kekeliruan arah/spike/angka, lalu terbitkan JSON final yang di-ACC]:\n${macroStaffDraft.draftText}`
      : '';

    for (const model of NEWS_MODEL_CASCADE) {
      const cooldownUntil = newsQuotaCooldownByModel.get(model) || 0;
      if (Date.now() < cooldownUntil) {
        skippedByCooldownCount += 1;
        continue;
      }
      try {
        const response = await withTimeoutAbort(
          (abortSignal) =>
            ai.models.generateContent({
              model,
              contents: `Analyze this real-time XAU/USD macro dataset (including CME FedWatch probabilities, simultaneous USD High-Impact events, and preNewsFlow intelligence such as Leading Indicator Chain, Consensus Tightness, 2s10s Yield Curve Spread, VIX risk regime, Gold 3-day GC=F positioning, and FOMC Blackout window while strictly preserving Master Playbook rules) and return the structured JSON Scenario Matrix in both Bahasa Indonesia (Id) and English (En):\n${JSON.stringify(
                promptPayload
              )}${macroStaffDraftBlock}`,
              config: {
                abortSignal,
                systemInstruction: XAUUSD_MACRO_MASTER_PLAYBOOK_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    impactLevel: { type: Type.STRING },
                    dominantBias: { type: Type.STRING },
                    buyProbability: { type: Type.INTEGER },
                    sellProbability: { type: Type.INTEGER },
                    mixedProbability: { type: Type.INTEGER },
                    dynamicPivotTriggered: { type: Type.BOOLEAN },
                    topBreakingEvalId: { type: Type.STRING },
                    topBreakingEvalEn: { type: Type.STRING },
                    finalTakeId: { type: Type.STRING },
                    finalTakeEn: { type: Type.STRING },
                    actionPlanId: { type: Type.STRING },
                    actionPlanEn: { type: Type.STRING },
                    whipsawWarningId: { type: Type.STRING },
                    whipsawWarningEn: { type: Type.STRING },
                    institutionalDeskThesisId: { type: Type.STRING },
                    institutionalDeskThesisEn: { type: Type.STRING },
                    phase1Minute0to5Id: { type: Type.STRING },
                    phase1Minute0to5En: { type: Type.STRING },
                    phase2Minute15PlusId: { type: Type.STRING },
                    phase2Minute15PlusEn: { type: Type.STRING },
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
        if (response && response.text && response.text.trim()) {
          const candidateParsed = parseAiJsonResponse(response.text);
          if (Object.keys(candidateParsed).length > 0) {
            aiResponseText = response.text;
            usedModel = macroStaffDraft.used
              ? `${macroStaffDraft.provider}+gemini-acc(${model})`
              : model;
            break;
          }
          modelFailures.push({ model, code: 'INVALID_JSON' });
          continue;
        }
        modelFailures.push({ model, code: 'EMPTY_RESPONSE' });
      } catch (err: any) {
        const classified = classifyGeminiFailure(err);
        modelFailures.push({ model, code: classified.code });
        if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
          newsQuotaCooldownByModel.set(model, Date.now() + 30 * 60 * 1000);
        }
        continue;
      }
    }

    if (!aiResponseText || !usedModel) {
      const aiErrorCode = resolveNewsAiErrorCode(modelFailures, skippedByCooldownCount);
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        sourceMode: 'CLIENT_FALLBACK',
        aiErrorCode,
        cmeFedWatch: groundedFedWatch,
        snapshot: {
          ...baselineSnapshot,
          sourceMode: 'RULE_BASED_FALLBACK',
          modelUsed: 'deterministic-playbook-v1',
          calendarEvents: enrichedCalendar,
          cmeFedWatch: groundedFedWatch,
        },
      });
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

    const baseDualHorizon = baselineSnapshot.scenarioMatrix.dualHorizon || {};
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

    const enrichedSnapshot = {
      ...baselineSnapshot,
      analyzedAt: new Date().toISOString(),
      sourceMode: 'GEMINI_AI',
      modelUsed: usedModel,
      impactLevel,
      dominantBias,
      calendarEvents: enrichedCalendar,
      cmeFedWatch: groundedFedWatch,
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
        whipsawWarningEn:
          aiParsed.whipsawWarningEn || baselineSnapshot.scenarioMatrix.whipsawWarningEn,
        institutionalDeskThesisId:
          aiParsed.institutionalDeskThesisId ||
          baselineSnapshot.scenarioMatrix.institutionalDeskThesisId,
        institutionalDeskThesisEn:
          aiParsed.institutionalDeskThesisEn ||
          baselineSnapshot.scenarioMatrix.institutionalDeskThesisEn,
        t5ExecutionTacticId,
        t5ExecutionTacticEn,
        isStrongOneWayBias,
        cmeFedWatch: groundedFedWatch,
      },
    };

    lastEdgeMacroSnapshot = { fetchedAt: Date.now(), snapshot: enrichedSnapshot };

    return jsonResponse({
      success: true,
      fallbackUsed: false,
      sourceMode: 'GEMINI_AI',
      modelUsed: usedModel,
      cmeFedWatch: groundedFedWatch,
      snapshot: enrichedSnapshot,
    });
  } catch {
    if (baselineSnapshot) {
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        sourceMode: 'CLIENT_FALLBACK',
        aiErrorCode: 'INTERNAL_ERROR',
        cmeFedWatch: groundedFedWatch,
        snapshot: {
          ...baselineSnapshot,
          sourceMode: 'RULE_BASED_FALLBACK',
          modelUsed: 'deterministic-playbook-v1',
          calendarEvents:
            enrichedCalendar.length > 0 ? enrichedCalendar : baselineSnapshot.calendarEvents,
          cmeFedWatch: groundedFedWatch || baselineSnapshot.cmeFedWatch,
        },
      });
    }
    return jsonResponse({ success: false, error: 'Gagal memproses analisis makro.' }, 500);
  }
}

let lastEdgeFundamentalSnapshot: { fetchedAt: number; snapshot: any } | null = null;

function sanitizeNoBuySellEdge(text: string): string {
  if (!text) return '';
  return text
    .replace(/\bSTRONG\s+BUY\b/gi, 'Strong Bullish')
    .replace(/\bSTRONG\s+SELL\b/gi, 'Strong Bearish')
    .replace(/\bBUY\b/g, 'Bullish')
    .replace(/\bbuy\b/g, 'bullish')
    .replace(/\bSELL\b/g, 'Bearish')
    .replace(/\bsell\b/g, 'bearish');
}

async function handleFundamentalGoldAnalyze(req: Request): Promise<Response> {
  let baselineSnapshot: any = null;
  let resolvedFedWatch: any = null;
  try {
    const body = await req.json();
    const {
      forceRefresh = false,
      baselineSnapshot: clientBaseline,
      cmeFedWatch: clientFedWatch,
      previousSnapshot,
      contextSummary,
    } = body || {};
    baselineSnapshot = clientBaseline || null;
    resolvedFedWatch = clientFedWatch || null;

    if (!baselineSnapshot || !baselineSnapshot.horizons || !baselineSnapshot.narrative) {
      return jsonResponse(
        {
          success: false,
          error: 'baselineSnapshot Fundamental Gold wajib disertakan dari klien TradeVault.',
        },
        400
      );
    }

    const newsApiKey = getNewsGeminiApiKeys()[0] || '';
    let edgeAiClient: GoogleGenAI | null = null;

    if (newsApiKey) {
      edgeAiClient = new GoogleGenAI({
        apiKey: newsApiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
          retryOptions: { attempts: 1 },
        },
      });
      try {
        const grounded = await fetchCmeFedWatchWithGrounding(
          edgeAiClient,
          clientFedWatch,
          Boolean(forceRefresh)
        );
        if (grounded?.isAvailable) {
          resolvedFedWatch = grounded;
          baselineSnapshot = {
            ...baselineSnapshot,
            evidenceSummary: {
              ...(baselineSnapshot.evidenceSummary || {}),
              fedWatchDominant: grounded.dominantOutcome || baselineSnapshot.evidenceSummary?.fedWatchDominant,
              fedWatchCutPct: grounded.cutProbability ?? baselineSnapshot.evidenceSummary?.fedWatchCutPct,
              fedWatchHoldPct: grounded.holdProbability ?? baselineSnapshot.evidenceSummary?.fedWatchHoldPct,
              fedWatchHikePct: grounded.hikeProbability ?? baselineSnapshot.evidenceSummary?.fedWatchHikePct,
              fedWatchMeeting: grounded.fomcMeetingDate || baselineSnapshot.evidenceSummary?.fedWatchMeeting,
              fedWatchSourceLabel: grounded.sourceLabel || baselineSnapshot.evidenceSummary?.fedWatchSourceLabel,
              fedWatchImpliedRate: grounded.impliedFedFundsRate ?? baselineSnapshot.evidenceSummary?.fedWatchImpliedRate,
            },
          };
        }
      } catch {
        // Non-blocking: preserve client FedWatch telemetry
      }
    }

    if (
      !forceRefresh &&
      lastEdgeFundamentalSnapshot &&
      Date.now() - lastEdgeFundamentalSnapshot.fetchedAt < 30 * 60 * 1000 &&
      lastEdgeFundamentalSnapshot.snapshot?.sourceMode === 'GEMINI_AI' &&
      lastEdgeFundamentalSnapshot.snapshot?.fundamentalFingerprint ===
        baselineSnapshot.fundamentalFingerprint
    ) {
      return jsonResponse({
        success: true,
        cached: true,
        fallbackUsed: false,
        sourceMode: 'GEMINI_AI',
        modelUsed: lastEdgeFundamentalSnapshot.snapshot.modelUsed,
        cmeFedWatch: resolvedFedWatch,
        snapshot: {
          ...baselineSnapshot,
          sourceMode: 'GEMINI_AI',
          modelUsed: lastEdgeFundamentalSnapshot.snapshot.modelUsed,
          narrative: lastEdgeFundamentalSnapshot.snapshot.narrative,
        },
      });
    }

    if (!edgeAiClient) {
      const fallbackSnapshot = {
        ...baselineSnapshot,
        sourceMode: 'DETERMINISTIC_FALLBACK',
        modelUsed: 'deterministic-fundamental-v1',
      };
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        sourceMode: 'CLIENT_FALLBACK',
        aiErrorCode: 'NO_API_KEY',
        cmeFedWatch: resolvedFedWatch,
        snapshot: fallbackSnapshot,
      });
    }

    const ai = edgeAiClient;

    const isUnchanged = Boolean(
      previousSnapshot &&
        previousSnapshot.fundamentalFingerprint === baselineSnapshot.fundamentalFingerprint
    );

    const promptData = {
      overallBias: baselineSnapshot.overallBias,
      bullishProbability: baselineSnapshot.bullishProbability,
      bearishProbability: baselineSnapshot.bearishProbability,
      horizons: {
        daily1D: baselineSnapshot.horizons?.daily1D,
        weekly1W: baselineSnapshot.horizons?.weekly1W,
        monthly1M: baselineSnapshot.horizons?.monthly1M,
      },
      marketRegime: baselineSnapshot.marketRegime,
      regimeLabelEn: baselineSnapshot.regimeLabelEn,
      isDataUnchangedFromLastCheck: isUnchanged,
      changeDetection: baselineSnapshot.changeDetection,
      tacticalOverlay: baselineSnapshot.tacticalOverlay || null,
      topDrivers: Array.isArray(baselineSnapshot.drivers)
        ? baselineSnapshot.drivers.slice(0, 7)
        : [],
      evidenceSummary: baselineSnapshot.evidenceSummary || {},
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
5. Connect the full A-to-Z macro picture seamlessly: (A) Macro Regime & what shifted, (B) Fed rates, Real Yields, US10Y & DXY opportunity-cost engine (note if tacticalOverlay.dxyDistortionDetected is true), (C) Cross-market capital flows (Wall Street risk appetite, VIX / Dash-for-Cash risk, GLD ETF, CFTC COT, Asia/China FX & oil), and (D) Clear 1-Day vs 1-Week vs 1-Month roadmap — separating structural 1W/1M trend from any active intraday tacticalOverlay catalyst (medium-impact surprises or short-covering bounce risk) plus concrete invalidation triggers.`;

    let aiResponseText = '';
    let usedModel = '';
    const modelFailures: Array<{ model: string; code: string }> = [];
    let skippedByCooldownCount = 0;

    const fundamentalStaffDraft = await edgeRunSpecialistNewsDraft({
      division: 'FUNDAMENTAL_GOLD',
      dataset: promptData,
    });
    const fundamentalStaffDraftBlock = fundamentalStaffDraft.used
      ? `\n\n[DRAFT MEMO DIVISI FUNDAMENTAL (${fundamentalStaffDraft.provider?.toUpperCase()} / ${fundamentalStaffDraft.model}) — AUDIT & ACC OLEH BOSS GEMINI: Verifikasi terhadap angka mentah & aturan anti-BUY/SELL di atas, perbaiki bila ada penyimpangan, lalu terbitkan JSON final yang di-ACC]:\n${fundamentalStaffDraft.draftText}`
      : '';

    for (const model of NEWS_MODEL_CASCADE) {
      const cooldownUntil = newsQuotaCooldownByModel.get(model) || 0;
      if (Date.now() < cooldownUntil) {
        skippedByCooldownCount += 1;
        continue;
      }
      try {
        const response = await withTimeoutAbort(
          (abortSignal) =>
            ai.models.generateContent({
              model,
              contents: `Synthesize this verified XAU/USD multi-horizon dataset into a crisp, authoritative A-Z Macro Desk Brief in Bahasa Indonesia (Id) and English (En):\n${JSON.stringify(
                promptData
              )}${fundamentalStaffDraftBlock}`,
              config: {
                abortSignal,
                systemInstruction: fundamentalSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    headlineSummaryId: { type: Type.STRING },
                    headlineSummaryEn: { type: Type.STRING },
                    dataStatusNoteId: { type: Type.STRING },
                    dataStatusNoteEn: { type: Type.STRING },
                    sectionA_Id: { type: Type.STRING },
                    sectionA_En: { type: Type.STRING },
                    sectionB_Id: { type: Type.STRING },
                    sectionB_En: { type: Type.STRING },
                    sectionC_Id: { type: Type.STRING },
                    sectionC_En: { type: Type.STRING },
                    sectionD_Id: { type: Type.STRING },
                    sectionD_En: { type: Type.STRING },
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
          `Fundamental Gold Edge AI (${model})`
        );
        if (response && response.text && response.text.trim()) {
          const candidateParsed = parseAiJsonResponse(response.text);
          if (Object.keys(candidateParsed).length > 0) {
            aiResponseText = response.text;
            usedModel = fundamentalStaffDraft.used
              ? `${fundamentalStaffDraft.provider}+gemini-acc(${model})`
              : model;
            break;
          }
          modelFailures.push({ model, code: 'INVALID_JSON' });
          continue;
        }
        modelFailures.push({ model, code: 'EMPTY_RESPONSE' });
      } catch (err: any) {
        const classified = classifyGeminiFailure(err);
        modelFailures.push({ model, code: classified.code });
        if (isGeminiQuotaError(err) || isGeminiModelUnavailableError(err)) {
          newsQuotaCooldownByModel.set(model, Date.now() + 30 * 60 * 1000);
        }
        continue;
      }
    }

    if (!aiResponseText || !usedModel) {
      const aiErrorCode = resolveNewsAiErrorCode(modelFailures, skippedByCooldownCount);
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        sourceMode: 'CLIENT_FALLBACK',
        aiErrorCode,
        cmeFedWatch: resolvedFedWatch,
        snapshot: {
          ...baselineSnapshot,
          sourceMode: 'DETERMINISTIC_FALLBACK',
          modelUsed: 'deterministic-fundamental-v1',
        },
      });
    }

    const aiParsed = parseAiJsonResponse(aiResponseText);
    const enrichedSnapshot = {
      ...baselineSnapshot,
      analyzedAt: new Date().toISOString(),
      sourceMode: 'GEMINI_AI',
      modelUsed: usedModel,
      narrative: {
        id: {
          headlineSummary: sanitizeNoBuySellEdge(
            aiParsed.headlineSummaryId || baselineSnapshot.narrative.id.headlineSummary
          ),
          dataStatusNote: sanitizeNoBuySellEdge(
            aiParsed.dataStatusNoteId || baselineSnapshot.narrative.id.dataStatusNote
          ),
          sectionA_StatusAndChange: sanitizeNoBuySellEdge(
            aiParsed.sectionA_Id || baselineSnapshot.narrative.id.sectionA_StatusAndChange
          ),
          sectionB_RatesInflationAndGrowth: sanitizeNoBuySellEdge(
            aiParsed.sectionB_Id ||
              baselineSnapshot.narrative.id.sectionB_RatesInflationAndGrowth
          ),
          sectionC_CrossMarketEquitiesCentralBanks: sanitizeNoBuySellEdge(
            aiParsed.sectionC_Id ||
              baselineSnapshot.narrative.id.sectionC_CrossMarketEquitiesCentralBanks
          ),
          sectionD_HorizonOutlookAndRisks: sanitizeNoBuySellEdge(
            aiParsed.sectionD_Id ||
              baselineSnapshot.narrative.id.sectionD_HorizonOutlookAndRisks
          ),
        },
        en: {
          headlineSummary: sanitizeNoBuySellEdge(
            aiParsed.headlineSummaryEn || baselineSnapshot.narrative.en.headlineSummary
          ),
          dataStatusNote: sanitizeNoBuySellEdge(
            aiParsed.dataStatusNoteEn || baselineSnapshot.narrative.en.dataStatusNote
          ),
          sectionA_StatusAndChange: sanitizeNoBuySellEdge(
            aiParsed.sectionA_En || baselineSnapshot.narrative.en.sectionA_StatusAndChange
          ),
          sectionB_RatesInflationAndGrowth: sanitizeNoBuySellEdge(
            aiParsed.sectionB_En ||
              baselineSnapshot.narrative.en.sectionB_RatesInflationAndGrowth
          ),
          sectionC_CrossMarketEquitiesCentralBanks: sanitizeNoBuySellEdge(
            aiParsed.sectionC_En ||
              baselineSnapshot.narrative.en.sectionC_CrossMarketEquitiesCentralBanks
          ),
          sectionD_HorizonOutlookAndRisks: sanitizeNoBuySellEdge(
            aiParsed.sectionD_En ||
              baselineSnapshot.narrative.en.sectionD_HorizonOutlookAndRisks
          ),
        },
      },
    };

    lastEdgeFundamentalSnapshot = { fetchedAt: Date.now(), snapshot: enrichedSnapshot };
    return jsonResponse({
      success: true,
      fallbackUsed: false,
      sourceMode: 'GEMINI_AI',
      modelUsed: usedModel,
      cmeFedWatch: resolvedFedWatch,
      snapshot: enrichedSnapshot,
    });
  } catch {
    if (baselineSnapshot) {
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        sourceMode: 'CLIENT_FALLBACK',
        aiErrorCode: 'INTERNAL_ERROR',
        cmeFedWatch: resolvedFedWatch,
        snapshot: {
          ...baselineSnapshot,
          sourceMode: 'DETERMINISTIC_FALLBACK',
          modelUsed: 'deterministic-fundamental-v1',
        },
      });
    }
    return jsonResponse({ success: false, error: 'Gagal memproses Fundamental Gold.' }, 500);
  }
}

// ============================================================================
// MULTI-AGENT OFFICE & SINGLE-PASS AI DESK ORCHESTRATOR
// - Trade News & Fundamental Gold: Specialist Staff Draft (Groq/OpenRouter) -> Boss Gemini ACC
// - Tanya AI Chat: Single-Pass Smart Assistant Brain with 18.5s global deadline & fast circuit-breaker
// ============================================================================

const AGENT_GEMINI_FAST_CHAT_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
const AGENT_GEMINI_DEEP_CHAT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
const AGENT_GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const AGENT_OPENROUTER_FREE_MODELS = ['meta-llama/llama-3.3-70b-instruct:free'];

function parseEdgeKeyList(raw: string | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length >= 8)
    )
  );
}

function getEdgeAgentDeskKeys() {
  const geminiKeys = Array.from(
    new Set([...getNewsGeminiApiKeys(), ...getScannerGeminiApiKeys()])
  );
  const groqKeys = parseEdgeKeyList(Deno.env.get('GROQ_API_KEY'));
  const openRouterKeys = parseEdgeKeyList(Deno.env.get('OPENROUTER_API_KEY'));
  return { geminiKeys, groqKeys, openRouterKeys };
}

function sanitizeEdgeAgentError(err: unknown): string {
  return String((err as any)?.message || err || 'Unknown error')
    .replace(/AIza[0-9A-Za-z\-_]{16,}/g, '[REDACTED_KEY]')
    .replace(/gsk_[0-9A-Za-z\-_]{16,}/g, '[REDACTED_KEY]')
    .replace(/sk-or-[a-zA-Z0-9\-_]{16,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function parseEdgeJsonLoose(rawText: string): Record<string, any> | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function getEdgeRemainingBudgetMs(deadlineMs: number | undefined, capMs: number): number {
  if (!deadlineMs) return capMs;
  return Math.min(capMs, Math.max(0, deadlineMs - Date.now()));
}

async function edgeCallGeminiAgent(params: {
  keys: string[];
  models: string[];
  systemInstruction: string;
  userPrompt: string;
  expectJson: boolean;
  timeoutMs: number;
  temperature?: number;
  deadlineMs?: number;
}) {
  if (params.keys.length === 0) throw new Error('Gemini API key not configured');
  let lastErr: unknown = new Error('Gemini call failed');
  for (const model of params.models) {
    for (const apiKey of params.keys) {
      const budgetMs = getEdgeRemainingBudgetMs(params.deadlineMs, params.timeoutMs);
      if (budgetMs < 1500) {
        throw new Error(sanitizeEdgeAgentError(lastErr || new Error('Request deadline reached')));
      }
      const start = Date.now();
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
          retryOptions: { attempts: 1 },
        },
      });
      try {
        const response = await withTimeoutAbort(
          (abortSignal) =>
            ai.models.generateContent({
              model,
              contents: params.userPrompt,
              config: {
                abortSignal,
                systemInstruction: params.systemInstruction,
                ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
                ...(model === 'gemini-4-hydrogen'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                ...(params.expectJson ? { responseMimeType: 'application/json' } : {}),
              },
            }),
          budgetMs,
          `EdgeGemini(${model})`
        );
        const text = (response?.text || '').trim();
        if (text) {
          const json = params.expectJson ? parseEdgeJsonLoose(text) : null;
          if (!params.expectJson || json) {
            return { provider: 'gemini', model, text, json, latencyMs: Date.now() - start };
          }
          lastErr = new Error(`Gemini(${model}) non-JSON`);
        } else {
          lastErr = new Error(`Gemini(${model}) empty response`);
        }
      } catch (err) {
        lastErr = err;
        const msg = sanitizeEdgeAgentError(err);
        if (/\b(401|403|API_KEY_INVALID)\b/i.test(msg)) {
          continue;
        }
      }
    }
  }
  throw new Error(sanitizeEdgeAgentError(lastErr));
}

async function edgeCallOpenAiCompatibleAgent(params: {
  provider: 'groq' | 'openrouter';
  endpoint: string;
  keys: string[];
  models: string[];
  systemInstruction: string;
  userPrompt: string;
  expectJson: boolean;
  timeoutMs: number;
  temperature?: number;
  deadlineMs?: number;
}) {
  if (params.keys.length === 0) throw new Error(`${params.provider} API key not configured`);
  let lastErr: unknown = new Error(`${params.provider} call failed`);
  for (const apiKey of params.keys) {
    let keyFatal = false;
    for (const model of params.models) {
      if (keyFatal) break;
      const budgetMs = getEdgeRemainingBudgetMs(params.deadlineMs, params.timeoutMs);
      if (budgetMs < 1500) {
        throw new Error(sanitizeEdgeAgentError(lastErr || new Error('Request deadline reached')));
      }
      const start = Date.now();
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };
        if (params.provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://tradevault.app';
          headers['X-Title'] = 'TradeVault AI Desk';
        }
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: 'system', content: params.systemInstruction },
            { role: 'user', content: params.userPrompt },
          ],
          temperature: params.temperature ?? (params.expectJson ? 0.35 : 0.7),
          max_tokens: 950,
        };
        if (params.expectJson && params.provider === 'groq') {
          body.response_format = { type: 'json_object' };
        }
        const res = await withTimeoutAbort(
          (signal) => fetch(params.endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal }),
          budgetMs,
          `Edge-${params.provider}(${model})`
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          lastErr = new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
          // Fast circuit-breaker: auth/quota/rate-limit errors won't succeed on sibling models
          if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
            keyFatal = true;
          }
          continue;
        }
        const data = await res.json();
        const text = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!text) {
          lastErr = new Error(`${params.provider}(${model}) empty content`);
          continue;
        }
        const json = params.expectJson ? parseEdgeJsonLoose(text) : null;
        if (!params.expectJson || json) {
          return { provider: params.provider, model, text, json, latencyMs: Date.now() - start };
        }
        lastErr = new Error(`${params.provider}(${model}) invalid JSON`);
      } catch (err) {
        lastErr = err;
        if (/timed out|abort/i.test(String((err as any)?.message || err))) {
          keyFatal = true;
        }
      }
    }
  }
  throw new Error(sanitizeEdgeAgentError(lastErr));
}

async function edgeRunAgentCascade(params: {
  order: Array<'gemini' | 'groq' | 'openrouter'>;
  keys: ReturnType<typeof getEdgeAgentDeskKeys>;
  preferDeepGemini?: boolean;
  isBoss?: boolean;
  systemInstruction: string;
  userPrompt: string;
  expectJson: boolean;
  timeoutMs: number;
  temperature?: number;
  deadlineMs?: number;
}) {
  const errors: string[] = [];
  const useDeepGemini = params.preferDeepGemini ?? Boolean(params.isBoss);

  for (const prov of params.order) {
    if (params.deadlineMs && params.deadlineMs - Date.now() < 1500) {
      errors.push(`${prov}: skipped (deadline budget reached)`);
      break;
    }
    try {
      if (prov === 'groq' && params.keys.groqKeys.length > 0) {
        const res = await edgeCallOpenAiCompatibleAgent({
          provider: 'groq',
          endpoint: 'https://api.groq.com/openai/v1/chat/completions',
          keys: params.keys.groqKeys,
          models: AGENT_GROQ_MODELS,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          expectJson: params.expectJson,
          timeoutMs: Math.min(params.timeoutMs, 4_500),
          temperature: params.temperature,
          deadlineMs: params.deadlineMs,
        });
        return { ...res, skippedErrors: errors.length > 0 ? errors : undefined };
      }
      if (prov === 'openrouter' && params.keys.openRouterKeys.length > 0) {
        const res = await edgeCallOpenAiCompatibleAgent({
          provider: 'openrouter',
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          keys: params.keys.openRouterKeys,
          models: AGENT_OPENROUTER_FREE_MODELS,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          expectJson: params.expectJson,
          timeoutMs: Math.min(params.timeoutMs, 4_500),
          temperature: params.temperature,
          deadlineMs: params.deadlineMs,
        });
        return { ...res, skippedErrors: errors.length > 0 ? errors : undefined };
      }
      if (prov === 'gemini' && params.keys.geminiKeys.length > 0) {
        const res = await edgeCallGeminiAgent({
          keys: params.keys.geminiKeys,
          models: useDeepGemini ? AGENT_GEMINI_DEEP_CHAT_MODELS : AGENT_GEMINI_FAST_CHAT_MODELS,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          expectJson: params.expectJson,
          timeoutMs: Math.min(params.timeoutMs, 9_500),
          temperature: params.temperature,
          deadlineMs: params.deadlineMs,
        });
        return { ...res, skippedErrors: errors.length > 0 ? errors : undefined };
      }
    } catch (err) {
      errors.push(`${prov}: ${sanitizeEdgeAgentError(err)}`);
    }
  }
  throw new Error(errors.join(' | ') || 'No configured AI provider succeeded');
}

async function edgeRunSpecialistNewsDraft(params: {
  division: 'TRADE_NEWS' | 'FUNDAMENTAL_GOLD';
  dataset: Record<string, unknown>;
}): Promise<{ used: boolean; provider: string | null; model: string | null; draftText: string }> {
  const keys = getEdgeAgentDeskKeys();
  if (keys.groqKeys.length === 0 && keys.openRouterKeys.length === 0) {
    return { used: false, provider: null, model: null, draftText: '' };
  }
  const order: Array<'groq' | 'openrouter'> =
    params.division === 'TRADE_NEWS' ? ['groq', 'openrouter'] : ['openrouter', 'groq'];
  const systemInstruction =
    params.division === 'TRADE_NEWS'
      ? `Kamu adalah Divisi Riset Berita & Spike XAU/USD. Susun DRAFT MEMO padat (maks 280 kata) dari data nyata untuk diaudit & di-ACC Boss Gemini: arah dominan (BUY/SELL/MIXED), pola 1-Arah vs 2-Arah Sweep First (Fase 0-5m vs 15m+), jebakan speech/priced-in, dan tesis lintas aset.`
      : `Kamu adalah Divisi Riset Fundamental Emas (XAU/USD). DILARANG menulis kata "BUY" atau "SELL" — pakai BULLISH/BEARISH/NEUTRAL. Susun DRAFT MEMO padat (maks 320 kata) untuk diaudit & di-ACC Boss Gemini: rezim makro, Real Yield/US10Y/DXY/FedWatch, arus modal lintas pasar, dan proyeksi 1D/1W/1M.`;
  try {
    const res = await edgeRunAgentCascade({
      order,
      keys,
      isBoss: false,
      systemInstruction,
      userPrompt: `Dataset ${params.division}:\n${JSON.stringify(params.dataset).slice(0, 13_500)}\nSusun draft memo riset untuk Boss Gemini.`,
      expectJson: false,
      timeoutMs: 7000,
      temperature: 0.2,
    });
    if (res.provider === 'groq' || res.provider === 'openrouter') {
      return { used: true, provider: res.provider, model: res.model, draftText: res.text.slice(0, 2600) };
    }
  } catch {
    // Non-blocking fallback directly to Boss Gemini
  }
  return { used: false, provider: null, model: null, draftText: '' };
}

function edgeGetPersonaStyle(persona: string, agentName: string, isEn: boolean): string {
  if (isEn) {
    if (persona === 'concise') {
      return `Your name is ${agentName}, the user's personal trading assistant inside TradeVault. Reply crisp, sharp, natural, and direct (2–4 short sentences). Zero robotic filler.`;
    }
    if (persona === 'mentor') {
      return `Your name is ${agentName}, the user's trusted personal trading partner & mentor inside TradeVault (calm, perceptive, grounded like Alfred). Speak warmly and honestly like a real human partner.`;
    }
    return `Your name is ${agentName}, the user's close personal trading assistant inside TradeVault (smart, warm, witty like Jarvis/Alfred). Chat like a real human friend on WhatsApp/DM — match the user's vibe naturally, never use repetitive cliché lines like "Copy that, boss! I'm always standing by" on every reply.`;
  }
  if (persona === 'concise') {
    return `Namamu ${agentName}, asisten pribadi trading di dalam aplikasi TradeVault. Balas singkat, lugas, dan langsung ke intinya (2–4 kalimat pendek). Tanpa basa-basi robot.`;
  }
  if (persona === 'mentor') {
    return `Namamu ${agentName}, asisten pribadi sekaligus mentor trading di TradeVault (tenang, jeli membaca risiko, hangat seperti Alfred). Ngobrol jujur dan membumi seperti partner manusia sungguhan.`;
  }
  return `Namamu ${agentName}, asisten pribadi trading pengguna di TradeVault. Ngobrol santai, akrab, cerdas, dan luwes layaknya teman dekat/partner di WhatsApp.
GAYA BAHASA WAJIB:
- Ikuti nada bicara user secara alami (kalau user pakai aku/kamu atau santai, imbangi dengan natural — jangan kaku seperti customer service).
- DILARANG mengulang-ulang kalimat klise bot seperti "Siap, bos!", "Saya standby kalau butuh bantuan apa-apa hari ini", atau format daftar kaku "1. ... 2. ... 3. ..." setiap kali membalas.
- Pahami partikel percakapan Indonesia (yaa, deh, dong, aja, nih, sih, kan, kok, yuk) sebagai nada bicara biasa, BUKAN bagian dari nama atau istilah.`;
}

function edgeCleanExtractedAgentName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let cleaned = raw
    .replace(/["'`~!?.,()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;

  cleaned = cleaned
    .replace(
      /\b(ya+h?|yakk?|de+h+|do+ng+|a+ja+|sa+ja+|ni+h+|si+h+|la+h+|ka+n|ko+k|yu+k+|o+ke+y?h?|si+p+|bo+s+|bro+|ga+n|ka+k|bang|min|pls|please|biar|supaya|karena|soal|soalnya|aja|gitu)\b.*$/i,
      ''
    )
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 2);
  cleaned = words.join(' ').trim();
  if (cleaned.length < 2 || cleaned.length > 24) return undefined;
  if (/^(kamu|lu|lo|anda|aku|saya|gue|gw|nama|panggil|ai|bot|null|none|undefined)$/i.test(cleaned)) {
    return undefined;
  }
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function edgeExtractNicknameFallback(message: string): string | undefined {
  const m = message.match(
    /(?:panggil(?:\s+kamu|\s+lu|\s+lo|\s+anda)?(?:\s+dengan)?|namamu(?:\s+sekarang)?|mulai\s+sekarang\s+(?:kamu\s+)?(?:saya\s+|aku\s+)?panggil(?:\s+kamu)?|call\s+you|your\s+name\s+is)\s+["']?([A-Za-z][A-Za-z0-9._\- ]{1,30})["']?/i
  );
  if (!m || !m[1]) return undefined;
  return edgeCleanExtractedAgentName(m[1]);
}

function edgeFormatMemoryList(contextObj: any): string {
  const rawList = Array.isArray(contextObj?.memoryNotes) ? contextObj.memoryNotes : [];
  if (rawList.length === 0) return '(Belum ada memori tersimpan)';
  return rawList
    .slice(0, 20)
    .map((item: any, idx: number) => {
      if (typeof item === 'string') return `${idx + 1}. ${item.slice(0, 200)}`;
      if (item && typeof item.text === 'string') return `${idx + 1}. [${String(item.category || 'general')}] ${item.text.slice(0, 200)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function edgePreClassifySpeedHint(message: string): {
  likelyHeavyMarket: boolean;
  likelyLivePrice: boolean;
} {
  const q = message.trim().toLowerCase();
  const hasPriceCue =
    /\b(harga|price|spot|level|berapa|brp|skrg|sekarang|saat ini|di angka|dimana|di mana|running|update harga|cek harga)\b/i.test(
      q
    );
  const hasAssetCue = /\b(xau|xauusd|gold|emas|dxy|us10y|us02y|usoil|oil|btc|eurusd)\b/i.test(q);
  const asksDeepAnalysis =
    /\b(kenapa|mengapa|analisis|analisa|fundamental|berita|news|jurnal|journal|spike|sweep|prediksi|arah|kemana|ke mana|buy|sell|entry|posisi|risiko|risk|drawdown|win\s?rate|fomc|cpi|nfp|evaluasi|audit|bagusnya|ambil)\b/i.test(
      q
    );
  const asksLivePrice = hasPriceCue && hasAssetCue && !asksDeepAnalysis;
  const asksMarketOrJournal =
    /\b(xau|xauusd|gold|emas|dxy|yield|us10y|us02y|usoil|oil|forex|market|pasar|chart|candle|news|berita|makro|macro|fundamental|fomc|fed|fedwatch|cpi|ppi|nfp|pmi|powell|polymarket|cycle|confluence|smc|heatmap|spike|sweep|whipsaw|buy|sell|long|short|entry|sl|tp|jurnal|journal|trade|trading|posisi|open|planned|lot|risiko|risk|drawdown|dd|win\s?rate|profit|loss|rugi|equity|saldo|balance|guardrail|evaluasi|audit|rekap)\b/i.test(
      q
    );
  return {
    likelyHeavyMarket: asksMarketOrJournal && !asksLivePrice,
    likelyLivePrice: asksLivePrice,
  };
}

function edgeBuildCompactDeviceContext(contextObj: any): Record<string, unknown> {
  return {
    runtime: contextObj?.runtime ?? null,
    liveMarketQuote: contextObj?.liveMarketQuote ?? null,
    macroNews: contextObj?.macroNews
      ? {
          analyzedAt: contextObj.macroNews.analyzedAt,
          dominantBias: contextObj.macroNews.dominantBias,
          buyProbability: contextObj.macroNews.buyProbability,
          sellProbability: contextObj.macroNews.sellProbability,
          mixedProbability: contextObj.macroNews.mixedProbability,
          primaryEvent: contextObj.macroNews.primaryEvent,
          institutionalDeskThesis: contextObj.macroNews.institutionalDeskThesis,
          actionPlan: contextObj.macroNews.actionPlan,
          whipsawWarning: contextObj.macroNews.whipsawWarning,
          dualHorizon: contextObj.macroNews.dualHorizon,
          intermarketPulse: contextObj.macroNews.intermarketPulse,
          topHeadlines: contextObj.macroNews.topHeadlines,
        }
      : null,
    fundamentalGold: contextObj?.fundamentalGold
      ? {
          analyzedAt: contextObj.fundamentalGold.analyzedAt,
          overallBias: contextObj.fundamentalGold.overallBias,
          bullishProbability: contextObj.fundamentalGold.bullishProbability,
          bearishProbability: contextObj.fundamentalGold.bearishProbability,
          regime: contextObj.fundamentalGold.regime,
          horizons: contextObj.fundamentalGold.horizons,
          tacticalOverlayStatus: contextObj.fundamentalGold.tacticalOverlayStatus,
          tacticalOverlayHeadline: contextObj.fundamentalGold.tacticalOverlayHeadline,
          headlineSummary: contextObj.fundamentalGold.headlineSummary,
        }
      : null,
    cmeFedWatch: contextObj?.cmeFedWatch ?? null,
    polymarket: contextObj?.polymarket ?? null,
    smcSignal: contextObj?.smcSignal ?? null,
    journal: contextObj?.journal ?? null,
    syncStatus: contextObj?.syncStatus ?? null,
  };
}

async function handleAgentDeskChat(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const deadlineMs = startedAt + 18_500; // Strict global budget so APK NEVER hits 38s timeout!
  try {
    const rawBody = (await req.json()) || {};
    const message = typeof rawBody.message === 'string' ? rawBody.message.trim().slice(0, 2000) : '';
    const language: 'id' | 'en' = rawBody.language === 'en' ? 'en' : 'id';
    const isEn = language === 'en';
    const rawPersona = String(rawBody.persona || 'casual').toLowerCase();
    const persona = rawPersona === 'concise' || rawPersona === 'mentor' ? rawPersona : 'casual';
    const agentName =
      typeof rawBody.agentName === 'string' && rawBody.agentName.trim()
        ? rawBody.agentName.trim().slice(0, 40)
        : 'Head Desk';

    if (!message) {
      return jsonResponse({ success: false, error: 'Pertanyaan tidak boleh kosong.' }, 400);
    }

    const keys = getEdgeAgentDeskKeys();
    if (keys.geminiKeys.length + keys.groqKeys.length + keys.openRouterKeys.length === 0) {
      return jsonResponse(
        {
          success: false,
          error: isEn
            ? 'No AI provider key configured in Supabase Secrets.'
            : 'Belum ada API Key AI yang terpasang di Supabase Secrets.',
        },
        503
      );
    }

    const history = (Array.isArray(rawBody.history) ? rawBody.history : [])
      .slice(-10)
      .filter(
        (h: any) =>
          h &&
          (h.role === 'user' || h.role === 'assistant') &&
          typeof h.content === 'string' &&
          h.content.trim().length > 0
      )
      .map((h: any) => ({ role: h.role, content: String(h.content).trim().slice(0, 800) }));

    const contextObj =
      rawBody.context && typeof rawBody.context === 'object' && !Array.isArray(rawBody.context)
        ? rawBody.context
        : {};

    const historyText =
      history.length > 0
        ? history.slice(-8).map((h: any) => `${h.role === 'user' ? 'USER' : 'ASISTEN'}: ${h.content}`).join('\n')
        : '(Baru memulai obrolan)';

    const fmtProv = (p: string) => (p === 'gemini' ? 'Gemini' : p === 'groq' ? 'Groq' : p === 'openrouter' ? 'OpenRouter' : 'System');
    const speedHint = edgePreClassifySpeedHint(message);
    const memoryText = edgeFormatMemoryList(contextObj);
    const personaGuide = edgeGetPersonaStyle(persona, agentName, isEn);

    const includeFullData = speedHint.likelyHeavyMarket || speedHint.likelyLivePrice || history.length >= 2;
    const compactContext = includeFullData
      ? edgeBuildCompactDeviceContext(contextObj)
      : {
          runtime: contextObj?.runtime ?? null,
          liveMarketQuote: contextObj?.liveMarketQuote?.xauusd
            ? { xauusd: contextObj.liveMarketQuote.xauusd }
            : null,
        };

    const systemInstruction = `${personaGuide}

TUGAS UTAMA (OTAK TUNGGAL CERDAS):
Pahami MAKSUD & KONTEKS pesan user secara menyeluruh dari riwayat obrolan, lalu pilih SATU jalur paling tepat di field "intent":
1. "SMALL_TALK" — Sapaan, perkenalan, obrolan santai, curhat ringan, terima kasih, atau user memberi nama panggilan baru (mis. "saya panggil kamu Wowo yaa").
   - ATURAN KERAS: DILARANG membocorkan/membahas arah market, bias BUY/SELL, harga XAU, berita, atau data jurnal jika user tidak menanyakannya!
   - Jika user memberi nama panggilan baru, isi "renamedTo" HANYA dengan NAMA BERSIHNYA saja tanpa kata penyambung/partikel (contoh: "saya panggil kamu Wowo yaa" -> renamedTo: "Wowo", BUKAN "Wowo yaa").
2. "OUT_OF_SCOPE" — Pertanyaan topik umum di luar trading & TradeVault (cuaca, bola, resep makanan, gosip, film, obat, dll).
   - Tolak dengan santai, sopan, dan tetap hangat sesuai karaktermu; jelaskan ranah tugasmu khusus di market XAU/USD, berita makro, fundamental emas, dan jurnal trading TradeVault. Jangan pernah mengarang jawaban topik di luar ranah itu.
3. "LIVE_PRICE_CHECK" — User menanyakan harga spot terkini (mis. harga XAU/USD sekarang berapa).
   - Gunakan HANYA angka nyata dari "DATA PERANGKAT -> liveMarketQuote". Sebutkan angka + sumber + jam update dengan natural. DILARANG mengarang harga jika data kosong/offline.
4. "DIRECT_FOLLOWUP" — Tanggapan lanjutan singkat dalam obrolan trading yang sedang berlangsung.
5. "FULL_OFFICE" — Analisis arah market XAU/USD, Trade News, Spike/Sweep, Fundamental Gold, Polymarket, FedWatch, evaluasi jurnal offline, posisi aktif, atau manajemen risiko.
   - ATURAN ANTI-SALAH BACA:
     * "Bearish Spike awal" = harga XAU/USD berpotensi TURUN tajam dulu, BUKAN sinyal BUY langsung!
     * "Bullish Spike awal" = harga XAU/USD berpotensi NAIK tajam dulu, jangan dikejar buta jika bias utama SELL!
     * "TWO_WAY_SWEEP_FIRST" = rawan sapuan 2 arah di menit 0–5, tunggu konfirmasi struktur di menit 15+.
   - Gunakan HANYA data nyata dari DATA PERANGKAT. Jangan mengarang angka.
   - Jelaskan mengalir seperti partner trading di chat WA (bukan laporan template bernomor kaku).

ATURAN MEMORI:
- Isi "newMemories" (0–2 item singkat) HANYA jika ada fakta baru yang benar-benar penting diingat untuk hari-hari mendatang (mis. nama panggilan baru, preferensi user, level XAU penting, atau pola jurnal penting). Jangan simpan basa-basi kosong.

Keluarkan HANYA JSON valid:
{
  "intent": "SMALL_TALK" | "OUT_OF_SCOPE" | "LIVE_PRICE_CHECK" | "DIRECT_FOLLOWUP" | "FULL_OFFICE",
  "reply": "Balasan percakapan natural & manusiawi dalam ${isEn ? 'English' : 'Bahasa Indonesia'}",
  "renamedTo": null | "NamaPanggilanBersih",
  "directionClarity": "BUY" | "SELL" | "WAIT_MIXED" | "INFO_ONLY",
  "newMemories": [{"text": "1 kalimat fakta penting", "category": "preference" | "market" | "journal" | "general"}]
}`;

    const userPrompt = `Bahasa: ${isEn ? 'English' : 'Bahasa Indonesia'}
Nama asisten saat ini: "${agentName}"

MEMORI JANGKA PANJANG:
${memoryText}

RIWAYAT OBROLAN TERAKHIR:
${historyText}

DATA PERANGKAT (hanya baca jika user memang bertanya soal harga/market/jurnal):
${JSON.stringify(compactContext).slice(0, 13_500)}

PESAN TERBARU USER:
"${message}"

Keluarkan HANYA JSON valid.`;

    const order: Array<'gemini' | 'groq' | 'openrouter'> = speedHint.likelyHeavyMarket
      ? ['gemini', 'groq', 'openrouter']
      : ['groq', 'gemini', 'openrouter'];

    const res = await edgeRunAgentCascade({
      order,
      keys,
      preferDeepGemini: speedHint.likelyHeavyMarket,
      systemInstruction,
      userPrompt,
      expectJson: true,
      timeoutMs: 9_500,
      temperature: speedHint.likelyHeavyMarket || speedHint.likelyLivePrice ? 0.35 : 0.7,
      deadlineMs,
    });

    const parsed = res.json || {};
    const rawIntent = String(parsed.intent || 'FULL_OFFICE').toUpperCase();
    const routeType =
      rawIntent === 'SMALL_TALK' ||
      rawIntent === 'OUT_OF_SCOPE' ||
      rawIntent === 'LIVE_PRICE_CHECK' ||
      rawIntent === 'DIRECT_FOLLOWUP'
        ? rawIntent
        : 'FULL_OFFICE';

    const answer = String(parsed.reply || res.text || '').trim();
    const llmRename = edgeCleanExtractedAgentName(parsed.renamedTo);
    const regexRename = edgeExtractNicknameFallback(message);
    const detectedAgentName = llmRename || regexRename;

    const dirRaw = String(parsed.directionClarity || 'INFO_ONLY').toUpperCase();
    const directionClarity =
      dirRaw === 'BUY' || dirRaw === 'SELL' || dirRaw === 'WAIT_MIXED' ? dirRaw : 'INFO_ONLY';

    const rawMem = Array.isArray(parsed.newMemories) ? parsed.newMemories : [];
    const normalizedMems = rawMem
      .slice(0, 3)
      .filter((m: any) => m && typeof m.text === 'string' && m.text.trim().length > 4)
      .map((m: any) => ({
        text: String(m.text).trim().slice(0, 220),
        category:
          m.category === 'preference' || m.category === 'market' || m.category === 'journal'
            ? m.category
            : 'general',
      }));

    if (
      detectedAgentName &&
      !normalizedMems.some(
        (m: any) => m.category === 'preference' && m.text.toLowerCase().includes(detectedAgentName.toLowerCase())
      )
    ) {
      normalizedMems.unshift({
        text: `User memanggil asisten dengan nama "${detectedAgentName}".`,
        category: 'preference',
      });
    }

    const traceSummary =
      res.skippedErrors && res.skippedErrors.length > 0
        ? `${routeType} via ${fmtProv(res.provider)} (${res.model}) · skip: ${res.skippedErrors.join('; ').slice(0, 120)}`
        : `${routeType} via ${fmtProv(res.provider)} (${res.model})`;

    return jsonResponse({
      success: true,
      routeType,
      answer,
      actionCard: {
        directionClarity,
        directionLabel: (detectedAgentName || agentName).slice(0, 120),
        spikeWarning: '-',
        riskReminder: '-',
      },
      workflowTrace: [
        {
          stepNumber: 1,
          role: 'BOSS_DIRECT',
          divisionName: `${detectedAgentName || agentName} (Single-Pass)`,
          provider: res.provider,
          model: res.model,
          action:
            routeType === 'SMALL_TALK'
              ? isEn
                ? 'Personal Assistant Chat'
                : 'Mode Asisten (Santai)'
              : routeType === 'OUT_OF_SCOPE'
              ? isEn
                ? 'Scope Guard'
                : 'Penjaga Batas Ranah'
              : routeType === 'LIVE_PRICE_CHECK'
              ? isEn
                ? 'Live XAU/USD Lookup'
                : 'Cek Harga Live'
              : isEn
              ? 'Smart Unified Desk Brain'
              : 'Otak Terpadu (Hemat Kuota)',
          status: res.skippedErrors && res.skippedErrors.length > 0 ? 'fallback' : 'completed',
          summary: traceSummary,
          latencyMs: res.latencyMs,
        },
      ],
      revisionTriggered: false,
      activeProviders: [fmtProv(res.provider)],
      detectedAgentName,
      newMemoryNotes: normalizedMems.slice(0, 3),
      totalLatencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return jsonResponse(
      {
        success: false,
        answer: '',
        workflowTrace: [],
        revisionTriggered: false,
        activeProviders: [],
        totalLatencyMs: Date.now() - startedAt,
        error: `Asisten AI sementara tidak dapat merespons: ${sanitizeEdgeAgentError(err)}`,
      },
      502
    );
  }
}

async function handleAgentDeskEndSession(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) || {};
    const language: 'id' | 'en' = body.language === 'en' ? 'en' : 'id';
    const isEn = language === 'en';
    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-24)
      .filter(
        (h: any) =>
          h &&
          (h.role === 'user' || h.role === 'assistant') &&
          typeof h.content === 'string' &&
          h.content.trim().length > 0
      )
      .map((h: any) => ({ role: h.role, content: String(h.content).trim().slice(0, 600) }));

    if (history.length === 0) {
      return jsonResponse({ success: true, sessionSummary: isEn ? 'Empty session closed.' : 'Sesi kosong ditutup.', memoryFacts: [], latencyMs: 1 });
    }

    const keys = getEdgeAgentDeskKeys();
    if (keys.geminiKeys.length + keys.groqKeys.length + keys.openRouterKeys.length === 0) {
      return jsonResponse({ success: false, sessionSummary: '', memoryFacts: [], error: 'No AI key configured.' }, 503);
    }

    const existingMem = Array.isArray(body.existingMemories)
      ? body.existingMemories.slice(0, 20).map((m: any) => (typeof m === 'string' ? m : m?.text || '')).filter(Boolean)
      : [];

    const res = await edgeRunAgentCascade({
      order: ['groq', 'gemini', 'openrouter'],
      keys,
      isBoss: false,
      systemInstruction: `Kamu adalah MANAJER MEMORI ASISTEN PRIBADI TradeVault.
Ringkas sesi yang baru selesai menjadi JSON: {"sessionSummary":string,"memoryFacts":[{"text":string,"category":"preference"|"market"|"journal"|"general"}]} (maksimal 3 memoryFacts paling penting, jangan ulangi memori lama atau basa-basi kosong).`,
      userPrompt: `Bahasa: ${isEn ? 'English' : 'Bahasa Indonesia'}\nMemori lama:\n${existingMem.join('\n') || '(kosong)'}\nTranskrip:\n${history.map((h: any) => `${h.role === 'user' ? 'USER' : 'ASISTEN'}: ${h.content}`).join('\n')}\nKeluarkan HANYA JSON.`,
      expectJson: true,
      timeoutMs: 9000,
    });
    const parsed = res.json || {};
    const facts = (Array.isArray(parsed.memoryFacts) ? parsed.memoryFacts : [])
      .slice(0, 3)
      .filter((f: any) => f && typeof f.text === 'string' && f.text.trim().length > 4)
      .map((f: any) => ({
        text: String(f.text).trim().slice(0, 220),
        category: f.category === 'preference' || f.category === 'market' || f.category === 'journal' ? f.category : 'general',
      }));

    return jsonResponse({
      success: true,
      sessionSummary: String(parsed.sessionSummary || (isEn ? 'Session archived.' : 'Sesi diarsipkan.')).slice(0, 280),
      memoryFacts: facts,
      providerUsed: res.provider,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return jsonResponse(
      { success: false, sessionSummary: '', memoryFacts: [], latencyMs: Date.now() - startedAt, error: sanitizeEdgeAgentError(err) },
      502
    );
  }
}

async function handleAgentDeskQaDiagnose(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) || {};
    const language: 'id' | 'en' = body.language === 'en' ? 'en' : 'id';
    const isEn = language === 'en';
    const diagnostics = body.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics : null;
    if (!diagnostics) {
      return jsonResponse({ success: false, error: isEn ? 'Missing diagnostics payload.' : 'Payload diagnostik kosong.' }, 400);
    }
    const keys = getEdgeAgentDeskKeys();
    if (keys.geminiKeys.length + keys.groqKeys.length + keys.openRouterKeys.length === 0) {
      return jsonResponse({ success: false, error: 'Belum ada API key AI aktif di Supabase Secrets.' }, 503);
    }
    const sys = `Kamu adalah DIVISI QA / CLEANING SERVICE ENGINEER untuk TradeVault (Web & Android APK Capacitor).
Analisis JSON diagnostik + log error secara objektif. Jangan mengarang masalah yang tidak ada di data.
Keluarkan HANYA JSON valid: {"healthGrade":"HEALTHY"|"WARNING"|"CRITICAL","summary":string,"rootCauses":string[],"recommendedActions":string[]}`;
    const res = await edgeRunAgentCascade({
      order: ['groq', 'gemini', 'openrouter'],
      keys,
      isBoss: false,
      systemInstruction: sys,
      userPrompt: `Bahasa: ${isEn ? 'English' : 'Bahasa Indonesia'}\nData Diagnostik:\n${JSON.stringify(diagnostics).slice(0, 15_000)}\nKeluarkan HANYA JSON.`,
      expectJson: true,
      timeoutMs: 11_000,
    });
    const parsed = res.json || {};
    const gradeRaw = String(parsed.healthGrade || 'WARNING').toUpperCase();
    const healthGrade = gradeRaw === 'HEALTHY' || gradeRaw === 'CRITICAL' ? gradeRaw : 'WARNING';
    return jsonResponse({
      success: true,
      healthGrade,
      summary: String(parsed.summary || '').slice(0, 600),
      rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses.slice(0, 6).map((x: any) => String(x).slice(0, 220)) : [],
      recommendedActions: Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.slice(0, 6).map((x: any) => String(x).slice(0, 220))
        : [],
      providerUsed: res.provider === 'gemini' ? 'Gemini' : res.provider === 'groq' ? 'Groq' : 'OpenRouter',
      modelUsed: res.model,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return jsonResponse(
      {
        success: false,
        healthGrade: 'WARNING',
        summary: '',
        rootCauses: [],
        recommendedActions: [],
        latencyMs: Date.now() - startedAt,
        error: sanitizeEdgeAgentError(err),
      },
      502
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(req.url);
  const path = reqUrl.pathname.replace(/\/+$/, '');

  if (req.method === 'GET' && (path.endsWith('/api/health') || path.endsWith('/tradevault-api'))) {
    const scannerKeys = getScannerGeminiApiKeys();
    const newsKeys = getNewsGeminiApiKeys();
    const agentKeys = getEdgeAgentDeskKeys();
    return jsonResponse({
      ok: true,
      service: 'tradevault-supabase-edge-api',
      agentDeskEngine: 'single-pass-v1.3.9',
      geminiConfigured: Boolean(scannerKeys.length > 0 || newsKeys.length > 0),
      scannerGeminiConfigured: scannerKeys.length > 0,
      newsGeminiConfigured: newsKeys.length > 0,
      groqConfigured: agentKeys.groqKeys.length > 0,
      openRouterConfigured: agentKeys.openRouterKeys.length > 0,
      agentDeskReady: Boolean(
        agentKeys.geminiKeys.length > 0 ||
          agentKeys.groqKeys.length > 0 ||
          agentKeys.openRouterKeys.length > 0
      ),
      apiKeysStrictlySeparated: true,
      scannerModelCascade: SCANNER_MODEL_CASCADE,
      proxyCapabilities: {
        polymarket: ALLOWED_PROXY_DOMAINS.includes('gamma-api.polymarket.com'),
        cftc: ALLOWED_PROXY_DOMAINS.includes('cftc.gov'),
        twelvedata: ALLOWED_PROXY_DOMAINS.includes('twelvedata.com'),
        binance:
          ALLOWED_PROXY_DOMAINS.includes('binance.com') ||
          ALLOWED_PROXY_DOMAINS.includes('binance.vision'),
      },
      isMarketOpen: isMarketDayUtc(new Date()),
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method === 'GET' && path.endsWith('/api/proxy')) {
    return handleProxy(reqUrl);
  }

  if (req.method === 'POST' && path.endsWith('/api/extract-trade-screenshot')) {
    return handleExtractTradeScreenshot(req);
  }

  if (req.method === 'POST' && path.endsWith('/api/extract-mt5-history')) {
    return handleExtractMt5History(req);
  }

  if (req.method === 'POST' && path.endsWith('/api/macro-news/analyze')) {
    return handleMacroNewsAnalyze(req);
  }

  if (req.method === 'POST' && path.endsWith('/api/macro-news/fundamental')) {
    return handleFundamentalGoldAnalyze(req);
  }

  if (req.method === 'POST' && path.endsWith('/api/agent-desk/chat')) {
    return handleAgentDeskChat(req);
  }

  if (req.method === 'POST' && path.endsWith('/api/agent-desk/end-session')) {
    return handleAgentDeskEndSession(req);
  }

  if (req.method === 'POST' && path.endsWith('/api/agent-desk/qa-diagnose')) {
    return handleAgentDeskQaDiagnose(req);
  }

  return jsonResponse(
    {
      ok: false,
      error: `Route not found: ${req.method} ${path}`,
    },
    404
  );
});
