import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
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
  computeDeterministicMacroSnapshot,
  computeDualHorizonAnalysis,
  isSnapshotFresh,
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

// Standalone healthcheck endpoint for APK & external server verification
app.get('/api/health', (_req, res) => {
  const geminiConfigured = Boolean(
    (process.env.GEMINI_NEWS_API_KEY || process.env.GEMINI_API_KEY || '').trim()
  );
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.json({
    ok: true,
    service: 'tradevault-standalone-backend',
    geminiConfigured,
    isMarketOpen: isMarketDay(new Date(), { useUtc: true, enforceFridayCloseUtc: true }),
    timestamp: new Date().toISOString(),
  });
});

// Resilient backend proxy endpoint for public financial feeds
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target url parameter' });
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

function parseNumericValue(val: any, instrument = 'XAUUSD'): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    if (isNaN(val) || !Number.isFinite(val)) return null;
    if (instrument === 'XAUUSD' && val >= 1.5 && val <= 6.5) {
      return Number((val * 1000).toFixed(3));
    }
    return val;
  }
  if (typeof val === 'string') {
    let s = val.trim();
    if (!s) return null;

    const contextualMatch = s.match(
      /(?:at|@|entry[:\s]|open[:\s]|price[:\s]|level[:\s])\s*([+-]?[0-9][0-9., ]+)/i
    );
    if (contextualMatch) {
      s = contextualMatch[1].trim();
    }

    s = s.replace(/[^0-9.,+\- ]/g, '').trim();
    if (!s) return null;

    // Format X.XXX,XXX (dot thousands, comma decimal e.g. "4.054,405" -> "4054.405")
    if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^[+-]?\d{1,3}(?:[ ,]\d{3})+\.\d+$/.test(s)) {
      s = s.replace(/[ ,]/g, '');
    } else if (s.includes('.') && s.includes(',')) {
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',') && !s.includes('.')) {
      s = s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length >= 2) {
      const lastDot = s.lastIndexOf('.');
      s = s.slice(0, lastDot).replace(/\./g, '') + '.' + s.slice(lastDot + 1);
    } else {
      s = s.replace(/ /g, '');
    }

    const num = parseFloat(s);
    if (isNaN(num) || !Number.isFinite(num)) return null;
    if (instrument === 'XAUUSD' && num >= 1.5 && num <= 6.5) {
      return Number((num * 1000).toFixed(3));
    }
    return num;
  }
  return null;
}

function normalizeInstrument(raw: string | null | undefined): string {
  if (!raw) return 'XAUUSD';
  let s = raw.toUpperCase().trim();

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

const quotaCooldownUntilByModel = new Map<string, number>();

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(400).json({
        success: false,
        error:
          'GEMINI_API_KEY belum dikonfigurasi di environment server. Pastikan API key telah disetel.',
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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const geometryHintBlock =
      canvasHints && canvasHints.hasPositionBox
        ? `\nPIXEL GEOMETRY SCANNER HINTS (VERIFIED FROM IMAGE PIXELS):
- A TradingView ${canvasHints.inferredPosition || 'BUY/SELL'} Position Box (Profit Zone & Risk Zone) was detected:
  * Verified Direction: ${canvasHints.inferredPosition || 'UNKNOWN'} (${
            canvasHints.inferredPosition === 'SELL'
              ? 'Risk Zone (Dark Grey/Slate or Red) is at the TOP and Profit Zone (Dark Blue/Navy or Green) is at the BOTTOM -> SELL (TP < Entry < SL)'
              : 'Profit Zone (Green or Dark Blue/Navy) is at the TOP and Risk Zone (Red or Dark Grey/Slate) is at the BOTTOM -> BUY (SL < Entry < TP)'
          })
  * Top boundary of Position Box is at vertical Y = ${
    canvasHints.boxTopYRatio != null ? (canvasHints.boxTopYRatio * 100).toFixed(1) + '%' : 'N/A'
  } from top of image.
  * Central Dividing Line (Entry Price) is at vertical Y = ${
    canvasHints.entryYRatio != null ? (canvasHints.entryYRatio * 100).toFixed(1) + '%' : 'N/A'
  } from top of image.
  * Bottom boundary of Position Box is at vertical Y = ${
    canvasHints.boxBottomYRatio != null ? (canvasHints.boxBottomYRatio * 100).toFixed(1) + '%' : 'N/A'
  } from top of image.\n`
        : '';

    const prompt = `You are an elite financial chart & order OCR specialist for MetaTrader 5 (MT5 / MT4) and TradingView.
Carefully inspect the full, uncropped screenshot from the left edge to the rightmost Y-axis price scale.
${geometryHintBlock}
1. SPATIAL VISUAL RULES FOR METATRADER 5 (MT5) CHARTS:
   - Read the order labels at the LEFT edge of the chart: "TP", "SL", "BUY LIMIT", "SELL LIMIT", "BUY STOP", "SELL STOP", "BUY", "SELL" (for example: "TP", "BUY LIMIT 0.12", "SL").
   - Follow each label's horizontal dashed line straight across to the RIGHTMOST Y-AXIS, and ONLY extract the price number that is inside a BORDERED / OUTLINED BOX (kotak berbingkai) aligned with that dashed line:
     * Example: "TP" dashed line -> bordered box "4074.43" on right Y-axis -> takeProfit = 4074.43
     * Example: "BUY LIMIT 0.12" dashed line -> bordered box "4042.74" on right Y-axis -> entryPrice = 4042.74, lotSize = 0.12, position = "BUY"
     * Example: "SL" dashed line -> bordered box "4031.97" on right Y-axis -> stopLoss = 4031.97
   - IGNORE plain unbordered grid numbers on the Y-axis (such as "4052.92" or "4030.42").
   - IGNORE the running candle price badge (such as "4050.87 / 00:50") — put that ONLY in currentPrice, NEVER in entryPrice, stopLoss, or takeProfit!
   - STATUS RULE: If the order label contains "LIMIT" or "STOP" (e.g. "BUY LIMIT", "SELL LIMIT", "BUY STOP", "SELL STOP"), you MUST set status = "PLANNED".

2. SPATIAL VISUAL RULES FOR TRADINGVIEW CHARTS:
   - Detect the Position Tool's two vertically-adjacent rectangular zones even when customized with Dark Blue / Navy (Profit Zone) and Dark Grey / Slate (Risk Zone) instead of Green and Red.
   - IGNORE indicator or annotation boxes inside the chart such as "OB m5", "FVG", or "BOS", and ignore the live running candle price badge (e.g. "4.105,78" or "4.105,735").
   - Read the Y-axis price badges at:
     (1) The outer TOP boundary of the top box,
     (2) The CENTRAL HORIZONTAL DIVIDING LINE between the two boxes (Entry Price),
     (3) The outer BOTTOM boundary of the bottom box.
   - Direction Rule:
     * If the Dark Blue / Navy (or Green) target box is at the BOTTOM and the Dark Grey / Slate (or Red) risk box is at the TOP, the direction is SELL (takeProfit < entryPrice < stopLoss, e.g. SL = 4099.857 at top, Entry = 4093.045 in middle, TP = 4054.405 at bottom).
     * If the Green (or Dark Blue / Navy) target box is at the TOP and the Red (or Dark Grey / Slate) risk box is at the BOTTOM, the direction is BUY (stopLoss < entryPrice < takeProfit).
   - LOCAL NUMBER FORMAT NORMALIZATION: If the Y-axis uses dot thousands separators and comma decimal separators (such as "4.054,405" or "4.105,735"), remove the thousands dot (.) and convert the comma (,) to a decimal point -> 4054.405 and 4105.735.
   - LOT SIZE ON TRADINGVIEW: Always return null for lotSize on TradingView.

3. NO FAKE / SYNTHETIC NUMBERS:
   - NEVER invent, interpolate, or calculate synthetic SL/TP numbers using offsets (such as entry - 0.04 or + 0.08).
   - If Entry, SL, or TP is not clearly visible on the chart, return null for that field so the user can fill it manually.`;

    const candidateModels = [
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ];
    let responseText = '';
    let usedModel = '';

    for (const model of candidateModels) {
      const cooldownUntil = quotaCooldownUntilByModel.get(model) || 0;
      if (Date.now() < cooldownUntil) {
        continue;
      }

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
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
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  detected: { type: Type.BOOLEAN, description: 'True if trade setup or order is detected' },
                  source: { type: Type.STRING, description: 'MT5, TRADINGVIEW, or CHART' },
                  instrument: { type: Type.STRING, description: 'Clean instrument symbol, e.g. XAUUSD, EURUSD, GBPUSD, USDJPY, BTCUSD, US30, NAS100' },
                  position: { type: Type.STRING, description: 'BUY or SELL' },
                  lotSize: { type: Type.NUMBER, description: 'Lot size ONLY if source is MT5 (e.g. 0.01, 0.12, 0.25). Null for TradingView.' },
                  entryPrice: { type: Type.NUMBER, description: 'Exact entry price from right Y-axis bordered box/badge, or null if not detected' },
                  stopLoss: { type: Type.NUMBER, description: 'Exact Stop Loss price from right Y-axis bordered box/badge, or null if not detected' },
                  takeProfit: { type: Type.NUMBER, description: 'Exact Take Profit price from right Y-axis bordered box/badge, or null if not detected' },
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
          });

          if (response && response.text) {
            responseText = response.text;
            usedModel = model;
            break;
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          const isQuotaExhausted =
            errMsg.includes('429') ||
            errMsg.includes('RESOURCE_EXHAUSTED') ||
            errMsg.includes('Quota exceeded');

          if (isQuotaExhausted) {
            // Put this model on a 1-hour (3600s) cooldown and immediately try the next model in the queue
            quotaCooldownUntilByModel.set(model, Date.now() + 60 * 60 * 1000);
            break;
          }

          const isTransientServerOverload =
            errMsg.includes('503') ||
            errMsg.includes('high demand') ||
            errMsg.includes('overloaded') ||
            errMsg.includes('UNAVAILABLE') ||
            errMsg.includes('500');

          if (isTransientServerOverload && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          break;
        }
      }
      if (responseText) break;
    }

    if (!responseText) {
      res.status(200).json({
        success: false,
        quotaExhausted: true,
        error:
          'Batas kuota harian tier gratis tercapai sementara; beralih otomatis ke pemindai geometri kanvas & OCR.',
      });
      return;
    }

    const parsedData = parseAiJsonResponse(responseText);

    // Normalize instrument name & strip broker suffixes
    const cleanInstrument = normalizeInstrument(parsedData.instrument);

    // Normalize position (prefer verified canvas box direction if TradingView box is present)
    let cleanPosition: 'BUY' | 'SELL' =
      canvasHints?.hasPositionBox && (canvasHints.inferredPosition === 'BUY' || canvasHints.inferredPosition === 'SELL')
        ? canvasHints.inferredPosition
        : parsedData.position === 'SELL'
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
    const notesStr = String(parsedData.notes || '');
    const rawStatusStr = String(parsedData.status || '').toUpperCase();
    const hasPendingKeyword = /\b(BUY\s+LIMIT|SELL\s+LIMIT|BUY\s+STOP|SELL\s+STOP|LIMIT|STOP|PENDING)\b/i.test(
      notesStr
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
        notes: parsedData.notes || '',
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
  const newsApiKey = (
    process.env.GEMINI_NEWS_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ''
  ).trim();
  if (!newsApiKey) return [];

  const candidateModels = [
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ];

  const ai = new GoogleGenAI({
    apiKey: newsApiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
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
      const response = await ai.models.generateContent({
        model,
        contents: calendarPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = (response?.text || '').trim();
      if (!text) continue;
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) continue;
      const parsed = JSON.parse(clean.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('Quota exceeded')
      ) {
        newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
        continue;
      }
      break;
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
    !forceRefresh &&
    cachedCmeFedWatch &&
    cachedCmeFedWatch.data.isAvailable &&
    Date.now() - cachedCmeFedWatch.fetchedAt < 10 * 60 * 1000
  ) {
    return cachedCmeFedWatch.data;
  }

  // Pull live ZQ=F & ^IRX quotes in parallel as automatic real-time bond/futures backup
  const futuresBackupPromise = fetchServerYahooFedFundsAndTbillQuotes(us10yPulse);

  const newsApiKey = (
    process.env.GEMINI_NEWS_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ''
  ).trim();

  if (!newsApiKey) {
    const backup = await futuresBackupPromise;
    if (backup.isAvailable) {
      cachedCmeFedWatch = { fetchedAt: Date.now(), data: backup };
      return backup;
    }
    return cachedCmeFedWatch?.data?.isAvailable ? cachedCmeFedWatch.data : backup;
  }

  const candidateModels = [
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ];

  const ai = new GoogleGenAI({
    apiKey: newsApiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const fedWatchPrompt = `Today is ${todayIso}. Use Google Search with these exact specific search queries:
1) "CME FedWatch December 2026 FOMC rate probability hike hold cut"
2) "FedWatch tool target rate probabilities December 2026"

Find the latest CME FedWatch Tool target rate probabilities for the December 2026 FOMC meeting (FOMC Desember 2026).
Extract the exact percentages (with 1 decimal place, e.g. XX.X) for:
- Rate Hike (+25 bps or more): hikeProbability
- Hold (Unchanged): holdProbability
- Rate Cut (-25 bps or more): cutProbability
- Target Rapat: "FOMC Desember 2026"

Return ONLY a valid JSON object (no markdown fences) with these exact fields:
{
  "isAvailable": boolean,
  "fomcMeetingDate": "FOMC Desember 2026",
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
      const response = await ai.models.generateContent({
        model,
        contents: fedWatchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

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
          const evaluated = evaluateCmeFedWatchScoring({
            isAvailable: true,
            fomcMeetingDate: 'FOMC Desember 2026',
            targetRateRange: String(
              parsed.targetRateRange || parsed.targetRateBps || futuresData.targetRateRange || ''
            ),
            cutProbability: cutVal,
            holdProbability: holdVal,
            hikeProbability: Number.isFinite(hikeVal) ? hikeVal : 0,
            hawkishShiftDetected: Boolean(parsed.hawkishShiftDetected || (hikeVal ?? 0) >= 50),
            sourceLabel: 'Sumber: CME FedWatch Grounding (Des 2026)',
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
      const msg = String(err?.message || err || '');
      if (
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('Quota exceeded')
      ) {
        newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
        continue;
      }
      break;
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

// Full Macro News & Pre-News Scenario Matrix Analyzer

async function fetchPastActualsViaGoogleSearch(missingEvents: MacroCalendarEvent[], apiKey: string): Promise<Record<string, string>> {
  if (!apiKey || missingEvents.length === 0) return {};
  const listDesc = missingEvents
    .map((e) => `- "${e.title}" (Scheduled: ${e.date}, Forecast: ${e.forecast || "N/A"}, Previous: ${e.previous || "N/A"})`)
    .join("\n");
  const prompt = `Search the web for the official released ACTUAL economic data values for these US USD economic indicators that have already been published:\n${listDesc}\n\nReturn ONLY a raw JSON object mapping the exact event title to its released actual value string (for example: {"Core CPI m/m": "0.3%", "CPI m/m": "0.2%"}). If an event has genuinely not been released yet, omit it. Do not include markdown fences or explanation.`;

  const candidateModels = [
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ];

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  for (const model of candidateModels) {
    const cooldownUntil = newsQuotaCooldownUntilByModel.get(model) || 0;
    if (Date.now() < cooldownUntil) continue;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

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
      const msg = String(err?.message || err || '');
      if (
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('Quota exceeded')
      ) {
        newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
        continue;
      }
      break;
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

    const resolvedNewsKey = (process.env.GEMINI_NEWS_API_KEY || process.env.GEMINI_API_KEY || '').trim();
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

    // Step 3: Isolated API Key Lookup (GEMINI_NEWS_API_KEY -> fallback GEMINI_API_KEY)
    const newsApiKey = (
      process.env.GEMINI_NEWS_API_KEY ||
      process.env.GEMINI_API_KEY ||
      ''
    ).trim();

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
      },
    });

    const candidateModels = [
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ];

    const promptPayload = {
      primaryEvent: baselineSnapshot.scenarioMatrix.primaryEvent,
      simultaneousEvents: baselineSnapshot.scenarioMatrix.simultaneousEvents,
      supportingContextEvents: getSupportingContextEvents(feeds.calendarEvents).map((ev) => ({
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
        const response = await ai.models.generateContent({
          model,
          contents: `Analyze this real-time XAU/USD macro dataset (including CME FedWatch probabilities, simultaneous USD High-Impact events, and preNewsFlow intelligence such as Leading Indicator Chain, Consensus Tightness, 2s10s Yield Curve Spread, VIX risk regime, Gold 3-day GC=F positioning, and FOMC Blackout window while strictly preserving Master Playbook rules) and return the structured JSON Scenario Matrix in both Bahasa Indonesia (Id) and English (En):\n${JSON.stringify(
            promptPayload
          )}`,
          config: {
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
        });

        if (response && response.text) {
          aiResponseText = response.text;
          usedModel = model;
          break;
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('Quota exceeded')
        ) {
          newsQuotaCooldownUntilByModel.set(model, Date.now() + 30 * 60 * 1000);
          continue;
        }
        break;
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
  const vite = await createServer({
    server: {
      middlewareMode: true,
      allowedHosts: true,
      ws: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
    },
    appType: 'spa',
  });
  viteServer = vite;
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
