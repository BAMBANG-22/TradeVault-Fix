import {
  MacroCalendarEvent,
  IntermarketAssetPulse,
  BreakingNewsHeadline,
  CmeFedWatchState,
  classifyFomcPillar,
  isInverseUsdIndicator,
  isRelevantUsdMacroEvent,
  evaluateSingleEventForGold,
  filterAndScoreBreakingHeadlines,
  parseMacroNumeric,
  isPrimaryHighImpactEvent,
  computeImpliedFedWatchFromMarketQuotes,
  createUnavailableFedWatchState,
} from './macroNewsEngine';

const BACKEND_PROXY_ENDPOINTS = [
  '/api/proxy?url=',
  'https://ais-pre-qmgrbl6vkm3qzsovjavbgc-342426605045.asia-southeast1.run.app/api/proxy?url=',
  'https://ais-dev-qmgrbl6vkm3qzsovjavbgc-342426605045.asia-southeast1.run.app/api/proxy?url=',
];

function isValidFeedPayload(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 15) return false;
  const lower = trimmed.slice(0, 200).toLowerCase();
  if (
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html') ||
    lower.includes('keyless_legacy_url') ||
    lower.includes('"error":"a valid api key is required') ||
    lower.includes('error 522') ||
    lower.includes('cloudflare')
  ) {
    return false;
  }
  return true;
}

/**
 * Multi-layered real-time CORS proxy fetcher for ForexFactory & public feeds.
 * Tries in sequential/race fallback order:
 * 1) https://api.codetabs.com/v1/proxy?quest= + encodeURIComponent(url)
 * 2) https://corsproxy.io/?url= + encodeURIComponent(url)
 * 3) https://api.allorigins.win/get?url= + encodeURIComponent(url) (parsing JSON `.contents`)
 * 4) TradeVault backend proxy endpoints (/api/proxy?url= on local & Cloud Run for Android APK/Web)
 * 5) Direct fetch
 */
export async function fetchWithCorsProxy(
  targetUrl: string,
  timeoutMs = 8000,
  acceptHeader = 'application/json, application/xml, text/xml, text/plain, */*'
): Promise<string> {
  const encodedUrl = encodeURIComponent(targetUrl);

  // Fast path: TradeVault server proxy (works in Web & Android APK without 3rd-party proxy rate limits)
  for (const proxyPrefix of BACKEND_PROXY_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(3500, timeoutMs));
      const res = await fetch(`${proxyPrefix}${encodedUrl}`, {
        cache: 'no-store',
        headers: { Accept: acceptHeader, 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        if (isValidFeedPayload(text)) {
          return text;
        }
      }
    } catch {
      // Try next proxy
    }
  }

  // Proxy 1: CodeTabs Proxy
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(4500, timeoutMs));
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`;
    const res = await fetch(proxyUrl, {
      cache: 'no-store',
      headers: { Accept: acceptHeader },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (isValidFeedPayload(text)) {
        return text;
      }
    }
  } catch {
    // Try Proxy 2
  }

  // Proxy 2: CorsProxy.io (?url= format)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(4500, timeoutMs));
    const proxyUrl = `https://corsproxy.io/?url=${encodedUrl}`;
    const res = await fetch(proxyUrl, {
      cache: 'no-store',
      headers: { Accept: acceptHeader },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (isValidFeedPayload(text)) {
        return text;
      }
    }
  } catch {
    // Try Proxy 3
  }

  // Proxy 3: AllOrigins JSON wrapper (/get?url= -> parse `.contents`)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(5000, timeoutMs));
    const proxyUrl = `https://api.allorigins.win/get?url=${encodedUrl}`;
    const res = await fetch(proxyUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const wrapperJson = await res.json();
      const contents =
        wrapperJson && typeof wrapperJson.contents === 'string'
          ? wrapperJson.contents
          : '';
      if (isValidFeedPayload(contents)) {
        return contents;
      }
    }
  } catch {
    // Try AllOrigins raw & direct fetch
  }

  // Proxy 3b: AllOrigins raw endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(4000, timeoutMs));
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodedUrl}`;
    const res = await fetch(proxyUrl, {
      cache: 'no-store',
      headers: { Accept: acceptHeader },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (isValidFeedPayload(text)) {
        return text;
      }
    }
  } catch {
    // Try Direct Fetch
  }

  // Strategy 5: Direct fetch (works in Node/SSR & native Capacitor HTTP)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(4000, timeoutMs));
    const res = await fetch(targetUrl, {
      cache: 'no-store',
      headers: {
        Accept: acceptHeader,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (isValidFeedPayload(text)) {
        return text;
      }
    }
  } catch {
    // All strategies exhausted
  }

  throw new Error(`Semua jalur proxy gagal mengunduh data dari: ${targetUrl}`);
}

/**
 * Parses ForexFactory XML calendar feed (`ff_calendar_thisweek.xml` / `ff_calendar_nextweek.xml`)
 * into the same raw item structure as `ff_calendar_thisweek.json`.
 */
export function parseForexFactoryXml(xmlText: string): Array<{
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  actual?: string;
}> {
  if (!xmlText || !xmlText.includes('<event>')) return [];
  const items: Array<{
    title: string;
    country: string;
    date: string;
    impact: string;
    forecast: string;
    previous: string;
    actual?: string;
  }> = [];

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
    const datePart = cleanTag(block, 'date'); // e.g. 11-13-2026
    const timePart = cleanTag(block, 'time'); // e.g. 1:30pm or 8:30am
    const impact = cleanTag(block, 'impact');
    const forecast = cleanTag(block, 'forecast');
    const previous = cleanTag(block, 'previous');
    const actual = cleanTag(block, 'actual');

    if (!title || !country) continue;

    // Parse MM-DD-YYYY + h:mma/p (UTC or EST) into ISO string
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

    items.push({
      title,
      country,
      date: isoDate,
      impact,
      forecast,
      previous,
      actual,
    });
  }

  return items;
}

/**
 * Zero-Mock Policy: Never return fake/hardcoded calendar numbers.
 * If all live ForexFactory fetch paths fail, return an empty array `[]` so the UI displays
 * the honest warning: "Gagal memuat kalender live — periksa koneksi atau coba refresh".
 */
export function getClientFallbackCalendarEvents(): MacroCalendarEvent[] {
  return [];
}

async function fetchSingleCalendarSource(jsonUrl: string, xmlUrl?: string): Promise<any[]> {
  try {
    const rawText = await fetchWithCorsProxy(jsonUrl, 8000, 'application/json');
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Try XML backup if JSON endpoint failed or was rate-limited
  }

  if (xmlUrl) {
    try {
      const xmlText = await fetchWithCorsProxy(xmlUrl, 8000, 'application/xml, text/xml');
      const parsedXml = parseForexFactoryXml(xmlText);
      if (parsedXml.length > 0) {
        return parsedXml;
      }
    } catch {
      // XML also failed
    }
  }

  return [];
}

/**
 * Pulls live ForexFactory calendar data across both `thisweek` and `nextweek` feeds
 * using the multi-proxy + XML/JSON pipeline.
 * Maps `title`, `country === 'USD'`, `impact`, `previous`, `forecast`, and `actual` 100% faithfully.
 * Returns `[]` if all live feeds fail (never fabricates numbers).
 */
export async function fetchClientForexFactoryCalendar(): Promise<MacroCalendarEvent[]> {
  try {
    const [thisWeekItems, nextWeekItems] = await Promise.all([
      fetchSingleCalendarSource(
        'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
        'https://nfs.faireconomy.media/ff_calendar_thisweek.xml'
      ),
      fetchSingleCalendarSource(
        'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
        'https://nfs.faireconomy.media/ff_calendar_nextweek.xml'
      ),
    ]);

    const combinedRaw = [...thisWeekItems, ...nextWeekItems];
    if (combinedRaw.length === 0) {
      return [];
    }

    // Filter strictly for USD macro events (country === 'USD')
    const filtered = combinedRaw.filter((item: any) => isRelevantUsdMacroEvent(item));
    if (filtered.length === 0) {
      return [];
    }

    // Deduplicate combined thisweek + nextweek entries by normalized title + minute ISO timestamp
    const seenKeys = new Set<string>();
    const dedupedRaw: any[] = [];
    for (const item of filtered) {
      const titleKey = String(item.title || '').trim().toUpperCase();
      let isoMinuteKey = String(item.date || '');
      try {
        const dt = new Date(item.date);
        if (!isNaN(dt.getTime())) {
          isoMinuteKey = dt.toISOString().slice(0, 16);
        }
      } catch {}
      const uniqueKey = `${titleKey}|${isoMinuteKey}`;
      if (!seenKeys.has(uniqueKey)) {
        seenKeys.add(uniqueKey);
        dedupedRaw.push(item);
      }
    }

    // Sort chronologically across the 14-day window
    dedupedRaw.sort((a, b) => {
      const ta = new Date(a.date).getTime() || 0;
      const tb = new Date(b.date).getTime() || 0;
      return ta - tb;
    });

    return dedupedRaw.slice(0, 90).map((item: any, idx: number) => {
      // Exact title from ForexFactory feed (e.g., "Core PPI m/m", "PPI m/m")
      const title = String(item.title || '').trim();
      const previous = String(item.previous ?? '').trim();
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

      const eventCategory: MacroCalendarEvent['eventCategory'] = isPrimaryHighImpactEvent({
        title,
        impact,
        country: 'USD',
      })
        ? 'PRIMARY_HIGH_IMPACT'
        : 'SUPPORTING_REFERENCE';

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
        eventCategory,
      };
    });
  } catch (err) {
    console.warn('[MacroClient] Live ForexFactory calendar fetch failed:', err);
    return [];
  }
}

export async function fetchClientYahooAsset(
  symbol: 'DXY' | 'USOIL' | 'US10Y' | 'US02Y',
  yahooTicker: string,
  name: string,
  fallbackPrice: number,
  fallbackPrevClose: number
): Promise<IntermarketAssetPulse> {
  let price = fallbackPrice;
  let previousClose = fallbackPrevClose;

  try {
    const encodedTicker = encodeURIComponent(yahooTicker);
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=15m&range=5d`;
    const jsonStr = await fetchWithCorsProxy(targetUrl, 8000, 'application/json');
    const json = JSON.parse(jsonStr);
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta) {
      const regPrice = Number(meta.regularMarketPrice);
      const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
      if (Number.isFinite(regPrice) && regPrice > 0) {
        price = regPrice;
      }
      if (Number.isFinite(prev) && prev > 0) {
        previousClose = prev;
      }
    }
  } catch (err) {
    console.warn(`[MacroClient] Yahoo ticker ${yahooTicker} fallback:`, err);
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
        ? 'Yield 2Y naik → Sensitivitas suku bunga Fed Hawkish (SELL XAU/USD)'
        : direction === 'DOWN'
        ? 'Yield 2Y turun → Pelonggaran ekspektasi suku bunga Fed (BUY XAU/USD)'
        : 'Yield 2Y stabil menunggu keputusan Fed';
    summaryEn =
      direction === 'UP'
        ? '2Y Yield rising → Front-end Fed hawkish pricing (SELL XAU/USD)'
        : direction === 'DOWN'
        ? '2Y Yield falling → Easing near-term rate expectations (BUY XAU/USD)'
        : '2Y Yield stable awaiting Fed catalysts';
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

  return {
    symbol,
    yahooTicker,
    name,
    price: Number(price.toFixed(2)),
    previousClose: Number(previousClose.toFixed(2)),
    change,
    changePercent,
    direction,
    goldCorrelationEffect,
    summaryId,
    summaryEn,
    updatedAt: new Date().toISOString(),
  };
}

function parseRssXml(
  xmlText: string,
  sourceName: string
): Array<{ title: string; source: string; pubDate: string; link?: string }> {
  const items: Array<{ title: string; source: string; pubDate: string; link?: string }> = [];
  if (!xmlText) return items;

  const itemMatches = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches.slice(0, 35)) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pubDateMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (titleMatch && titleMatch[1]) {
      items.push({
        title: titleMatch[1],
        source: sourceName,
        pubDate: pubDateMatch?.[1]?.trim() || new Date().toISOString(),
        link: linkMatch?.[1]?.trim(),
      });
    }
  }
  return items;
}

export function getClientFallbackBreakingHeadlines(): BreakingNewsHeadline[] {
  // Zero-Mock Policy: Never return fabricated static headlines when offline.
  return [];
}

export async function fetchClientBreakingHeadlines(): Promise<BreakingNewsHeadline[]> {
  const feeds = [
    { url: 'https://www.financialjuice.com/feed.ashx?xy=rss', source: 'FinancialJuice' },
    { url: 'https://www.fxstreet.com/rss/news', source: 'FXStreet' },
  ];

  try {
    const results = await Promise.allSettled(
      feeds.map(async (f) => {
        const xml = await fetchWithCorsProxy(f.url, 8000, 'application/rss+xml, text/xml');
        return parseRssXml(xml, f.source);
      })
    );

    const combined: Array<{ title: string; source: string; pubDate: string; link?: string }> = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        combined.push(...r.value);
      }
    }

    const filtered = filterAndScoreBreakingHeadlines(combined);
    if (filtered.length > 0) {
      return filtered;
    }
    return [];
  } catch (err) {
    console.warn('[MacroClient] Live RSS breaking headlines fetch failed:', err);
    return [];
  }
}

async function fetchYahooQuoteNumbers(
  yahooTicker: string
): Promise<{ price: number | null; previousClose: number | null }> {
  try {
    const encodedTicker = encodeURIComponent(yahooTicker);
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=15m&range=5d`;
    const jsonStr = await fetchWithCorsProxy(targetUrl, 6500, 'application/json');
    const json = JSON.parse(jsonStr);
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta) {
      const regPrice = Number(meta.regularMarketPrice);
      const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
      return {
        price: Number.isFinite(regPrice) && regPrice > 0 ? regPrice : null,
        previousClose: Number.isFinite(prev) && prev > 0 ? prev : null,
      };
    }
  } catch {
    // ignore
  }
  return { price: null, previousClose: null };
}

/**
 * Automatic Real-Time Backup from Bond & Futures Markets (`ZQ=F` 30-Day Fed Funds Futures & `^IRX` 13-Week T-Bill):
 * Calculates `Implied Fed Funds Rate = 100 - harga ZQ=F` and FOMC Desember 2026 probabilities
 * whenever web search for CME FedWatch is rate-limited or unavailable.
 */
export async function fetchClientFedFundsFuturesBackup(
  us10yPulse?: IntermarketAssetPulse
): Promise<CmeFedWatchState> {
  try {
    const [zqQuote, irxQuote, us2yQuote] = await Promise.all([
      fetchYahooQuoteNumbers('ZQ=F'),
      fetchYahooQuoteNumbers('^IRX'),
      fetchYahooQuoteNumbers('2YY=F'),
    ]);

    return computeImpliedFedWatchFromMarketQuotes({
      zqFuturesPrice: zqQuote.price,
      zqPreviousClose: zqQuote.previousClose,
      irxYield: irxQuote.price,
      irxPreviousClose: irxQuote.previousClose,
      us2yYield: us2yQuote.price,
      us10yYield: us10yPulse?.price ?? null,
      us10yChangePercent: us10yPulse?.changePercent ?? 0,
    });
  } catch {
    return createUnavailableFedWatchState();
  }
}

