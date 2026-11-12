import {
  MacroNewsSnapshot,
  MacroCalendarEvent,
  IntermarketAssetPulse,
  BreakingNewsHeadline,
  CmeFedWatchState,
  createUnavailableFedWatchState,
  computeDeterministicMacroSnapshot,
  saveMacroSnapshotToCache,
} from './macroNewsEngine';
import {
  fetchClientForexFactoryCalendar,
  fetchClientYahooAsset,
  fetchClientBreakingHeadlines,
  fetchClientFedFundsFuturesBackup,
} from './macroFeedFetcher';

const REMOTE_MACRO_API_ENDPOINTS = [
  '/api/macro-news/analyze',
  'https://ais-pre-qmgrbl6vkm3qzsovjavbgc-342426605045.asia-southeast1.run.app/api/macro-news/analyze',
  'https://ais-dev-qmgrbl6vkm3qzsovjavbgc-342426605045.asia-southeast1.run.app/api/macro-news/analyze',
];

async function safeFetchJson(
  url: string,
  options: RequestInit,
  timeoutMs = 15000
): Promise<{ ok: boolean; json: any | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      cache: 'no-store',
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
      return { ok: false, json: null };
    }

    try {
      const json = JSON.parse(rawText);
      return { ok: res.ok, json };
    } catch {
      return { ok: false, json: null };
    }
  } catch {
    return { ok: false, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes server-side Gemini 2.5 Flash analysis via /api/macro-news/analyze proxy.
 * Eliminates browser-side Gemini API calls so the application functions for every user.
 * Falls back deterministically to Master Playbook rules + live ZQ=F FedWatch backup if server or quota is unavailable.
 */
export async function analyzeMacroWithGeminiClient(params: {
  calendarEvents: MacroCalendarEvent[];
  intermarketPulse: {
    dxy: IntermarketAssetPulse;
    us02y?: IntermarketAssetPulse;
    usoil: IntermarketAssetPulse;
    us10y: IntermarketAssetPulse;
  };
  breakingNews: BreakingNewsHeadline[];
  cmeFedWatchBackup?: CmeFedWatchState;
  selectedEventId?: string;
  forceRefresh?: boolean;
}): Promise<MacroNewsSnapshot> {
  const {
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatchBackup,
    selectedEventId,
    forceRefresh = false,
  } = params;

  const fallbackFedWatch =
    cmeFedWatchBackup && cmeFedWatchBackup.isAvailable
      ? cmeFedWatchBackup
      : createUnavailableFedWatchState();

  // 1. Calculate the baseline deterministic snapshot first as fallback
  const baselineSnapshot = computeDeterministicMacroSnapshot({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatch: fallbackFedWatch,
    selectedEventId,
    sourceMode: 'RULE_BASED_FALLBACK',
    modelUsed: 'deterministic-playbook-v1',
  });

  const requestPayload = {
    forceRefresh,
    selectedEventId,
    clientFeeds: {
      calendarEvents,
      intermarketPulse,
      breakingNews,
      cmeFedWatch: fallbackFedWatch,
    },
  };

  // 2. Call server-side Gemini proxy (with remote URLs for Android APK)
  for (const endpoint of REMOTE_MACRO_API_ENDPOINTS) {
    const res = await safeFetchJson(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify(requestPayload),
      },
      18000
    );

    if (res.ok && res.json?.success && res.json?.snapshot) {
      return res.json.snapshot as MacroNewsSnapshot;
    }
  }

  // 3. Resilient fallback to deterministic Master Playbook rules if server is unreachable
  return baselineSnapshot;
}

/**
 * End-to-end client-side workflow:
 * 1. Parallel fetch of ForexFactory + Yahoo Finance 2x2 Grid (DXY, US02Y, US10Y, USOIL) + ZQ=F / ^IRX + Breaking News RSS.
 * 2. Analyze via server-side Gemini proxy (/api/macro-news/analyze) including Google Search Grounding for CME FedWatch (FOMC Desember 2026) & live ZQ=F Futures backup.
 * 3. Save to Supabase `macro_news_snapshots` table with full error reporting.
 */
export async function executeClientSideMacroAnalysis(
  selectedEventId?: string,
  forceRefresh = false
): Promise<{
  snapshot: MacroNewsSnapshot;
  supabaseResult: { success: boolean; error?: string; remoteSaved: boolean };
}> {
  // Step 1: Pull all live public feeds in parallel (never hangs even if one fails)
  const [calendarEvents, dxy, us02y, usoil, us10y, breakingNews] = await Promise.all([
    fetchClientForexFactoryCalendar(),
    fetchClientYahooAsset('DXY', 'DX-Y.NYB', 'US Dollar Index (DXY)', 104.85, 104.42),
    fetchClientYahooAsset('US02Y', '2YY=F', 'US 2Y Treasury Yield', 4.25, 4.22),
    fetchClientYahooAsset('USOIL', 'CL=F', 'US Oil WTI Crude', 73.4, 71.95),
    fetchClientYahooAsset('US10Y', '^TNX', 'US 10Y Treasury Yield', 4.38, 4.31),
    fetchClientBreakingHeadlines(),
  ]);

  const intermarketPulse = { dxy, us02y, usoil, us10y };
  const cmeFedWatchBackup = await fetchClientFedFundsFuturesBackup(us10y);

  // Step 2: Analyze with server-side Gemini proxy
  const analyzedSnapshot = await analyzeMacroWithGeminiClient({
    calendarEvents,
    intermarketPulse,
    breakingNews,
    cmeFedWatchBackup,
    selectedEventId,
    forceRefresh,
  });

  // Preserve live calendar events from client or server (including server Google Search Grounding fallback)
  if (calendarEvents.length > 0 && calendarEvents.every((e) => e.isLiveFeed)) {
    analyzedSnapshot.calendarEvents = calendarEvents;
    analyzedSnapshot.isCalendarLiveFeed = true;
  } else {
    analyzedSnapshot.isCalendarLiveFeed =
      Array.isArray(analyzedSnapshot.calendarEvents) &&
      analyzedSnapshot.calendarEvents.length > 0 &&
      analyzedSnapshot.calendarEvents.every((e) => e.isLiveFeed === true);
  }

  // Ensure CME FedWatch is always populated with either CME Grounding or Live ZQ=F Futures Backup
  if (!analyzedSnapshot.cmeFedWatch || !analyzedSnapshot.cmeFedWatch.isAvailable) {
    analyzedSnapshot.cmeFedWatch =
      analyzedSnapshot.scenarioMatrix?.cmeFedWatch?.isAvailable
        ? analyzedSnapshot.scenarioMatrix.cmeFedWatch
        : cmeFedWatchBackup.isAvailable
        ? cmeFedWatchBackup
        : createUnavailableFedWatchState();
  }
  if (
    analyzedSnapshot.scenarioMatrix &&
    (!analyzedSnapshot.scenarioMatrix.cmeFedWatch ||
      !analyzedSnapshot.scenarioMatrix.cmeFedWatch.isAvailable)
  ) {
    analyzedSnapshot.scenarioMatrix.cmeFedWatch = analyzedSnapshot.cmeFedWatch;
  }

  if (forceRefresh) {
    analyzedSnapshot.analyzedAt = new Date().toISOString();
  }

  // Step 3: Insert directly into Supabase `macro_news_snapshots` (only if live calendar is verified)
  const supabaseResult = await saveMacroSnapshotToCache(analyzedSnapshot);

  return {
    snapshot: analyzedSnapshot,
    supabaseResult,
  };
}


