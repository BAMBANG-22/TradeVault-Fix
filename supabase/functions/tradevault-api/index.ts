// @ts-nocheck
import { GoogleGenAI, Type } from 'npm:@google/genai@3.3.0';

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
    if (contextualMatch) s = contextualMatch[1].trim();
    s = s.replace(/[^0-9.,+\- ]/g, '').trim();
    if (!s) return null;
    if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^[+-]?\d{1,3}(?:[ ,]\d{3})+\.\d+$/.test(s)) {
      s = s.replace(/[ ,]/g, '');
    } else if (s.includes('.') && s.includes(',')) {
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
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

const CANDIDATE_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

async function handleProxy(reqUrl: URL): Promise<Response> {
  const targetUrl = reqUrl.searchParams.get('url');
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing target url parameter' }, 400);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
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
    clearTimeout(timer);
    const text = await upstreamRes.text();
    return new Response(text, {
      status: upstreamRes.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
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

    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('GEMINI_NEWS_API_KEY') ||
      ''
    ).trim();
    if (!apiKey) {
      return jsonResponse(
        {
          success: false,
          error: 'GEMINI_API_KEY belum dikonfigurasi di Supabase Edge Function Secrets.',
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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
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
   - Read the order labels at the LEFT edge of the chart: "TP", "SL", "BUY LIMIT", "SELL LIMIT", "BUY STOP", "SELL STOP", "BUY", "SELL".
   - Follow each label's horizontal dashed line straight across to the RIGHTMOST Y-AXIS, and ONLY extract the price number that is inside a BORDERED / OUTLINED BOX aligned with that dashed line.
   - IGNORE plain unbordered grid numbers on the Y-axis.
   - IGNORE the running candle price badge — put that ONLY in currentPrice, NEVER in entryPrice, stopLoss, or takeProfit!
   - STATUS RULE: If the order label contains "LIMIT" or "STOP", set status = "PLANNED".

2. SPATIAL VISUAL RULES FOR TRADINGVIEW CHARTS:
   - Read the rightmost Y-axis price scale tags aligned with the Position Box borders (Risk top/bottom, Entry middle line, Target bottom/top).
   - If the target box is at the BOTTOM and risk box is at the TOP, direction is SELL (TP < Entry < SL).
   - If the target box is at the TOP and risk box is at the BOTTOM, direction is BUY (SL < Entry < TP).
   - Normalize local decimal formats like "4.054,405" -> 4054.405.
   - LOT SIZE ON TRADINGVIEW: Always return null for lotSize on TradingView.

3. NO FAKE / SYNTHETIC NUMBERS:
   - NEVER invent, interpolate, or calculate synthetic SL/TP numbers.
   - If Entry, SL, or TP is not clearly visible, return null for that field.`;

    let responseText = '';
    let usedModel = '';

    for (const model of CANDIDATE_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType, data: base64Data } },
            prompt,
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detected: { type: Type.BOOLEAN },
                source: { type: Type.STRING },
                instrument: { type: Type.STRING },
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
        });
        if (response && response.text) {
          responseText = response.text;
          usedModel = model;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!responseText) {
      return jsonResponse({
        success: false,
        quotaExhausted: true,
        error:
          'Batas kuota tier gratis tercapai sementara; beralih otomatis ke pemindai geometri kanvas & OCR.',
      });
    }

    const parsedData = parseAiJsonResponse(responseText);
    const cleanInstrument = normalizeInstrument(parsedData.instrument);

    let cleanPosition: 'BUY' | 'SELL' =
      canvasHints?.hasPositionBox &&
      (canvasHints.inferredPosition === 'BUY' || canvasHints.inferredPosition === 'SELL')
        ? canvasHints.inferredPosition
        : parsedData.position === 'SELL'
        ? 'SELL'
        : 'BUY';

    const source: 'MT5' | 'TRADINGVIEW' | 'CHART' =
      parsedData.source === 'MT5'
        ? 'MT5'
        : parsedData.source === 'TRADINGVIEW' || canvasHints?.hasPositionBox
        ? 'TRADINGVIEW'
        : 'CHART';

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
        notes: parsedData.notes || '',
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

async function fetchTradingViewActualsMap(calendarEvents: any[]): Promise<Map<string, string>> {
  const actualMap = new Map<string, string>();
  if (!Array.isArray(calendarEvents) || calendarEvents.length === 0) return actualMap;
  try {
    const times = calendarEvents
      .map((e) => new Date(e.date).getTime())
      .filter((t) => Number.isFinite(t));
    if (times.length === 0) return actualMap;
    const minMs = Math.min(...times) - 24 * 60 * 60 * 1000;
    const maxMs = Math.max(...times) + 24 * 60 * 60 * 1000;
    const tvUrl = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(
      new Date(minMs).toISOString()
    )}&to=${encodeURIComponent(new Date(maxMs).toISOString())}&countries=US`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
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
    if (!res.ok) return actualMap;
    const json = await res.json();
    const list = Array.isArray(json?.result) ? json.result : [];
    for (const item of list) {
      if (item && item.actual !== null && item.actual !== undefined) {
        const key = String(item.title || item.indicator || '')
          .trim()
          .toLowerCase();
        if (key) {
          const unit = item.unit ? String(item.unit) : '';
          actualMap.set(key, `${item.actual}${unit}`);
        }
      }
    }
  } catch {
    // ignore TradingView enrichment timeout
  }
  return actualMap;
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

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });
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
    } catch {
      continue;
    }
  }
  return {};
}

async function fetchCmeFedWatchWithGrounding(
  ai: GoogleGenAI,
  existingFedWatch: any
): Promise<any> {
  if (
    existingFedWatch?.isAvailable &&
    typeof existingFedWatch?.sourceLabel === 'string' &&
    existingFedWatch.sourceLabel.includes('Grounding')
  ) {
    return existingFedWatch;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const fedWatchPrompt = `Today is ${todayIso}. Search for the latest CME FedWatch Tool target rate probabilities for the December 2026 FOMC meeting (FOMC Desember 2026).
Return ONLY a valid JSON object (no markdown fences) with these exact fields:
{
  "isAvailable": boolean,
  "fomcMeetingDate": "FOMC Desember 2026",
  "targetRateRange": "string (e.g. '450-475 bps' or '')",
  "hikeProbability": number or null,
  "holdProbability": number or null,
  "cutProbability": number or null,
  "hawkishShiftDetected": boolean
}
CRITICAL RULE: Do not invent numbers. If search results do not contain exact figures, set "isAvailable": false.`;

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: fedWatchPrompt,
        config: { tools: [{ googleSearch: {} }] },
      });
      const parsed = parseAiJsonResponse(response?.text || '');
      const cutVal = parsed.cutProbability != null ? Number(parsed.cutProbability) : null;
      const holdVal = parsed.holdProbability != null ? Number(parsed.holdProbability) : null;
      const hikeVal = parsed.hikeProbability != null ? Number(parsed.hikeProbability) : 0;

      if (
        parsed.isAvailable !== false &&
        cutVal !== null &&
        holdVal !== null &&
        Number.isFinite(cutVal) &&
        Number.isFinite(holdVal) &&
        cutVal + holdVal + (Number.isFinite(hikeVal) ? hikeVal : 0) > 0
      ) {
        return {
          ...(existingFedWatch || {}),
          isAvailable: true,
          fomcMeetingDate: 'FOMC Desember 2026',
          targetRateRange: String(parsed.targetRateRange || existingFedWatch?.targetRateRange || ''),
          cutProbability: cutVal,
          holdProbability: holdVal,
          hikeProbability: Number.isFinite(hikeVal) ? hikeVal : 0,
          hawkishShiftDetected: Boolean(parsed.hawkishShiftDetected || (hikeVal ?? 0) >= 50),
          sourceLabel: 'Sumber: CME FedWatch Grounding (Des 2026)',
        };
      }
    } catch {
      continue;
    }
  }
  return existingFedWatch;
}

async function handleMacroNewsAnalyze(req: Request): Promise<Response> {
  let baselineSnapshot: any = null;
  try {
    const body = await req.json();
    const { clientFeeds, baselineSnapshot: clientBaseline } = body || {};
    baselineSnapshot = clientBaseline || null;

    if (!baselineSnapshot || !baselineSnapshot.scenarioMatrix) {
      return jsonResponse(
        {
          success: false,
          error: 'baselineSnapshot wajib disertakan dari klien TradeVault.',
        },
        400
      );
    }

    const newsApiKey = (
      Deno.env.get('GEMINI_NEWS_API_KEY') ||
      Deno.env.get('GEMINI_API_KEY') ||
      ''
    ).trim();

    if (!newsApiKey) {
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        snapshot: baselineSnapshot,
      });
    }

    const ai = new GoogleGenAI({
      apiKey: newsApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

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

    // Enrich past missing Actuals via TradingView & Google Search Grounding in parallel with CME FedWatch
    const nowCutoffMs = Date.now() - 5 * 60 * 1000;
    const pastMissing = calendarEvents.filter(
      (ev: any) =>
        (!ev.actual || !String(ev.actual).trim()) &&
        !/speech|speaks|testimony|fomc\s+press|beige\s+book/i.test(String(ev.title || '')) &&
        (ev.forecastNum !== null || ev.previousNum !== null) &&
        new Date(ev.date).getTime() < nowCutoffMs
    );

    const [tvActualsMap, groundedFedWatch] = await Promise.all([
      pastMissing.length > 0 ? fetchTradingViewActualsMap(calendarEvents) : Promise.resolve(new Map()),
      fetchCmeFedWatchWithGrounding(ai, clientFeeds?.cmeFedWatch || baselineSnapshot.cmeFedWatch),
    ]);

    let enrichedCalendar = calendarEvents.map((ev: any) => {
      if (!ev.actual || !String(ev.actual).trim()) {
        const found = tvActualsMap.get(String(ev.title || '').trim().toLowerCase());
        if (found) {
          return { ...ev, actual: found };
        }
      }
      return ev;
    });

    const stillMissing = enrichedCalendar.filter(
      (ev: any) =>
        (!ev.actual || !String(ev.actual).trim()) &&
        !/speech|speaks|testimony|fomc\s+press|beige\s+book/i.test(String(ev.title || '')) &&
        ev.impact === 'High' &&
        (ev.forecastNum !== null || ev.previousNum !== null) &&
        new Date(ev.date).getTime() < nowCutoffMs
    );

    if (stillMissing.length > 0) {
      const searchActuals = await fetchPastActualsViaGoogleSearch(stillMissing, ai);
      if (Object.keys(searchActuals).length > 0) {
        enrichedCalendar = enrichedCalendar.map((ev: any) => {
          if (!ev.actual || !String(ev.actual).trim()) {
            const found = searchActuals[String(ev.title || '').trim().toLowerCase()];
            if (found) return { ...ev, actual: found };
          }
          return ev;
        });
      }
    }

    const promptPayload = {
      primaryEvent: baselineSnapshot.scenarioMatrix.primaryEvent,
      simultaneousEvents: baselineSnapshot.scenarioMatrix.simultaneousEvents || [],
      supportingContextEvents: enrichedCalendar.slice(0, 12).map((ev: any) => ({
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

    for (const model of CANDIDATE_MODELS) {
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
        });
        if (response && response.text) {
          aiResponseText = response.text;
          usedModel = model;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!aiResponseText) {
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        snapshot: {
          ...baselineSnapshot,
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
      modelUsed: usedModel || 'gemini-4-hydrogen',
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

    return jsonResponse({
      success: true,
      fallbackUsed: false,
      snapshot: enrichedSnapshot,
    });
  } catch {
    if (baselineSnapshot) {
      return jsonResponse({
        success: true,
        fallbackUsed: true,
        snapshot: baselineSnapshot,
      });
    }
    return jsonResponse({ success: false, error: 'Gagal memproses analisis makro.' }, 500);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(req.url);
  const path = reqUrl.pathname.replace(/\/+$/, '');

  if (req.method === 'GET' && (path.endsWith('/api/health') || path.endsWith('/tradevault-api'))) {
    const scanKey = (Deno.env.get('GEMINI_API_KEY') || '').trim();
    const newsKey = (Deno.env.get('GEMINI_NEWS_API_KEY') || '').trim();
    return jsonResponse({
      ok: true,
      service: 'tradevault-supabase-edge-api',
      geminiConfigured: Boolean(scanKey || newsKey),
      scannerGeminiConfigured: Boolean(scanKey || newsKey),
      newsGeminiConfigured: Boolean(newsKey || scanKey),
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

  if (req.method === 'POST' && path.endsWith('/api/macro-news/analyze')) {
    return handleMacroNewsAnalyze(req);
  }

  return jsonResponse(
    {
      ok: false,
      error: `Route not found: ${req.method} ${path}`,
    },
    404
  );
});
