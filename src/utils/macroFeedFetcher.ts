import {
  MacroCalendarEvent,
  IntermarketAssetPulse,
  VixRiskPulse,
  GoldPositioningPulse,
  BreakingNewsHeadline,
  CmeFedWatchState,
  RssFeedHealthStatus,
  RssFeedSourceStatus,
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
import { isMarketDay } from './date';
import {
  getApiEndpointCandidates,
  isNativeAndroidOrIos,
  nativeHttpGetText,
} from './apiConfig';

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

  // Fast path 1 (Native Android APK): CORS-free direct native HTTP via CapacitorHttp
  if (isNativeAndroidOrIos()) {
    const nativeText = await nativeHttpGetText(targetUrl, timeoutMs, acceptHeader);
    if (nativeText && isValidFeedPayload(nativeText)) {
      return nativeText;
    }
  }

  // Fast path 2: Configured standalone backend proxy (/api/proxy?url=...)
  const proxyCandidates = getApiEndpointCandidates('/api/proxy');
  for (const proxyBase of proxyCandidates) {
    try {
      const proxyFullUrl = `${proxyBase}?url=${encodedUrl}`;
      if (isNativeAndroidOrIos() && /^https?:\/\//i.test(proxyFullUrl)) {
        const nativeProxyText = await nativeHttpGetText(proxyFullUrl, Math.min(4500, timeoutMs), acceptHeader);
        if (nativeProxyText && isValidFeedPayload(nativeProxyText)) {
          return nativeProxyText;
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(3500, timeoutMs));
        const res = await fetch(proxyFullUrl, {
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

function isWeekdayMarketTimestampSec(unixSec: number): boolean {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return true;
  return isMarketDay(unixSec, { useUtc: true, enforceFridayCloseUtc: true });
}

export async function fetchClientYahooAsset(
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
    const encodedTicker = encodeURIComponent(yahooTicker);
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=5m&range=5d&_t=${Date.now()}`;
    const jsonStr = await fetchWithCorsProxy(targetUrl, 8000, 'application/json');
    const json = JSON.parse(jsonStr);
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (meta) {
      const timestamps: any[] = result?.timestamp || [];
      const rawCloses: any[] = result?.indicators?.quote?.[0]?.close || [];
      const validCloses: number[] = [];
      for (let i = 0; i < rawCloses.length; i++) {
        const c = Number(rawCloses[i]);
        const ts = Number(timestamps[i]);
        if (Number.isFinite(c) && c > 0 && isWeekdayMarketTimestampSec(ts)) {
          validCloses.push(c);
        }
      }
      const latestCandleClose = validCloses.length > 0 ? validCloses[validCloses.length - 1] : NaN;
      const regPrice = Number(meta.regularMarketPrice);
      const isNowWeekdayOpen = isWeekdayMarketTimestampSec(Math.floor(Date.now() / 1000));
      const effectivePrice =
        !isNowWeekdayOpen && Number.isFinite(latestCandleClose) && latestCandleClose > 0
          ? latestCandleClose
          : Number.isFinite(regPrice) && regPrice > 0
          ? regPrice
          : latestCandleClose;

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
  } catch (err) {
    console.warn(`[MacroClient] Yahoo ticker ${yahooTicker} unavailable:`, err);
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

function parseRssXml(
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

export function getClientFallbackBreakingHeadlines(): BreakingNewsHeadline[] {
  // Zero-Mock Policy: Never return fabricated static headlines when offline.
  return [];
}

export async function fetchClientBreakingHeadlinesWithHealth(): Promise<{
  headlines: BreakingNewsHeadline[];
  rssFeedHealth: RssFeedHealthStatus;
}> {
  // 1. Primary path: Standalone Backend Multi-Source RSS Aggregator (Zero Browser CORS)
  const rssEndpoints = getApiEndpointCandidates('/api/macro-news/rss');
  for (const endpoint of rssEndpoints) {
    try {
      const urlWithTs = `${endpoint}?_t=${Date.now()}`;
      if (isNativeAndroidOrIos() && /^https?:\/\//i.test(urlWithTs)) {
        const raw = await nativeHttpGetText(urlWithTs, 9000, 'application/json');
        if (raw) {
          const json = JSON.parse(raw);
          if (json?.success && Array.isArray(json.headlines) && json.rssFeedHealth) {
            return {
              headlines: json.headlines as BreakingNewsHeadline[],
              rssFeedHealth: json.rssFeedHealth as RssFeedHealthStatus,
            };
          }
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        const res = await fetch(urlWithTs, {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          if (json?.success && Array.isArray(json.headlines) && json.rssFeedHealth) {
            return {
              headlines: json.headlines as BreakingNewsHeadline[],
              rssFeedHealth: json.rssFeedHealth as RssFeedHealthStatus,
            };
          }
        }
      }
    } catch {
      // Fall through to next endpoint
    }
  }

  // 2. Fallback: Proxy-assisted 4-source Promise.allSettled fetch
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

  const results = await Promise.allSettled(
    feedConfigs.map(async (cfg) => {
      const items: Array<{ title: string; source: string; pubDate: string; link?: string }> = [];
      let anySuccess = false;
      for (const u of cfg.urls) {
        const xml = await fetchWithCorsProxy(u, 6000, 'application/rss+xml, text/xml');
        const parsed = parseRssXml(xml, cfg.name);
        if (parsed.length > 0) {
          anySuccess = true;
          items.push(...parsed);
          break;
        }
      }
      return { cfg, anySuccess, items };
    })
  );

  const combined: Array<{ title: string; source: string; pubDate: string; link?: string }> = [];
  const sourcesStatus: RssFeedSourceStatus[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const cfg = feedConfigs[i];
    if (r.status === 'fulfilled' && r.value.anySuccess) {
      combined.push(...r.value.items);
      sourcesStatus.push({
        id: cfg.id,
        name: cfg.name,
        active: true,
        itemCount: r.value.items.length,
      });
    } else {
      sourcesStatus.push({
        id: cfg.id,
        name: cfg.name,
        active: false,
        itemCount: 0,
      });
    }
  }

  const headlines = filterAndScoreBreakingHeadlines(combined);
  const activeCount = sourcesStatus.filter((s) => s.active).length;

  return {
    headlines,
    rssFeedHealth: {
      activeCount,
      totalCount: feedConfigs.length,
      sources: sourcesStatus,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function fetchClientBreakingHeadlines(): Promise<BreakingNewsHeadline[]> {
  const res = await fetchClientBreakingHeadlinesWithHealth();
  return res.headlines;
}

async function fetchYahooQuoteNumbers(
  yahooTicker: string
): Promise<{ price: number | null; previousClose: number | null }> {
  try {
    const encodedTicker = encodeURIComponent(yahooTicker);
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=5m&range=5d&_t=${Date.now()}`;
    const jsonStr = await fetchWithCorsProxy(targetUrl, 6500, 'application/json');
    const json = JSON.parse(jsonStr);
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta) {
      const regPrice = Number(meta.regularMarketPrice);
      const prev = Number(meta.previousClose ?? meta.chartPreviousClose);
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

export async function fetchClientVixPulse(): Promise<VixRiskPulse> {
  try {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('^VIX')}?interval=5m&range=5d&_t=${Date.now()}`;
    const jsonStr = await fetchWithCorsProxy(targetUrl, 6500, 'application/json');
    const json = JSON.parse(jsonStr);
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
  } catch (err) {
    console.warn('[MacroClient] VIX feed unavailable:', err);
  }

  return {
    yahooTicker: '^VIX',
    price: 0,
    changePercent: 0,
    direction: 'FLAT',
    isAvailable: false,
  };
}

export async function fetchClientGoldPositioning(): Promise<GoldPositioningPulse> {
  try {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('GC=F')}?interval=60m&range=5d&_t=${Date.now()}`;
    const jsonStr = await fetchWithCorsProxy(targetUrl, 6500, 'application/json');
    const json = JSON.parse(jsonStr);
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const timestamps: any[] = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const rawCloses: any[] = quote?.close || [];
    const rawHighs: any[] = quote?.high || [];
    const rawLows: any[] = quote?.low || [];

    const bars: Array<{ high: number; low: number; close: number }> = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = Number(rawCloses[i]);
      const h = Number(rawHighs[i] ?? c);
      const l = Number(rawLows[i] ?? c);
      const ts = Number(timestamps[i]);
      if (Number.isFinite(c) && c > 0 && isWeekdayMarketTimestampSec(ts)) {
        bars.push({
          high: Number.isFinite(h) && h > 0 ? h : c,
          low: Number.isFinite(l) && l > 0 ? l : c,
          close: c,
        });
      }
    }

    const validCloses = bars.map((b) => b.close);
    const isNowWeekdayOpen = isWeekdayMarketTimestampSec(Math.floor(Date.now() / 1000));
    const latestWeekdayClose = validCloses[validCloses.length - 1];
    const regPrice =
      !isNowWeekdayOpen && Number.isFinite(latestWeekdayClose) && latestWeekdayClose > 0
        ? latestWeekdayClose
        : Number(meta?.regularMarketPrice ?? latestWeekdayClose);

    if (Number.isFinite(regPrice) && regPrice > 0) {
      // ~72 hourly bars = ~3 trading days
      const idx3dAgo = validCloses.length >= 24 ? Math.max(0, validCloses.length - 72) : Math.max(0, validCloses.length - 4);
      const baseClose =
        validCloses.length >= 3
          ? validCloses[idx3dAgo]
          : Number(meta?.chartPreviousClose ?? meta?.previousClose ?? regPrice);
      const change3dPercent =
        Number.isFinite(baseClose) && baseClose > 0
          ? Number((((regPrice - baseClose) / baseClose) * 100).toFixed(2))
          : 0;

      // 6-hour move (last 6 hourly bars)
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

      // 14-period 1H ATR
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
  } catch (err) {
    console.warn('[MacroClient] GC=F positioning unavailable:', err);
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

/**
 * Lightweight 0-Gemini-token real-time Intermarket Pulse fetcher.
 * Pulls live quotes from server `/api/macro-news/intermarket-live` first,
 * falling back to direct client Yahoo Finance fetches if needed.
 */
export async function fetchLiveIntermarketPulseBundle(): Promise<{
  dxy: IntermarketAssetPulse;
  us02y: IntermarketAssetPulse;
  usoil: IntermarketAssetPulse;
  us10y: IntermarketAssetPulse;
  vix: VixRiskPulse;
  goldPositioning: GoldPositioningPulse;
  fetchedAt: string;
} | null> {
  const endpoints = getApiEndpointCandidates('/api/macro-news/intermarket-live');

  for (const endpoint of endpoints) {
    try {
      const urlWithTs = `${endpoint}?_t=${Date.now()}`;
      if (isNativeAndroidOrIos() && /^https?:\/\//i.test(urlWithTs)) {
        const raw = await nativeHttpGetText(urlWithTs, 5000, 'application/json');
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.success && data?.intermarketPulse?.dxy?.isAvailable) {
            return {
              ...data.intermarketPulse,
              fetchedAt: data.fetchedAt || new Date().toISOString(),
            };
          }
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(urlWithTs, {
          cache: 'no-store',
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data?.success && data?.intermarketPulse?.dxy?.isAvailable) {
            return {
              ...data.intermarketPulse,
              fetchedAt: data.fetchedAt || new Date().toISOString(),
            };
          }
        }
      }
    } catch {
      // Fall through to next endpoint or client-side Yahoo fetch
    }
  }

  try {
    const [dxy, us02y, usoil, us10y, vix, goldPositioning] = await Promise.all([
      fetchClientYahooAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 104.85, 104.42),
      fetchClientYahooAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield', 4.25, 4.22),
      fetchClientYahooAsset('USOIL', 'CL=F', 'US Oil WTI Crude', 73.4, 71.95),
      fetchClientYahooAsset('US10Y', '^TNX', 'US 10Y Treasury Yield', 4.38, 4.31),
      fetchClientVixPulse(),
      fetchClientGoldPositioning(),
    ]);

    if (dxy.isAvailable || us10y.isAvailable || usoil.isAvailable || us02y.isAvailable) {
      return {
        dxy,
        us02y,
        usoil,
        us10y,
        vix,
        goldPositioning,
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch {
    // ignore
  }

  return null;
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
      us10yYield: us10yPulse?.isAvailable !== false ? (us10yPulse?.price ?? null) : null,
      us10yChangePercent: us10yPulse?.isAvailable !== false ? (us10yPulse?.changePercent ?? 0) : 0,
    });
  } catch {
    return createUnavailableFedWatchState();
  }
}

