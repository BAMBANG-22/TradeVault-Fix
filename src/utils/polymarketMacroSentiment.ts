/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone, read-only Polymarket Gamma API sentiment fetcher for XAUUSD macro context.
 * Intentionally decoupled from TradeVault's Fundamental Gold, Macro News, and Cycle Confluence
 * engines — this data is strictly supplementary sentiment and NEVER modifies bias rules or scores.
 */

import {
  buildBackendAuthHeaders,
  getApiEndpointCandidates,
  isNativeAndroidOrIos,
  isNewsCycleOfflineMode,
  nativeHttpGetText,
} from './apiConfig';

export const POLYMARKET_MACRO_CACHE_KEY = 'tradevault_polymarket_macro_sentiment_v2';
const CACHE_FRESH_TTL_MS = 5 * 60 * 1000; // 5 minutes soft cache
const POLYMARKET_GAMMA_EVENTS_BASE = 'https://gamma-api.polymarket.com/events';

export type PolymarketMacroCategory = 'GOLD' | 'FED_RATES' | 'MACRO_ECONOMY' | 'GEOPOLITICS';

export type PolymarketFeedSource =
  | 'LIVE_DIRECT'
  | 'LIVE_PROXY'
  | 'CACHE_OFFLINE'
  | 'UNAVAILABLE';

export interface PolymarketOutcomeItem {
  label: string;
  probabilityPct: number; // 0..100
}

export interface PolymarketMacroEvent {
  id: string;
  slug: string;
  title: string;
  category: PolymarketMacroCategory;
  volume24hr: number;
  totalVolume: number;
  liquidity: number;
  endDate: string | null;
  polymarketUrl: string | null;
  outcomes: PolymarketOutcomeItem[];
}

export interface PolymarketMacroSnapshot {
  fetchedAt: string;
  source: PolymarketFeedSource;
  events: PolymarketMacroEvent[];
  errorDetailId?: string;
  errorDetailEn?: string;
}

interface RawGammaMarket {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  volume?: string | number;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
}

interface RawGammaEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  volume?: string | number;
  volume24hr?: string | number;
  liquidity?: string | number;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  tags?: Array<{ slug?: string; label?: string }>;
  markets?: RawGammaMarket[];
}

const CATEGORY_QUERIES: Array<{
  category: PolymarketMacroCategory;
  tagSlug: 'gold' | 'fed-rates' | 'economy' | 'geopolitics';
  limit: number;
}> = [
  { category: 'GOLD', tagSlug: 'gold', limit: 10 },
  { category: 'FED_RATES', tagSlug: 'fed-rates', limit: 10 },
  { category: 'MACRO_ECONOMY', tagSlug: 'economy', limit: 14 },
  { category: 'GEOPOLITICS', tagSlug: 'geopolitics', limit: 10 },
];

const SAFE_SLUG_RE = /^[a-z0-9-]+$/i;

function buildSafePolymarketEventUrl(slug: string | undefined): string | null {
  if (!slug || typeof slug !== 'string') return null;
  const trimmed = slug.trim();
  if (!trimmed || !SAFE_SLUG_RE.test(trimmed)) return null;
  return `https://polymarket.com/event/${encodeURIComponent(trimmed)}`;
}

function isFutureIsoDate(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso || typeof iso !== 'string') return false;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return false;
  return parsed > nowMs;
}

function parseJsonStringArray(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function parseNumeric(val: string | number | undefined): number {
  const num = Number(val);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function isRelevantEventForCategory(
  ev: RawGammaEvent,
  category: PolymarketMacroCategory,
  nowMs: number
): boolean {
  const title = String(ev.title || '').trim();
  if (!title || ev.closed === true || ev.active === false) return false;
  // Strictly exclude expired / already-passed events (even if Polymarket oracle hasn't marked closed yet)
  if (!isFutureIsoDate(ev.endDate, nowMs)) return false;

  const lower = title.toLowerCase();

  // Exclude unrelated entertainment/sports/novelty contracts
  if (/\b(alchemy|olympic|medal|nfl|nba|soccer|ucl|oscar|grammy|eurovision|valorant|dota)\b/i.test(lower)) {
    return false;
  }

  if (category === 'GOLD') {
    // Must be genuinely about Gold / XAU / GC market price; skip ultra-short 15-min micro noise
    const isGoldPrice = /\b(gold|xauusd|xau|\(gc\))\b/i.test(lower);
    const isMicro15Min = /\d{1,2}:\d{2}\s*(am|pm)\s*-\s*\d{1,2}:\d{2}\s*(am|pm)/i.test(lower);
    return isGoldPrice && !isMicro15Min;
  }

  if (category === 'FED_RATES') {
    return /\b(fed|fomc|interest rate|rate cut|rate hike|powell|warsh|federal reserve)\b/i.test(
      lower
    );
  }

  if (category === 'MACRO_ECONOMY') {
    // Keep US/global macro drivers relevant to Gold (exclude single-stock CEO / market-cap trivia)
    return /\b(recession|inflation|cpi|pce|gdp|unemployment|payroll|nfp|tariff|shutdown|debt|treasury|yield|dollar|dxy|oil|crude|stagflation|default)\b/i.test(
      lower
    );
  }

  if (category === 'GEOPOLITICS') {
    // Keep major conflict, ceasefire, sanction, or macro-geopolitical risk triggers
    return /\b(war|ceasefire|strike|invasion|iran|israel|ukraine|russia|china|taiwan|nato|blockade|nuclear|middle east|gaza|red sea|hormuz|tariff|sanction|regime)\b/i.test(
      lower
    );
  }

  return false;
}

function extractEventOutcomes(ev: RawGammaEvent, nowMs: number): PolymarketOutcomeItem[] {
  const rawMarkets = Array.isArray(ev.markets) ? ev.markets : [];
  // Strictly keep only active, non-closed, non-expired child markets
  const activeMarkets = rawMarkets.filter((m) => {
    if (!m || m.closed === true || m.active === false) return false;
    if (m.endDate && !isFutureIsoDate(m.endDate, nowMs)) return false;
    return true;
  });
  if (activeMarkets.length === 0) return [];

  // Single binary market (e.g., Yes/No or Up/Down)
  if (activeMarkets.length === 1) {
    const m = activeMarkets[0];
    const labels = parseJsonStringArray(m.outcomes);
    const prices = parseJsonStringArray(m.outcomePrices).map((p) => Number(p));
    const items: PolymarketOutcomeItem[] = [];
    for (let i = 0; i < Math.min(labels.length, prices.length); i++) {
      const prob = prices[i];
      if (!Number.isFinite(prob) || prob < 0 || prob > 1.001) continue;
      items.push({
        label: labels[i],
        probabilityPct: Math.round(Math.min(100, Math.max(0, prob * 100)) * 10) / 10,
      });
    }
    return items.sort((a, b) => b.probabilityPct - a.probabilityPct).slice(0, 2);
  }

  // Grouped multi-outcome event (e.g., Fed Decision: 50+ bps cut / 25 bps cut / No change / 25+ bps hike)
  const grouped: PolymarketOutcomeItem[] = [];
  for (const m of activeMarkets) {
    const labels = parseJsonStringArray(m.outcomes);
    const prices = parseJsonStringArray(m.outcomePrices).map((p) => Number(p));
    if (labels.length === 0 || prices.length === 0) continue;

    // Pick "Yes" leg price for grouped outcomes, or index 0 fallback
    const yesIdx = labels.findIndex((l) => l.toLowerCase() === 'yes');
    const targetIdx = yesIdx >= 0 ? yesIdx : 0;
    const prob = prices[targetIdx];
    if (!Number.isFinite(prob) || prob < 0 || prob > 1.001) continue;

    const cleanLabel = String(m.groupItemTitle || m.question || labels[targetIdx] || '').trim();
    if (!cleanLabel) continue;
    const pct = Math.round(Math.min(100, Math.max(0, prob * 100)) * 10) / 10;
    // Skip zero-probability dust legs and already-resolved 99.9%-100% expired legs
    if (pct <= 0 || pct >= 99.9) continue;

    grouped.push({
      label: cleanLabel,
      probabilityPct: pct,
    });
  }

  return grouped.sort((a, b) => b.probabilityPct - a.probabilityPct).slice(0, 4);
}

function normalizeGammaEvents(
  rawList: RawGammaEvent[],
  category: PolymarketMacroCategory,
  maxItems: number,
  nowMs: number
): PolymarketMacroEvent[] {
  const normalized: PolymarketMacroEvent[] = [];

  for (const ev of rawList) {
    if (!isRelevantEventForCategory(ev, category, nowMs)) continue;
    const outcomes = extractEventOutcomes(ev, nowMs);
    if (outcomes.length === 0) continue;

    const id = String(ev.id || ev.slug || '').trim();
    const title = String(ev.title || '').trim();
    if (!id || !title) continue;

    normalized.push({
      id,
      slug: String(ev.slug || ''),
      title,
      category,
      volume24hr: parseNumeric(ev.volume24hr),
      totalVolume: parseNumeric(ev.volume),
      liquidity: parseNumeric(ev.liquidity),
      endDate: typeof ev.endDate === 'string' && ev.endDate.trim() ? ev.endDate : null,
      polymarketUrl: buildSafePolymarketEventUrl(ev.slug),
      outcomes,
    });
  }

  return normalized
    .sort((a, b) => b.volume24hr - a.volume24hr || b.totalVolume - a.totalVolume)
    .slice(0, maxItems);
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs = 8000,
  extraHeaders?: Record<string, string>
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(extraHeaders || {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGammaEventsRaw(
  tagSlug: 'gold' | 'fed-rates' | 'economy' | 'geopolitics',
  limit: number,
  nowIso: string
): Promise<{ list: RawGammaEvent[]; transport: 'LIVE_DIRECT' | 'LIVE_PROXY' } | null> {
  const gammaUrl = `${POLYMARKET_GAMMA_EVENTS_BASE}?active=true&closed=false&tag_slug=${encodeURIComponent(
    tagSlug
  )}&end_date_min=${encodeURIComponent(nowIso)}&limit=${limit}&order=volume24hr&ascending=false`;

  const proxyCandidates = getApiEndpointCandidates('/api/proxy').map(
    (base) => `${base}?url=${encodeURIComponent(gammaUrl)}`
  );

  // 1. Native Android/iOS APK: try direct CapacitorHttp first (fast, zero CORS),
  //    then fall back to backend/Supabase Edge /api/proxy (helps bypass Indonesian ISP DNS blocks).
  if (isNativeAndroidOrIos()) {
    const directText = await nativeHttpGetText(gammaUrl, 7500, 'application/json');
    if (directText) {
      try {
        const parsed = JSON.parse(directText);
        if (Array.isArray(parsed)) {
          return { list: parsed as RawGammaEvent[], transport: 'LIVE_DIRECT' };
        }
      } catch {
        // fall through to proxy candidates
      }
    }

    for (const proxyUrl of proxyCandidates) {
      const proxyText = await nativeHttpGetText(proxyUrl, 8500, 'application/json');
      if (!proxyText) continue;
      try {
        const parsed = JSON.parse(proxyText);
        if (Array.isArray(parsed)) {
          return { list: parsed as RawGammaEvent[], transport: 'LIVE_PROXY' };
        }
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  // 2. Web browser: prefer same-origin / backend /api/proxy (avoids CORS & ISP blocks),
  //    with direct fetch as final fallback.
  for (const proxyUrl of proxyCandidates) {
    const authHeaders = buildBackendAuthHeaders(proxyUrl);
    const parsed = await fetchJsonWithTimeout(proxyUrl, 8000, authHeaders);
    if (Array.isArray(parsed)) {
      return { list: parsed as RawGammaEvent[], transport: 'LIVE_PROXY' };
    }
  }

  const directParsed = await fetchJsonWithTimeout(gammaUrl, 7000);
  if (Array.isArray(directParsed)) {
    return { list: directParsed as RawGammaEvent[], transport: 'LIVE_DIRECT' };
  }

  return null;
}

export function loadCachedPolymarketMacroSnapshot(): PolymarketMacroSnapshot | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(POLYMARKET_MACRO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PolymarketMacroSnapshot;
    if (!parsed || !Array.isArray(parsed.events) || !parsed.fetchedAt) {
      return null;
    }
    const nowMs = Date.now();
    const activeEvents = parsed.events.filter((ev) => isFutureIsoDate(ev.endDate, nowMs));
    return {
      ...parsed,
      events: activeEvents,
    };
  } catch {
    return null;
  }
}

function saveCachedPolymarketMacroSnapshot(snapshot: PolymarketMacroSnapshot): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(POLYMARKET_MACRO_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage quota failure
  }
}

export function formatCompactUsdVolume(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${Math.round(amount)}`;
}

export function formatPolymarketEndDate(iso: string | null | undefined, isEn: boolean): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  try {
    return parsed.toLocaleDateString(isEn ? 'en-US' : 'id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export async function fetchPolymarketMacroSentiment(options?: {
  forceRefresh?: boolean;
}): Promise<PolymarketMacroSnapshot> {
  const cached = loadCachedPolymarketMacroSnapshot();
  const offlineMode = isNewsCycleOfflineMode();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Strictly respect TradeVault Offline Mode toggle
  if (offlineMode) {
    if (cached && cached.events.length > 0) {
      return {
        ...cached,
        source: 'CACHE_OFFLINE',
      };
    }
    return {
      fetchedAt: nowIso,
      source: 'UNAVAILABLE',
      events: [],
      errorDetailId:
        'Mode Offline aktif dan belum ada cache sentimen Polymarket yang masih aktif di perangkat.',
      errorDetailEn:
        'Offline mode is enabled and no active cached Polymarket sentiment snapshot is stored on this device.',
    };
  }

  // Return fresh cache automatically if within TTL and not forced
  if (!options?.forceRefresh && cached && cached.events.length > 0) {
    const ageMs = nowMs - new Date(cached.fetchedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < CACHE_FRESH_TTL_MS) {
      return cached;
    }
  }

  const results = await Promise.all(
    CATEGORY_QUERIES.map(async (q) => {
      const res = await fetchGammaEventsRaw(q.tagSlug, q.limit, nowIso);
      return { category: q.category, res };
    })
  );

  const seenIds = new Set<string>();
  const combined: PolymarketMacroEvent[] = [];
  let usedProxy = false;
  let usedDirect = false;

  for (const entry of results) {
    if (!entry.res) continue;
    if (entry.res.transport === 'LIVE_PROXY') usedProxy = true;
    if (entry.res.transport === 'LIVE_DIRECT') usedDirect = true;

    const maxPerCat = entry.category === 'GOLD' || entry.category === 'FED_RATES' ? 4 : 3;
    const normalized = normalizeGammaEvents(entry.res.list, entry.category, maxPerCat, nowMs);
    for (const item of normalized) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      combined.push(item);
    }
  }

  if (combined.length > 0) {
    const freshSnapshot: PolymarketMacroSnapshot = {
      fetchedAt: new Date().toISOString(),
      source: usedDirect && !usedProxy ? 'LIVE_DIRECT' : 'LIVE_PROXY',
      events: combined,
    };
    saveCachedPolymarketMacroSnapshot(freshSnapshot);
    return freshSnapshot;
  }

  // Honest fallback to previous local cache if network/ISP blocked Polymarket
  if (cached && cached.events.length > 0) {
    return {
      ...cached,
      source: 'CACHE_OFFLINE',
      errorDetailId:
        'Koneksi langsung/proxy ke Polymarket gagal (kemungkinan jaringan offline atau blokir ISP). Menampilkan data cache terakhir.',
      errorDetailEn:
        'Direct/proxy connection to Polymarket failed (network offline or ISP restriction). Showing last cached snapshot.',
    };
  }

  return {
    fetchedAt: new Date().toISOString(),
    source: 'UNAVAILABLE',
    events: [],
    errorDetailId:
      'Data Polymarket sedang tidak dapat dijangkau (periksa koneksi internet atau blokir DNS/ISP pada domain Polymarket).',
    errorDetailEn:
      'Polymarket data is currently unreachable (check internet connectivity or DNS/ISP restrictions).',
  };
}
